import type { ActivationRecord, RunRecord } from "../run-store.js";
import { activationUsage, summarizeUsage } from "../usage.js";
import { activationPath, activeWork, type WorkerActivity } from "../monitor.js";

/** Read-only projection: no owner tokens, prompts, credentials, session paths or raw logs. */
export function graphSnapshot(
  run: RunRecord,
  records: readonly ActivationRecord[],
  activity: ReadonlyMap<string, WorkerActivity> = new Map(),
) {
  return {
    cwd: run.cwd,
    id: run.id,
    name: run.plan.workflow.name,
    status: run.status,
    desired: run.desired,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    heartbeatAt: run.heartbeatAt,
    accepted:
      run.output &&
      typeof run.output === "object" &&
      !Array.isArray(run.output) &&
      typeof run.output.accepted === "boolean"
        ? run.output.accepted
        : null,
    activeKeys: activeWork(records).map((a) => a.key),
    error: run.error ?? null,
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
        const status = activations.some((a) => a.status === "running")
          ? "running"
          : (ordered[0]?.status ?? "unvisited");
        const config = run.plan.agents[id]?.[node.id];
        return {
          branches: new Set(
            activations.map((a) => JSON.stringify(a.context.scope)),
          ).size,
          id: node.id,
          kind: node.kind,
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
            status: a.status,
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
            result: resultSummary(a),
            findings: findings(a),
          })),
        };
      }),
      edges: graph.edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        conditional: Boolean(edge.when),
        condition: edge.when ?? null,
      })),
    })),
  };
}
function resultSummary(a: ActivationRecord): string | null {
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
