import type { ActivationRecord } from "./run-store.js";

const breakdownFields = ["cacheRead", "cacheWrite", "reasoning", "cost"] as const;
type BreakdownField = typeof breakdownFields[number];
export interface TokenUsage {
  input: number; output: number; totalTokens: number;
  cacheRead?: number; cacheWrite?: number;
  /** Included in output, never added to total again. */
  reasoning?: number;
  cost?: number;
  /** A present breakdown is the known subtotal when some constituent reports omit it. */
  partialFields?: BreakdownField[];
}
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const invalidField = Symbol("invalid usage field");
/** Absent optional fields are allowed, inherited/accessor/hidden fields are not. */
function ownUsageField(value: object, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor) return name in value ? invalidField : undefined;
  return descriptor.enumerable && Object.hasOwn(descriptor, "value") ? descriptor.value : invalidField;
}
export function parseUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const input = ownUsageField(value, "input"), output = ownUsageField(value, "output"), totalTokens = ownUsageField(value, "totalTokens");
  if (!nonnegative(input) || !nonnegative(output) || !nonnegative(totalTokens)) return undefined;
  const result: TokenUsage = { input, output, totalTokens };
  for (const name of breakdownFields) {
    const field = ownUsageField(value, name);
    if (field !== undefined) {
      if (!nonnegative(field)) return undefined;
      Object.defineProperty(result, name, { value: field, enumerable: true, writable: true, configurable: true });
    }
  }
  const partial = ownUsageField(value, "partialFields");
  if (partial !== undefined) {
    if (!Array.isArray(partial)) return undefined;
    const length = Object.getOwnPropertyDescriptor(partial, "length");
    if (!length || !Object.hasOwn(length, "value") || !Number.isSafeInteger(length.value) || length.value < 0) return undefined;
    const names: BreakdownField[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < length.value; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(partial, String(index));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return undefined;
      const name: unknown = descriptor.value;
      if (typeof name !== "string" || !breakdownFields.includes(name as BreakdownField) || seen.has(name) || !Object.hasOwn(result, name)) return undefined;
      seen.add(name);
      names.push(name as BreakdownField);
    }
    if (names.length) Object.defineProperty(result, "partialFields", { value: names, enumerable: true, writable: true, configurable: true });
  }
  return result;
}
/** Preserve known subtotals and their incompleteness, including when aggregating aggregates. */
export function sumTokenUsage(reports: readonly TokenUsage[]): TokenUsage {
  const sum: TokenUsage = { input: 0, output: 0, totalTokens: 0 };
  for (const report of reports) for (const name of ["input", "output", "totalTokens"] as const) sum[name] += report[name];
  const partialFields: BreakdownField[] = [];
  for (const name of breakdownFields) {
    const known = reports.filter(report => report[name] !== undefined);
    if (!known.length) continue;
    sum[name] = known.reduce((total, report) => total + report[name]!, 0);
    if (known.length !== reports.length || known.some(report => report.partialFields?.includes(name))) partialFields.push(name);
  }
  if (partialFields.length) sum.partialFields = partialFields;
  return sum;
}
/** Only leaf agent accounting is billable here; parent outputs can contain duplicate child results. */
export function activationUsage(record: ActivationRecord): TokenUsage | undefined {
  if (record.kind !== "agent") return undefined;
  return parseUsage(record.metadata.usage);
}
export function summarizeUsage(records: readonly ActivationRecord[]) {
  let input = 0, output = 0, totalTokens = 0, cost = 0, reported = 0, costReported = 0, missing = 0, pending = 0, earlierAttempts = 0;
  let cacheRead = 0, cacheWrite = 0, reasoning = 0, cacheReported = 0, reasoningReported = 0, incomplete = 0, responses = 0;
  let cacheReadReported = 0, cacheWriteReported = 0;
  let cacheReadPartial = false, cacheWritePartial = false, reasoningPartial = false, costPartial = false;
  for (const record of records) {
    if (record.kind !== "agent") continue;
    if (record.attempt > 1) earlierAttempts += Math.max(0, record.attempt - (typeof record.metadata.usageRecordedAttempts === "number" ? record.metadata.usageRecordedAttempts : 1));
    const usage = activationUsage(record);
    if (!usage) { if (record.status === "running") pending++; else missing++; continue; }
    if (record.status === "running" || record.metadata.usageComplete === false || record.metadata.usageLegacyIncomplete === true) incomplete++;
    if (typeof record.metadata.usageReportCount === "number") responses += record.metadata.usageReportCount;
    input += usage.input; output += usage.output; totalTokens += usage.totalTokens; reported++;
    if (usage.cost !== undefined) { cost += usage.cost; costReported++; }
    if (usage.cacheRead !== undefined) { cacheRead += usage.cacheRead; cacheReadReported++; }
    if (usage.cacheWrite !== undefined) { cacheWrite += usage.cacheWrite; cacheWriteReported++; }
    if (usage.cacheRead !== undefined && usage.cacheWrite !== undefined) cacheReported++;
    if (usage.reasoning !== undefined) { reasoning += usage.reasoning; reasoningReported++; }
    cacheReadPartial ||= usage.partialFields?.includes("cacheRead") ?? false;
    cacheWritePartial ||= usage.partialFields?.includes("cacheWrite") ?? false;
    reasoningPartial ||= usage.partialFields?.includes("reasoning") ?? false;
    costPartial ||= usage.partialFields?.includes("cost") ?? false;
  }
  const partial = missing + pending + earlierAttempts + incomplete > 0;
  return { input, output, totalTokens, cost, reported, costReported, missing, pending, earlierAttempts,
    cacheRead, cacheWrite, reasoning, cacheReported, reasoningReported, incomplete, responses,
    cacheReadReported, cacheWriteReported,
    cacheReadPartial: partial || cacheReadPartial || cacheReadReported < reported,
    cacheWritePartial: partial || cacheWritePartial || cacheWriteReported < reported,
    reasoningPartial: partial || reasoningPartial || reasoningReported < reported,
    costPartial: partial || costPartial || costReported < reported,
    partial };
}
export function summarizeTaskUsage(runs: readonly { id: string; records: readonly ActivationRecord[]; reusedOutputs?: number }[]) {
  const perRun = runs.map(run => ({ id: run.id, summary: summarizeUsage(run.records), reusedOutputs: run.reusedOutputs ?? run.records.filter(record => record.kind === "reuse").length }));
  const summaries = perRun.map(item => item.summary);
  const add = (key: keyof ReturnType<typeof summarizeUsage>) => summaries.reduce((total, item) => total + (item[key] as number), 0);
  const summary = summaries.length ? {
    ...summaries[0]!, input: add("input"), output: add("output"), totalTokens: add("totalTokens"), cost: add("cost"),
    reported: add("reported"), costReported: add("costReported"), missing: add("missing"), pending: add("pending"),
    earlierAttempts: add("earlierAttempts"), cacheRead: add("cacheRead"), cacheWrite: add("cacheWrite"), reasoning: add("reasoning"),
    cacheReported: add("cacheReported"), reasoningReported: add("reasoningReported"), incomplete: add("incomplete"), responses: add("responses"),
    cacheReadReported: add("cacheReadReported"), cacheWriteReported: add("cacheWriteReported"),
    cacheReadPartial: summaries.some(item => item.cacheReadPartial), cacheWritePartial: summaries.some(item => item.cacheWritePartial),
    reasoningPartial: summaries.some(item => item.reasoningPartial), costPartial: summaries.some(item => item.costPartial),
    partial: summaries.some(item => item.partial),
  } : summarizeUsage([]);
  return {
    summary, runs: perRun, reusedOutputs: perRun.reduce((n, item) => n + item.reusedOutputs, 0),
    sdkCostIsEstimate: true, subscriptionInvoice: false, unknownCostIsZero: false,
  };
}
export const tokenNumber = (value: number): string => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value).replace(/\u00a0/g, " ");
export function tokenSummary(records: readonly ActivationRecord[]): string {
  const usage = summarizeUsage(records);
  return `Токены: ${usage.reported || !usage.partial ? tokenNumber(usage.totalTokens) : "нет отчётов"}${usage.partial ? " · неполные данные" : ""} · отчётов: ${usage.reported}/${usage.reported + usage.pending + usage.missing}`;
}
