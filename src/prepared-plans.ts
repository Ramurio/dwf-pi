import { realpath, stat } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { preparedExecutionId, type ExecutionPlan, type PreparedExecution } from "./execution-types.js";
import { verifyExecutionPlan } from "./execution-plan.js";
import { openWorkflowDatabase } from "./sqlite.js";

export async function executionWorkspace(cwd: string): Promise<string> {
  const workspace = await realpath(cwd);
  if (!(await stat(workspace)).isDirectory()) throw new Error("Run workspace must be a directory");
  return workspace;
}

/** Content-addressed immutable snapshots; preparation is durable before its response. */
export class PreparedPlanStore {
  private readonly database: DatabaseSync;
  constructor(filename: string) {
    this.database = openWorkflowDatabase(filename, `
      CREATE TABLE IF NOT EXISTS workflow_plan_snapshots (
        hash TEXT PRIMARY KEY, plan TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workflow_prepared_plans (
        id TEXT PRIMARY KEY, plan_hash TEXT NOT NULL REFERENCES workflow_plan_snapshots(hash),
        cwd TEXT NOT NULL, created_at INTEGER NOT NULL
      ) STRICT;
    `);
  }
  close(): void { this.database.close(); }
  async save(plan: ExecutionPlan, cwd: string): Promise<PreparedExecution> {
    const verified = verifyExecutionPlan(plan);
    const workspace = await executionWorkspace(cwd);
    if (workspace !== cwd) throw new Error("Prepared workspace must remain its canonical directory; prepare again");
    const id = preparedExecutionId(verified.hash, workspace);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("INSERT INTO workflow_plan_snapshots(hash,plan) VALUES(?,?) ON CONFLICT(hash) DO NOTHING")
        .run(verified.hash, JSON.stringify(verified));
      this.database.prepare("INSERT INTO workflow_prepared_plans(id,plan_hash,cwd,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING")
        .run(id, verified.hash, workspace, Date.now());
      const result = this.get(id); // Never silently replace corrupt existing data.
      this.database.exec("COMMIT");
      return result;
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  get(id: string): PreparedExecution {
    const row = this.database.prepare(`SELECT p.*, s.plan FROM workflow_prepared_plans p
      JOIN workflow_plan_snapshots s ON s.hash=p.plan_hash WHERE p.id=?`).get(id);
    if (!row) throw new Error(`Prepared plan not found: ${id}`);
    const plan = verifyExecutionPlan(JSON.parse(String(row.plan)));
    const cwd = String(row.cwd), planHash = String(row.plan_hash);
    if (plan.hash !== planHash || preparedExecutionId(planHash, cwd) !== id) throw new Error("Prepared plan identity mismatch");
    // Inspection does not require the workspace, skills or provider credentials to still exist.
    return { preparedId: id, planHash, cwd, createdAt: Number(row.created_at), plan };
  }
}
