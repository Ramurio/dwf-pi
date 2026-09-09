import type { ActivationRecord } from "./run-store.js";

export interface TokenUsage { input: number; output: number; totalTokens: number; cost?: number }
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
/** Only leaf agent accounting is billable here; parent outputs can contain duplicate child results. */
export function activationUsage(record: ActivationRecord): TokenUsage | undefined {
  if (record.kind !== "agent") return undefined;
  const usage = record.metadata.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return undefined;
  if (!nonnegative(usage.input) || !nonnegative(usage.output) || !nonnegative(usage.totalTokens)) return undefined;
  return { input: usage.input, output: usage.output, totalTokens: usage.totalTokens, ...(nonnegative(usage.cost) ? { cost: usage.cost } : {}) };
}
export function summarizeUsage(records: readonly ActivationRecord[]) {
  let input = 0, output = 0, totalTokens = 0, cost = 0, reported = 0, costReported = 0, missing = 0, pending = 0, earlierAttempts = 0;
  for (const record of records) {
    if (record.kind !== "agent") continue;
    if (record.attempt > 1) earlierAttempts += record.attempt - 1;
    const usage = activationUsage(record);
    if (!usage) { if (record.status === "running") pending++; else missing++; continue; }
    input += usage.input; output += usage.output; totalTokens += usage.totalTokens; reported++;
    if (usage.cost !== undefined) { cost += usage.cost; costReported++; }
  }
  return { input, output, totalTokens, cost, reported, costReported, missing, pending, earlierAttempts, partial: missing + pending + earlierAttempts > 0 };
}
export const tokenNumber = (value: number): string => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value).replace(/\u00a0/g, " ");
export function tokenSummary(records: readonly ActivationRecord[]): string {
  const usage = summarizeUsage(records);
  return `Токены: ${usage.reported || !usage.partial ? tokenNumber(usage.totalTokens) : "нет отчётов"}${usage.partial ? " · неполные данные" : ""} · отчётов: ${usage.reported}/${usage.reported + usage.pending + usage.missing}`;
}
