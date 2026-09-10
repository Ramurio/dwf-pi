/** Disposable stored-state browser fixture. No inference or user journal writes. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStore } from "../src/run-store.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { startGraphServer } from "../src/graph-view/server.js";
const directory = await mkdtemp(join(tmpdir(), "dynamicwf-ui-output-repair-")), filename = join(directory, "state.sqlite");
const store = new RunStore(filename);
const plan = await prepareExecutionPlan({ schemaVersion: 1, id: "ui-output-repair", name: "UI QA · исправление формата", revision: 1, entryGraph: "main", graphs: { main: { entry: "formatter", nodes: [
  { id: "formatter", kind: "agent", role: "general", config: { outputRepair: { mode: "submit-only" } }, task: { op: "literal", value: "Offline UI fixture" } },
  { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "formatter"] } },
], edges: [{ from: "formatter", to: "done" }] } } }, { cwd: directory, availableModels: [{ provider: "offline", id: "fixture", thinkingLevels: ["off"] }] });
for (const id of ["run-repair-complete", "run-repair-unconfirmed"]) {
  store.create({ id, plan, cwd: directory, input: null });
  const { token } = store.reserveLaunch(id);
  const a = store.beginActivation(id, token, { graphId: "main", nodeId: "formatter", scope: ["graph", "main"], visit: 0 }, { kind: "agent", sideEffect: false });
  store.startUsage(id, token, a.key);
  store.recordUsage(id, token, a.key, "1", { input: 100, output: 50, totalTokens: 150 }, "toolUse");
  for (let round = 1; round <= 2; round++) {
    const progress = { round, status: "running", cause: "schema", afterReport: round, throughReport: round };
    store.setActivationMetadata(id, token, a.key, { outputRepair: progress });
    store.recordUsage(id, token, a.key, String(round + 1), { input: 20, output: 10, totalTokens: 30 }, "toolUse");
    if (id === "run-repair-unconfirmed") break;
    store.setActivationMetadata(id, token, a.key, { outputRepair: { ...progress, status: round === 1 ? "invalid" : "succeeded", throughReport: round + 1 } });
  }
  if (id === "run-repair-unconfirmed") store.markInterrupted(id, token, "Offline fixture: supervisor settlement was not recorded");
  else {
    store.settleUsage(id, token, a.key, true);
    store.completeActivation(id, token, a.key, { result: "Formatted result" });
    store.finish(id, token, { status: "succeeded", output: { result: "Formatted result" } });
  }
}
const viewer = await startGraphServer(filename, "run-repair-complete");
process.stdout.write(JSON.stringify({ url: viewer.url, directory, pid: process.pid }) + "\n");
let closing = false;
async function close() { if (closing) return; closing = true; await viewer.close(); store.close(); await rm(directory, { recursive: true, force: true }); }
process.on("SIGINT", () => { void close(); }); process.on("SIGTERM", () => { void close(); });
