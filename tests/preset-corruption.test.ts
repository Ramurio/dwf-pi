import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { PresetLibrary } from "../src/presets.js";
import { WorkflowService } from "../src/service.js";

test("corrupt revisions are isolated, explicit hashes run, project names never fall back", { timeout: 45000 }, async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "preset-corruption-")));
  const cwd = join(dir, "project");
  await mkdir(join(cwd, ".git"), { recursive: true });
  const service = new WorkflowService(join(dir, "global", "state.sqlite"), { cwd });
  const project = new PresetLibrary(join(cwd, ".dynamicwf", "presets"));
  const global = new PresetLibrary(join(dir, "global", "presets"));
  try {
    const plan = await prepareExecutionPlan({ schemaVersion: 1, id: "clean", name: "Clean", revision: 1, entryGraph: "main", graphs: {
      main: { entry: "done", nodes: [{ id: "done", kind: "finish", decision: "accepted", reason: { op: "literal", value: "ok" }, evidence: { op: "literal", value: [] }, value: { op: "ref", path: ["input"] } }], edges: [] },
    } }, { cwd });
    const put = async (library: PresetLibrary, name: string, revision = plan.hash, data?: string) => {
      await mkdir(join(library.root, name), { recursive: true });
      await writeFile(join(library.root, name, `${revision}.json`), data ?? JSON.stringify({ version: 1, name, revision, savedAt: 100, plan }));
    };
    await put(project, "mixed");
    await put(project, "mixed", "a".repeat(64), '{"savedAt":1, PRIVATE');
    await put(project, "mixed", "b".repeat(64), '{"savedAt":999999, PRIVATE');
    await put(project, "broken", "c".repeat(64), "PRIVATE invalid JSON");
    await put(project, "other");
    await put(project, "mismatch", "d".repeat(64));
    await put(global, "broken");
    await put(global, "mixed");
    await symlink(join(project.root, "other", `${plan.hash}.json`), join(project.root, "mixed", `${"e".repeat(64)}.json`));
    await symlink(join(project.root, "other"), join(project.root, "linked"));
    const scan = await project.scan("mixed");
    assert.equal(scan.records.length, 1);
    assert.equal(scan.diagnostics.length, 3);
    assert.doesNotMatch(JSON.stringify(scan.diagnostics), /PRIVATE/);
    assert.equal((await project.scan("mismatch")).diagnostics[0]?.reason, "Preset revision and execution plan hash differ");
    assert.equal((await project.scan("linked")).diagnostics.length, 1);
    await assert.rejects(project.read("mixed"), /explicit revision hash/);
    await assert.rejects(project.read("mixed", "e".repeat(64)), /real JSON file/);
    await assert.rejects(project.read("mismatch", "d".repeat(64)), /hash differ/);
    const listed = await service.dispatch("preset.list") as { name: string; kind?: string; latest?: boolean; scope: string; directory: string; shadowed: boolean; revision: string }[];
    assert.ok(listed.some(x => x.name === "other" && !x.kind));
    assert.ok(listed.some(x => x.name === "mixed" && x.scope === "project" && !x.kind && x.latest === false && !x.shadowed));
    assert.ok(listed.filter(x => x.kind).every(x => x.directory === project.root && x.scope === "project"));
    assert.ok(listed.some(x => x.name === "broken" && x.scope === "global" && x.shadowed));
    for (const tool of ["preset.inspect", "preset.run"]) {
      await assert.rejects(service.dispatch(tool, { name: "mixed" }), /explicit revision hash/);
      await assert.rejects(service.dispatch(tool, { name: "broken", revision: plan.hash }));
      await assert.rejects(service.dispatch(tool, { name: "broken" }), /explicit revision hash/);
    }
    const inspected = await service.dispatch("preset.inspect", { name: "mixed", revision: plan.hash }) as { revision: string };
    assert.equal(inspected.revision, plan.hash);
    const run = await service.dispatch("preset.run", { name: "mixed", revision: plan.hash, input: "clean input" }) as { id: string };
    const deadline = Date.now() + 20000;
    while (true) {
      const state = await service.dispatch("run.status", { id: run.id }) as { status: string; output: unknown };
      if (state.status === "succeeded") { assert.equal(state.output, "clean input"); break; }
      assert.ok(!["failed", "cancelled"].includes(state.status));
      assert.ok(Date.now() < deadline, "run timeout");
      await sleep(25);
    }
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});
