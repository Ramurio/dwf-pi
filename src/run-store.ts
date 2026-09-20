import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openWorkflowDatabase } from "./sqlite.js";
import { preparedExecutionId, type ExecutionPlan } from "./execution-types.js";
import { executionFailure, parseExecutionFailure, parseFailureCauses, type ExecutionFailureRecord } from "./execution-failure.js";
import type { Json } from "./graph.js";
import type { RuntimeContext } from "./runtime-contract.js";
import { parseUsage, sumTokenUsage, summarizeUsage, summarizeTaskUsage, type TokenUsage } from "./usage.js";
import { assertJson, createOutputValidator } from "./output-schema.js";
import { explicitOutcome, legacyOutcome, type TaskOutcome, type TaskDecision } from "./task-outcome.js";
import { isDeepStrictEqual } from "node:util";
import type { RoutingDecision } from "./expressions.js";
import { validateCollectedResult, type CollectedResult, type CollectionRecord } from "./collection.js";
import { parseRetryProgress, permitsRetry, retryDelay, retryProgress, retryRemaining, RetryNotReady, type RetryRecord } from "./retry-policy.js";
import { parseOperation } from "./operation-record.js";
import { recoveryBlockers, recoveryCheckpoint } from "./recovery-inspection.js";
import type { WorkspaceObservation } from "./recovery-files.js";
import { parseReconciliationRequest, sameReconciliation, validateReconciledOutput, type ReconciliationRecord, type ReconciliationRequest } from "./reconciliation.js";
import { supportsGeneratedRouting } from "./compiler-versions.js";
import {
  canonicalContinuationRequest, canonicalStartRequest, continuationKind, planHasReuse, publicReceipt, sameCanonicalRequest, startKind,
  type ContinuationReceiptRecord, type ContinuationRequest, type MembershipRole, type PublicReusedBinding, type ReusedOutputRecord, type RunLineage, type TaskMembershipRecord,
} from "./lineage.js";

export type RunStatus = "queued" | "running" | "waiting" | "pausing" | "paused" | "cancelling" | "cancelled" | "succeeded" | "failed" | "interrupted";
export type DesiredRunStatus = "running" | "paused" | "cancelled";
/** Atomic control-state admission refusal; no activation has been started. */
export class RunNotAcceptingWork extends Error {
  constructor(readonly desired: DesiredRunStatus, readonly status: RunStatus) {
    super(`Run is not accepting work: ${desired}/${status}`);
    this.name = "RunNotAcceptingWork";
  }
}
export interface RunRecord {
  id: string;
  plan: ExecutionPlan;
  input: Json;
  cwd: string;
  status: RunStatus;
  desired: DesiredRunStatus;
  ownerToken: string | null;
  supervisorPid: number | null;
  supervisorLaunch?: { ownerToken: string; script: string; store: string };
  createdAt: number;
  updatedAt: number;
  heartbeatAt: number | null;
  preparedId?: string;
  output?: Json;
  error?: string;
  taskOutcome?: TaskOutcome;
  failure?: ExecutionFailureRecord;
  lineage?: RunLineage;
}
type ControlRecord = Pick<RunRecord, "id" | "cwd" | "status" | "desired" | "ownerToken" | "supervisorPid">;
type ExecutionRecord = ControlRecord & Pick<RunRecord, "plan">;
export type ActivationStatus = "running" | "succeeded" | "failed" | "interrupted";
export interface PreparedStart { preparedId: string; idempotencyKey?: string; operation?: "start" | "continue" }
export type { RunLineage, TaskMembershipRecord, ContinuationReceiptRecord, ReusedOutputRecord } from "./lineage.js";
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
export interface AttemptRecord extends ActivationRecord {
  accounting: { recorded: boolean; complete: boolean; responses: number; usage: TokenUsage | null };
}
export interface TransitionRecord { seq: number; runId: string; key: string; context: RuntimeContext; attempt: number; at: number; decision: RoutingDecision }
export interface WaitRecord {
  id: string; runId: string; key: string; reason: string; input: Json; responseSchema: Record<string, unknown>;
  status: "open" | "resolved"; createdAt: number; resolvedAt: number | null; resolvedBy: string | null; response?: Json;
}
export type EffortSource = "sdk-message" | "request-payload" | "unknown";
export interface UsageRecord { seq: number; runId: string; key: string; attempt: number; reportId: string; usage: TokenUsage; stopReason: string; at: number; source: "pi-sdk"; observedEffort?: string; observedEffortSource?: EffortSource }
export type RunOutcome = { status: "succeeded"; output: Json } | { status: "failed"; error: string; failure?: ExecutionFailureRecord } | { status: "cancelled" };
const terminal = new Set<RunStatus>(["succeeded", "failed", "cancelled"]);
const active = new Set<RunStatus>(["running", "waiting", "pausing", "paused", "cancelling"]);
const leafSql = "kind NOT IN ('map','parallel','subworkflow','worktree') AND NOT (kind='await' AND COALESCE(json_extract(metadata,'$.waiting'),0)=1) OR (kind='worktree' AND COALESCE(json_extract(metadata,'$.workspacePhase'),'allocating') != 'children')";
export function activationKey(context: RuntimeContext): string {
  return JSON.stringify([context.scope, context.graphId, context.nodeId, context.visit]);
}

/** Durable execution journal. Each process must open its own connection. OS liveness is the caller's responsibility. */
export class RunStore {
  private readonly database: DatabaseSync;
  constructor(filename: string) {
    this.database = openWorkflowDatabase(filename, `
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
      CREATE TABLE IF NOT EXISTS workflow_usage_attempts (
        run_id TEXT NOT NULL, activation_key TEXT NOT NULL, attempt INTEGER NOT NULL,
        complete INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(run_id, activation_key, attempt),
        FOREIGN KEY(run_id, activation_key) REFERENCES workflow_activations(run_id, activation_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workflow_usage_reports (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
        activation_key TEXT NOT NULL, attempt INTEGER NOT NULL, report_id TEXT NOT NULL,
        usage TEXT NOT NULL, stop_reason TEXT NOT NULL, at INTEGER NOT NULL,
        UNIQUE(run_id, activation_key, attempt, report_id),
        FOREIGN KEY(run_id, activation_key, attempt) REFERENCES workflow_usage_attempts(run_id, activation_key, attempt)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS workflow_usage_cursor ON workflow_usage_reports(run_id, seq);
      CREATE TABLE IF NOT EXISTS workflow_task_outcomes (
        run_id TEXT PRIMARY KEY REFERENCES workflow_runs(id), outcome TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workflow_waits (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, activation_key TEXT NOT NULL,
        reason TEXT NOT NULL, input TEXT NOT NULL, response_schema TEXT NOT NULL,
        status TEXT NOT NULL, created_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by TEXT, response TEXT,
        UNIQUE(run_id, activation_key),
        FOREIGN KEY(run_id, activation_key) REFERENCES workflow_activations(run_id, activation_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workflow_transitions (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, activation_key TEXT NOT NULL,
        attempt INTEGER NOT NULL, at INTEGER NOT NULL, decision TEXT NOT NULL,
        UNIQUE(run_id,activation_key), FOREIGN KEY(run_id,activation_key) REFERENCES workflow_activations(run_id,activation_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS workflow_transitions_cursor ON workflow_transitions(run_id,seq);
      CREATE TABLE IF NOT EXISTS workflow_run_starts (
        run_id TEXT PRIMARY KEY REFERENCES workflow_runs(id), prepared_id TEXT NOT NULL,
        idempotency_key TEXT UNIQUE, operation TEXT NOT NULL DEFAULT 'start', canonical_request TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workflow_activation_history (
        run_id TEXT NOT NULL, activation_key TEXT NOT NULL, attempt INTEGER NOT NULL, record TEXT NOT NULL,
        PRIMARY KEY(run_id,activation_key,attempt),
        FOREIGN KEY(run_id,activation_key) REFERENCES workflow_activations(run_id,activation_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workflow_run_failures (
        run_id TEXT PRIMARY KEY REFERENCES workflow_runs(id), failure TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workflow_collections (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, activation_key TEXT NOT NULL,
        item_id TEXT NOT NULL, attempt INTEGER NOT NULL, at INTEGER NOT NULL, result TEXT NOT NULL,
        UNIQUE(run_id,activation_key,item_id),
        FOREIGN KEY(run_id,activation_key) REFERENCES workflow_activations(run_id,activation_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS workflow_collections_cursor ON workflow_collections(run_id,activation_key,seq);
      CREATE TABLE IF NOT EXISTS workflow_retries (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, activation_key TEXT NOT NULL,
        attempt INTEGER NOT NULL, at INTEGER NOT NULL, delay_ms INTEGER NOT NULL, due_at INTEGER, failure TEXT NOT NULL,
        UNIQUE(run_id,activation_key,attempt),
        FOREIGN KEY(run_id,activation_key) REFERENCES workflow_activations(run_id,activation_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS workflow_retries_cursor ON workflow_retries(run_id,activation_key,seq);
      CREATE TABLE IF NOT EXISTS workflow_retry_causes (
        retry_seq INTEGER PRIMARY KEY REFERENCES workflow_retries(seq) ON DELETE CASCADE,
        causes TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workflow_reconciliations (
        run_id TEXT NOT NULL REFERENCES workflow_runs(id), decision_id TEXT NOT NULL,
        activation_key TEXT NOT NULL, source_attempt INTEGER NOT NULL, request TEXT NOT NULL,
        plan_hash TEXT NOT NULL, workspace TEXT NOT NULL, created_at INTEGER NOT NULL, supersedes TEXT,
        PRIMARY KEY(run_id,decision_id), UNIQUE(run_id,supersedes),
        FOREIGN KEY(run_id,supersedes) REFERENCES workflow_reconciliations(run_id,decision_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workflow_reconciliation_applications (
        run_id TEXT NOT NULL, decision_id TEXT NOT NULL, attempt INTEGER NOT NULL, at INTEGER NOT NULL,
        PRIMARY KEY(run_id,decision_id),
        FOREIGN KEY(run_id,decision_id) REFERENCES workflow_reconciliations(run_id,decision_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workflow_tasks (
        id TEXT PRIMARY KEY, root_run_id TEXT NOT NULL REFERENCES workflow_runs(id),
        created_at INTEGER NOT NULL, creation_kind TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workflow_continuation_receipts (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES workflow_tasks(id),
        actor TEXT NOT NULL, reason TEXT NOT NULL, evidence TEXT NOT NULL,
        source_run_id TEXT NOT NULL REFERENCES workflow_runs(id), source_plan_hash TEXT NOT NULL, source_checkpoint TEXT NOT NULL,
        target_prepared_id TEXT NOT NULL, target_plan_hash TEXT NOT NULL, target_run_id TEXT NOT NULL UNIQUE REFERENCES workflow_runs(id),
        canonical_request TEXT NOT NULL, workspace_digest TEXT NOT NULL, created_at INTEGER NOT NULL, paused INTEGER NOT NULL, admitted INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workflow_task_membership (
        run_id TEXT PRIMARY KEY REFERENCES workflow_runs(id), task_id TEXT NOT NULL REFERENCES workflow_tasks(id),
        parent_run_id TEXT REFERENCES workflow_runs(id), role TEXT NOT NULL,
        receipt_id TEXT REFERENCES workflow_continuation_receipts(id),
        created_at INTEGER NOT NULL, launched_with_task INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workflow_reused_outputs (
        binding_id TEXT NOT NULL, receipt_id TEXT NOT NULL REFERENCES workflow_continuation_receipts(id),
        source_run_id TEXT NOT NULL REFERENCES workflow_runs(id), source_plan_hash TEXT NOT NULL,
        source_activation_key TEXT NOT NULL, source_attempt INTEGER NOT NULL,
        source_graph_id TEXT NOT NULL, source_node_id TEXT NOT NULL,
        output_digest TEXT NOT NULL, schema_digest TEXT NOT NULL, producer_schema_digest TEXT, value TEXT NOT NULL,
        target_graph_id TEXT NOT NULL, target_node_id TEXT NOT NULL,
        producer_run_id TEXT NOT NULL REFERENCES workflow_runs(id), producer_key TEXT NOT NULL, producer_attempt INTEGER NOT NULL,
        producer_graph_id TEXT NOT NULL, producer_node_id TEXT NOT NULL,
        artifact_revision TEXT, acceptance_criteria_revision TEXT,
        PRIMARY KEY (receipt_id, binding_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workflow_continuation_fences (
        source_run_id TEXT PRIMARY KEY REFERENCES workflow_runs(id),
        successor_run_id TEXT NOT NULL UNIQUE REFERENCES workflow_runs(id),
        receipt_id TEXT NOT NULL UNIQUE REFERENCES workflow_continuation_receipts(id),
        created_at INTEGER NOT NULL
      ) STRICT;
    `);
    this.migrateStartColumns();
  }
  private migrateStartColumns(): void {
    this.transaction(() => {
      const runCols = this.database.prepare("PRAGMA table_info(workflow_runs)").all().map(row => String(row.name));
      if (!runCols.includes("supervisor_launch")) this.database.exec("ALTER TABLE workflow_runs ADD COLUMN supervisor_launch TEXT");
      const cols = this.database.prepare("PRAGMA table_info(workflow_run_starts)").all().map(row => String(row.name));
      if (!cols.includes("operation")) this.database.exec("ALTER TABLE workflow_run_starts ADD COLUMN operation TEXT NOT NULL DEFAULT 'start'");
      if (!cols.includes("canonical_request")) this.database.exec("ALTER TABLE workflow_run_starts ADD COLUMN canonical_request TEXT");
      const receipts = this.database.prepare("PRAGMA table_info(workflow_continuation_receipts)").all().map(row => String(row.name));
      if (receipts.length && !receipts.includes("workspace_digest")) this.database.exec("ALTER TABLE workflow_continuation_receipts ADD COLUMN workspace_digest TEXT NOT NULL DEFAULT ''");
      if (receipts.length && !receipts.includes("admitted")) this.database.exec("ALTER TABLE workflow_continuation_receipts ADD COLUMN admitted INTEGER NOT NULL DEFAULT 0");
      const reusedCols = this.database.prepare("PRAGMA table_info(workflow_reused_outputs)").all().map(row => String(row.name));
      if (reusedCols.length && !reusedCols.includes("producer_schema_digest")) this.database.exec("ALTER TABLE workflow_reused_outputs ADD COLUMN producer_schema_digest TEXT");
    });
  }
  close(): void { this.database.close(); }
  private transaction<T>(body: () => T, mode: "write" | "read" = "write"): T {
    this.database.exec(mode === "write" ? "BEGIN IMMEDIATE" : "BEGIN");
    try { const result = body(); this.database.exec("COMMIT"); return result; }
    catch (error) {
      // SQLite can roll back automatically (e.g. SQLITE_FULL). Never replace
      // the storage failure with "no transaction is active" from cleanup.
      try { this.database.exec("ROLLBACK"); } catch (rollbackError) {
        if (error instanceof Error && Object.isExtensible(error) && !Object.hasOwn(error, "rollbackError")) {
          Object.defineProperty(error, "rollbackError", { value: rollbackError });
        }
      }
      throw error;
    }
  }
  private event(id: string, type: string, payload: Json): void {
    this.database.prepare("INSERT INTO workflow_run_events(run_id,type,payload,at) VALUES(?,?,?,?)")
      .run(id, type, JSON.stringify(payload), Date.now());
  }
  /** Свежие поля допуска без разбора больших input/output и публичной истории. */
  controlState(id: string): ControlRecord {
    const row = this.database.prepare("SELECT id,cwd,status,desired,owner_token,supervisor_pid FROM workflow_runs WHERE id=?").get(id);
    if (!row) throw new Error(`Run not found: ${id}`);
    return { id: String(row.id), cwd: String(row.cwd), status: row.status as RunStatus, desired: row.desired as DesiredRunStatus,
      ownerToken: row.owner_token === null ? null : String(row.owner_token), supervisorPid: row.supervisor_pid === null ? null : Number(row.supervisor_pid) };
  }
  private executionState(id: string): ExecutionRecord {
    const control = this.controlState(id), database = this.database;
    return { ...control, get plan() {
      const row = database.prepare("SELECT plan FROM workflow_runs WHERE id=?").get(id);
      if (!row) throw new Error(`Run not found: ${id}`);
      return JSON.parse(String(row.plan)) as ExecutionPlan;
    } };
  }
  private owned(id: string, token: string): ExecutionRecord {
    const run = this.executionState(id);
    if (!token || run.ownerToken !== token || !active.has(run.status)) throw new Error(`Stale run owner: ${id}`);
    return run;
  }
  /** Lookup before reading mutable resources or checking cwd. JSON object key order is immaterial. */
  findStart(start: PreparedStart, input: Json, canonical?: Json): RunRecord | undefined {
    if (start.idempotencyKey === undefined) return undefined;
    if (!start.idempotencyKey.length || start.idempotencyKey.includes("\0")) throw new Error("Invalid idempotency key");
    assertJson(input);
    if (canonical !== undefined) assertJson(canonical);
    const row = this.database.prepare("SELECT run_id,prepared_id,operation,canonical_request FROM workflow_run_starts WHERE idempotency_key=?").get(start.idempotencyKey);
    if (!row) return undefined;
    const run = this.get(String(row.run_id));
    const storedOperation = String(row.operation ?? startKind);
    const requested = start.operation ?? (canonical && (canonical as { kind?: string }).kind === continuationKind ? continuationKind : startKind);
    if (storedOperation !== requested) throw new Error("Start idempotency conflict: key is already bound to a different operation");
    if (requested === continuationKind) {
      if (canonical === undefined || !sameCanonicalRequest(row.canonical_request === null ? null : String(row.canonical_request), canonical)) {
        throw new Error("Start idempotency conflict: key is already bound to a different continuation request");
      }
    } else if (row.prepared_id !== start.preparedId || !isDeepStrictEqual(run.input, JSON.parse(JSON.stringify(input))) ||
      (row.canonical_request !== null && !sameCanonicalRequest(String(row.canonical_request), canonicalStartRequest(start.preparedId, input)))) {
      throw new Error("Start idempotency conflict: key is already bound to a different prepared plan or input");
    }
    return run;
  }
  create(input: { id: string; plan: ExecutionPlan; input: Json; cwd: string; start?: PreparedStart }): RunRecord {
    assertJson(input.input);
    if (input.start && preparedExecutionId(input.plan.hash, input.cwd) !== input.start.preparedId) throw new Error("Prepared start identity mismatch");
    if (planHasReuse(input.plan.workflow)) throw new Error("Reuse-bearing plan requires a continuation receipt; use run.continue");
    return this.transaction(() => {
      const existing = input.start && this.findStart(input.start, input.input);
      if (existing) return existing;
      const now = Date.now();
      const inserted = this.database.prepare(`INSERT INTO workflow_runs(id,plan,input,cwd,status,desired,created_at,updated_at)
        VALUES(?,?,?,?,'queued','running',?,?) ON CONFLICT(id) DO NOTHING`)
        .run(input.id, JSON.stringify(input.plan), JSON.stringify(input.input), input.cwd, now, now);
      if (Number(inserted.changes) !== 1) throw new Error(`Run already exists: ${input.id}`);
      if (input.start) this.database.prepare("INSERT INTO workflow_run_starts(run_id,prepared_id,idempotency_key,operation,canonical_request) VALUES(?,?,?,?,?)")
        .run(input.id, input.start.preparedId, input.start.idempotencyKey ?? null, startKind, JSON.stringify(canonicalStartRequest(input.start.preparedId, input.input)));
      this.event(input.id, "run.created", { planHash: input.plan.hash, ...(input.start ? { preparedId: input.start.preparedId } : {}) });
      this.insertRootTask(input.id, now);
      return this.get(input.id);
    });
  }
  get(id: string): RunRecord {
    const row = this.database.prepare(`SELECT r.*, t.outcome AS task_outcome, s.prepared_id, f.failure FROM workflow_runs r
      LEFT JOIN workflow_task_outcomes t ON t.run_id=r.id LEFT JOIN workflow_run_starts s ON s.run_id=r.id
      LEFT JOIN workflow_run_failures f ON f.run_id=r.id WHERE r.id = ?`).get(id);
    if (!row) throw new Error(`Run not found: ${id}`);
    const record: RunRecord = {
      id: String(row.id), plan: JSON.parse(String(row.plan)) as ExecutionPlan, input: JSON.parse(String(row.input)) as Json,
      cwd: String(row.cwd), status: row.status as RunStatus, desired: row.desired as DesiredRunStatus,
      ownerToken: row.owner_token === null ? null : String(row.owner_token), supervisorPid: row.supervisor_pid === null ? null : Number(row.supervisor_pid),
      ...(row.supervisor_launch == null ? {} : { supervisorLaunch: JSON.parse(String(row.supervisor_launch)) as NonNullable<RunRecord["supervisorLaunch"]> }),
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), heartbeatAt: row.heartbeat_at === null ? null : Number(row.heartbeat_at),
      ...(row.prepared_id === null ? {} : { preparedId: String(row.prepared_id) }),
      ...(row.output === null ? {} : { output: JSON.parse(String(row.output)) as Json }),
      ...(row.error === null ? {} : { error: String(row.error) }),
      ...(row.failure === null || !["failed","interrupted"].includes(String(row.status)) ? {} : { failure: JSON.parse(String(row.failure)) as ExecutionFailureRecord }),
      ...(row.status === "succeeded" ? { taskOutcome: row.task_outcome === null
        ? legacyOutcome(JSON.parse(String(row.output))) : JSON.parse(String(row.task_outcome)) as TaskOutcome } : {}),
    };
    const lineage = this.readLineage(record.id);
    return lineage ? { ...record, lineage } : record;
  }
  listRuns(): RunRecord[] {
    return this.database.prepare("SELECT id FROM workflow_runs ORDER BY created_at, id").all().map(row => this.get(String(row.id)));
  }
  /** Atomic reservation. Never reclaim an active reservation based only on a timestamp or PID in this database. */
  reserveLaunch(id: string, initialOnly = false, launch?: { script: string; store: string }): { token: string; run: RunRecord } {
    return this.transaction(() => {
      const run = this.get(id);
      if (this.fence(id)) throw new Error(`Run was replaced by a continuation and cannot be relaunched: ${id}`);
      if (!(initialOnly ? ["queued"] : ["queued", "interrupted"]).includes(run.status) || run.desired !== "running" || run.ownerToken !== null) throw new Error(`Run is not launchable: ${id} (${run.status}/${run.desired})`);
      if (this.hasPendingWorkerGroups(id)) throw executionFailure("uncertain-effect", "recovery", "unknown", "Worker process groups have not been verified empty");
      const token = randomUUID();
      const now = Date.now();
      this.database.prepare("UPDATE workflow_runs SET status='running',owner_token=?,supervisor_pid=NULL,supervisor_launch=?,heartbeat_at=?,updated_at=?,error=NULL WHERE id=?")
        .run(token, launch ? JSON.stringify({ ...launch, ownerToken: token }) : null, now, now, id);
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
      if (command === "resume" && this.fence(id)) throw new Error(`Run was replaced by a continuation and cannot be resumed: ${id}`);
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
      if (run.desired !== "running" || !["running", "waiting"].includes(run.status)) return false;
      const metadata = { ...record.metadata, workspacePhase: "committing" };
      this.database.prepare("UPDATE workflow_activations SET metadata=? WHERE run_id=? AND activation_key=?").run(JSON.stringify(metadata), id, key);
      this.event(id, "activation.metadata", { key, attempt: record.attempt, metadata: JSON.parse(JSON.stringify(metadata)) as Json });
      return true;
    });
  }
  markPaused(id: string, token: string): void {
    this.transaction(() => {
      const run = this.owned(id, token);
      // A concurrent resume/cancel can supersede the supervisor's observation.
      if (run.desired !== "paused") return;
      if (run.status === "paused") return;
      const leaves = this.database.prepare(`SELECT 1 FROM workflow_activations WHERE run_id=? AND status='running' AND (${leafSql}) LIMIT 1`).get(id);
      if (leaves) throw new Error(`Cannot pause while leaf activations are running: ${id}`);
      this.database.prepare("UPDATE workflow_runs SET status='paused',updated_at=? WHERE id=?").run(Date.now(), id);
      this.event(id, "run.paused", {});
    });
  }
  /** Waiting is an observed lack of runnable leaves, not an operator pause. */
  updateWaiting(id: string, token: string): void {
    this.transaction(() => {
      const run = this.owned(id, token);
      if (run.desired !== "running" || !["running", "waiting"].includes(run.status)) return;
      const pending = this.database.prepare("SELECT 1 FROM workflow_activations WHERE run_id=? AND status='running' AND kind='await' AND json_extract(metadata,'$.waiting')=1 LIMIT 1").get(id);
      const leaves = this.database.prepare(`SELECT 1 FROM workflow_activations WHERE run_id=? AND status='running' AND (${leafSql}) LIMIT 1`).get(id);
      const retry = this.database.prepare("SELECT 1 FROM workflow_activations WHERE run_id=? AND status='failed' AND json_extract(metadata,'$.retry.status')='scheduled' LIMIT 1").get(id);
      const status = pending && !leaves && !retry ? "waiting" : "running";
      if (status === run.status) return;
      this.database.prepare("UPDATE workflow_runs SET status=?,updated_at=? WHERE id=?").run(status, Date.now(), id);
      this.event(id, `run.${status}`, {});
    });
  }
  /** Caller MUST verify the supervisor and its workers are dead before invoking this recovery fence. */
  markInterrupted(id: string, token: string, error: string): void {
    this.transaction(() => {
      this.owned(id, token);
      if (this.hasPendingWorkerGroups(id)) throw executionFailure("uncertain-effect", "recovery", "unknown", "Worker process groups have not been verified empty");
      const failure = executionFailure("interrupted","execution","unknown",error).failure;
      this.database.prepare("UPDATE workflow_activations SET status='interrupted',error=?,finished_at=?,metadata=json_set(metadata,'$.failure',json(?)) WHERE run_id=? AND status='running'").run(error, Date.now(), JSON.stringify(failure), id);
      this.database.prepare("INSERT INTO workflow_run_failures(run_id,failure) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET failure=excluded.failure").run(id,JSON.stringify(failure));
      this.database.prepare("UPDATE workflow_runs SET status='interrupted',owner_token=NULL,supervisor_pid=NULL,error=?,updated_at=? WHERE id=?").run(error, Date.now(), id);
      this.event(id, "run.interrupted", { error, failure: JSON.parse(JSON.stringify(failure)) as Json });
    });
  }
  private abandonScheduledRetries(id: string, reason: string, key?: string): void {
    for (const row of this.database.prepare("SELECT activation_key,metadata FROM workflow_activations WHERE run_id=? AND json_extract(metadata,'$.retry.status')='scheduled'" + (key === undefined ? "" : " AND activation_key=?")).all(...(key === undefined ? [id] : [id, key]))) {
      const metadata = JSON.parse(String(row.metadata)), progress = parseRetryProgress(metadata.retry);
      if (!progress) continue;
      const abandoned = { ...progress, status: "abandoned" };
      this.database.prepare("UPDATE workflow_activations SET metadata=json_set(metadata,'$.retry',json(?)) WHERE run_id=? AND activation_key=?").run(JSON.stringify(abandoned),id,String(row.activation_key));
      this.event(id,"retry.abandoned",{key:String(row.activation_key),retry:abandoned,reason});
    }
  }
  finish(id: string, token: string, outcome: RunOutcome): void {
    this.transaction(() => {
      const run = this.owned(id, token);
      if (outcome.status === "succeeded" && run.desired !== "running") throw new Error(`Cannot succeed while ${run.desired} is requested`);
      if (outcome.status === "succeeded" && this.hasPendingWorkerGroups(id)) throw executionFailure("uncertain-effect", "cleanup", "unknown", "Worker process groups have not been verified empty");
      this.abandonScheduledRetries(id, outcome.status);
      if (outcome.status === "cancelled" && run.desired !== "cancelled") throw new Error("Cancellation was not requested");
      const running = this.database.prepare("SELECT 1 FROM workflow_activations WHERE run_id=? AND status='running' LIMIT 1").get(id);
      if (running) throw new Error("Cannot finish with running activations");
      const failure = outcome.status === "failed" ? outcome.failure ?? executionFailure("unknown","execution","unknown",outcome.error).failure : undefined;
      if (failure && !parseExecutionFailure(failure)) throw new Error("Invalid structured execution failure");
      if (failure) this.database.prepare("INSERT INTO workflow_run_failures(run_id,failure) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET failure=excluded.failure").run(id,JSON.stringify(failure));
      else this.database.prepare("DELETE FROM workflow_run_failures WHERE run_id=?").run(id);
      let taskOutcome: TaskOutcome | undefined;
      if (outcome.status === "succeeded") {
        const root = this.listActivations(id).find(a => a.kind === "finish" && a.status === "succeeded" &&
          a.context.graphId === run.plan.workflow.entryGraph && isDeepStrictEqual(a.context.scope, ["graph", run.plan.workflow.entryGraph]));
        const declared = root?.metadata.taskOutcome as unknown as TaskOutcome | undefined;
        taskOutcome = declared ? explicitOutcome(declared.decision as TaskDecision, declared.reason, declared.evidence) : legacyOutcome(outcome.output);
        this.database.prepare("INSERT INTO workflow_task_outcomes(run_id,outcome) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET outcome=excluded.outcome")
          .run(id, JSON.stringify(taskOutcome));
      }
      this.database.prepare("UPDATE workflow_runs SET status=?,output=?,error=?,owner_token=NULL,supervisor_pid=NULL,updated_at=? WHERE id=?")
        .run(outcome.status, outcome.status === "succeeded" ? JSON.stringify(outcome.output) : null,
          outcome.status === "failed" ? outcome.error : null, Date.now(), id);
      this.event(id, `run.${outcome.status}`, outcome.status === "succeeded" ? { output: outcome.output, taskOutcome: JSON.parse(JSON.stringify(taskOutcome)) as Json } : outcome.status === "failed" ? { error: outcome.error, failure: JSON.parse(JSON.stringify(failure)) as Json } : {});
    });
  }
  beginActivation(id: string, token: string, context: RuntimeContext, options: { kind: string; sideEffect: boolean; reconciliation?: string }): ActivationRecord {
    return this.transaction(() => {
      const run = this.owned(id, token);
      if (run.desired !== "running" || !["running", "waiting"].includes(run.status)) throw new RunNotAcceptingWork(run.desired, run.status);
      const key = activationKey(context);
      const old = this.getActivation(id, key);
      if (old && (old.kind !== options.kind || old.sideEffect !== options.sideEffect)) throw new Error(`Activation definition changed: ${key}`);
      if (old?.metadata.workerGroupState === "pending") throw executionFailure("uncertain-effect", "recovery", "unknown", "Prior worker process group has not been verified empty");
      if (old?.status === "succeeded") return old;
      if (old?.status === "running") throw new Error(`Activation is already running: ${key}`);
      const manual = this.pendingReconciliation(id, key);
      if (manual && (options.reconciliation !== manual.request.decisionId || manual.request.attempt !== old?.attempt || manual.planHash !== run.plan.hash)) throw new Error("Reconciliation requires fresh admission inspection");
      if (options.reconciliation && !manual) throw new Error("Reconciliation authorization is no longer pending");
      const decision = manual ? undefined : this.plannedRetry(run,old), allowed = !!decision;
      if (decision && retryRemaining(retryProgress(decision,"scheduled")) > 0) throw new RetryNotReady();
      if (old?.sideEffect && !allowed && !manual && !(old.kind === "worktree" && old.metadata.workspacePhase === "children")) throw executionFailure("uncertain-effect","recovery","unknown",`Uncertain side effect requires explicit retry authorization: ${key}`);
      // Preserve the complete prior checkpoint atomically before replacing the current attempt.
      if (old) this.database.prepare("INSERT INTO workflow_activation_history(run_id,activation_key,attempt,record) VALUES(?,?,?,?)")
        .run(id, key, old.attempt, JSON.stringify(allowed ? {...old,metadata:{...old.metadata,retry:retryProgress(decision!,"admitted")}} : old));
      const { failure: _previousFailure, failureCauses: _previousCauses, outputRepair: _previousRepair, retry: _previousRetry,
        operation: _operation, sessionFile: _session, workerPid: _pid, workerToken: _worker, workerKind: _workerKind, workerLaunch: _workerLaunch,
        workerGroupPid: _groupPid, workerGroupState: _groupState,
        cwd: _cwd, model: _model, thinking: _thinking, reconciliation: _reconciliation, workspaceRecovery: _workspaceRecovery, ...metadata } = old?.metadata ?? {};
      const now = Date.now();
      if (manual) {
        this.applyReconciliation(id, manual.request.decisionId, old!.attempt + 1, now);
        metadata.reconciliation = { decisionId: manual.request.decisionId, sourceAttempt: old!.attempt, action: "retry" };
        if (old!.kind === "worktree" && metadata.workspace && metadata.workspacePhase !== "allocating") metadata.workspacePhase = "children";
      }
      if (run.status === "waiting") {
        this.database.prepare("UPDATE workflow_runs SET status='running',updated_at=? WHERE id=?").run(now, id);
        this.event(id, "run.running", {});
      }
      this.admitFrozenWriterIntent(run, id, context, options.kind, metadata);
      this.database.prepare(`INSERT INTO workflow_activations(run_id,activation_key,context,kind,side_effect,status,attempt,owner_token,started_at,metadata)
        VALUES(?,?,?,?,?,'running',?,?,?,?) ON CONFLICT(run_id,activation_key) DO UPDATE SET
        status='running',attempt=excluded.attempt,owner_token=excluded.owner_token,started_at=excluded.started_at,finished_at=NULL,error=NULL,output=NULL,metadata=excluded.metadata`)
        .run(id, key, JSON.stringify(context), options.kind, Number(options.sideEffect), (old?.attempt ?? 0) + 1, token, now, JSON.stringify(metadata));
      this.event(id, "activation.started", { key, kind: options.kind, attempt: (old?.attempt ?? 0) + 1 });
      if (allowed) this.event(id,"retry.admitted",{key,retry:retryProgress(decision!,"admitted")});
      return this.getActivation(id, key)!;
    });
  }
  /** Точные worktree-предки: сложность зависит от глубины scope, а не от всех visits. */
  workspaceCwd(id: string, context: RuntimeContext, fallback: string): string {
    const scope = context.scope;
    for (let i = scope.length - 7; i >= 2; i--) {
      if (scope[i] !== "node" || scope[i + 2] !== "visit" || scope[i + 4] !== "worktree" || scope[i + 5] !== "graph" || scope[i - 2] !== "graph") continue;
      const visit = Number(scope[i + 3]);
      if (!Number.isSafeInteger(visit) || visit < 0) continue;
      const parent = this.getActivation(id, activationKey({ scope: scope.slice(0, i), graphId: scope[i - 1]!, nodeId: scope[i + 1]!, visit }));
      const childScope = parent?.metadata.childScope;
      if (parent?.kind !== "worktree" || !Array.isArray(childScope) || childScope.length !== i + 7 || !childScope.every((segment,index) => segment === scope[index])) continue;
      const workspace = parent.metadata.workspace;
      return workspace && typeof workspace === "object" && !Array.isArray(workspace) && typeof workspace.path === "string" ? workspace.path : fallback;
    }
    return fallback;
  }
  /** Check/worktree intent is known from the frozen node; persist it with admission so a crash before work() is still recoverable. */
  private admitFrozenWriterIntent(run: ExecutionRecord, id: string, context: RuntimeContext, kind: string, metadata: ActivationMetadata): void {
    if (kind !== "check" && kind !== "worktree") return;
    const node = run.plan.workflow.graphs[context.graphId]?.nodes.find(item => item.id === context.nodeId);
    if (!node || node.kind !== kind) return;
    const source = this.workspaceCwd(id, context, run.cwd);
    if (node.kind === "check") {
      const operation = parseOperation({ kind: "check", cwd: node.cwd ? resolve(source, node.cwd) : source, command: node.command, args: [...node.args] });
      if (operation) metadata.operation = JSON.parse(JSON.stringify(operation)) as Json;
      return;
    }
    if (node.kind !== "worktree") return;
    const childScope = [...context.scope, "node", node.id, "visit", String(context.visit), "worktree", "graph", node.graphId];
    const operation = parseOperation({ kind: "worktree", source, childScope, ...(node.base ? { base: node.base } : {}) });
    if (!operation) return;
    metadata.operation = JSON.parse(JSON.stringify(operation)) as Json;
    if (metadata.workspacePhase === "children" && metadata.workspace !== undefined) return;
    metadata.workspacePhase = "allocating";
    metadata.childScope = childScope;
  }
  openWait(id: string, token: string, key: string, reason: string, input: Json, responseSchema: Record<string, unknown>): WaitRecord {
    if (!reason.trim()) throw new Error("Wait requires a nonempty reason");
    assertJson(input); createOutputValidator(responseSchema);
    return this.transaction(() => {
      const activation = this.runningActivation(id, token, key);
      if (activation.kind !== "await") throw new Error("Only await activations can open a wait");
      const existing = this.database.prepare("SELECT id FROM workflow_waits WHERE run_id=? AND activation_key=?").get(id, key);
      let wait: WaitRecord;
      if (existing) {
        wait = this.getWait(id, String(existing.id));
        if (wait.reason !== reason || !isDeepStrictEqual(wait.input, input) || !isDeepStrictEqual(wait.responseSchema, responseSchema)) throw new Error("Persisted wait differs from frozen request");
      } else {
        const waitId = `wait-${randomUUID()}`;
        this.database.prepare("INSERT INTO workflow_waits(id,run_id,activation_key,reason,input,response_schema,status,created_at) VALUES(?,?,?,?,?,?,'open',?)")
          .run(waitId, id, key, reason, JSON.stringify(input), JSON.stringify(responseSchema), Date.now());
        wait = this.getWait(id, waitId);
        this.event(id, "wait.opened", { id: waitId, key, reason, input, responseSchema: responseSchema as Json });
      }
      const metadata = { ...activation.metadata, waitId: wait.id, waitReason: reason, waiting: wait.status === "open", waitResolved: wait.status === "resolved" };
      this.database.prepare("UPDATE workflow_activations SET metadata=? WHERE run_id=? AND activation_key=?").run(JSON.stringify(metadata), id, key);
      return wait;
    });
  }
  getWait(id: string, waitId: string): WaitRecord {
    const row = this.database.prepare("SELECT * FROM workflow_waits WHERE run_id=? AND id=?").get(id, waitId);
    if (!row) throw new Error("Wait not found in this run");
    return { id: String(row.id), runId: id, key: String(row.activation_key), reason: String(row.reason), input: JSON.parse(String(row.input)) as Json,
      responseSchema: JSON.parse(String(row.response_schema)) as Record<string, unknown>, status: row.status as WaitRecord["status"], createdAt: Number(row.created_at),
      resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at), resolvedBy: row.resolved_by === null ? null : String(row.resolved_by),
      ...(row.response === null ? {} : { response: JSON.parse(String(row.response)) as Json }) };
  }
  waits(id: string): WaitRecord[] {
    this.get(id);
    return this.database.prepare("SELECT id FROM workflow_waits WHERE run_id=? ORDER BY created_at,id").all(id).map(row => this.getWait(id, String(row.id)));
  }
  resolveWait(id: string, waitId: string, response: Json, resolvedBy: string): WaitRecord {
    assertJson(response);
    if (!resolvedBy.trim()) throw new Error("Resolution source must be nonempty");
    return this.transaction(() => {
      const run = this.get(id), wait = this.getWait(id, waitId);
      if (wait.status === "resolved") {
        if (!isDeepStrictEqual(wait.response, response)) throw new Error("Wait already resolved with a different response");
        return wait;
      }
      if (this.fence(id)) throw new Error("Run was replaced by a continuation and cannot receive a new wait response");
      if (terminal.has(run.status) || run.desired === "cancelled") throw new Error("Cannot resolve a wait in an ended or cancelling run");
      const valid = createOutputValidator(wait.responseSchema)(response);
      this.database.prepare("UPDATE workflow_waits SET status='resolved',response=?,resolved_by=?,resolved_at=? WHERE run_id=? AND id=?")
        .run(JSON.stringify(valid), resolvedBy, Date.now(), id, waitId);
      const activation = this.getActivation(id, wait.key);
      if (activation?.kind === "await" && activation.status === "running" && activation.metadata.waitId === waitId) {
        const metadata = { ...activation.metadata, waitResolved: true };
        this.database.prepare("UPDATE workflow_activations SET metadata=? WHERE run_id=? AND activation_key=?")
          .run(JSON.stringify(metadata), id, wait.key);
      }
      this.event(id, "wait.resolved", { id: waitId, key: wait.key, response: valid, resolvedBy });
      return this.getWait(id, waitId);
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
  /** Pages contain immutable archived attempts; current is a separate live observation on every read. */
  attempts(id: string, key: string, after = 0, limit = 100) {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid attempt page cursor or limit (1–1000)");
    return this.transaction(() => {
      this.get(id);
      const current = this.getActivation(id, key);
      if (!current) throw new Error("Activation not found in this run");
      const rows = this.database.prepare("SELECT record FROM workflow_activation_history WHERE run_id=? AND activation_key=? AND attempt>? ORDER BY attempt LIMIT ?").all(id, key, after, limit + 1);
      const count = Number(this.database.prepare("SELECT COUNT(*) AS n FROM workflow_activation_history WHERE run_id=? AND activation_key=?").get(id,key)!.n);
      const records = rows.slice(0,limit).map(row => this.attemptAccounting(JSON.parse(String(row.record)) as ActivationRecord));
      return { key, current: this.attemptAccounting(current), records,
        totalAttempts: current.attempt, archived: count, missingArchived: Math.max(0,current.attempt - 1 - count),
        nextAfter: records.at(-1)?.attempt ?? after, hasMore: rows.length > limit };
    }, "read");
  }
  private attemptAccounting(record: ActivationRecord): AttemptRecord {
    const ledger = this.database.prepare("SELECT complete FROM workflow_usage_attempts WHERE run_id=? AND activation_key=? AND attempt=?").get(record.runId,record.key,record.attempt);
    const reports = this.database.prepare("SELECT usage FROM workflow_usage_reports WHERE run_id=? AND activation_key=? AND attempt=? ORDER BY seq").all(record.runId,record.key,record.attempt)
      .map(row => JSON.parse(String(row.usage)) as TokenUsage);
    return { ...record, accounting: { recorded: Boolean(ledger), complete: ledger?.complete === 1,
      responses: reports.length, usage: reports.length ? sumTokenUsage(reports) : null } };
  }
  transition(id: string, key: string): TransitionRecord | undefined {
    const row = this.database.prepare("SELECT t.*,a.context FROM workflow_transitions t JOIN workflow_activations a ON a.run_id=t.run_id AND a.activation_key=t.activation_key WHERE t.run_id=? AND t.activation_key=?").get(id, key);
    return row ? { seq: Number(row.seq), runId: id, key, context: JSON.parse(String(row.context)) as RuntimeContext,
      attempt: Number(row.attempt), at: Number(row.at), decision: JSON.parse(String(row.decision)) as RoutingDecision } : undefined;
  }
  recordTransition(id: string, token: string, key: string, decision: RoutingDecision): TransitionRecord {
    assertJson(decision);
    return this.transaction(() => {
      const run = this.owned(id, token), activation = this.getActivation(id, key);
      if (!activation || activation.status !== "succeeded") throw new Error("Routing requires a completed source activation");
      const existing = this.transition(id, key);
      if (existing) {
        if (!isDeepStrictEqual(existing.decision, decision)) throw new Error("Conflicting persisted routing decision");
        return existing;
      }
      const graph = run.plan.workflow.graphs[activation.context.graphId];
      if (!graph || decision.from !== activation.context.nodeId || !graph.nodes.some(n => n.id === decision.from && !["end", "finish"].includes(n.kind))) throw new Error("Routing source is absent or terminal");
      if (decision.edgeIndex !== null) {
        const edge = graph.edges[decision.edgeIndex];
        if (!edge || edge.from !== decision.from || edge.to !== decision.to) throw new Error("Routing edge is absent from frozen graph");
      } else if (decision.to !== null || !decision.error) throw new Error("Routing requires a selected edge or failure");
      this.database.prepare("INSERT INTO workflow_transitions(run_id,activation_key,attempt,at,decision) VALUES(?,?,?,?,?)")
        .run(id, key, activation.attempt, Date.now(), JSON.stringify(decision));
      const record = this.transition(id, key)!;
      this.event(id, "route.decided", JSON.parse(JSON.stringify(record)) as Json);
      return record;
    });
  }
  transitions(id: string, after = 0, limit = 100): { records: TransitionRecord[]; nextAfter: number; hasMore: boolean } {
    this.get(id);
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid transition cursor/limit");
    const rows = this.database.prepare("SELECT activation_key FROM workflow_transitions WHERE run_id=? AND seq>? ORDER BY seq LIMIT ?").all(id, after, limit + 1);
    const records = rows.slice(0, limit).map(row => this.transition(id, String(row.activation_key))!);
    return { records, nextAfter: records.at(-1)?.seq ?? after, hasMore: rows.length > limit };
  }
  transitionSummary(id: string) {
    const run = this.get(id);
    const rows = this.database.prepare(`SELECT json_extract(a.context,'$.graphId') AS graph_id,
      json_extract(a.context,'$.scope') AS scope,json_extract(t.decision,'$.edgeIndex') AS edge_index,
      COUNT(*) AS count,MAX(t.seq) AS last_seq FROM workflow_transitions t JOIN workflow_activations a
      ON a.run_id=t.run_id AND a.activation_key=t.activation_key WHERE t.run_id=? GROUP BY graph_id,scope,edge_index`).all(id);
    return { supported: supportsGeneratedRouting(run.plan.compilerVersion), count: rows.reduce((n, r) => n + Number(r.count), 0),
      failed: rows.filter(r => r.edge_index === null).reduce((n, r) => n + Number(r.count), 0),
      lastSeq: rows.reduce((n, r) => Math.max(n, Number(r.last_seq)), 0),
      edges: rows.filter(r => r.edge_index !== null).map(r => ({ graphId: String(r.graph_id), scope: String(r.scope), edgeIndex: Number(r.edge_index), count: Number(r.count) })) };
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
  failActivation(id: string, token: string, key: string, error: string, failure?: ExecutionFailureRecord, options: { retryEligible?: boolean; retryCauses?: ExecutionFailureRecord[] } = {}): void {
    this.transaction(() => {
      const activation = this.runningActivation(id, token, key), run = this.executionState(id);
      const detail = failure ?? executionFailure("unknown","execution","unknown",error).failure;
      if (!parseExecutionFailure(detail)) throw new Error("Invalid structured execution failure");
      const causes=options.retryCauses??[detail];
      if (!causes.length || !isDeepStrictEqual(causes[0],detail) || causes.length>1 && !parseFailureCauses(causes)) throw new Error("Invalid retry failure causes");
      this.database.prepare("UPDATE workflow_activations SET status='failed',error=?,finished_at=?,metadata=json_set(metadata,'$.failure',json(?)) WHERE run_id=? AND activation_key=?")
        .run(error, Date.now(), JSON.stringify(detail), id, key);
      if(causes.length>1)this.database.prepare("UPDATE workflow_activations SET metadata=json_set(metadata,'$.failureCauses',json(?)) WHERE run_id=? AND activation_key=?").run(JSON.stringify(causes),id,key);
      this.event(id, "activation.failed", { key, error, failure: JSON.parse(JSON.stringify(detail)) as Json,...(causes.length>1?{causes:JSON.parse(JSON.stringify(causes)) as Json}:{}) });
      const node = run.plan.workflow.graphs[activation.context.graphId]?.nodes.find(n=>n.id===activation.context.nodeId);
      const policy = node?.kind === "agent" || node?.kind === "check" ? node.retryPolicy : undefined;
      if (options.retryEligible && run.desired !== "cancelled" && causes.every(cause=>permitsRetry(policy,activation.attempt,cause))) {
        const at = Date.now(), delayMs = retryDelay(policy!,causes), target = at + delayMs;
        this.database.prepare("INSERT INTO workflow_retries(run_id,activation_key,attempt,at,delay_ms,due_at,failure) VALUES(?,?,?,?,?,?,?)")
          .run(id,key,activation.attempt,at,delayMs,Number.isSafeInteger(target)?target:null,JSON.stringify(detail));
        if(causes.length>1) this.database.prepare("INSERT INTO workflow_retry_causes(retry_seq,causes) VALUES(last_insert_rowid(),?)").run(JSON.stringify(causes));
        const progress = retryProgress(this.retry(id,key,activation.attempt)!,"scheduled");
        this.database.prepare("UPDATE workflow_activations SET metadata=json_set(metadata,'$.retry',json(?)) WHERE run_id=? AND activation_key=?").run(JSON.stringify(progress),id,key);
        this.event(id,"retry.scheduled",{key,retry:progress,failure:JSON.parse(JSON.stringify(detail)) as Json,...(causes.length>1?{causes:JSON.parse(JSON.stringify(causes)) as Json}:{})});
      }
    });
  }
  retry(id: string, key: string, attempt: number): RetryRecord | undefined {
    const row = this.database.prepare("SELECT * FROM workflow_retries WHERE run_id=? AND activation_key=? AND attempt=?").get(id,key,attempt);
    return row ? this.decodeRetry(row) : undefined;
  }
  scheduledRetry(id: string, key: string): RetryRecord | undefined {
    return this.plannedRetry(this.executionState(id),this.getActivation(id,key));
  }
  private plannedRetry(run: Pick<RunRecord, "id" | "plan">, activation: ActivationRecord | undefined): RetryRecord | undefined {
    if (!activation || activation.status !== "failed") return;
    const decision = this.retry(run.id,activation.key,activation.attempt), progress = parseRetryProgress(activation.metadata.retry);
    if (!decision || !progress || !isDeepStrictEqual(progress,retryProgress(decision,"scheduled"))) return;
    const node = run.plan.workflow.graphs[activation.context.graphId]?.nodes.find(n=>n.id===activation.context.nodeId);
    const policy = node?.kind === "agent" || node?.kind === "check" ? node.retryPolicy : undefined;
    const causes=decision.causes??[decision.failure];
    return isDeepStrictEqual(parseExecutionFailure(activation.metadata.failure),decision.failure) && causes.every(cause=>permitsRetry(policy,activation.attempt,cause)) && retryDelay(policy!,causes)===decision.delayMs ? decision : undefined;
  }
  private decodeRetry(row: Record<string, unknown>): RetryRecord {
    const failure = parseExecutionFailure(JSON.parse(String(row.failure)));
    if (!failure) throw new Error("Invalid saved retry failure");
    const extra=this.database.prepare("SELECT causes FROM workflow_retry_causes WHERE retry_seq=?").get(row.seq as number);
    const causes=extra?JSON.parse(String(extra.causes)):undefined;
    if(causes!==undefined && (!parseFailureCauses(causes) || !isDeepStrictEqual(causes[0],failure))) throw new Error("Invalid saved retry causes");
    return {seq:Number(row.seq),runId:String(row.run_id),key:String(row.activation_key),attempt:Number(row.attempt),nextAttempt:Number(row.attempt)+1,
      at:Number(row.at),delayMs:Number(row.delay_ms),dueAt:row.due_at===null?null:Number(row.due_at),failure,...(causes?{causes}:{})};
  }
  retries(id: string, key: string, after = 0, limit = 100) {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid retry page cursor or limit (1–1000)");
    return this.transaction(() => {
      const activation = this.getActivation(id,key); if (!activation) throw new Error("Unknown retry activation");
      const rows = this.database.prepare("SELECT * FROM workflow_retries WHERE run_id=? AND activation_key=? AND seq>? ORDER BY seq LIMIT ?").all(id,key,after,limit+1);
      const records = rows.slice(0,limit).map(row=>this.decodeRetry(row));
      return {key,records,current:parseRetryProgress(activation.metadata.retry),nextAfter:records.at(-1)?.seq??after,hasMore:rows.length>limit};
    },"read");
  }
  setActivationMetadata(id: string, token: string, key: string, metadata: ActivationMetadata): void {
    this.transaction(() => {
      const record = this.runningActivation(id, token, key);
      if (metadata.workerLaunch === "reserved" && record.metadata.workerGroupState === "pending") throw executionFailure("uncertain-effect", "cleanup", "unknown", "Prior worker process group has not been verified empty");
      if (metadata.workerGroupState === "pending" && (!Number.isSafeInteger(metadata.workerGroupPid) || (metadata.workerGroupPid as number) <= 0 || metadata.workerGroupPid !== metadata.workerPid)) throw new Error("Invalid worker process group checkpoint");
      if(Object.hasOwn(metadata,"operation")){
        const operation=parseOperation(metadata.operation);
        if(!operation || operation.kind!==record.kind)throw new Error("Invalid operation observation for activation");
      }
      this.database.prepare("UPDATE workflow_activations SET metadata=? WHERE run_id=? AND activation_key=?").run(JSON.stringify({ ...record.metadata, ...metadata }), id, key);
      this.event(id, "activation.metadata", { key, attempt: record.attempt, metadata: JSON.parse(JSON.stringify(metadata)) as Json });
    });
  }
  appendEvent(id: string, token: string, type: string, payload: Json): void {
    this.transaction(() => { this.owned(id, token); this.event(id, type, payload); });
  }
  private hasPendingWorkerGroups(id: string): boolean {
    return !!this.database.prepare("SELECT 1 FROM workflow_activations WHERE run_id=? AND json_extract(metadata,'$.workerGroupState')='pending' LIMIT 1").get(id);
  }
  /** Controller supplies an OS observation; fences prevent clearing a newer group. */
  observeWorkerGroupEmpty(id: string, key: string, workerToken: string, groupPid: number): boolean {
    return this.transaction(() => {
      const record = this.getActivation(id, key);
      if (!record || record.metadata.workerToken !== workerToken || record.metadata.workerGroupPid !== groupPid || record.metadata.workerGroupState !== "pending") return false;
      const metadata = { ...record.metadata, workerPid: null, workerLaunch: "settled", workerGroupState: "empty" };
      this.database.prepare("UPDATE workflow_activations SET metadata=? WHERE run_id=? AND activation_key=?").run(JSON.stringify(metadata), id, key);
      this.event(id, "worker.group_empty", { key, attempt: record.attempt, groupPid });
      return true;
    });
  }
  collection(id: string, key: string, itemId: string): CollectionRecord | undefined {
    const row = this.database.prepare("SELECT * FROM workflow_collections WHERE run_id=? AND activation_key=? AND item_id=?").get(id,key,itemId);
    return row ? this.decodeCollection(row) : undefined;
  }
  recoveryState(id: string) {
    return this.transaction(() => this.readRecoveryState(id), "read");
  }
  private readRecoveryState(id: string) {
    return { run: this.get(id), activations: this.listActivations(id),
      eventSeq: Number(this.database.prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM workflow_run_events WHERE run_id=?").get(id)!.seq),
      collections: this.database.prepare("SELECT * FROM workflow_collections WHERE run_id=? ORDER BY seq").all(id).map(row => this.decodeCollection(row)) };
  }
  reconciliations(id: string, key?: string): ReconciliationRecord[] {
    this.controlState(id);
    return this.database.prepare(`SELECT d.*, a.attempt AS applied_attempt, a.at AS applied_at, s.decision_id AS superseded_by
      FROM workflow_reconciliations d LEFT JOIN workflow_reconciliation_applications a USING(run_id,decision_id)
      LEFT JOIN workflow_reconciliations s ON s.run_id=d.run_id AND s.supersedes=d.decision_id
      WHERE d.run_id=? ${key === undefined ? "" : "AND d.activation_key=?"} ORDER BY d.created_at,d.rowid`)
      .all(...(key === undefined ? [id] : [id, key])).map(row => ({
        request: JSON.parse(String(row.request)), planHash: String(row.plan_hash), workspace: JSON.parse(String(row.workspace)),
        createdAt: Number(row.created_at), application: row.applied_attempt === null ? null : { attempt: Number(row.applied_attempt), at: Number(row.applied_at) },
        supersededBy: row.superseded_by === null ? null : String(row.superseded_by),
      }));
  }
  reconciliation(id: string, decisionId: string): ReconciliationRecord | undefined {
    return this.reconciliations(id).find(record => record.request.decisionId === decisionId);
  }
  pendingReconciliation(id: string, key: string): ReconciliationRecord | undefined {
    return this.reconciliations(id, key).find(record => record.request.action === "retry" && !record.application && !record.supersededBy);
  }
  private applyReconciliation(id: string, decisionId: string, attempt: number, at: number): void {
    this.database.prepare("INSERT INTO workflow_reconciliation_applications(run_id,decision_id,attempt,at) VALUES(?,?,?,?)").run(id,decisionId,attempt,at);
    this.event(id, "reconciliation.applied", { decisionId, attempt });
  }
  /** Caller verifies OS liveness, files and Git first; checkpoint validation and application are atomic here. */
  recordReconciliation(value: ReconciliationRequest, workspace: WorkspaceObservation): ReconciliationRecord {
    const request = parseReconciliationRequest(value), id = request.id;
    return this.transaction(() => {
      const existing = this.reconciliation(id, request.decisionId);
      if (existing) return sameReconciliation(existing, request);
      if (this.fence(id)) throw new Error("Run was replaced by a continuation and cannot be reconciled");
      const state = this.readRecoveryState(id), selected = state.activations.find(a => a.key === request.key);
      if (!selected || selected.attempt !== request.attempt || recoveryCheckpoint(state.run, state.activations, state.collections, state.eventSeq) !== request.checkpoint) throw new Error("Recovery checkpoint changed; inspect again");
      const blockers = recoveryBlockers(state.run, selected, state.activations, state.collections);
      if (blockers.length || state.activations.some(a => a.metadata.workerGroupState === "pending")) throw new Error(`Recovery is blocked: ${blockers.map(b => b.code).join(", ") || "unresolved-groups"}`);
      if (workspace.digest !== request.workspaceDigest) throw new Error("Recovery workspace changed; inspect again");
      const pending = this.pendingReconciliation(id, request.key);
      if (pending ? request.supersedes !== pending.request.decisionId : request.supersedes !== undefined) throw new Error("A pending reconciliation requires explicit supersedes; applied decisions cannot be superseded");
      const output = request.action === "accept" ? validateReconciledOutput(state.run, selected, request.output!) : undefined;
      const now = Date.now();
      this.database.prepare(`INSERT INTO workflow_reconciliations(run_id,decision_id,activation_key,source_attempt,request,plan_hash,workspace,created_at,supersedes) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(id,request.decisionId,request.key,request.attempt,JSON.stringify(request),state.run.plan.hash,JSON.stringify(workspace),now,request.supersedes ?? null);
      this.event(id, "reconciliation.recorded", { key: request.key, decisionId: request.decisionId, action: request.action, sourceAttempt: request.attempt, actor: request.actor, reason: request.reason, supersedes: request.supersedes ?? null });
      this.abandonScheduledRetries(id, "reconciled", request.key);
      if (request.action === "accept") {
        selected.metadata = this.getActivation(id, request.key)!.metadata;
        this.database.prepare("INSERT INTO workflow_activation_history(run_id,activation_key,attempt,record) VALUES(?,?,?,?)").run(id,request.key,selected.attempt,JSON.stringify(selected));
        // Preserve cumulative spend and completeness projection; no worker/model invocation is invented for an accepted checkpoint.
        const metadata = {
          ...(selected.metadata.usageLegacyIncomplete === true ? { usageLegacyIncomplete: true } : {}),
          ...(selected.metadata.usageLegacyBaseline === undefined ? {} : { usageLegacyBaseline: selected.metadata.usageLegacyBaseline }),
          ...(selected.metadata.usage === undefined ? {} : {
            usage: selected.metadata.usage,
            ...(typeof selected.metadata.usageLedgerVersion === "number" ? { usageLedgerVersion: selected.metadata.usageLedgerVersion } : {}),
            ...(typeof selected.metadata.usageReportCount === "number" ? { usageReportCount: selected.metadata.usageReportCount } : {}),
            ...(typeof selected.metadata.usageComplete === "boolean" ? { usageComplete: selected.metadata.usageComplete } : {}),
            usageRecordedAttempts: (typeof selected.metadata.usageRecordedAttempts === "number" ? selected.metadata.usageRecordedAttempts : 1) + 1,
          }),
          reconciliation: { decisionId: request.decisionId, sourceAttempt: selected.attempt, action: "accept" },
        };
        this.database.prepare(`UPDATE workflow_activations SET status='succeeded',attempt=?,owner_token='',started_at=?,finished_at=?,output=?,error=NULL,metadata=? WHERE run_id=? AND activation_key=?`)
          .run(selected.attempt+1,now,now,JSON.stringify(output),JSON.stringify(metadata),id,request.key);
        this.applyReconciliation(id,request.decisionId,selected.attempt+1,now);
        this.event(id,"activation.reconciled",{key:request.key,attempt:selected.attempt+1,decisionId:request.decisionId});
      }
      this.database.prepare("UPDATE workflow_runs SET status=?,output=NULL,error=NULL,updated_at=? WHERE id=?")
        .run(state.run.desired === "paused" ? "paused" : "interrupted",now,id);
      this.database.prepare("DELETE FROM workflow_run_failures WHERE run_id=?").run(id);
      this.event(id,"run.recovery_ready",{decisionId:request.decisionId,desired:state.run.desired});
      return this.reconciliation(id,request.decisionId)!;
    });
  }
  private decodeCollection(row: Record<string, unknown>): CollectionRecord {
    return { seq:Number(row.seq),runId:String(row.run_id),key:String(row.activation_key),itemId:String(row.item_id),attempt:Number(row.attempt),at:Number(row.at),result:validateCollectedResult(JSON.parse(String(row.result))) };
  }
  recordCollection(id: string, token: string, key: string, itemId: string, result: CollectedResult): CollectionRecord {
    const valid = validateCollectedResult(result);
    return this.transaction(() => {
      const activation = this.runningActivation(id,token,key), run = this.executionState(id);
      const node = run.plan.workflow.graphs[activation.context.graphId]?.nodes.find(n=>n.id===activation.context.nodeId);
      if (!node || (node.kind !== "map" && node.kind !== "parallel") || node.failurePolicy !== "collect") throw new Error("Activation does not collect child results");
      if (node.kind === "parallel" ? !node.children.some(child=>child.id===itemId) : !/^(0|[1-9][0-9]*)$/.test(itemId) || !Number.isSafeInteger(Number(itemId))) throw new Error("Invalid collection item identity");
      const previous = this.collection(id,key,itemId);
      if (previous) { if (!isDeepStrictEqual(previous.result,valid)) throw new Error("Collected result already committed with different data"); return previous; }
      const at = Date.now();
      this.database.prepare("INSERT INTO workflow_collections(run_id,activation_key,item_id,attempt,at,result) VALUES(?,?,?,?,?,?)")
        .run(id,key,itemId,activation.attempt,at,JSON.stringify(valid));
      this.database.prepare(`UPDATE workflow_activations SET metadata=json_set(metadata,
        '$.collectionSummary.total',COALESCE(json_extract(metadata,'$.collectionSummary.total'),0)+1,
        '$.collectionSummary.succeeded',COALESCE(json_extract(metadata,'$.collectionSummary.succeeded'),0)+?,
        '$.collectionSummary.failed',COALESCE(json_extract(metadata,'$.collectionSummary.failed'),0)+?)
        WHERE run_id=? AND activation_key=?`).run(Number(valid.status==='succeeded'),Number(valid.status==='failed'),id,key);
      this.event(id,"collection.settled",{key,itemId,attempt:activation.attempt,result:JSON.parse(JSON.stringify(valid)) as Json});
      return this.collection(id,key,itemId)!;
    });
  }
  collections(id: string, key: string, after = 0, limit = 100) {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid collection page cursor or limit (1–1000)");
    return this.transaction(() => {
      const activation = this.getActivation(id,key);
      if (!activation) throw new Error("Unknown collection activation");
      const node = this.get(id).plan.workflow.graphs[activation.context.graphId]?.nodes.find(n=>n.id===activation.context.nodeId);
      const enabled = (node?.kind === "map" || node?.kind === "parallel") && node.failurePolicy === "collect";
      const rows = this.database.prepare("SELECT * FROM workflow_collections WHERE run_id=? AND activation_key=? AND seq>? ORDER BY seq LIMIT ?").all(id,key,after,limit+1);
      const records = rows.slice(0,limit).map(row=>this.decodeCollection(row));
      const counts = this.database.prepare("SELECT json_extract(result,'$.status') AS status,COUNT(*) AS count FROM workflow_collections WHERE run_id=? AND activation_key=? GROUP BY status").all(id,key);
      const succeeded = Number(counts.find(row=>row.status==='succeeded')?.count??0), failed = Number(counts.find(row=>row.status==='failed')?.count??0);
      return { enabled, key, records, summary:{succeeded,failed,total:succeeded+failed},nextAfter:records.at(-1)?.seq??after,hasMore:rows.length>limit };
    }, "read");
  }
  startUsage(id: string, token: string, key: string): void {
    this.transaction(() => {
      const activation = this.runningActivation(id, token, key);
      if (activation.kind !== "agent") throw new Error("Usage belongs to an agent activation");
      this.database.prepare("INSERT INTO workflow_usage_attempts(run_id,activation_key,attempt) VALUES(?,?,?) ON CONFLICT DO NOTHING").run(id, key, activation.attempt);
      this.projectUsage(activation);
    });
  }
  /** One response is committed independently of output validation. Duplicate delivery is idempotent. */
  recordUsage(id: string, token: string, key: string, reportId: string, value: unknown, stopReason: string, observedEffort?: string, observedEffortSource?: EffortSource): void {
    const usage = parseUsage(value);
    if (!usage || !/^[1-9][0-9]*$/.test(reportId) || !["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"].includes(stopReason)) throw new Error("Invalid worker usage report");
    if (observedEffortSource !== undefined && !["sdk-message", "request-payload", "unknown"].includes(observedEffortSource)) throw new Error("Invalid reasoning effort source");
    if (observedEffort !== undefined && (typeof observedEffort !== "string" || !observedEffort)) throw new Error("Invalid observed reasoning effort");
    this.transaction(() => {
      const activation = this.runningActivation(id, token, key);
      if (activation.kind !== "agent") throw new Error("Usage belongs to an agent activation");
      const encoded = JSON.stringify({ ...usage, ...(observedEffort !== undefined ? { observedEffort, ...(observedEffortSource !== undefined ? { observedEffortSource } : {}) } : {}) });
      const old = this.database.prepare("SELECT usage,stop_reason FROM workflow_usage_reports WHERE run_id=? AND activation_key=? AND attempt=? AND report_id=?").get(id, key, activation.attempt, reportId);
      if (old) {
        if (old.usage !== encoded || old.stop_reason !== stopReason) throw new Error("Conflicting worker usage report identity");
        return;
      }
      this.database.prepare("INSERT INTO workflow_usage_attempts(run_id,activation_key,attempt) VALUES(?,?,?) ON CONFLICT DO NOTHING").run(id, key, activation.attempt);
      this.database.prepare("INSERT INTO workflow_usage_reports(run_id,activation_key,attempt,report_id,usage,stop_reason,at) VALUES(?,?,?,?,?,?,?)")
        .run(id, key, activation.attempt, reportId, encoded, stopReason, Date.now());
      this.projectUsage(activation);
      this.event(id, "usage.reported", { key, attempt: activation.attempt, reportId, usage: JSON.parse(JSON.stringify(usage)) as Json, stopReason, source: "pi-sdk", ...(observedEffort !== undefined ? { observedEffort, ...(observedEffortSource !== undefined ? { observedEffortSource } : {}) } : {}) });
    });
  }
  settleUsage(id: string, token: string, key: string, complete: boolean): void {
    this.transaction(() => {
      const activation = this.runningActivation(id, token, key);
      if (activation.kind !== "agent") throw new Error("Usage belongs to an agent activation");
      this.database.prepare("INSERT INTO workflow_usage_attempts(run_id,activation_key,attempt,complete) VALUES(?,?,?,?) ON CONFLICT(run_id,activation_key,attempt) DO UPDATE SET complete=excluded.complete")
        .run(id, key, activation.attempt, Number(complete));
      this.projectUsage(activation);
      this.event(id, "usage.settled", { key, attempt: activation.attempt, complete });
    });
  }
  private projectUsage(activation: ActivationRecord): void {
    const reports = this.database.prepare("SELECT usage FROM workflow_usage_reports WHERE run_id=? AND activation_key=? ORDER BY seq").all(activation.runId, activation.key)
      .map(row => JSON.parse(String(row.usage)) as TokenUsage);
    const attempts = this.database.prepare("SELECT attempt,complete FROM workflow_usage_attempts WHERE run_id=? AND activation_key=?").all(activation.runId, activation.key);
    // Only immutable pre-ledger checkpoints prove the boundary of a cumulative legacy subtotal.
    // Never add multiple historical snapshots or guess the provenance of a live mixed projection.
    const archives = this.database.prepare("SELECT attempt,record FROM workflow_activation_history WHERE run_id=? AND activation_key=? ORDER BY attempt DESC").all(activation.runId, activation.key);
    // Sticky evidence of legacy spend must survive rejection of its subtotal. A fully
    // settled ledger only proves its own completeness, not that of the legacy usage.
    let legacyIncomplete = activation.metadata.usageLegacyIncomplete === true ||
      activation.metadata.usageLegacyBaseline !== undefined ||
      (activation.metadata.usageLedgerVersion === undefined && activation.metadata.usage !== undefined);
    let baseline: { version: number; throughAttempt: number; subtotal: TokenUsage } | undefined;
    for (const row of archives) {
      const record = JSON.parse(String(row.record)) as ActivationRecord;
      if (record.runId !== activation.runId || record.key !== activation.key || record.attempt !== Number(row.attempt) || record.metadata.usageLedgerVersion !== undefined) continue;
      if (record.metadata.usage !== undefined) legacyIncomplete = true;
      const subtotal = parseUsage(record.metadata.usage);
      if (!subtotal) continue;
      // Even an empty ledger attempt inside the boundary makes provenance ambiguous.
      if (attempts.some(item => Number(item.attempt) <= record.attempt)) break;
      baseline = { version: 1, throughAttempt: record.attempt, subtotal };
      break;
    }
    const { usage: _oldUsage, usageLegacyBaseline: _oldBaseline, ...rest } = activation.metadata;
    const constituents = [...(baseline ? [baseline.subtotal] : []), ...reports];
    const metadata = { ...rest,
      ...(baseline ? { usageLegacyBaseline: baseline } : {}),
      ...(legacyIncomplete ? { usageLegacyIncomplete: true } : {}),
      usageLedgerVersion: 1, usageReportCount: reports.length, usageRecordedAttempts: attempts.length,
      usageComplete: !legacyIncomplete && !baseline && attempts.length === activation.attempt && attempts.every(row => row.complete === 1),
      ...(constituents.length ? { usage: sumTokenUsage(constituents) } : {}),
    };
    this.database.prepare("UPDATE workflow_activations SET metadata=? WHERE run_id=? AND activation_key=?").run(JSON.stringify(metadata), activation.runId, activation.key);
  }
  /** Сводка и страница одного ответа читаются на одном снимке WAL. */
  usageSnapshot(id: string, after = 0, limit = 100) {
    return this.transaction(() => {
      this.controlState(id);
      return { summary: summarizeUsage(this.listActivations(id)), ...this.usageReports(id, after, limit) };
    }, "read");
  }
  taskUsageSnapshot(taskId: string, after = 0, limit = 100) {
    return this.transaction(() => {
      const members = this.taskMembers(taskId);
      return { taskId,
        ...summarizeTaskUsage(members.map(member => ({ id: member.runId, records: this.listActivations(member.runId) }))),
        ...this.taskUsageReports(taskId, after, limit),
      };
    }, "read");
  }
  usageReports(id: string, after = 0, limit = 100): { reports: UsageRecord[]; nextAfter: number; hasMore: boolean } {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid usage page cursor or limit (1–1000)");
    const rows = this.database.prepare("SELECT * FROM workflow_usage_reports WHERE run_id=? AND seq>? ORDER BY seq LIMIT ?").all(id, after, limit + 1);
    const reports: UsageRecord[] = rows.slice(0, limit).map(row => {
      const raw = JSON.parse(String(row.usage)) as TokenUsage & { observedEffort?: string; observedEffortSource?: EffortSource };
      const usage = parseUsage(raw);
      if (!usage) throw new Error("Invalid stored usage report");
      return { seq: Number(row.seq), runId: String(row.run_id), key: String(row.activation_key), attempt: Number(row.attempt),
      reportId: String(row.report_id), usage, stopReason: String(row.stop_reason), at: Number(row.at), source: "pi-sdk" as const,
      ...(typeof raw.observedEffort === "string" ? { observedEffort: raw.observedEffort, observedEffortSource: raw.observedEffortSource ?? "unknown" } : {}) };
    });
    return { reports, nextAfter: reports.at(-1)?.seq ?? after, hasMore: rows.length > limit };
  }
  taskUsageReports(taskId: string, after = 0, limit = 100): { reports: UsageRecord[]; nextAfter: number; hasMore: boolean } {
    this.task(taskId);
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid usage page cursor or limit (1–1000)");
    const rows = this.database.prepare(`SELECT r.* FROM workflow_usage_reports r JOIN workflow_task_membership m ON m.run_id=r.run_id
      WHERE m.task_id=? AND r.seq>? ORDER BY r.seq LIMIT ?`).all(taskId, after, limit + 1);
    const reports: UsageRecord[] = rows.slice(0, limit).map(row => {
      const raw = JSON.parse(String(row.usage)) as TokenUsage & { observedEffort?: string; observedEffortSource?: EffortSource };
      const usage = parseUsage(raw);
      if (!usage) throw new Error("Invalid stored usage report");
      return { seq: Number(row.seq), runId: String(row.run_id), key: String(row.activation_key), attempt: Number(row.attempt),
        reportId: String(row.report_id), usage, stopReason: String(row.stop_reason), at: Number(row.at), source: "pi-sdk" as const,
        ...(typeof raw.observedEffort === "string" ? { observedEffort: raw.observedEffort, observedEffortSource: raw.observedEffortSource ?? "unknown" } : {}) };
    });
    return { reports, nextAfter: reports.at(-1)?.seq ?? after, hasMore: rows.length > limit };
  }
  private insertRootTask(runId: string, now: number): void {
    const taskId = `task-${randomUUID()}`;
    this.database.prepare("INSERT INTO workflow_tasks(id,root_run_id,created_at,creation_kind) VALUES(?,?,?,'start')").run(taskId, runId, now);
    this.database.prepare("INSERT INTO workflow_task_membership(run_id,task_id,parent_run_id,role,receipt_id,created_at,launched_with_task) VALUES(?,?,NULL,'root',NULL,?,1)")
      .run(runId, taskId, now);
  }
  private readLineage(runId: string): RunLineage | undefined {
    const member = this.database.prepare("SELECT * FROM workflow_task_membership WHERE run_id=?").get(runId);
    if (!member) return undefined;
    const fence = this.database.prepare("SELECT successor_run_id FROM workflow_continuation_fences WHERE source_run_id=?").get(runId);
    const receiptId = member.receipt_id === null ? null : String(member.receipt_id);
    const receipt = receiptId ? this.decodeReceipt(receiptId) : undefined;
    return {
      taskId: String(member.task_id), role: String(member.role) as MembershipRole,
      parentRunId: member.parent_run_id === null ? null : String(member.parent_run_id),
      successorRunId: fence ? String(fence.successor_run_id) : null,
      launchedWithTask: Number(member.launched_with_task) === 1,
      ...(receipt ? { receipt: publicReceipt(receipt) } : {}),
    };
  }
  fence(id: string): { successorRunId: string; receiptId: string; createdAt: number } | undefined {
    const row = this.database.prepare("SELECT * FROM workflow_continuation_fences WHERE source_run_id=?").get(id);
    return row ? { successorRunId: String(row.successor_run_id), receiptId: String(row.receipt_id), createdAt: Number(row.created_at) } : undefined;
  }
  membership(runId: string): TaskMembershipRecord | undefined {
    const row = this.database.prepare("SELECT * FROM workflow_task_membership WHERE run_id=?").get(runId);
    return row ? this.decodeMembership(row) : undefined;
  }
  task(taskId: string): { id: string; rootRunId: string; createdAt: number; creationKind: string } {
    const row = this.database.prepare("SELECT * FROM workflow_tasks WHERE id=?").get(taskId);
    if (!row) throw new Error(`Task not found: ${taskId}`);
    return { id: String(row.id), rootRunId: String(row.root_run_id), createdAt: Number(row.created_at), creationKind: String(row.creation_kind) };
  }
  taskMembers(taskId: string): TaskMembershipRecord[] {
    this.task(taskId);
    return this.database.prepare("SELECT * FROM workflow_task_membership WHERE task_id=? ORDER BY created_at, run_id").all(taskId).map(row => this.decodeMembership(row));
  }
  receipt(id: string): ContinuationReceiptRecord {
    return this.decodeReceipt(id);
  }
  receiptForTarget(runId: string): ContinuationReceiptRecord | undefined {
    const row = this.database.prepare("SELECT id FROM workflow_continuation_receipts WHERE target_run_id=?").get(runId);
    return row ? this.decodeReceipt(String(row.id)) : undefined;
  }
  reusedBinding(runId: string, bindingId: string): ReusedOutputRecord | undefined {
    const receipt = this.receiptForTarget(runId);
    return receipt?.reused.find(item => item.bindingId === bindingId);
  }
  private decodeMembership(row: Record<string, unknown>): TaskMembershipRecord {
    return {
      runId: String(row.run_id), taskId: String(row.task_id), parentRunId: row.parent_run_id === null ? null : String(row.parent_run_id),
      role: String(row.role) as MembershipRole, receiptId: row.receipt_id === null ? null : String(row.receipt_id),
      createdAt: Number(row.created_at), launchedWithTask: Number(row.launched_with_task) === 1,
    };
  }
  private decodeReceipt(id: string): ContinuationReceiptRecord {
    const row = this.database.prepare("SELECT * FROM workflow_continuation_receipts WHERE id=?").get(id);
    if (!row) throw new Error(`Continuation receipt not found: ${id}`);
    const reused = this.database.prepare("SELECT * FROM workflow_reused_outputs WHERE receipt_id=? ORDER BY binding_id").all(id).map(item => this.decodeReused(item));
    return {
      id: String(row.id), taskId: String(row.task_id), actor: String(row.actor), reason: String(row.reason),
      evidence: JSON.parse(String(row.evidence)) as Json[], sourceRunId: String(row.source_run_id),
      sourcePlanHash: String(row.source_plan_hash), sourceCheckpoint: String(row.source_checkpoint),
      targetPreparedId: String(row.target_prepared_id), targetPlanHash: String(row.target_plan_hash),
      targetRunId: String(row.target_run_id), canonicalRequest: JSON.parse(String(row.canonical_request)) as Json,
      workspaceDigest: String(row.workspace_digest || (JSON.parse(String(row.canonical_request)) as { workspaceDigest?: string }).workspaceDigest || ""),
      createdAt: Number(row.created_at), paused: Number(row.paused) === 1, admitted: Number(row.admitted) === 1, reused,
    };
  }
  private decodeReused(row: Record<string, unknown>): ReusedOutputRecord {
    return {
      bindingId: String(row.binding_id), receiptId: String(row.receipt_id), sourceRunId: String(row.source_run_id),
      sourcePlanHash: String(row.source_plan_hash), sourceActivationKey: String(row.source_activation_key),
      sourceAttempt: Number(row.source_attempt), sourceGraphId: String(row.source_graph_id), sourceNodeId: String(row.source_node_id),
      outputDigest: String(row.output_digest), schemaDigest: String(row.schema_digest),
      ...(row.producer_schema_digest ? { producerSchemaDigest: String(row.producer_schema_digest) } : {}),
      value: JSON.parse(String(row.value)) as Json,
      targetGraphId: String(row.target_graph_id), targetNodeId: String(row.target_node_id),
      producerRunId: String(row.producer_run_id), producerKey: String(row.producer_key), producerAttempt: Number(row.producer_attempt),
      producerGraphId: String(row.producer_graph_id), producerNodeId: String(row.producer_node_id),
      ...(row.artifact_revision === null ? {} : { artifactRevision: String(row.artifact_revision) }),
      ...(row.acceptance_criteria_revision === null ? {} : { acceptanceCriteriaRevision: String(row.acceptance_criteria_revision) }),
    };
  }
  createContinuation(input: {
    id: string; plan: ExecutionPlan; cwd: string; start: PreparedStart; request: ContinuationRequest;
    reused: Omit<ReusedOutputRecord, "receiptId">[]; paused: boolean;
  }): RunRecord {
    assertJson(input.request.input);
    if (preparedExecutionId(input.plan.hash, input.cwd) !== input.start.preparedId || input.start.preparedId !== input.request.preparedId) throw new Error("Prepared start identity mismatch");
    const canonical = canonicalContinuationRequest(input.request);
    return this.transaction(() => {
      const existing = this.findStart({ ...input.start, operation: continuationKind }, input.request.input, canonical);
      if (existing) return existing;
      const sourceId = input.request.source.runId;
      if (sourceId === input.id) throw new Error("Continuation cannot target its source run");
      const sourceState = this.readRecoveryState(sourceId);
      if (sourceState.run.plan.hash !== input.request.source.planHash) throw new Error("Stale source plan hash; inspect again");
      if (recoveryCheckpoint(sourceState.run, sourceState.activations, sourceState.collections, sourceState.eventSeq) !== input.request.source.checkpoint) {
        throw new Error("Source checkpoint changed; inspect again");
      }
      if (this.fence(sourceId)) throw new Error("Source already has an admitted continuation successor");
      const now = Date.now();
      const sourceMember = this.membership(sourceId);
      let taskId: string;
      if (sourceMember) {
        taskId = sourceMember.taskId;
        const members = this.taskMembers(taskId);
        if (members.some(member => member.runId === input.id)) throw new Error("Continuation ancestry cycle");
      } else {
        taskId = `task-${randomUUID()}`;
        this.database.prepare("INSERT INTO workflow_tasks(id,root_run_id,created_at,creation_kind) VALUES(?,?,?,'adopted')").run(taskId, sourceId, now);
        this.database.prepare("INSERT INTO workflow_task_membership(run_id,task_id,parent_run_id,role,receipt_id,created_at,launched_with_task) VALUES(?,?,NULL,'adopted-source',NULL,?,0)")
          .run(sourceId, taskId, now);
      }
      const status = input.paused ? "paused" : "queued", desired = input.paused ? "paused" : "running";
      const inserted = this.database.prepare(`INSERT INTO workflow_runs(id,plan,input,cwd,status,desired,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
        .run(input.id, JSON.stringify(input.plan), JSON.stringify(input.request.input), input.cwd, status, desired, now, now);
      if (Number(inserted.changes) !== 1) throw new Error(`Run already exists: ${input.id}`);
      this.database.prepare("INSERT INTO workflow_run_starts(run_id,prepared_id,idempotency_key,operation,canonical_request) VALUES(?,?,?,?,?)")
        .run(input.id, input.start.preparedId, input.start.idempotencyKey ?? null, continuationKind, JSON.stringify(canonical));
      const receiptId = `cont-${randomUUID()}`;
      this.database.prepare(`INSERT INTO workflow_continuation_receipts(id,task_id,actor,reason,evidence,source_run_id,source_plan_hash,source_checkpoint,target_prepared_id,target_plan_hash,target_run_id,canonical_request,workspace_digest,created_at,paused,admitted)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(receiptId, taskId, input.request.actor, input.request.reason, JSON.stringify(input.request.evidence),
        sourceId, input.request.source.planHash, input.request.source.checkpoint, input.start.preparedId, input.plan.hash, input.id, JSON.stringify(canonical), input.request.workspaceDigest, now, Number(input.paused));
      this.database.prepare("INSERT INTO workflow_task_membership(run_id,task_id,parent_run_id,role,receipt_id,created_at,launched_with_task) VALUES(?,?,?,'continuation',?,?,1)")
        .run(input.id, taskId, sourceId, receiptId, now);
      for (const reused of input.reused) {
        this.database.prepare(`INSERT INTO workflow_reused_outputs(binding_id,receipt_id,source_run_id,source_plan_hash,source_activation_key,source_attempt,source_graph_id,source_node_id,output_digest,schema_digest,producer_schema_digest,value,target_graph_id,target_node_id,producer_run_id,producer_key,producer_attempt,producer_graph_id,producer_node_id,artifact_revision,acceptance_criteria_revision)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(reused.bindingId, receiptId, reused.sourceRunId, reused.sourcePlanHash, reused.sourceActivationKey,
          reused.sourceAttempt, reused.sourceGraphId, reused.sourceNodeId, reused.outputDigest, reused.schemaDigest, reused.producerSchemaDigest ?? null, JSON.stringify(reused.value),
          reused.targetGraphId, reused.targetNodeId, reused.producerRunId, reused.producerKey, reused.producerAttempt, reused.producerGraphId, reused.producerNodeId,
          reused.artifactRevision ?? null, reused.acceptanceCriteriaRevision ?? null);
      }
      this.database.prepare("INSERT INTO workflow_continuation_fences(source_run_id,successor_run_id,receipt_id,created_at) VALUES(?,?,?,?)")
        .run(sourceId, input.id, receiptId, now);
      this.event(input.id, "run.created", { planHash: input.plan.hash, preparedId: input.start.preparedId, continuation: true, receiptId, sourceRunId: sourceId });
      this.event(sourceId, "continuation.fenced", { successorRunId: input.id, receiptId, reason: input.request.reason });
      return this.get(input.id);
    });
  }
  events(id: string, after = 0): RunEvent[] {
    return this.database.prepare("SELECT * FROM workflow_run_events WHERE run_id=? AND seq>? ORDER BY seq").all(id, after).map(row => ({
      seq: Number(row.seq), runId: String(row.run_id), type: String(row.type), payload: JSON.parse(String(row.payload)) as Json, at: Number(row.at),
    }));
  }
}
