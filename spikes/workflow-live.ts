/** Opt-in model-backed graph probe. Its deadline is a test limit, never a run default. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import type { Expr, Json, Node, Edge } from "../src/graph.js";
import { WorkflowService } from "../src/service.js";
import { RunStore } from "../src/run-store.js";

const { values } = parseArgs({ options: { provider: { type: "string" }, model: { type: "string" } } });
if (!values.provider || !values.model) throw new Error("Explicit --provider and --model required");
const model = { provider: values.provider, id: values.model };
const directory = await mkdtemp(join(tmpdir(), "dynamicwf-workflow-live-"));
const cwd = join(directory, "workspace");
await mkdir(cwd);
const filename = join(directory, "state.sqlite");
const literal = (value: Json): Expr => ({ op: "literal", value });
const ref = (...path: string[]): Expr => ({ op: "ref", path });
const artifactSchema = { type: "object", additionalProperties: false,
  properties: { artifactRevision: { type: "string" }, acceptanceCriteriaRevision: { type: "string" },
    acceptanceCriteria: { type: "string" }, artifact: { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"], additionalProperties: false } },
  required: ["artifactRevision", "acceptanceCriteriaRevision", "acceptanceCriteria", "artifact"] };
const nodes: Node[] = [
  { id: "artifact", kind: "transform", value: { op: "select", when: { op: "exists", value: ref("nodes", "repair") }, then: ref("nodes", "repair"), otherwise: ref("input") } },
  { id: "review", kind: "agent", role: "reviewer", input: ref("nodes", "artifact"),
    task: literal("Review the supplied numeric artifact against its acceptanceCriteria. Independently compute the answer. Report a blocking finding if it is incorrect; approve if correct. Bind both revision fields exactly to input. Use submit_result."),
    config: { model, thinking: "low", tools: [] } },
  { id: "repair", kind: "agent", role: "implementer", input: { op: "object", fields: { current: ref("nodes", "artifact"), review: ref("nodes", "review") } },
    task: literal("Repair the supplied numeric artifact using the review and acceptance criteria. Compute the correct answer. Return the complete artifact envelope, preserve acceptanceCriteria and acceptanceCriteriaRevision, set artifactRevision to repair-v2. No files need changing; submit the structured artifact."),
    config: { model, thinking: "low", tools: [], permission: "read-only", outputSchema: artifactSchema } },
  { id: "done", kind: "end", value: { op: "object", fields: { artifact: ref("nodes", "artifact"), review: ref("nodes", "review") } } },
];
const edges: Edge[] = [
  { from: "artifact", to: "review" },
  { from: "review", to: "done", when: { op: "eq", left: ref("nodes", "review", "decision"), right: literal("approve") } },
  { from: "review", to: "repair" }, { from: "repair", to: "artifact" },
];
function cli(tool: string, request: unknown): unknown {
  const stdout = execFileSync(process.execPath, ["--import", import.meta.resolve("tsx"),
    fileURLToPath(new URL("../src/cli.ts", import.meta.url)), tool, "--store", filename], {
    cwd, input: JSON.stringify(request), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  });
  const response = JSON.parse(stdout) as { ok: boolean; result?: unknown };
  assert.equal(response.ok, true); return response.result;
}
const client = new WorkflowService(filename, { cwd });
let runId: string | undefined;
const deadline = Date.now() + 180_000;
async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(40); }
  throw new Error("Live workflow probe exceeded its test deadline");
}
try {
  cli("workflow.create", { id: "live-review", name: "Live review and repair" });
  const patch = cli("workflow.patch", { id: "live-review", expectedRevision: 1, operations: [
    ...nodes.map(node => ({ op: "addNode", graphId: "main", node })),
    ...edges.map(edge => ({ op: "connect", graphId: "main", edge })),
  ] }) as { validation: { valid: boolean } };
  assert.equal(patch.validation.valid, true);
  const started = cli("run.start", { id: "live-review", cwd, input: {
    artifactRevision: "seed-v1", acceptanceCriteriaRevision: "arithmetic-v1",
    acceptanceCriteria: "artifact.answer must equal 6 multiplied by 7", artifact: { answer: 41 },
  } }) as { id: string };
  runId = started.id;
  console.log(JSON.stringify({ stage: "started", runId, launchClientExited: true }));
  const journal = new RunStore(filename);
  try {
    await until(() => journal.listActivations(runId!).some(a => a.context.nodeId === "review" && a.status === "running"));
    await client.dispatch("run.pause", { id: runId });
    await until(async () => {
      const state = await client.dispatch("run.status", { id: runId }) as { status: string; error?: string };
      if (["failed", "cancelled"].includes(state.status)) throw new Error(state.error ?? state.status);
      return state.status === "paused";
    });
    assert.equal(journal.listActivations(runId).some(a => a.context.nodeId === "repair"), false);
    console.log(JSON.stringify({ stage: "paused", completedReview: true, repairNotAdmitted: true }));
    cli("run.resume", { id: runId });
    await until(async () => {
      const state = await client.dispatch("run.status", { id: runId }) as { status: string; error?: string };
      if (["failed", "cancelled"].includes(state.status)) throw new Error(state.error ?? state.status);
      return state.status === "succeeded";
    });
    const activations = journal.listActivations(runId);
    const reviews = activations.filter(a => a.context.nodeId === "review").sort((a, b) => a.context.visit - b.context.visit);
    assert.equal(reviews.length, 2);
    assert.equal((reviews[0]!.output as Record<string, Json>).decision, "request_changes");
    assert.equal((reviews[1]!.output as Record<string, Json>).decision, "approve");
    assert.notEqual(reviews[0]!.metadata.sessionFile, reviews[1]!.metadata.sessionFile);
    const output = journal.get(runId).output as { artifact: { artifactRevision: string; artifact: { answer: number } }; review: { artifactRevision: string } };
    assert.equal(output.artifact.artifact.answer, 42);
    assert.equal(output.artifact.artifactRevision, "repair-v2");
    assert.equal(output.review.artifactRevision, "repair-v2");
    const workers = activations.filter(a => a.kind === "agent");
    assert.ok(workers.every(a => a.status === "succeeded" && a.metadata.workerPid === null));
    const usage = workers.map(a => a.metadata.usage as { input: number; output: number; totalTokens: number });
    console.log(JSON.stringify({ passed: true, model, workers: workers.length, reviewDecisions: ["request_changes", "approve"],
      freshReviewerSessions: true, pauseAndResume: true, launchClientExited: true, revisionBound: true,
      inputTokens: usage.reduce((n, u) => n + u.input, 0), outputTokens: usage.reduce((n, u) => n + u.output, 0),
      output: { answer: 42, artifactRevision: "repair-v2" } }, null, 2));
    const originalPlanHash = journal.get(runId).plan.hash;
    cli("preset.save", { id: runId, name: "live-review", scope: "global" });
    cli("preset.save", { id: runId, name: "live-review", scope: "project", cwd });
    // The preset must remain runnable even after the author changes the draft.
    cli("workflow.patch", { id: "live-review", expectedRevision: 2, operations: [{ op: "replaceNode", graphId: "main", node: {
      id: "artifact", kind: "transform", value: literal("Edited draft must not enter the saved run"),
    } }] });
    const repeated = cli("preset.run", { name: "live-review", scope: "global", cwd, input: {
      artifactRevision: "next-task-v1", acceptanceCriteriaRevision: "arithmetic-v1",
      acceptanceCriteria: "artifact.answer must equal 6 multiplied by 7", artifact: { answer: 42 },
    } }) as { id: string; planHash: string };
    assert.notEqual(repeated.id, runId); assert.equal(repeated.planHash, originalPlanHash);
    runId = repeated.id;
    await until(async () => {
      const state = await client.dispatch("run.status", { id: runId }) as { status: string; error?: string };
      if (["failed", "cancelled"].includes(state.status)) throw new Error(state.error ?? state.status);
      return state.status === "succeeded";
    });
    const repeatedWorkers = journal.listActivations(runId).filter(a => a.kind === "agent");
    assert.equal(repeatedWorkers.length, 1);
    assert.equal((repeatedWorkers[0]!.output as Record<string, Json>).decision, "approve");
    assert.equal((repeatedWorkers[0]!.output as Record<string, Json>).artifactRevision, "next-task-v1");
    assert.ok(reviews.every(a => a.metadata.sessionFile !== repeatedWorkers[0]!.metadata.sessionFile));
    console.log(JSON.stringify({ presetRerunPassed: true, frozenPlanUnchanged: true, editedDraftIgnored: true,
      newRunAndSession: true, newInputRevision: "next-task-v1", savedScopes: ["global", "project"],
      additionalWorkers: 1, usage: repeatedWorkers[0]!.metadata.usage }, null, 2));
  } finally { journal.close(); }
} finally {
  if (runId) {
    await client.dispatch("run.cancel", { id: runId }).catch(() => {});
    for (let i = 0; i < 100; i++) {
      const state = await client.dispatch("run.status", { id: runId }) as { status: string };
      if (["succeeded", "failed", "cancelled"].includes(state.status)) break;
      await sleep(50);
    }
  }
  client.close();
  await rm(directory, { recursive: true, force: true });
}
