import { layoutGraph } from "./layout.js";
import { UsagePages, TracePages } from "./usage-pages.js";

const usagePages = new UsagePages();
const tracePages = new TracePages();
const routingLabels = { true: "Условие выполнено", false: "Условие не выполнено", "not-evaluated": "Не проверялось", fallback: "Выбран запасной переход", error: "Ошибка проверки" };
const waitDrafts = new Map();

const $ = (id) => document.getElementById(id);
const names = {
  queued: "Ожидание",
  running: "В работе",
  waiting: "Ждёт ответа",
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
      /request_changes|rejected|inconclusive|exit [1-9]|не принят/.test(a.result ?? ""),
    );
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
async function api(path, options) {
  const response = await fetch(path, { cache: "no-store", ...options });
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
        `${run.id.slice(-8)} · ${number(run.usage.totalTokens)} ток.`,
      ),
    );
    $("runs").append(item);
  }
  if (!runs.length)
    $("runs").append(
      el("p", "muted", filter ? "Ничего не найдено" : "Запусков пока нет"),
    );
}
async function selectRun(id) {
  if (state.id === id) return;
  state.id = id;
  state.run = null;
  state.graph = null;
  state.scope = "";
  state.node = null;
  state.signature = "";
  state.filter = "all";
  state.controlError = null;
  for (const name of ["pause", "resume", "cancel"]) $(name).disabled = true;
  renderRuns();
  await refreshSnapshot();
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
  $("resume").hidden = !["paused", "pausing", "interrupted"].includes(r.status);
  $("cancel").hidden = finished.has(r.status);
  for (const id of ["pause", "resume", "cancel"]) $(id).disabled = state.busy;
  if (r.error) notice(r.error);
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
  const waits = (r.waits ?? []).filter(w => w.status === "open");
  const summary = $("wait-summary");
  summary.hidden = !waits.length || finished.has(r.status);
  summary.replaceChildren();
  if (!summary.hidden) summary.append(el("strong", "", `Ожидают ответа: ${waits.length}`), el("p", "", waits.map(w => w.reason).join(" · ")),
    button("Открыть ожидания", () => setTab("now"), "child-button"));
  renderMetrics();
}
function setTab(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll("[data-tab]"))
    b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
  if (state.run) renderPanel();
}
function renderPanel() {
  const focused = document.activeElement;
  const editingWait = focused?.dataset?.waitId;
  const selection = editingWait ? [focused.selectionStart, focused.selectionEnd] : null;
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
    if (field) { field.focus({ preventScroll: true }); field.setSelectionRange(...selection); }
  }
}
function selectNode(graphId, id) {
  state.transition = null;
  state.graph = graphId;
  state.node = id;
  renderPanel();
}
function renderInspector() {
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
  aside.append(
    el(
      "p",
      "definition",
      `Запусков: ${node.activations.length} · веток / вызовов графа: ${node.branches}`,
    ),
  );
  if (node.children.length) {
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
  if (state.transition?.context.graphId === state.graph && state.transition.decision.from === node.id) {
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
    if (a.error) row.append(el("p", "", a.error));
    if (a.findings.length) {
      const details = el("details");
      details.append(el("summary", "", `Замечания: ${a.findings.length}`));
      for (const finding of a.findings) details.append(el("pre", "", finding));
      row.append(details);
    }
    aside.append(row);
  }
  aside.scrollTop = scroll;
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
      g = svgEl("g", {
        class: `graph-node ${node.status}${attention(node) ? " attention" : ""}${node.id === state.node ? " selected" : ""}`,
        transform: `translate(${pos.x} ${pos.y})`,
        tabindex: 0,
        role: "button",
        "aria-label": `${title(node)}: ${node.id}, ${names[node.status] ?? node.status}`,
      });
    g.append(
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
        attention(node)
          ? "Есть замечания"
          : node.activations.length > 1
            ? `Запусков: ${node.activations.length} · веток: ${node.branches}`
            : (names[node.status] ?? node.status),
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
      state.graph = a.graphId;
      state.scope = "";
      state.node = a.node.id;
      renderInspector();
    }),
    el("div", "muted", a.path),
  );
  if (a.result) body.append(el("div", "muted result-preview", a.result));
  if (a.error) body.append(el("div", "muted", a.error));
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
function renderNow() {
  const panel = $("content-panel");
  panel.replaceChildren(sectionHeading("Текущая работа"));
  if (!finished.has(state.run.status)) for (const wait of state.run.waits ?? []) {
    if (wait.status !== "open") continue;
    let draft = waitDrafts.get(wait.id);
    if (!draft) { draft = { text: "", busy: false, error: null }; waitDrafts.set(wait.id, draft); }
    const card = el("section", "wait-card"), selectedRun = state.id;
    card.append(el("h3", "", wait.reason));
    const details = el("details");
    details.append(el("summary", "", "Данные и формат ответа"), el("pre", "", JSON.stringify({ input: wait.input, responseSchema: wait.responseSchema }, null, 2)));
    const field = el("textarea");
    field.id = `wait-response-${wait.id}`; field.dataset.waitId = wait.id;
    field.setAttribute("aria-label", `Ответ: ${wait.reason}`);
    field.placeholder = "Ответ в формате JSON"; field.value = draft.text; field.rows = 5;
    field.addEventListener("input", () => { draft.text = field.value; });
    const submit = button(draft.busy ? "Сохраняем…" : "Сохранить ответ", async () => {
      if (draft.busy) return;
      draft.busy = true; draft.error = null; submit.disabled = true;
      try {
        const response = JSON.parse(draft.text);
        await api("resolve", { method: "POST", headers: { "Content-Type": "application/json", "X-Dynamicwf-View": "1" }, body: JSON.stringify({ id: selectedRun, waitId: wait.id, response }) });
        await refreshSnapshot();
      } catch (error) { draft.error = error.message; }
      finally { draft.busy = false; if (state.id === selectedRun && state.tab === "now") renderPanel(); }
    }, "child-button");
    submit.disabled = draft.busy;
    card.append(details, field, submit);
    if (draft.error) { const error = el("p", "notice", draft.error); error.setAttribute("role", "alert"); card.append(error); }
    if (state.run.desired === "paused") card.append(el("p", "muted", "Ответ сохранится. Работа продолжится после снятия паузы."));
    panel.append(card);
  }
  const active = allActivations().filter((a) =>
    state.run.activeKeys.includes(a.key),
  );
  if (!active.length)
    panel.append(
      el(
        "p",
        "muted",
        finished.has(state.run.status)
          ? "Запуск завершён. Все результаты доступны в истории."
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
    .filter((a) => a.status !== "running" && !structural.has(a.node.kind))
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
    .filter(
      (a) =>
        state.filter === "all" ||
        (state.filter === "agent" && a.node.kind === "agent") ||
        (state.filter === "issues" &&
          (a.error ||
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
  const panel = $("content-panel"),
    u = state.run.usage;
  panel.replaceChildren(sectionHeading("Расход токенов"));
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
  const page = usagePages.get(selectedRun);
  for (const report of page.reports) {
    const activation = allActivations().find(a => a.key === report.key);
    const row = el("div", "detail-run");
    row.append(el("strong", "", `${activation?.path ?? "Агент"} · попытка ${report.attempt} · ответ ${report.reportId}`),
      el("p", "", `${number(report.usage.totalTokens)} ток. · вход ${number(report.usage.input)} · кэш ${report.usage.cacheRead === undefined ? "н/д" : number(report.usage.cacheRead)} · выход ${number(report.usage.output)} · ${report.stopReason} · pi SDK`));
    ledger.append(row);
  }
  if (page.opened && !page.reports.length) ledger.append(el("p", "muted", "Поответных отчётов пока нет. Старые запуски сохраняли только итог worker."));
  if (page.error) ledger.append(el("p", "explanation", page.error));
  const load = button(page.loading ? "Загрузка…" : !page.opened ? "Показать исходные отчёты ответов" : page.hasMore ? "Следующие отчёты" : "Проверить новые отчёты", async () => {
    const pending = usagePages.load(selectedRun, (id, cursor) => api(`usage?id=${encodeURIComponent(id)}&after=${cursor}`));
    load.disabled = true;
    load.textContent = "Загрузка…";
    await pending;
    if (state.id === selectedRun && state.tab === "tokens") renderTokens();
  }, "child-button");
  load.disabled = page.loading;
  panel.append(load, ledger);
  const groups = new Map();
  const agents = allActivations().filter((a) => a.node.kind === "agent");
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
  try {
    const run = await api(`snapshot?id=${encodeURIComponent(id)}`);
    if (id !== state.id) return;
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
    notice(state.controlError ?? run.error);
    $("connection").textContent = "● Данные обновляются";
  } catch (error) {
    if (id === state.id) {
      notice(error.message);
      $("connection").textContent = "Нет связи · повторяем подключение";
    }
  }
}
async function refreshRuns() {
  try {
    const data = await api("runs");
    state.runs = data.runs;
    const signature = JSON.stringify({ ...data, runs: data.runs.map(run => ({ ...run,
      presentation: { ...run.presentation, liveness: { ...run.presentation.liveness, observedAt: null } },
    })) });
    if (signature !== state.listSignature) {
      state.listSignature = signature;
      renderRuns();
    }
    if (!state.id && data.runs.length)
      await selectRun(
        data.initialRun ??
          data.runs.find((r) => !finished.has(r.status))?.id ??
          data.runs[0].id,
      );
    if (!data.runs.length) {
      $("empty").hidden = false;
      $("connection").textContent = "● Подключено";
    }
  } catch (error) {
    notice(error.message);
    $("connection").textContent = "Нет связи";
  }
}
async function control(command) {
  if (state.busy || !state.run) return;
  state.busy = true;
  state.controlError = null;
  renderHeader();
  try {
    await api("control", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Dynamicwf-View": "1" },
      body: JSON.stringify({ id: state.id, command }),
    });
    notice(null);
    await refreshSnapshot();
    await refreshRuns();
  } catch (error) {
    state.controlError = error.message;
    notice(error.message);
  } finally {
    state.busy = false;
    if (state.run) renderHeader();
  }
}
$("search").addEventListener("input", renderRuns);
for (const b of document.querySelectorAll("[data-tab]"))
  b.addEventListener("click", () => setTab(b.dataset.tab));
$("graph-select").addEventListener("change", () => {
  state.graph = $("graph-select").value;
  state.scope = "";
  state.node = null;
  renderPanel();
});
$("scope-select").addEventListener("change", () => {
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
  $("cancel-target").textContent = state.run.name + " · " + state.run.id;
  $("cancel-dialog").showModal();
});
$("cancel-back").addEventListener("click", () => $("cancel-dialog").close());
$("cancel-confirm").addEventListener("click", () => {
  $("cancel-dialog").close();
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
