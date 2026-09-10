/** Two real failed checks for browser accept/retry QA. All inputs and outputs are fixtures; no inference. */
import { mkdtemp, mkdir, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { RunController } from "../src/run-controller.js";
import { startGraphServer } from "../src/graph-view/server.js";
const directory = await mkdtemp(join(tmpdir(), "dynamicwf-ui-recovery-form-")), filename = join(directory, "state.sqlite"), controller = new RunController(filename), ids: string[] = [];
for (const action of ["accept", "retry"]) {
  const cwd = join(directory, action); await mkdir(cwd);
  const run = await controller.start({ schemaVersion: 1, id: `form_${action}`, name: `UI QA · ${action}`, revision: 1, entryGraph: "main", graphs: { main: { entry: "check", nodes: [
    { id: "check", kind: "check", command: join(cwd, "fixture-command"), args: [] }, { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "check"] } },
  ], edges: [{ from: "check", to: "done" }] } } }, null, cwd, { availableModels: [] });
  ids.push(run.id);
  for (;;) { if (controller.observe(run.id).run.status === "failed") break; await sleep(40); }
  if (action === "retry") { await writeFile(join(cwd, "fixture-command"), "#!/bin/sh\nprintf 'Real retry executed\\n'\n"); await chmod(join(cwd, "fixture-command"), 0o755); }
}
const viewer = await startGraphServer(filename, ids[0]);
process.stdout.write(JSON.stringify({ url: viewer.url, pid: process.pid, directory, ids }) + "\n");
let closing = false; async function close() {
  if (closing) return; closing = true; await viewer.close();
  for (const id of ids) { await controller.control(id, "cancel"); for (;;) { const observed = controller.observe(id); if (!observed.supervisorAlive && !observed.workersAlive) break; await sleep(40); } }
  controller.close(); await rm(directory, { recursive: true, force: true });
}
process.on("SIGINT", () => { void close(); }); process.on("SIGTERM", () => { void close(); });
