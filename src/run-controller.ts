import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareExecutionPlan, verifyExecutionPlan, type PrepareExecutionOptions } from "./execution-plan.js";
import { preparedExecutionId, type ExecutionPlan } from "./execution-types.js";
import { executionWorkspace } from "./prepared-plans.js";
import type { Json } from "./graph.js";
import { assertJson } from "./output-schema.js";
import { RunStore, type RunRecord, type PreparedStart, type ActivationRecord } from "./run-store.js";
import { projectRun } from "./observation.js";
import { groupMembers, processGroups, type GroupProcess } from "./process-groups.js";
import { observeRecoveryFiles, recoveryGitDirectories } from "./recovery-files.js";
import { continuationGitBlocker, inspectUncertainWriterGit, recoveryBlockers, recoveryCheckpoint, recoveryOutputContract, recoveryRoots } from "./recovery-inspection.js";
import { isDeepStrictEqual } from "node:util";
import { parseOperation } from "./operation-record.js";
import { GitWorkspaces, parseWorkspaceSources } from "./workspaces.js";
import { parseReconciliationRequest, sameReconciliation, validateReconciledOutput } from "./reconciliation.js";
import {
  ancestrySet, canonicalContinuationRequest, continuationKind, continuationWriterBlockers, digestJson, matchReuseBindings, resolveReuseBinding, sourceActivationSchema, unknownWriterActivations,
  type ContinuationBlocker, type ContinuationRequest,
} from "./lineage.js";

export interface UnresolvedWorkerGroup { key: string; attempt: number; groupPid: number; ownership: "unverified"; processes: GroupProcess[] }

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
      unresolvedGroupProcesses: observed.unresolvedGroups.reduce((sum, group) => sum + group.processes.length, 0),
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
  private async observeContinuationWorkspace(id: string) {
    const state = this.store.recoveryState(id);
    const roots = state.activations.length ? [...new Set(state.activations.flatMap(activation => recoveryRoots(state.run, activation)))] : [state.run.cwd];
    const gitDirectories = (await Promise.all(roots.map(recoveryGitDirectories))).flat();
    const journal = await realpath(this.filename);
    return observeRecoveryFiles([...roots, ...gitDirectories], [...new Set([this.filename, journal])].flatMap(path => [path, path + "-wal", path + "-shm"]).concat(this.directory(id), join(dirname(this.filename), "runs")));
  }
  private continuationWriterStarted(id: string): boolean {
    return this.store.listActivations(id).some(activation => activation.sideEffect);
  }
  private continuationLaunchable(id: string, initialOnly: boolean): boolean {
    const run = this.store.get(id);
    if (this.store.fence(id)) return false;
    return (initialOnly ? ["queued"] : ["queued", "interrupted"]).includes(run.status) && run.desired === "running" && run.ownerToken === null;
  }
  private async continuationGitBlockers(id: string): Promise<ContinuationBlocker[]> {
    const activations = this.store.listActivations(id);
    const git = new GitWorkspaces(id, this.directory(id));
    const blockers: ContinuationBlocker[] = [];
    for (const record of unknownWriterActivations(activations)) {
      if (!parseOperation(record.metadata.operation)) {
        blockers.push({ code: "missing-operation", key: record.key, message: "Missing operation evidence stops continuation; inspect the original attempt instead of inventing an output." });
        continue;
      }
      try { await inspectUncertainWriterGit(git, record, activations); }
      catch (error) { blockers.push(continuationGitBlocker(record, error)); }
    }
    return blockers;
  }
  private async assertContinuationWorkspace(id: string): Promise<void> {
    const receipt = this.store.receiptForTarget(id);
    if (!receipt || this.continuationWriterStarted(id)) return;
    const gitBlockers = await this.continuationGitBlockers(receipt.sourceRunId);
    if (gitBlockers.length) throw new Error(`Continuation is blocked: ${gitBlockers.map(item => item.code).join(", ")}`);
    const observed = await this.observeContinuationWorkspace(receipt.sourceRunId);
    if (observed.digest !== receipt.workspaceDigest) throw new Error("Workspace files changed after continuation inspection");
  }
  private originalProducer(runId: string, activation: ActivationRecord) {
    let currentRunId = runId, current = activation;
    const seen = new Set<string>();
    while (current.kind === "reuse") {
      const identity = `${currentRunId}:${current.key}:${current.attempt}`;
      if (seen.has(identity)) throw new Error("Reuse producer cycle");
      seen.add(identity);
      const run = this.store.get(currentRunId);
      const node = run.plan.workflow.graphs[current.context.graphId]?.nodes.find(item => item.id === current.context.nodeId);
      const bindingId = node?.kind === "reuse" ? node.bindingId : undefined;
      const stored = bindingId ? this.store.reusedBinding(currentRunId, bindingId) : undefined;
      const meta = current.metadata.reused;
      const producerRunId = stored?.producerRunId ?? (meta && typeof meta === "object" && !Array.isArray(meta) && typeof meta.producerRunId === "string" ? meta.producerRunId : "");
      const producerKey = stored?.producerKey ?? (meta && typeof meta === "object" && !Array.isArray(meta) && typeof meta.producerKey === "string" ? meta.producerKey : "");
      const producerAttempt = stored?.producerAttempt ?? (meta && typeof meta === "object" && !Array.isArray(meta) && typeof meta.producerAttempt === "number" ? meta.producerAttempt : 0);
      if (!producerRunId || !producerKey || producerAttempt < 1) throw new Error("Reuse producer identity is missing");
      const producerAct = this.store.getActivation(producerRunId, producerKey);
      if (!producerAct || producerAct.status !== "succeeded" || producerAct.attempt !== producerAttempt || producerAct.output === undefined) {
        throw new Error("Original producer output is missing or not succeeded");
      }
      if (current.output !== undefined && !isDeepStrictEqual(current.output, producerAct.output)) throw new Error("Reuse node output does not match original producer");
      currentRunId = producerRunId; current = producerAct;
    }
    const producerRun = this.store.get(currentRunId);
    const schema = recoveryOutputContract(producerRun, current) ?? producerRun.plan.agents[current.context.graphId]?.[current.context.nodeId]?.outputSchema ?? null;
    return { runId: currentRunId, key: current.key, attempt: current.attempt, graphId: current.context.graphId, nodeId: current.context.nodeId, output: current.output!, schema };
  }
  private async launch(id: string, initialOnly = false): Promise<void> {
    if (this.continuationLaunchable(id, initialOnly)) await this.assertContinuationWorkspace(id);
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
  observe(id: string): { run: RunRecord; supervisorAlive: boolean; workersAlive: number; unresolvedGroups: UnresolvedWorkerGroup[] } {
    let run = this.store.get(id);
    let processes: string[] | undefined;
    const inventory = () => processes ??= processInventory();
    let supervisorAlive = run.ownerToken !== null && matchesProcess(run.supervisorPid, `--owner ${run.ownerToken}`, supervisorPath);
    const activations = this.store.listActivations(id), workerPids = liveWorkerPids(activations, inventory);
    const workersAlive = workerPids.length, unresolvedGroups: UnresolvedWorkerGroup[] = [], emptyGroups: ActivationRecord[] = [];
    let groups: GroupProcess[] | undefined;
    for (const activation of activations) {
      const metadata = activation.metadata;
      if (metadata.workerGroupState !== "pending" || typeof metadata.workerGroupPid !== "number" || typeof metadata.workerToken !== "string" || workerPids.includes(metadata.workerGroupPid)) continue;
      const members = groupMembers(metadata.workerGroupPid, groups ??= processGroups());
      if (members.length) unresolvedGroups.push({ key: activation.key, attempt: activation.attempt, groupPid: metadata.workerGroupPid, ownership: "unverified", processes: members });
      else emptyGroups.push(activation);
    }
    if (!supervisorAlive && run.ownerToken && run.supervisorPid === null) {
      // Cover the small reserve/spawn/attach window without treating a fresh
      // reservation as proof of either a live process or a failed launch.
      const pid = matchingPids(inventory(), `--owner ${run.ownerToken}`, supervisorPath)[0];
      if (pid) {
        try { this.store.attachPid(id, run.ownerToken, pid); }
        catch (error) { if (this.store.get(id).ownerToken === run.ownerToken) throw error; return this.observe(id); }
        run = this.store.get(id); supervisorAlive = true;
      }
      else if (Date.now() - run.updatedAt < 5_000) return { run, supervisorAlive: false, workersAlive, unresolvedGroups };
    }
    if (!supervisorAlive) for (const activation of emptyGroups) this.store.observeWorkerGroupEmpty(id, activation.key, activation.metadata.workerToken as string, activation.metadata.workerGroupPid as number);
    if (run.ownerToken && !supervisorAlive && workersAlive === 0 && unresolvedGroups.length === 0) {
      try { this.store.markInterrupted(id, run.ownerToken, "Supervisor and recorded workers are no longer alive"); }
      catch (error) { if (this.store.get(id).ownerToken === run.ownerToken) throw error; return this.observe(id); }
      run = this.store.get(id);
      if (run.desired === "cancelled") run = this.store.requestControl(id, "cancel");
    }
    return { run, supervisorAlive, workersAlive, unresolvedGroups };
  }
  async control(id: string, command: "pause" | "resume" | "cancel"): Promise<RunRecord> {
    if (command === "resume") await this.assertContinuationWorkspace(id);
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
  /** Explicit inspection hashes local state; it never authorizes another execution. */
  async recovery(id: string, key: string) {
    const observed = this.observe(id), initial = this.store.recoveryState(id);
    const selected = initial.activations.find(a => a.key === key);
    if (!selected) throw new Error("Unknown recovery activation");
    const blockers = recoveryBlockers(initial.run, selected, initial.activations, initial.collections);
    if (observed.supervisorAlive || observed.workersAlive) blockers.push({ code: "live-processes", message: "Execution processes are still alive." });
    if (observed.unresolvedGroups.length) blockers.push({ code: "unresolved-groups", message: "Process groups require inspection before recovery." });
    const checkpoint = recoveryCheckpoint(initial.run, initial.activations, initial.collections, initial.eventSeq);
    let workspace: Awaited<ReturnType<typeof observeRecoveryFiles>> | null = null;
    if (!blockers.length) {
      const roots = recoveryRoots(initial.run, selected);
      const gitDirectories = (await Promise.all(roots.map(recoveryGitDirectories))).flat();
      const journal = await realpath(this.filename);
      workspace = await observeRecoveryFiles([...roots, ...gitDirectories], [...new Set([this.filename, journal])].flatMap(path => [path, path + "-wal", path + "-shm"]).concat(this.directory(id)));
      const current = this.observe(id), final = this.store.recoveryState(id);
      if (current.supervisorAlive || current.workersAlive || current.unresolvedGroups.length || recoveryCheckpoint(final.run, final.activations, final.collections, final.eventSeq) !== checkpoint) throw new Error("Run changed during recovery inspection; inspect again");
    }
    const { workerToken: _token, ...metadata } = selected.metadata;
    return { version: 1 as const, runId: id, planHash: initial.run.plan.hash, key, attempt: selected.attempt, checkpoint,
      status: initial.run.status, desired: initial.run.desired, eventSeq: initial.eventSeq, observedAt: Date.now(), blockers, workspace, outputSchema: recoveryOutputContract(initial.run, selected),
      activation: { context: selected.context, kind: selected.kind, status: selected.status, error: selected.error ?? null, metadata },
      processes: { supervisorAlive: observed.supervisorAlive, workersAlive: observed.workersAlive, unresolvedGroups: observed.unresolvedGroups } };
  }
  async resolve(id: string, waitId: string, response: Json, resolvedBy = "client") {
    this.observe(id);
    const wait = this.store.resolveWait(id, waitId, response, resolvedBy);
    const run = this.store.get(id);
    if (run.ownerToken === null && run.desired === "running" && ["queued", "interrupted"].includes(run.status)) await this.launch(id);
    return wait;
  }
  async reconcile(value: unknown) {
    const request = parseReconciliationRequest(value);
    const existing = this.store.reconciliation(request.id, request.decisionId);
    if (existing) return sameReconciliation(existing, request);
    const inspect = async () => {
      const result = await this.recovery(request.id, request.key);
      if (result.blockers.length) throw new Error(`Recovery is blocked: ${result.blockers.map(b => b.code).join(", ")}`);
      if (result.attempt !== request.attempt || result.checkpoint !== request.checkpoint || result.workspace?.digest !== request.workspaceDigest) throw new Error("Recovery checkpoint or workspace changed; inspect again");
      return result;
    };
    let inspection = await inspect();
    const state = this.store.recoveryState(request.id), selected = state.activations.find(a => a.key === request.key)!;
    if (request.action === "accept") validateReconciledOutput(state.run, selected, request.output!);
    const operation = parseOperation(selected.metadata.operation)!;
    const git = new GitWorkspaces(request.id, this.directory(request.id));
    if (operation.kind === "worktree") {
      if (selected.metadata.workspace === undefined) {
        if (request.action === "accept" || selected.metadata.workspacePhase !== "allocating") throw new Error("No owned workspace allocation was recorded");
      } else {
        const allocating = selected.metadata.workspacePhase === "allocating" && !state.activations.some(a => a.key !== selected.key && operation.childScope.every((part, index) => a.context.scope[index] === part));
        const workspace = request.action === "retry" && allocating
          ? (await git.inspectAllocationRecovery(operation.source, selected.key, selected.metadata.workspace)).allocation
          : await git.inspectWorktree(operation.source, selected.key, selected.metadata.workspace, request.action === "accept" || selected.metadata.workspacePhase === "complete");
        if (selected.metadata.workspacePhase === "complete") {
          const recorded = selected.metadata.workspace as Record<string, Json>;
          if (typeof recorded.head !== "string") throw new Error("Recorded completed workspace head is missing");
          if (!("head" in workspace) || workspace.head !== recorded.head) throw new Error("Workspace head changed after recorded completion");
        }
        if (request.action === "accept") {
          const completed = state.activations.find(a => ["end", "finish"].includes(a.kind) && a.status === "succeeded" && isDeepStrictEqual(a.context.scope, operation.childScope));
          const result = Object.hasOwn(operation, "childResult") ? operation.childResult! : completed?.output;
          if (result === undefined || !isDeepStrictEqual(request.output, { result, workspace })) throw new Error("Accepted worktree output does not match its completed child checkpoint and current Git head");
        }
      }
      inspection = await inspect();
    }
    if (operation.kind === "integrate") {
      const owned = state.activations.filter(a => a.kind === "worktree" && a.status === "succeeded" && a.output !== undefined).flatMap(a => parseWorkspaceSources([a.output!]));
      const actual = await git.inspectIntegration(operation.target, operation.sources, owned, operation.progress, request.action === "accept");
      if (request.action === "accept" && !isDeepStrictEqual(request.output, actual)) throw new Error("Accepted integration output does not match current Git ancestry and source checkpoints");
      inspection = await inspect();
    }
    return this.store.recordReconciliation(request, inspection.workspace!);
  }
  /** Inspect a stopped run for continuation. Inspection authorizes nothing. */
  async continuationInspect(id: string) {
    const observed = this.observe(id), state = this.store.recoveryState(id);
    const fence = this.store.fence(id);
    const blockers: ContinuationBlocker[] = [];
    if (observed.supervisorAlive || observed.workersAlive) blockers.push({ code: "live-processes", message: "Execution processes are still alive." });
    if (observed.unresolvedGroups.length) blockers.push({ code: "unresolved-groups", message: "Process groups require inspection before continuation." });
    if (observed.run.ownerToken) blockers.push({ code: "live-owner", message: "Source still has an execution owner or pending launch reservation." });
    if (fence) blockers.push({ code: "successor-admitted", message: `Source already has an admitted continuation: ${fence.successorRunId}` });
    const checkpoint = recoveryCheckpoint(state.run, state.activations, state.collections, state.eventSeq);
    let workspace: Awaited<ReturnType<typeof observeRecoveryFiles>> | null = null;
    if (!blockers.length) {
      workspace = await this.observeContinuationWorkspace(id);
      const current = this.observe(id), final = this.store.recoveryState(id);
      if (current.supervisorAlive || current.workersAlive || current.unresolvedGroups.length || current.run.ownerToken ||
        recoveryCheckpoint(final.run, final.activations, final.collections, final.eventSeq) !== checkpoint) {
        throw new Error("Run changed during continuation inspection; inspect again");
      }
    }
    blockers.push(...await this.continuationGitBlockers(id));
    const membership = this.store.membership(id);
    const task = membership ? this.store.task(membership.taskId) : null;
    const members = membership ? this.store.taskMembers(membership.taskId) : [];
    const reusable = state.activations.filter(record => record.status === "succeeded" && record.output !== undefined).map(record => {
      const reused = record.metadata.reused;
      const producer = reused && typeof reused === "object" && !Array.isArray(reused) && typeof reused.producerRunId === "string"
        ? { runId: String(reused.producerRunId), key: String(reused.producerKey), attempt: Number(reused.producerAttempt), graphId: String(reused.producerGraphId ?? record.context.graphId), nodeId: String(reused.producerNodeId ?? record.context.nodeId) }
        : { runId: id, key: record.key, attempt: record.attempt, graphId: record.context.graphId, nodeId: record.context.nodeId };
      const sourceSchema = sourceActivationSchema(state.run, record) ?? recoveryOutputContract(state.run, record);
      let producerSchema: Record<string, unknown> | null = record.kind === "reuse" ? null : sourceSchema;
      if (record.kind === "reuse") {
        try { producerSchema = this.originalProducer(id, record).schema; }
        catch { producerSchema = null; }
      }
      return {
        key: record.key, attempt: record.attempt, graphId: record.context.graphId, nodeId: record.context.nodeId, kind: record.kind,
        outputDigest: digestJson(record.output),
        schemaDigest: sourceSchema ? digestJson(sourceSchema) : null,
        producerSchemaDigest: producerSchema ? digestJson(producerSchema) : null,
        producer, artifactRevision: outputField(record.output, "artifactRevision"), acceptanceCriteriaRevision: outputField(record.output, "acceptanceCriteriaRevision"),
      };
    });
    return {
      version: 1 as const, runId: id, planHash: state.run.plan.hash, checkpoint, status: state.run.status, desired: state.run.desired,
      eventSeq: state.eventSeq, observedAt: Date.now(), blockers, workspace,
      workflow: { id: state.run.plan.workflow.id, name: state.run.plan.workflow.name, revision: state.run.plan.workflow.revision },
      preparedId: state.run.preparedId ?? null,
      lineage: membership && task ? { taskId: task.id, rootRunId: task.rootRunId, creationKind: task.creationKind, members, successorRunId: fence?.successorRunId ?? null, launchedWithTask: membership.launchedWithTask } : null,
      reusable,
      writerEffects: state.activations.filter(record => record.sideEffect && record.status !== "succeeded").map(record => ({
        key: record.key, attempt: record.attempt, kind: record.kind, operation: Boolean(record.metadata.operation),
        effects: record.metadata.failure && typeof record.metadata.failure === "object" && !Array.isArray(record.metadata.failure) ? record.metadata.failure.effects ?? "unknown" : "unknown",
      })),
      processes: { supervisorAlive: observed.supervisorAlive, workersAlive: observed.workersAlive, unresolvedGroups: observed.unresolvedGroups, launchPending: observed.run.ownerToken !== null && observed.run.supervisorPid === null && !observed.supervisorAlive },
      facts: "Machine-verified facts are checkpoint, plan hash, output identity and filesystem digest. Actor evidence is attestation, not proof of no outside effects.",
    };
  }
  async continuePrepared(request: ContinuationRequest, plan: ExecutionPlan, cwd: string): Promise<RunRecord> {
    const start = { preparedId: request.preparedId, idempotencyKey: request.idempotencyKey, operation: continuationKind };
    const canonical = canonicalContinuationRequest(request);
    const existing = this.store.findStart(start, request.input, canonical);
    if (existing) return this.store.get(existing.id);
    const verified = verifyExecutionPlan(plan);
    if (preparedExecutionId(verified.hash, cwd) !== request.preparedId) throw new Error("Prepared start identity mismatch");
    const workspace = await executionWorkspace(cwd);
    if (workspace !== cwd) throw new Error("Prepared workspace now resolves to a different directory; prepare again");
    const inspect = async () => {
      const result = await this.continuationInspect(request.source.runId);
      if (result.blockers.length) throw new Error(`Continuation is blocked: ${result.blockers.map(item => item.code).join(", ")}`);
      if (result.checkpoint !== request.source.checkpoint || result.planHash !== request.source.planHash) throw new Error("Source checkpoint or plan changed; inspect again");
      if (!result.workspace || result.workspace.digest !== request.workspaceDigest) throw new Error("Continuation workspace digest missing or changed; inspect again");
      return result;
    };
    const existingAfterRace = (error: unknown) => {
      const again = this.store.findStart(start, request.input, canonical);
      if (again) return again;
      throw error;
    };
    let inspection;
    try { inspection = await inspect(); }
    catch (error) { return this.store.get(existingAfterRace(error).id); }
    const writerBlockers = continuationWriterBlockers(this.store.listActivations(request.source.runId), request.dispositions);
    if (writerBlockers.length) throw new Error(`Continuation is blocked: ${writerBlockers.map(item => item.code).join(", ")}`);
    const gitBlockers = await this.continuationGitBlockers(request.source.runId);
    if (gitBlockers.length) throw new Error(`Continuation is blocked: ${gitBlockers.map(item => item.code).join(", ")}`);
    const pairs = matchReuseBindings(verified, request.reuse);
    const sourceMember = this.store.membership(request.source.runId);
    const members = sourceMember ? this.store.taskMembers(sourceMember.taskId) : [];
    const ancestors = members.length ? ancestrySet(members, request.source.runId) : new Set([request.source.runId]);
    const reused = pairs.map(({ target, binding }) => {
      if (!ancestors.has(binding.sourceRunId)) throw new Error(`Reuse source is not an allowed ancestor: ${binding.bindingId}`);
      const sourceRun = this.store.get(binding.sourceRunId);
      const sourceActivation = this.store.getActivation(binding.sourceRunId, binding.activationKey);
      if (!sourceActivation) throw new Error(`Missing reuse source activation: ${binding.bindingId}`);
      const producer = this.originalProducer(binding.sourceRunId, sourceActivation);
      return resolveReuseBinding({ binding, target, sourceRun, sourceActivation, sourcePlanHash: sourceRun.plan.hash, input: request.input, producer });
    });
    try { inspection = await inspect(); }
    catch (error) { return this.store.get(existingAfterRace(error).id); }
    const paused = inspection.desired === "paused" || inspection.status === "paused";
    const id = `run-${randomUUID()}`;
    let run;
    try {
      run = this.store.createContinuation({
        id, plan: verified, cwd: workspace, start, request, reused, paused,
      });
    } catch (error) { return this.store.get(existingAfterRace(error).id); }
    if (run.id !== id) return this.store.get(run.id);
    return this.completeStart(run.id);
  }
}
function outputField(value: Json | undefined, field: string): string | undefined {
  return value && typeof value === "object" && !Array.isArray(value) && typeof value[field] === "string" ? value[field] : undefined;
}
