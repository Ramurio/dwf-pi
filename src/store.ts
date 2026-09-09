import type { DatabaseSync } from "node:sqlite";
import { openWorkflowDatabase } from "./sqlite.js";
import { applyPatch, createDraft } from "./authoring.js";
import type { WorkflowDefinition } from "./graph.js";

export class DraftStore {
  private readonly database: DatabaseSync;
  constructor(filename: string) {
    this.database = openWorkflowDatabase(filename, `
      CREATE TABLE IF NOT EXISTS workflow_drafts (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL CHECK(revision > 0),
        document TEXT NOT NULL
      ) STRICT;
    `);
  }
  close(): void { this.database.close(); }

  create(input: Parameters<typeof createDraft>[0]): WorkflowDefinition {
    const draft = createDraft(input);
    const saved = this.database.prepare(
      "INSERT INTO workflow_drafts(id, revision, document) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
    ).run(draft.id, draft.revision, JSON.stringify(draft));
    if (Number(saved.changes) !== 1) throw new Error(`Workflow already exists: ${draft.id}`);
    return draft;
  }

  get(id: string): WorkflowDefinition {
    const row = this.database.prepare("SELECT document FROM workflow_drafts WHERE id = ?").get(id);
    if (!row || typeof row.document !== "string") throw new Error(`Workflow not found: ${id}`);
    // Drafts may be structurally incomplete. Full validation belongs to compile.
    return JSON.parse(row.document) as WorkflowDefinition;
  }

  list(): { id: string; name: string; revision: number }[] {
    return this.database.prepare("SELECT document FROM workflow_drafts ORDER BY id").all().map(row => {
      const draft = JSON.parse(String(row.document)) as WorkflowDefinition;
      return { id: draft.id, name: draft.name, revision: draft.revision };
    });
  }

  patch(id: string, request: Parameters<typeof applyPatch>[1]): ReturnType<typeof applyPatch> {
    const previous = this.get(id);
    const result = applyPatch(previous, request);
    // CAS in SQLite protects across processes, not only calls on this object.
    const saved = this.database.prepare(
      "UPDATE workflow_drafts SET revision = ?, document = ? WHERE id = ? AND revision = ?",
    ).run(result.workflow.revision, JSON.stringify(result.workflow), id, previous.revision);
    if (Number(saved.changes) !== 1) throw new Error(`Revision conflict while saving workflow: ${id}`);
    return result;
  }
}
