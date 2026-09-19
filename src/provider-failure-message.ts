/** Public provider/SDK failure text. Observed HTTP status is a separate numeric fact. */
const GENERIC_MIXED = "Pi assistant turn failed or was aborted";
const GENERIC_ERROR = "Pi assistant turn failed";
const GENERIC_ABORTED = "Pi assistant turn was aborted";
const SAFE_SDK_REASONS = new Set([
  "Provider finish_reason: content_filter",
  "Provider finish_reason: network_error",
  "Stream ended without finish_reason",
  "OpenAI Responses stream ended without a stop reason",
  "Connection error.",
  "Request timed out.",
  "Assistant request exceeded the context window",
  "Provider returned an invalid deferred handle",
  "terminated",
  "fetch failed",
]);
const SAFE_PROVIDER_CODES = new Set([
  "invalid_request_error", "authentication_error", "permission_error", "not_found_error",
  "rate_limit_error", "rate_limit_exceeded", "insufficient_quota", "quota_exceeded",
  "invalid_api_key", "context_length_exceeded", "content_filter", "content_policy_violation",
  "server_error", "overloaded_error", "internal_error", "model_not_found", "tokens_exceeded",
  "billing_not_active", "billing_hard_limit_reached", "account_deactivated", "engine_overloaded",
  "insufficient_funds", "spend_limit_reached", "network_error", "api_error",
]);
const SAFE_FINISH_REASONS = new Map([
  ["content_filter", "Provider finish_reason: content_filter"],
  ["network_error", "Provider finish_reason: network_error"],
]);
const FINISH_REASON = /^Provider finish_reason: ([A-Za-z][A-Za-z0-9_]{0,40})$/;
const API_ERROR_CODE = /(?:API error|Provider error) \([1-9][0-9]{2}\): ([a-z][a-z0-9_]{0,60})$/i;

export function safeProviderReason(raw: unknown): string | undefined {
  if (typeof raw !== "string") return;
  const text = raw.trim();
  if (!text) return;
  if (text.length <= 200) {
    if (SAFE_SDK_REASONS.has(text)) return text;
    const finish = FINISH_REASON.exec(text);
    if (finish) {
      const mapped = SAFE_FINISH_REASONS.get(finish[1]!.toLowerCase());
      if (mapped) return mapped;
    }
    const prefixed = API_ERROR_CODE.exec(text);
    if (prefixed) {
      const code = prefixed[1]!.toLowerCase();
      if (SAFE_PROVIDER_CODES.has(code)) return code;
    }
  }
  if (text.length > 4000) return;
  return extractCodeFromJson(text);
}

function extractCodeFromJson(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return;
  try { return pickSafeCode(JSON.parse(text.slice(start, end + 1))); }
  catch { return; }
}

function pickSafeCode(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return;
  if (typeof value === "string") {
    const code = value.trim().toLowerCase();
    return SAFE_PROVIDER_CODES.has(code) ? code : undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return;
  const record = value as Record<string, unknown>;
  for (const key of ["code", "type"] as const) {
    if (!Object.hasOwn(record, key)) continue;
    const found = pickSafeCode(record[key], depth + 1);
    if (found) return found;
  }
  if (Object.hasOwn(record, "error")) return pickSafeCode(record.error, depth + 1);
}

export function providerFailureMessage(failed: readonly { stopReason?: string; errorMessage?: string }[]): string {
  const kinds = new Set<"error" | "aborted">();
  for (const message of failed) {
    if (message.stopReason === "error" || message.stopReason === "aborted") kinds.add(message.stopReason);
  }
  if (kinds.size !== 1) return GENERIC_MIXED;
  const kind = kinds.has("error") ? "error" as const : "aborted" as const;
  let raw: string | undefined;
  for (let i = failed.length - 1; i >= 0; i--) {
    if (failed[i]?.stopReason === kind) { raw = failed[i]!.errorMessage; break; }
  }
  const reason = safeProviderReason(raw);
  if (!reason) return kind === "aborted" ? GENERIC_ABORTED : GENERIC_ERROR;
  return kind === "aborted" ? `${GENERIC_ABORTED}: ${reason}` : `${GENERIC_ERROR}: ${reason}`;
}
