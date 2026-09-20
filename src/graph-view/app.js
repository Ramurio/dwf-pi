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
const recoveryInspections = new Map();
const reconciliationRecords = new Map();
const recoveryDrafts = new Map();
const routingLabels = { true: "Условие выполнено", false: "Условие не выполнено", "not-evaluated": "Не проверялось", fallback: "Выбран запасной переход", error: "Ошибка проверки" };
const waitDrafts = new Map();

const $ = (id) => document.getElementById(id);
const names = {
  queued: "Ожидание",
  running: "В работе",
  waiting: "Ждёт ответа",
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
  signature: "",
  listSignature: "",
  filter: "all",
  busy: false,
  controlError: null,
  cameras: new Map(),
  snapshotAt: 0,
  snapshotRequest: 0,
  runSelection: 0,
  usageScope: "run",
  taskUsage: null,
  linkedRuns: [],
  taskFetch: 0,
  taskUsageError: null,
};
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
function allActivations() {
  return (
    state.run?.graphs.flatMap((g) =>
      g.nodes.flatMap((n) =>
        n.activations.map((a) => ({ ...a, node: n, graphId: g.id })),
      ),
    ) ?? []
  );
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
  const original =
    state.run.graphs.find((g) => g.id === state.graph) ?? state.run.graphs[0];
  if (!state.scope) return original;
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
  const filter = $("search").value.toLowerCase();
  $("runs").replaceChildren();
  $("run-count").textContent = state.runs.length;
  const runs = state.runs.filter((r) =>
    `${r.name} ${r.id}`.toLowerCase().includes(filter),
  );
  for (const run of runs) {
    const item = button(
      "",
      () => selectRun(run.id),
      `run-item${run.id === state.id ? " selected" : ""}`,
    );
    item.title = run.name;
    item.append(
      el("strong", "", run.name),
      el(
        "small",
        "",
        `${run.presentation.outcomeLabel ?? run.presentation.statusLabel} · ${date(run.createdAt)}`,
      ),
      el(
        "small",
        "mini-id",
        `${run.id.slice(-8)} · ${tokenTotalLabel(run.usage)}${run.lineage?.role === "continuation" ? " · продолжение" : run.lineage?.successorRunId ? " · есть продолжение" : ""}`,
      ),
    );
    $("runs").append(item);
  }
  if (!runs.length)
    $("runs").append(
      el("p", "muted", filter ? "Ничего не найдено" : "Запусков пока нет"),
    );
}
async function selectRun(id, navigation = "push") {
  if (navigation !== "none") {
    const url = new URL(window.location.href);
    if (url.searchParams.get("run") !== id) {
      url.searchParams.set("run", id);
      window.history[navigation === "replace" ? "replaceState" : "pushState"]({}, "", url);
    }
  }
  if (state.id === id) return;
  closeCancelDialog();
  const selection = ++state.runSelection;
  const { previousTaskId } = beginRunSelection(state, id);
  $("workspace").hidden = true;
  $("empty").hidden = true;
  for (const name of ["pause", "resume", "cancel"]) $(name).disabled = true;
  renderRuns();
  await refreshSnapshot();
  if (state.id !== id || selection !== state.runSelection) return;
  reconcileTaskScopeAfterSnapshot(state, previousTaskId);
  if (state.run) {
    renderHeader();
    renderPanel();
  }
}
async function loadTaskScope(taskId) {
  const seq = ++state.taskFetch;
  const runId = state.id;
  try {
    const usage = await api(`task-usage?id=${encodeURIComponent(taskId)}&after=0`);
    if (seq !== state.taskFetch || state.id !== runId) return false;
    const task = await api(`task?id=${encodeURIComponent(taskId)}`);
    const linked = [];
    for (const member of task.members ?? []) {
      if (seq !== state.taskFetch || state.id !== runId) return false;
      linked.push(await api(`snapshot?id=${encodeURIComponent(member.runId)}`));
    }
    return applyTaskScopeFetch(state, seq, taskId, usage, linked) && state.id === runId;
  } catch (error) {
    applyTaskScopeError(state, seq, taskId, error instanceof Error ? error.message : String(error));
    return false;
  }
}
async function openActivation(activation) {
  const target = activationTarget(activation, state.id);
  if (!target.runId) return;
  if (target.runId !== state.id) await selectRun(target.runId);
  if (state.id !== target.runId || !state.run) return;
  if (target.graphId) state.graph = target.graphId;
  if (target.nodeId) state.node = target.nodeId;
  state.scope = target.scope;
  renderPanel();
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
  const r = state.run;
  $("workspace").hidden = false;
  $("empty").hidden = true;
  $("run-name").textContent = r.name;
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
  for (const b of document.querySelectorAll("[data-tab]"))
    b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
  if (state.run) renderPanel();
}
function renderPanel() {
  // Обновления соседних узлов не сворачивают данные открытого ожидания.
  for (const details of document.querySelectorAll("details[data-wait-details]")) {
    const draft = waitDrafts.get(details.dataset.waitDetails);
    if (draft) draft.detailsOpen = details.open;
  }
  const focused = document.activeElement;
  const editingWait = focused?.dataset?.waitId;
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
  renderPanel();
}
function renderInspector() {
  const focused = document.activeElement, recoveryField = focused?.dataset?.recoveryField ? focused.id : null;
  const selection = recoveryField && typeof focused.selectionStart === "number" ? [focused.selectionStart, focused.selectionEnd] : null;
  const scroll = $("inspector").scrollTop;
  const aside = $("inspector");
  aside.replaceChildren();
  const node = selectedGraph().nodes.find((n) => n.id === state.node);
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
    el("h2", "", title(node)),
    el("div", "eyebrow", node.id),
    el("p", "", names[node.status] ?? node.status),
  );
  if (node.model)
    aside.append(
      el(
        "p",
        "definition",
        `${node.model.provider} / ${node.model.id} · ${node.thinking}`,
      ),
    );
  if (node.kind === "agent")
    aside.append(
      el(
        "p",
        "definition",
        `Токены: ${node.usage.reported ? number(node.usage.totalTokens) : node.activations.length ? "нет отчёта" : "—"}${node.usage.partial ? " · неполные данные" : ""}`,
      ),
    );
  if (node.kind === "reuse") {
    aside.append(el("p", "definition", `Повторное использование: ${node.bindingId ?? "binding"}. Модель не вызывалась.`));
    for (const activation of node.activations) {
      const reused = activation.reused;
      if (!reused?.sourceRunId) continue;
      aside.append(el("p", "", `Источник: попытка ${reused.sourceAttempt} · ${reused.outputDigest ?? ""}`));
      aside.append(button(`Открыть исходный запуск ${reused.sourceRunId}`, () => selectRun(reused.sourceRunId), "child-button"));
    }
  }
  aside.append(
    el(
      "p",
      "definition",
      `Запусков: ${node.activations.length} · веток / вызовов графа: ${node.branches}`,
    ),
  );
  if (node.children.length) {
    if (node.failurePolicy === "collect") aside.append(el("p", "notice", "Сбор результатов с ошибками. Завершение этого узла означает, что результаты собраны; решения детей проверяются отдельно."));
    aside.append(el("h3", "", "ВЛОЖЕННЫЕ ГРАФЫ"));
    for (const child of node.children)
      aside.append(
        button(
          `${child.id} → ${child.graphId}`,
          () => {
            state.graph = child.graphId;
            state.scope = "";
            state.node = null;
            setTab("graph");
          },
          "child-button",
        ),
      );
  }
  const outgoing = selectedGraph().edges.filter((e) => e.from === node.id);
  if (node.retryPolicy) aside.append(el("p", "notice", `Повторы по политике: ${node.retryPolicy.codes.join(", ")} · задержка ${number(node.retryPolicy.delayMs)} мс · ${node.retryPolicy.maxAttempts === undefined ? "без лимита попыток" : `всего попыток до ${node.retryPolicy.maxAttempts}`}. Допускаются только подтверждённые not-started / read-only ошибки.`));
  if (node.retryPolicy?.provider) aside.append(el("p","muted",`Ошибки провайдера: ${node.retryPolicy.provider.statuses ? `только HTTP ${node.retryPolicy.provider.statuses.join(", ")}; без HTTP-статуса повтор не допускается` : "без фильтра HTTP-статусов"}. Retry-After: ${node.retryPolicy.provider.retryAfter === "honor" ? "учитывается как минимальная задержка" : "не изменяет задержку политики"}.`));
  if (state.transition?.context.graphId === state.graph && state.transition.decision.from === node.id && JSON.stringify(state.transition.context.scope) === state.scope) {
    aside.append(el("h3", "", "ВЫБРАННЫЙ ПЕРЕХОД"), transitionDetails(state.transition));
  }
  if (outgoing.length) {
    aside.append(el("h3", "", "ДАЛЬШЕ ПО ГРАФУ"));
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
            : "Следующий безусловный переход, если предыдущие условия не выбраны.",
        ),
      );
      aside.append(details);
    }
  }
  aside.append(el("h3", "", "ЗАПУСКИ ЭТОГО УЗЛА"));
  if (!node.activations.length)
    aside.append(
      el(
        "p",
        "muted",
        "Узел ещё не запускался. Не все ветки обязательно будут выполнены.",
      ),
    );
  for (const a of node.activations) {
    const row = el("div", "detail-run");
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
          `${number(a.usage.totalTokens)} ток. · вход без кэша ${number(a.usage.input)} · кэш ${a.usage.cacheRead === undefined ? "н/д" : number(a.usage.cacheRead)} · выход ${number(a.usage.output)}${a.usageComplete === false ? " · частично" : ""}`,
        ),
      );
    if (a.result) row.append(el("p", "", a.result));
    if (a.retry) row.append(retryView(a.retry));
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
function renderRecovery(container, activation) {
  const id = state.id, identity = JSON.stringify([id, activation.key]);
  const cached = recoveryInspections.get(identity) ?? {};
  const inspectState = async () => {
    recoveryInspections.set(identity, { ...cached, loading: true, error: null }); renderInspector();
    try {
      const suffix = `id=${encodeURIComponent(id)}&key=${encodeURIComponent(activation.key)}`;
      const [value, records] = await Promise.all([api(`recovery?${suffix}`), api(`reconciliations?${suffix}`)]);
      recoveryInspections.set(identity, { value, records });
      reconciliationRecords.set(identity, { value: records, at: Date.now() });
    } catch (error) { recoveryInspections.set(identity, { ...cached, error: error.message }); }
    if (state.id === id) renderInspector();
  };
  const inspect = button(cached.loading ? "Сканирование состояния…" : cached.value ? "Обновить инспекцию" : "Проверить состояние для восстановления", inspectState, "child-button");
  inspect.disabled = !!cached.loading; container.append(inspect);
  if (cached.error) container.append(el("p", "notice", cached.error));
  if (!cached.value) return;
  const value = cached.value, details = el("details");
  details.append(el("summary", "", `Инспекция · попытка ${value.attempt}`), el("p", "muted", `Данные на ${date(value.observedAt)}. Получение снимка не разрешает повтор или принятие результата.`));
  if (value.attempt !== activation.attempt) details.append(el("p", "notice", "Началась другая попытка. Обнови инспекцию."));
  const labels = { "run-not-stopped": "Запуск ещё не остановлен либо уже завершён.", cancelled: "Отменённый запуск нельзя восстановить.", "attempt-not-failed": "Эта попытка не завершилась ошибкой.", "structural-checkpoint": "Выбери конкретную операцию внутри этого узла.", "missing-operation": "Параметры операции не были записаны.", "completed-parent": "Результат уже использован завершённым родителем.", "collected-item": "Результат уже включён в сохранённую коллекцию.", "live-processes": "Процессы запуска ещё работают.", "unresolved-groups": "Нужна проверка оставшихся групп процессов." };
  for (const blocker of value.blockers) details.append(el("p", "notice", labels[blocker.code] ?? blocker.message));
  if (value.workspace) {
    details.append(el("p", "", `Проверено записей: ${number(value.workspace.entries)} · байтов: ${number(value.workspace.bytes)}`), el("pre", "", value.workspace.roots.join("\n")),
      el("p", "muted", "Проверены выбранные рабочие папки и данные Git. Содержимое целей вложенных ссылок и внешние действия требуют отдельных доказательств."));
  } else details.append(el("p", "muted", "Файлы не сканировались: сначала нужно устранить препятствия выше."));
  const raw = el("details"); raw.append(el("summary", "", "Checkpoint, файлы и контракт результата"), el("pre", "", JSON.stringify(value, null, 2)));
  details.append(raw); container.append(details);
  if (value.workspace && !value.blockers.length && value.attempt === activation.attempt) renderRecoveryForm(container, activation, cached, inspectState);
}
function renderRecoveryForm(container, activation, inspection, inspectState) {
  const id = state.id, identity = JSON.stringify([id, activation.key, activation.attempt]), snapshot = inspection.value;
  let draft = recoveryDrafts.get(identity);
  if (!draft) { draft = { action: "", actor: "", reason: "", evidence: "", output: "", replace: false, request: null, receipt: null, busy: false, error: null }; recoveryDrafts.set(identity, draft); }
  const card = el("section", "recovery-form"), pending = (inspection.records ?? []).find(record => record.request.action === "retry" && !record.application && !record.supersededBy);
  card.append(el("h4", "", "Решение о восстановлении"));
  if (draft.receipt) {
    card.append(el("p", "notice", "Решение сохранено. После разрешения остальных ошибок запуск можно продолжить отдельной кнопкой «Продолжить»."),
      button("Подготовить другое решение", async () => { draft.request = null; draft.receipt = null; draft.replace = false; await inspectState(); }, "child-button"));
    container.append(card); return;
  }
  const frozen = !!draft.request || draft.busy;
  const field = (name, label, tag = "textarea") => {
    const wrapper = el("label", "", label), input = el(tag);
    input.id = `recovery-${encodeURIComponent(identity)}-${name}`; input.dataset.recoveryField = "1"; input.setAttribute("aria-label", label);
    input.value = draft[name]; input.disabled = frozen; if (tag === "textarea") input.rows = name === "output" ? 6 : 3;
    input.addEventListener("input", () => { draft[name] = input.value; }); wrapper.append(input); card.append(wrapper); return input;
  };
  const action = field("action", "Действие", "select");
  for (const [value, label] of [["", "Выбери действие"], ["accept", "Принять готовый результат"], ["retry", "Разрешить один повтор"]]) {
    const option = el("option", "", label); option.value = value; action.append(option);
  }
  action.value = draft.action; action.addEventListener("change", () => { draft.action = action.value; renderInspector(); });
  field("actor", "Автор решения", "input"); field("reason", "Причина решения"); field("evidence", "Что проверено: файлы, проверки и внешние действия");
  if (draft.action === "accept") field("output", "Принятый результат (JSON)");
  if (pending) {
    card.append(el("p", "notice", `Есть разрешение повтора от ${pending.request.actor}: ${pending.request.reason}`));
    const label = el("label", ""), replace = el("input"); replace.type = "checkbox"; replace.checked = draft.replace; replace.disabled = frozen;
    replace.id = `recovery-${encodeURIComponent(identity)}-replace`; replace.dataset.recoveryField = "1";
    replace.addEventListener("change", () => { draft.replace = replace.checked; }); label.append(replace, document.createTextNode(" Заменить прежнее неприменённое решение")); card.append(label);
  }
  card.append(el("p", "muted", draft.action === "retry" ? "Разрешение действует на одну следующую попытку. Перед допуском файлы проверяются заново." : "Результат должен соответствовать контракту узла. Его принятие сохраняет исходную ошибку и расход в истории."));
  card.append(el("p", "muted", "Сохранение решения не запускает работу и не снимает паузу."));
  const submit = button(draft.busy ? "Сохраняем решение…" : draft.request ? "Повторить отправку того же решения" : "Сохранить решение", async () => {
    if (draft.busy) return;
    const selection = state.runSelection;
    draft.error = null;
    try {
      if (!draft.request) {
        if (!["accept", "retry"].includes(draft.action) || !draft.actor.trim() || !draft.reason.trim() || !draft.evidence.trim()) throw new Error("Выбери действие и заполни автора, причину и проверенные основания.");
        if (pending && !draft.replace) throw new Error("Для замены прежнего разрешения отметь соответствующий пункт.");
        const output = draft.action === "accept" ? JSON.parse(draft.output) : undefined;
        draft.request = { id, key: activation.key, attempt: snapshot.attempt, checkpoint: snapshot.checkpoint, workspaceDigest: snapshot.workspace.digest,
          decisionId: crypto.randomUUID(), action: draft.action, actor: draft.actor.trim(), reason: draft.reason.trim(), evidence: [{ description: draft.evidence.trim() }],
          ...(draft.action === "accept" ? { output } : {}), ...(pending ? { supersedes: pending.request.decisionId } : {}) };
      }
      draft.busy = true; renderInspector();
      draft.receipt = await api("reconcile", { method: "POST", headers: { "Content-Type": "application/json", "X-Dynamicwf-View": "1" }, body: JSON.stringify(draft.request) });
      const records = [...(inspection.records ?? []).filter(record => record.request.decisionId !== draft.receipt.request.decisionId).map(record => record.request.decisionId === draft.receipt.request.supersedes ? { ...record, supersededBy: draft.receipt.request.decisionId } : record), draft.receipt];
      recoveryInspections.set(JSON.stringify([id, activation.key]), { ...inspection, records });
      reconciliationRecords.set(JSON.stringify([id, activation.key]), { value: records, at: Date.now(), saved: true });
      if (state.id === id && state.runSelection === selection) { notice("Решение о восстановлении сохранено. Запуск продолжится по отдельной команде."); await refreshSnapshot(); }
    } catch (error) { draft.error = error.message; }
    finally { draft.busy = false; if (state.id === id) renderInspector(); }
  }, "child-button");
  submit.id = `recovery-${encodeURIComponent(identity)}-submit`; submit.dataset.recoveryField = "1";
  submit.disabled = draft.busy || !!inspection.loading; card.append(submit);
  if (draft.error) { const error = el("p", "notice", draft.error); error.setAttribute("role", "alert"); card.append(error); }
  if (draft.request && !draft.busy) card.append(el("p", "muted", `ID решения: ${draft.request.decisionId}. Повторная отправка использует те же данные.`),
    button("Проверить состояние и изменить решение", async () => { draft.request = null; draft.error = null; draft.replace = false; await inspectState(); }, "child-button"));
  container.append(card);
}
function failureView(failure, runScope = false) {
  const labels = { configuration:"Настройки",resource:"Ресурсы",provider:"Ответ провайдера",output:"Формат результата",process:"Процесс",protocol:"Обмен с worker",cancelled:"Прерывание",interrupted:"Потерян процесс","expression":"Выражение графа","uncertain-effect":"Нужна сверка действий",unknown:"Причина не уточнена" };
  const phases = { setup:"подготовка",execution:"исполнение",output:"приём результата",routing:"выбор перехода",recovery:"восстановление",cleanup:"завершение процессов" };
  const effects = { "not-started":"Исполнение задачи не началось.","read-only":"Операция выполнялась только с доступом на чтение.",unknown:"Результат внешних действий не подтверждён. Перед повтором нужна сверка." };
  const panel=el("div","failure-detail");
  panel.append(el("strong","",`${labels[failure.code] ?? labels.unknown} · ${phases[failure.phase] ?? "этап неизвестен"}`),el("p","",failure.message),el("p","muted",runScope ? "Это причина остановки. Состояние действий показано в деталях отдельных узлов." : effects[failure.effects] ?? effects.unknown));
  if (failure.providerResponse) panel.append(el("p","",`HTTP-ответ: ${failure.providerResponse.status}${failure.providerResponse.retryAfterMs===undefined?"":` · Retry-After: ${number(failure.providerResponse.retryAfterMs)} мс`}`));
  if (failure.diagnostic) {
    const dispatch = { "not-dispatched": "запрос не отправлялся", "fetch-attempted": "транспорт вызван, получение не подтверждено", "http-observed": "получен HTTP-ответ", unknown: "отправка не установлена" };
    panel.append(el("p","muted", `${failure.diagnostic.subcode ? `Код: ${failure.diagnostic.subcode}. ` : ""}Отправка: ${dispatch[failure.diagnostic.dispatch] ?? dispatch.unknown}${failure.diagnostic.sentReasoning ? ` · reasoning: ${failure.diagnostic.sentReasoning}` : failure.diagnostic.dispatch === "not-dispatched" ? " · reasoning неизвестен" : ""}`));
  }
  return panel;
}
function retryView(progress) {
  const labels = {scheduled:"запланирована",admitted:"допущена",abandoned:"снята без допуска"};
  const panel = el("div","notice"), when = progress.dueAt !== null && Number.isFinite(new Date(progress.dueAt).getTime()) ? date(progress.dueAt) : `задержка ${number(progress.delayMs)} мс`;
  panel.append(el("strong","",`Попытка ${progress.nextAttempt}: ${labels[progress.status] ?? progress.status}`),el("p","muted",`После ошибки попытки ${progress.attempt} · не раньше ${when}`));
  panel.append(el("p","muted",`Назначенная задержка: ${number(progress.delayMs)} мс.`));
  if (progress.status === "scheduled") panel.append(el("p","muted","Новая попытка ещё не началась. Для допуска запуск должен работать и срок задержки должен истечь."));
  return panel;
}
function renderRetries(container,activation) {
  const id=state.id,identity=JSON.stringify([id,activation.key]),page=retryPages.get(identity);
  const load=button(page.loading?"Загружаем решения…":!page.opened?"Решения о повторах":page.hasMore?"Ещё решения о повторах":"Обновить решения о повторах",async()=>{
    const pending=retryPages.load(identity,async(_key,cursor)=>{
      const response=await api(`retries?id=${encodeURIComponent(id)}&key=${encodeURIComponent(activation.key)}&after=${cursor}`);
      return {reports:response.records,nextAfter:response.nextAfter,hasMore:response.hasMore};
    });renderInspector();await pending;if(state.id===id)renderInspector();
  },"child-button");load.disabled=page.loading;container.append(load);
  if(page.error)container.append(el("p","notice",page.error));
  for(const record of page.reports){const details=el("details");details.append(el("summary","",`Решение: попытка ${record.attempt} → ${record.nextAttempt} · ${date(record.at)}`));for(const cause of record.causes??[record.failure])details.append(failureView(cause));details.append(el("p","muted",`Задержка ${number(record.delayMs)} мс. Фактический допуск и состояние — в истории попыток.`));container.append(details);}
}
function renderCollection(container, activation) {
  if (activation.collectionSummary) container.append(el("p", "notice", `Собрано результатов: ${activation.collectionSummary.total} · успешно ${activation.collectionSummary.succeeded} · ошибок ${activation.collectionSummary.failed}`));
  const id = state.id, identity = JSON.stringify([id, activation.key]), page = collectionPages.get(identity);
  const load = button(page.loading ? "Загружаем результаты…" : !page.opened ? "Результаты веток" : page.hasMore ? "Ещё результаты веток" : "Обновить результаты веток", async () => {
    const pending = collectionPages.loadCollection(identity, (_identity, cursor) => api(`collections?id=${encodeURIComponent(id)}&key=${encodeURIComponent(activation.key)}&after=${cursor}`));
    renderInspector(); await pending; if (state.id === id) renderInspector();
  }, "child-button");
  load.disabled = page.loading; container.append(load);
  if (page.error) container.append(el("p", "notice", page.error));
  const summary = collectionPages.summaries.get(identity);
  if (summary) container.append(el("p", "muted", `На момент запроса: собрано ${summary.total} · успешно ${summary.succeeded} · ошибок ${summary.failed}`));
  for (const record of page.reports) {
    const details = el("details");
    details.append(el("summary", "", `${record.itemId} · ${record.result.status === "succeeded" ? "результат получен" : "ошибка ветки"} · попытка родителя ${record.attempt}`));
    if (record.result.status === "failed") details.append(failureView(record.result.failure));
    else details.append(el("pre", "", JSON.stringify(record.result.value, null, 2)));
    container.append(details);
  }
}
function outputRepairView(progress, status) {
  const labels = { running: status === "running" ? "выполняется" : "завершение не подтверждено", succeeded: "формат принят", invalid: "результат не прошёл проверку", failed: "прерван ошибкой или отменой" };
  const panel = el("div", "notice");
  panel.append(el("strong", "", `Исправление формата · раунд ${progress.round}: ${labels[progress.status] ?? progress.status}`));
  panel.append(el("p", "muted", "Та же сессия; в раунде доступен только submit_result. Принятый формат не подтверждает качество результата."));
  panel.append(el("p", "muted", progress.status === "running" ? "Итоговые границы расхода раунда не подтверждены. Уже полученные отчёты включены в сумму узла." : progress.throughReport > progress.afterReport ? `Отчёты SDK этого раунда: ${progress.afterReport + 1}–${progress.throughReport}. Расход включён в сумму узла.` : "В завершённых отчётах SDK этого раунда расход не зафиксирован."));
  return panel;
}
function renderAttempts(container, activation) {
  renderReconciliations(container, activation);
  const id=state.id, identity=JSON.stringify([id,activation.key]), page=attemptPages.get(identity);
  const load=button(page.loading ? "Загружаем попытки…" : !page.opened ? `Попытки: ${activation.attempt}` : page.hasMore ? "Ещё попытки" : "Обновить попытки", async()=>{
    const work=attemptPages.loadAttempts(identity,(_identity,cursor)=>api(`attempts?id=${encodeURIComponent(id)}&key=${encodeURIComponent(activation.key)}&after=${cursor}`));
    renderInspector(); await work; if(state.id===id)renderInspector();
  },"child-button");
  load.disabled=page.loading;container.append(load);
  if(page.error)container.append(el("p","notice",page.error));
  const snapshot=attemptPages.snapshots.get(identity);
  if(!snapshot)return;
  if(snapshot.missingArchived)container.append(el("p","notice",`Не сохранено прежних попыток: ${snapshot.missingArchived}. Старый журнал не содержит их полных записей.`));
  container.append(el("p","muted","Попытки на момент запроса. Расход ниже относится к каждой попытке отдельно."));
  for(const record of [...page.reports,snapshot.current]) {
    const card=el("section","attempt-card");
    card.append(el("strong","",`Попытка ${record.attempt}${record.attempt===snapshot.current.attempt ? " · последняя" : ""}`),badge(record.status));
    card.append(el("p","muted",`${date(record.startedAt)} · ${record.finishedAt===null ? "не завершена на момент запроса" : duration(record.finishedAt-record.startedAt)}`));
    if(record.metadata.reconciliation?.action === "accept") card.append(el("p","notice","Результат принят при восстановлении. Нового вызова модели или команды не было; прежний расход сохранён в исходной попытке."));
    else if(record.kind==="agent")card.append(el("p","",record.accounting.usage ? `${number(record.accounting.usage.totalTokens)} ток. · ответов ${record.accounting.responses}${record.accounting.complete ? "" : " · частично"}` : "Расход этой попытки неизвестен: нет отчётов SDK."));
    if(record.metadata.outputRepair)card.append(outputRepairView(record.metadata.outputRepair,record.status));
    if(record.metadata.retry)card.append(retryView(record.metadata.retry));
    if(record.metadata.failureCauses)for(const cause of record.metadata.failureCauses)card.append(failureView(cause));
    else if(record.metadata.failure)card.append(failureView(record.metadata.failure));
    else if(record.error)card.append(el("pre","",record.error));
    if(Object.hasOwn(record,"output"))card.append(el("pre","",JSON.stringify(record.output,null,2)));
    if(record.metadata.operation)card.append(operationView(record.metadata.operation));
    if(Object.keys(record.metadata).length){const details=el("details");details.append(el("summary","","Данные попытки"),el("pre","",JSON.stringify(record.metadata,null,2)));card.append(details);}
    container.append(card);
  }
}
function renderReconciliations(container, activation) {
  const id = state.id, identity = JSON.stringify([id, activation.key]), cached = reconciliationRecords.get(identity) ?? {};
  const load = button(cached.loading ? "Загружаем решения…" : cached.value ? "Обновить решения о восстановлении" : "Решения о восстановлении", async () => {
    reconciliationRecords.set(identity, { ...cached, loading: true, error: null }); renderInspector();
    try { reconciliationRecords.set(identity, { value: await api(`reconciliations?id=${encodeURIComponent(id)}&key=${encodeURIComponent(activation.key)}`), at: Date.now() }); }
    catch (error) { reconciliationRecords.set(identity, { ...cached, error: error.message }); }
    if (state.id === id) renderInspector();
  }, "child-button");
  load.disabled = !!cached.loading; container.append(load);
  if (cached.error) container.append(el("p", "notice", cached.error));
  if (!cached.value) return;
  if (cached.saved) container.append(el("p", "notice", ["interrupted", "paused"].includes(state.run.status) ? "Решение сохранено. После разрешения остальных ошибок нажми «Продолжить»." : "Решение сохранено в истории восстановления."));
  container.append(el("p", "muted", `Решения на ${date(cached.at)}. ${cached.value.length ? "" : "Сохранённых решений нет."}`));
  for (const record of cached.value) {
    const r = record.request, panel = el("details"), status = record.supersededBy ? "заменено" : record.application ? `применено к попытке ${record.application.attempt}` : "ожидает допуска";
    panel.append(el("summary", "", `${r.action === "accept" ? "Приём результата" : "Разрешение повтора"} · ${status}`),
      el("p", "", `${r.actor} · ${date(record.createdAt)} · исходная попытка ${r.attempt}`), el("p", "", r.reason),
      el("p", "muted", "Основания заявил автор решения. Они не являются автоматическим подтверждением всех внешних действий."),
      el("pre", "", JSON.stringify(record, null, 2)));
    container.append(panel);
  }
}
function operationView(operation) {
  const details=el("details");details.append(el("summary","","Операция этой попытки"),el("p","muted","Записанные параметры и этапы операции. Они не подтверждают завершение внешних действий."));
  const field=(label,value)=>{if(value!==undefined)details.append(el("strong","",label),el("pre","",typeof value==="string"?value:JSON.stringify(value,null,2)));};
  field("Рабочая папка",operation.cwd??operation.source??operation.target);
  if(operation.kind==="agent") {
    field("Каталог сессий из запроса",operation.sessionDirectory);field("Каталог ресурсов из запроса",operation.resourceDirectory);field("Продолжение сессии",operation.continuedSessionFile);
    const input=el("details");input.append(el("summary","","Задание и вход агента"),el("pre","",operation.task),el("pre","",JSON.stringify(operation.input,null,2)));details.append(input);
  } else if(operation.kind==="check") {field("Команда",operation.command);field("Аргументы",operation.args);}
  else if(operation.kind==="worktree") {field("Базовая ревизия из запроса",operation.base);field("Дочерняя область",operation.childScope);if(Object.hasOwn(operation,"childResult"))field("Результат детей перед commit",operation.childResult);}
  else if(operation.kind==="integrate") {
    field("Источники интеграции",operation.sources);
    if(operation.progress){const progress=operation.progress;field("Последний записанный этап",{ready:"До начала слияний",merging:"Перед запуском merge",between:"После одного из слияний",complete:"После всех слияний"}[progress.phase]??progress.phase);field("Целевая ветка",progress.branch);field("Исходный HEAD",progress.originalHead);field("Записанные завершённые слияния",progress.merged);field("Допущенный merge",progress.current);field("Прочитанный итоговый HEAD",progress.head);}
  }
  return details;
}
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
  return `${state.id}/${state.graph}`;
}
function applyCamera() {
  if (camera)
    $("graph").setAttribute(
      "viewBox",
      `${camera.x} ${camera.y} ${camera.width} ${camera.height}`,
    );
}
function fit() {
  if (!layout) return;
  const box = $("graph").getBoundingClientRect(),
    ratio = (box.width || 600) / (box.height || 500);
  const width = Math.max(layout.width, layout.height * ratio),
    height = width / ratio;
  camera = {
    x: (layout.width - width) / 2,
    y: (layout.height - height) / 2,
    width,
    height,
  };
  state.cameras.set(cameraKey(), camera);
  applyCamera();
}
function zoom(factor) {
  if (!camera) return;
  const width = Math.min(30000, Math.max(250, camera.width * factor));
  const height = (width / camera.width) * camera.height;
  camera = {
    x: camera.x + (camera.width - width) / 2,
    y: camera.y + (camera.height - height) / 2,
    width,
    height,
  };
  state.cameras.set(cameraKey(), camera);
  applyCamera();
}
function renderGraph() {
  const graph = selectedGraph();
  state.graph = graph.id;
  const select = $("graph-select");
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
      class: `edge${edge.loop ? " loop" : ""}${traversalCount ? " traversed" : ""}${state.transition?.context.graphId === state.graph && JSON.stringify(state.transition.context.scope) === state.scope && state.transition.decision.edgeIndex === edge.index ? " trace-selected" : ""}`,
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
        "aria-label": `${title(node)}: ${node.id}, ${names[node.status] ?? node.status}`,
      });
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
    g.addEventListener("click", () => selectNode(graph.id, node.id));
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectNode(graph.id, node.id);
      }
    });
    svg.append(g);
  }
  camera = state.cameras.get(cameraKey());
  if (!camera) {
    const box = svg.getBoundingClientRect();
    const width = (box.width || 700) / 0.9,
      height = (box.height || 500) / 0.9;
    const active = graph.nodes.find((n) => n.status === "running");
    const pos = active ? layout.positions.get(active.id) : null;
    camera = {
      x: (layout.width - width) / 2,
      y: pos ? Math.max(0, pos.y - height / 3) : 0,
      width,
      height,
    };
    state.cameras.set(cameraKey(), camera);
  }
  applyCamera();
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
    if (wait.status !== "open") continue;
    let draft = waitDrafts.get(wait.id);
    if (!draft) { draft = { text: "", busy: false, error: null }; waitDrafts.set(wait.id, draft); }
    const card = el("section", "wait-card"), selectedRun = state.id;
    card.append(el("h3", "", wait.reason));
    const activation = byKey.get(wait.key);
    card.append(el("p", "muted", activation?.path ?? `Активация: ${wait.key}`), el("p", "muted", `Ожидание: ${wait.id}`));
    const details = el("details");
    details.dataset.waitDetails = wait.id; details.open = draft.detailsOpen ?? false;
    details.append(el("summary", "", "Данные и формат ответа"), el("pre", "", JSON.stringify({ runId: selectedRun, waitId: wait.id, input: wait.input, responseSchema: wait.responseSchema }, null, 2)));
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
        await api("resolve", { method: "POST", headers: { "Content-Type": "application/json", "X-Dynamicwf-View": "1" }, body: JSON.stringify({ id: selectedRun, waitId: wait.id, response }) }, current);
        if (current()) await refreshSnapshot();
      } catch (error) { draft.error = error.message; }
      finally { draft.busy = false; if (state.id === selectedRun && state.tab === "now") renderPanel(); }
    }, "child-button");
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
    const row=taskRow(a);if(a.retry)row.append(retryView(a.retry));panel.append(row);
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
  const panel = $("content-panel");
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
    state.filter = filter.value;
    renderHistory();
  });
  heading.append(filter);
  panel.append(
    heading,
    el(
      "p",
      "muted",
      "Новые результаты сверху. Проход — повтор узла, попытка — восстановление того же прохода.",
    ),
  );
  const records = allActivations()
    .filter((a) => a.status !== "running" && (!structural.has(a.node.kind) || a.collectionSummary))
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
    .filter(
      (a) =>
        state.filter === "all" ||
        (state.filter === "agent" && a.node.kind === "agent") ||
        (state.filter === "issues" &&
          (a.error ||
            Number(a.collectionSummary?.failed) > 0 ||
            /request_changes|inconclusive|exit [1-9]|не принят/.test(
              a.result ?? "",
            ))),
    );
  for (const a of records) panel.append(taskRow(a));
  if (!records.length)
    panel.append(el("p", "muted", "Таких результатов пока нет."));
}
function transitionDetails(record) {
  const block = el("div", "transition-details"), decision = record.decision;
  block.append(el("p", "", decision.error ?? (decision.reason === "condition" ? "Выбрано первое выполненное условие." : "Условия не выбрали путь; использован запасной переход.")));
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
  const panel = $("content-panel"), id = state.id, summary = state.run.trace, page = tracePages.get(id);
  panel.replaceChildren(sectionHeading("Фактические переходы"));
  if (!summary.supported) {
    panel.append(el("p", "muted", "Этот план создан до записи трассы. Исторические переходы неизвестны; цвет узлов их не доказывает.")); return;
  }
  panel.append(el("p", "muted", `Записано решений: ${summary.count} · ошибок маршрутизации: ${summary.failed}. Выбор ребра не означает, что следующий узел уже запущен.`));
  const load = async () => {
    const request = tracePages.load(id, async (runId, cursor) => {
      const data = await api(`trace?id=${encodeURIComponent(runId)}&after=${cursor}`);
      return { ...data, reports: data.records };
    });
    if (state.id === id && state.tab === "trace") renderTrace();
    await request;
    if (state.id === id && state.tab === "trace") renderTrace();
  };
  if (!page.loading && !page.error && (!page.opened || !page.hasMore && summary.lastSeq > page.cursor)) { void load(); return; }
  if (page.loading) panel.append(el("p", "muted", "Загружаем переходы…"));
  if (page.error) panel.append(el("p", "notice", page.error));
  for (const record of page.reports) {
    const card = el("section", `trace-card${record.decision.error ? " routing-error" : ""}`);
    card.append(el("h3", "", `${record.decision.from} → ${record.decision.to ?? "ошибка маршрутизации"}`),
      el("p", "muted", `${record.context.graphId} · проход ${record.context.visit + 1} · попытка ${record.attempt} · ${date(record.at)}`),
      el("div", "path", JSON.stringify(record.context.scope)), transitionDetails(record),
      button("Показать источник на графе", () => {
        state.graph = record.context.graphId; state.scope = JSON.stringify(record.context.scope); state.node = record.decision.from; state.transition = record;
        setTab("graph");
        const pos = layout.positions.get(record.decision.from);
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
    const selectedRun = state.id;
    const toggle = el("div", "usage-scope");
    toggle.append(
      button("Этот запуск", () => { state.usageScope = "run"; renderTokens(); }, state.usageScope === "run" ? "child-button selected" : "child-button"),
      button("Вся задача", async () => {
        state.usageScope = "task";
        const id = state.run.lineage?.taskId;
        if (id) await loadTaskScope(id);
        if (state.id === selectedRun && state.tab === "tokens") renderTokens();
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
    row.append(el("strong", "", `${activation?.path ?? "Агент"}${report.runId ? ` · ${report.runId.slice(-8)}` : ""} · попытка ${report.attempt} · ответ ${report.reportId}`),
      el("p", "", `${number(report.usage.totalTokens)} ток. · вход ${number(report.usage.input)} · кэш ${report.usage.cacheRead === undefined ? "н/д" : number(report.usage.cacheRead)} · выход ${number(report.usage.output)} · ${report.stopReason} · pi SDK${report.observedEffort ? ` · reasoning ${report.observedEffort}` : ""}`));
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
    if (state.id === selectedRun && state.tab === "tokens" && (!taskMode || (state.usageScope === "task" && state.run?.lineage?.taskId === taskUsage.taskId))) renderTokens();
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
    state.graph ??= run.entryGraph;
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
        if (applied && state.id === id && state.usageScope === "task" && state.run?.lineage?.taskId === taskId && state.tab === "tokens") renderTokens();
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
  try {
    const data = await api("runs", undefined, isCurrent);
    if (!isCurrent()) return;
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
    if (!isCurrent()) return;
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
  state.transition = null;
  state.graph = $("graph-select").value;
  state.scope = "";
  state.node = null;
  renderPanel();
});
$("scope-select").addEventListener("change", () => {
  state.transition = null;
  state.scope = $("scope-select").value;
  renderPanel();
});
$("fit").addEventListener("click", fit);
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
new ResizeObserver(() => {
  if (state.tab === "graph" && camera) {
    const box = $("graph").getBoundingClientRect();
    if (box.width && box.height) {
      camera.height = (camera.width * box.height) / box.width;
      applyCamera();
    }
  }
}).observe($("graph"));
window.addEventListener("popstate", () => {
  const id = new URL(window.location.href).searchParams.get("run");
  if (id) void selectRun(id, "none");
  else {
    closeCancelDialog();
    beginRunSelection(state, null);
    void refreshRuns();
  }
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
