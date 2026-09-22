import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderRun, renderRunSummary, terminalText } from "../src/terminal.js";
import { RunStore, activationKey, type ActivationRecord, type RunRecord } from "../src/run-store.js";
import type { ExecutionPlan } from "../src/execution-types.js";
import type { WorkflowDefinition } from "../src/graph.js";

function run(): RunRecord {
  const workflow: WorkflowDefinition = { schemaVersion: 1, id: "review", name: "Review pipeline", revision: 3, entryGraph: "main", graphs: {
    main: { entry: "review", nodes: [
      { id: "review", kind: "agent", role: "reviewer", task: { op: "literal", value: "Inspect" } },
      { id: "map", kind: "map", graphId: "child", items: { op: "ref", path: ["input"] } },
      { id: "done", kind: "end", value: { op: "literal", value: true } },
    ], edges: [{ from: "review", to: "review", when: { op: "literal", value: false } }, { from: "review", to: "map" }, { from: "map", to: "done" }] },
    child: { entry: "check", nodes: [{ id: "check", kind: "check", command: "true", args: [] },
      { id: "done", kind: "end", value: { op: "ref", path: ["input"] } }], edges: [{ from: "check", to: "done" }] },
  } };
  const plan: ExecutionPlan = { version: 1, runtimeVersion: "dynamicwf-runtime-v1", compilerVersion: "test", workflow, source: "", sourceHash: "test", agents: {}, hash: "test" };
  return { id: "run-example", plan, input: null, cwd: "/tmp", status: "running", desired: "running", ownerToken: "owner", supervisorPid: 123, createdAt: 1, updatedAt: 1, heartbeatAt: 1 };
}
function activation(nodeId: string, status: ActivationRecord["status"], graphId = "main", visit = 0): ActivationRecord {
  const context = { graphId, nodeId, scope: ["root", `item-${visit}`], visit };
  return { runId: "run-example", key: activationKey(context), context, kind: nodeId === "map" ? "map" : nodeId === "review" ? "agent" : "check",
    sideEffect: nodeId !== "map", status, attempt: 1, ownerToken: "owner", startedAt: 1, finishedAt: status === "running" ? null : 2, metadata: {} };
}

const responseSchema = { type: "object", properties: { answer: { type: "boolean" } }, required: ["answer"], additionalProperties: false };
function waitRun(): RunRecord {
  const record = run();
  record.plan.workflow.graphs = { main: { entry: "answer", nodes: [
    { id: "answer", kind: "await", reason: { op: "literal", value: "Нужен ответ" }, input: { op: "literal", value: null }, responseSchema },
    { id: "done", kind: "end", value: { op: "ref", path: ["input"] } },
  ], edges: [{ from: "answer", to: "done" }] } };
  return record;
}

const answerRow = (text: string) => text.split("\n").find(line => line.startsWith("│ answer [await]"))!;

test("ответ на паузе виден в графе и сводке до фактического завершения await", () => {
  const store = new RunStore(":memory:");
  try {
    const record = waitRun();
    store.create({ id: record.id, plan: record.plan, input: null, cwd: record.cwd });
    const { token } = store.reserveLaunch(record.id);
    const active = store.beginActivation(record.id, token, { graphId: "main", nodeId: "answer", scope: ["root"], visit: 0 }, { kind: "await", sideEffect: false });
    const wait = store.openWait(record.id, token, active.key, "Нужен ответ", null, responseSchema);
    assert.match(answerRow(renderRun(store.get(record.id), store.listActivations(record.id))), /\? waiting/);
    store.requestControl(record.id, "pause");
    store.markPaused(record.id, token);
    store.resolveWait(record.id, wait.id, { answer: true }, "terminal-test");
    const saved = store.getActivation(record.id, active.key)!;
    assert.equal(saved.status, "running");
    assert.equal(saved.metadata.waitResolved, true);
    assert.equal(store.completed(record.id, active.key), undefined);
    const snapshot = () => ({ run: store.get(record.id), activations: store.listActivations(record.id), events: store.events(record.id) });
    const before = snapshot();
    const text = renderRun(before.run, before.activations);
    assert.match(answerRow(text), /Ответ сохранён · ожидает продолжения/);
    assert.doesNotMatch(answerRow(text), /succeeded|running|waiting/);
    assert.doesNotMatch(text, /Wait |Paused structural activations:/);
    const summary = renderRunSummary(before.run, before.activations);
    assert.match(summary, /paused · 0 succeeded · 0 running/);
    assert.match(summary, /Ответ сохранён · ожидает продолжения: 1/);
    assert.doesNotMatch(summary, / · active /);
    assert.deepEqual(snapshot(), before, "наблюдение не завершает await и не меняет журнал");
    store.requestControl(record.id, "resume");
    assert.match(answerRow(renderRun(store.get(record.id), store.listActivations(record.id))), /Ответ сохранён · ожидает продолжения/);
    store.completeActivation(record.id, token, active.key, { answer: true });
    assert.match(answerRow(renderRun(store.get(record.id), store.listActivations(record.id))), /✓ succeeded/);
    assert.doesNotMatch(renderRunSummary(store.get(record.id), store.listActivations(record.id)), /Ответ сохранён/);
  } finally { store.close(); }
});

test("смешанные посещения сохраняют ответ и приоритет действительно работающих и ожидающих узлов", () => {
  const answered = { ...activation("answer", "running"), kind: "await", metadata: { waiting: true, waitResolved: true } };
  const completed = { ...activation("answer", "succeeded", "main", 1), kind: "await" };
  const failed = { ...activation("answer", "failed", "main", 2), kind: "await", metadata: { waitResolved: true } };
  const interrupted = { ...activation("answer", "interrupted", "main", 3), kind: "await", metadata: { waitResolved: true } };
  const waiting = { ...activation("answer", "running", "main", 4), kind: "await", metadata: { waiting: true } };
  const running = { ...activation("answer", "running", "main", 5), kind: "await" };
  const previous = [completed, failed, interrupted];
  for (const [records, expected] of [
    [[answered, ...previous], /Ответ сохранён · ожидает продолжения/],
    [[answered, ...previous, waiting], /\? waiting/],
    [[answered, ...previous, waiting, running], /▶ running/],
    [[failed], /× failed/],
    [[interrupted], /! interrupted/],
  ] as const) {
    for (const ordered of [records, [...records].reverse()]) {
      assert.match(answerRow(renderRun(waitRun(), ordered)), expected);
    }
  }
  const summary = renderRunSummary(waitRun(), [answered, ...previous]);
  assert.match(summary, /1 succeeded · 0 running/);
  assert.match(summary, /Ответ сохранён · ожидает продолжения: 1/);
  assert.match(summary, /1 failed · 1 interrupted \(4 recorded activations\)/);
});

test("terminal diagram contains every graph, explicit loop/conditional edges, node states and concrete activation scope", () => {
  const records = [activation("review", "succeeded"), activation("map", "running"),
    activation("check", "succeeded", "child", 0), activation("check", "running", "child", 1)];
  const text = renderRun(run(), records);
  assert.match(text, /Review pipeline · review revision 3/);
  assert.match(text, /Graph main · entry review/);
  assert.match(text, /Graph child · entry check/);
  assert.match(text, /review ──\[if\]▶ review/);
  assert.match(text, /review ──▶ map/);
  assert.match(text, /map \[map\]  ▶ running/);
  assert.match(text, /done \[end\]  ○ not visited/);
  assert.match(text, /↳ graph child · dynamic items · concurrency unbounded/);
  assert.match(text, /child\.check scope=\["root","item-1"\] visit=1/);
  assert.match(text, /2 succeeded · 2 running · 0 failed · 0 interrupted \(4 recorded activations\)/);
  assert.doesNotMatch(text, /%|percent/i);
});

test("multiple visits aggregate without confusing completed visits with future graph progress", () => {
  const records = [activation("review", "succeeded"), activation("review", "failed", "main", 1), activation("review", "interrupted", "main", 2)];
  const text = renderRun(run(), records);
  assert.match(text, /review \[agent:reviewer\]  ! interrupted · 1\/3 recorded visits succeeded/);
  assert.match(text, /1 succeeded · 0 running · 1 failed · 1 interrupted/);
  assert.equal(renderRun(run(), [] as ActivationRecord[]).includes("0 recorded activations"), true);
});

test("paused structural rows are labelled explicitly and summary ignores heartbeat-only changes", () => {
  const record = { ...run(), status: "paused" as const, desired: "paused" as const };
  const activations = [activation("map", "running")];
  assert.match(renderRun(record, activations), /Paused structural activations:/);
  assert.match(renderRunSummary(record, activations), /run-example: paused/);
  assert.equal(renderRunSummary(record, activations), renderRunSummary({ ...record, heartbeatAt: 500, updatedAt: 500 }, activations));
  assert.notEqual(renderRunSummary(record, activations), renderRunSummary({ ...record, status: "running", desired: "running" }, activations));
});

test("workflow text, scopes and errors cannot inject ANSI, control rows or bidirectional terminal commands", () => {
  const record = run();
  record.plan.workflow.name = "unsafe\u001b[2J\n\r\t\u0007\u009b31m\u202ereversed\u2066hidden";
  record.error = "failure\u001b]52;c;secret\u0007\nspoofed row";
  const item = activation("review", "running");
  item.context = { ...item.context, scope: ["\u001b[H\u009b0m\u202e\n"] };
  const text = renderRun(record, [item]);
  const summary = renderRunSummary(record, [item]);
  for (const output of [text, summary]) {
    assert.doesNotMatch(output, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u);
    assert.ok(!output.includes("\nspoofed row"));
  }
  assert.match(text, /unsafe\\u001b\[2J\\u000a\\u000d\\u0009\\u0007/);
  assert.match(text, /\\u202e/);
  assert.equal(terminalText("\u001b[31mhello"), "\\u001b[31mhello");
  assert.equal(terminalText("abcdefghij", 6), "abcde…");
});

test("non-TTY summary limits active identities while preserving the complete recorded counts", () => {
  const active = Array.from({ length: 6 }, (_, i) => activation("check", "running", "child", i));
  const summary = renderRunSummary(run(), active);
  assert.match(summary, /6 running/);
  assert.match(summary, /… 2 more/);
  assert.equal(summary.split("\n").length, 1);
  assert.match(renderRun(run(), active), /visit=5/);
});

test("watch once renders a compact snapshot and Ctrl-C detaches without workflow mutations", { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-watch-"));
  const filename = join(directory, "state.sqlite");
  const store = new RunStore(filename);
  const record = run();
  store.create({ id: record.id, plan: record.plan, input: null, cwd: directory });
  const original = store.get(record.id);
  const initialEvents = store.events(record.id);
  const children: ReturnType<typeof spawn>[] = [];
  const invoke = (once: boolean): Promise<string> => new Promise((resolveOutput, reject) => {
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), resolve("src/watch.ts"), "--store", filename, "--run", record.id, ...(once ? ["--once"] : [])], { stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let output = "", stderr = "", interrupted = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.stdout!.setEncoding("utf8").on("data", (data: string) => {
      output += data;
      if (!once && !interrupted) { interrupted = true; child.kill("SIGINT"); }
    });
    child.stderr!.setEncoding("utf8").on("data", (data: string) => { stderr += data; });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => {
      clearTimeout(timer);
      if (code === 0) resolveOutput(output); else reject(new Error(`watch exited ${code}: ${stderr}`));
    });
  });
  try {
    const graph = await invoke(true);
    assert.match(graph, /DYNAMICWF/);
    assert.match(graph, /СЕЙЧАС/);
    assert.doesNotMatch(graph, /\u001b/u);
    const summary = await invoke(false);
    assert.match(summary, /run-example/);
    assert.match(summary, /Run: ОЖИДАНИЕ/);
    assert.doesNotMatch(summary, /Graph main|\u001b/u);
    assert.deepEqual(store.get(record.id), original);
    assert.deepEqual(store.events(record.id), initialEvents);
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
