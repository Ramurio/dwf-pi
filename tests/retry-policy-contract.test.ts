import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionFailureRecord } from "../src/execution-failure.js";
import { safeRetryFailure, permitsRetry, retryDelay, parseRetryProgress, retryRemaining, type RetryPolicy, type RetryProgress } from "../src/retry-policy.js";

const failure = (fields: Partial<ExecutionFailureRecord> = {}): ExecutionFailureRecord => ({
  version: 1, code: "process", phase: "execution", effects: "read-only", message: "Offline observation", ...fields,
});
const policy: RetryPolicy = { codes: ["process"], delayMs: 50 };
const providerFailure = (status?: number, retryAfterMs?: number): ExecutionFailureRecord => failure({
  code: "provider", ...(status === undefined ? {} : { providerResponse: { status, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) } }),
});

// Outcomes are contract literals, not derived from the implementation's code list/schema.
for (const effects of ["not-started", "read-only"] as const) {
  for (const code of ["configuration", "resource", "provider", "output", "process", "protocol", "expression", "unknown"] as const) {
    test(`safe: ${effects}/${code}`, () => assert.equal(safeRetryFailure(failure({ effects, code })), true));
  }
  test(`safe: unknown phase/${effects}`, () => assert.equal(safeRetryFailure(failure({ effects, phase: "unknown" })), true));
  for (const code of ["cancelled", "interrupted", "uncertain-effect"] as const) {
    test(`unsafe: ${code}/${effects}`, () => assert.equal(safeRetryFailure(failure({ effects, code })), false));
  }
  test(`unsafe: cleanup/${effects}`, () => assert.equal(safeRetryFailure(failure({ effects, phase: "cleanup" })), false));
}
test("unsafe: unknown effects", () => assert.equal(safeRetryFailure(failure({ effects: "unknown" })), false));

const authorization: { name: string; policy: RetryPolicy | undefined; failure: ExecutionFailureRecord; expected: boolean }[] = [
  { name: "selected safe", policy, failure: failure(), expected: true },
  { name: "absent policy", policy: undefined, failure: failure(), expected: false },
  { name: "unselected code", policy, failure: failure({ code: "resource" }), expected: false },
  { name: "unknown effects", policy, failure: failure({ effects: "unknown" }), expected: false },
  { name: "cleanup read-only", policy, failure: failure({ phase: "cleanup" }), expected: false },
  { name: "cleanup not-started", policy, failure: failure({ phase: "cleanup", effects: "not-started" }), expected: false },
];
for (const row of authorization) test(`authorization: ${row.name}`, () => assert.equal(permitsRetry(row.policy, 1, row.failure), row.expected));
for (const [name, maxAttempts, attempt, expected] of [
  ["first is included", 1, 1, false], ["below limit", 2, 1, true], ["at limit", 2, 2, false], ["above limit", 2, 3, false],
  ["unbounded first", undefined, 1, true], ["unbounded sixth", undefined, 6, true], ["unbounded million", undefined, 1000000, true],
  ["safe integer below", Number.MAX_SAFE_INTEGER, 9007199254740990, true], ["safe integer at", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, false],
] as const) test(`attempt: ${name}`, () => assert.equal(permitsRetry({ ...policy, ...(maxAttempts === undefined ? {} : { maxAttempts }) }, attempt, failure()), expected));

const malformedPolicies: [string, unknown][] = [
  ["missing codes", { delayMs: 50 }], ["missing delay", { codes: ["process"] }],
  ["empty codes", { ...policy, codes: [] }], ["duplicate codes", { ...policy, codes: ["process", "process"] }],
  ["unknown code", { ...policy, codes: ["process", "bogus"] }], ["codes type", { ...policy, codes: "process" }],
  ["delay type", { ...policy, delayMs: "50" }], ["attempt type", { ...policy, maxAttempts: "2" }],
  ["extra field", { ...policy, allowUnknownEffects: true }], ["provider type", { ...policy, codes: ["provider"], provider: true }],
];
for (const code of ["cancelled", "interrupted", "uncertain-effect"]) malformedPolicies.push([`forbidden ${code}`, { ...policy, codes: ["process", code] }]);
for (const delayMs of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) malformedPolicies.push([`delay ${delayMs}`, { ...policy, delayMs }]);
for (const maxAttempts of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) malformedPolicies.push([`limit ${maxAttempts}`, { ...policy, maxAttempts }]);
for (const [name, value] of malformedPolicies) test(`malformed policy: ${name}`, () => {
  // Deliberately malformed external policy: all other authorization conditions allow retry.
  assert.equal(permitsRetry(value as RetryPolicy, 1, name === "provider type" ? providerFailure(429) : failure()), false);
});

const filtered: RetryPolicy = { codes: ["provider"], delayMs: 50, provider: { statuses: [429, 503] } };
for (const [status, expected] of [[429, true], [503, true], [401, false], [undefined, false]] as const) {
  test(`status filter: ${status}`, () => assert.equal(permitsRetry(filtered, 1, providerFailure(status)), expected));
}
for (const provider of [undefined, {}]) for (const status of [401, undefined]) {
  test(`no status filter: ${JSON.stringify(provider)}/${status}`, () => assert.equal(permitsRetry({ codes: ["provider"], delayMs: 50, ...(provider ? { provider } : {}) }, 1, providerFailure(status)), true));
}
for (const status of [100, 200, 599]) test(`selected HTTP observation: ${status}`, () => assert.equal(permitsRetry({ ...filtered, provider: { statuses: [status] } }, 1, providerFailure(status)), true));
test("status filter does not restrict selected resource", () => assert.equal(permitsRetry({ ...filtered, codes: ["provider", "resource"] }, 1, failure({ code: "resource" })), true));
test("provider options require selected provider code", () => assert.equal(permitsRetry({ ...policy, provider: {} }, 1, failure()), false));
for (const [name, provider] of [
  ["empty", { statuses: [] }], ["low", { statuses: [99] }], ["high", { statuses: [600] }],
  ["duplicate", { statuses: [429, 429] }], ["fraction", { statuses: [429.5] }],
  ["retryAfter", { retryAfter: "automatic" }], ["extra", { statuses: [429], extra: true }],
] as const) test(`malformed provider: ${name}`, () => assert.equal(permitsRetry({ ...filtered, provider } as unknown as RetryPolicy, 1, providerFailure(429)), false));
for (const retryAfter of ["honor", "ignore"] as const) {
  const selected = { ...filtered, provider: { statuses: [429], retryAfter } };
  for (const [name, cause] of [
    ["unknown effects", { ...providerFailure(429, 900), effects: "unknown" }],
    ["mismatch", providerFailure(401, 900)], ["missing", providerFailure()], ["unselected", failure()],
  ] as const) test(`Retry-After cannot authorize: ${retryAfter}/${name}`, () => assert.equal(permitsRetry(selected, 1, cause), false));
}

const honor: RetryPolicy = { ...filtered, provider: { retryAfter: "honor" } };
const delays: { name: string; causes: ExecutionFailureRecord[]; expected: number }[] = [
  { name: "empty", causes: [], expected: 50 }, { name: "non-provider", causes: [failure()], expected: 50 },
  { name: "no response", causes: [providerFailure()], expected: 50 }, { name: "no header", causes: [providerFailure(429)], expected: 50 },
  { name: "zero", causes: [providerFailure(429, 0)], expected: 50 }, { name: "below floor", causes: [providerFailure(429, 10)], expected: 50 },
  { name: "at floor", causes: [providerFailure(429, 50)], expected: 50 }, { name: "honor 900", causes: [providerFailure(429, 900)], expected: 900 },
  { name: "ascending", causes: [providerFailure(429, 900), providerFailure(503, 1200)], expected: 1200 },
  { name: "descending", causes: [providerFailure(503, 1200), providerFailure(429, 900)], expected: 1200 },
  { name: "mixed", causes: [failure(), providerFailure(503, 1200), failure(), providerFailure(429, 900)], expected: 1200 },
];
for (const row of delays) test(`delay: ${row.name}`, () => assert.equal(retryDelay(honor, row.causes), row.expected));
for (const [name, options] of [["ignore", { retryAfter: "ignore" }], ["omitted retryAfter", {}], ["omitted provider", undefined]] as const) {
  for (const row of delays) test(`delay ${name}: ${row.name}`, () => assert.equal(retryDelay({ codes: ["provider"], delayMs: 50, ...(options ? { provider: options } : {}) }, row.causes), 50));
}
for (const [name, base, server, expected] of [
  ["zero base", 0, 900, 900], ["zero both", 0, 0, 0], ["no timer cap", 0, 2147483648, 2147483648],
  ["safe integer server", 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  ["large configured floor", Number.MAX_SAFE_INTEGER, 10, Number.MAX_SAFE_INTEGER],
] as const) test(`delay boundary: ${name}`, () => assert.equal(retryDelay({ ...honor, delayMs: base }, [providerFailure(429, server)]), expected));

const progress: RetryProgress = { decisionSeq: 1, attempt: 1, nextAttempt: 2, scheduledAt: 1000, delayMs: 500, dueAt: 1500, status: "scheduled" };
for (const status of ["scheduled", "admitted", "abandoned"] as const) test(`progress status: ${status}`, () => assert.deepEqual(parseRetryProgress({ ...progress, status }), { ...progress, status }));
for (const [name, value] of [
  ["zero times", { ...progress, scheduledAt: 0, delayMs: 0, dueAt: 0 }],
  ["overflow deadline", { ...progress, delayMs: Number.MAX_SAFE_INTEGER, dueAt: null }],
  ["adjacent attempt", { ...progress, attempt: 2, nextAttempt: 3 }],
] as const) test(`progress valid: ${name}`, () => assert.deepEqual(parseRetryProgress(value), value));
const malformedProgress: [string, unknown][] = [
  ["null", null], ["undefined", undefined], ["primitive", 1], ["string", "scheduled"], ["array", []], ["empty", {}],
  ["extra", { ...progress, extra: true }], ["status", { ...progress, status: "pending" }],
  ["same attempt", { ...progress, attempt: 2, nextAttempt: 2 }], ["skipped attempt", { ...progress, attempt: 2, nextAttempt: 4 }],
];
for (const key of Object.keys(progress) as (keyof RetryProgress)[]) {
  const missing: Partial<RetryProgress> = { ...progress }; delete missing[key];
  malformedProgress.push([`missing ${key}`, missing], [`wrong type ${key}`, { ...progress, [key]: false }]);
}
for (const key of ["decisionSeq", "attempt", "nextAttempt"] as const) for (const value of [0, 1.5]) malformedProgress.push([`${key} ${value}`, { ...progress, [key]: value }]);
malformedProgress.push(["nextAttempt below minimum", { ...progress, nextAttempt: 1 }]);
for (const key of ["scheduledAt", "delayMs", "dueAt"] as const) for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) malformedProgress.push([`${key} ${value}`, { ...progress, [key]: value }]);
for (const [name, value] of malformedProgress) test(`progress malformed: ${name}`, () => assert.equal(parseRetryProgress(value), null));
for (const [now, expected] of [[900, 500], [1000, 500], [1250, 250], [1499, 1], [1500, 0], [2000, 0]] as const) {
  test(`remaining: now=${now}`, () => assert.equal(retryRemaining(progress, now), expected));
  test(`remaining zero delay: now=${now}`, () => assert.equal(retryRemaining({ ...progress, delayMs: 0 }, now), 0));
}
test("remaining: nullable deadline and large delay", () => {
  const value: RetryProgress = { ...progress, delayMs: Number.MAX_SAFE_INTEGER, dueAt: null };
  assert.equal(retryRemaining(value, 2000), 9007199254739991);
});
