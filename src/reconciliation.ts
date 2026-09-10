import { isDeepStrictEqual } from "node:util";
import { assertJson, createOutputValidator } from "./output-schema.js";
import type { Json } from "./graph.js";
import type { ActivationRecord, RunRecord } from "./run-store.js";
import type { WorkspaceObservation } from "./recovery-files.js";
import { recoveryOutputContract } from "./recovery-inspection.js";
import { parseOperation } from "./operation-record.js";

export interface ReconciliationRequest {
  id: string; key: string; attempt: number; checkpoint: string; workspaceDigest: string;
  decisionId: string; action: "accept" | "retry"; actor: string; reason: string; evidence: Json[];
  output?: Json; supersedes?: string;
}
export interface ReconciliationRecord {
  request: ReconciliationRequest; planHash: string; workspace: WorkspaceObservation; createdAt: number;
  application: { attempt: number; at: number } | null; supersededBy: string | null;
}
export function parseReconciliationRequest(value: unknown): ReconciliationRequest {
  assertJson(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid reconciliation request");
  const required = ["id", "key", "attempt", "checkpoint", "workspaceDigest", "decisionId", "action", "actor", "reason", "evidence"];
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => ![...required, "output", "supersedes"].includes(key))) throw new Error("Invalid reconciliation request fields");
  for (const key of ["id", "key", "decisionId", "actor", "reason", ...(Object.hasOwn(value, "supersedes") ? ["supersedes"] : [])]) {
    if (typeof value[key] !== "string" || !value[key].trim() || value[key].includes("\0")) throw new Error(`Invalid reconciliation ${key}`);
  }
  if (typeof value.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value.id) || !Number.isSafeInteger(value.attempt) || (value.attempt as number) < 1 ||
    ![value.checkpoint, value.workspaceDigest].every(hash => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)) ||
    !["accept", "retry"].includes(value.action as string) || !Array.isArray(value.evidence) || !value.evidence.length ||
    (value.action === "accept") !== Object.hasOwn(value, "output")) throw new Error("Invalid reconciliation action or evidence");
  return structuredClone(value) as unknown as ReconciliationRequest;
}
/** Shape and reviewer bindings are checked independently of actor attestations. */
export function validateReconciledOutput(run: RunRecord, activation: ActivationRecord, output: Json): Json {
  const schema = recoveryOutputContract(run, activation);
  if (!schema) throw new Error("This operation has no reconciliation output contract");
  const result = createOutputValidator(schema)(output);
  const node = run.plan.workflow.graphs[activation.context.graphId]?.nodes.find(n => n.id === activation.context.nodeId);
  if (node?.kind === "agent" && node.role === "reviewer" && Array.isArray(schema.required) && schema.required.includes("artifactRevision")) {
    const operation = parseOperation(activation.metadata.operation);
    const input = operation?.kind === "agent" ? operation.input : null;
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.artifactRevision !== "string" || !input.artifactRevision) throw new Error("Recorded reviewer artifact binding is missing");
    const actual = result as Record<string, Json>;
    if (actual.artifactRevision !== input.artifactRevision || (typeof input.acceptanceCriteriaRevision === "string" && actual.acceptanceCriteriaRevision !== input.acceptanceCriteriaRevision)) throw new Error("Reconciled review does not match the recorded artifact/criteria revision");
  }
  return result;
}
export function sameReconciliation(record: ReconciliationRecord, request: ReconciliationRequest): ReconciliationRecord {
  if (!isDeepStrictEqual(record.request, request)) throw new Error("Conflicting reconciliation decision identity");
  return record;
}
