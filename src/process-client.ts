import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { PiWorkerMessage, PiWorkerRequest, PiWorkerResult } from "./execution-types.js";
import type { Json } from "./graph.js";

export class ProcessCancelled extends Error {
  constructor() { super("Process cancelled"); this.name = "ProcessCancelled"; }
}
export interface ProcessOptions {
  signal?: AbortSignal;
  onStarted?: (pid: number) => void;
  identity?: string;
}

/** POSIX process group: cancellation also reaches ordinary command descendants. */
function stopGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill(signal);
  }
}

function cancellation(child: ChildProcess, signal: AbortSignal | undefined) {
  let cancelled = false;
  let escalation: NodeJS.Timeout | undefined;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    stopGroup(child, "SIGTERM");
    // Cleanup deadline after explicit cancellation, never a workflow time limit.
    escalation = setTimeout(() => stopGroup(child, "SIGKILL"), 2_000);
    escalation.unref();
  };
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  return {
    cancel,
    get cancelled() { return cancelled; },
    dispose() {
      // A TERM-responsive leader can leave TERM-resistant descendants behind.
      if (cancelled) stopGroup(child, "SIGKILL");
      if (escalation) clearTimeout(escalation);
      signal?.removeEventListener("abort", cancel);
    },
  };
}

/** IPC disconnect on some Node versions omits ChildProcess.close. Require exit and drained pipes instead. */
function settled(child: ChildProcess, finish: (code: number | null, signal: NodeJS.Signals | null) => void) {
  let exited = false, outDone = !child.stdout, errDone = !child.stderr, finished = false;
  let code: number | null = null;
  let signal: NodeJS.Signals | null = null;
  const check = () => { if (!finished && exited && outDone && errDone) { finished = true; finish(code, signal); } };
  child.once("exit", (exitCode, exitSignal) => { exited = true; code = exitCode; signal = exitSignal; check(); });
  child.once("error", () => { if (!child.pid) { exited = true; check(); } });
  for (const event of ["end", "close"] as const) {
    child.stdout?.once(event, () => { outDone = true; check(); });
    child.stderr?.once(event, () => { errDone = true; check(); });
  }
}

export function runPiProcess(request: PiWorkerRequest, options: ProcessOptions & {
  onEvent?: (event: Extract<PiWorkerMessage, { type: "event" }>["event"]) => void;
} = {}): Promise<PiWorkerResult> {
  if (options.signal?.aborted) return Promise.reject(new ProcessCancelled());
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"),
      fileURLToPath(new URL("./pi-worker-process.ts", import.meta.url)),
      "--worker-token", options.identity ?? "untracked"], {
      cwd: request.cwd, detached: true, stdio: ["pipe", "pipe", "pipe", "ipc"],
    });
    const control = cancellation(child, options.signal);
    let output: PiWorkerResult | undefined;
    let failure: Error | undefined;
    let pending = "";
    const fail = (error: unknown) => {
      failure ??= error instanceof Error ? error : new Error(String(error));
      control.cancel();
    };
    child.once("spawn", () => {
      try { options.onStarted?.(child.pid!); }
      catch (error) { fail(error); }
    });
    child.once("error", fail);
    child.stdin!.on("error", error => {
      if (!control.cancelled) fail(error);
    });
    // Only the worker's curated protocol errors cross this boundary. Unhandled
    // SDK stderr can contain provider headers or prompt data, including on crash.
    child.stderr!.resume();
    child.stdout!.setEncoding("utf8").on("data", (data: string) => {
      pending += data;
      for (;;) {
        const newline = pending.indexOf("\n");
        if (newline < 0) break;
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line) as PiWorkerMessage;
          if (message.type === "result") {
            if (output) throw new Error("Worker sent multiple result messages");
            output = message.result;
          } else if (message.type === "error") {
            failure = new Error(message.error);
          } else if (message.type === "event") {
            options.onEvent?.(message.event);
          } else if (message.type !== "ready") throw new Error("Unknown worker protocol message");
        } catch (error) { fail(error); }
      }
    });
    settled(child, (code, signal) => {
      control.dispose();
      if (failure) reject(failure);
      else if (control.cancelled) reject(new ProcessCancelled());
      else if (code !== 0) reject(new Error(`Pi worker exited ${code ?? signal} before a valid protocol result`));
      else if (pending.trim() || !output) reject(new Error("Pi worker closed without one complete result"));
      else resolve(output);
    });
    child.stdin!.end(JSON.stringify(request));
  });
}

export function runCheckProcess(command: string, args: string[], cwd: string, options: ProcessOptions = {}): Promise<Json> {
  if (options.signal?.aborted) return Promise.reject(new ProcessCancelled());
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"),
      fileURLToPath(new URL("./check-worker-process.ts", import.meta.url)),
      "--worker-token", options.identity ?? "untracked"], {
      cwd, detached: true, shell: false, stdio: ["pipe", "pipe", "pipe", "ipc"],
    });
    const control = cancellation(child, options.signal);
    let stdout = "";
    let stderr = "";
    let failure: Error | undefined;
    child.once("spawn", () => {
      try { options.onStarted?.(child.pid!); }
      catch (error) { failure = error instanceof Error ? error : new Error(String(error)); control.cancel(); }
    });
    child.once("error", error => { failure = error; });
    child.stdin!.on("error", error => { if (!control.cancelled) failure = error; });
    child.stdout!.setEncoding("utf8").on("data", (data: string) => { stdout += data; });
    child.stderr!.setEncoding("utf8").on("data", (data: string) => { stderr += data; });
    settled(child, (code, signal) => {
      control.dispose();
      if (failure) reject(failure);
      else if (control.cancelled) reject(new ProcessCancelled());
      else if (signal || code === null) reject(new Error(`Check terminated by ${signal ?? "unknown cause"}`));
      else if (code !== 0) reject(new Error(stderr.trim() || `Check worker exited ${code}`));
      else {
        try { resolve(JSON.parse(stdout) as Json); }
        catch { reject(new Error("Check worker returned invalid JSON")); }
      }
    });
    child.stdin!.end(JSON.stringify({ command, args, cwd }));
  });
}
