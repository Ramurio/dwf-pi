import { resolveAgentConfig } from "./catalog.js";
import type { ExecutionPlan } from "./execution-types.js";
import type { ValidationIssue, WorkflowDefinition } from "./graph.js";

/** Одна проверка для authoring и исполнения; не читает Git, файлы или каталог моделей. */
export function parallelWriterIsolationIssues(workflow: WorkflowDefinition, frozen?: ExecutionPlan["agents"]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const visited = new Set<string>();
  function inspect(graphId: string, fanout: string | undefined): void {
    const key = `${graphId}:${fanout !== undefined}`;
    if (visited.has(key)) return;
    visited.add(key);
    for (const [index, node] of workflow.graphs[graphId]!.nodes.entries()) {
      const path = `$.graphs.${graphId}.nodes[${index}]`;
      if (node.kind === "agent" && fanout && (frozen?.[graphId]?.[node.id]?.permission ?? resolveAgentConfig(node.role, node.config).permission) !== "read-only") {
        issues.push({ path, message: `Параллельный исполнитель ${graphId}/${node.id} имеет право записи в общий каталог (разветвление ${fanout}). Оберните его ветвь отдельным узлом worktree внутри map/parallel. Это относится и к отчётам с разными именами, и к агентам с bash; общий worktree снаружи разветвления не изолирует его ветви.` });
      }
      if (node.kind === "integrate" && fanout) {
        issues.push({ path, message: `Параллельное слияние ${graphId}/${node.id} пишет в общий каталог (разветвление ${fanout}). Поместите integrate после завершения параллельных ветвей либо в отдельный worktree внутри ветви.` });
      }
      if (node.kind === "worktree") inspect(node.graphId, undefined);
      if (node.kind === "subworkflow") inspect(node.graphId, fanout);
      if (node.kind === "map") inspect(node.graphId, node.concurrency !== 1 ? `${graphId}/${node.id}` : fanout);
      if (node.kind === "parallel") for (const child of node.children) {
        inspect(child.graphId, node.children.length > 1 && node.concurrency !== 1 ? `${graphId}/${node.id}` : fanout);
      }
    }
  }
  inspect(workflow.entryGraph, undefined);
  return issues;
}

export function assertParallelWriterIsolation(workflow: WorkflowDefinition, frozen?: ExecutionPlan["agents"]): void {
  const issues = parallelWriterIsolationIssues(workflow, frozen);
  if (issues.length) throw new Error(issues.map(issue => `${issue.path}: ${issue.message}`).join("\n"));
}
