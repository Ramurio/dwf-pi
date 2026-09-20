import assert from "node:assert/strict";
import test from "node:test";
import { activeWork as indexedActiveWork } from "../src/observation.js";
import { parseRetryProgress } from "../src/retry-policy.js";
import type { ActivationRecord } from "../src/run-store.js";

// Frozen reference from 892a136465f833ad1f4b1cdc674047f7070c7514.
// Bodies copied verbatim; only export modifiers removed. Do not share optimized helpers.
const structural = new Set(["parallel", "map", "subworkflow", "worktree"]);
function descendant(parent: ActivationRecord, child: ActivationRecord): boolean {
  const prefix = [...parent.context.scope, "node", parent.context.nodeId, "visit", String(parent.context.visit)];
  return prefix.every((part, i) => child.context.scope[i] === part);
}
function activeWork(records: readonly ActivationRecord[]): ActivationRecord[] {
  const active = records.filter(a => a.status === "running");
  return active.filter(a => !(a.kind === "await" && a.metadata.waiting === true) &&
    (!structural.has(a.kind) || !records.some(child => child !== a && (child.status === "running" || activationState(child) === "retrying") && descendant(a, child))));
}
function activationState(a: ActivationRecord) {
  if (a.status === "failed" && parseRetryProgress(a.metadata.retry)?.status === "scheduled") return "retrying";
  return a.status === "running" && a.kind === "await" && a.metadata.waiting === true ? "waiting" : a.status;
}

const kinds = ["worktree", "map", "parallel", "subworkflow"] as const;
const root = ["graph", "main"];
function record(nodeId: string, kind = "agent", scope: readonly string[] = root, visit = 0): ActivationRecord {
  return { runId: "run", key: nodeId, context: { graphId: "main", nodeId, scope, visit }, kind,
    status: "running", sideEffect: false, attempt: 1, ownerToken: "owner", startedAt: 0, finishedAt: null, metadata: {} };
}
// Matches compiler.ts structural invocation scopes and run-runtime.ts worktree scopes.
function childScope(parent: ActivationRecord, branch = "1"): string[] {
  const { scope, nodeId, visit } = parent.context;
  return [...scope, "node", nodeId, "visit", String(visit), parent.kind,
    ...(["parallel", "map"].includes(parent.kind) ? [branch] : []), "graph", "child"];
}
function identities(actual: readonly ActivationRecord[], expected: readonly ActivationRecord[]) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert.strictEqual(value, expected[i], `identity at ${i}`));
}
function check(records: readonly ActivationRecord[], expected?: readonly ActivationRecord[]) {
  const actual = indexedActiveWork(records);
  identities(actual, activeWork(records));
  if (expected) identities(actual, expected);
}
function freeze(records: ActivationRecord[]): readonly ActivationRecord[] {
  for (const a of records) {
    if (a.metadata.retry && typeof a.metadata.retry === "object") Object.freeze(a.metadata.retry);
    Object.freeze(a.context.scope); Object.freeze(a.context); Object.freeze(a.metadata); Object.freeze(a);
  }
  return Object.freeze(records);
}
const retry = (status = "scheduled") => ({ decisionSeq: 1, attempt: 1, nextAttempt: 2,
  scheduledAt: 0, delayMs: 100, dueAt: 100, status });

test("nested structural chains preserve ordered identities on frozen inputs", () => {
  check(Object.freeze([]), []);
  for (let rotation = 0; rotation < kinds.length; rotation++) {
    const chain: ActivationRecord[] = [];
    for (let depth = 0; depth < 4; depth++) {
      chain.push(record("same", kinds[(depth + rotation) % 4]!, depth ? childScope(chain[depth - 1]!) : root));
    }
    const leaf = record("leaf", "agent", childScope(chain[3]!));
    const empty = record("no-child", "map");
    const duplicateKey = record("leaf");
    duplicateKey.runId = "other-run";
    const records = freeze([leaf, empty, ...chain.reverse(), duplicateKey, leaf]);
    check(records, [leaf, empty, duplicateKey, leaf]);
  }
});

test("segment boundaries, sibling names, map items, scopes and visits do not alias", () => {
  for (const kind of kinds) {
    const parents = [0, 1, 10].map(visit => record("n", kind, root, visit));
    const similar = record("nn", kind);
    const child = record("n", "agent", childScope(parents[1]!));
    // graphId/runId/key are deliberately not used by the historical prefix predicate.
    child.runId = "different"; child.context = { ...child.context, graphId: "different" };
    check(freeze([child, parents[0]!, similar, parents[1]!, parents[2]!]), [child, parents[0]!, similar, parents[2]!]);
  }
  for (const kind of ["map", "parallel"]) {
    const fan = record("fan", kind);
    const one = record("same", "subworkflow", childScope(fan, "1"));
    const ten = record("same", "subworkflow", childScope(fan, "10"));
    const leaf = record("leaf", "agent", childScope(ten));
    check(freeze([fan, leaf, one, ten]), [leaf, one]);
  }
});

test("wait/retry occupancy matrix retains baseline semantics", () => {
  const cases: { status: ActivationRecord["status"]; kind?: string; metadata: ActivationRecord["metadata"]; occupied: boolean; visible: boolean }[] = [
    { status: "running", kind: "await", metadata: { waiting: true }, occupied: true, visible: false },
    { status: "running", kind: "await", metadata: { waiting: false }, occupied: true, visible: true },
    { status: "running", kind: "await", metadata: {}, occupied: true, visible: true },
    { status: "running", metadata: { waiting: true }, occupied: true, visible: true },
    { status: "running", metadata: { retry: retry("admitted") }, occupied: true, visible: true },
    { status: "failed", metadata: { retry: retry() }, occupied: true, visible: false },
    ...["admitted", "abandoned"].map(status => ({ status: "failed" as const, metadata: { retry: retry(status) }, occupied: false, visible: false })),
    ...[{}, { retry: { status: "scheduled" } }, { retry: { ...retry(), nextAttempt: 3 } },
      { retry: { ...retry(), extra: true } }, { retry: null }].map(metadata => ({ status: "failed" as const, metadata, occupied: false, visible: false })),
    ...["succeeded", "interrupted"].map(status => ({ status: status as ActivationRecord["status"], metadata: { retry: retry() }, occupied: false, visible: false })),
  ];
  for (const kind of kinds) for (const entry of cases) {
    const parent = record("parent", kind), child = record("child", entry.kind, childScope(parent));
    child.status = entry.status; child.metadata = entry.metadata;
    check(freeze([child, parent]), [...(entry.visible ? [child] : []), ...(entry.occupied ? [] : [parent])]);
  }
  const outer = record("outer", "worktree"), inner = record("inner", "map", childScope(outer));
  const wait = record("wait", "await", childScope(inner)); wait.metadata.waiting = true;
  check(freeze([outer, inner, wait]), []);
});

test("index is local to each call, including status and metadata changes", () => {
  const parent = record("parent", "parallel"), child = record("child", "await", childScope(parent));
  const records = [parent, child];
  check(records, [child]);
  child.metadata.waiting = true; check(records, []);
  child.status = "succeeded"; check(records, [parent]);
  child.status = "failed"; child.metadata.retry = retry(); check(records, []);
  child.metadata.retry = retry("abandoned"); check(records, [parent]);
  child.status = "running"; child.metadata.waiting = false; check(records, [child]);
});

function random(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
}
function shuffle<T>(values: readonly T[], seed: number): T[] {
  const result = [...values], next = random(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1)); [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
const seed = 0x892a1364;
function workload(size: number): ActivationRecord[] {
  const records: ActivationRecord[] = [], next = random(seed);
  for (let i = 0; i < size; i++) {
    const parent = record(`container-${i}`, kinds[i % 4]!, root, [0, 1, 10][i % 3]!);
    records.push(parent);
    if (i % 4 !== 0) {
      let ancestor = parent;
      const depth = 1 + Math.floor(next() * 5);
      for (let d = 0; d < depth; d++) {
        const nested = record("nested", kinds[(i + d) % 4]!, childScope(ancestor, i % 2 ? "1" : "10"), d % 3);
        records.push(nested); ancestor = nested;
      }
      const leaf = record("leaf", i % 3 === 0 ? "await" : "check", childScope(ancestor));
      switch (i % 7) {
        case 0: leaf.metadata.waiting = true; break;
        case 1: leaf.status = "failed"; leaf.metadata.retry = retry(); break;
        case 2: leaf.status = "failed"; leaf.metadata.retry = retry("admitted"); break;
        case 3: leaf.status = "failed"; leaf.metadata.retry = retry("abandoned"); break;
        case 4: leaf.status = "succeeded"; break;
        case 5: leaf.status = "interrupted"; break;
      }
      records.push(leaf);
    }
    records.push(record(`unrelated-${i}`, "agent", ["graph", "unrelated"]));
  }
  return records;
}
for (const size of [32, 128, 512]) test(`fixed seed ${seed}: ${size} independent branches`, () => {
  const records = workload(size);
  for (const kind of kinds) assert.ok(records.filter(a => a.kind === kind && a.status === "running").length >= size / 4);
  assert.equal(records.filter(a => a.context.scope[1] === "unrelated").length, size);
  assert.ok(indexedActiveWork(records).some(a => structural.has(a.kind)), "no-child containers remain visible");
  for (const ordered of [records, [...records].reverse(), shuffle(records, seed), shuffle(records, seed + size)]) check(freeze(ordered));
});

// Считаем чтения записей и сегментов, а не время: допускаем до трёх линейных
// проходов (индексация, отбор и дополнительный служебный проход).
// Вставка читает S сегментов scope, запросы — не более P; старый алгоритм
// повторяет чтение записей и префиксов scope для каждого контейнера.
function counted(records: readonly ActivationRecord[]) {
  const counts = { records: 0, scopes: 0 };
  function proxy<T>(values: readonly T[], field: keyof typeof counts): readonly T[] {
    return new Proxy(values, { get(target, key, receiver) {
      if (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key)) counts[field]++;
      return Reflect.get(target, key, receiver);
    } });
  }
  const wrapped = records.map(a => ({ ...a, context: { ...a.context, scope: proxy(a.context.scope, "scopes") } }));
  return { counts, records: proxy(wrapped, "records") };
}
test("operation accounting is O(N + S + P), unlike the frozen records-wide scan", () => {
  for (const size of [32, 128, 512]) {
    // У пустых контейнеров эталонный some() перебирает все записи.
    // Разная глубина учитывает длину scope в оценке O(N + S + P).
    const records: ActivationRecord[] = [];
    for (let i = 0; i < size; i++) {
      let parent = record(`ancestor-${i}`, "subworkflow");
      for (let d = 0; d < i % 8; d++) parent = record("ancestor", "subworkflow", childScope(parent));
      records.push(record(`empty-${i}`, kinds[i % 4]!, childScope(parent)));
      records.push(record(`unrelated-${i}`, "agent", ["graph", "unrelated"]));
    }
    const N = records.length, S = records.reduce((n, a) => n + a.context.scope.length, 0);
    const P = records.filter(a => structural.has(a.kind)).reduce((n, a) => n + a.context.scope.length + 4, 0);
    const indexed = counted(records);
    identities(indexedActiveWork(indexed.records), indexed.records);
    // Проверка идентичности тоже читает proxy: обнуляем счётчики перед замером.
    indexed.counts.records = indexed.counts.scopes = 0;
    indexedActiveWork(indexed.records);
    assert.ok(indexed.counts.records <= 3 * N);
    assert.ok(indexed.counts.scopes <= S + P);
    if (size === 128) {
      const baseline = counted(records); activeWork(baseline.records);
      // Независимый квадратичный эталон нарушает ту же линейную границу.
      assert.ok(baseline.counts.records > 3 * N);
      assert.ok(baseline.counts.scopes > S + P);
    }
  }
});
