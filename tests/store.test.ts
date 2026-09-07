import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DraftStore } from "../src/store.js";
import { spawn } from "node:child_process";

test("drafts persist across connections and stale editors cannot overwrite a newer revision", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-store-"));
  const filename = join(directory, "state.sqlite");
  const first = new DraftStore(filename);
  const second = new DraftStore(filename);
  try {
    first.create({ id: "review", name: "Review workflow" });
    assert.equal(second.get("review").revision, 1);
    const result = first.patch("review", { expectedRevision: 1, operations: [
      { op: "addNode", graphId: "main", node: { id: "done", kind: "end", value: { op: "literal", value: "finished" } } },
    ] });
    assert.equal(result.workflow.revision, 2);
    assert.equal(result.validation.valid, true);
    assert.throws(() => second.patch("review", { expectedRevision: 1, operations: [
      { op: "removeNode", graphId: "main", nodeId: "done" },
    ] }), /revision/i);
    assert.deepEqual(second.list(), [{ id: "review", name: "Review workflow", revision: 2 }]);
    assert.throws(() => first.create({ id: "review", name: "Overwrite" }), /already exists/);
    const restored = new DraftStore(filename);
    try { assert.equal(restored.get("review").graphs.main!.nodes[0]!.id, "done"); }
    finally { restored.close(); }
  } finally {
    first.close(); second.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed patch leaves stored draft unchanged; document IDs are parameterized SQL", () => {
  const store = new DraftStore(":memory:");
  try {
    const created = store.create({ id: "work", name: "Original" });
    assert.throws(() => store.patch("work", { expectedRevision: 1, operations: [
      { op: "addNode", graphId: "main", node: { id: "end", kind: "end", value: { op: "literal", value: null } } },
      { op: "removeNode", graphId: "main", nodeId: "missing" },
    ] }));
    assert.deepEqual(store.get("work"), created);
    assert.throws(() => store.get("work' OR 1=1 --"), /not found/);
    assert.equal(store.list().length, 1);
  } finally { store.close(); }
});

test("concurrent CLI initialization waits for SQLite WAL/schema locks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-store-race-"));
  try {
    const responses = await Promise.allSettled(Array.from({ length: 24 }, () => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "workflow.list", "--store", join(directory, "state.sqlite")], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      let errors = "";
      const timeout = setTimeout(() => { child.kill("SIGKILL"); }, 20_000);
      child.stdout.setEncoding("utf8").on("data", data => { output += data; });
      child.stderr.setEncoding("utf8").on("data", data => { errors += data; });
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.once("close", code => {
        clearTimeout(timeout);
        if (code !== 0) reject(new Error(`${code}: ${errors}\n${output}`));
        else resolve(output);
      });
      child.stdin.end("{}");
    })));
    for (const response of responses) {
      if (response.status === "rejected") throw response.reason;
      assert.deepEqual(JSON.parse(response.value), { ok: true, result: [] });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
