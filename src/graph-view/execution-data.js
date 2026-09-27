/** Read-only indexes over the public snapshot. No prompt-derived names or inferred acceptance. */
export function executions(run) {
  return (run?.graphs ?? []).flatMap(graph => graph.nodes.flatMap(node => node.activations.map(a => ({ ...a, node, graphId: graph.id, runId: run.id }))));
}
export function taskGroups(runs) {
  const groups = new Map();
  for (const run of runs) {
    const id = run.lineage?.taskId ? `task:${run.lineage.taskId}` : `run:${run.id}`;
    if (!groups.has(id)) groups.set(id, { id, taskId: run.lineage?.taskId, runs: [] });
    groups.get(id).runs.push(run);
  }
  for (const group of groups.values()) group.runs.sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return [...groups.values()];
}
export function scopeParts(scope) { try { const value = JSON.parse(scope); return Array.isArray(value) ? value : []; } catch { return []; } }
const prefix = (parts, start) => parts.length >= start.length && start.every((part, i) => part === parts[i]);
/** Exact segment ancestry includes the parent's visit, so repeated containers never share children. */
export function childExecutions(records, parent, child) {
  const start = [...scopeParts(parent.scope), 'node', parent.node.id, 'visit', String(parent.visit - 1)];
  return records.filter(a => {
    const parts = scopeParts(a.scope);
    return a.graphId === child.graphId && prefix(parts, start) &&
      (parent.node.kind !== 'parallel' || parts[start.length] === 'parallel' && parts[start.length + 1] === child.id);
  });
}
export function ancestry(run, graphId, scope) {
  const records = executions(run), parts = scopeParts(scope), result = [{ graph: run.entryGraph, scope: '', label: 'Основной процесс' }];
  for (const a of records) {
    const start = [...scopeParts(a.scope), 'node', a.node.id, 'visit', String(a.visit - 1)];
    if ((a.node.children ?? []).length && prefix(parts, start)) result.push({ graph: a.graphId, scope: a.scope, node: a.node.id, key: a.key, attempt: a.attempt, label: `${a.node.label || a.node.id} · проход ${a.visit}`, depth: start.length });
  }
  result.splice(1, result.length - 1, ...result.slice(1).sort((a,b) => a.depth-b.depth));
  if (graphId !== run.entryGraph || scope) result.push({ graph: graphId, scope, label: graphId });
  return result;
}
/** Only a stored decision can connect review feedback to another visit. Admission is a separate fact. */
export function transitionTarget(record, records) {
  const source = records.find(a => a.key === record.key);
  const sequence = source?.order?.transition;
  if (!record.decision.to || !sequence) return null;
  return records.filter(a => a.graphId === record.context.graphId && a.node.id === record.decision.to && a.scope === JSON.stringify(record.context.scope) && a.order?.firstStarted > sequence)
    .sort((a,b) => a.order.firstStarted-b.order.firstStarted)[0] ?? null;
}
export function scopeLabel(scope) {
  const parts = scopeParts(scope), labels = [];
  for (let i=0;i<parts.length;) {
    const marker = parts[i], value = parts[i+1];
    if (marker === 'graph' || marker === 'node' || marker === 'parallel' || marker === 'map' || marker === 'visit') {
      if (value === undefined) break;
      if (marker === 'node') labels.push(String(value));
      else if (marker === 'parallel' || marker === 'map') labels.push(`${marker === 'parallel' ? 'Ветка' : 'Элемент'} ${value}`);
      else if (marker === 'visit' && /^(0|[1-9]\d*)$/.test(String(value)) && Number.isSafeInteger(Number(value))) labels.push(`проход ${Number(value)+1}`);
      i += 2; // Values may themselves be named node, visit, map or parallel.
    } else i++; // Standalone worktree/subworkflow or an unknown legacy segment.
  }
  return labels.join(' / ') || 'Основной вызов';
}

export function executionSequence(a, b) {
  if (a.order?.firstStarted && b.order?.firstStarted) return a.order.firstStarted - b.order.firstStarted;
  return a.startedAt-b.startedAt || (a.visit ?? 0)-(b.visit ?? 0) || a.key.localeCompare(b.key);
}
