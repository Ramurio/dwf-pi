import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { failureCodes, type ExecutionFailureRecord } from "./execution-failure.js";

const closed = { additionalProperties: false } as const;
export const retryableCodes = failureCodes.filter(code => !["cancelled", "interrupted", "uncertain-effect"].includes(code));
export const RetryPolicySchema = Type.Object({
  codes: Type.Array(Type.Enum(retryableCodes), { minItems: 1, uniqueItems: true }),
  delayMs: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  maxAttempts: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
  provider: Type.Optional(Type.Object({
    statuses: Type.Optional(Type.Array(Type.Integer({minimum:100,maximum:599}),{minItems:1,uniqueItems:true})),
    retryAfter: Type.Optional(Type.Enum(["ignore","honor"])),
  }, closed)),
}, closed);
export type RetryPolicy = Static<typeof RetryPolicySchema>;
export function safeRetryFailure(failure: ExecutionFailureRecord): boolean {
  return ["not-started", "read-only"].includes(failure.effects) && failure.phase !== "cleanup" && retryableCodes.includes(failure.code);
}
export function permitsRetry(policy: RetryPolicy | undefined, attempt: number, failure: ExecutionFailureRecord): boolean {
  return !!policy && Check(RetryPolicySchema,policy) && (!policy.provider || policy.codes.includes("provider")) && safeRetryFailure(failure) && policy.codes.includes(failure.code) &&
    (policy.maxAttempts === undefined || attempt < policy.maxAttempts) &&
    (failure.code!=="provider" || !policy.provider?.statuses || !!failure.providerResponse && policy.provider.statuses.includes(failure.providerResponse.status));
}
export function retryDelay(policy: RetryPolicy, causes: readonly ExecutionFailureRecord[]): number {
  return causes.reduce((delay,cause)=>Math.max(delay,policy.provider?.retryAfter==="honor" && cause.code==="provider" ? cause.providerResponse?.retryAfterMs??0 : 0),policy.delayMs);
}
export interface RetryRecord { seq: number; runId: string; key: string; attempt: number; nextAttempt: number; at: number; delayMs: number; dueAt: number | null; failure: ExecutionFailureRecord; causes?: ExecutionFailureRecord[] }
const progressSchema = Type.Object({
  decisionSeq: Type.Integer({ minimum: 1 }), attempt: Type.Integer({ minimum: 1 }), nextAttempt: Type.Integer({ minimum: 2 }),
  scheduledAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  delayMs: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  dueAt: Type.Union([Type.Null(), Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })]),
  status: Type.Enum(["scheduled", "admitted", "abandoned"]),
}, closed);
export type RetryProgress = Static<typeof progressSchema>;
export function parseRetryProgress(value: unknown): RetryProgress | null {
  return Check(progressSchema,value) && value.nextAttempt === value.attempt + 1 ? value : null;
}
export function retryProgress(record: RetryRecord, status: RetryProgress["status"]): RetryProgress {
  return {decisionSeq:record.seq,attempt:record.attempt,nextAttempt:record.nextAttempt,scheduledAt:record.at,delayMs:record.delayMs,dueAt:record.dueAt,status};
}
export function retryRemaining(retry: Pick<RetryProgress,"scheduledAt"|"delayMs">, now = Date.now()): number {
  return Math.max(0,retry.delayMs-Math.max(0,now-retry.scheduledAt));
}
/** A checked journal deadline, not a failed task execution. */
export class RetryNotReady extends Error {
  constructor() { super("Scheduled retry is not ready for admission"); }
}
