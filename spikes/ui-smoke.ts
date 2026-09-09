/** Disposable browser control fixture; creates no model calls or user-journal records. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { RunController } from "../src/run-controller.js";
import { startGraphServer } from "../src/graph-view/server.js";
const directory = await mkdtemp(join(tmpdir(), "dynamicwf-ui-browser-")),
  filename = join(directory, "state.sqlite");
const controller = new RunController(filename);
const plan = await prepareExecutionPlan(
  {
    schemaVersion: 1,
    id: "ui-smoke",
    name: "UI QA · управление",
    revision: 1,
    entryGraph: "main",
    graphs: {
      main: {
        entry: "done",
        nodes: [
          {
            id: "done",
            kind: "end",
            value: { op: "literal", value: { accepted: true } },
          },
        ],
        edges: [],
      },
    },
  },
  { cwd: directory, availableModels: [] },
);
controller.store.create({
  id: "run-ui-resume",
  plan,
  input: null,
  cwd: directory,
});
controller.store.create({
  id: "run-ui-cancel",
  plan: await prepareExecutionPlan(
    { ...plan.workflow, name: "UI QA · отмена" },
    { cwd: directory, availableModels: [] },
  ),
  input: null,
  cwd: directory,
});
const viewer = await startGraphServer(filename, "run-ui-resume");
process.stdout.write(JSON.stringify({ url: viewer.url, directory }) + "\n");
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  for (const run of controller.store.listRuns())
    if (!["succeeded", "failed", "cancelled"].includes(run.status))
      await controller.control(run.id, "cancel");
  await viewer.close();
  controller.close();
  await rm(directory, { recursive: true, force: true });
}
process.on("SIGINT", () => {
  void close();
});
process.on("SIGTERM", () => {
  void close();
});
