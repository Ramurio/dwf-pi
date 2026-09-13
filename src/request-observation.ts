import { AsyncLocalStorage } from "node:async_hooks";
import type { ExecutionFailureRecord } from "./execution-failure.js";
import { parseProviderResponse, type ProviderResponseRecord } from "./provider-response.js";

export const diagnosticSubcodes = [
  "adapter-content-mismatch", "image-unsupported", "image-invalid", "image-compaction-failed",
] as const;
export type DiagnosticSubcode = typeof diagnosticSubcodes[number];
export const dispatchStates = ["not-dispatched", "fetch-attempted", "http-observed", "unknown"] as const;
export type DispatchState = typeof dispatchStates[number];
export const diagnosticMessages: Record<DiagnosticSubcode, string> = {
  "adapter-content-mismatch": "Grok adapter contents do not match the reviewed pi-xai-oauth 1.5.2 helper; no request was sent. Reinstall the reviewed helper and keep project-local pi 0.85.1.",
  "image-unsupported": "This worker route does not accept image tool results. Use a model with supported image capabilities, or continue with text-only tools such as grep/ls.",
  "image-invalid": "An image was malformed or used an unsupported type. Provide PNG or JPEG within size limits; raw codec errors are not sent.",
  "image-compaction-failed": "Image inputs could not be compacted to a safe transport size; no request was sent. Reduce image dimensions or count.",
};
export interface FailureDiagnostic {
  subcode?: DiagnosticSubcode;
  dispatch: DispatchState;
  sentReasoning?: string;
}
export interface TrustedRequestObservation {
  diagnosticSubcode?: DiagnosticSubcode;
  failureCode?: ExecutionFailureRecord["code"];
  message?: string;
  dispatch: DispatchState;
  providerResponse?: ProviderResponseRecord;
  sentReasoning?: string;
  requestedReasoning?: string;
  availableReasoning?: readonly string[];
}
const storage = new AsyncLocalStorage<TrustedRequestObservation>();

export function createRequestObservation(): TrustedRequestObservation {
  return { dispatch: "unknown" };
}
export function runWithRequestObservation<T>(observation: TrustedRequestObservation, work: () => T): T {
  return storage.run(observation, work);
}
export function currentRequestObservation(): TrustedRequestObservation | undefined {
  return storage.getStore();
}
export function localDiagnostic(observation: TrustedRequestObservation | undefined, fields: {
  subcode: DiagnosticSubcode;
  code: ExecutionFailureRecord["code"];
  message?: string;
  dispatch?: DispatchState;
}): void {
  if (!observation) return;
  observation.diagnosticSubcode = fields.subcode;
  observation.failureCode = fields.code;
  observation.message = fields.message ?? diagnosticMessages[fields.subcode];
  observation.dispatch = fields.dispatch ?? "not-dispatched";
}
export function markFetchAttempted(observation: TrustedRequestObservation | undefined): void {
  if (!observation) return;
  if (observation.dispatch === "http-observed") return;
  observation.dispatch = "fetch-attempted";
}
export function markHttpObserved(observation: TrustedRequestObservation | undefined, response?: ProviderResponseRecord): void {
  if (!observation) return;
  if (observation.dispatch === "not-dispatched") return;
  observation.dispatch = "http-observed";
  if (response) observation.providerResponse = response;
}
export function recordSentReasoning(observation: TrustedRequestObservation | undefined, effort: string | undefined): void {
  if (!observation || effort === undefined) return;
  observation.sentReasoning = effort;
}
export function parseFailureDiagnostic(value: unknown): FailureDiagnostic | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return;
  const fields = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (!keys.includes("dispatch") || keys.some(key => typeof key !== "string" || !["subcode", "dispatch", "sentReasoning"].includes(key)
    || !fields[key]?.enumerable || !Object.hasOwn(fields[key]!, "value"))) return;
  const record = value as FailureDiagnostic;
  if (!dispatchStates.includes(record.dispatch)) return;
  if (Object.hasOwn(record, "subcode") && (typeof record.subcode !== "string" || !diagnosticSubcodes.includes(record.subcode))) return;
  if (Object.hasOwn(record, "sentReasoning") && (typeof record.sentReasoning !== "string" || !record.sentReasoning)) return;
  return {
    dispatch: record.dispatch,
    ...(record.subcode ? { subcode: record.subcode } : {}),
    ...(record.sentReasoning ? { sentReasoning: record.sentReasoning } : {}),
  };
}
export function diagnosticFromObservation(observation: TrustedRequestObservation | undefined): FailureDiagnostic | undefined {
  if (!observation) return;
  const sent = observation.dispatch === "not-dispatched" ? undefined : observation.sentReasoning;
  return parseFailureDiagnostic({
    dispatch: observation.dispatch,
    ...(observation.diagnosticSubcode ? { subcode: observation.diagnosticSubcode } : {}),
    ...(sent ? { sentReasoning: sent } : {}),
  });
}
export function parseObservedProviderResponse(value: unknown): ProviderResponseRecord | undefined {
  return parseProviderResponse(value);
}
