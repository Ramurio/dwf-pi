import { executions, childExecutions, ancestry, scopeLabel, executionSequence } from './execution-data.js';
/** Workspace views only; navigation, journal access and persistence are injected. */
export function renderWorkspace({ state, el, button, title, names, navigate, openActivation, graphForScope, memory, document }) {
  const run = state.run;
  if (!run) return;
  const byId = id => document.getElementById(id);
  const trail = byId('breadcrumbs');
  trail.replaceChildren();
  for (const [index, item] of ancestry(run, state.graph, state.scope).entries()) {
    if (index) trail.append(el('span', 'crumb-separator', '›'));
    const link = button(item.label, () => navigate({ ...item, tab: 'graph' }), 'crumb');
    link.dataset.uiKey = JSON.stringify([item.graph, item.scope, item.key ?? null, item.node ?? null]);
    link.title = item.label; trail.append(link);
  }
  const records = executions(run), outline = byId('outline');
  const selection = byId('selection-context');
  const selected = records.find(a => a.key === state.key);
  selection.textContent = state.missing ?? (selected ? `${selected.node.id} · проход ${selected.visit ?? '—'} · попытка ${state.attempt} · ${scopeLabel(selected.scope)}` : 'Схема графа · выберите этап или конкретное выполнение');
  // The outline and SVG share the same exact-scope status projection.
  const graph = graphForScope();
  outline.replaceChildren();
  if (!graph) { outline.append(el('p','muted','Граф отсутствует в плане.')); return; }
  const caption = el('div', 'outline-caption');
  caption.append(el('strong', '', 'Этапы и выполнения'), el('small', 'muted', state.scope ? scopeLabel(state.scope) : 'Все вызовы графа'));
  outline.append(caption);
  for (const node of graph.nodes) {
    const identity = JSON.stringify([run.id, graph.id, state.scope, node.id]);
    const group = el('details', 'outline-node'); group.dataset.uiKey = identity;
    group.open = memory.expanded.get(identity) ?? node.id === state.node;
    const summary = el('summary'); summary.dataset.uiKey = 'summary'; summary.append(el('span', `status-dot ${node.status}`), el('span', '', node.label || node.id));
    summary.title = `${node.id} · ${title(node)}`;
    group.append(summary);
    const children = el('div', 'outline-children');
    let populated = false;
    const populate = () => {
      if (populated) return; // Restoring .open queues a native toggle after focus restoration.
      populated = true;
      children.replaceChildren();
      const schema = button(`Схема · ${title(node)}`, () => navigate({ graph: graph.id, scope: state.scope, node: node.id }), 'outline-link');
      schema.dataset.uiKey = 'schema'; children.append(schema);
      const instances = records.filter(a => a.graphId === graph.id && a.node.id === node.id && (!state.scope || a.scope === state.scope)).sort(executionSequence);
      for (const a of instances) {
        const link = button(`Проход ${a.visit ?? '—'} · попытка ${state.key === a.key ? state.attempt : a.attempt} · ${state.key === a.key && state.attempt !== a.attempt ? "архив" : names[a.status] ?? a.status}`, () => openActivation({ ...a, attempt: state.key === a.key ? state.attempt : a.attempt }), `outline-link${state.key === a.key ? ' selected' : ''}`);
        link.dataset.uiKey = a.key; link.setAttribute('aria-current', state.key === a.key ? 'true' : 'false');
        link.title = `${scopeLabel(a.scope)} · ${a.key}`;
        children.append(link);
        if (!state.scope && node.branches > 1) children.append(el('small', 'branch-label', scopeLabel(a.scope)));
        if (state.key === a.key && state.attempt !== a.attempt && node.children?.length)
          children.append(el('small', 'muted', 'Архивная попытка: связь с дочерними вызовами не записана. Ниже доступна схема всех вызовов.'));
        else for (const child of node.children ?? []) {
          const matches = childExecutions(records, a, child), scopes = [...new Set(matches.map(item => item.scope))];
          for (const scope of scopes) children.append(button(`↳ ${child.id} · ${child.graphId}${scopes.length > 1 ? ' · '+scopeLabel(scope) : ''}`, () => navigate({ graph: child.graphId, scope, tab: 'graph' }), 'outline-link child-link'));
        }
      }
      if (!instances.length) children.append(el('small','muted','Ещё не выполнялся'));
      for (const child of node.children ?? []) children.append(button(`↳ Схема ${child.id} → ${child.graphId} · все вызовы (без выбора выполнения)`, () => navigate({ graph: child.graphId, tab: 'graph' }), 'outline-link'));
    };
    if (group.open) populate();
    group.addEventListener('toggle', () => { memory.expanded.set(identity, group.open); if (group.open) populate(); });
    group.append(children); outline.append(group);
  }
}
