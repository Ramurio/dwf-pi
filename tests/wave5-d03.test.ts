import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { graphSnapshot } from "../src/graph-view/model.js";
import type { WorkflowDefinition } from "../src/graph.js";
import { RunController } from "../src/run-controller.js";
import { WorkflowService } from "../src/service.js";
import { sumTokenUsage, summarizeUsage, tokenSummary } from "../src/usage.js";

const context = { graphId: "main", nodeId: "work", scope: ["graph", "main"], visit: 0 };
const workflow = (): WorkflowDefinition => ({ schemaVersion: 1, id: "d03-usage", name: "D03 usage after accept", revision: 1, entryGraph: "main", graphs: { main: { entry: "work", nodes: [
  { id: "work", kind: "agent", role: "general", task: { op: "literal", value: "Never invoke a model" }, config: { outputSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false } } },
  { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "work"] } },
], edges: [{ from: "work", to: "done" }] } } });

async function fixture(work: (controller: RunController, directory: string, filename: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-d03-")), filename = join(directory, "state.sqlite"), controller = new RunController(filename);
  try { await work(controller, directory, filename); }
  finally {
    for (const run of controller.store.listRuns()) {
      await controller.control(run.id, "cancel");
      const deadline = Date.now() + 15_000;
      for (;;) {
        const observed = controller.observe(run.id);
        if (!observed.supervisorAlive && !observed.workersAlive && !observed.unresolvedGroups.length) break;
        if (Date.now() > deadline) throw new Error("Fixture processes did not drain");
        await sleep(25);
      }
    }
    controller.close(); await rm(directory, { recursive: true, force: true });
  }
}

async function acceptAfterUsage(controller: RunController, directory: string, complete: boolean) {
  const plan = await prepareExecutionPlan(workflow(), { cwd: directory, availableModels: [{ provider: "offline", id: "fixture", thinkingLevels: ["off"] }] });
  const id = complete ? "run-d03-complete" : "run-d03-incomplete";
  controller.store.create({ id, plan, cwd: directory, input: null });
  const { token } = controller.store.reserveLaunch(id);
  const a = controller.store.beginActivation(id, token, context, { kind: "agent", sideEffect: true });
  controller.store.setActivationMetadata(id, token, a.key, { operation: { kind: "agent", cwd: directory, task: "Never invoke a model", input: null, sessionDirectory: directory, resourceDirectory: directory } });
  controller.store.startUsage(id, token, a.key);
  controller.store.recordUsage(id, token, a.key, "1", { input: 7, output: 3, totalTokens: 10 }, "error");
  controller.store.settleUsage(id, token, a.key, complete);
  controller.store.requestControl(id, "pause");
  controller.store.failActivation(id, token, a.key, "Fixture uncertain operation");
  controller.store.finish(id, token, { status: "failed", error: "Fixture uncertain operation" });
  const inspected = await controller.recovery(id, a.key);
  assert.deepEqual(inspected.blockers, []);
  assert.ok(inspected.workspace);
  await controller.reconcile({
    id, key: a.key, attempt: inspected.attempt, checkpoint: inspected.checkpoint, workspaceDigest: inspected.workspace.digest,
    decisionId: "decision-1", action: "accept", actor: "fixture-agent", reason: "Inspected local result and settled the operation",
    evidence: [{ inspected: true }], output: { answer: "Already produced" },
  });
  return { id, key: a.key };
}

test("accept after complete usage keeps summary complete without inventing a ledger row", async () => fixture(async (controller, directory, filename) => {
  const { id, key } = await acceptAfterUsage(controller, directory, true);
  const summary = summarizeUsage(controller.store.listActivations(id));
  const reports = controller.store.usageReports(id).reports;
  const attempts = controller.store.attempts(id, key);
  const current = controller.store.getActivation(id, key)!;
  assert.equal(sumTokenUsage(reports.map(report => report.usage)).totalTokens, 10);
  assert.equal(reports.length, 1);
  assert.equal(summary.totalTokens, 10);
  assert.equal(summary.partial, false);
  assert.equal(summary.earlierAttempts, 0);
  assert.equal(summary.incomplete, 0);
  assert.equal(summary.responses, 1);
  assert.equal(attempts.current.attempt, 2);
  assert.equal(attempts.current.accounting.recorded, false);
  assert.equal(attempts.records[0]!.accounting.usage!.totalTokens, 10);
  assert.equal(current.metadata.usageComplete, true);
  assert.equal(current.metadata.usageReportCount, 1);
  assert.equal(current.metadata.usageRecordedAttempts, 2);
  assert.doesNotMatch(tokenSummary(controller.store.listActivations(id)), /неполные данные/);
  const snapshot = graphSnapshot(controller.store.get(id), controller.store.listActivations(id));
  const activation = snapshot.graphs[0]!.nodes.find(node => node.id === "work")!.activations[0]!;
  assert.equal(snapshot.usage.partial, false);
  assert.equal(snapshot.usage.responses, 1);
  assert.equal(activation.usageComplete, true);
  assert.equal(activation.usageRecordedAttempts, activation.attempt);
  const service = new WorkflowService(filename);
  try {
    const page = await service.dispatch("run.usage", { id }) as { summary: ReturnType<typeof summarizeUsage> };
    assert.equal(page.summary.partial, false);
    assert.equal(page.summary.responses, 1);
    assert.equal(page.summary.totalTokens, 10);
  } finally { service.close(); }
}));

test("accept after incomplete usage keeps incomplete accounting instead of an attempt hole", async () => fixture(async (controller, directory, filename) => {
  const { id, key } = await acceptAfterUsage(controller, directory, false);
  const summary = summarizeUsage(controller.store.listActivations(id));
  const current = controller.store.getActivation(id, key)!;
  assert.equal(summary.totalTokens, 10);
  assert.equal(summary.partial, true);
  assert.equal(summary.incomplete, 1);
  assert.equal(summary.earlierAttempts, 0);
  assert.equal(summary.responses, 1);
  assert.equal(controller.store.attempts(id, key).current.accounting.recorded, false);
  assert.equal(current.metadata.usageComplete, false);
  assert.equal(current.metadata.usageRecordedAttempts, 2);
  assert.match(tokenSummary(controller.store.listActivations(id)), /неполные данные/);
  const snapshot = graphSnapshot(controller.store.get(id), controller.store.listActivations(id));
  assert.equal(snapshot.usage.partial, true);
  assert.equal(snapshot.usage.incomplete, 1);
  const service = new WorkflowService(filename);
  try {
    const page = await service.dispatch("run.usage", { id }) as { summary: ReturnType<typeof summarizeUsage> };
    assert.equal(page.summary.partial, true);
    assert.equal(page.summary.incomplete, 1);
    assert.equal(page.summary.responses, 1);
  } finally { service.close(); }
}));
