import assert from "node:assert/strict";
import test from "node:test";
import { parseUsage, sumTokenUsage, summarizeUsage, summarizeTaskUsage } from "../src/usage.js";
import type { TokenUsage } from "../src/usage.js";
import type { ActivationRecord } from "../src/run-store.js";

const fields = ["cacheRead", "cacheWrite", "reasoning", "cost"] as const;
const U = { input: 2, output: 3, totalTokens: 15, cacheRead: 10, cacheWrite: 0, reasoning: 1, cost: 0.25 };
const V = { input: 1, output: 1, totalTokens: 7 };
const Z = { input: 0, output: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 };
const UV = { input: 3, output: 4, totalTokens: 22, cacheRead: 10, cacheWrite: 0, reasoning: 1, cost: 0.25, partialFields: [...fields] };
const empty = {
  input: 0, output: 0, totalTokens: 0, cost: 0, reported: 0, costReported: 0,
  missing: 0, pending: 0, earlierAttempts: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0,
  cacheReported: 0, reasoningReported: 0, incomplete: 0, responses: 0,
  cacheReadReported: 0, cacheWriteReported: 0,
  cacheReadPartial: false, cacheWritePartial: false, reasoningPartial: false, costPartial: false, partial: false,
};
const breakdownPartial = { cacheReadPartial: true, cacheWritePartial: true, reasoningPartial: true, costPartial: true };
const uSummary = { ...empty, ...U, reported: 1, responses: 2, costReported: 1,
  cacheReadReported: 1, cacheWriteReported: 1, cacheReported: 1, reasoningReported: 1 };
const vSummary = { ...empty, ...V, reported: 1, responses: 1, ...breakdownPartial };
const uvSummary = { ...uSummary, input: 3, output: 4, totalTokens: 22, reported: 2, responses: 3, ...breakdownPartial };
const policy = { sdkCostIsEstimate: true, subscriptionInvoice: false, unknownCostIsZero: false };
function agent(key: string, metadata: ActivationRecord["metadata"] = {}, overrides: Partial<ActivationRecord> = {}): ActivationRecord {
  return { runId: `run-${key}`, key, context: { graphId: "main", nodeId: key, scope: ["main", key], visit: 0 },
    kind: "agent", status: "succeeded", sideEffect: false, attempt: 1, ownerToken: "", startedAt: 0, finishedAt: 1,
    metadata, ...overrides };
}
const a = agent("a", { usage: U, usageComplete: true, usageReportCount: 2 });
const b = agent("b", { usage: V, usageComplete: true, usageReportCount: 1 });

for (const field of fields) test(`parse/sum ${field}: absent, known, zero and inherited partial zero`, () => {
  assert.deepEqual(parseUsage(V), V);
  for (const value of [0, 0.5]) {
    const known = { ...V, [field]: value };
    const partial = { ...known, partialFields: [field] };
    assert.deepEqual(parseUsage(known), known);
    assert.deepEqual(parseUsage(partial), partial);
    assert.deepEqual(sumTokenUsage([known, V]), { input: 2, output: 2, totalTokens: 14, [field]: value, partialFields: [field] });
    assert.deepEqual(sumTokenUsage([known, known]), { input: 2, output: 2, totalTokens: 14, [field]: value * 2 });
    assert.deepEqual(sumTokenUsage([partial, known]), { input: 2, output: 2, totalTokens: 14, [field]: value * 2, partialFields: [field] });
  }
  for (const invalid of [-1, NaN, Infinity, -Infinity, "0", null]) {
    assert.equal(parseUsage({ ...V, [field]: invalid }), undefined, `${field}=${String(invalid)}`);
  }
  assert.equal(parseUsage({ ...V, partialFields: [field] }), undefined);
  assert.equal(parseUsage({ ...V, [field]: 0, partialFields: [field, field] }), undefined);
});

test("parse validates required finite nonnegative numbers and partial names without inventing provider constraints", () => {
  for (const field of ["input", "output", "totalTokens"] as const) {
    for (const invalid of [undefined, -1, NaN, Infinity, -Infinity, "0", null]) {
      assert.equal(parseUsage({ ...V, [field]: invalid }), undefined, `${field}=${String(invalid)}`);
    }
  }
  for (const invalid of [null, undefined, [], "usage", 0]) assert.equal(parseUsage(invalid), undefined);
  for (const partialFields of ["cost", null, {}, ["other"], ["input"], ["output"], ["totalTokens"]]) {
    assert.equal(parseUsage({ ...U, partialFields }), undefined);
  }
  assert.deepEqual(parseUsage({ ...U, partialFields: [] }), U);
  assert.deepEqual(parseUsage({ ...U, partialFields: ["cost", "cacheRead"] }), { ...U, partialFields: ["cost", "cacheRead"] });
  assert.deepEqual(parseUsage({ input: 0.5, output: 0, totalTokens: 19.25, extra: true }), { input: 0.5, output: 0, totalTokens: 19.25 });
  assert.deepEqual(parseUsage(Z), Z);
});

test("literal provider totals and nested sums preserve unknown subtotals; empty is not a completeness identity", () => {
  assert.deepEqual(sumTokenUsage([]), { input: 0, output: 0, totalTokens: 0 });
  assert.deepEqual(sumTokenUsage([U, V]), UV);
  assert.deepEqual(sumTokenUsage([U, Z]), U);
  assert.deepEqual(sumTokenUsage([V, V]), { input: 2, output: 2, totalTokens: 14 });
  assert.deepEqual(sumTokenUsage([sumTokenUsage([U, V]), Z]), UV);
});

const seed = 0x5eed1234;
test(`nonempty sum composition, seed=0x${seed.toString(16)}`, () => {
  let state = seed;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  for (let index = 0; index < 64; index++) {
    const reports: TokenUsage[] = Array.from({ length: 3 + next() % 16 }, () => {
      const report: TokenUsage = { input: next() % 11, output: next() % 7, totalTokens: 20 + next() % 31 };
      for (const field of fields) {
        const mode = (next() >>> 16) % 5;
        if (mode === 0) continue;
        report[field] = mode === 1 || mode === 3 ? 0 : next() % 17 / (field === "cost" ? 8 : 1);
        if (mode >= 3) (report.partialFields ??= []).push(field);
      }
      return report;
    });
    const groups: TokenUsage[][] = [];
    for (let at = 0; at < reports.length;) {
      const size = 1 + next() % 4;
      groups.push(reports.slice(at, at + size)); at += size;
    }
    const message = `seed=${seed}, case=${index}, partition=${groups.map(g => g.length).join(",")}`;
    const flat = sumTokenUsage(reports), grouped = sumTokenUsage(groups.map(group => sumTokenUsage(group)));
    assert.deepEqual(grouped, flat, message);
    const middle = Math.max(1, Math.floor(reports.length / 2));
    assert.deepEqual(sumTokenUsage([sumTokenUsage([sumTokenUsage(reports.slice(0, middle))]), sumTokenUsage(reports.slice(middle))]), flat, message);
    assert.deepEqual(parseUsage(grouped), flat, message);
    const records = reports.map((usage, i) => agent(String(i), { usage: { ...usage }, usageComplete: true }));
    assert.deepEqual(summarizeTaskUsage([{ id: "left", records: records.slice(0, middle) }, { id: "right", records: records.slice(middle) }]).summary,
      summarizeUsage(records), message);
  }
});

test("independent agents are billable regardless of output, success or sideEffect; structural copies are not", () => {
  assert.deepEqual(summarizeUsage([a, b]), uvSummary);
  const failed = { ...b, status: "failed" as const, sideEffect: true, output: { usage: U } };
  assert.deepEqual(summarizeUsage([a, failed]), uvSummary);
  const structural = ["map", "parallel", "subworkflow", "worktree", "check", "transform", "reuse"].map(kind =>
    agent(kind, { usage: U, usageComplete: false, usageLegacyIncomplete: true, usageReportCount: 100 },
      { kind, attempt: 9, status: "running", output: { usage: U } }));
  assert.deepEqual(summarizeUsage(structural), empty);
  assert.deepEqual(summarizeUsage([a, b, ...structural]), uvSummary);
  assert.deepEqual(summarizeUsage([agent("output-only", {}, { output: { usage: U } })]),
    { ...empty, missing: 1, partial: true, ...breakdownPartial });
});

const gaps: { name: string; record: ActivationRecord; expected: typeof empty }[] = [];
for (const usage of [undefined, { input: -1, output: 0, totalTokens: 0 }]) {
  for (const status of ["running", "failed", "succeeded", "interrupted"] as const) {
    gaps.push({ name: `${status} ${usage ? "invalid" : "absent"}`, record: agent("gap", { usage }, { status }),
      expected: { ...empty, [status === "running" ? "pending" : "missing"]: 1, partial: true, ...breakdownPartial } });
  }
}
for (const [name, metadata, status] of [
  ["running with usage", {}, "running"], ["explicit incomplete", { usageComplete: false }, "succeeded"],
  ["sticky legacy", { usageComplete: true, usageLegacyIncomplete: true }, "succeeded"],
  ["overlapping reasons count once", { usageComplete: false, usageLegacyIncomplete: true }, "running"],
] as const) gaps.push({ name, record: agent(name, { ...a.metadata, ...metadata }, { status }),
  expected: { ...uSummary, incomplete: 1, partial: true, ...breakdownPartial } });
for (const [recorded, earlierAttempts] of [[undefined, 2], [2, 1], [3, 0]] as const) {
  for (const hasUsage of [true, false]) gaps.push({ name: `attempt=3 recorded=${recorded} usage=${hasUsage}`,
    record: agent("attempt", { ...(hasUsage ? a.metadata : {}), usageRecordedAttempts: recorded }, { attempt: 3 }),
    expected: { ...(hasUsage ? uSummary : empty), earlierAttempts, missing: hasUsage ? 0 : 1,
      ...(earlierAttempts || !hasUsage ? { partial: true, ...breakdownPartial } : {}) } });
}
for (const { name, record, expected } of gaps) test(`accounting gap: ${name}, including run boundary`, () => {
  assert.deepEqual(summarizeUsage([record]), expected);
  assert.deepEqual(summarizeTaskUsage([{ id: "clean", records: [a] }, { id: "gap", records: [record] }]), {
    runs: [{ id: "clean", summary: uSummary, reusedOutputs: 0 }, { id: "gap", summary: expected, reusedOutputs: 0 }],
    summary: { ...expected, input: expected.input + 2, output: expected.output + 3, totalTokens: expected.totalTokens + 15,
      cost: expected.cost + 0.25, cacheRead: expected.cacheRead + 10, reasoning: expected.reasoning + 1,
      reported: expected.reported + 1, responses: expected.responses + 2, costReported: expected.costReported + 1,
      cacheReadReported: expected.cacheReadReported + 1, cacheWriteReported: expected.cacheWriteReported + 1,
      cacheReported: expected.cacheReported + 1, reasoningReported: expected.reasoningReported + 1 }, reusedOutputs: 0, ...policy,
  });
});

for (const field of fields) for (const value of [0, 0.5]) test(`summary/task isolate ${field} partial=${value}`, () => {
  const usage = { ...Z, [field]: value, partialFields: [field] };
  const record = agent(field, { usage });
  const expected = { ...empty, [field]: value, reported: 1, costReported: 1, cacheReadReported: 1,
    cacheWriteReported: 1, cacheReported: 1, reasoningReported: 1, [`${field}Partial`]: true };
  assert.deepEqual(summarizeUsage([record]), expected);
  assert.deepEqual(summarizeTaskUsage([{ id: "empty", records: [] }, { id: field, records: [record] }]).summary, expected);
});

test("task literal totals, per-run order, reuse override and empty policy", () => {
  const reuse = { ...a, kind: "reuse" };
  assert.deepEqual(summarizeTaskUsage([{ id: "u", records: [a] }, { id: "v", records: [b] }, { id: "reuse", records: [reuse] }]), {
    summary: uvSummary, runs: [{ id: "u", summary: uSummary, reusedOutputs: 0 }, { id: "v", summary: vSummary, reusedOutputs: 0 },
      { id: "reuse", summary: empty, reusedOutputs: 1 }], reusedOutputs: 1, ...policy,
  });
  for (const reusedOutputs of [0, 5]) assert.deepEqual(summarizeTaskUsage([{ id: "reuse", records: [reuse], reusedOutputs }]), {
    summary: empty, runs: [{ id: "reuse", summary: empty, reusedOutputs }], reusedOutputs, ...policy,
  });
  assert.deepEqual(summarizeUsage([]), empty);
  assert.deepEqual(summarizeTaskUsage([]), { summary: empty, runs: [], reusedOutputs: 0, ...policy });
});
