/** Temporary real failed check followed by a synthetic acceptance receipt; no inference. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { RunController } from "../src/run-controller.js";
import { startGraphServer } from "../src/graph-view/server.js";
const directory = await mkdtemp(join(tmpdir(), "dynamicwf-ui-reconciliation-")), filename = join(directory, "state.sqlite"), controller = new RunController(filename);
const run = await controller.start({ schemaVersion: 1, id: "reconciliation_qa", name: "UI QA · решение о восстановлении", revision: 1, entryGraph: "main", graphs: { main: { entry: "check", nodes: [
  { id: "check", kind: "check", command: join(directory, "not-installed"), args: [] }, { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "check"] } },
], edges: [{ from: "check", to: "done" }] } } }, null, directory, { availableModels: [] });
for (;;) { if (controller.observe(run.id).run.status === "failed") break; await sleep(40); }
const activation = controller.store.listActivations(run.id)[0]!, inspection = await controller.recovery(run.id, activation.key);
await controller.reconcile({ id: run.id, key: activation.key, attempt: inspection.attempt, checkpoint: inspection.checkpoint, workspaceDigest: inspection.workspace!.digest,
  decisionId: "qa-accept", action: "accept", actor: "QA fixture", reason: "Проверка отображения принятого checkpoint", evidence: [{ fixture: "Synthetic acceptance for UI QA only" }], output: { exitCode: 0, stdout: "Synthetic result", stderr: "" } });
const viewer = await startGraphServer(filename, run.id);
process.stdout.write(JSON.stringify({ url: viewer.url, pid: process.pid, directory, runId: run.id }) + "\n");
let closing = false; async function close() { if (closing) return; closing = true; await viewer.close(); await controller.control(run.id, "cancel"); controller.close(); await rm(directory, { recursive: true, force: true }); }
process.on("SIGINT", () => { void close(); }); process.on("SIGTERM", () => { void close(); });
