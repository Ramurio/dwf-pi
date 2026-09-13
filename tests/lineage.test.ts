import assert from "node:assert/strict";
import test from "node:test";
import {
  ancestrySet, canonicalContinuationRequest, canonicalJson, continuationWriterBlockers, digestJson, matchReuseBindings, parseContinuationRequest, planHasReuse, planReuseNodes, resolveReuseBinding, sourceActivationSchema,
} from "../src/lineage.js";
import { compileWorkflow } from "../src/compiler.js";
import { validateWorkflow, type WorkflowDefinition } from "../src/graph.js";
import type { ExecutionPlan } from "../src/execution-types.js";
import type { ActivationRecord } from "../src/run-store.js";

const digest = "a".repeat(64);
const prepared = `prepared-${"b".repeat(64)}`;
const base = {
  preparedId: prepared, idempotencyKey: "key-1",
  source: { runId: "run-source", checkpoint: digest, planHash: digest },
  actor: "tester", reason: "Revise the failed implementer", evidence: ["inspected files"],
  workspaceDigest: digest, input: { a: 1, b: 2 },
};

test("continuation request parsing is closed, order-insensitive and rejects malformed fields", () => {
  const parsed = parseContinuationRequest({ ...base, input: { b: 2, a: 1 } });
  assert.deepEqual(parsed.input, { b: 2, a: 1 });
  const canonical = canonicalContinuationRequest(parsed);
  const reordered = parseContinuationRequest({ workspaceDigest: digest, evidence: ["inspected files"], reason: "Revise the failed implementer", actor: "tester", source: { planHash: digest, checkpoint: digest, runId: "run-source" }, idempotencyKey: "key-1", preparedId: prepared, input: { b: 2, a: 1 } });
  assert.equal(canonicalJson(canonical), canonicalJson(canonicalContinuationRequest(reordered)));
  assert.throws(() => parseContinuationRequest({ ...base, extra: true }), /fields/);
  assert.throws(() => parseContinuationRequest({ ...base, evidence: [] }), /evidence/);
  assert.throws(() => parseContinuationRequest({ ...base, workspaceDigest: "nope" }), /digest/);
  assert.throws(() => parseContinuationRequest({ ...base, reuse: [{ bindingId: "x", sourceRunId: "run-source", activationKey: "k", attempt: 1 }, { bindingId: "x", sourceRunId: "run-source", activationKey: "k", attempt: 1 }] }), /Duplicate/);
  assert.throws(() => parseContinuationRequest({ ...base, dispositions: [{ key: "k", attempt: 1, disposition: "accept", evidence: ["x"] }] }), /cannot accept/);
});

test("reuse nodes are unique, require v9, and binding lists must match the target plan", () => {
  const workflow: WorkflowDefinition = { schemaVersion: 1, id: "reuse-flow", name: "Reuse", revision: 1, entryGraph: "main", graphs: { main: { entry: "prior", nodes: [
    { id: "prior", kind: "reuse", bindingId: "planner", outputSchema: { type: "object", properties: { result: {} }, required: ["result"], additionalProperties: false } },
    { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "prior"] } },
  ], edges: [{ from: "prior", to: "done" }] } } };
  assert.equal(validateWorkflow(workflow).valid, true);
  assert.equal(planHasReuse(workflow), true);
  assert.deepEqual(planReuseNodes(workflow).map(node => node.bindingId), ["planner"]);
  const duplicate = structuredClone(workflow);
  duplicate.graphs.main!.nodes.push({ id: "other", kind: "reuse", bindingId: "planner", outputSchema: { type: "object", properties: { result: {} }, required: ["result"] } });
  duplicate.graphs.main!.edges.push({ from: "done", to: "other" });
  assert.equal(validateWorkflow(duplicate).valid, false);
  assert.throws(() => compileWorkflow(workflow, "dynamicwf-effect-v8"), /reuse nodes require compiler v9/);
  const plan = { workflow } as ExecutionPlan;
  matchReuseBindings(plan, [{ bindingId: "planner", sourceRunId: "run-source", activationKey: "k", attempt: 1 }]);
  assert.throws(() => matchReuseBindings(plan, []), /exactly/);
  assert.throws(() => matchReuseBindings(plan, [{ bindingId: "missing", sourceRunId: "run-source", activationKey: "k", attempt: 1 }]), /not in the target plan/);
});

test("ancestry walks parents and rejects cycles; writer dispositions are exact", () => {
  const members = [
    { runId: "run-a", taskId: "task-1", parentRunId: null, role: "root" as const, receiptId: null, createdAt: 1, launchedWithTask: true },
    { runId: "run-b", taskId: "task-1", parentRunId: "run-a", role: "continuation" as const, receiptId: "cont-1", createdAt: 2, launchedWithTask: true },
  ];
  assert.deepEqual([...ancestrySet(members, "run-b")].sort(), ["run-a", "run-b"]);
  assert.throws(() => ancestrySet([
    { ...members[0]!, parentRunId: "run-b" }, members[1]!,
  ], "run-a"), /cycle/);
  const failed = { runId: "run-a", key: "k", context: { graphId: "main", nodeId: "write", scope: [], visit: 0 }, kind: "check", sideEffect: true, status: "failed", attempt: 1, ownerToken: "", startedAt: 0, finishedAt: 1, metadata: { failure: { effects: "unknown" } } } as unknown as ActivationRecord;
  const writers = continuationWriterBlockers([failed], []);
  assert.equal(writers[0]?.code, "writer-disposition-required");
  assert.equal(continuationWriterBlockers([
    { ...failed, metadata: { failure: { effects: "unknown" }, operation: { kind: "check", cwd: "/", command: "x", args: [] } } },
  ], [{ key: "k", attempt: 1, disposition: "retain-effects", evidence: ["kept files"] }]).length, 0);
  assert.equal(continuationWriterBlockers([
    { ...failed, metadata: { failure: { effects: "unknown" }, operation: { kind: "check" } } },
  ], [{ key: "k", attempt: 1, disposition: "retain-effects", evidence: ["kept files"] }])[0]?.code, "missing-operation");
});

test("reused reviewer verdict cannot drop artifactRevision from the target schema", () => {
  const sourceActivation = {
    runId: "run-a", key: "review", context: { graphId: "main", nodeId: "review", scope: ["graph", "main"], visit: 0 },
    kind: "agent", sideEffect: true, status: "succeeded", attempt: 1, ownerToken: "", startedAt: 0, finishedAt: 1,
    output: { decision: "approve", summary: "ok", findings: [], artifactRevision: "rev-1" }, metadata: {},
  } as unknown as ActivationRecord;
  const sourceRun = { plan: { hash: "h", workflow: { graphs: { main: { nodes: [{ id: "review", kind: "agent", role: "reviewer", task: { op: "literal", value: "review" } }] } } }, agents: { main: { review: { outputSchema: { type: "object", properties: { decision: {}, summary: {}, findings: {}, artifactRevision: { type: "string" } }, required: ["decision", "summary", "findings", "artifactRevision"], additionalProperties: false } } } } } } as never;
  const binding = { bindingId: "verdict", sourceRunId: "run-a", activationKey: "review", attempt: 1 };
  const stripped = { graphId: "main", nodeId: "prior", bindingId: "verdict", outputSchema: { type: "object", properties: { decision: { type: "string" } }, required: ["decision"], additionalProperties: false } };
  assert.throws(() => resolveReuseBinding({
    binding, target: stripped, sourceRun, sourceActivation, sourcePlanHash: "h", input: { artifactRevision: "rev-2" },
    producer: { runId: "run-a", key: "review", attempt: 1, graphId: "main", nodeId: "review", output: sourceActivation.output!, schema: { type: "object", properties: { decision: {}, summary: {}, findings: {}, artifactRevision: {} }, required: ["decision", "summary", "findings", "artifactRevision"], additionalProperties: false } },
  }), /artifactRevision|Invalid structured output/);
  const kept = { graphId: "main", nodeId: "prior", bindingId: "verdict", outputSchema: { type: "object", properties: { decision: { type: "string" }, summary: { type: "string" }, findings: {}, artifactRevision: { type: "string" } }, required: ["decision", "summary", "findings", "artifactRevision"], additionalProperties: false } };
  assert.throws(() => resolveReuseBinding({
    binding: { ...binding, artifactRevision: "rev-1" }, target: kept, sourceRun, sourceActivation, sourcePlanHash: "h", input: { artifactRevision: "rev-2" },
    producer: { runId: "run-a", key: "review", attempt: 1, graphId: "main", nodeId: "review", output: sourceActivation.output!, schema: kept.outputSchema },
  }), /different artifact revision/);

});

test("reusing a succeeded null output does not dereference revision fields", () => {
  const sourceActivation = {
    runId: "run-a", key: "done", context: { graphId: "main", nodeId: "done", scope: ["graph", "main"], visit: 0 },
    kind: "end", sideEffect: false, status: "succeeded", attempt: 1, ownerToken: "", startedAt: 0, finishedAt: 1,
    output: null, metadata: {},
  } as unknown as ActivationRecord;
  const schema = { type: "object", nullable: true, additionalProperties: false };
  const reused = resolveReuseBinding({
    binding: { bindingId: "nullResult", sourceRunId: "run-a", activationKey: "done", attempt: 1 },
    target: { graphId: "main", nodeId: "prior", bindingId: "nullResult", outputSchema: schema },
    sourceRun: { plan: { hash: "h" } } as never, sourceActivation, sourcePlanHash: "h", input: null,
    producer: { runId: "run-a", key: "done", attempt: 1, graphId: "main", nodeId: "done", output: null, schema },
  });
  assert.equal(reused.value, null);
  assert.equal(reused.artifactRevision, undefined);
});

test("sourceSchemaDigest is the inspected source schema, not the original producer schema", () => {
  const producerSchema = { type: "object", additionalProperties: false, required: ["exitCode", "stdout", "stderr"], properties: { exitCode: { type: "integer" }, stdout: { type: "string" }, stderr: { type: "string" } } };
  const sourceSchema = { type: "object", additionalProperties: false, required: ["exitCode", "stdout", "stderr"], properties: { exitCode: { type: "integer", const: 0 }, stdout: { type: "string" }, stderr: { type: "string" } } };
  const output = { exitCode: 0, stdout: "", stderr: "" };
  const sourceActivation = {
    runId: "run-b", key: "prior", context: { graphId: "main", nodeId: "prior", scope: ["graph", "main"], visit: 0 },
    kind: "reuse", sideEffect: false, status: "succeeded", attempt: 1, ownerToken: "", startedAt: 0, finishedAt: 1,
    output, metadata: {},
  } as unknown as ActivationRecord;
  const sourceRun = { plan: { hash: "h", workflow: { graphs: { main: { nodes: [{ id: "prior", kind: "reuse", bindingId: "saved", outputSchema: sourceSchema }] } } }, agents: {} } } as never;
  const target = { graphId: "main", nodeId: "prior", bindingId: "saved", outputSchema: sourceSchema };
  const producer = { runId: "run-a", key: "probe", attempt: 1, graphId: "main", nodeId: "probe", output, schema: producerSchema };
  const sourceSchemaDigest = digestJson(sourceSchema), producerSchemaDigest = digestJson(producerSchema);
  assert.equal(sourceActivationSchema(sourceRun, sourceActivation), sourceSchema);
  const reused = resolveReuseBinding({
    binding: { bindingId: "saved", sourceRunId: "run-b", activationKey: "prior", attempt: 1, sourceOutputDigest: digestJson(output), sourceSchemaDigest, producerSchemaDigest },
    target, sourceRun, sourceActivation, sourcePlanHash: "h", input: null, producer,
  });
  assert.equal(reused.schemaDigest, sourceSchemaDigest);
  assert.equal(reused.producerSchemaDigest, producerSchemaDigest);
  assert.throws(() => resolveReuseBinding({
    binding: { bindingId: "saved", sourceRunId: "run-b", activationKey: "prior", attempt: 1, sourceSchemaDigest: producerSchemaDigest },
    target, sourceRun, sourceActivation, sourcePlanHash: "h", input: null, producer,
  }), /source schema digest mismatch/);
  assert.throws(() => resolveReuseBinding({
    binding: { bindingId: "saved", sourceRunId: "run-b", activationKey: "prior", attempt: 1, producerSchemaDigest: sourceSchemaDigest },
    target, sourceRun, sourceActivation, sourcePlanHash: "h", input: null, producer,
  }), /producer schema digest mismatch/);
  const wider = { type: "object", additionalProperties: false, required: ["exitCode", "stdout", "stderr"], properties: { exitCode: { type: "integer" }, stdout: { type: "string" }, stderr: { type: "string" } } };
  const schemaless = resolveReuseBinding({
    binding: { bindingId: "saved", sourceRunId: "run-b", activationKey: "prior", attempt: 1, sourceOutputDigest: digestJson(output), sourceSchemaDigest },
    target: { ...target, outputSchema: wider }, sourceRun, sourceActivation, sourcePlanHash: "h", input: null,
    producer: { ...producer, schema: null },
  });
  assert.equal(schemaless.schemaDigest, sourceSchemaDigest);
  assert.equal(schemaless.producerSchemaDigest, undefined);
  assert.throws(() => resolveReuseBinding({
    binding: { bindingId: "saved", sourceRunId: "run-b", activationKey: "prior", attempt: 1, sourceSchemaDigest, producerSchemaDigest: sourceSchemaDigest },
    target: { ...target, outputSchema: wider }, sourceRun, sourceActivation, sourcePlanHash: "h", input: null,
    producer: { ...producer, schema: null },
  }), /producer schema digest mismatch/);
});

test("running or interrupted side-effect activations require retain-effects even when not labelled failed", () => {
  const running = { runId: "run-a", key: "k", context: { graphId: "main", nodeId: "write", scope: [], visit: 0 }, kind: "check", sideEffect: true, status: "running", attempt: 1, ownerToken: "", startedAt: 0, finishedAt: null, metadata: {} } as unknown as ActivationRecord;
  assert.equal(continuationWriterBlockers([running], [])[0]?.code, "writer-disposition-required");
});
