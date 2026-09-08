import type { ActivationRecord, RunEvent, RunRecord } from "./run-store.js";
import { renderRun, terminalText } from "./terminal.js";

export type MonitorView = "overview" | "history" | "graph";
export interface WorkerActivity { at: number; label: string }
export interface MonitorOptions {
  width?: number; height?: number; now?: number; view?: MonitorView; offset?: number;
  activity?: ReadonlyMap<string, WorkerActivity>;
}
const structural = new Set(["parallel", "map", "subworkflow", "worktree"]);
const terminal = new Set(["succeeded", "failed", "cancelled"]);
const statusNames: Record<string, string> = {
  queued: "ОЖИДАНИЕ", running: "В РАБОТЕ", pausing: "ПРИОСТАНОВКА", paused: "ПАУЗА",
  cancelling: "ОТМЕНА…", cancelled: "ОТМЕНЁН", succeeded: "ЗАВЕРШЁН", failed: "ОШИБКА", interrupted: "ПРЕРВАН",
};
export const duration = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}с` : seconds < 3600 ? `${Math.floor(seconds / 60)}м ${seconds % 60}с` : `${Math.floor(seconds / 3600)}ч ${Math.floor(seconds % 3600 / 60)}м`;
};
// Count terminal cells, not UTF-16 units; never wrap a wide glyph over the right edge.
const cellWidth = (char: string) => /\p{Mark}/u.test(char) ? 0 : /[\p{Extended_Pictographic}\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(char) ? 2 : 1;
export function clipLine(value: string, width: number): string {
  const clean = terminalText(value, Number.MAX_SAFE_INTEGER);
  const chars = [...clean];
  if (chars.reduce((sum, char) => sum + cellWidth(char), 0) <= width) return clean;
  let result = "", cells = 0;
  for (const char of chars) { const size = cellWidth(char); if (cells + size > width - 1) break; result += char; cells += size; }
  return width > 0 ? `${result}…` : "";
}
/** Human path retains invocation and iteration identities without exposing internal scope tuples. */
export function activationPath(a: ActivationRecord): string {
  const scope = a.context.scope, parts: string[] = [];
  for (let i = 0; i < scope.length;) {
    if (scope[i] === "graph" && i + 1 < scope.length) { i += 2; continue; }
    if (scope[i] === "node" && scope[i + 2] === "visit" && i + 4 < scope.length) {
      parts.push(`${scope[i + 1]} #${Number(scope[i + 3]) + 1}`); i += 4;
      if (scope[i] === "parallel" || scope[i] === "map") {
        parts.push(scope[i] === "map" ? `элемент ${Number(scope[i + 1]) + 1}` : scope[i + 1]!); i += 2;
      } else if (scope[i] === "worktree" || scope[i] === "subworkflow") i++;
    } else { parts.push(scope[i]!); i++; }
  }
  return terminalText([...parts, `${a.context.nodeId} · проход ${a.context.visit + 1}${a.attempt > 1 ? ` · попытка ${a.attempt}` : ""}`].join(" / "), 2_000);
}
function descendant(parent: ActivationRecord, child: ActivationRecord): boolean {
  const prefix = [...parent.context.scope, "node", parent.context.nodeId, "visit", String(parent.context.visit)];
  return prefix.every((part, i) => child.context.scope[i] === part);
}
export function activeWork(records: readonly ActivationRecord[]): ActivationRecord[] {
  const active = records.filter(a => a.status === "running");
  return active.filter(a => !structural.has(a.kind) || !active.some(child => child !== a && descendant(a, child)));
}
function evidence(a: ActivationRecord): string {
  const output = a.output;
  if (output && typeof output === "object" && !Array.isArray(output)) {
    if (typeof output.exitCode === "number") return `exit ${output.exitCode}`;
    if (typeof output.decision === "string") return output.decision;
    if (typeof output.accepted === "boolean") return output.accepted ? "результат принят" : "результат НЕ принят";
  }
  if (a.error) return terminalText(a.error, 180);
  return a.status === "succeeded" ? "готово" : statusNames[a.status] ?? a.status;
}
const significant = (a: ActivationRecord) => !structural.has(a.kind) && (!["transform", "branch", "end"].includes(a.kind) || a.status === "failed" || evidence(a).includes("принят"));
function historyLine(a: ActivationRecord): string {
  const result = evidence(a);
  const rejected = result === "request_changes" || result === "inconclusive" || result.includes("НЕ принят") || /^exit (?!0$)/.test(result);
  const icon = a.status === "succeeded" && !rejected ? "✓" : a.status === "running" ? "▶" : "!";
  return `${icon} ${activationPath(a)} — ${evidence(a)} · ${duration((a.finishedAt ?? a.startedAt) - a.startedAt)}`;
}
export function collectActivity(events: readonly RunEvent[], activity: Map<string, WorkerActivity>): void {
  for (const e of events) {
    if (e.type !== "worker.event" || !e.payload || typeof e.payload !== "object" || Array.isArray(e.payload)) continue;
    const { key, event } = e.payload;
    if (typeof key !== "string" || !event || typeof event !== "object" || Array.isArray(event)) continue;
    const labels: Record<string, string> = { agent_start: "запрос к модели начат", turn_start: "ожидание ответа модели", turn_end: "ход модели завершён", agent_end: "ответ получен", agent_settled: "завершение worker", message_end: "сообщение получено" };
    const label = event.type === "tool_execution_start" ? `инструмент ${event.toolName}` : event.type === "tool_execution_end" ? `${event.toolName}: ${event.isError ? "ошибка" : "готово"}` : labels[String(event.type)];
    if (label) activity.set(key, { at: e.at, label: terminalText(label, 100) });
  }
}
export function monitorBody(run: RunRecord, records: readonly ActivationRecord[], options: MonitorOptions = {}): string[] {
  const now = options.now ?? Date.now(), view = options.view ?? "overview";
  if (view === "graph") return ["Схема: возможные переходы, не история выполнения.", ...renderRun(run, records).split("\n").slice(3)];
  const completed = records.filter(a => a.status !== "running" && significant(a)).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  if (view === "history") return ["Последние завершённые задачи — новые сверху", "Проход = повтор узла; попытка = восстановление того же прохода.", "", ...completed.map(historyLine), ...(!completed.length ? ["Завершённых задач пока нет."] : [])];
  const active = activeWork(records);
  const lines = [run.status === "paused" ? "ПАУЗА — новые задачи не запускаются" : "СЕЙЧАС"];
  if (!active.length) lines.push(terminal.has(run.status) ? "Активных задач нет." : "Ожидание следующего шага.");
  for (const a of active) {
    const config = run.plan.agents[a.context.graphId]?.[a.context.nodeId];
    lines.push(`▶ ${activationPath(a)}   ${duration((a.finishedAt ?? now) - a.startedAt)}`);
    const observed = options.activity?.get(a.key);
    const last = observed && observed.at >= a.startedAt ? observed : undefined;
    const detail = run.status === "paused" && structural.has(a.kind) ? "контейнер на паузе" : last ? `${last.label} · ${duration(now - last.at)} назад` : a.kind === "agent" ? "worker запущен; подробных событий пока нет" : structural.has(a.kind) ? "подготовка / завершение вложенных задач" : "команда выполняется";
    lines.push(`  ${config ? `${config.model.id} · ${config.thinking} · ` : ""}${detail}`);
  }
  lines.push("", "НЕДАВНО ЗАВЕРШЕНО");
  lines.push(...(completed.length ? completed.slice(0, 5).map(historyLine) : ["Пока ничего. Долгий первый ответ не означает повторный запуск."]));
  if (completed.length > 5) lines.push(`Ещё ${completed.length - 5} — вкладка 2 «История».`);
  lines.push("", "ДАЛЬШЕ ПО ГРАФУ");
  const next = new Set<string>();
  for (const a of active) {
    for (const edge of run.plan.workflow.graphs[a.context.graphId]?.edges ?? []) {
      if (edge.from === a.context.nodeId) next.add(`${a.context.nodeId} → ${edge.to}${edge.when ? " (по условию)" : ""}`);
    }
  }
  lines.push(...(next.size ? [...next].map(s => `  ${s}`) : [terminal.has(run.status) ? "Выполнение закончено." : "Переход станет известен после текущего шага."]));
  lines.push("", "Проход 2+ = повтор узла. Ветки / элементы = параллельные задачи.");
  return lines;
}
export function renderDashboard(run: RunRecord, records: readonly ActivationRecord[], options: MonitorOptions = {}): string {
  const width = Math.max(1, options.width ?? 100), height = Math.max(4, options.height ?? 24), now = options.now ?? Date.now();
  const active = activeWork(records).filter(a => !structural.has(a.kind)).length;
  const elapsed = duration((terminal.has(run.status) ? run.updatedAt : now) - run.createdAt);
  const heartbeat = run.heartbeatAt === null ? "ещё нет" : `${duration(now - run.heartbeatAt)} назад`;
  let outcome = "";
  if (run.output && typeof run.output === "object" && !Array.isArray(run.output) && run.output.accepted === false) outcome = " · РЕЗУЛЬТАТ НЕ ПРИНЯТ";
  const view = options.view ?? "overview";
  const tabs = `${view === "overview" ? "[1 Сейчас]" : "1 Сейчас"}   ${view === "history" ? "[2 История]" : "2 История"}   ${view === "graph" ? "[3 Схема]" : "3 Схема"}`;
  const heading = [
    `DYNAMICWF  ${statusNames[run.status] ?? run.status}${outcome} · ${elapsed} · задач сейчас: ${active}`,
    run.plan.workflow.name,
    `${run.id} · ${terminal.has(run.status) ? "запуск завершён" : `heartbeat: ${heartbeat} (по журналу)`}`,
    run.error ? `Ошибка: ${run.error}` : run.status === "pausing" ? "Ждём завершения активных задач, затем пауза." : tabs,
    "─".repeat(width),
  ];
  const body = monitorBody(run, records, options);
  if (height < 10) return [heading[0]!, heading[1]!, ...body.slice(0, height - 3), "1 Сейчас · 2 История · 3 Схема · q выход"].map(line => clipLine(line, width)).join("\n");
  const capacity = Math.max(0, height - heading.length - 2);
  const offset = Math.max(0, Math.min(options.offset ?? 0, Math.max(0, body.length - capacity)));
  const footer = `↑↓ прокрутка · q / Ctrl+C выйти${body.length > capacity ? ` · строки ${offset + 1}–${Math.min(body.length, offset + capacity)}/${body.length}` : ""}`;
  return [...heading, ...body.slice(offset, offset + capacity), ...Array(Math.max(0, capacity - body.slice(offset, offset + capacity).length)).fill(""), "─".repeat(width), footer].slice(0, height).map(line => clipLine(line, width)).join("\n");
}
/** Append-only transport reports transitions once, never repaints complete snapshots. */
export class MonitorLog {
  private state = "";
  private records = new Map<string, string>();
  update(run: RunRecord, records: readonly ActivationRecord[]): string[] {
    const lines: string[] = [];
    const state = `${run.status}/${run.desired}`;
    if (!this.state) lines.push(`${terminalText(run.plan.workflow.name)} · ${terminalText(run.id)}`);
    if (state !== this.state) lines.push(`Run: ${statusNames[run.status] ?? run.status}${run.error ? ` — ${terminalText(run.error)}` : ""}`);
    const initialVisible = new Set([...activeWork(records), ...records.filter(a => a.status !== "running" && significant(a)).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)).slice(0, 5)].map(a => a.key));
    for (const a of records) {
      const value = `${a.status}/${a.attempt}`;
      if (significant(a) && (this.state || initialVisible.has(a.key)) && this.records.get(a.key) !== value) lines.push(a.status === "running" ? `▶ ${activationPath(a)} — начат` : historyLine(a));
      this.records.set(a.key, value);
    }
    this.state = state;
    return lines;
  }
}
