import { parseArgs } from "node:util";
import { Effect } from "effect";
import { verifyExecutionPlan } from "./execution-plan.js";
import { loadGeneratedModule } from "./generated-module.js";
import { JournalRuntime } from "./run-runtime.js";
import { RunStore } from "./run-store.js";

const { values } = parseArgs({ options: {
  store: { type: "string" }, run: { type: "string" }, owner: { type: "string" }, directory: { type: "string" },
} });
if (!values.store || !values.run || !values.owner || !values.directory) throw new Error("Supervisor requires store, run, owner and directory");
const store = new RunStore(values.store);
const runId = values.run;
const owner = values.owner;
const controller = new AbortController();
let timer: NodeJS.Timeout | undefined;
const cancel = () => { try { store.requestControl(runId, "cancel"); } finally { controller.abort(); } };
process.on("SIGTERM", cancel);
process.on("SIGINT", cancel);
try {
  store.attachPid(runId, owner, process.pid);
  const run = store.get(runId);
  run.plan = verifyExecutionPlan(run.plan);
  const runtime = new JournalRuntime(store, run, owner, values.directory);
  const module = await loadGeneratedModule(run.plan, values.directory);
  let heartbeat = Date.now();
  timer = setInterval(() => {
    try {
      const current = store.get(runId);
      if (current.ownerToken !== owner || current.desired === "cancelled") controller.abort();
      else runtime.updatePause();
      if (Date.now() - heartbeat >= 1_000 && current.ownerToken === owner) {
        store.heartbeat(runId, owner); heartbeat = Date.now();
      }
    } catch { controller.abort(); }
  }, 100);
  const output = await Effect.runPromise(module.run(runtime, run.input), { signal: controller.signal });
  // A final pause is still a pause: retain the completed output until resume/cancel.
  for (;;) {
    await runtime.gate(controller.signal);
    try { store.finish(runId, owner, { status: "succeeded", output }); break; }
    catch (error) {
      const current = store.get(runId);
      if (current.ownerToken !== owner || current.desired === "running") throw error;
      // Pause/cancel can race the final gate; honor it with the result retained.
    }
  }
} catch (error) {
  const run = store.get(runId);
  if (run.ownerToken === owner) {
    const activations = store.listActivations(runId);
    if (activations.some(item => item.ownerToken === owner && typeof item.metadata.workerPid === "number")) {
      // A cleanup failure cannot become proof that external effects stopped.
      // Leave ownership for the controller to reconcile after observing death.
      store.appendEvent(runId, owner, "run.cleanup_uncertain", { error: "A recorded worker has not confirmed exit" });
    } else {
      for (const item of activations.filter(item => item.status === "running")) store.failActivation(runId, owner, item.key, "Supervisor execution interrupted");
      store.finish(runId, owner, run.desired === "cancelled" ? { status: "cancelled" }
        : { status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }
  process.exitCode = run.desired === "cancelled" ? 0 : 1;
} finally {
  if (timer) clearInterval(timer);
  process.off("SIGTERM", cancel); process.off("SIGINT", cancel);
  store.close();
}
