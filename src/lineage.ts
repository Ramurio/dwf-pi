import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assertJson, createOutputValidator } from "./output-schema.js";
import { parseOperation } from "./operation-record.js";
import type { Json, WorkflowDefinition } from "./graph.js";
import type { ExecutionPlan } from "./execution-types.js";
import type { ActivationRecord, RunRecord } from "./run-store.js";

export const continuationKind = "continue" as const;
export const startKind = "start" as const;
export type MembershipRole = "root" | "continuation" | "adopted-source";
export type WriterDispositionKind = "retain-effects";

export interface ContinuationReuseBinding {
  bindingId: string;
  sourceRunId: string;
  activationKey: string;
  attempt: number;
  artifactRevision?: string;
  acceptanceCriteriaRevision?: string;
  sourceOutputDigest?: string;
  sourceSchemaDigest?: string;
  producerSchemaDigest?: string;
}
export interface WriterDisposition {
  key: string;
  attempt: number;
  disposition: WriterDispositionKind;
  evidence: Json[];
}
export interface ContinuationSourceRef {
  runId: string;
  checkpoint: string;
  planHash: string;
}
export interface ContinuationRequest {
  preparedId: string;
  idempotencyKey: string;
  source: ContinuationSourceRef;
  actor: string;
  reason: string;
  evidence: Json[];
  input: Json;
  reuse: ContinuationReuseBinding[];
  dispositions: WriterDisposition[];
  workspaceDigest: string;
}
export interface ReuseNodeSpec {
  graphId: string;
  nodeId: string;
  bindingId: string;
  outputSchema: Record<string, unknown>;
}
export interface ReusedOutputRecord {
  bindingId: string;
  receiptId: string;
  sourceRunId: string;
  sourcePlanHash: string;
  sourceActivationKey: string;
  sourceAttempt: number;
  sourceGraphId: string;
  sourceNodeId: string;
  outputDigest: string;
  schemaDigest: string;
  producerSchemaDigest?: string;
  value: Json;
  targetGraphId: string;
  targetNodeId: string;
  producerRunId: string;
  producerKey: string;
  producerAttempt: number;
  producerGraphId: string;
  producerNodeId: string;
  artifactRevision?: string;
  acceptanceCriteriaRevision?: string;
}
export interface TaskMembershipRecord {
  runId: string;
  taskId: string;
  parentRunId: string | null;
  role: MembershipRole;
  receiptId: string | null;
  createdAt: number;
  launchedWithTask: boolean;
}
export interface ContinuationReceiptRecord {
  id: string;
  taskId: string;
  actor: string;
  reason: string;
  evidence: Json[];
  sourceRunId: string;
  sourcePlanHash: string;
  sourceCheckpoint: string;
  targetPreparedId: string;
  targetPlanHash: string;
  targetRunId: string;
  canonicalRequest: Json;
  workspaceDigest: string;
  createdAt: number;
  paused: boolean;
  admitted: boolean;
  reused: ReusedOutputRecord[];
}
export type PublicContinuationReceipt = Omit<ContinuationReceiptRecord, "reused" | "canonicalRequest" | "admitted"> & { reused: PublicReusedBinding[] };
export interface RunLineage {
  taskId: string;
  role: MembershipRole;
  parentRunId: string | null;
  successorRunId: string | null;
  launchedWithTask: boolean;
  receipt?: PublicContinuationReceipt;
}
export interface PublicReusedBinding {
  bindingId: string;
  sourceRunId: string;
  sourcePlanHash: string;
  sourceActivationKey: string;
  sourceAttempt: number;
  sourceGraphId: string;
  sourceNodeId: string;
  outputDigest: string;
  schemaDigest: string;
  producerSchemaDigest?: string;
  targetGraphId: string;
  targetNodeId: string;
  producerRunId: string;
  producerKey: string;
  producerAttempt: number;
  producerGraphId: string;
  producerNodeId: string;
  artifactRevision?: string;
  acceptanceCriteriaRevision?: string;
}
export interface ContinuationBlocker { code: string; message: string; key?: string }

const identifier = /^[A-Za-z][A-Za-z0-9_-]*$/;
const preparedId = /^prepared-[a-f0-9]{64}$/;
const sha256 = /^[a-f0-9]{64}$/;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
export function digestJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
export function canonicalStartRequest(preparedIdValue: string, input: Json): Json {
  return JSON.parse(canonicalJson({ kind: startKind, preparedId: preparedIdValue, input })) as Json;
}
export function canonicalContinuationRequest(request: ContinuationRequest): Json {
  const body: Record<string, unknown> = {
    kind: continuationKind,
    preparedId: request.preparedId,
    source: request.source,
    actor: request.actor,
    reason: request.reason,
    evidence: request.evidence,
    input: request.input,
    reuse: request.reuse,
    dispositions: request.dispositions,
  };
  body.workspaceDigest = request.workspaceDigest;
  return JSON.parse(canonicalJson(body)) as Json;
}
export function sameCanonicalRequest(stored: Json | string | null | undefined, expected: Json): boolean {
  if (stored === null || stored === undefined) return false;
  const parsed = typeof stored === "string" ? JSON.parse(stored) as Json : stored;
  return isDeepStrictEqual(parsed, expected);
}

function nonempty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw new Error(`Invalid continuation ${field}`);
  return value;
}
function id(value: unknown, field: string): string {
  const text = nonempty(value, field);
  if (!identifier.test(text)) throw new Error(`Invalid continuation ${field}`);
  return text;
}
function bindingList(value: unknown): ContinuationReuseBinding[] {
  if (!Array.isArray(value)) throw new Error("Invalid continuation reuse bindings");
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Invalid reuse binding ${index}`);
    const required = ["bindingId", "sourceRunId", "activationKey", "attempt"];
    const optional = ["artifactRevision", "acceptanceCriteriaRevision", "sourceOutputDigest", "sourceSchemaDigest", "producerSchemaDigest"];
    if (required.some(key => !Object.hasOwn(item, key)) || Object.keys(item).some(key => ![...required, ...optional].includes(key))) throw new Error(`Invalid reuse binding ${index} fields`);
    const bindingId = id(item.bindingId, "bindingId");
    if (seen.has(bindingId)) throw new Error(`Duplicate reuse binding: ${bindingId}`);
    seen.add(bindingId);
    if (!Number.isSafeInteger(item.attempt) || (item.attempt as number) < 1) throw new Error(`Invalid reuse attempt for ${bindingId}`);
    const optionalDigest = (name: "sourceOutputDigest" | "sourceSchemaDigest" | "producerSchemaDigest") => {
      if (!Object.hasOwn(item, name)) return {};
      const value = nonempty(item[name], name);
      if (!sha256.test(value)) throw new Error(`Invalid ${name} for ${bindingId}`);
      return { [name]: value };
    };
    return {
      bindingId, sourceRunId: id(item.sourceRunId, "sourceRunId"),
      activationKey: nonempty(item.activationKey, "activationKey"), attempt: item.attempt as number,
      ...(Object.hasOwn(item, "artifactRevision") ? { artifactRevision: nonempty(item.artifactRevision, "artifactRevision") } : {}),
      ...(Object.hasOwn(item, "acceptanceCriteriaRevision") ? { acceptanceCriteriaRevision: nonempty(item.acceptanceCriteriaRevision, "acceptanceCriteriaRevision") } : {}),
      ...optionalDigest("sourceOutputDigest"), ...optionalDigest("sourceSchemaDigest"), ...optionalDigest("producerSchemaDigest"),
    };
  });
}
function dispositionList(value: unknown): WriterDisposition[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Invalid continuation dispositions");
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Invalid disposition ${index}`);
    const required = ["key", "attempt", "disposition", "evidence"];
    if (required.some(key => !Object.hasOwn(item, key)) || Object.keys(item).some(key => !required.includes(key))) throw new Error(`Invalid disposition ${index} fields`);
    const key = nonempty(item.key, "disposition.key");
    if (!Number.isSafeInteger(item.attempt) || (item.attempt as number) < 1) throw new Error("Invalid disposition attempt");
    const identity = `${key}:${item.attempt}`;
    if (seen.has(identity)) throw new Error(`Duplicate writer disposition: ${identity}`);
    seen.add(identity);
    if (item.disposition !== "retain-effects") throw new Error("Continuation cannot accept, retry or clear an original writer attempt");
    if (!Array.isArray(item.evidence) || !item.evidence.length) throw new Error("Writer disposition requires nonempty evidence");
    assertJson(item.evidence);
    return { key, attempt: item.attempt as number, disposition: "retain-effects", evidence: structuredClone(item.evidence) as Json[] };
  });
}

export function parseContinuationRequest(value: unknown): ContinuationRequest {
  assertJson(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid continuation request");
  const required = ["preparedId", "idempotencyKey", "source", "actor", "reason", "evidence", "workspaceDigest"];
  const optional = ["input", "reuse", "dispositions"];
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => ![...required, ...optional].includes(key))) {
    throw new Error("Invalid continuation request fields");
  }
  const prepared = nonempty(value.preparedId, "preparedId");
  if (!preparedId.test(prepared)) throw new Error("Expected prepared plan identifier");
  const sourceValue = value.source;
  if (!sourceValue || typeof sourceValue !== "object" || Array.isArray(sourceValue)) throw new Error("Invalid continuation source");
  if (["runId", "checkpoint", "planHash"].some(key => !Object.hasOwn(sourceValue, key)) || Object.keys(sourceValue).some(key => !["runId", "checkpoint", "planHash"].includes(key))) {
    throw new Error("Invalid continuation source fields");
  }
  if (!sha256.test(String(sourceValue.checkpoint)) || !sha256.test(String(sourceValue.planHash))) throw new Error("Invalid continuation source checkpoint or plan hash");
  if (!Array.isArray(value.evidence) || !value.evidence.length) throw new Error("Continuation requires nonempty evidence");
  assertJson(value.evidence);
  const input = Object.hasOwn(value, "input") ? value.input as Json : null;
  assertJson(input);
  const workspaceDigest = nonempty(value.workspaceDigest, "workspaceDigest");
  if (!sha256.test(workspaceDigest)) throw new Error("Invalid continuation workspace digest");
  return {
    preparedId: prepared,
    idempotencyKey: nonempty(value.idempotencyKey, "idempotencyKey"),
    source: { runId: id(sourceValue.runId, "source.runId"), checkpoint: String(sourceValue.checkpoint), planHash: String(sourceValue.planHash) },
    actor: nonempty(value.actor, "actor"),
    reason: nonempty(value.reason, "reason"),
    evidence: structuredClone(value.evidence) as Json[],
    input,
    reuse: bindingList(value.reuse ?? []),
    dispositions: dispositionList(value.dispositions),
    workspaceDigest,
  };
}

export function planReuseNodes(workflow: WorkflowDefinition): ReuseNodeSpec[] {
  const nodes: ReuseNodeSpec[] = [];
  for (const [graphId, graph] of Object.entries(workflow.graphs)) {
    for (const node of graph.nodes) {
      if (node.kind !== "reuse") continue;
      nodes.push({ graphId, nodeId: node.id, bindingId: node.bindingId, outputSchema: node.outputSchema });
    }
  }
  return nodes;
}
export function planHasReuse(workflow: WorkflowDefinition): boolean {
  return planReuseNodes(workflow).length > 0;
}

export function ancestrySet(members: readonly TaskMembershipRecord[], startRunId: string): Set<string> {
  const byRun = new Map(members.map(member => [member.runId, member]));
  const seen = new Set<string>();
  let current: string | null = startRunId;
  while (current) {
    if (seen.has(current)) throw new Error("Task ancestry cycle");
    seen.add(current);
    current = byRun.get(current)?.parentRunId ?? null;
  }
  return seen;
}

export function assertAcyclicMembership(members: readonly TaskMembershipRecord[]): void {
  for (const member of members) ancestrySet(members, member.runId);
}

export interface ReuseResolutionInput {
  binding: ContinuationReuseBinding;
  target: ReuseNodeSpec;
  sourceRun: RunRecord;
  sourceActivation: ActivationRecord;
  sourcePlanHash: string;
  input: Json;
  producer: {
    runId: string; key: string; attempt: number; graphId: string; nodeId: string;
    output: Json; schema: Record<string, unknown> | null;
  };
}

/** Schema advertised by the inspected source activation, which may be a reuse node rather than the original producer. */
export function sourceActivationSchema(run: Pick<RunRecord, "plan">, activation: Pick<ActivationRecord, "kind" | "context">): Record<string, unknown> | null {
  const node = run.plan.workflow?.graphs?.[activation.context.graphId]?.nodes.find(item => item.id === activation.context.nodeId);
  if (node?.kind === "reuse") return node.outputSchema;
  if (activation.kind === "agent") return run.plan.agents?.[activation.context.graphId]?.[activation.context.nodeId]?.outputSchema ?? null;
  return null;
}

export function resolveReuseBinding(input: ReuseResolutionInput): Omit<ReusedOutputRecord, "receiptId"> {
  const { binding, target, sourceRun, sourceActivation, sourcePlanHash, producer } = input;
  if (sourceActivation.status !== "succeeded" || sourceActivation.output === undefined) throw new Error(`Reuse source is not a succeeded output: ${binding.bindingId}`);
  if (sourceActivation.attempt !== binding.attempt) throw new Error(`Stale reuse attempt for ${binding.bindingId}`);
  if (sourceActivation.key !== binding.activationKey) throw new Error(`Reuse activation identity mismatch for ${binding.bindingId}`);
  if (sourceRun.plan.hash !== sourcePlanHash) throw new Error(`Reuse source plan hash mismatch for ${binding.bindingId}`);
  if (!isDeepStrictEqual(sourceActivation.output, producer.output)) throw new Error(`Reuse source output does not match original producer output: ${binding.bindingId}`);
  const knownProducerSchema = producer.schema;
  const sourceSchema = sourceActivationSchema(sourceRun, sourceActivation) ?? knownProducerSchema;
  if (knownProducerSchema) createOutputValidator(knownProducerSchema)(producer.output);
  if (sourceSchema) createOutputValidator(sourceSchema)(sourceActivation.output);
  const value = createOutputValidator(target.outputSchema)(producer.output);
  const producerDigest = digestJson(producer.output);
  const schemaDigest = digestJson(sourceSchema ?? target.outputSchema);
  const producerSchemaDigest = knownProducerSchema ? digestJson(knownProducerSchema) : undefined;
  if (binding.sourceOutputDigest && binding.sourceOutputDigest !== producerDigest) throw new Error(`Reuse source output digest mismatch for ${binding.bindingId}`);
  if (binding.sourceSchemaDigest) {
    if (!sourceSchema || binding.sourceSchemaDigest !== digestJson(sourceSchema)) throw new Error(`Reuse source schema digest mismatch for ${binding.bindingId}`);
  }
  if (binding.producerSchemaDigest) {
    if (!producerSchemaDigest || binding.producerSchemaDigest !== producerSchemaDigest) throw new Error(`Reuse producer schema digest mismatch for ${binding.bindingId}`);
  }
  const output = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json> : null;
  const artifactRevision = output && typeof output.artifactRevision === "string" ? output.artifactRevision : undefined;
  const acceptanceCriteriaRevision = output && typeof output.acceptanceCriteriaRevision === "string" ? output.acceptanceCriteriaRevision : undefined;
  if (artifactRevision !== undefined) {
    if (!Array.isArray(target.outputSchema.required) || !target.outputSchema.required.includes("artifactRevision")) {
      throw new Error("Reused reviewer verdict must keep artifactRevision in the target schema");
    }
    if (binding.artifactRevision !== artifactRevision) throw new Error("Reused reviewer verdict does not match the intended artifact revision");
    const requestInput = input.input;
    if (requestInput && typeof requestInput === "object" && !Array.isArray(requestInput) && typeof requestInput.artifactRevision === "string" && requestInput.artifactRevision !== artifactRevision) {
      throw new Error("Reused reviewer verdict cannot approve a different artifact revision");
    }
    if (acceptanceCriteriaRevision !== undefined) {
      if (!Array.isArray(target.outputSchema.required) || !target.outputSchema.required.includes("acceptanceCriteriaRevision")) {
        throw new Error("Reused reviewer verdict must keep acceptanceCriteriaRevision in the target schema");
      }
      if (binding.acceptanceCriteriaRevision !== acceptanceCriteriaRevision) throw new Error("Reused reviewer verdict does not match the intended acceptance criteria revision");
      if (requestInput && typeof requestInput === "object" && !Array.isArray(requestInput) && typeof requestInput.acceptanceCriteriaRevision === "string" && requestInput.acceptanceCriteriaRevision !== acceptanceCriteriaRevision) {
        throw new Error("Reused reviewer verdict cannot approve different acceptance criteria");
      }
    }
  }
  return {
    bindingId: binding.bindingId,
    sourceRunId: binding.sourceRunId,
    sourcePlanHash,
    sourceActivationKey: binding.activationKey,
    sourceAttempt: binding.attempt,
    sourceGraphId: sourceActivation.context.graphId,
    sourceNodeId: sourceActivation.context.nodeId,
    outputDigest: producerDigest,
    schemaDigest,
    ...(producerSchemaDigest ? { producerSchemaDigest } : {}),
    value,
    targetGraphId: target.graphId,
    targetNodeId: target.nodeId,
    producerRunId: producer.runId,
    producerKey: producer.key,
    producerAttempt: producer.attempt,
    producerGraphId: producer.graphId,
    producerNodeId: producer.nodeId,
    ...(artifactRevision ? { artifactRevision } : {}),
    ...(acceptanceCriteriaRevision ? { acceptanceCriteriaRevision } : {}),
  };
}

export function matchReuseBindings(plan: ExecutionPlan, requested: readonly ContinuationReuseBinding[]): { target: ReuseNodeSpec; binding: ContinuationReuseBinding }[] {
  const targets = planReuseNodes(plan.workflow);
  const byId = new Map(targets.map(node => [node.bindingId, node]));
  if (new Set(targets.map(node => node.bindingId)).size !== targets.length) throw new Error("Duplicate reuse binding IDs in target plan");
  if (requested.length !== targets.length) throw new Error("Continuation reuse bindings must match the target plan exactly");
  return requested.map(binding => {
    const target = byId.get(binding.bindingId);
    if (!target) throw new Error(`Reuse binding is not in the target plan: ${binding.bindingId}`);
    return { target, binding };
  });
}

export function unknownWriterActivations(activations: readonly ActivationRecord[]): ActivationRecord[] {
  return activations.filter(record => {
    if (!record.sideEffect || record.status === "succeeded") return false;
    if (record.status === "running" || record.status === "interrupted") return true;
    const failure = record.metadata.failure;
    const effects = failure && typeof failure === "object" && !Array.isArray(failure) ? failure.effects : "unknown";
    return effects === "unknown" || effects === undefined;
  });
}

export function continuationWriterBlockers(activations: readonly ActivationRecord[], dispositions: readonly WriterDisposition[]): ContinuationBlocker[] {
  const blockers: ContinuationBlocker[] = [];
  const required = unknownWriterActivations(activations);
  const remaining = new Map(dispositions.map(item => [`${item.key}:${item.attempt}`, item]));
  for (const record of required) {
    const key = `${record.key}:${record.attempt}`;
    const disposition = remaining.get(key);
    remaining.delete(key);
    if (!disposition) blockers.push({ code: "writer-disposition-required", key: record.key, message: "Unknown writer effects require an explicit retain-effects disposition bound to this attempt." });
    else if (!parseOperation(record.metadata.operation)) blockers.push({ code: "missing-operation", key: record.key, message: "Missing operation evidence stops continuation; inspect the original attempt instead of inventing an output." });
  }
  for (const extra of remaining.values()) {
    blockers.push({ code: "unknown-disposition", key: extra.key, message: "Disposition does not match a failed or interrupted writer attempt." });
  }
  return blockers;
}

export function publicReusedBinding(record: ReusedOutputRecord): PublicReusedBinding {
  const { value: _value, receiptId: _receipt, ...rest } = record;
  return rest;
}
export function publicReceipt(receipt: ContinuationReceiptRecord): PublicContinuationReceipt {
  const { canonicalRequest: _canonical, admitted: _admitted, reused, ...rest } = receipt;
  return { ...rest, reused: reused.map(publicReusedBinding) };
}
export function publicLineage(lineage: RunLineage): RunLineage {
  if (!lineage.receipt) return lineage;
  const { canonicalRequest: _canonical, admitted: _admitted, ...receipt } = lineage.receipt as PublicContinuationReceipt & { canonicalRequest?: unknown; admitted?: unknown };
  return { ...lineage, receipt: receipt as PublicContinuationReceipt };
}
