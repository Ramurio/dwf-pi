/** URL context is independent of polling and uses journal identity, never row position. */
const fields = { id: 'run', tab: 'view', graph: 'graph', scope: 'scope', node: 'node', key: 'activation', attempt: 'attempt' };
const tabs = new Set(['graph', 'now', 'history', 'trace', 'tokens']);
export function readLocation(href) {
  const params = new URL(href).searchParams;
  const route = Object.fromEntries(Object.entries(fields).map(([key, param]) => [key, params.get(param)]));
  route.tab = tabs.has(route.tab) ? route.tab : 'graph';
  route.scope ??= '';
  const attempt = /^[1-9]\d*$/.test(route.attempt ?? '') && Number.isSafeInteger(Number(route.attempt)) ? Number(route.attempt) : null;
  return { ...route, attempt };
}
export function locationFor(href, route) {
  const url = new URL(href);
  for (const [key, param] of Object.entries(fields)) {
    const value = route[key];
    if (value === null || value === undefined || value === '' || (key === 'tab' && value === 'graph')) url.searchParams.delete(param);
    else url.searchParams.set(param, String(value));
  }
  return url;
}
export function resolveLocation(run, route) {
  const context = { ...route, graph: route.graph ?? run.entryGraph, key: route.key ?? null, attempt: route.attempt ?? null, missing: null };
  if (context.key) {
    for (const graph of run.graphs) for (const node of graph.nodes) {
      const activation = node.activations.find(a => a.key === context.key);
      if (activation) return { ...context, graph: graph.id, node: node.id, scope: activation.scope, attempt: context.attempt ?? activation.attempt };
    }
    context.missing = 'Выбранное выполнение отсутствует в этом журнале.';
  }
  const graph = run.graphs.find(g => g.id === context.graph);
  if (!graph) context.missing = 'Выбранный граф отсутствует в плане.';
  else if (!context.missing && context.node && !graph.nodes.some(n => n.id === context.node)) context.missing = 'Выбранный этап отсутствует в плане.';
  else if (!context.missing && context.scope && !graph.nodes.some(n => n.activations.some(a => a.scope === context.scope))) context.missing = 'Выбранная область выполнения отсутствует в журнале.';
  return context;
}
