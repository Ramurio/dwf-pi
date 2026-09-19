import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { PiWorkerMessage, PiWorkerRequest, PiWorkerResult } from "./execution-types.js";
import type { Json } from "./graph.js";
import { ExecutionFailure, executionFailure, parseExecutionFailure, type ExecutionFailureRecord } from "./execution-failure.js";

export class ProcessCancelled extends ExecutionFailure {
  constructor(effects: ExecutionFailureRecord["effects"] = "unknown") { super({version:1,code:"cancelled",phase:effects === "not-started" ? "setup" : "execution",effects,message:"Process cancelled"}); this.name = "ProcessCancelled"; }
}
export interface ProcessOptions {
  signal?: AbortSignal;
  /** Synchronous durable reservation before spawn. Throwing prevents launch. */
  onStarting?: (identity: string) => void;
  /** Must finish before the worker receives its execution request. */
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
  if (options.signal?.aborted) return Promise.reject(new ProcessCancelled("not-started"));
  return new Promise((resolve, reject) => {
    const identity = options.identity ?? randomUUID();
    options.onStarting?.(identity);
    if (options.signal?.aborted) throw new ProcessCancelled("not-started");
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"),
      fileURLToPath(new URL("./pi-worker-process.ts", import.meta.url)),
      "--worker-token", identity], {
      cwd: request.cwd, detached: true, stdio: ["pipe", "pipe", "pipe", "ipc"],
    });
    const control = cancellation(child, options.signal);
    let output: PiWorkerResult | undefined;
    let seenResult = false;
    let failure: Error | undefined;
    let pending = "";
    const fail = (error: unknown) => {
      failure ??= error instanceof Error ? error : new Error(String(error));
      control.cancel();
    };
    child.once("spawn", () => {
      try {
        if (control.cancelled) return;
        options.onStarted?.(child.pid!);
        if (!control.cancelled) child.stdin!.end(JSON.stringify(request));
      }
      catch (error) { fail(error); }
    });
    child.once("error", error => fail(executionFailure("process",child.pid ? "execution" : "setup",child.pid ? "unknown" : "not-started",`Pi worker could not start (${(error as NodeJS.ErrnoException).code ?? "unknown cause"})`)));
    child.stdin!.on("error", error => {
      if (!control.cancelled) fail(error);
    });
    // Only the worker's curated protocol errors cross this boundary. Unhandled
    // SDK stderr can contain provider headers or prompt data, including on crash.
    child.stderr!.resume();
    child.stdout!.setEncoding("utf8").on("data", (data: string) => {
      if (failure) return;
      pending += data;
      while (!failure) {
        const newline = pending.indexOf("\n");
        if (newline < 0) break;
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line) as PiWorkerMessage;
          if (!message || typeof message !== "object" || Array.isArray(message) || seenResult) throw new Error("Invalid or post-result worker message");
          if (message.type === "result") {
            if (!message.result || typeof message.result !== "object" || Array.isArray(message.result)) throw new Error("Invalid worker result envelope");
            seenResult = true;
            output = message.result;
          } else if (message.type === "error") {
            const detail = parseExecutionFailure(message.failure);
            if (typeof message.error !== "string" || !message.error.trim() || message.failure !== undefined && (!detail || detail.message !== message.error)) throw executionFailure("protocol","execution","unknown","Invalid worker failure message");
            // A terminal error keeps its original cause; later frames cannot replace it.
            failure ??= detail ? new ExecutionFailure(detail) : executionFailure("unknown","execution","unknown",message.error);
          } else if (message.type === "event") {
            try { options.onEvent?.(message.event); }
            catch { fail(executionFailure("unknown","execution","unknown","Worker event could not be recorded")); }
          } else if (message.type !== "ready") throw new Error("Unknown worker protocol message");
        } catch (error) { fail(error instanceof ExecutionFailure ? error : executionFailure("protocol","execution","unknown","Invalid worker protocol message")); }
      }
    });
    settled(child, (code, signal) => {
      control.dispose();
      if (failure) reject(failure);
      else if (control.cancelled) reject(new ProcessCancelled());
      else if (code !== 0) reject(executionFailure("process","execution","unknown",`Pi worker exited ${code ?? signal} before a valid protocol result`));
      else if (pending.trim() || !seenResult || output === undefined) reject(executionFailure("protocol","execution","unknown","Pi worker closed without one complete result"));
      else resolve(output);
    });
  });
}

export function runCheckProcess(command: string, args: string[], cwd: string, options: ProcessOptions = {}): Promise<Json> {
  if (options.signal?.aborted) return Promise.reject(new ProcessCancelled("not-started"));
  return new Promise((resolve, reject) => {
    const identity = options.identity ?? randomUUID();
    options.onStarting?.(identity);
    if (options.signal?.aborted) throw new ProcessCancelled("not-started");
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"),
      fileURLToPath(new URL("./check-worker-process.ts", import.meta.url)),
      "--worker-token", identity], {
      cwd, detached: true, shell: false, stdio: ["pipe", "pipe", "pipe", "ipc"],
    });
    const control = cancellation(child, options.signal);
    let stdout = "";
    let stderr = "";
    let failure: Error | undefined;
    child.once("spawn", () => {
      try {
        if (control.cancelled) return;
        options.onStarted?.(child.pid!);
        if (!control.cancelled) child.stdin!.end(JSON.stringify({ command, args, cwd }));
      }
      catch (error) { failure = error instanceof Error ? error : new Error(String(error)); control.cancel(); }
    });
    child.once("error", error => { failure = executionFailure("process",child.pid ? "execution" : "setup",child.pid ? "unknown" : "not-started",`Check worker could not start (${(error as NodeJS.ErrnoException).code ?? "unknown cause"})`); });
    child.stdin!.on("error", error => { if (!control.cancelled) failure = error; });
    child.stdout!.setEncoding("utf8").on("data", (data: string) => { stdout += data; });
    child.stderr!.setEncoding("utf8").on("data", (data: string) => { stderr += data; });
    settled(child, (code, signal) => {
      control.dispose();
      if (failure) reject(failure);
      else if (control.cancelled) reject(new ProcessCancelled());
      else if (signal || code === null) reject(executionFailure("process","execution","unknown",`Check terminated by ${signal ?? "unknown cause"}`));
      else if (code !== 0) {
        let detail: ExecutionFailureRecord | undefined;
        try { detail = parseExecutionFailure(JSON.parse(stdout).failure); } catch { /* legacy/crashed wrapper */ }
        reject(detail ? new ExecutionFailure(detail) : executionFailure("process","execution","unknown",stderr.trim() || `Check worker exited ${code}`));
      }
      else {
        try { resolve(JSON.parse(stdout) as Json); }
        catch { reject(executionFailure("protocol","output","unknown","Check worker returned invalid JSON")); }
      }
    });
  });
}
