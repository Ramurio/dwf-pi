import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { WorkflowService } from "../src/service.js";
import { loadGeneratedModule } from "../src/generated-module.js";
import { chooseEdge } from "../src/expressions.js";
import { GitWorkspaces } from "../src/workspaces.js";
import { expectedWorktreeTree } from "../src/worktree-constraint.js";
import { runCheckProcess } from "../src/process-client.js";
import type { WorkflowRuntime } from "../src/runtime-contract.js";
import type { Json } from "../src/graph.js";
function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
test("compiled prepared recipe: third reviewer requests changes; fresh snapshot and unanimous review bind the real commit", { timeout: 40_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "recipe-cycle-")), repo = join(root, "repo");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { mkdirSync } = await import("node:fs"); mkdirSync(repo);
  git(repo, "init", "-q"); git(repo, "config", "user.name", "Fixture"); git(repo, "config", "user.email", "fixture@localhost");
  writeFileSync(join(repo, "base.txt"), "unchanged\n"); git(repo, "add", "."); git(repo, "commit", "-qm", "base");
  const originalHead = git(repo, "rev-parse", "HEAD");
  const model = { provider: "test", id: "stub" };
  const service = new WorkflowService(join(root, "state.sqlite"), { cwd: repo, availableModels: [{ ...model, thinkingLevels: ["high", "medium"] }] }); t.after(() => service.close());
  const prepared = await service.dispatch("workflow.recipe.prepare", { recipe: "implementation-loop", version: 1, id: "cycle", name: "Cycle", task: "Add a file", acceptanceCriteria: ["File exists"], projectPolicy: "No external actions", contextFiles: ["base.txt"], checkCommand: "node", checkArgs: ["-e", "if(!require('node:fs').existsSync('change.txt'))process.exit(1)"],
    planner: { model, thinking: "high" }, implementer: { model, thinking: "medium" }, reviewers: ["first", "second", "third"].map(id => ({ id, perspective: id, model, thinking: "high" })) }) as any;
  const saved = await service.dispatch("workflow.prepared", { preparedId: prepared.preparedId }) as any;
  const module = await loadGeneratedModule(saved.plan, join(root, "compiled"));
  const workspaces = new GitWorkspaces("recipeCycleTest", join(root, "allocation"));
  let cwd = repo, implementation = 0, reviews = 0, lastTree = "";
  const seen: Record<string, Json[]> = { first: [], second: [], third: [] };
  const runtime: WorkflowRuntime = {
    collect: (_ctx, _id, work) => work().pipe(Effect.map(value => ({ status: "succeeded", value } as Json))),
    route: (ctx, edges, scope) => Effect.try(() => chooseEdge(ctx.nodeId, edges, scope)),
    step: (_ctx, work) => work(),
    stepOperation: (ctx, node, prepare) => Effect.suspend(() => { const input = prepare();
      if (node.kind !== "agent" || input.kind !== "agent") return Effect.fail(new Error("Unexpected operation"));
      return runtime.agent(ctx, node, input.task, input.input);
    }),
    agent: (ctx, _node, _task, input) => Effect.sync(() => {
      if (ctx.nodeId === "plan") return { summary: "Plan", steps: [], acceptanceChecks: [], risks: [], sources: [] };
      if (ctx.nodeId === "implement") {
        implementation++;
        if (implementation === 2) assert.equal((input as any).reviewFeedback.third.decision, "request_changes");
        writeFileSync(join(cwd, "change.txt"), implementation === 1 ? "initial\n" : "fixed\n");
        return { status: "ready", summary: "Updated", changedFiles: ["change.txt"], checks: [], blocker: "" };
      }
      assert.equal(ctx.nodeId, "review");
      const reviewer = ctx.graphId.slice("review-".length);
      seen[reviewer]!.push(input);
      assert.equal(Object.hasOwn(input as object, "reviews"), false, "parallel siblings cannot see each other's verdict");
      const revision = (input as any).artifactRevision;
      assert.equal(revision, lastTree);
      if (reviewer === "third") reviews++;
      return { decision: reviewer === "third" && implementation === 1 ? "request_changes" : "approve", summary: "Reviewed", findings: [], artifactRevision: revision, acceptanceCriteriaRevision: (input as any).acceptanceCriteriaRevision };
    }),
    worktree: (ctx, node, child) => Effect.tryPromise(async () => {
      const allocation = await workspaces.allocate(repo, "candidate", undefined);
      cwd = allocation.path;
      const result = await Effect.runPromise(child([...ctx.scope, "candidate", "graph", node.graphId]));
      const tree = expectedWorktreeTree(node, result);
      const workspace = await workspaces.commit(allocation, { ...(tree === undefined ? {} : { expectedTree: tree }) });
      return { result, workspace: { ...workspace } };
    }),
    check: (_ctx, node) => Effect.tryPromise(() => runCheckProcess(node.command, node.args, cwd)),
    integrate: () => Effect.fail(new Error("Publication not allowed")),
    finish: (_ctx, _node, _reason, _evidence, value) => Effect.succeed(value),
    wait: () => Effect.fail(new Error("Unexpected wait")), reuse: () => Effect.fail(new Error("Unexpected reuse")),
  };
  const check = runtime.check;
  runtime.check = (ctx, node) => check(ctx, node).pipe(Effect.tap(value => Effect.sync(() => { if (ctx.nodeId === "snapshot") lastTree = (value as any).stdout; })));
  const output = await Effect.runPromise(module.run(runtime, prepared.input)) as any;
  assert.equal(output.result.status, "accepted"); assert.equal(implementation, 2); assert.equal(reviews, 2);
  for (const results of Object.values(seen)) { assert.equal(results.length, 2); assert.notEqual((results[0] as any).artifactRevision, (results[1] as any).artifactRevision); }
  const candidate = output.workspace.path;
  assert.equal(readFileSync(join(candidate, "change.txt"), "utf8"), "fixed\n");
  assert.equal(git(candidate, "rev-parse", "HEAD^{tree}"), lastTree.replace("git-tree:", ""));
  assert.equal(git(repo, "rev-parse", "HEAD"), originalHead);
  assert.equal(git(repo, "status", "--porcelain"), "");
});
