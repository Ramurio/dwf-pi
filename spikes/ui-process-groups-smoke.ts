/** Real detached check leaves one fixture-owned descendant; no inference. */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { RunController } from "../src/run-controller.js";
import { startGraphServer } from "../src/graph-view/server.js";
const directory = await mkdtemp(join(tmpdir(), "dynamicwf-ui-groups-"));
const filename = join(directory, "state.sqlite"), controller = new RunController(filename);
const child = "require('node:fs').writeFileSync('descendant.pid',String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);";
const run = await controller.start({ schemaVersion: 1, id: "group_qa", name: "UI QA · процессы после worker", revision: 1, entryGraph: "main", graphs: { main: { entry: "command", nodes: [
  { id: "command", kind: "check", command: process.execPath, args: ["-e", `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'ignore'}).unref();`] },
  { id: "done", kind: "end", value: { op: "literal", value: null } },
], edges: [{ from: "command", to: "done" }] } } }, null, directory, { availableModels: [] });
for (;;) { const state = controller.observe(run.id); if (!state.supervisorAlive && state.unresolvedGroups.length) break; await sleep(40); }
const descendant = Number(await readFile(join(directory, "descendant.pid"), "utf8"));
const viewer = await startGraphServer(filename, run.id);
process.stdout.write(JSON.stringify({ url: viewer.url, pid: process.pid, directory, runId: run.id, descendant }) + "\n");
let closing = false;
async function close() {
  if (closing) return; closing = true;
  await controller.control(run.id, "cancel");
  // This PID came from the child created by this fixture, not a guessed PGID.
  try { process.kill(descendant, "SIGKILL"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  for (;;) { const state = controller.observe(run.id); if (state.run.status === "cancelled" && !state.workersAlive && !state.unresolvedGroups.length) break; await sleep(40); }
  await viewer.close(); controller.close(); await rm(directory, { recursive: true, force: true });
}
process.on("SIGINT", () => { void close(); }); process.on("SIGTERM", () => { void close(); });
