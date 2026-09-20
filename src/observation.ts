import type { ActivationRecord, RunRecord } from "./run-store.js";
import { legacyOutcome } from "./task-outcome.js";
import { parseRetryProgress } from "./retry-policy.js";

const structural = new Set(["parallel", "map", "subworkflow", "worktree"]);
const terminal = new Set(["succeeded", "failed", "cancelled"]);
export function activeWork(records: readonly ActivationRecord[]): ActivationRecord[] {
  type ScopeTrie = Map<string, ScopeTrie>;
  const occupied: ScopeTrie = new Map();
  // Every reachable prefix belongs to an occupied scope, including waits and retries
  // that will not themselves appear in the result. Rebuild on every observation.
  for (const record of records) {
    if (record.status !== "running" && activationState(record) !== "retrying") continue;
    let node = occupied;
    for (const part of record.context.scope) {
      let next = node.get(part);
      if (!next) { next = new Map(); node.set(part, next); }
      node = next;
    }
  }
  // Expected O(N + S + P), plus retry validation: S occupied scope segments,
  // P queried prefix segments. Index space O(S); no serialization of prefixes.
  return records.filter(record => {
    if (record.status !== "running" || (record.kind === "await" && record.metadata.waiting === true)) return false;
    if (!structural.has(record.kind)) return true;
    const prefix = [...record.context.scope, "node", record.context.nodeId, "visit", String(record.context.visit)];
    let node = occupied;
    for (const part of prefix) {
      const next = node.get(part);
      if (!next) return true;
      node = next;
    }
    // A record cannot hide itself: its own scope is four segments shorter.
    return false;
  });
}
export function activationState(a: ActivationRecord) {
  if (a.status === "failed" && parseRetryProgress(a.metadata.retry)?.status === "scheduled") return "retrying";
  if (a.status === "running" && a.kind === "await" && a.metadata.waitResolved === true) return "answered";
  return a.status === "running" && a.kind === "await" && a.metadata.waiting === true ? "waiting" : a.status;
}
export interface ProcessObservation { supervisorAlive: boolean; workersAlive: number; observedAt: number; launchPending: boolean; unresolvedGroupProcesses?: number }
const statusLabels: Record<RunRecord["status"], string> = {
  queued: "Ожидание", running: "В работе", waiting: "Ждёт ответа", pausing: "Приостановка", paused: "Пауза",
  cancelling: "Отмена…", cancelled: "Отменён", succeeded: "Завершён", failed: "Ошибка", interrupted: "Прерван",
};
const outcomeLabels = { accepted: "Результат принят", rejected: "Результат не принят", inconclusive: "Недостаточно данных для приёмки", unclassified: "Приёмка не объявлена" };

/** Shared presentation of journal facts and separately observed OS liveness.
 * A missing observation remains unknown; timestamps alone never establish death.
 */
export function projectRun(run: RunRecord, records: readonly ActivationRecord[], processes?: ProcessObservation) {
  const taskOutcome = run.status === "succeeded" ? run.taskOutcome ?? legacyOutcome(run.output ?? null) : null;
  const livenessState = !processes ? "unknown" : (processes.unresolvedGroupProcesses ?? 0) > 0 ? "unresolved-groups" : processes.supervisorAlive ? "supervised" : processes.workersAlive > 0
    ? "orphaned-workers" : processes.launchPending ? "launching" : "stopped";
  const processLabel = livenessState === "unknown" ? "Состояние процессов не проверено"
    : livenessState === "unresolved-groups" ? `Группы процессов требуют проверки · процессов: ${processes!.unresolvedGroupProcesses}`
    : livenessState === "supervised" ? "Supervisor активен"
    : livenessState === "orphaned-workers" ? `Supervisor не найден · живых workers: ${processes!.workersAlive}`
    : livenessState === "launching" ? "Запуск supervisor ещё не подтверждён"
    : terminal.has(run.status) ? "Процессы запуска завершены" : "Живых процессов запуска нет";
  return {
    status: run.status, desired: run.desired,
    statusLabel: livenessState === "unresolved-groups" && !processes!.supervisorAlive && !terminal.has(run.status)
      ? `${run.desired === "cancelled" ? "Отмена · " : run.desired === "paused" ? "Пауза · " : ""}Проверка процессов` : statusLabels[run.status], taskOutcome,
    outcomeLabel: taskOutcome ? outcomeLabels[taskOutcome.decision] : null,
    accepted: taskOutcome?.decision === "accepted" ? true : taskOutcome?.decision === "rejected" ? false : null,
    activeKeys: ["running", "waiting", "pausing", "cancelling"].includes(run.status) ? activeWork(records).map(a => a.key) : [],
    waitingKeys: records.filter(a => activationState(a) === "waiting").map(a => a.key),
    retryingKeys: !terminal.has(run.status) ? records.filter(a=>activationState(a)==="retrying").map(a=>a.key) : [],
    terminal: terminal.has(run.status),
    liveness: { state: livenessState, label: processLabel, supervisorAlive: processes?.supervisorAlive ?? null,
      unresolvedGroupProcesses: processes ? processes.unresolvedGroupProcesses ?? 0 : null,
      workersAlive: processes?.workersAlive ?? null, observedAt: processes?.observedAt ?? null },
  };
}
export type RunPresentation = ReturnType<typeof projectRun>;
