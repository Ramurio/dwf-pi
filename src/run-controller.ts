import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareExecutionPlan, verifyExecutionPlan, type PrepareExecutionOptions } from "./execution-plan.js";
import type { ExecutionPlan } from "./execution-types.js";
import type { Json } from "./graph.js";
import { assertJson } from "./output-schema.js";
import { RunStore, type RunRecord } from "./run-store.js";

const supervisorPath = fileURLToPath(new URL("./supervisor.ts", import.meta.url));
function commandLine(pid: number): string | undefined {
  try { return execFileSync("ps", ["-p", String(pid), "-o", "args="], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() || undefined; }
  catch (error) {
    const detail = error as { status?: number; stderr?: Buffer | string; stdout?: Buffer | string };
    if (detail.status === 1 && !String(detail.stderr ?? "").trim() && !String(detail.stdout ?? "").trim()) return undefined;
    throw error;
  }
}
export function matchesProcess(pid: number | null, marker: string, script: string): boolean {
  if (pid === null) return false;
  const line = commandLine(pid);
  return Boolean(line?.includes(script) && line.includes(marker));
}

/** Owns control commands, not execution lifetime. Closing this object cannot stop a run. */
export class RunController {
  readonly store: RunStore;
  readonly filename: string;
  constructor(filename: string) {
    this.filename = resolve(filename);
    this.store = new RunStore(this.filename);
  }
  close(): void { this.store.close(); }
  directory(id: string): string { return join(dirname(this.filename), "runs", id); }
  async start(workflow: unknown, input: Json, cwd: string, options: Omit<PrepareExecutionOptions, "cwd"> = {}): Promise<RunRecord> {
    const workspace = await realpath(cwd);
    if (!(await stat(workspace)).isDirectory()) throw new Error("Run workspace must be a directory");
    const plan = await prepareExecutionPlan(workflow, { ...options, cwd: workspace });
    return this.startPrepared(plan, input, workspace);
  }
  async startPrepared(plan: ExecutionPlan, input: Json, cwd: string): Promise<RunRecord> {
    const verified = verifyExecutionPlan(plan);
    assertJson(input);
    const workspace = await realpath(cwd);
    if (!(await stat(workspace)).isDirectory()) throw new Error("Run workspace must be a directory");
    const run = this.store.create({ id: `run-${randomUUID()}`, plan: verified, input, cwd: workspace });
    await this.launch(run.id);
    return this.store.get(run.id);
  }
  private async launch(id: string): Promise<void> {
    let token: string;
    try { token = this.store.reserveLaunch(id).token; }
    catch (error) {
      const current = this.store.get(id);
      if (error instanceof Error && error.message.startsWith("Run is not launchable:") &&
        (current.ownerToken !== null || current.desired !== "running" || !["queued", "interrupted"].includes(current.status))) return;
      throw error;
    }
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const directory = this.directory(id);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const log = openSync(join(directory, "supervisor.log"), "a", 0o600);
      try {
        child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), supervisorPath,
          "--store", this.filename, "--run", id, "--owner", token, "--directory", directory], {
          detached: true, stdio: ["ignore", log, log], cwd: this.store.get(id).cwd,
        });
      } finally { closeSync(log); }
      await new Promise<void>((resolve, reject) => { child!.once("spawn", resolve); child!.once("error", reject); });
      child.unref();
      const current = this.store.get(id);
      // A tiny pure graph may finish before the launching client gets CPU again.
      if (current.ownerToken === token) {
        try { this.store.attachPid(id, token, child.pid!); }
        catch (error) { if (this.store.get(id).ownerToken === token) throw error; }
      }
    } catch (error) {
      // A failed spawn has no worker. If a child did start, keep its reservation
      // for liveness reconciliation instead of inventing a terminal outcome.
      if (!child?.pid) this.store.markInterrupted(id, token, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  observe(id: string): { run: RunRecord; supervisorAlive: boolean; workersAlive: number } {
    let run = this.store.get(id);
    let supervisorAlive = run.ownerToken !== null && matchesProcess(run.supervisorPid, `--owner ${run.ownerToken}`, supervisorPath);
    const workers = this.store.listActivations(id).filter(item => typeof item.metadata.workerPid === "number" && typeof item.metadata.workerToken === "string");
    const workersAlive = workers.filter(item => matchesProcess(item.metadata.workerPid as number,
      `--worker-token ${item.metadata.workerToken}`, item.metadata.workerKind === "check" ? "check-worker-process.ts" : "pi-worker-process.ts")).length;
    if (!supervisorAlive && run.ownerToken && run.supervisorPid === null) {
      // Cover the small reserve/spawn/attach window without treating a fresh
      // reservation as proof of either a live process or a failed launch.
      const processes = execFileSync("ps", ["-ax", "-o", "pid=,args="], { encoding: "utf8" });
      const match = processes.split("\n").find(line => line.includes(supervisorPath) && line.includes(`--owner ${run.ownerToken}`));
      const pid = match ? Number(match.trim().split(/\s+/, 1)[0]) : undefined;
      if (pid) {
        try { this.store.attachPid(id, run.ownerToken, pid); }
        catch (error) { if (this.store.get(id).ownerToken === run.ownerToken) throw error; return this.observe(id); }
        run = this.store.get(id); supervisorAlive = true;
      }
      else if (Date.now() - run.updatedAt < 5_000) return { run, supervisorAlive: false, workersAlive };
    }
    if (run.ownerToken && !supervisorAlive && workersAlive === 0) {
      try { this.store.markInterrupted(id, run.ownerToken, "Supervisor and recorded workers are no longer alive"); }
      catch (error) { if (this.store.get(id).ownerToken === run.ownerToken) throw error; return this.observe(id); }
      run = this.store.get(id);
      if (run.desired === "cancelled") run = this.store.requestControl(id, "cancel");
    }
    return { run, supervisorAlive, workersAlive };
  }
  async control(id: string, command: "pause" | "resume" | "cancel"): Promise<RunRecord> {
    const observed = this.observe(id);
    let run = this.store.requestControl(id, command);
    if (command === "cancel" && !observed.supervisorAlive) {
      for (const item of this.store.listActivations(id)) {
        const pid = item.metadata.workerPid;
        if (typeof pid === "number" && typeof item.metadata.workerToken === "string" && matchesProcess(pid,
          `--worker-token ${item.metadata.workerToken}`, item.metadata.workerKind === "check" ? "check-worker-process.ts" : "pi-worker-process.ts")) {
          try { process.kill(-pid, "SIGTERM"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
        }
      }
    }
    if (command === "resume" && ["queued", "interrupted"].includes(run.status) && run.ownerToken === null && run.desired === "running") {
      await this.launch(id); run = this.store.get(id);
    }
    return run;
  }
}
