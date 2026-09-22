import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import type { WorkflowDefinition } from "../src/graph.js";
import { PresetLibrary, type PresetRecord } from "../src/presets.js";
import { RunStore } from "../src/run-store.js";
import { WorkflowService } from "../src/service.js";

const workflow: WorkflowDefinition = { schemaVersion: 1, id: "echo", name: "Echo input", revision: 1, entryGraph: "main", graphs: {
  main: { entry: "done", nodes: [{ id: "done", kind: "finish", decision: "accepted", reason: { op: "literal", value: "Echo input preserved" }, evidence: { op: "literal", value: [] }, value: { op: "ref", path: ["input"] } }], edges: [] },
} };
async function fixture(work: (directory: string, store: RunStore, library: PresetLibrary) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "dwf-presets-"));
  const store = new RunStore(join(directory, "state.sqlite"));
  try { await work(directory, store, new PresetLibrary(join(directory, "presets"))); }
  finally { store.close(); await rm(directory, { force: true, recursive: true }); }
}
async function savedRun(store: RunStore, directory: string, id: string, value = workflow) {
  store.create({ id, plan: await prepareExecutionPlan(value, { cwd: directory }), cwd: directory, input: "PRIVATE_RUN_INPUT" });
  const { token } = store.reserveLaunch(id);
  store.finish(id, token, { status: "succeeded", output: { accepted: true, result: "PRIVATE_RUN_OUTPUT" } });
  return store.get(id);
}

async function putPreset(library: PresetLibrary, name: string, plan: PresetRecord["plan"], savedAt: number): Promise<PresetRecord> {
  assert.ok(Number.isSafeInteger(savedAt) && savedAt > 0);
  const record: PresetRecord = { version: 1, name, revision: plan.hash, savedAt, plan };
  await mkdir(join(library.root, name), { recursive: true });
  await writeFile(join(library.root, name, `${plan.hash}.json`), JSON.stringify(record));
  return record;
}

test("presets atomically save immutable plans, deduplicate concurrent saves and exclude run data", async () => {
  await fixture(async (directory, store, library) => {
    const run = await savedRun(store, directory, "test-run");
    const copies = await Promise.all(Array.from({ length: 12 }, () => library.save("tested", run)));
    assert.ok(copies.every(record => record.savedAt === copies[0]!.savedAt && record.revision === run.plan.hash));
    assert.deepEqual(await readdir(join(library.root, "tested")), [`${run.plan.hash}.json`]);
    const json = await readFile(join(library.root, "tested", `${run.plan.hash}.json`), "utf8");
    assert.equal(JSON.parse(json).savedAt, copies[0]!.savedAt);
    assert.doesNotMatch(json, /PRIVATE_RUN_INPUT|PRIVATE_RUN_OUTPUT|ownerToken|supervisorPid|sessionFile/);
    assert.deepEqual((await library.read("tested")).plan, run.plan);
    assert.equal((await library.list()).length, 1);
    await assert.rejects(library.save("untested", { ...run, status: "running" }), /successful run/);
  });
});

test("preset revisions remain addressable and tampered content fails verification", async () => {
  await fixture(async (directory, store, library) => {
    const first = await putPreset(library, "tested", await prepareExecutionPlan(workflow, { cwd: directory }), 100);
    const modified = { ...workflow, name: "Echo changed", revision: 2 };
    const second = await putPreset(library, "tested", await prepareExecutionPlan(modified, { cwd: directory }), 200);
    assert.notEqual(second.revision, first.revision);
    assert.equal((await library.read("tested")).revision, second.revision);
    assert.equal((await library.read("tested", first.revision)).plan.workflow.name, "Echo input");
    const path = join(library.root, "tested", `${second.revision}.json`);
    const data = JSON.parse(await readFile(path, "utf8"));
    data.plan.source += "\nthrow Error('tampered');";
    await writeFile(path, JSON.stringify(data));
    await assert.rejects(library.read("tested"), /compiled source/);
    assert.deepEqual(await library.read("tested", first.revision), first);
  });
});

test("preset save preserves an existing first timestamp", async () => {
  await fixture(async (directory, store, library) => {
    const run = await savedRun(store, directory, "run");
    const first = await putPreset(library, "tested", run.plan, 100);
    const path = join(library.root, "tested", `${run.plan.hash}.json`);
    const json = await readFile(path, "utf8");
    assert.deepEqual(await library.save("tested", run), first);
    assert.deepEqual(await library.read("tested"), first);
    assert.equal(await readFile(path, "utf8"), json);
    assert.deepEqual(await readdir(join(library.root, "tested")), [`${run.plan.hash}.json`]);
  });
});

test("historical reuse presets stay readable but cannot silently replay old results", async () => {
  await fixture(async (directory, store, library) => {
    const value: WorkflowDefinition = { ...workflow, graphs: {
      main: { entry: "prior", nodes: [
        { id: "prior", kind: "reuse", bindingId: "previous", outputSchema: { type: "object" } },
        workflow.graphs.main!.nodes[0]!,
      ], edges: [{ from: "prior", to: "done" }] },
    } };
    const plan = await prepareExecutionPlan(value, { cwd: directory });
    // Имитируем уже существующий файл старой версии библиотеки, а не новый save.
    const legacy = await putPreset(library, "legacy", plan, 100);
    const path = join(library.root, "legacy", `${plan.hash}.json`);
    const original = await readFile(path, "utf8");
    assert.deepEqual(await library.read("legacy"), legacy);
    assert.deepEqual(await library.list(), [legacy]);
    assert.throws(() => store.create({ id: "replay", plan, cwd: directory, input: null }), /continuation receipt/);
    assert.equal(await readFile(path, "utf8"), original);
  });
});

test("preset latest follows savedAt then revision regardless of insertion order", async () => {
  await fixture(async (directory) => {
    const plans = await Promise.all([1, 2, 3].map(revision =>
      prepareExecutionPlan({ ...workflow, revision }, { cwd: directory })));
    plans.sort((a, b) => a.hash.localeCompare(b.hash));
    assert.equal(new Set(plans.map(plan => plan.hash)).size, 3);
    const [a, b, c] = plans as [PresetRecord["plan"], PresetRecord["plan"], PresetRecord["plan"]];
    const orders = [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
    // Oppose filename order with chronology; do not assume any raw readdir order.
    for (const scenario of [
      { label: "chronology", timestamps: [300, 200, 100], expected: [c, b, a] },
      { label: "tie", timestamps: [200, 200, 100], expected: [c, a, b] },
    ]) {
      const timestamps = new Map(plans.map((plan, index) => [plan.hash, scenario.timestamps[index]!]));
      for (const [index, order] of orders.entries()) {
        const library = new PresetLibrary(join(directory, `${scenario.label}-${index}`));
        for (const plan of order) await putPreset(library, "tested", plan, timestamps.get(plan.hash)!);
        const expected: PresetRecord[] = scenario.expected.map(plan => ({
          version: 1, name: "tested", revision: plan.hash, savedAt: timestamps.get(plan.hash)!, plan,
        }));
        const scan = await library.scan("tested");
        assert.deepEqual(scan.diagnostics, []);
        assert.deepEqual(scan.records, expected);
        assert.deepEqual(await library.versions("tested"), expected);
        assert.deepEqual(await library.read("tested"), expected.at(-1));
        assert.deepEqual(await library.list(), [expected.at(-1)]);
        for (const record of expected) assert.deepEqual(await library.read("tested", record.revision), record);
      }
    }
  });
});

test("preset paths reject traversal and symbolic-link revision files/directories", async () => {
  await fixture(async (directory, store, library) => {
    const run = await savedRun(store, directory, "run");
    for (const name of ["../outside", "/absolute", "a/b", ".", "x\0z"]) await assert.rejects(library.save(name, run), /preset name/);
    await assert.rejects(library.read("tested", "../invalid"), /revision hash/);
    await mkdir(library.root);
    await symlink(directory, join(library.root, "linked"));
    await assert.rejects(library.save("linked", run), /real directory/);
    await rm(join(library.root, "linked"));
    const saved = await library.save("tested", run);
    const path = join(library.root, "tested", `${saved.revision}.json`);
    await rm(path); await symlink(join(directory, "state.sqlite"), path);
    await assert.rejects(library.read("tested"), /real JSON file/);
  });
});

test("service saves project/global libraries, project shadows global, reruns frozen plan with new input", { timeout: 45_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dwf-preset-service-"));
  const cwd = join(directory, "project");
  const nested = join(cwd, "subdirectory");
  await mkdir(join(cwd, ".git"), { recursive: true }); await mkdir(nested);
  const filename = join(directory, "global", "state.sqlite");
  const service = new WorkflowService(filename, { cwd: nested });
  const runs: string[] = [];
  const wait = async (id: string) => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const current = await service.dispatch("run.status", { id }) as { status: string; output: unknown };
      if (current.status === "succeeded") return current;
      assert.notEqual(current.status, "failed"); await sleep(25);
    }
    throw new Error("Preset test run timed out");
  };
  try {
    await service.dispatch("workflow.create", { id: "echo", name: "Echo input" });
    await service.dispatch("workflow.patch", { id: "echo", expectedRevision: 1, operations: [{ op: "addNode", graphId: "main", node: workflow.graphs.main!.nodes[0] }] });
    const first = await service.dispatch("run.start", { id: "echo", input: { initial: true } }) as { id: string; planHash: string };
    runs.push(first.id); await wait(first.id);
    await service.dispatch("preset.save", { id: first.id, name: "echo", scope: "global" });
    const saved = await service.dispatch("preset.save", { id: first.id, name: "echo" }) as { directory: string };
    assert.equal(saved.directory, join(await realpath(cwd), ".dynamicwf", "presets"));
    const listed = await service.dispatch("preset.list") as { scope: string; shadowed: boolean }[];
    assert.deepEqual(listed.map(x => [x.scope, x.shadowed]), [["project", false], ["global", true]]);
    // Editing the author's draft does not mutate the successful preset.
    await service.dispatch("workflow.patch", { id: "echo", expectedRevision: 2, operations: [{ op: "replaceNode", graphId: "main", node: { id: "done", kind: "end", value: { op: "literal", value: "different draft" } } }] });
    const next = await service.dispatch("preset.run", { name: "echo", input: { next: 42 } }) as { id: string; planHash: string; preset: { scope: string } };
    runs.push(next.id);
    assert.notEqual(first.id, next.id); assert.equal(next.planHash, first.planHash); assert.equal(next.preset.scope, "project");
    assert.deepEqual((await wait(next.id)).output, { next: 42 });
    await assert.rejects(service.dispatch("preset.inspect", { name: "echo", scope: "elsewhere" }), /scope/);
    await assert.rejects(service.dispatch("preset.run", { name: "echo", model: "mutable override" }), /Unexpected/);
  } finally {
    for (const id of runs) {
      await service.dispatch("run.cancel", { id }).catch(() => {});
      for (let i = 0; i < 100; i++) {
        const state = await service.dispatch("run.status", { id }) as { status: string };
        if (["succeeded", "failed", "cancelled"].includes(state.status)) break;
        await sleep(50);
      }
    }
    service.close(); await rm(directory, { recursive: true, force: true });
  }
});
