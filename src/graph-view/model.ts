import type { ExecutionOrder } from "./execution-order.js";
import { parseExecutionFailure, parseFailureCauses } from "../execution-failure.js";
import { parseOutputRepairProgress } from "../output-repair.js";
import { parseRetryProgress } from "../retry-policy.js";
import type { ActivationRecord, RunRecord, WaitRecord, RunStore } from "../run-store.js";
import { activationUsage, summarizeUsage } from "../usage.js";
import { activationPath, collectionEvidence, type WorkerActivity } from "../monitor.js";
import { activationState, projectRun } from "../observation.js";
import { publicLineage } from "../lineage.js";

/** Read-only projection: no owner tokens, prompts, credentials, session paths or raw logs. */
export function graphSnapshot(
  run: RunRecord,
  records: readonly ActivationRecord[],
  activity: ReadonlyMap<string, WorkerActivity> = new Map(),
  waits: readonly WaitRecord[] = [],
  presentation = projectRun(run, records),
  trace: ReturnType<RunStore["transitionSummary"]> = { supported: false, count: 0, failed: 0, lastSeq: 0, edges: [] },
  order: ReadonlyMap<string, ExecutionOrder> = new Map(),
) {
  // Старые журналы ещё не имели waitResolved: источник истины — сохранённый ответ.
  const resolved = new Set(waits.filter(wait => wait.status === "resolved").map(wait => JSON.stringify([wait.key, wait.id])));
  const byNode = new Map<string, ActivationRecord[]>();
  const waitingKeys: string[] = [];
  for (const original of records) {
    const a = original.kind === "await" && resolved.has(JSON.stringify([original.key, original.metadata.waitId]))
      ? { ...original, metadata: { ...original.metadata, waitResolved: true } } : original;
    const key = JSON.stringify([a.context.graphId, a.context.nodeId]);
    const list = byNode.get(key) ?? []; list.push(a); byNode.set(key, list);
    if (activationState(a, run) === "waiting") waitingKeys.push(a.key);
  }
  presentation = { ...presentation, waitingKeys };
  return {
    cwd: run.cwd,
    id: run.id,
    name: run.plan.workflow.name,
    planHash: run.plan.hash,
    workflowRevision: run.plan.workflow.revision,
    preparedId: run.preparedId ?? null,
    lineage: run.lineage ? publicLineage(run.lineage) : null,
    status: run.status,
    desired: run.desired,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    heartbeatAt: run.heartbeatAt,
    taskOutcome: presentation.taskOutcome,
    presentation,
    trace,
    waits,
    accepted: presentation.accepted,
    activeKeys: presentation.activeKeys,
    retryingKeys: presentation.retryingKeys,
    error: run.error ?? null,
    failure: run.failure ?? null,
    usage: summarizeUsage(records),
    entryGraph: run.plan.workflow.entryGraph,
    graphs: Object.entries(run.plan.workflow.graphs).map(([id, graph]) => ({
      id,
      entry: graph.entry,
      nodes: graph.nodes.map((node) => {
        const activations = byNode.get(JSON.stringify([id, node.id])) ?? [];
        const ordered = [...activations].sort(
          (a, b) =>
            b.startedAt - a.startedAt || b.context.visit - a.context.visit,
        );
        const states = activations.map(a => activationState(a, run));
        const status = states.includes("running") ? "running" : states.includes("waiting") ? "waiting"
          : states.includes("answered") ? "answered" : states.includes("retrying") ? "retrying"
          : (ordered[0] ? activationState(ordered[0], run) : "unvisited");
        const config = run.plan.agents[id]?.[node.id];
        return {
          branches: new Set(
            activations.map((a) => JSON.stringify(a.context.scope)),
          ).size,
          id: node.id,
          label: node.label ?? null,
          kind: node.kind,
          failurePolicy: node.kind === "map" || node.kind === "parallel" ? node.failurePolicy ?? "fail-fast" : null,
          retryPolicy: node.kind === "agent" || node.kind === "check" ? node.retryPolicy ?? null : null,
          role: node.kind === "agent" ? node.role : null,
          bindingId: node.kind === "reuse" ? node.bindingId : null,
          status,
          model: node.kind === "reuse" ? null : config?.model ?? null,
          thinking: config?.thinking ?? null,
          children:
            node.kind === "parallel"
              ? node.children.map((c) => ({ id: c.id, graphId: c.graphId }))
              : "graphId" in node
                ? [{ id: node.id, graphId: node.graphId }]
                : [],
          usage: summarizeUsage(activations),
          activations: ordered.map((a) => ({
            scope: JSON.stringify(a.context.scope),
            key: a.key,
            order: order.get(a.key) ?? null,
            path: activationPath(a),
            basePath: activationPath(a, false),
            status: activationState(a, run),
            visit: a.context.visit + 1,
            attempt: a.attempt,
            startedAt: a.startedAt,
            finishedAt: a.finishedAt,
            usage: activationUsage(a) ?? null,
            usageComplete: a.metadata.usageComplete ?? (a.status === "succeeded" && a.metadata.usage !== undefined),
            usageRecordedAttempts: a.metadata.usageRecordedAttempts ?? 1,
            activity:
              (activity.get(a.key)?.at ?? -1) >= a.startedAt
                ? activity.get(a.key)!
                : null,
            error: a.error ?? null,
            failure: parseExecutionFailure(a.metadata.failure) ?? null,
            failureCauses: parseFailureCauses(a.metadata.failureCauses) ?? null,
            outputRepair: parseOutputRepairProgress(a.metadata.outputRepair),
            collectionSummary: a.metadata.collectionSummary ?? null,
            retry: parseRetryProgress(a.metadata.retry),
            reused: parseReused(a),
            result: resultSummary(a),
            findings: findings(a),
          })),
        };
      }),
      edges: graph.edges.map((edge, index) => ({
        index,
        traversals: trace.edges.filter(e => e.graphId === id && e.edgeIndex === index),
        from: edge.from,
        to: edge.to,
        conditional: Boolean(edge.when),
        condition: edge.when ?? null,
      })),
    })),
  };
}
function resultSummary(a: ActivationRecord): string | null {
  const outcome = a.metadata.taskOutcome;
  let primary: string | null = null;
  if (outcome && typeof outcome === "object" && !Array.isArray(outcome)) primary = `${outcome.decision}: ${outcome.reason}`;
  else {
    const value = a.output;
    if (typeof value === "string") primary = value.slice(0, 500);
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      const bits: string[] = [];
      if (typeof value.decision === "string") bits.push(value.decision);
      if (typeof value.accepted === "boolean")
        bits.push(value.accepted ? "Результат принят" : "Результат не принят");
      if (typeof value.exitCode === "number") bits.push(`exit ${value.exitCode}`);
      if (typeof value.summary === "string")
        bits.push(value.summary.slice(0, 1000));
      primary = bits.join(" · ") || null;
    }
  }
  const collection = collectionEvidence(a);
  if (!collection) return primary;
  return primary ? `${primary} · ${collection}` : collection;
}

function parseReused(a: ActivationRecord) {
  const reused = a.metadata.reused;
  if (!reused || typeof reused !== "object" || Array.isArray(reused)) return a.kind === "reuse" ? { invocation: false } : null;
  return {
    bindingId: typeof reused.bindingId === "string" ? reused.bindingId : null,
    sourceRunId: typeof reused.sourceRunId === "string" ? reused.sourceRunId : null,
    sourceKey: typeof reused.sourceKey === "string" ? reused.sourceKey : null,
    sourceAttempt: typeof reused.sourceAttempt === "number" ? reused.sourceAttempt : null,
    outputDigest: typeof reused.outputDigest === "string" ? reused.outputDigest : null,
    producerRunId: typeof reused.producerRunId === "string" ? reused.producerRunId : null,
    producerKey: typeof reused.producerKey === "string" ? reused.producerKey : null,
    producerAttempt: typeof reused.producerAttempt === "number" ? reused.producerAttempt : null,
    invocation: reused.invocation === true,
  };
}
function findings(a: ActivationRecord): string[] {
  const output = a.output;
  if (
    !output ||
    typeof output !== "object" ||
    Array.isArray(output) ||
    !Array.isArray(output.findings)
  )
    return [];
  return output.findings.map((f) =>
    typeof f === "string" ? f : JSON.stringify(f),
  );
}
