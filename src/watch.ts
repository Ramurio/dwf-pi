import { parseArgs } from "node:util";
import { emitKeypressEvents } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { RunController } from "./run-controller.js";
import { defaultStorePath } from "./service.js";
import { renderRun, terminalText } from "./terminal.js";
import { collectActivity, MonitorLog, monitorBody, renderDashboard, type MonitorView, type WorkerActivity } from "./monitor.js";

let controller: RunController | undefined;
const stop = new AbortController();
const detach = () => stop.abort();
let drawing = false, raw = false, previousRaw = false;
let view: MonitorView = "overview", offset = 0;
const onKey = (_: string, key: { name?: string; ctrl?: boolean } = {}) => {
  if (key.name === "q" || key.ctrl && key.name === "c") detach();
  if (["1", "2", "3", "4"].includes(key.name ?? "")) { view = key.name === "4" ? "tokens" : key.name === "2" ? "history" : key.name === "3" ? "graph" : "overview"; offset = 0; }
  if (key.name === "down" || key.name === "j") offset++;
  if (key.name === "up" || key.name === "k") offset = Math.max(0, offset - 1);
  if (key.name === "pagedown") offset += 10;
  if (key.name === "pageup") offset = Math.max(0, offset - 10);
  if (key.name === "home") offset = 0;
};
const pipeError = (error: NodeJS.ErrnoException) => { if (error.code === "EPIPE") detach(); else { process.exitCode = 1; detach(); } };
try {
  const { values } = parseArgs({ options: {
    run: { type: "string" }, store: { type: "string" }, once: { type: "boolean" }, help: { type: "boolean" },
    graph: { type: "boolean" }, plain: { type: "boolean" },
  } });
  if (values.help) {
    process.stdout.write("Usage: dynamicwf watch --run <id> [--store state.sqlite] [--once] [--graph] [--plain]\n1 Now · 2 History · 3 Graph · 4 Tokens · arrows/PgUp/PgDn scroll · q/Ctrl-C detach\n--once: compact snapshot; --graph --once: full graph; --plain: append-only changes.\nThe workflow continues when you close the monitor.\n");
  } else {
    if (!values.run) throw new Error("Specify --run <id>; use --help");
    controller = new RunController(values.store ?? defaultStorePath());
    const store = controller.store;
    process.on("SIGINT", detach);
    process.on("SIGTERM", detach);
    process.stdout.on("error", pipeError);
    const tty = Boolean(process.stdout.isTTY) && !values.plain;
    view = values.graph ? "graph" : "overview";
    if (tty && !values.once) {
      // Let pending loader warnings reach stderr before entering the alternate screen.
      // They remain visible in the original terminal, without corrupting the dashboard.
      await sleep(0);
      drawing = true;
      process.stdout.write("\u001b[?1049h\u001b[?25l");
      if (process.stdin.isTTY) {
        previousRaw = process.stdin.isRaw;
        emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true); raw = true;
        process.stdin.on("keypress", onKey); process.stdin.resume();
      }
    }
    let previous = "", cursor = 0;
    const activity = new Map<string, WorkerActivity>(), log = new MonitorLog();
    while (!stop.signal.aborted) {
      const { run, activations, presentation } = controller.snapshot(values.run);
      const events = store.events(run.id, cursor);
      if (events.length) cursor = events.at(-1)!.seq;
      collectActivity(events, activity);
      if (values.once || tty) {
        offset = Math.min(offset, Math.max(0, monitorBody(run, activations, { view, activity }).length - Math.max(0, (process.stdout.rows || 25) - 9)));
        const rendered = values.once && values.graph ? renderRun(run, activations, presentation) : renderDashboard(run, activations, {
          width: Math.max(1, (process.stdout.columns || 101) - 1), height: Math.max(4, (process.stdout.rows || 25) - 1), view, offset, activity, presentation,
        });
        if (rendered !== previous) {
          if (drawing) process.stdout.write("\u001b[H\u001b[2J");
          process.stdout.write(rendered + (drawing ? "" : "\n"));
          previous = rendered;
        }
      } else {
        const lines = log.update(run, activations, presentation);
        if (lines.length) process.stdout.write(`${lines.join("\n")}\n`);
      }
      if (values.once) break;
      // Keep a completed interactive screen available for history/graph inspection.
      if (!tty && ["succeeded", "failed", "cancelled"].includes(run.status)) break;
      await sleep(250, undefined, { signal: stop.signal });
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
  if (raw) { process.stdin.off("keypress", onKey); process.stdin.setRawMode(previousRaw); process.stdin.pause(); }
  if (drawing) process.stdout.write("\u001b[?25h\u001b[?1049l");
  controller?.close();
}
