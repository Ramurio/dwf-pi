import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { RunStore } from "./run-store.js";
import { defaultStorePath } from "./service.js";
import { renderRun, renderRunSummary, terminalText } from "./terminal.js";

let store: RunStore | undefined;
const stop = new AbortController();
const detach = () => stop.abort();
const tty = Boolean(process.stdout.isTTY);
let drawing = false;
try {
  const { values } = parseArgs({ options: {
    run: { type: "string" }, store: { type: "string" }, once: { type: "boolean" }, help: { type: "boolean" },
  } });
  if (values.help) {
    process.stdout.write("Usage: node --import tsx src/watch.ts --run <id> [--store state.sqlite] [--once]\nCtrl-C detaches; the workflow continues.\n");
  } else {
    if (!values.run) throw new Error("Specify --run <id>; use --help");
    store = new RunStore(values.store ?? defaultStorePath());
    process.on("SIGINT", detach);
    process.on("SIGTERM", detach);
    let previous = "";
    while (!stop.signal.aborted) {
      const run = store.get(values.run);
      const activations = store.listActivations(run.id);
      const rendered = values.once || tty ? renderRun(run, activations) : renderRunSummary(run, activations);
      if (rendered !== previous) {
        if (tty && !values.once) { drawing = true; process.stdout.write("\u001b[?25l\u001b[H\u001b[2J"); }
        process.stdout.write(`${rendered}\n`);
        previous = rendered;
      }
      if (values.once || ["succeeded", "failed", "cancelled"].includes(run.status)) break;
      await sleep(500, undefined, { signal: stop.signal });
    }
  }
} catch (error) {
  if (!stop.signal.aborted) {
    process.stderr.write(`${terminalText(error instanceof Error ? error.message : String(error), 500)}\n`);
    process.exitCode = 1;
  }
} finally {
  process.off("SIGINT", detach);
  process.off("SIGTERM", detach);
  if (drawing) process.stdout.write("\u001b[?25h");
  store?.close();
}
