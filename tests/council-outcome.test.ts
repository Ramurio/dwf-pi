import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { WorkflowService } from "../src/service.js";
import type { PreparedExecution } from "../src/execution-types.js";
import type { TaskOutcome } from "../src/task-outcome.js";

// No agent nodes, model discovery or provider transport: exercise the real detached supervisor.
for (const explicit of [false, true]) test(`${explicit ? "finish" : "legacy end"} preserves inconclusive output through service and supervisor`, { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "council-outcome-"));
  const service = new WorkflowService(join(directory, "state.sqlite"), { cwd: directory, availableModels: [] });
  let id: string | undefined;
  type Status = { id: string; status: string; output?: unknown; taskOutcome?: TaskOutcome; workersAlive: number; agents: unknown[] };
  const output = { accepted: false, decision: "inconclusive", votes: { verification: { decision: "inconclusive", findings: ["Missing evidence"], artifactRevision: "tree-7", acceptanceCriteriaRevision: "criteria-2" } } };
  try {
    await service.dispatch("workflow.create", { id: "outcome", name: "No-model outcome regression" });
    await service.dispatch("workflow.patch", { id: "outcome", expectedRevision: 1, operations: [{ op: "addNode", graphId: "main", node: {
      id: "done", kind: explicit ? "finish" : "end", value: { op: "literal", value: output },
      ...(explicit ? { decision: "inconclusive", evidence: { op: "literal", value: [] }, reason: { op: "literal", value: "Missing evidence" } } : {}),
    } }] });
    const prepared = await service.dispatch("workflow.prepare", { id: "outcome" }) as PreparedExecution;
    const started = await service.dispatch("run.start", { preparedId: prepared.preparedId }) as Status;
    id = started.id;
    let result = started;
    const deadline = Date.now() + 20_000;
    while (result.status !== "succeeded" && Date.now() < deadline) {
      assert.ok(!["failed", "cancelled", "interrupted"].includes(result.status), JSON.stringify(result));
      await sleep(30);
      result = await service.dispatch("run.status", { id }) as Status;
    }
    assert.equal(result.status, "succeeded");
    assert.deepEqual(result.agents, []);
    assert.deepEqual(result.output, output);
    assert.equal(result.taskOutcome?.decision, explicit ? "inconclusive" : "rejected");
    assert.equal(result.taskOutcome?.source, explicit ? "explicit" : "legacy");
    await assert.rejects(service.dispatch("preset.save", { id, name: "not-accepted", scope: "project" }), /accepted task outcome/);
  } finally {
    if (id) {
      await service.dispatch("run.cancel", { id });
      const deadline = Date.now() + 10_000;
      while (true) {
        const state = await service.dispatch("run.status", { id }) as Status;
        if (["succeeded", "failed", "cancelled"].includes(state.status) && !state.workersAlive) break;
        assert.ok(Date.now() < deadline, "Supervisor did not drain");
        await sleep(30);
      }
    }
    service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
