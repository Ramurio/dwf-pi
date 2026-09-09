import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import { WorkflowService } from "../src/service.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { loadGeneratedModule } from "../src/generated-module.js";
import type { Json, WorkflowDefinition } from "../src/graph.js";
import type { WorkflowRuntime } from "../src/runtime-contract.js";
import { chooseEdge } from "../src/expressions.js";

const perspectives = ["correctness", "verification", "maintainability", "requirements"] as const;
type Perspective = typeof perspectives[number];
type Decision = "approve" | "request_changes" | "inconclusive";
const choices: Decision[] = ["approve", "request_changes", "inconclusive"];
interface Vote { decision: Decision; summary: string; findings: { severity: string; message: string }[]; artifactRevision: string; acceptanceCriteriaRevision: string }
const source = (name: string) => readFile(new URL(`../examples/council.${name}.json`, import.meta.url), "utf8").then(text => JSON.parse(text));
async function load() {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-council-"));
  const service = new WorkflowService(join(directory, "state.sqlite"));
  try {
    const created = await service.dispatch("workflow.create", await source("create")) as { id: string };
    const patched = await service.dispatch("workflow.patch", await source("patch")) as { workflow: WorkflowDefinition; validation: { valid: boolean } };
    assert.equal(patched.validation.valid, true);
    assert.equal(patched.workflow.revision, 2);
    assert.deepEqual(await service.dispatch("workflow.validate", { id: created.id }), { valid: true, issues: [] });
    const plan = await prepareExecutionPlan(patched.workflow, {
      cwd: directory, availableModels: [{ provider: "test", id: "offline-reviewer", thinkingLevels: ["off", "high"] }],
    });
    const module = await loadGeneratedModule(plan, directory);
    const input = { ...await source("input"), artifactRevision: "fixture-tree-revision-7", acceptanceCriteriaRevision: "fixture-criteria-v2" } as Record<string, Json>;
    return { module, input, plan, close: async () => { service.close(); await rm(directory, { recursive: true, force: true }); } };
  } catch (error) { service.close(); await rm(directory, { recursive: true, force: true }); throw error; }
}
function votes(decisions: Decision[]): Record<Perspective, Vote> {
  return Object.fromEntries(perspectives.map((name, index) => [name, {
    decision: decisions[index]!, summary: `${name}: ${decisions[index]}`,
    findings: [{ severity: decisions[index] === "request_changes" ? "error" : "info", message: `${name} evidence retained` }],
    artifactRevision: "fixture-tree-revision-7", acceptanceCriteriaRevision: "fixture-criteria-v2",
  }])) as Record<Perspective, Vote>;
}
function runtime(results: Record<Perspective, Vote>, onCall?: (perspective: Perspective, task: string, input: Record<string, Json>) => void): WorkflowRuntime {
  return {
    finish: (_context, _node, _reason, _evidence, value) => Effect.succeed(value),
    route: (context, edges, scope) => Effect.try(() => chooseEdge(context.nodeId, edges, scope)),
    wait: () => Effect.fail(new Error("Unexpected await node")),
    step(_context, work) { return Effect.suspend(work); },
    agent(_context, _node, task, input) {
      return Effect.sync(() => {
        assert.ok(input && typeof input === "object" && !Array.isArray(input));
        const perspective = input.perspective as Perspective;
        assert.ok(perspectives.includes(perspective));
        onCall?.(perspective, task, input);
        return structuredClone(results[perspective]) as unknown as Json;
      });
    },
    check: () => Effect.fail(new Error("Council must not run shell checks")),
    worktree: () => Effect.fail(new Error("Read-only council must not create worktrees")),
    integrate: () => Effect.fail(new Error("Council must not integrate changes")),
  };
}
interface CouncilResult { accepted: boolean; decision: string; policy: string; revisionConsistent: boolean; artifactRevision: string; acceptanceCriteriaRevision: string; votes: Record<Perspective, Vote> }

test("council authoring requests validate and compiled graph deterministically evaluates every 3^4 verdict combination for both policies", async () => {
  const fixture = await load();
  try {
    const reviewer = fixture.plan.agents.reviewer!.review!;
    assert.equal(reviewer.permission, "read-only");
    assert.equal(reviewer.session, "fresh");
    assert.equal(reviewer.tools.includes("bash"), false);
    assert.equal(reviewer.tools.includes("write"), false);
    let combinations = 0;
    for (const a of choices) for (const b of choices) for (const c of choices) for (const d of choices) {
      const decisions = [a, b, c, d];
      const expectedVotes = votes(decisions);
      for (const policy of ["unanimous", "three-of-four"]) {
        const calls: Perspective[] = [];
        const input: Record<string, Json> = { ...fixture.input, policy };
        const output = await Effect.runPromise(fixture.module.run(runtime(expectedVotes, (perspective, task, given) => {
          calls.push(perspective);
          assert.match(task, /Independently review/);
          assert.equal(given.artifactRevision, input.artifactRevision);
          assert.equal(given.acceptanceCriteriaRevision, input.acceptanceCriteriaRevision);
          assert.deepEqual(given.acceptanceCriteria, input.acceptanceCriteria);
          assert.deepEqual(given.artifact, input.artifact);
        }), input)) as unknown as CouncilResult;
        const approves = decisions.filter(decision => decision === "approve").length;
        const expectedDecision = approves >= (policy === "unanimous" ? 4 : 3) ? "approve" : decisions.includes("request_changes") ? "request_changes" : "inconclusive";
        assert.equal(output.decision, expectedDecision, `${policy}: ${decisions.join(",")}`);
        assert.equal(output.accepted, expectedDecision === "approve");
        assert.equal(output.revisionConsistent, true);
        assert.equal(output.policy, policy);
        assert.equal(output.artifactRevision, input.artifactRevision);
        assert.equal(output.acceptanceCriteriaRevision, input.acceptanceCriteriaRevision);
        assert.deepEqual(output.votes, expectedVotes, "Every dissent, finding and original verdict is retained");
        assert.deepEqual(calls.sort(), [...perspectives].sort());
        combinations++;
      }
    }
    assert.equal(combinations, 162);
  } finally { await fixture.close(); }
});

test("unsupported or absent council policy is explicitly rejected before any reviewer inference", async () => {
  const fixture = await load();
  try {
    for (const policy of ["majority", "unanimouS", "", null, 3, false, undefined]) {
      const input = { ...fixture.input };
      if (policy === undefined) delete input.policy; else input.policy = policy;
      let calls = 0;
      const output = await Effect.runPromise(fixture.module.run(runtime(votes(["approve", "approve", "approve", "approve"]), () => { calls++; }), input)) as unknown as { accepted: boolean; decision: string; votes: unknown };
      assert.equal(calls, 0);
      assert.equal(output.accepted, false);
      assert.equal(output.decision, "invalid_policy");
      assert.deepEqual(output.votes, {});
    }
  } finally { await fixture.close(); }
});

test("even four approvals cannot accept a mismatched artifact or criteria revision", async () => {
  const fixture = await load();
  try {
    for (const policy of ["unanimous", "three-of-four"]) for (const name of perspectives) {
      for (const key of ["artifactRevision", "acceptanceCriteriaRevision"] as const) {
        const results = votes(["approve", "approve", "approve", "approve"]);
        results[name][key] = "wrong-revision";
        const output = await Effect.runPromise(fixture.module.run(runtime(results), { ...fixture.input, policy })) as unknown as CouncilResult;
        assert.equal(output.accepted, false, `${policy}/${name}/${key}`);
        assert.equal(output.decision, "inconclusive");
        assert.equal(output.revisionConsistent, false);
        assert.equal(output.artifactRevision, fixture.input.artifactRevision);
        assert.equal(output.acceptanceCriteriaRevision, fixture.input.acceptanceCriteriaRevision);
        assert.deepEqual(output.votes, results);
      }
    }
  } finally { await fixture.close(); }
});

test("four reviewer invocations are independent parallel scopes over a shared reusable reviewer graph", { timeout: 15_000 }, async () => {
  const fixture = await load();
  try {
    const results = votes(["approve", "approve", "approve", "approve"]);
    const calls: { scope: readonly string[]; perspective: Perspective; task: string }[] = [];
    let release!: () => void;
    const barrier = new Promise<void>(resolveBarrier => { release = resolveBarrier; });
    const r = runtime(results);
    r.agent = (context, _node, task, input) => Effect.gen(function* () {
      const perspective = (input as Record<string, Json>).perspective as Perspective;
      assert.equal(context.graphId, "reviewer");
      assert.equal(context.nodeId, "review");
      calls.push({ scope: context.scope, perspective, task });
      if (calls.length === 4) release();
      yield* Effect.promise(() => barrier);
      return structuredClone(results[perspective]) as unknown as Json;
    });
    const result = await Effect.runPromise(fixture.module.run(r, fixture.input).pipe(Effect.timeout("10 seconds"))) as unknown as CouncilResult;
    assert.equal(result.accepted, true);
    assert.equal(new Set(calls.map(call => JSON.stringify(call.scope))).size, 4);
    assert.equal(new Set(calls.map(call => call.task)).size, 4);
    assert.deepEqual(calls.map(call => call.perspective).sort(), [...perspectives].sort());
  } finally { await fixture.close(); }
});
