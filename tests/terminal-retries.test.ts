import assert from "node:assert/strict";
import test from "node:test";
import { renderRun, renderRunSummary, terminalText } from "../src/terminal.js";
import { RunStore, activationKey, type ActivationRecord, type RunRecord } from "../src/run-store.js";
import { projectRun } from "../src/observation.js";
import { executionFailure } from "../src/execution-failure.js";
import type { RetryProgress } from "../src/retry-policy.js";

function run(): RunRecord {
  return { id: "retry-run", input: null, cwd: "/tmp", status: "running", desired: "running", createdAt: 1, updatedAt: 1, ownerToken: "owner", supervisorPid: null, heartbeatAt: null,
    plan: { version: 1, runtimeVersion: "dynamicwf-runtime-v1", compilerVersion: "test", source: "", sourceHash: "test", agents: {}, hash: "test",
      workflow: { schemaVersion: 1, id: "retry", name: "Retry", revision: 1, entryGraph: "main", graphs: {
        main: { entry: "work", nodes: [{ id: "work", kind: "check", command: "unused", args: [], retryPolicy: { codes: ["process"], delayMs: Number.MAX_SAFE_INTEGER } }], edges: [] },
      } } } };
}
const retry = (changes: Partial<RetryProgress> = {}): RetryProgress => ({ decisionSeq: 1, attempt: 2, nextAttempt: 3, scheduledAt: 10, delayMs: 9000, dueAt: 9010, status: "scheduled", ...changes });
function activation(scope = "root", graphId = "main", visit = 0): ActivationRecord {
  const context = { graphId, nodeId: "work", scope: [scope], visit };
  return { runId: "retry-run", key: activationKey(context), context, kind: "check", sideEffect: true, status: "failed", attempt: 2,
    ownerToken: "owner", startedAt: 1, finishedAt: 2, metadata: { retry: retry() } };
}
const rows = (text: string) => text.split("\n").filter(line => line.startsWith("  ↻ "));

test("all current retry identities are shown once, outside graphs and running attempts", () => {
  const records = [activation("a"), activation("b"), activation("a", "other"), activation("a", "main", 1), activation("c"), activation("d")];
  const active = { ...activation("active"), status: "running" as const, metadata: {} };
  const text = renderRun(run(), [...records, active]);
  assert.equal(rows(text).length, 6);
  for (const record of records) {
    const c = record.context;
    assert.equal(rows(text).filter(line => line.includes(`graph=${JSON.stringify(c.graphId)} node="work" scope=${JSON.stringify(c.scope)} visit=${c.visit} · attempt 2 → 3 · delayMs=9000 ms · dueAt=9010 Unix ms`)).length, 1);
  }
  assert.match(text, /1 running · 6 retrying/);
  const running = text.split("Running activations:")[1]!.split("Pending retries")[0]!;
  assert.match(running, /scope=\["active"\]/);
  assert.equal(running.split("\n").filter(line => line.startsWith("  ▶")).length, 1);
});

for (const dueAt of [null, 0, Number.MAX_SAFE_INTEGER]) for (const delayMs of [0, Number.MAX_SAFE_INTEGER]) {
  test(`saved deadline ${dueAt} and delay ${delayMs} are not recomputed`, () => {
    const record = activation(); record.metadata.retry = retry({ dueAt, delayMs });
    const text = renderRun(run(), [record]);
    assert.ok(text.includes(`delayMs=${delayMs} ms · dueAt=${dueAt}${dueAt === null ? "" : " Unix ms"}`));
    assert.equal(rows(text).length, 1);
    assert.doesNotMatch(text, /NaN|Invalid Date|1970/);
  });
}

for (const [name, metadata] of Object.entries({ missing: {}, malformed: { retry: { status: "scheduled" } }, admitted: { retry: retry({ status: "admitted" }) }, abandoned: { retry: retry({ status: "abandoned" }) }, transition: { retry: retry({ nextAttempt: 4 }) }, staleAttempt: { retry: retry({ attempt: 1, nextAttempt: 2 }) } })) {
  test(`${name} metadata is not pending`, () => {
    const record = { ...activation(), metadata };
    const text = renderRun(run(), [record]);
    assert.doesNotMatch(text, /Pending retries|retrying|→/);
    assert.match(text, /work \[check\]  × failed/);
  });
}
for (const status of ["running", "succeeded", "interrupted"] as const) {
  test(`${status} activation is not pending`, () => {
    assert.doesNotMatch(renderRun(run(), [{ ...activation(), status }]), /Pending retries|retrying|→/);
  });
}
for (const status of ["succeeded", "failed", "cancelled"] as const) {
  test(`terminal ${status} ignores stale scheduled metadata and stale presentation`, () => {
    const records = [activation()], record = { ...run(), status };
    const text = renderRun(record, records, projectRun(run(), records));
    assert.doesNotMatch(text, /Pending retries|retrying|→/);
    assert.match(text, /work \[check\]  × failed/);
    assert.match(renderRunSummary(record, records), /0 running · 1 failed/);
    assert.doesNotMatch(renderRunSummary(record, records), /retrying/);
  });
}
for (const status of ["paused", "interrupted"] as const) {
  test(`${status} retains saved decisions without claiming running attempts`, () => {
    const text = renderRun({ ...run(), status }, [activation()]);
    assert.match(text, /Pending retries \(scheduled, not running\):/);
    assert.match(text, /0 running · 1 retrying/);
    assert.doesNotMatch(text, /Running activations:/);
  });
}
function freeze(value: unknown): void {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
}
test("complete escaped identities remain distinct and frozen snapshots render deterministically", () => {
  const hostile = "\u001b[2J\n\r\u009b\u202e\u2066";
  const records = [activation("x".repeat(2200) + "a" + hostile, hostile), activation("x".repeat(2200) + "b" + hostile, hostile)];
  for (const record of records) { record.context = { ...record.context, nodeId: hostile }; record.key = activationKey(record.context); }
  const record = run(), before = structuredClone({ record, records });
  freeze(record); freeze(records);
  const text = renderRun(record, records);
  assert.equal(renderRun(record, records), text);
  assert.deepEqual({ record, records }, before);
  const details = rows(text);
  assert.equal(details.length, 2); assert.notEqual(details[0], details[1]);
  for (const item of records) {
    assert.ok(text.includes(terminalText(JSON.stringify(item.context.scope), Infinity)));
    assert.ok(text.includes(`graph=${terminalText(JSON.stringify(hostile), Infinity)} node=${terminalText(JSON.stringify(hostile), Infinity)}`));
  }
  assert.doesNotMatch(text, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u);
});

test("render leaves an isolated journal's run, activations, events and retry records unchanged", () => {
  const store = new RunStore(":memory:");
  try {
    const record = run();
    store.create({ id: record.id, plan: record.plan, input: null, cwd: record.cwd });
    const launch = store.reserveLaunch(record.id);
    const a = store.beginActivation(record.id, launch.token, activation().context, { kind: "check", sideEffect: true });
    store.failActivation(record.id, launch.token, a.key, "Not admitted", executionFailure("process", "setup", "not-started", "Not admitted").failure, { retryEligible: true });
    const snapshot = () => ({ run: store.get(record.id), activations: store.listActivations(record.id), events: store.events(record.id), retries: store.retries(record.id, a.key) });
    const before = snapshot(); freeze(before);
    const text = renderRun(before.run, before.activations);
    assert.equal(rows(text).length, 1); assert.match(text, /dueAt=null/);
    assert.equal(renderRun(before.run, before.activations), text);
    assert.deepEqual(snapshot(), before);
  } finally { store.close(); }
});
