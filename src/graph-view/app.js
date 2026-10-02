import { createExecutionDetails } from "./execution-details.js";
import { readLocation, locationFor, resolveLocation } from "./navigation.js";
import { executions, taskGroups, childExecutions, scopeLabel, transitionTarget, executionSequence } from "./execution-data.js";
import { ViewMemory } from "./view-state.js";
import { renderWorkspace } from "./workspace.js";
import { layoutGraph } from "./layout.js";
import { UsagePages, TracePages, AttemptPages, CollectionPages, RetryPages } from "./usage-pages.js";
import {
  activationTarget,
  applyTaskScopeError,
  applyTaskScopeFetch,
  beginRunSelection,
  linkedRunsForView,
  reconcileTaskScopeAfterSnapshot,
  reportOrigin,
  taskUsageForView,
} from "./task-scope.js";

const usagePages = new UsagePages();
const tracePages = new TracePages();
const attemptPages = new AttemptPages();
const collectionPages = new CollectionPages();
const retryPages = new RetryPages();
const routingLabels = { true: "Условие выполнено", false: "Условие не выполнено", "not-evaluated": "Не проверялось", fallback: "Выбран запасной переход", error: "Ошибка проверки" };
const waitDrafts = new Map();

const $ = (id) => document.getElementById(id);
const names = {
  queued: "Ожидание",
  running: "В работе",
  waiting: "Ждёт ответа",
  answered: "Ответ сохранён",
  retrying: "Повтор запланирован",
  pausing: "Приостановка",
  paused: "Пауза",
  cancelling: "Отмена…",
  cancelled: "Отменён",
  succeeded: "Завершён",
  failed: "Ошибка",
  interrupted: "Прерван",
  unvisited: "Не запускался",
};
const roles = {
  planner: "Планирование",
  implementer: "Реализация",
  reviewer: "Ревью",
  researcher: "Исследование",
  verifier: "Проверка",
  synthesizer: "Объединение результатов",
  arbiter: "Арбитраж",
  orchestrator: "Оркестрация",
  general: "Агент",
};
const kinds = {
  agent: "Агент",
  worktree: "Рабочая ветка",
  integrate: "Интеграция",
  check: "Проверка",
  parallel: "Параллельные ветки",
  map: "Динамические задачи",
  subworkflow: "Вложенный процесс",
  transform: "Преобразование",
  branch: "Развилка",
  end: "Результат",
  finish: "Результат",
  await: "Ожидание ответа",
  reuse: "Повторное использование результата",
};
const structural = new Set(["worktree", "parallel", "map", "subworkflow"]);
const finished = new Set(["succeeded", "failed", "cancelled"]);
const state = {
  runs: [],
  run: null,
  id: null,
  tab: "graph",
  graph: null,
  scope: "",
  node: null,
  transition: null,
  key: null,
  attempt: null,
  missing: null,
  historyLimit: 100,
  signature: "",
  listSignature: "",
  filter: "all",
  busy: false,
  controlError: null,
  cameras: new Map(),
  snapshotAt: 0,
  snapshotRequest: 0,
  listRequest: 0,
  taskLoad: null,
  runSelection: 0,
  navigationRevision: 0,
  pendingActivation: null,
  pendingTaskReconcile: null,
  usageScope: "run",
  taskUsage: null,
  linkedRuns: [],
  taskFetch: 0,
  taskUsageError: null,
};
const memory = new ViewMemory();
function remember(root, context, render) {
  if (root.dataset.context) memory.capture(root, root.dataset.context, document);
  render();
  root.dataset.context = context;
  memory.restore(root, context);
}
function writeLocation(mode = "push") {
  if (!window.location?.href || !window.history) return;
  const url = locationFor(window.location.href, state);
  if (url.href !== window.location.href) window.history[mode === "replace" ? "replaceState" : "pushState"]({}, "", url);
}
function navigate(target) {
  if (!state.run) return; // Retained links cannot navigate through a loading run.
  state.pendingActivation = null;
  state.navigationRevision++;
  Object.assign(state, { node: null, key: null, attempt: null, scope: "", transition: null, missing: null }, target);
  if (state.run) Object.assign(state, resolveLocation(state.run, state));
  if (state.node) memory.expanded.set(JSON.stringify([state.id, state.graph, state.scope, state.node]), true);
  writeLocation(); renderPanel();
}
function hideNavigation() {
  setGraphExpanded(false);
  for (const name of ["outline", "breadcrumbs", "selection-context"]) $(name).hidden = true;
}
let navigationRender = 0;
function renderNavigation() {
  for (const name of ["outline", "breadcrumbs", "selection-context"]) $(name).hidden = false;
  const id = state.id, visit = state.runSelection, generation = ++navigationRender;
  // Identical polls replace the decoded snapshot object without rebuilding the DOM.
  const current = () => state.id === id && state.runSelection === visit && Boolean(state.run) && navigationRender === generation;
  remember($("breadcrumbs"), JSON.stringify([state.id, state.graph, state.scope, "breadcrumbs"]), () =>
    remember($("outline"), JSON.stringify([state.id, state.graph, state.scope, "outline"]), () =>
      renderWorkspace({ state, el, button, title, names, memory, document, graphForScope: selectedGraph,
        navigate: target => { if (current()) navigate(target); },
        openActivation: activation => { if (current()) void openActivation(activation); } })));
  // The breadcrumb already identifies an unselected diagram. Keep the extra row
  // for an execution, an archived attempt, or an unavailable navigation target.
  $("selection-context").hidden = state.tab === "graph" && !state.node && !state.key && !state.missing;
}
const number = (value) => new Intl.NumberFormat("ru-RU").format(value);
const duration = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60
    ? `${s}с`
    : s < 3600
      ? `${Math.floor(s / 60)}м ${s % 60}с`
      : `${Math.floor(s / 3600)}ч ${Math.floor((s % 3600) / 60)}м`;
};
const date = (at) =>
  new Date(at).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const { renderRecovery, renderRecoveryForm, failureView, retryView, renderRetries, renderCollection, outputRepairView, renderAttempts, renderReconciliations, operationView, recoveryDrafts, recoveryInspections, reconciliationRecords } = createExecutionDetails({ state, api, el, button, badge, clock, number, date, duration, renderInspector, notice, refreshSnapshot, attemptPages, collectionPages, retryPages, document, navigate, newDecisionId: () => crypto.randomUUID() });
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, action, className) {
  const node = el("button", className, text);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}
function clock(node, started, ended = null, prefix = "", suffix = "") {
  node.dataset.startedAt = started;
  if (ended !== null) node.dataset.finishedAt = ended;
  node.dataset.prefix = prefix;
  node.dataset.suffix = suffix;
  node.textContent =
    prefix + duration((ended ?? Date.now()) - started) + suffix;
  return node;
}
function attention(node) {
  const scopes = new Set();
  return node.activations
    .filter((a) => {
      if (scopes.has(a.scope)) return false;
      scopes.add(a.scope);
      return true;
    })
    .some((a) =>
      (a.findings?.length ?? 0) > 0 ||
        /request_changes|rejected|inconclusive|exit [1-9]|не принят/.test(a.result ?? "") ||
        Number(a.collectionSummary?.failed) > 0,
    );
}
function collectionNotice(node) {
  const scopes = new Set();
  for (const a of node.activations) {
    if (scopes.has(a.scope)) continue;
    scopes.add(a.scope);
    if (Number(a.collectionSummary?.failed) > 0) {
      return `ошибок: ${a.collectionSummary.failed} из ${a.collectionSummary.total}`;
    }
  }
  return null;
}
function badge(status) {
  return el("span", `badge ${status}`, names[status] ?? status);
}
function title(node) {
  if (node.label?.trim()) return node.label;
  return node.role
    ? (roles[node.role] ?? node.role)
    : (kinds[node.kind] ?? node.kind);
}
function notice(message) {
  $("notice").textContent = message ?? "";
  $("notice").hidden = !message;
}
async function api(path, options, isCurrent = () => true) {
  const selectedRun = state.id, selection = state.runSelection;
  const response = await fetch(path, { cache: "no-store", ...options });
  if (!isCurrent()) return;
  if (response.status === 401) {
    // Фоновые страницы и квитанции остаются в своих кэшах, но запоздалый отказ
    // доступа не перезагружает другое посещение запуска.
    if (state.id !== selectedRun || state.runSelection !== selection) throw new Error("Сессия панели изменилась. Обнови данные, чтобы продолжить.");
    // Перезапуск панели меняет сеанс доступа; сама закладка остаётся действительной.
    window.location.reload();
    throw new Error("Восстанавливаем подключение к панели…");
  }
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
}
function allActivations() { return executions(state.run); }
function showingWait(runId, waitId) {
  return state.id === runId && state.run && state.tab === "now" &&
    state.run.waits?.some(wait => wait.id === waitId && wait.status === "open");
}
function showingTrace(runId) {
  if (state.id !== runId || !state.run) return false;
  if (state.tab === "trace" || state.tab === "history") return true;
  return Boolean(state.key && allActivations().some(a => a.key === state.key && a.graphId === state.graph &&
    a.node.id === state.node && (!state.scope || a.scope === state.scope)));
}
function showingUsage(runId, pageKey) {
  if (state.id !== runId || !state.run || state.tab !== "tokens") return false;
  const task = taskUsageForView(state);
  if (state.usageScope === "task" && state.run.lineage?.taskId && !task) return false;
  return (task ? `task:${task.taskId}` : runId) === pageKey;
}
function sum(records) {
  let input = 0,
    output = 0,
    totalTokens = 0,
    reported = 0,
    missing = 0;
  for (const a of records) {
    if (a.usage) {
      input += a.usage.input;
      output += a.usage.output;
      totalTokens += a.usage.totalTokens;
      reported++;
    } else missing++;
  }
  return {
    input,
    output,
    totalTokens,
    reported,
    partial: missing > 0 || records.some((a) => a.status === "running" || a.usageComplete === false || a.attempt > a.usageRecordedAttempts),
  };
}
function selectedGraph() {
  const original = state.run.graphs.find((g) => g.id === state.graph);
  if (!original || !state.scope) return original;
  return {
    ...original,
    nodes: original.nodes.map((n) => {
      const activations = n.activations.filter((a) => a.scope === state.scope);
      return {
        ...n,
        activations,
        branches: activations.length ? 1 : 0,
        status: activations.some((a) => a.status === "running")
          ? "running"
          : (activations[0]?.status ?? "unvisited"),
        usage: n.kind === "agent" ? sum(activations) : n.usage,
      };
    }),
  };
}
function tokenTotalLabel(summary) {
  if (!summary.reported && summary.partial) return "Нет отчётов";
  return `${number(summary.totalTokens)} ток.${summary.partial ? " · известная часть" : ""}`;
}
function renderRuns() {
  const changed = $("runs").dataset.selectedRun !== state.id;
  remember($("runs"), "run-list", () => {
    const filter = $("search").value.toLowerCase();
    $("runs").replaceChildren();
    $("run-count").textContent = taskGroups(state.runs).length;
    for (const group of taskGroups(state.runs)) {
      if (!group.runs.some(r => `${r.name} ${r.id} ${group.taskId ?? ""}`.toLowerCase().includes(filter))) continue;
      const latest = group.runs.at(-1), original = group.runs.find(r => !r.lineage?.parentRunId) ?? group.runs[0];
      const box = el("details", "task-group"); box.dataset.uiKey = group.id;
      box.open = group.runs.some(r => r.id === state.id);
      const heading = el("summary");
      heading.append(el("strong", "", original.name), el("small", "", `${group.runs.length} ${group.runs.length === 1 ? "запуск" : "запусков"} · ${latest.presentation.outcomeLabel ?? latest.presentation.statusLabel}`));
      heading.title = original.name; box.append(heading);
      for (const run of group.runs) {
        const item = button("", () => selectRun(run.id), `run-item${run.id === state.id ? " selected" : ""}`);
        item.dataset.uiKey = run.id; item.setAttribute("aria-current", run.id === state.id ? "true" : "false");
        item.title = run.name;
        item.setAttribute("aria-label", `${run.name} · ${run.lineage?.parentRunId ? "Продолжение" : "Запуск"} ${run.id} · ${run.presentation.outcomeLabel ?? run.presentation.statusLabel}`);
        item.append(el("strong", "", run.name), el("small", "", `${run.lineage?.parentRunId ? "Продолжение" : "Запуск"} · ${date(run.createdAt)}`), el("small", "mini-id", `${run.id.slice(-8)} · ${tokenTotalLabel(run.usage)}`));
        box.append(item);
      }
      $("runs").append(box);
    }
    if (!$("runs").children.length) $("runs").append(el("p", "muted", "Ничего не найдено"));
  });
  if (changed) for (const group of $("runs").children) {
    if (Array.from(group.children ?? []).some(item => item.dataset?.uiKey === state.id)) group.open = true;
  }
  $("runs").dataset.selectedRun = state.id;
}
async function selectRun(id, navigation = "push", pendingTarget = null) {
  const route = navigation !== "push" && window.location?.href ? readLocation(window.location.href) : null;
  if (state.id === id) {
    if (navigation === "push" && state.pendingActivation) {
      state.pendingActivation = null;
      state.navigationRevision++;
      Object.assign(state, { graph: null, scope: "", node: null, key: null, attempt: null, missing: null });
      writeLocation();
    }
    // A second popstate can arrive while the first visit's snapshot is in flight.
    if (navigation === "pop" && route?.id === id) {
      Object.assign(state, state.run ? resolveLocation(state.run, route) : route, { transition: null });
      if (state.run) renderPanel();
    }
    return;
  }
  closeCancelDialog();
  state.pendingActivation = null;
  const selection = ++state.runSelection;
  const { previousTaskId } = beginRunSelection(state, id);
  state.pendingTaskReconcile = { selection, previousTaskId };
  Object.assign(state, { key: null, attempt: null, missing: null, historyLimit: 100 });
  if (route?.id === id) Object.assign(state, route);
  if (pendingTarget) {
    Object.assign(state, pendingTarget);
    state.pendingActivation = { id, selection, intent: state.navigationRevision };
  }
  if (navigation !== "none" && navigation !== "pop") writeLocation(navigation);
  $("workspace").hidden = true;
  $("empty").hidden = true;
  hideNavigation();
  for (const name of ["pause", "resume", "cancel"]) $(name).disabled = true;
  renderRuns();
  await refreshSnapshot();
  if (state.id !== id || selection !== state.runSelection) return;
  if (state.run) {
    renderHeader();
    renderPanel();
  }
}
function loadTaskScope(taskId) {
  const runId = state.id, visit = state.runSelection;
  const identity = JSON.stringify([runId, visit, taskId]);
  if (state.taskLoad?.identity === identity) return state.taskLoad.promise;
  const seq = ++state.taskFetch;
  const current = () => seq === state.taskFetch && state.id === runId && state.runSelection === visit;
  const promise = (async () => {
    try {
      const usage = await api(`task-usage?id=${encodeURIComponent(taskId)}&after=0`, undefined, current);
      if (!current()) return false;
      const task = await api(`task?id=${encodeURIComponent(taskId)}`, undefined, current);
      if (!current()) return false;
      const linked = [];
      for (const member of task.members ?? []) {
        linked.push(await api(`snapshot?id=${encodeURIComponent(member.runId)}`, undefined, current));
        if (!current()) return false;
      }
      return applyTaskScopeFetch(state, seq, taskId, usage, linked);
    } catch (error) {
      if (current()) applyTaskScopeError(state, seq, taskId, error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      if (state.taskLoad?.identity === identity) state.taskLoad = null;
    }
  })();
  state.taskLoad = { identity, promise };
  return promise;
}
async function openActivation(activation) {
  const target = activationTarget(activation, state.id);
  if (!target.runId) return;
  if (target.runId !== state.id) {
    // The target survives a superseded initial snapshot; only an accepted snapshot
    // commits one history entry for this cross-run execution selection.
    await selectRun(target.runId, "none", { graph: target.graphId ?? null, node: target.nodeId,
      scope: target.scope, key: activation.key ?? null, attempt: activation.attempt ?? null });
    return;
  }
  if (!state.run) return;
  navigate({ graph: target.graphId ?? state.graph, node: target.nodeId, scope: target.scope, key: activation.key ?? null, attempt: activation.attempt ?? null });

}
function taskActivations() {
  return linkedRunsForView(state).flatMap((run) =>
    (run.graphs ?? []).flatMap((g) =>
      g.nodes.flatMap((n) => n.activations.map((a) => ({ ...a, node: n, graphId: g.id, runId: run.id }))),
    ),
  );
}
function renderMetrics() {
  const r = state.run,
    u = r.usage,
    active = allActivations().filter(
      (a) => r.activeKeys.includes(a.key),
    );
  const values = [
    [
      "Токены",
      u.reported || !u.partial ? number(u.totalTokens) : "Нет отчётов",
      u.partial ? "Неполные данные" : `Агентов с отчётом: ${u.reported}${u.responses ? ` · ответов: ${u.responses}` : ""}`,
    ],
    [
      "Время",
      duration(
        (finished.has(r.status) ? r.updatedAt : Date.now()) - r.createdAt,
      ),
      "От старта до завершения",
    ],
    [
      "Работают сейчас",
      String(active.length),
      r.presentation.liveness.label,
    ],
    [
      "Оценка SDK",
      u.costReported ? `$${u.cost.toFixed(3)}` : "—",
      u.costPartial
        ? "Частичная · не списание по подписке"
        : "Не списание по подписке",
    ],
  ];
  $("metrics").replaceChildren(
    ...values.map(([label, value, note], i) => {
      const card = el("div", "metric");
      const amount = el("div", "metric-value", value);
      if (i === 1) amount.id = "elapsed";
      card.append(
        el("div", "metric-label", label),
        amount,
        el("div", "metric-note", note),
      );
      return card;
    }),
  );
  $("active-count").textContent = active.length;
}
function renderHeader() {
  remember($("run-details"), JSON.stringify([state.id, "header"]), renderHeaderBody);
  remember($("run-summary"), JSON.stringify([state.id, "summary"]), renderSummary);
}
function renderSummary() {
  const r = state.run, panel = $("run-summary");
  panel.className = `run-summary ${r.status}`;
  // Terminal outcomes already have a badge above and their full reason/evidence
  // in run details. Reserve the banner for a next action or a failure.
  panel.hidden = finished.has(r.status) && !r.failure && !r.lineage?.successorRunId;
  $("task-context").textContent = r.lineage?.taskId ? `ЗАДАЧА ${r.lineage.taskId.slice(-8)} · ${r.lineage.parentRunId ? "ПРОДОЛЖЕНИЕ" : "ЗАПУСК"} ${r.id.slice(-8)}` : `ЗАПУСК ${r.id.slice(-8)} · БЕЗ СВЯЗАННОЙ ЗАДАЧИ`;
  panel.replaceChildren();
  const text = el("div", "summary-copy");
  const waits = (r.waits ?? []).filter(w => w.status === "open");
  const active = allActivations().filter(a => r.activeKeys?.includes(a.key));
  const heading = r.failure ? "Требуется разбор сбоя" : waits.length && !waitResponseBlocker(r) ? `Нужен ответ · ${waits.length}` : r.presentation.outcomeLabel ?? r.presentation.statusLabel;
  const description = r.failure?.message ?? r.taskOutcome?.reason ?? (waits.length && !waitResponseBlocker(r) ? waits.map(w => w.reason).join(" · ") : r.status === "paused" ? "Работа приостановлена. Для следующего шага нажмите «Продолжить»." : active.length ? active.map(a => `${title(a.node)} · ${a.node.id}`).join(" · ") : r.presentation.liveness.label);
  const detail = el("p", "", description); detail.title = description;
  text.append(el("strong", "", heading), detail);
  panel.append(text);
  if (waits.length && !waitResponseBlocker(r)) panel.append(button("Ответить", () => setTab("now"), "primary"));
  else if (r.failure) panel.append(button("Разобрать сбой", () => { $("run-details").open = true; setTab("now"); }, "primary"));
  else if (active.length) panel.append(button(`В работе: ${active.length}`, () => setTab("now"), "primary"));
  else if (r.taskOutcome) panel.append(button("Доказательства", () => { $("run-details").open = true; }, "child-button"));
  if (r.lineage?.successorRunId) panel.append(button("Открыть продолжение →", () => selectRun(r.lineage.successorRunId), "primary"));
}
function renderHeaderBody() {
  const r = state.run;
  $("workspace").hidden = false;
  $("empty").hidden = true;
  $("run-name").textContent = r.name;
  $("run-name").title = r.name;
  $("run-id").textContent = r.id;
  $("cwd").textContent = r.cwd;
  $("cwd").title = r.cwd;
  $("execution-plan-detail").replaceChildren(
    el("p", "muted", `Ревизия графа: ${r.workflowRevision}. План этого запуска зафиксирован.`),
    el("p", "", r.preparedId ? `Подготовленный план: ${r.preparedId}` : "Отдельный preparedId для этого запуска не записан."),
    el("p", "", `SHA-256 плана: ${r.planHash}`),
  );
  const status = $("run-status");
  status.className = `badge ${r.status}`;
  status.textContent = r.presentation.statusLabel;
  $("result").textContent = r.presentation.outcomeLabel ?? "";
  $("pause").hidden = !["queued", "running", "waiting"].includes(r.status);
  $("resume").hidden = !["paused", "pausing", "interrupted"].includes(r.status) || r.desired === "cancelled" || Boolean(r.lineage?.successorRunId);
  $("cancel").hidden = finished.has(r.status);
  for (const id of ["pause", "resume", "cancel"]) $(id).disabled = state.busy;
  if (r.error && !r.failure) notice(r.error);
  const failurePanel = $("execution-failure");
  failurePanel.hidden = !r.failure;
  failurePanel.replaceChildren();
  if (r.failure) {
    failurePanel.append(failureView(r.failure,true));
    if (r.error) { const details = el("details"); details.append(el("summary", "", "Техническая ошибка"), el("pre", "", r.error)); failurePanel.append(details); }
  }
  const groupsPanel = $("process-groups"), groups = r.unresolvedGroups ?? [];
  groupsPanel.hidden = !groups.length;
  groupsPanel.replaceChildren();
  if (groups.length) {
    groupsPanel.append(el("strong", "", "После worker остались процессы — нужна проверка"),
      el("p", "", "Повторный запуск заблокирован. Совпадение номера группы ещё не подтверждает принадлежность процессов; отмена не завершает их автоматически по этому номеру."));
    for (const group of groups) {
      const detail = el("details");
      detail.append(el("summary", "", `Группа ${group.groupPid} · попытка ${group.attempt} · процессов: ${group.processes.length}`));
      detail.append(el("pre", "", group.processes.map(p => `PID ${p.pid} · родитель ${p.parentPid} · состояние ${p.state}`).join("\n")));
      for (const graph of r.graphs) {
        const node = graph.nodes.find(n => n.activations.some(a => a.key === group.key));
        if (node) { detail.append(button(`Открыть задачу: ${node.id}`, () => { setTab("graph"); selectNode(graph.id, node.id); }, "child-button")); break; }
      }
      groupsPanel.append(detail);
    }
  }
  const lineagePanel = $("task-lineage");
  const lineage = r.lineage;
  lineagePanel.hidden = !lineage;
  lineagePanel.replaceChildren();
  if (lineage) {
    lineagePanel.append(el("strong", "", lineage.role === "continuation" ? "Продолжение задачи" : lineage.successorRunId ? "Исходный запуск заменён продолжением" : "Задача"));
    lineagePanel.append(el("p", "", `Задача: ${lineage.taskId}`));
    if (!lineage.launchedWithTask) lineagePanel.append(el("p", "muted", "Исходный запуск не создавался с идентификатором задачи; связь записана при явном продолжении."));
    if (lineage.parentRunId) lineagePanel.append(button(`Исходный запуск: ${lineage.parentRunId}`, () => selectRun(lineage.parentRunId), "child-button"));
    if (lineage.successorRunId) {
      const successor = state.runs.find((item) => item.id === lineage.successorRunId);
      const status = successor?.status;
      const label = status === "paused" || status === "pausing" ? "Продолжение на паузе"
        : status === "cancelled" || status === "cancelling" ? "Отменённое продолжение"
        : status === "failed" || status === "interrupted" ? "Остановленное продолжение"
        : status === "succeeded" ? "Завершённое продолжение"
        : status ? "Активное продолжение"
        : "Продолжение";
      lineagePanel.append(button(`${label}: ${lineage.successorRunId}`, () => selectRun(lineage.successorRunId), "child-button"));
    }
    const receipt = lineage.receipt;
    if (receipt) {
      lineagePanel.append(el("p", "", `Причина: ${receipt.reason}`));
      lineagePanel.append(el("p", "muted", `${receipt.actor}. Основания заявил автор; это не машинное подтверждение внешних эффектов.`));
      lineagePanel.append(el("p", "muted", `План: ${receipt.sourcePlanHash.slice(0, 12)}… → ${receipt.targetPlanHash.slice(0, 12)}…`));
      for (const reused of receipt.reused) {
        lineagePanel.append(el("p", "", `Повторно использован ${reused.bindingId} · попытка ${reused.sourceAttempt} · ${reused.outputDigest.slice(0, 12)}…`));
      }
    }
    if (r.status === "failed" && lineage.successorRunId) lineagePanel.append(el("p", "", "Исходный сбой остаётся в истории. Продолжение — отдельный запуск, не успешный перезапуск этого."));
  }
  const outcome = $("task-outcome");
  outcome.hidden = !r.taskOutcome;
  outcome.replaceChildren();
  if (r.taskOutcome) {
    outcome.className = `outcome ${r.taskOutcome.decision}`;
    outcome.append(el("strong", "", r.presentation.outcomeLabel), el("p", "", r.taskOutcome.reason));
    if (r.taskOutcome.evidence.length) {
      const details = el("details");
      details.append(el("summary", "", `Доказательства: ${r.taskOutcome.evidence.length}`), el("pre", "", JSON.stringify(r.taskOutcome.evidence, null, 2)));
      outcome.append(details);
    }
    if (r.taskOutcome.source === "legacy") outcome.append(el("small", "muted", "Результат прочитан из прежнего формата end."));
  }
  const waits = waitResponseBlocker(r) ? [] : (r.waits ?? []).filter(w => w.status === "open");
  const retries = r.retryingKeys?.length ?? 0;
  const summary = $("wait-summary");
  summary.hidden = (!waits.length && !retries) || finished.has(r.status);
  summary.replaceChildren();
  if (!summary.hidden) {
    if (waits.length) summary.append(el("strong", "", `Ожидают ответа: ${waits.length}`), el("p", "", waits.map(w => w.reason).join(" · ")));
    if (retries) summary.append(el("p", "", `Запланировано повторов: ${retries}. Пауза и остановка supervisor задерживают их допуск.`));
    summary.append(button("Открыть ожидания", () => setTab("now"), "child-button"));
  }
  renderMetrics();
}
function setTab(tab) {
  state.tab = tab;
  writeLocation();
  for (const b of document.querySelectorAll("[data-tab]"))
    b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
  if (state.run) renderPanel();
}
function renderPanel() {
  if (!state.run) return; // A background completion cannot draw an unloaded visit.
  if (state.tab !== "graph") setGraphExpanded(false);
  const context = JSON.stringify([state.id, state.tab, state.graph, state.scope, state.node, state.key, state.attempt]);
  remember($("content-panel"), context, renderPanelBody);
  renderNavigation();
  for (const b of document.querySelectorAll("[data-tab]")) b.setAttribute("aria-pressed", String(b.dataset.tab === state.tab));
  $("activity-strip").hidden = state.tab !== "graph";
  if (state.tab === "graph") renderActivityStrip();
}
function renderPanelBody() {
  // Обновления соседних узлов не сворачивают данные открытого ожидания.
  for (const details of document.querySelectorAll("details[data-wait-details]")) {
    const draft = waitDrafts.get(details.dataset.waitDetails);
    if (draft) draft.detailsOpen = details.open;
  }
  const focused = document.activeElement;
  const editingWait = focused?.dataset?.waitId;
  const controlId = focused?.dataset?.waitControl ? focused.id : null;
  const selection = editingWait ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] : null;
  const scroll = editingWait ? { top: focused.scrollTop, left: focused.scrollLeft } : null;
  $("graph-panel").hidden = state.tab !== "graph";
  $("content-panel").hidden = state.tab === "graph";
  if (state.tab === "graph") renderGraph();
  else if (state.tab === "now") renderNow();
  else if (state.tab === "history") renderHistory();
  else if (state.tab === "trace") renderTrace();
  else renderTokens();
  renderInspector();
  if (controlId) {
    const control = document.getElementById(controlId);
    if (control && !control.disabled) control.focus({ preventScroll: true });
  }
  if (editingWait) {
    const field = document.getElementById(`wait-response-${editingWait}`);
    if (field) {
      field.focus({ preventScroll: true }); field.setSelectionRange(...selection);
      field.scrollTop = scroll.top; field.scrollLeft = scroll.left;
    }
  }
}
function selectNode(graphId, id) {
  state.transition = null;
  state.graph = graphId;
  state.node = id;
  state.key = null; state.attempt = null; state.missing = null;
  writeLocation();
  renderPanel();
}
function renderInspector() {
  if (!state.run) return; // Background reads may finish while this visit's snapshot is loading.
  const context = JSON.stringify([state.id, state.graph, state.scope, state.node, state.key, state.attempt, "inspector"]);
  remember($("inspector"), context, renderInspectorBody);
}
function renderInspectorBody() {
  const focused = document.activeElement, recoveryField = focused?.dataset?.recoveryField ? focused.id : null;
  const selection = recoveryField && typeof focused.selectionStart === "number" ? [focused.selectionStart, focused.selectionEnd] : null;
  const scroll = $("inspector").scrollTop;
  const aside = $("inspector");
  aside.replaceChildren();
  const node = selectedGraph()?.nodes.find((n) => n.id === state.node);
  aside.hidden = !node && !state.missing;
  $("work-area").setAttribute("data-inspector", String(!aside.hidden));
  if (aside.hidden) return;
  const close = button("Закрыть детали ×", () => {
    navigate({ graph: state.graph, scope: state.scope });
    (state.tab === "graph" ? $("fit") : $("search")).focus({ preventScroll: true });
  }, "inspector-close");
  aside.append(close);
  if (state.missing) aside.append(el("p", "notice", state.missing));
  if (!node) {
    const hint = el("div", "inspector-placeholder");
    hint.append(
      el("div", "glyph", "⌘"),
      el("h2", "", "Детали задачи"),
      el(
        "p",
        "muted",
        "Выбери блок на графе или задачу в истории. Здесь появятся модель, токены, результаты и повторные проходы.",
      ),
    );
    aside.append(hint);
    return;
  }
  aside.append(
    el("h2", "", node.label || node.id),
    el("p", "definition", `${title(node)} · ${state.key ? "Конкретное выполнение" : "Определение узла"}`),
    el("p", "muted", state.key ? "Выбрано выполнение из журнала" : `Сводка узла: ${names[node.status] ?? node.status}`),
  );
  const definition = el("details", "node-definition");
  definition.append(el("summary", "", "Определение и возможные переходы"));
  if (node.model)
    definition.append(
      el(
        "p",
        "definition",
        `${node.model.provider} / ${node.model.id} · ${node.thinking}`,
      ),
    );
  if (node.kind === "agent")
    definition.append(
      el(
        "p",
        "definition",
        `Все проходы узла · токены: ${node.usage.reported ? number(node.usage.totalTokens) : node.activations.length ? "нет отчёта" : "—"}${node.usage.partial ? " · неполные данные" : ""}`,
      ),
    );
  if (node.kind === "reuse") {
    definition.append(el("p", "definition", `Повторное использование: ${node.bindingId ?? "binding"}. Модель не вызывалась.`));
    for (const activation of node.activations) {
      const reused = activation.reused;
      if (!reused?.sourceRunId) continue;
      definition.append(el("p", "", `Источник: попытка ${reused.sourceAttempt} · ${reused.outputDigest ?? ""}`));
      definition.append(button(`Открыть исходный запуск ${reused.sourceRunId}`, () => selectRun(reused.sourceRunId), "child-button"));
    }
  }
  definition.append(
    el(
      "p",
      "definition",
      `Запусков: ${node.activations.length} · веток / вызовов графа: ${node.branches}`,
    ),
  );
  if (node.children.length) {
    if (node.failurePolicy === "collect") definition.append(el("p", "notice", "Сбор результатов с ошибками. Завершение этого узла означает, что результаты собраны; решения детей проверяются отдельно."));
    definition.append(el("h3", "", "ВЛОЖЕННЫЕ ГРАФЫ"));
    for (const child of node.children) {
      const parent = state.key ? node.activations.find(a => a.key === state.key) : null;
      const scopes = parent && state.attempt === parent.attempt
        ? [...new Set(childExecutions(allActivations(), { ...parent, node }, child).map(a => a.scope))] : [];
      for (const scope of scopes) definition.append(button(
        `Открыть ${child.id} · этот проход · ${scopeLabel(scope)}`,
        () => navigate({ graph: child.graphId, scope, tab: "graph" }), "child-button"));
      definition.append(button(
        `Схема ${child.id} → ${child.graphId} · все вызовы (без выбора выполнения)`,
        () => navigate({ graph: child.graphId, tab: "graph" }), "child-button"));
      if (parent && !scopes.length) definition.append(el("p", "muted", state.attempt !== parent.attempt
        ? "Связь с дочерним вызовом архивной попытки не записана в снимке."
        : "Для этого прохода дочерний вызов не найден в снимке."));
    }
  }
  const outgoing = selectedGraph().edges.filter((e) => e.from === node.id);
  if (node.retryPolicy) definition.append(el("p", "notice", `Повторы по политике: ${node.retryPolicy.codes.join(", ")} · задержка ${number(node.retryPolicy.delayMs)} мс · ${node.retryPolicy.maxAttempts === undefined ? "без лимита попыток" : `всего попыток до ${node.retryPolicy.maxAttempts}`}. Допускаются только подтверждённые not-started / read-only ошибки.`));
  if (node.retryPolicy?.provider) definition.append(el("p","muted",`Ошибки провайдера: ${node.retryPolicy.provider.statuses ? `только HTTP ${node.retryPolicy.provider.statuses.join(", ")}; без HTTP-статуса повтор не допускается` : "без фильтра HTTP-статусов"}. Retry-After: ${node.retryPolicy.provider.retryAfter === "honor" ? "учитывается как минимальная задержка" : "не изменяет задержку политики"}.`));
  if (state.transition?.runId === state.id && state.transition.context.graphId === state.graph && state.transition.decision.from === node.id && JSON.stringify(state.transition.context.scope) === state.scope) {
    definition.append(el("h3", "", "ВЫБРАННЫЙ ПЕРЕХОД"), transitionDetails(state.transition));
  }
  if (outgoing.length) {
    definition.append(el("h3", "", "ДАЛЬШЕ ПО ГРАФУ"));
    for (const edge of outgoing) {
      const details = el("details", "detail-run");
      details.append(
        el(
          "summary",
          "",
          `${edge.to}${edge.conditional ? " · по условию" : " · переход"}`,
        ),
        el(
          "pre",
          "",
          edge.conditional
            ? JSON.stringify(edge.condition, null, 2)
            : "Резервный переход, если ни одно условие исходящих переходов не выполнено.",
        ),
      );
      definition.append(details);
    }
  }
  aside.append(definition);
  aside.append(el("h3", "", state.key ? "ВЫБРАННОЕ ВЫПОЛНЕНИЕ" : "ВЫПОЛНЕНИЯ ЭТОГО УЗЛА"));
  if (state.key) aside.append(button("Все проходы этого узла", () => navigate({ graph: state.graph, scope: state.scope, node: state.node }), "child-button"));
  if (!node.activations.length)
    aside.append(
      el(
        "p",
        "muted",
        "Узел ещё не запускался. Не все ветки обязательно будут выполнены.",
      ),
    );
  for (const a of node.activations.filter(a => !state.key || a.key === state.key)) {
    const row = el("div", "detail-run"); row.dataset.uiKey = a.key;
    if (!state.key) row.append(button(`Проход ${a.visit ?? "—"} · попытка ${a.attempt}`, () => openActivation({ ...a, node, graphId: state.graph }), "child-button"));
    else row.append(el("strong", "", `Проход ${a.visit ?? "—"} · попытка ${state.attempt}`));
    if (state.key && state.attempt !== a.attempt) {
      row.append(el("p", "muted", "Выбрана архивная попытка. Результат последней попытки сюда не подставляется."));
      renderAttempts(row, a); aside.append(row); continue;
    }
    for (const child of node.children ?? []) {
      const matches = childExecutions(allActivations(), { ...a, node }, child);
      for (const scope of new Set(matches.map(item => item.scope))) row.append(button(`Открыть ${child.id} · этот проход`, () => navigate({ graph: child.graphId, scope, tab: "graph" }), "child-button"));
    }
    row.append(
      badge(a.status),
      el("div", "path", a.path),
      clock(el("p"), a.startedAt, a.finishedAt, `${date(a.startedAt)} · `),
    );
    if (a.usage)
      row.append(
        el(
          "p",
          "",
          `Расход выполнения за все попытки (накопленный): ${number(a.usage.totalTokens)} ток. · вход без кэша ${number(a.usage.input)} · кэш ${a.usage.cacheRead === undefined ? "н/д" : number(a.usage.cacheRead)} · выход ${number(a.usage.output)}${a.usageComplete === false ? " · частично" : ""}`,
        ),
      );
    if (a.result) row.append(el("p", "", a.result));
    else row.append(el("p", "muted", "Краткий результат не записан. Полный сохранённый вывод доступен в попытках."));
    if (state.key) renderExecutionTransitions(row, a);
    if (a.retry) row.append(retryView(a.retry, a.status === "retrying"));
    if (node.retryPolicy) renderRetries(row,a);
    if (node.failurePolicy === "collect") renderCollection(row, a);
    if (a.outputRepair) row.append(outputRepairView(a.outputRepair, a.status));
    if (a.failureCauses) for(const cause of a.failureCauses)row.append(failureView(cause));
    else if (a.failure) row.append(failureView(a.failure));
    else if (a.error) row.append(el("p", "", a.error));
    if (a.findings.length) {
      const details = el("details");
      details.append(el("summary", "", `Замечания: ${a.findings.length}`));
      for (const finding of a.findings) details.append(el("pre", "", finding));
      row.append(details);
    }
    renderAttempts(row,a);
    if (["failed", "interrupted"].includes(a.status)) renderRecovery(row, a);
    aside.append(row);
  }
  aside.scrollTop = scroll;
  if (recoveryField) {
    const field = document.getElementById(recoveryField);
    if (field) { field.focus({ preventScroll: true }); if (selection) field.setSelectionRange(...selection); }
  }
}
const svgNS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}, text) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}
const shorten = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
let layout, camera;
function cameraKey() {
  return JSON.stringify([state.id, state.graph, state.scope]);
}
function applyCamera() {
  if (camera) {
    $("graph").setAttribute(
      "viewBox",
      `${camera.x} ${camera.y} ${camera.width} ${camera.height}`,
    );
    const width = $("graph").getBoundingClientRect().width;
    $("actual-size").textContent = `${Math.round((width || camera.viewportWidth) / camera.width * 100)}%`;
  }
}
function fit() {
  if (!layout) return;
  const box = $("graph").getBoundingClientRect(),
    ratio = (box.width || 600) / (box.height || 500);
  const width = Math.max(layout.width, layout.height * ratio),
    height = width / ratio;
  camera = {
    mode: "fit",
    viewportWidth: box.width,
    x: (layout.width - width) / 2,
    y: (layout.height - height) / 2,
    width,
    height,
  };
  state.cameras.set(cameraKey(), camera);
  applyCamera();
}
function readableCamera() {
  if (!layout) return;
  const box = $("graph").getBoundingClientRect();
  const width = box.width || 700, height = box.height || 500;
  const graph = selectedGraph();
  const target = state.node ?? graph?.nodes.find(n => n.status === "running")?.id;
  const pos = layout.positions.get(target);
  // Layout reserves routing space after its last row. Center the visible content
  // of a short graph, so that unused trailing space cannot push its last node out.
  const extents = [...layout.positions.values()].flatMap(p => [p.y, p.y + p.height]);
  for (const edge of layout.edges) {
    extents.push(...edge.points.map(p => p.y));
    if (edge.label) extents.push(edge.labelBox.y, edge.labelBox.y + edge.labelBox.height);
  }
  const top = Math.min(0, ...extents), bottom = Math.max(0, ...extents);
  const contentTop = extents.length ? Math.min(...extents) : top;
  camera = {
    mode: "read", viewportWidth: box.width,
    x: pos && layout.width > width ? pos.x + pos.width / 2 - width / 2 : (layout.width - width) / 2,
    y: bottom - contentTop + 48 <= height ? (contentTop + bottom - height) / 2 : pos ? Math.max(0, pos.y - height / 3) : top,
    width, height,
  };
  state.cameras.set(cameraKey(), camera);
  applyCamera();
}
function zoom(factor) {
  if (!camera) return;
  const width = Math.max(Math.min(250, camera.width), camera.width * factor);
  if (!Number.isFinite(width) || width <= 0) return;
  const height = (width / camera.width) * camera.height;
  camera = {
    ...camera,
    mode: "manual",
    x: camera.x + (camera.width - width) / 2,
    y: camera.y + (camera.height - height) / 2,
    width,
    height,
  };
  state.cameras.set(cameraKey(), camera);
  applyCamera();
}
function revealGraphNode(pos) {
  if (!camera) return;
  const pad = 12;
  const x = pos.width + 2 * pad > camera.width ? pos.x - pad
    : Math.min(Math.max(camera.x, pos.x + pos.width + pad - camera.width), pos.x - pad);
  const y = pos.height + 2 * pad > camera.height ? pos.y - pad
    : Math.min(Math.max(camera.y, pos.y + pos.height + pad - camera.height), pos.y - pad);
  if (x !== camera.x || y !== camera.y) {
    camera = { ...camera, mode: "manual", x, y }; state.cameras.set(cameraKey(), camera); applyCamera();
  }
}
function renderGraph() {
  const graph = selectedGraph();
  const select = $("graph-select");
  if (!graph) {
    select.replaceChildren(...state.run.graphs.map(g => { const option = el("option", "", g.id); option.value = g.id; return option; }));
    const missing = el("option", "", `Недоступный граф: ${state.graph}`);
    missing.value = state.graph; select.prepend(missing); select.value = state.graph;
    $("scope-select").hidden = true;
    $("graph").replaceChildren(); layout = null; camera = null;
    $("graph-context").textContent = state.missing ?? "Выбранный граф отсутствует в плане.";
    return;
  }
  $("graph-context").textContent = state.key && state.attempt !== allActivations().find(a => a.key === state.key)?.attempt
    ? "Выбрана архивная попытка. Схема показывает последнее состояние узлов, не результат архивной попытки."
    : "Последнее состояние узлов · попытки — в дереве и последовательности";
  const graphIdentity = JSON.stringify([state.id, state.runSelection, graph.id, state.scope]);
  const focusedNode = document.activeElement?.dataset?.graphIdentity === graphIdentity ? document.activeElement.dataset.nodeId : null;
  let restoreFocus = null;
  select.replaceChildren(
    ...state.run.graphs.map((g) => {
      const option = el(
        "option",
        "",
        g.id === state.run.entryGraph ? "Основной процесс" : g.id,
      );
      option.value = g.id;
      option.selected = g.id === graph.id;
      return option;
    }),
  );
  const original = state.run.graphs.find((g) => g.id === graph.id),
    scopes = new Map();
  for (const a of original.nodes.flatMap((n) => n.activations))
    scopes.set(
      a.scope,
      a.path.split(" / ").slice(0, -1).join(" / ") || "Основной вызов",
    );
  const scopeSelect = $("scope-select");
  scopeSelect.hidden = scopes.size < 2;
  scopeSelect.replaceChildren();
  const all = el("option", "", "Все ветки");
  all.value = "";
  scopeSelect.append(all);
  for (const [id, name] of scopes) {
    const option = el("option", "", name);
    option.value = id;
    scopeSelect.append(option);
  }
  scopeSelect.value = state.scope;
  layout = layoutGraph(graph);
  const svg = $("graph");
  svg.replaceChildren();
  const defs = svgEl("defs");
  for (const [id, color] of [
    ["arrow", "#a2adbd"],
    ["loop-arrow", "#bd8f43"],
  ]) {
    const marker = svgEl("marker", {
      id,
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 6,
      markerHeight: 6,
      orient: "auto-start-reverse",
    });
    marker.append(svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color }));
    defs.append(marker);
  }
  svg.append(defs);
  for (const edge of layout.edges) {
    const traversalCount = (edge.traversals ?? []).filter(t => !state.scope || t.scope === state.scope).reduce((n, t) => n + t.count, 0);
    // A small background stroke makes a crossing distinguishable from a junction.
    svg.append(svgEl("path", { class: "edge-underlay", d: edge.path }));
    const path = svgEl("path", {
      class: `edge${edge.loop ? " loop" : ""}${traversalCount ? " traversed" : ""}${state.transition?.runId === state.id && state.transition.context.graphId === state.graph && JSON.stringify(state.transition.context.scope) === state.scope && state.transition.decision.edgeIndex === edge.index ? " trace-selected" : ""}`,
      d: edge.path,
      "data-edge-index": edge.index,
      "marker-end": `url(#${edge.loop ? "loop-arrow" : "arrow"})`,
    });
    path.append(
      svgEl(
        "title",
        {},
        `${edge.from} → ${edge.to} · ребро #${edge.index + 1} · исходящий переход ${edge.order} · записанных выборов: ${traversalCount}${edge.conditional ? ` · ${JSON.stringify(edge.condition)}` : " · без условия"}`,
      ),
    );
    svg.append(path);
  }
  // Labels are painted after every connector, so later crossings cannot clip them.
  for (const edge of layout.edges) {
    if (edge.label) {
      svg.append(svgEl("rect", { ...edge.labelBox, class: "edge-label-mask", rx: 3 }));
      svg.append(
        svgEl(
          "text",
          { x: edge.labelX, y: edge.labelY, class: "edge-label" },
          edge.label,
        ),
      );
    }
  }
  for (const node of graph.nodes) {
    const pos = layout.positions.get(node.id),
      selected = node.id === state.node,
      g = svgEl("g", {
        class: `graph-node ${node.status}${attention(node) ? " attention" : ""}${selected ? " selected" : ""}`,
        transform: `translate(${pos.x} ${pos.y})`,
        tabindex: 0,
        role: "button",
        "aria-pressed": String(selected),
        "aria-label": `${title(node)}: ${node.id}, последнее состояние узла: ${names[node.status] ?? node.status}`,
      });
    g.dataset.graphIdentity = graphIdentity; g.dataset.nodeId = node.id;
    if (focusedNode === node.id) restoreFocus = g;
    g.append(
      svgEl("title", {}, `${title(node)}: ${node.id}`),
      svgEl("rect", {
        class: "node-box",
        width: pos.width,
        height: pos.height,
        rx: 11,
      }),
      svgEl(
        "text",
        { x: 16, y: 27, class: "node-title" },
        shorten(title(node), 25),
      ),
      svgEl("text", { x: 16, y: 47, class: "node-meta" }, shorten(node.id, 30)),
      svgEl(
        "text",
        { x: 16, y: 69, class: "node-state" },
        collectionNotice(node) ??
        (attention(node)
          ? "Есть замечания"
          : node.activations.length > 1
            ? `Запусков: ${node.activations.length} · веток: ${node.branches}`
            : (names[node.status] ?? node.status)),
      ),
    );
    g.append(
      svgEl(
        "text",
        { x: 16, y: 89, class: "node-token" },
        node.kind === "agent"
          ? `${node.usage.reported ? number(node.usage.totalTokens) : node.activations.length ? "н/д" : "—"} токенов${node.usage.partial ? " · частично" : ""}`
          : node.children.length
            ? `↳ Вложенных графов: ${node.children.length}`
            : "",
      ),
    );
    g.addEventListener("focus", () => revealGraphNode(pos));
    g.addEventListener("click", () => selectNode(graph.id, node.id));
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectNode(graph.id, node.id);
      }
    });
    svg.append(g);
    // Реальная ширина шрифта важнее количества символов; полный текст остаётся в title/ARIA.
    for (const text of Array.from(g.children).filter(child => child.tagName.toLowerCase() === "text")) {
      if (typeof text.getComputedTextLength !== "function") continue;
      const glyphs = Array.from(text.textContent), maxWidth = pos.width - 32;
      while (glyphs.length && text.getComputedTextLength() > maxWidth) {
        glyphs.pop(); text.textContent = glyphs.join("") + "…";
      }
    }
  }
  camera = state.cameras.get(cameraKey());
  if (!camera) readableCamera();
  applyCamera();
  if (restoreFocus) restoreFocus.focus({ preventScroll: true });
}
function sectionHeading(text) {
  const row = el("div", "section-heading");
  row.append(el("h2", "", text));
  return row;
}
function taskRow(a) {
  const row = el("div", "task-row"),
    body = el("div", "task-body");
  body.append(
    button(`${title(a.node)} · ${a.node.id}`, () => {
      void openActivation(a);
    }),
    el("div", "muted", a.path),
  );
  if (a.result) body.append(el("div", "muted result-preview", a.result));
  if (a.outputRepair?.status === "running" && a.status === "running") body.append(el("div", "notice", `Исправление формата · раунд ${a.outputRepair.round} · только submit_result`));
  if (a.failure) body.append(el("div", "muted", a.failure.message));
  else if (a.error) body.append(el("div", "muted", a.error));
  const right = el(
    "div",
    "task-number",
    a.usage
      ? `${number(a.usage.totalTokens)} ток.`
      : a.node.kind === "agent"
        ? "Токены: н/д"
        : "",
  );
  row.dataset.uiKey = JSON.stringify([a.runId ?? state.id, a.key, a.attempt]);
  row.setAttribute("data-selected", String(state.key === a.key && state.attempt === a.attempt && (!a.runId || a.runId === state.id)));
  body.append(el("small", "execution-identity", `Проход ${a.visit ?? "—"} · последняя попытка ${a.attempt}${state.key === a.key && state.attempt !== a.attempt ? " · выбрана архивная попытка " + state.attempt : ""}`));
  right.append(clock(el("small"), a.startedAt, a.finishedAt));
  row.append(badge(a.status), body, right);
  return row;
}
// Показываем уже действующие ограничения RunStore. Допуск по-прежнему проверяет сервер.
function waitResponseBlocker(run) {
  if (run.lineage?.successorRunId) return "Этот запуск заменён продолжением. Новые ответы здесь не принимаются.";
  if (run.desired === "cancelled" || run.status === "cancelling") return "Отмена уже запрошена. Новые ответы не принимаются.";
  if (finished.has(run.status)) return "Запуск завершён. Новые ответы не принимаются.";
  return null;
}
function renderNow() {
  const panel = $("content-panel");
  panel.replaceChildren(sectionHeading("Текущая работа"));
  const waitBlocker = waitResponseBlocker(state.run);
  const activations = allActivations(), byKey = new Map(activations.map(a => [a.key, a]));
  if (!finished.has(state.run.status)) for (const wait of state.run.waits ?? []) {
    if (wait.status !== "open") {
      if (byKey.get(wait.key)?.status === "answered") {
        const saved = el("section", "wait-card");
        saved.append(el("h3", "", state.run.desired === "paused" ? "Ответ сохранён · на паузе" : "Ответ сохранён · ожидает продолжения"),
          el("p", "", wait.reason), el("pre", "", JSON.stringify(wait.response, null, 2)));
        panel.append(saved);
      }
      continue;
    }
    let draft = waitDrafts.get(wait.id);
    if (!draft) { draft = { text: "", busy: false, error: null }; waitDrafts.set(wait.id, draft); }
    const card = el("section", "wait-card"), selectedRun = state.id;
    card.dataset.uiKey = JSON.stringify([state.id, wait.id]);
    card.append(el("h3", "", wait.reason));
    const activation = byKey.get(wait.key);
    card.append(el("p", "muted", activation?.path ?? `Активация: ${wait.key}`), el("p", "muted", `Ожидание: ${wait.id}`));
    const details = el("details");
    details.dataset.waitDetails = wait.id; details.open = draft.detailsOpen ?? false;
    const summary = el("summary", "", "Данные и формат ответа");
    summary.id = `wait-summary-${wait.id}`; summary.dataset.waitControl = "1";
    details.append(summary, el("pre", "", JSON.stringify({ runId: selectedRun, waitId: wait.id, input: wait.input, responseSchema: wait.responseSchema }, null, 2)));
    card.append(details);
    if (waitBlocker) {
      card.append(el("p", "muted", waitBlocker));
      if (state.run.lineage?.successorRunId) {
        const successor = state.run.lineage.successorRunId;
        card.append(button("Открыть продолжение", () => selectRun(successor), "child-button"));
      }
      panel.append(card);
      continue;
    }
    const field = el("textarea");
    field.id = `wait-response-${wait.id}`; field.dataset.waitId = wait.id;
    field.setAttribute("aria-label", `Ответ: ${wait.reason} · ${wait.id}`);
    field.placeholder = "Ответ в формате JSON"; field.value = draft.text; field.rows = 5;
    field.addEventListener("input", () => { draft.text = field.value; });
    const submit = button(draft.busy ? "Сохраняем…" : "Сохранить ответ", async () => {
      if (draft.busy || state.id !== selectedRun || !state.run || waitResponseBlocker(state.run) ||
          !state.run.waits?.some(current => current.id === wait.id && current.status === "open")) return;
      const selection = state.runSelection;
      const current = () => state.id === selectedRun && state.runSelection === selection;
      draft.busy = true; draft.error = null; submit.disabled = true;
      try {
        const response = JSON.parse(draft.text);
        // Decode the original POST even after navigation: a stale 400 belongs to
        // this draft, while api's captured visit still forbids a stale 401 reload.
        await api("resolve", { method: "POST", headers: { "Content-Type": "application/json", "X-Dynamicwf-View": "1" }, body: JSON.stringify({ id: selectedRun, waitId: wait.id, response }) });
        if (current()) await refreshSnapshot();
      } catch (error) { draft.error = error.message; }
      finally { draft.busy = false; if (showingWait(selectedRun, wait.id)) renderPanel(); }
    }, "child-button");
    submit.id = `wait-submit-${wait.id}`; submit.dataset.waitControl = "1";
    submit.disabled = draft.busy;
    card.append(field, submit);
    if (draft.error) { const error = el("p", "notice", draft.error); error.setAttribute("role", "alert"); card.append(error); }
    if (state.run.desired === "paused") card.append(el("p", "muted", "Ответ сохранится. Работа продолжится после снятия паузы."));
    panel.append(card);
  }
  const active = activations.filter((a) =>
    state.run.activeKeys.includes(a.key),
  );
  for (const a of activations.filter(a=>(state.run.retryingKeys??[]).includes(a.key))) {
    const row=taskRow(a);if(a.retry)row.append(retryView(a.retry, a.status === "retrying"));panel.append(row);
  }
  if (!active.length)
    panel.append(
      el(
        "p",
        "muted",
        finished.has(state.run.status)
          ? "Запуск завершён. Все результаты доступны в истории."
          : state.run.lineage?.successorRunId
            ? "Работа перенесена в запуск-продолжение."
          : state.run.desired === "cancelled"
            ? "Отмена запрошена. Новые задачи и ответы больше не принимаются."
          : "Новых задач пока нет. Ожидание следующего шага.",
      ),
    );
  for (const a of active) {
    const row = taskRow(a);
    if (a.activity)
      row
        .querySelector(".task-body")
        .append(
          clock(
            el("div", "muted"),
            a.activity.at,
            null,
            `${a.activity.label} · `,
            " назад",
          ),
        );
    panel.append(row);
  }
  panel.append(
    el(
      "p",
      "explanation",
      "Здесь показаны реальные активные задачи. Контейнеры скрыты, пока внутри них выполняются дочерние узлы. Последнее событие — наблюдение из журнала, а не поток рассуждений модели.",
    ),
  );
}
function renderHistory() {
  const panel = $("content-panel"), id = state.id, visit = state.runSelection;
  panel.replaceChildren();
  const heading = sectionHeading("История выполнения"),
    filter = el("select");
  filter.setAttribute("aria-label", "Фильтр истории");
  for (const [value, label] of [
    ["all", "Все задачи"],
    ["agent", "Только агенты"],
    ["issues", "Ошибки и замечания"],
  ]) {
    const option = el("option", "", label);
    option.value = value;
    filter.append(option);
  }
  filter.value = state.filter;
  filter.addEventListener("change", () => {
    if (state.id !== id || state.runSelection !== visit || !state.run || state.tab !== "history") return;
    state.filter = filter.value;
    renderPanel();
  });
  heading.append(filter);
  panel.append(
    heading,
    el(
      "p",
      "muted",
      "От начала к результату. Каждая строка — отдельный проход; попытки доступны в деталях. Параллельные работы могут пересекаться по времени.",
    ),
  );
  const records = allActivations()
    .sort(executionSequence)
    .filter(
      (a) =>
        state.filter === "all" ||
        (state.filter === "agent" && a.node.kind === "agent") ||
        (state.filter === "issues" &&
          (a.error ||
            (a.findings?.length ?? 0) > 0 ||
            Number(a.collectionSummary?.failed) > 0 ||
            /request_changes|rejected|inconclusive|exit [1-9]|не принят/.test(
              a.result ?? "",
            ))),
    );
  panel.append(traceLoader());
  const decisions = tracePages.get(state.id).reports;
  for (const a of records.slice(0, state.historyLimit)) {
    const row = taskRow(a);
    row.append(el("time", "event-time", date(a.startedAt)));
    const transition = decisions.find(t => t.key === a.key && t.attempt === a.attempt);
    if (transition) row.append(transitionCard(transition));
    panel.append(row);
  }
  if (records.length > state.historyLimit) panel.append(button(`Показать ещё · осталось ${records.length-state.historyLimit}`, () => { state.historyLimit += 100; renderPanel(); }, "child-button"));
  if (!records.length)
    panel.append(el("p", "muted", "Таких результатов пока нет."));
}
function renderActivityStrip() {
  const panel = $("activity-strip");
  const context = JSON.stringify([state.id, state.graph, state.scope, "activity"]);
  remember(panel, context, () => {
    if (panel.dataset.context !== context) panel.open = false;
    const list = $("activity-list");
    const heading = sectionHeading("Выполнения в этом графе");
    heading.append(button("Вся последовательность →", () => setTab("history")));
    list.replaceChildren(heading);
    const records = allActivations().filter(a => a.graphId === state.graph && (!state.scope || a.scope === state.scope)).sort((a,b) => executionSequence(b,a));
    $("activity-count").textContent = number(records.length);
    for (const a of records.slice(0, 20)) list.append(taskRow(a));
    if (records.length > 20) list.append(el("p", "muted", `Последние 20 из ${records.length}. Все проходы доступны в последовательности.`));
    if (!records.length) list.append(el("p", "muted", "Вызовы ещё не записаны. Граф выше показывает план."));
  });
}
function traceLoader() {
  const page = tracePages.get(state.id), id = state.id, row = el("div", "trace-loader");
  if (!state.run.trace?.supported) { row.append(el("p", "muted", "Причины переходов не записывались в этом плане.")); return row; }
  row.append(el("small", "muted", `Причины переходов: загружено ${page.reports.length} из ${state.run.trace.count}. Выбор пути не доказывает запуск следующего узла.`));
  const load = button(page.loading ? "Загрузка…" : page.hasMore ? "Ещё причины переходов" : page.opened ? "Обновить причины переходов" : "Загрузить причины переходов", async () => {
    const pending = tracePages.load(id, async (runId, cursor) => { const data = await api(`trace?id=${encodeURIComponent(runId)}&after=${cursor}`); return { ...data, reports: data.records }; });
    load.disabled = true; await pending; if (showingTrace(id)) renderPanel();
  }, "child-button");
  load.dataset.uiKey = "trace-load";
  load.disabled = page.loading; row.append(load);
  if (page.error) row.append(el("p", "notice", page.error));
  return row;
}
function transitionCard(record) {
  const details = el("details", "transition-event"); details.dataset.uiKey = `transition:${record.seq}`;
  const reason = { condition: "по записанному условию", fallback: "запасной переход", "no-match": "подходящий переход не найден", error: "ошибка условия" }[record.decision.reason];
  details.append(el("summary", "", `→ ${record.decision.to ?? "Ошибка маршрутизации"} · ${reason}`), transitionDetails(record));
  const target = transitionTarget(record, allActivations());
  if (target) details.append(button(`Открыть следующий проход: ${target.node.id} · ${target.visit}`, () => openActivation(target), "child-button"));
  else details.append(el("p", "muted", "Следующее выполнение не найдено в снимке. Решение само по себе не означает его допуск."));
  return details;
}
function renderExecutionTransitions(row, activation) {
  const records = tracePages.get(state.id).reports.filter(t => t.key === activation.key && t.attempt === (state.attempt ?? activation.attempt));
  row.append(traceLoader());
  for (const record of records) row.append(transitionCard(record));
}
function transitionDetails(record) {
  const block = el("div", "transition-details"), decision = record.decision;
  const explanations = {
    condition: "Выбрано первое выполненное условие.",
    fallback: "Условия не выбрали путь; использован запасной переход.",
    "no-match": "Ни одно условие не выбрало путь; запасной переход отсутствует.",
    error: "Проверка условия завершилась ошибкой; переход не выбран.",
  };
  block.append(el("p", "", decision.error ?? explanations[decision.reason] ?? "Причина перехода неизвестна."));
  for (const evaluation of decision.evaluations) {
    const details = el("details");
    details.append(el("summary", "", `Ребро #${evaluation.edgeIndex + 1} → ${evaluation.to}: ${routingLabels[evaluation.result]}`));
    const edge = state.run.graphs.find(g => g.id === record.context.graphId)?.edges[evaluation.edgeIndex];
    details.append(el("pre", "", edge?.condition ? JSON.stringify(edge.condition, null, 2) : "Безусловный запасной переход"));
    block.append(details);
  }
  return block;
}
function renderTrace() {
  const panel = $("content-panel"), id = state.id, visit = state.runSelection, summary = state.run.trace, page = tracePages.get(id);
  // Start the automatic tail read without a nested renderPanel: the outer remember()
  // must restore its captured disclosures/focus before any asynchronous redraw.
  const automatic = summary.supported && !page.loading && !page.error && (!page.opened || !page.hasMore && summary.lastSeq > page.cursor);
  if (automatic) void load(true);
  panel.replaceChildren(sectionHeading("Фактические переходы"));
  if (!summary.supported) {
    panel.append(el("p", "muted", "Этот план создан до записи трассы. Исторические переходы неизвестны; цвет узлов их не доказывает.")); return;
  }
  panel.append(el("p", "muted", `Записано решений: ${summary.count} · ошибок маршрутизации: ${summary.failed}. Выбор ребра не означает, что следующий узел уже запущен.`));
  async function load(automatic = false) {
    const request = tracePages.load(id, async (runId, cursor) => {
      const data = await api(`trace?id=${encodeURIComponent(runId)}&after=${cursor}`);
      return { ...data, reports: data.records };
    });
    if (!automatic && state.id === id && state.runSelection === visit && state.tab === "trace") renderPanel();
    await request;
    if (showingTrace(id)) renderPanel();
  }
  if (page.loading) panel.append(el("p", "muted", "Загружаем переходы…"));
  if (page.error) panel.append(el("p", "notice", page.error));
  for (const record of page.reports) {
    const card = el("section", `trace-card${record.decision.error ? " routing-error" : ""}`);
    card.append(el("h3", "", `${record.decision.from} → ${record.decision.to ?? "ошибка маршрутизации"}`),
      el("p", "muted", `${record.context.graphId} · проход ${record.context.visit + 1} · попытка ${record.attempt} · ${date(record.at)}`),
      el("div", "path", JSON.stringify(record.context.scope)), transitionDetails(record),
      button("Показать источник на графе", () => {
        navigate({ graph: record.context.graphId, scope: JSON.stringify(record.context.scope), node: record.decision.from,
          key: record.key ?? null, attempt: record.key ? record.attempt : null, transition: record, tab: "graph" });
        const pos = layout?.positions.get(record.decision.from);
        if (pos && camera) { camera.x = pos.x + pos.width / 2 - camera.width / 2; camera.y = pos.y + pos.height / 2 - camera.height / 2; applyCamera(); }
      }, "child-button"));
    panel.append(card);
  }
  if (page.hasMore || page.error) panel.append(button(page.error ? "Повторить загрузку" : "Загрузить следующие переходы", () => void load(), "child-button"));
  if (page.opened && !page.reports.length) panel.append(el("p", "muted", "Решений о переходе пока нет."));
}
function renderTokens() {
  const panel = $("content-panel");
  const taskId = state.run.lineage?.taskId;
  const taskUsage = taskUsageForView(state);
  const taskMode = Boolean(taskUsage);
  const u = taskMode ? taskUsage.summary : state.run.usage;
  panel.replaceChildren(sectionHeading("Расход токенов"));
  if (taskId) {
    const selectedRun = state.id, visit = state.runSelection;
    const current = () => state.id === selectedRun && state.runSelection === visit && Boolean(state.run);
    const toggle = el("div", "usage-scope");
    toggle.append(
      button("Этот запуск", () => { if (!current()) return; state.usageScope = "run"; renderPanel(); }, state.usageScope === "run" ? "child-button selected" : "child-button"),
      button("Вся задача", async () => {
        if (!current()) return;
        state.usageScope = "task";
        const pending = loadTaskScope(taskId);
        renderPanel(); await pending;
        if (current() && state.tab === "tokens") renderPanel();
      }, state.usageScope === "task" ? "child-button selected" : "child-button"),
    );
    panel.append(toggle);
    if (state.usageScope === "task" && state.taskUsageError) panel.append(el("p", "notice", state.taskUsageError));
    if (taskMode) {
      panel.append(el("p", "muted", `Связанных запусков: ${taskUsage.runs.length}. Повторно использованные результаты (${taskUsage.reusedOutputs}) не добавляют вызовов модели. Оценка SDK — не списание по подписке.`));
      for (const item of taskUsage.runs) {
        panel.append(button(`${item.id} · ${tokenTotalLabel(item.summary)}`, () => selectRun(item.id), "child-button"));
      }
    }
  }
  if (state.usageScope === "task" && taskId && !taskMode) {
    panel.append(el("p", "muted", "Загружаем расход всей задачи…")); return;
  }
  const split = el("div", "token-breakdown");
  for (const [label, value, partial] of [
    ["Всего", u.reported || !u.partial ? u.totalTokens : null, u.partial],
    ["Вход без кэша", u.reported || !u.partial ? u.input : null, u.partial],
    ["Чтение кэша", u.cacheReadReported ? u.cacheRead : null, u.cacheReadPartial],
    ["Запись кэша", u.cacheWriteReported ? u.cacheWrite : null, u.cacheWritePartial],
    ["Выход", u.reported || !u.partial ? u.output : null, u.partial],
    ["Reasoning (входит в выход)", u.reasoningReported ? u.reasoning : null, u.reasoningPartial],
  ]) {
    const item = el("div", "muted", label);
    item.append(
      el("strong", "", value === null ? "Нет отчётов" : number(value)),
    );
    if (value !== null && partial) item.append(el("span", "", "Известная часть"));
    split.append(item);
  }
  panel.append(split);
  const notes = [
    u.partial ? "Данные неполные." : "Получены отчёты всех запущенных агентов.",
  ];
  if (u.pending) notes.push(`Ещё работают без отчёта: ${u.pending}.`);
  if (u.incomplete) notes.push(`Расход ещё растёт или учтён частично: ${u.incomplete} агентов.`);
  if (u.cacheReadPartial || u.cacheWritePartial) notes.push("Детализация кэша есть не у всех ответов или расход ещё растёт.");
  if (u.missing) notes.push(`Отчёт не сохранён: ${u.missing}.`);
  if (u.earlierAttempts)
    notes.push(`Не учтены отдельно предыдущие попытки: ${u.earlierAttempts}.`);
  notes.push(
    "Новые запуски сохраняют расход после каждого ответа модели, включая уже известный расход при ошибке или отмене. Reasoning входит в выход. Оценка SDK — не списание по подписке.",
  );
  panel.append(el("div", "explanation", notes.join(" ")));
  const ledger = el("div", "usage-ledger");
  const selectedRun = state.id;
  const pageKey = taskMode ? `task:${taskUsage.taskId}` : selectedRun;
  const page = usagePages.get(pageKey);
  const records = taskMode ? taskActivations() : allActivations();
  for (const report of page.reports) {
    const activation = records.find(a => a.key === report.key && (!report.runId || !a.runId || a.runId === report.runId));
    const origin = reportOrigin(report, records, selectedRun);
    const row = el("div", "detail-run");
    row.append(el("strong", "", `${activation?.basePath ?? activation?.path?.replace(/ · попытка \d+$/, "") ?? "Агент"}${report.runId ? ` · ${report.runId.slice(-8)}` : ""} · попытка ${report.attempt} · ответ ${report.reportId}`),
      el("p", "", `${number(report.usage.totalTokens)} ток. · вход ${number(report.usage.input)} · кэш ${report.usage.cacheRead === undefined ? "н/д" : number(report.usage.cacheRead)} · выход ${number(report.usage.output)} · ${report.stopReason} · pi SDK${report.observedEffort ? ` · рассуждение ${report.observedEffort} (${report.observedEffortSource === "sdk-message" ? "сообщено SDK" : report.observedEffortSource === "request-payload" ? "отправлено в запросе" : "источник неизвестен"})` : ""}`));
    if (origin?.runId) {
      row.append(button(origin.nodeId ? `Открыть ${origin.nodeId} · ${origin.runId}` : `Открыть ${origin.runId}`, () => {
        void openActivation(origin);
      }, "child-button"));
    }
    ledger.append(row);
  }
  if (page.opened && !page.reports.length) ledger.append(el("p", "muted", "Поответных отчётов пока нет. Старые запуски сохраняли только итог worker."));
  if (page.error) ledger.append(el("p", "explanation", page.error));
  const load = button(page.loading ? "Загрузка…" : !page.opened ? "Показать исходные отчёты ответов" : page.hasMore ? "Следующие отчёты" : "Проверить новые отчёты", async () => {
    const pending = usagePages.load(pageKey, (_id, cursor) => taskMode
      ? api(`task-usage?id=${encodeURIComponent(taskUsage.taskId)}&after=${cursor}`)
      : api(`usage?id=${encodeURIComponent(selectedRun)}&after=${cursor}`));
    load.disabled = true;
    load.textContent = "Загрузка…";
    await pending;
    if (showingUsage(selectedRun, pageKey)) renderPanel();
  }, "child-button");
  load.disabled = page.loading;
  panel.append(load, ledger);
  const groups = new Map();
  const agents = records.filter((a) => a.node.kind === "agent");
  for (const a of agents) {
    const name = a.node.model
      ? `${a.node.model.provider} / ${a.node.model.id}`
      : "Модель не записана";
    groups.set(name, [...(groups.get(name) ?? []), a]);
  }
  panel.append(sectionHeading("По моделям"));
  for (const [name, records] of [...groups].sort(
    (a, b) => sum(b[1]).totalTokens - sum(a[1]).totalTokens,
  )) {
    const tokens = sum(records),
      row = el("div", "model-row"),
      heading = el("div", "model-title");
    heading.append(
      el("span", "", name),
      el(
        "strong",
        "",
        tokens.reported
          ? `${number(tokens.totalTokens)} · ${u.totalTokens ? Math.round((tokens.totalTokens / u.totalTokens) * 100) : 0}%`
          : "Нет отчёта",
      ),
    );
    const bar = el("progress", "model-bar");
    bar.max = u.totalTokens || 1;
    bar.value = tokens.totalTokens;
    bar.setAttribute("aria-label", `Доля токенов ${name}`);
    row.append(heading, bar);
    panel.append(row);
  }
  panel.append(sectionHeading("По агентам и проходам"));
  for (const a of agents.sort(
    (a, b) => (b.usage?.totalTokens ?? -1) - (a.usage?.totalTokens ?? -1),
  ))
    panel.append(taskRow(a));
  if (!agents.length)
    panel.append(el("p", "muted", "Агенты ещё не запускались."));
}
async function refreshSnapshot() {
  const id = state.id;
  if (!id) return;
  const request = ++state.snapshotRequest;
  const current = () => id === state.id && request === state.snapshotRequest;
  try {
    const run = await api(`snapshot?id=${encodeURIComponent(id)}`, undefined, current);
    if (!current()) return;
    state.snapshotAt = Date.now();
    state.run = run;
    if (state.pendingTaskReconcile?.selection === state.runSelection) {
      reconcileTaskScopeAfterSnapshot(state, state.pendingTaskReconcile.previousTaskId);
      state.pendingTaskReconcile = null;
    }
    state.graph ??= run.entryGraph;
    Object.assign(state, resolveLocation(run, state));
    const pending = state.pendingActivation;
    if (pending && pending.id === id && pending.selection === state.runSelection && pending.intent === state.navigationRevision) {
      state.pendingActivation = null;
      writeLocation();
    }
    const signature = JSON.stringify({
      ...run,
      presentation: { ...run.presentation, liveness: { ...run.presentation.liveness, observedAt: null } },
      heartbeatAt: null,
      updatedAt: finished.has(run.status) ? run.updatedAt : null,
    });
    if (signature !== state.signature) {
      state.signature = signature;
      renderHeader();
      renderPanel();
    }
    if (state.usageScope === "task" && run.lineage?.taskId) {
      const taskId = run.lineage.taskId;
      void loadTaskScope(taskId).then((applied) => {
        if (applied && state.id === id && state.usageScope === "task" && state.run?.lineage?.taskId === taskId && state.tab === "tokens") renderPanel();
      });
    }
    notice(state.controlError ?? (run.failure ? null : run.error));
    $("connection").textContent = "● Данные обновляются";
  } catch (error) {
    if (current()) {
      notice(error.message);
      $("connection").textContent = "Нет связи · повторяем подключение";
    }
  }
}
async function refreshRuns(isCurrent = () => true) {
  const request = ++state.listRequest;
  const current = () => request === state.listRequest && isCurrent();
  try {
    const data = await api("runs", undefined, current);
    if (!current()) return;
    state.runs = data.runs;
    const signature = JSON.stringify({ ...data, runs: data.runs.map(run => ({ ...run,
      presentation: { ...run.presentation, liveness: { ...run.presentation.liveness, observedAt: null } },
    })) });
    if (signature !== state.listSignature) {
      state.listSignature = signature;
      renderRuns();
    }
    if (!state.id && (data.runs.length || new URL(window.location.href).searchParams.get("run")))
      await selectRun(
        new URL(window.location.href).searchParams.get("run") ?? data.initialRun ??
          data.runs.find((r) => !finished.has(r.status))?.id ??
          data.runs[0]?.id,
        "replace",
      );
    if (!data.runs.length && !state.id) {
      $("empty").hidden = false;
      $("connection").textContent = "● Подключено";
    }
  } catch (error) {
    if (!current()) return;
    notice(error.message);
    $("connection").textContent = "Нет связи";
  }
}
async function control(command) {
  if (state.busy || !state.run) return;
  const id = state.id, selection = state.runSelection;
  const current = () => state.id === id && state.runSelection === selection;
  state.busy = true;
  state.controlError = null;
  renderHeader();
  try {
    await api("control", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Dynamicwf-View": "1" },
      body: JSON.stringify({ id, command }),
    }, current);
    if (!current()) return;
    notice(null);
    await refreshSnapshot();
    if (!current()) return;
    await refreshRuns(current);
  } catch (error) {
    if (current()) {
      state.controlError = error.message;
      notice(error.message);
    }
  } finally {
    state.busy = false;
    if (state.run) renderHeader();
  }
}
let cancelTarget = null;
function closeCancelDialog() {
  cancelTarget = null;
  if ($("cancel-dialog").open) $("cancel-dialog").close();
}
$("search").addEventListener("input", renderRuns);
for (const b of document.querySelectorAll("[data-tab]"))
  b.addEventListener("click", () => setTab(b.dataset.tab));
$("graph-select").addEventListener("change", () => {
  navigate({ graph: $("graph-select").value, tab: state.tab });
});
$("scope-select").addEventListener("change", () => {
  navigate({ graph: state.graph, scope: $("scope-select").value, node: state.node, tab: state.tab });
});
$("fit").addEventListener("click", fit);
$("actual-size").addEventListener("click", readableCamera);
function setGraphExpanded(expanded) {
  document.body.dataset.graphExpanded = String(expanded);
  $("expand-graph").setAttribute("aria-pressed", String(expanded));
  $("expand-graph").textContent = expanded ? "↙ Вернуться к обзору" : "На всё окно ↗";
}
$("expand-graph").addEventListener("click", () => setGraphExpanded(document.body.dataset.graphExpanded !== "true"));
window.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.body.dataset.graphExpanded === "true") {
    e.preventDefault();
    setGraphExpanded(false);
    $("expand-graph").focus({ preventScroll: true });
  }
});
$("zoom-in").addEventListener("click", () => zoom(0.8));
$("zoom-out").addEventListener("click", () => zoom(1.25));
$("pause").addEventListener("click", () => control("pause"));
$("resume").addEventListener("click", () => control("resume"));
$("cancel").addEventListener("click", () => {
  if (!state.run) return;
  cancelTarget = { id: state.id, selection: state.runSelection };
  $("cancel-target").textContent = state.run.name + " · " + state.run.id;
  $("cancel-dialog").showModal();
});
$("cancel-dialog").addEventListener("cancel", () => { cancelTarget = null; });
$("cancel-back").addEventListener("click", closeCancelDialog);
$("cancel-confirm").addEventListener("click", () => {
  const target = cancelTarget;
  closeCancelDialog();
  if (!target || target.id !== state.id || target.selection !== state.runSelection) return;
  void control("cancel");
});
let drag;
$("graph").addEventListener("pointerdown", (e) => {
  if (e.target.closest(".graph-node") || !camera) return;
  drag = { x: e.clientX, y: e.clientY, camera: { ...camera } };
  $("graph").setPointerCapture(e.pointerId);
  $("graph").classList.add("dragging");
});
$("graph").addEventListener("pointermove", (e) => {
  if (!drag) return;
  const box = $("graph").getBoundingClientRect();
  camera = {
    ...drag.camera,
    mode: "manual",
    x: drag.camera.x - ((e.clientX - drag.x) * drag.camera.width) / box.width,
    y: drag.camera.y - ((e.clientY - drag.y) * drag.camera.height) / box.height,
  };
  state.cameras.set(cameraKey(), camera);
  applyCamera();
});
for (const name of ["pointerup", "pointercancel"])
  $("graph").addEventListener(name, () => {
    drag = null;
    $("graph").classList.remove("dragging");
  });
$("graph").addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    zoom(e.deltaY > 0 ? 1.12 : 0.89);
  },
  { passive: false },
);
$("graph").setAttribute("tabindex", "0");
$("graph").addEventListener("keydown", e => {
  if (e.target !== $("graph") || !camera) return;
  if (["+", "=", "-", "Home"].includes(e.key)) {
    e.preventDefault();
    if (e.key === "Home") fit(); else zoom(e.key === "-" ? 1.2 : 0.8);
    return;
  }
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
  e.preventDefault();
  camera = { ...camera, mode: "manual", x: camera.x + (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0) * camera.width / 8,
    y: camera.y + (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0) * camera.height / 8 };
  state.cameras.set(cameraKey(), camera); applyCamera();
});
new ResizeObserver(() => {
  if (state.tab === "graph" && camera) {
    const box = $("graph").getBoundingClientRect();
    if (box.width && box.height) {
      if (camera.mode === "fit") { fit(); return; }
      const center = camera.x + camera.width / 2;
      const middle = camera.y + camera.height / 2;
      camera.width *= box.width / (camera.viewportWidth || box.width);
      camera.x = center - camera.width / 2;
      camera.height = (camera.width * box.height) / box.width;
      camera.y = middle - camera.height / 2;
      camera.viewportWidth = box.width;
      state.cameras.set(cameraKey(), camera);
      const selected = layout?.positions.get(state.node);
      if (selected) revealGraphNode(selected);
      applyCamera();
    }
  }
}).observe($("graph"));
window.addEventListener("popstate", () => {
  state.navigationRevision++;
  state.pendingActivation = null;
  const route = readLocation(window.location.href);
  closeCancelDialog();
  if (route.id && route.id === state.id && state.run) { Object.assign(state, resolveLocation(state.run, route), { transition: null }); renderPanel(); }
  else if (route.id) void selectRun(route.id, "pop");
  else { beginRunSelection(state, null); state.pendingTaskReconcile = null; hideNavigation(); void refreshRuns(); }
});
await refreshRuns();
let tick = 0;
async function poll() {
  await refreshSnapshot();
  for (const node of document.querySelectorAll("[data-started-at]"))
    node.textContent =
      node.dataset.prefix +
      duration(
        (node.dataset.finishedAt
          ? Number(node.dataset.finishedAt)
          : Date.now()) - Number(node.dataset.startedAt),
      ) +
      node.dataset.suffix;
  if (++tick % 3 === 0) await refreshRuns();
  if (state.run && !finished.has(state.run.status) && $("elapsed"))
    $("elapsed").textContent = duration(Date.now() - state.run.createdAt);
  setTimeout(poll, 1000);
}
setTimeout(poll, 1000);
