import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ExecutionPlan } from "./execution-types.js";
import type { Json } from "./graph.js";
import type { RuntimeContext } from "./runtime-contract.js";

export type RunStatus = "queued" | "running" | "pausing" | "paused" | "cancelling" | "cancelled" | "succeeded" | "failed" | "interrupted";
export type DesiredRunStatus = "running" | "paused" | "cancelled";
export interface RunRecord {
  id: string;
  plan: ExecutionPlan;
  input: Json;
  cwd: string;
  status: RunStatus;
  desired: DesiredRunStatus;
  ownerToken: string | null;
  supervisorPid: number | null;
  createdAt: number;
  updatedAt: number;
  heartbeatAt: number | null;
  output?: Json;
  error?: string;
}
export type ActivationStatus = "running" | "succeeded" | "failed" | "interrupted";
export interface ActivationMetadata { workerPid?: number | null; sessionFile?: string; [key: string]: Json | undefined }
export interface ActivationRecord {
  runId: string;
  key: string;
  context: RuntimeContext;
  kind: string;
  sideEffect: boolean;
  status: ActivationStatus;
  attempt: number;
  ownerToken: string;
  startedAt: number;
  finishedAt: number | null;
  output?: Json;
  error?: string;
  metadata: ActivationMetadata;
}
export interface RunEvent { seq: number; runId: string; type: string; payload: Json; at: number }
export type RunOutcome = { status: "succeeded"; output: Json } | { status: "failed"; error: string } | { status: "cancelled" };
const terminal = new Set<RunStatus>(["succeeded", "failed", "cancelled"]);
const active = new Set<RunStatus>(["running", "pausing", "paused", "cancelling"]);
export function activationKey(context: RuntimeContext): string {
  return JSON.stringify([context.scope, context.graphId, context.nodeId, context.visit]);
}

/** Durable execution journal. Each process must open its own connection. OS liveness is the caller's responsibility. */
export class RunStore {
  private readonly database: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(dirname(resolve(filename)), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(filename);
    this.database.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY, plan TEXT NOT NULL, input TEXT NOT NULL, cwd TEXT NOT NULL,
        status TEXT NOT NULL, desired TEXT NOT NULL, owner_token TEXT, supervisor_pid INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, heartbeat_at INTEGER,
        output TEXT, error TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workflow_activations (
        run_id TEXT NOT NULL REFERENCES workflow_runs(id), activation_key TEXT NOT NULL,
        context TEXT NOT NULL, kind TEXT NOT NULL, side_effect INTEGER NOT NULL,
        status TEXT NOT NULL, attempt INTEGER NOT NULL, owner_token TEXT NOT NULL,
        started_at INTEGER NOT NULL, finished_at INTEGER, output TEXT, error TEXT,
        metadata TEXT NOT NULL, PRIMARY KEY (run_id, activation_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workflow_run_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES workflow_runs(id),
        type TEXT NOT NULL, payload TEXT NOT NULL, at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS workflow_run_events_cursor ON workflow_run_events(run_id, seq);
    `);
  }
  close(): void { this.database.close(); }
  private transaction<T>(body: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try { const result = body(); this.database.exec("COMMIT"); return result; }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  private event(id: string, type: string, payload: Json): void {
    this.database.prepare("INSERT INTO workflow_run_events(run_id,type,payload,at) VALUES(?,?,?,?)")
      .run(id, type, JSON.stringify(payload), Date.now());
  }
  private owned(id: string, token: string): RunRecord {
    const run = this.get(id);
    if (!token || run.ownerToken !== token || !active.has(run.status)) throw new Error(`Stale run owner: ${id}`);
    return run;
  }
  create(input: { id: string; plan: ExecutionPlan; input: Json; cwd: string }): RunRecord {
    return this.transaction(() => {
      const now = Date.now();
      const inserted = this.database.prepare(`INSERT INTO workflow_runs(id,plan,input,cwd,status,desired,created_at,updated_at)
        VALUES(?,?,?,?,'queued','running',?,?) ON CONFLICT(id) DO NOTHING`)
        .run(input.id, JSON.stringify(input.plan), JSON.stringify(input.input), input.cwd, now, now);
      if (Number(inserted.changes) !== 1) throw new Error(`Run already exists: ${input.id}`);
      this.event(input.id, "run.created", { planHash: input.plan.hash });
      return this.get(input.id);
    });
  }
  get(id: string): RunRecord {
    const row = this.database.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id);
    if (!row) throw new Error(`Run not found: ${id}`);
    return {
      id: String(row.id), plan: JSON.parse(String(row.plan)) as ExecutionPlan, input: JSON.parse(String(row.input)) as Json,
      cwd: String(row.cwd), status: row.status as RunStatus, desired: row.desired as DesiredRunStatus,
      ownerToken: row.owner_token === null ? null : String(row.owner_token), supervisorPid: row.supervisor_pid === null ? null : Number(row.supervisor_pid),
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), heartbeatAt: row.heartbeat_at === null ? null : Number(row.heartbeat_at),
      ...(row.output === null ? {} : { output: JSON.parse(String(row.output)) as Json }),
      ...(row.error === null ? {} : { error: String(row.error) }),
    };
  }
  listRuns(): RunRecord[] {
    return this.database.prepare("SELECT id FROM workflow_runs ORDER BY created_at, id").all().map(row => this.get(String(row.id)));
  }
  /** Atomic reservation. Never reclaim an active reservation based only on a timestamp or PID in this database. */
  reserveLaunch(id: string): { token: string; run: RunRecord } {
    return this.transaction(() => {
      const run = this.get(id);
      if (!["queued", "interrupted"].includes(run.status) || run.desired !== "running" || run.ownerToken !== null) throw new Error(`Run is not launchable: ${id} (${run.status}/${run.desired})`);
      const token = randomUUID();
      const now = Date.now();
      this.database.prepare("UPDATE workflow_runs SET status='running',owner_token=?,supervisor_pid=NULL,heartbeat_at=?,updated_at=?,error=NULL WHERE id=?")
        .run(token, now, now, id);
      this.event(id, "run.reserved", { token });
      return { token, run: this.get(id) };
    });
  }
  attachPid(id: string, token: string, pid: number): void {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid supervisor PID");
    this.transaction(() => {
      const run = this.owned(id, token);
      if (run.supervisorPid !== null && run.supervisorPid !== pid) throw new Error(`Supervisor PID already attached: ${id}`);
      this.database.prepare("UPDATE workflow_runs SET supervisor_pid=?,updated_at=? WHERE id=?").run(pid, Date.now(), id);
      if (run.supervisorPid === null) this.event(id, "run.started", { pid });
    });
  }
  heartbeat(id: string, token: string): void {
    this.transaction(() => {
      this.owned(id, token);
      this.database.prepare("UPDATE workflow_runs SET heartbeat_at=?,updated_at=? WHERE id=?").run(Date.now(), Date.now(), id);
    });
  }
  requestControl(id: string, command: "pause" | "resume" | "cancel"): RunRecord {
    return this.transaction(() => {
      const run = this.get(id);
      if (terminal.has(run.status)) return run;
      const desired: DesiredRunStatus = command === "pause" ? "paused" : command === "cancel" ? "cancelled" : "running";
      // Cancellation is monotonic: a late resume/pause cannot revoke it.
      if (run.desired === "cancelled" && command !== "cancel") return run;
      if (run.desired === desired && (run.ownerToken !== null || run.status !== "interrupted")) return run;
      let status = run.status;
      if (command === "pause") status = run.ownerToken ? "pausing" : "paused";
      if (command === "cancel") status = run.ownerToken ? "cancelling" : "cancelled";
      if (command === "resume") status = run.ownerToken ? "running" : "queued";
      const clearOwner = !run.ownerToken;
      this.database.prepare(`UPDATE workflow_runs SET status=?,desired=?,updated_at=?,
        owner_token=CASE WHEN ? THEN NULL ELSE owner_token END,
        supervisor_pid=CASE WHEN ? THEN NULL ELSE supervisor_pid END WHERE id=?`)
        .run(status, desired, Date.now(), Number(clearOwner), Number(clearOwner), id);
      this.event(id, "run.control", { command, status, desired });
      return this.get(id);
    });
  }
  /** Admit a worktree commit atomically with pause/cancel control; parked structural parents are not active leaves. */
  admitWorkspaceCommit(id: string, token: string, key: string): boolean {
    return this.transaction(() => {
      const run = this.owned(id, token);
      const record = this.runningActivation(id, token, key);
      if (record.kind !== "worktree" || record.metadata.workspacePhase !== "children") throw new Error("Worktree is not ready to commit");
      if (run.desired !== "running" || run.status !== "running") return false;
      const metadata = { ...record.metadata, workspacePhase: "committing" };
      this.database.prepare("UPDATE workflow_activations SET metadata=? WHERE run_id=? AND activation_key=?").run(JSON.stringify(metadata), id, key);
      this.event(id, "activation.metadata", { key, metadata: JSON.parse(JSON.stringify(metadata)) as Json });
      return true;
    });
  }
  markPaused(id: string, token: string): void {
    this.transaction(() => {
      const run = this.owned(id, token);
      // A concurrent resume/cancel can supersede the supervisor's observation.
      if (run.desired !== "paused") return;
      if (run.status === "paused") return;
      const leaves = this.database.prepare("SELECT 1 FROM workflow_activations WHERE run_id=? AND status='running' AND (kind NOT IN ('map','parallel','subworkflow','worktree') OR (kind='worktree' AND COALESCE(json_extract(metadata,'$.workspacePhase'),'allocating') != 'children')) LIMIT 1").get(id);
      if (leaves) throw new Error(`Cannot pause while leaf activations are running: ${id}`);
      this.database.prepare("UPDATE workflow_runs SET status='paused',updated_at=? WHERE id=?").run(Date.now(), id);
      this.event(id, "run.paused", {});
    });
  }
  /** Caller MUST verify the supervisor and its workers are dead before invoking this recovery fence. */
  markInterrupted(id: string, token: string, error: string): void {
    this.transaction(() => {
      this.owned(id, token);
      this.database.prepare("UPDATE workflow_activations SET status='interrupted',error=?,finished_at=? WHERE run_id=? AND status='running'").run(error, Date.now(), id);
      this.database.prepare("UPDATE workflow_runs SET status='interrupted',owner_token=NULL,supervisor_pid=NULL,error=?,updated_at=? WHERE id=?").run(error, Date.now(), id);
      this.event(id, "run.interrupted", { error });
    });
  }
  finish(id: string, token: string, outcome: RunOutcome): void {
    this.transaction(() => {
      const run = this.owned(id, token);
      if (outcome.status === "succeeded" && run.desired !== "running") throw new Error(`Cannot succeed while ${run.desired} is requested`);
      if (outcome.status === "cancelled" && run.desired !== "cancelled") throw new Error("Cancellation was not requested");
      const running = this.database.prepare("SELECT 1 FROM workflow_activations WHERE run_id=? AND status='running' LIMIT 1").get(id);
      if (running) throw new Error("Cannot finish with running activations");
      this.database.prepare("UPDATE workflow_runs SET status=?,output=?,error=?,owner_token=NULL,supervisor_pid=NULL,updated_at=? WHERE id=?")
        .run(outcome.status, outcome.status === "succeeded" ? JSON.stringify(outcome.output) : null,
          outcome.status === "failed" ? outcome.error : null, Date.now(), id);
      this.event(id, `run.${outcome.status}`, outcome.status === "succeeded" ? { output: outcome.output } : outcome.status === "failed" ? { error: outcome.error } : {});
    });
  }
  beginActivation(id: string, token: string, context: RuntimeContext, options: { kind: string; sideEffect: boolean }): ActivationRecord {
    return this.transaction(() => {
      const run = this.owned(id, token);
      if (run.desired !== "running" || run.status !== "running") throw new Error(`Run is not accepting work: ${run.desired}/${run.status}`);
      const key = activationKey(context);
      const old = this.getActivation(id, key);
      if (old && (old.kind !== options.kind || old.sideEffect !== options.sideEffect)) throw new Error(`Activation definition changed: ${key}`);
      if (old?.status === "succeeded") return old;
      if (old?.status === "running") throw new Error(`Activation is already running: ${key}`);
      if (old?.sideEffect) throw new Error(`Uncertain side effect requires explicit retry authorization: ${key}`);
      const now = Date.now();
      this.database.prepare(`INSERT INTO workflow_activations(run_id,activation_key,context,kind,side_effect,status,attempt,owner_token,started_at,metadata)
        VALUES(?,?,?,?,?,'running',?,?,?,?) ON CONFLICT(run_id,activation_key) DO UPDATE SET
        status='running',attempt=excluded.attempt,owner_token=excluded.owner_token,started_at=excluded.started_at,finished_at=NULL,error=NULL,output=NULL`)
        .run(id, key, JSON.stringify(context), options.kind, Number(options.sideEffect), (old?.attempt ?? 0) + 1, token, now, JSON.stringify(old?.metadata ?? {}));
      this.event(id, "activation.started", { key, kind: options.kind, attempt: (old?.attempt ?? 0) + 1 });
      return this.getActivation(id, key)!;
    });
  }
  getActivation(id: string, key: string): ActivationRecord | undefined {
    const row = this.database.prepare("SELECT * FROM workflow_activations WHERE run_id=? AND activation_key=?").get(id, key);
    if (!row) return undefined;
    return {
      runId: String(row.run_id), key: String(row.activation_key), context: JSON.parse(String(row.context)) as RuntimeContext,
      kind: String(row.kind), sideEffect: Boolean(row.side_effect), status: row.status as ActivationStatus, attempt: Number(row.attempt),
      ownerToken: String(row.owner_token), startedAt: Number(row.started_at), finishedAt: row.finished_at === null ? null : Number(row.finished_at),
      ...(row.output === null ? {} : { output: JSON.parse(String(row.output)) as Json }),
      ...(row.error === null ? {} : { error: String(row.error) }), metadata: JSON.parse(String(row.metadata)) as ActivationMetadata,
    };
  }
  completed(id: string, key: string): { output: Json } | undefined {
    const record = this.getActivation(id, key);
    return record?.status === "succeeded" ? { output: record.output! } : undefined;
  }
  listActivations(id: string): ActivationRecord[] {
    return this.database.prepare("SELECT activation_key FROM workflow_activations WHERE run_id=? ORDER BY started_at, activation_key").all(id)
      .map(row => this.getActivation(id, String(row.activation_key))!);
  }
  private runningActivation(id: string, token: string, key: string): ActivationRecord {
    this.owned(id, token);
    const record = this.getActivation(id, key);
    if (!record || record.ownerToken !== token || record.status !== "running") throw new Error(`Activation is not owned and running: ${key}`);
    return record;
  }
  completeActivation(id: string, token: string, key: string, output: Json, metadata?: ActivationMetadata): void {
    this.transaction(() => {
      const record = this.runningActivation(id, token, key);
      this.database.prepare("UPDATE workflow_activations SET status='succeeded',output=?,finished_at=?,metadata=? WHERE run_id=? AND activation_key=?")
        .run(JSON.stringify(output), Date.now(), JSON.stringify({ ...record.metadata, ...metadata }), id, key);
      this.event(id, "activation.succeeded", { key, output });
    });
  }
  failActivation(id: string, token: string, key: string, error: string): void {
    this.transaction(() => {
      this.runningActivation(id, token, key);
      this.database.prepare("UPDATE workflow_activations SET status='failed',error=?,finished_at=? WHERE run_id=? AND activation_key=?")
        .run(error, Date.now(), id, key);
      this.event(id, "activation.failed", { key, error });
    });
  }
  setActivationMetadata(id: string, token: string, key: string, metadata: ActivationMetadata): void {
    this.transaction(() => {
      const record = this.runningActivation(id, token, key);
      this.database.prepare("UPDATE workflow_activations SET metadata=? WHERE run_id=? AND activation_key=?").run(JSON.stringify({ ...record.metadata, ...metadata }), id, key);
      this.event(id, "activation.metadata", { key, metadata: JSON.parse(JSON.stringify(metadata)) as Json });
    });
  }
  appendEvent(id: string, token: string, type: string, payload: Json): void {
    this.transaction(() => { this.owned(id, token); this.event(id, type, payload); });
  }
  events(id: string, after = 0): RunEvent[] {
    return this.database.prepare("SELECT * FROM workflow_run_events WHERE run_id=? AND seq>? ORDER BY seq").all(id, after).map(row => ({
      seq: Number(row.seq), runId: String(row.run_id), type: String(row.type), payload: JSON.parse(String(row.payload)) as Json, at: Number(row.at),
    }));
  }
}
