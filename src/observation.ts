import type { ActivationRecord, RunRecord } from "./run-store.js";
import { legacyOutcome } from "./task-outcome.js";

const structural = new Set(["parallel", "map", "subworkflow", "worktree"]);
const terminal = new Set(["succeeded", "failed", "cancelled"]);
function descendant(parent: ActivationRecord, child: ActivationRecord): boolean {
  const prefix = [...parent.context.scope, "node", parent.context.nodeId, "visit", String(parent.context.visit)];
  return prefix.every((part, i) => child.context.scope[i] === part);
}
export function activeWork(records: readonly ActivationRecord[]): ActivationRecord[] {
  const active = records.filter(a => a.status === "running");
  return active.filter(a => !(a.kind === "await" && a.metadata.waiting === true) &&
    (!structural.has(a.kind) || !active.some(child => child !== a && descendant(a, child))));
}
export function activationState(a: ActivationRecord) {
  return a.status === "running" && a.kind === "await" && a.metadata.waiting === true ? "waiting" : a.status;
}
export interface ProcessObservation { supervisorAlive: boolean; workersAlive: number; observedAt: number; launchPending: boolean }
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
  const livenessState = !processes ? "unknown" : processes.supervisorAlive ? "supervised" : processes.workersAlive > 0
    ? "orphaned-workers" : processes.launchPending ? "launching" : "stopped";
  const processLabel = livenessState === "unknown" ? "Состояние процессов не проверено"
    : livenessState === "supervised" ? "Supervisor активен"
    : livenessState === "orphaned-workers" ? `Supervisor не найден · живых workers: ${processes!.workersAlive}`
    : livenessState === "launching" ? "Запуск supervisor ещё не подтверждён"
    : terminal.has(run.status) ? "Процессы запуска завершены" : "Живых процессов запуска нет";
  return {
    status: run.status, desired: run.desired, statusLabel: statusLabels[run.status], taskOutcome,
    outcomeLabel: taskOutcome ? outcomeLabels[taskOutcome.decision] : null,
    accepted: taskOutcome?.decision === "accepted" ? true : taskOutcome?.decision === "rejected" ? false : null,
    activeKeys: ["running", "waiting", "pausing", "cancelling"].includes(run.status) ? activeWork(records).map(a => a.key) : [],
    waitingKeys: records.filter(a => activationState(a) === "waiting").map(a => a.key),
    terminal: terminal.has(run.status),
    liveness: { state: livenessState, label: processLabel, supervisorAlive: processes?.supervisorAlive ?? null,
      workersAlive: processes?.workersAlive ?? null, observedAt: processes?.observedAt ?? null },
  };
}
export type RunPresentation = ReturnType<typeof projectRun>;
