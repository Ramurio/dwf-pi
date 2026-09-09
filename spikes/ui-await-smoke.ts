/** Disposable browser await/outcome fixture. No model calls or user journal writes. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { RunController } from "../src/run-controller.js";
import { startGraphServer } from "../src/graph-view/server.js";
const directory = await mkdtemp(join(tmpdir(), "dynamicwf-ui-await-"));
const filename = join(directory, "state.sqlite"), controller = new RunController(filename);
const literal = (value: any) => ({ op: "literal" as const, value });
const run = await controller.start({ schemaVersion: 1, id: "ui-await", name: "UI QA · недостающие данные", revision: 1, entryGraph: "main", graphs: {
  main: { entry: "answer", nodes: [
    { id: "answer", kind: "await", reason: literal("Нужен результат проверки совместимости. Передайте решение и основание."),
      input: literal({ artifact: "fixture-only", criterion: "Совместимость подтверждена" }),
      responseSchema: { type: "object", properties: { compatible: { type: "boolean" }, reason: { type: "string", minLength: 1 } }, required: ["compatible", "reason"], additionalProperties: false } },
    ...(["accepted", "rejected"] as const).map(decision => ({ id: decision, kind: "finish" as const, decision,
      reason: { op: "ref" as const, path: ["nodes", "answer", "reason"] }, evidence: { op: "array" as const, items: [{ op: "ref" as const, path: ["nodes", "answer"] }] }, value: literal({ artifact: "fixture-only" }) })),
  ], edges: [{ from: "answer", to: "accepted", when: { op: "ref", path: ["nodes", "answer", "compatible"] } }, { from: "answer", to: "rejected" }] },
} }, null, directory);
const viewer = await startGraphServer(filename, run.id);
process.stdout.write(JSON.stringify({ url: viewer.url, directory, runId: run.id, pid: process.pid }) + "\n");
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await controller.control(run.id, "cancel");
  for (;;) {
    const state = controller.observe(run.id);
    if (["succeeded", "failed", "cancelled"].includes(state.run.status) && !state.workersAlive) break;
    await sleep(50);
  }
  await viewer.close(); controller.close();
  await rm(directory, { recursive: true, force: true });
}
process.on("SIGINT", () => { void close(); });
process.on("SIGTERM", () => { void close(); });
