import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { WorkflowService, serviceToolNames } from "../src/service.js";
import type { PreparedExecution } from "../src/execution-types.js";
import type { Node } from "../src/graph.js";
import { RunStore } from "../src/run-store.js";

type Status = { id: string; status: string; desired: string; output?: unknown; error?: string; supervisorAlive?: boolean; workersAlive?: number; planHash: string; workflow: { id: string; revision: number }; agents: unknown[] };
const pureNode: Node = { id: "done", kind: "end", value: { op: "ref", path: ["input"] } };
async function author(service: WorkflowService, nodes: Node[] = [pureNode], id = "sample") {
  await service.dispatch("workflow.create", { id, name: "Sample" });
  return service.dispatch("workflow.patch", { id, expectedRevision: 1, operations: [
    ...nodes.map(node => ({ op: "addNode", graphId: "main", node })),
    ...nodes.slice(1).map((node, index) => ({ op: "connect", graphId: "main", edge: { from: nodes[index]!.id, to: node.id } })),
  ] });
}
async function waitFor(service: WorkflowService, id: string, predicate: (value: Status) => boolean, description: string): Promise<Status> {
  const deadline = Date.now() + 20_000;
  let latest: Status | undefined;
  while (Date.now() < deadline) {
    latest = await service.dispatch("run.status", { id }) as Status;
    if (predicate(latest)) return latest;
    if (["failed", "cancelled", "interrupted"].includes(latest.status)) throw new Error(`Unexpected terminal state waiting for ${description}: ${JSON.stringify(latest)}`);
    await sleep(40);
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(latest)}`);
}
async function cleanupRun(service: WorkflowService, id: string | undefined) {
  if (!id) return;
  await service.dispatch("run.cancel", { id });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const state = await service.dispatch("run.status", { id }) as Status;
    if (["succeeded", "failed", "cancelled"].includes(state.status) && !state.workersAlive) return;
    await sleep(40);
  }
  throw new Error("Service test could not drain run during cleanup");
}

test("shared service retains strict catalog and authoring API, frozen preparation and revision conflicts", async () => {
  const service = new WorkflowService(":memory:", { availableModels: [] });
  try {
    assert.ok(serviceToolNames.includes("run.pause"));
    const catalog = await service.dispatch("catalog.list", {}) as { name: string }[];
    assert.ok(catalog.some(role => role.name === "reviewer"));
    assert.equal((await service.dispatch("catalog.describe", { name: "reviewer" }) as { name: string }).name, "reviewer");
    assert.ok((await service.dispatch("workflow.schema", {}) as Record<string, unknown>).patch);
    const patched = await author(service) as { validation: { valid: boolean } };
    assert.equal(patched.validation.valid, true);
    assert.deepEqual(await service.dispatch("workflow.list", {}), [{ id: "sample", name: "Sample", revision: 2 }]);
    assert.deepEqual(await service.dispatch("workflow.validate", { id: "sample" }), { valid: true, issues: [] });
    const compiled = await service.dispatch("workflow.compile", { id: "sample" }) as { source: string; hash: string };
    const { plan } = await service.dispatch("workflow.prepare", { id: "sample" }) as PreparedExecution;
    assert.equal(compiled.source, plan.source);
    assert.equal(compiled.hash, plan.sourceHash);
    await assert.rejects(service.dispatch("workflow.patch", { id: "sample", expectedRevision: 1, operations: [{ op: "removeNode", graphId: "main", nodeId: "done" }] }), /Revision conflict/);
    assert.equal((await service.dispatch("workflow.inspect", { id: "sample" }) as { revision: number }).revision, 2);
    await assert.rejects(service.dispatch("run.start", { id: "sample" }), /persistent store/);
  } finally { service.close(); service.close(); }
  await assert.rejects(service.dispatch("catalog.list", {}), /closed/);
});
test("service rejects malformed or unknown requests before starting any run", async () => {
  const service = new WorkflowService(":memory:");
  try {
    await author(service);
    for (const [tool, request] of [
      ["catalog.list", { extra: true }], ["catalog.describe", { name: "constructor" }],
      ["workflow.inspect", { id: "sample", extra: true }], ["workflow.prepare", { id: "sample", cwd: 3 }],
      ["workflow.prepare", { id: "sample", model: { provider: "test", id: "test", typo: true } }],
      ["run.start", { id: "sample", input: undefined }], ["run.start", { id: "sample", input: { n: NaN } }],
      ["run.start", { id: "sample", cwd: "a\0b" }], ["run.start", { id: "sample", model: { provider: "test" } }],
      ["run.events", { id: "sample", after: -1 }], ["run.events", { id: "sample", after: "2" }],
      ["run.pause", { id: "sample", reason: "unsupported" }], ["run.status", { id: "../sample" }],
      ["run.list", null], ["not-a-tool", {}],
    ] as const) await assert.rejects(service.dispatch(tool, request));
  } finally { service.close(); }
});
test("workflow.prepare resolves explicit available model and default thinking without inference", async () => {
  const service = new WorkflowService(":memory:", { availableModels: [{ provider: "test", id: "plain", thinkingLevels: ["off"] }] });
  try {
    await author(service, [
      { id: "worker", kind: "agent", role: "general", task: { op: "literal", value: "Task" } }, pureNode,
    ]);
    const { plan } = await service.dispatch("workflow.prepare", { id: "sample", model: { provider: "test", id: "plain" } }) as PreparedExecution;
    assert.deepEqual(plan.agents.main!.worker!.model, { provider: "test", id: "plain" });
    assert.equal(plan.agents.main!.worker!.thinking, "off");
    await assert.rejects(service.dispatch("workflow.prepare", { id: "sample", model: { provider: "missing", id: "missing" } }), /Model unavailable/);
  } finally { service.close(); }
});
test("detached run completes after service closes, is inspectable from a new service and has cursor events", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dynamicwf-service-"));
  const filename = join(cwd, "state.sqlite");
  let service = new WorkflowService(filename, { cwd, availableModels: [] });
  let id: string | undefined;
  try {
    await author(service);
    const started = await service.dispatch("run.start", { id: "sample", input: { answer: 42 } }) as Status;
    id = started.id;
    assert.match(id, /^run-/);
    assert.match(started.planHash, /^[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(started, "plan"), false);
    assert.equal(Object.hasOwn(started, "ownerToken"), false);
    service.close();
    service = new WorkflowService(filename, { cwd, availableModels: [] });
    const finished = await waitFor(service, id, state => state.status === "succeeded", "completion");
    assert.deepEqual(finished.output, { answer: 42 });
    const list = await service.dispatch("run.list", {}) as Status[];
    assert.equal(list.length, 1); assert.equal(list[0]!.id, id);
    const inspect = await service.dispatch("run.inspect", { id }) as Status & { input: unknown; activations: { status: string }[] };
    assert.deepEqual(inspect.input, { answer: 42 });
    assert.equal(inspect.activations[0]!.status, "succeeded");
    assert.equal(Object.hasOwn(inspect.activations[0]!, "ownerToken"), false);
    const page = await service.dispatch("run.events", { id, after: 0 }) as { events: { seq: number; type: string; payload: unknown }[]; nextAfter: number };
    assert.ok(page.events.some(event => event.type === "run.succeeded"));
    assert.deepEqual(page.events.find(event => event.type === "run.reserved")!.payload, {});
    assert.deepEqual(await service.dispatch("run.events", { id, after: page.nextAfter }), { events: [], nextAfter: page.nextAfter });
    await assert.rejects(service.dispatch("run.events", { id: "run-missing" }), /not found/);
    assert.equal((await service.dispatch("run.pause", { id }) as Status).status, "succeeded");
    assert.equal((await service.dispatch("run.resume", { id }) as Status).status, "succeeded");
    assert.equal((await service.dispatch("run.cancel", { id }) as Status).status, "succeeded");
  } finally { await cleanupRun(service, id); service.close(); await rm(cwd, { recursive: true, force: true }); }
});
test("pause, resume and cancel are available through the shared service", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dynamicwf-service-control-"));
  const service = new WorkflowService(join(cwd, "state.sqlite"), { cwd, availableModels: [] });
  let id: string | undefined;
  try {
    // Pause immediately after spawn, before the first activation is admitted.
    await author(service, [{ id: "wait", kind: "check", command: process.execPath, args: ["-e", "setTimeout(()=>{}, 600)"] }, pureNode]);
    id = (await service.dispatch("run.start", { id: "sample", input: "done" }) as Status).id;
    await service.dispatch("run.pause", { id });
    const paused = await waitFor(service, id, state => state.status === "paused", "pause");
    assert.equal(paused.desired, "paused"); assert.equal(paused.workersAlive, 0);
    await service.dispatch("run.resume", { id });
    const finished = await waitFor(service, id, state => state.status === "succeeded", "resume completion");
    assert.equal(finished.output, "done");
    id = (await service.dispatch("run.start", { id: "sample" }) as Status).id;
    await service.dispatch("run.pause", { id });
    await waitFor(service, id, state => state.status === "paused", "second pause");
    await service.dispatch("run.cancel", { id });
    const cancelled = await waitFor(service, id, state => state.status === "cancelled", "cancellation");
    assert.equal(cancelled.desired, "cancelled");
  } finally { await cleanupRun(service, id); service.close(); await rm(cwd, { recursive: true, force: true }); }
});
test("public inspection and events exclude stored process ownership tokens", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dynamicwf-service-public-"));
  const filename = join(cwd, "state.sqlite");
  const service = new WorkflowService(filename, { cwd });
  const store = new RunStore(filename);
  try {
    await author(service);
    const { plan } = await service.dispatch("workflow.prepare", { id: "sample" }) as PreparedExecution;
    store.create({ id: "run-redaction", plan, input: null, cwd });
    const { token } = store.reserveLaunch("run-redaction");
    const activation = store.beginActivation("run-redaction", token, { scope: ["graph", "main"], graphId: "main", nodeId: "done", visit: 1 }, { kind: "end", sideEffect: false });
    store.setActivationMetadata("run-redaction", token, activation.key, { workerToken: "private-process-fence", workerPid: null, workerKind: "check" });
    store.completeActivation("run-redaction", token, activation.key, null);
    store.finish("run-redaction", token, { status: "succeeded", output: null });
    const inspect = JSON.stringify(await service.dispatch("run.inspect", { id: "run-redaction" }));
    const events = JSON.stringify(await service.dispatch("run.events", { id: "run-redaction" }));
    assert.equal(inspect.includes(token), false); assert.equal(events.includes(token), false);
    assert.equal(inspect.includes("private-process-fence"), false); assert.equal(events.includes("private-process-fence"), false);
  } finally { store.close(); service.close(); await rm(cwd, { recursive: true, force: true }); }
});

test("closing during prepare prevents reopening lazy stores", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-close-"));
  const filename = join(directory, "state.sqlite");
  const initial = new WorkflowService(filename, { cwd: directory, availableModels: [] });
  await author(initial); initial.close();
  const service = new WorkflowService(filename, { cwd: directory, availableModels: [] });
  try {
    const pending = service.dispatch("workflow.prepare", { id: "sample" });
    service.close();
    await assert.rejects(pending, /service is closed/);
    assert.equal((service as any).drafts, undefined);
    assert.equal((service as any).plans, undefined);
  } finally { service.close(); await rm(directory, { recursive: true, force: true }); }
});
