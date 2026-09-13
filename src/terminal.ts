import { summarizeUsage, tokenNumber, tokenSummary } from "./usage.js";
import type { Node } from "./graph.js";
import type { ActivationRecord, RunRecord } from "./run-store.js";
import { activationState, projectRun } from "./observation.js";
import { providerResponseSummary } from "./provider-response.js";

/** No workflow-provided byte can become a terminal escape, new row or bidi directive. */
export function terminalText(value: string, limit = 180): string {
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return clean.length > limit ? `${clean.slice(0, Math.max(0, limit - 1))}…` : clean;
}
const counts = (records: readonly ActivationRecord[]) => ({
  succeeded: records.filter(a => a.status === "succeeded").length,
  running: records.filter(a => activationState(a) === "running").length,
  waiting: records.filter(a => activationState(a) === "waiting").length,
  retrying: records.filter(a => activationState(a) === "retrying").length,
  failed: records.filter(a => activationState(a) === "failed").length,
  interrupted: records.filter(a => a.status === "interrupted").length,
});
const identity = (record: ActivationRecord) => `${terminalText(record.context.graphId)}.${terminalText(record.context.nodeId)} scope=${terminalText(JSON.stringify(record.context.scope), 2_000)} visit=${record.context.visit}`;
const progress = (activations: readonly ActivationRecord[]) => {
  const count = counts(activations);
  return `${count.succeeded} succeeded · ${count.running} running${count.waiting ? ` · ${count.waiting} waiting` : ""}${count.retrying ? ` · ${count.retrying} retrying` : ""} · ${count.failed} failed · ${count.interrupted} interrupted (${activations.length} recorded activations)`;
};
const stateLabel = (run: RunRecord) => `${run.status}${run.status !== run.desired && !["succeeded", "failed", "cancelled"].includes(run.status) ? `; desired ${run.desired}` : ""}`;
export function renderRunSummary(run: RunRecord, activations: readonly ActivationRecord[]): string {
  const active = activations.filter(a => activationState(a) === "running");
  const preview = active.slice(0, 4).map(identity).join(" | ");
  return `${terminalText(run.id)}: ${stateLabel(run)} · ${progress(activations)}${preview ? ` · active ${preview}${active.length > 4 ? ` | … ${active.length - 4} more` : ""}` : ""}`;
}
function nodeLabel(node: Node): string {
  return `${terminalText(node.id)} [${node.kind}${node.kind === "agent" ? `:${terminalText(node.role)}` : ""}]`;
}
function nodeState(records: readonly ActivationRecord[]): string {
  if (!records.length) return "○ not visited";
  const count = counts(records);
  const state = count.running ? "▶ running" : count.waiting ? "? waiting" : count.retrying ? "↻ retrying" : count.interrupted ? "! interrupted" : count.failed ? "× failed" : "✓ succeeded";
  return records.length === 1 ? state : `${state} · ${count.succeeded}/${records.length} recorded visits succeeded`;
}
/** All graph definitions and explicit edges, followed by concrete running activation identities. */
export function renderRun(run: RunRecord, activations: readonly ActivationRecord[], presentation = projectRun(run, activations)): string {
  const lines = [
    `${terminalText(run.plan.workflow.name)} · ${terminalText(run.plan.workflow.id)} revision ${run.plan.workflow.revision}`,
    `Run ${terminalText(run.id)} · ${stateLabel(run)}`,
    `Journal: ${progress(activations)} · ${tokenSummary(activations)}`,
  ];
  if (run.lineage) {
    lines.push(`Task ${terminalText(run.lineage.taskId)} · ${run.lineage.role}${run.lineage.parentRunId ? ` · from ${terminalText(run.lineage.parentRunId)}` : ""}${run.lineage.successorRunId ? ` · continuation ${terminalText(run.lineage.successorRunId)}` : ""}`);
    if (run.lineage.receipt) lines.push(`Continuation: ${terminalText(run.lineage.receipt.reason, 500)}`);
  }
  if (presentation.taskOutcome) lines.push(`Task: ${presentation.taskOutcome.decision} · ${terminalText(presentation.taskOutcome.reason, 500)}`);
  if (presentation.liveness.state !== "unknown") lines.push(presentation.liveness.label);
  if (run.failure) lines.push(terminalText(`${run.failure.code}/${run.failure.phase}${run.failure.diagnostic?.subcode ? `/${run.failure.diagnostic.subcode}` : ""}${run.failure.diagnostic ? ` · ${run.failure.diagnostic.dispatch}` : ""}${providerResponseSummary(run.failure.providerResponse)}: ${run.failure.message}`,500));
  for (const record of activations.filter(a => activationState(a) === "waiting")) lines.push(`Wait ${terminalText(String(record.metadata.waitId))}: ${terminalText(String(record.metadata.waitReason), 500)}`);
  for (const [graphId, graph] of Object.entries(run.plan.workflow.graphs)) {
    lines.push("", `┌ Graph ${terminalText(graphId)} · entry ${terminalText(graph.entry)}`);
    for (const node of graph.nodes) {
      const records = activations.filter(a => a.context.graphId === graphId && a.context.nodeId === node.id);
      const usage = summarizeUsage(records);
      lines.push(`│ ${nodeLabel(node)}  ${nodeState(records)}`);
      if (node.kind === "agent") lines.push(`│   Токены: ${usage.reported ? tokenNumber(usage.totalTokens) : records.length ? "нет отчётов" : "—"}${usage.partial ? " · неполные данные" : ""} · все ветки / проходы`);
      if (node.kind === "map" || node.kind === "subworkflow") lines.push(`│   ↳ graph ${terminalText(node.graphId)}${node.kind === "map" ? ` · dynamic items · concurrency ${node.concurrency ?? "unbounded"}` : ""}`);
      if (node.kind === "parallel") for (const child of node.children) lines.push(`│   ↳ ${terminalText(child.id)} → graph ${terminalText(child.graphId)}`);
    }
    if (graph.edges.length) {
      lines.push("│ Edges");
      for (const edge of graph.edges) lines.push(`│   ${terminalText(edge.from)} ──${edge.when ? "[if]" : ""}▶ ${terminalText(edge.to)}`);
    }
    lines.push("└");
  }
  const active = activations.filter(a => activationState(a) === "running");
  if (active.length) {
    lines.push("", run.status === "paused" ? "Paused structural activations:" : "Running activations:");
    for (const record of active) lines.push(`  ▶ ${identity(record)} · attempt ${record.attempt}`);
  }
  if (run.error) lines.push("", `Error: ${terminalText(run.error, 500)}`);
  lines.push("", "○ not visited  ▶ running  ✓ succeeded  × failed  ! interrupted");
  return lines.join("\n");
}
