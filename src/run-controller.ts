import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareExecutionPlan, verifyExecutionPlan, type PrepareExecutionOptions } from "./execution-plan.js";
import { preparedExecutionId, type ExecutionPlan } from "./execution-types.js";
import { executionWorkspace } from "./prepared-plans.js";
import type { Json } from "./graph.js";
import { assertJson } from "./output-schema.js";
import { RunStore, type RunRecord, type PreparedStart, type ActivationRecord } from "./run-store.js";
import { projectRun } from "./observation.js";

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
  return line !== undefined && matchesCommand(line, marker, script);
}

function matchesCommand(line: string, marker: string, script: string): boolean {
  if (!line.includes(script)) return false;
  for (let index = line.indexOf(marker); index !== -1; index = line.indexOf(marker, index + 1)) {
    if ((index === 0 || /\s/.test(line[index - 1]!)) &&
      (index + marker.length === line.length || /\s/.test(line[index + marker.length]!))) return true;
  }
  return false;
}

function processInventory(): string[] {
  return execFileSync("ps", ["-ax", "-o", "pid=,args="], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\n");
}
function matchingPids(lines: readonly string[], marker: string, script: string): number[] {
  return lines.filter(line => matchesCommand(line, marker, script))
    .map(line => Number(line.trim().split(/\s+/, 1)[0])).filter(pid => Number.isSafeInteger(pid) && pid > 0);
}
/** Reservations let observation find a spawned wrapper before its PID checkpoint. */
function liveWorkerPids(activations: readonly ActivationRecord[], inventory: () => readonly string[]): number[] {
  const pids = new Set<number>();
  for (const { metadata } of activations) {
    if (typeof metadata.workerToken !== "string") continue;
    const marker = `--worker-token ${metadata.workerToken}`;
    const script = metadata.workerKind === "check" ? "check-worker-process.ts" : "pi-worker-process.ts";
    if (typeof metadata.workerPid === "number") {
      if (matchesProcess(metadata.workerPid, marker, script)) pids.add(metadata.workerPid);
    } else if (metadata.workerLaunch === "reserved" || metadata.workerLaunch === "started") {
      for (const pid of matchingPids(inventory(), marker, script)) pids.add(pid);
    }
  }
  return [...pids];
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
  snapshot(id: string) {
    const observed = this.observe(id), activations = this.store.listActivations(id);
    const presentation = projectRun(observed.run, activations, {
      supervisorAlive: observed.supervisorAlive, workersAlive: observed.workersAlive, observedAt: Date.now(),
      launchPending: observed.run.ownerToken !== null && observed.run.supervisorPid === null && !observed.supervisorAlive,
    });
    return { ...observed, activations, presentation };
  }
  directory(id: string): string { return join(dirname(this.filename), "runs", id); }
  async start(workflow: unknown, input: Json, cwd: string, options: Omit<PrepareExecutionOptions, "cwd"> = {}): Promise<RunRecord> {
    const workspace = await executionWorkspace(cwd);
    const plan = await prepareExecutionPlan(workflow, { ...options, cwd: workspace });
    return this.startPrepared(plan, input, workspace);
  }
  async startPrepared(plan: ExecutionPlan, input: Json, cwd: string, start?: PreparedStart): Promise<RunRecord> {
    if (start && preparedExecutionId(plan.hash, cwd) !== start.preparedId) throw new Error("Prepared start identity mismatch");
    const existing = start && this.store.findStart(start, input);
    if (existing) return this.completeStart(existing.id);
    const verified = verifyExecutionPlan(plan);
    assertJson(input);
    const workspace = await executionWorkspace(cwd);
    if (start && workspace !== cwd) throw new Error("Prepared workspace now resolves to a different directory; prepare again");
    const run = this.store.create({ id: `run-${randomUUID()}`, plan: verified, input, cwd: workspace, ...(start ? { start } : {}) });
    return this.completeStart(run.id);
  }
  /** Finish only the create-before-reserve gap. A duplicate start never resumes interrupted work. */
  async completeStart(id: string): Promise<RunRecord> {
    await this.launch(id, true);
    return this.store.get(id);
  }
  private async launch(id: string, initialOnly = false): Promise<void> {
    let token: string;
    try { token = this.store.reserveLaunch(id, initialOnly).token; }
    catch (error) {
      const current = this.store.get(id);
      if (error instanceof Error && error.message.startsWith("Run is not launchable:") &&
        (current.ownerToken !== null || current.desired !== "running" || !(initialOnly ? ["queued"] : ["queued", "interrupted"]).includes(current.status))) return;
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
    let processes: string[] | undefined;
    const inventory = () => processes ??= processInventory();
    let supervisorAlive = run.ownerToken !== null && matchesProcess(run.supervisorPid, `--owner ${run.ownerToken}`, supervisorPath);
    const workersAlive = liveWorkerPids(this.store.listActivations(id), inventory).length;
    if (!supervisorAlive && run.ownerToken && run.supervisorPid === null) {
      // Cover the small reserve/spawn/attach window without treating a fresh
      // reservation as proof of either a live process or a failed launch.
      const pid = matchingPids(inventory(), `--owner ${run.ownerToken}`, supervisorPath)[0];
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
      let processes: string[] | undefined;
      for (const pid of liveWorkerPids(this.store.listActivations(id), () => processes ??= processInventory())) {
        try { process.kill(-pid, "SIGTERM"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      }
    }
    if (command === "resume" && ["queued", "interrupted"].includes(run.status) && run.ownerToken === null && run.desired === "running") {
      await this.launch(id); run = this.store.get(id);
    }
    return run;
  }
  async resolve(id: string, waitId: string, response: Json, resolvedBy = "client") {
    this.observe(id);
    const wait = this.store.resolveWait(id, waitId, response, resolvedBy);
    const run = this.store.get(id);
    if (run.ownerToken === null && run.desired === "running" && ["queued", "interrupted"].includes(run.status)) await this.launch(id);
    return wait;
  }
}
