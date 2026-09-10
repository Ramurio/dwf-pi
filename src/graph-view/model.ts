import { parseExecutionFailure } from "../execution-failure.js";
import { parseOutputRepairProgress } from "../output-repair.js";
import type { ActivationRecord, RunRecord, WaitRecord, RunStore } from "../run-store.js";
import { activationUsage, summarizeUsage } from "../usage.js";
import { activationPath, type WorkerActivity } from "../monitor.js";
import { activationState, projectRun } from "../observation.js";

/** Read-only projection: no owner tokens, prompts, credentials, session paths or raw logs. */
export function graphSnapshot(
  run: RunRecord,
  records: readonly ActivationRecord[],
  activity: ReadonlyMap<string, WorkerActivity> = new Map(),
  waits: readonly WaitRecord[] = [],
  presentation = projectRun(run, records),
  trace: ReturnType<RunStore["transitionSummary"]> = { supported: false, count: 0, failed: 0, lastSeq: 0, edges: [] },
) {
  return {
    cwd: run.cwd,
    id: run.id,
    name: run.plan.workflow.name,
    planHash: run.plan.hash,
    workflowRevision: run.plan.workflow.revision,
    preparedId: run.preparedId ?? null,
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
    error: run.error ?? null,
    failure: run.failure ?? null,
    usage: summarizeUsage(records),
    entryGraph: run.plan.workflow.entryGraph,
    graphs: Object.entries(run.plan.workflow.graphs).map(([id, graph]) => ({
      id,
      entry: graph.entry,
      nodes: graph.nodes.map((node) => {
        const activations = records.filter(
          (a) => a.context.graphId === id && a.context.nodeId === node.id,
        );
        const ordered = [...activations].sort(
          (a, b) =>
            b.startedAt - a.startedAt || b.context.visit - a.context.visit,
        );
        const status = activations.some((a) => a.status === "running" && a.metadata.waiting !== true)
          ? "running" : activations.some(a => a.status === "running" && a.metadata.waiting === true) ? "waiting"
          : (ordered[0]?.status ?? "unvisited");
        const config = run.plan.agents[id]?.[node.id];
        return {
          branches: new Set(
            activations.map((a) => JSON.stringify(a.context.scope)),
          ).size,
          id: node.id,
          kind: node.kind,
          failurePolicy: node.kind === "map" || node.kind === "parallel" ? node.failurePolicy ?? "fail-fast" : null,
          role: node.kind === "agent" ? node.role : null,
          status,
          model: config?.model ?? null,
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
            path: activationPath(a),
            status: activationState(a),
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
            outputRepair: parseOutputRepairProgress(a.metadata.outputRepair),
            collectionSummary: a.metadata.collectionSummary ?? null,
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
  if (outcome && typeof outcome === "object" && !Array.isArray(outcome)) return `${outcome.decision}: ${outcome.reason}`;
  const value = a.output;
  if (!value || typeof value !== "object" || Array.isArray(value))
    return typeof value === "string" ? value.slice(0, 500) : null;
  const bits: string[] = [];
  if (typeof value.decision === "string") bits.push(value.decision);
  if (typeof value.accepted === "boolean")
    bits.push(value.accepted ? "Результат принят" : "Результат не принят");
  if (typeof value.exitCode === "number") bits.push(`exit ${value.exitCode}`);
  if (typeof value.summary === "string")
    bits.push(value.summary.slice(0, 1000));
  return bits.join(" · ") || null;
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
