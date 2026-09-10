/** Failed real check + explicit inspection of a temporary local workspace; no inference. */
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { RunController } from "../src/run-controller.js";
import { startGraphServer } from "../src/graph-view/server.js";
const directory = await mkdtemp(join(tmpdir(), "dynamicwf-ui-recovery-")), filename = join(directory, "state.sqlite"), controller = new RunController(filename);
await writeFile(join(directory, "artifact.txt"), "Initial result\n");
const run = await controller.start({ schemaVersion: 1, id: "inspection_qa", name: "UI QA · инспекция перед восстановлением", revision: 1, entryGraph: "main", graphs: { main: { entry: "check", nodes: [
  { id: "check", kind: "check", command: join(directory, "not-installed"), args: [] }, { id: "done", kind: "end", value: { op: "literal", value: null } },
], edges: [{ from: "check", to: "done" }] } } }, null, directory, { availableModels: [] });
for (;;) { if (controller.observe(run.id).run.status === "failed") break; await sleep(40); }
const viewer = await startGraphServer(filename, run.id);
process.stdout.write(JSON.stringify({ url: viewer.url, pid: process.pid, directory, runId: run.id }) + "\n");
let closing = false; async function close() { if (closing) return; closing = true; await viewer.close(); controller.close(); await rm(directory, { recursive: true, force: true }); }
process.on("SIGINT", () => { void close(); }); process.on("SIGTERM", () => { void close(); });
