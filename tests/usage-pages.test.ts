import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Browser module is checked separately with checkJs.
import { UsagePages } from "../src/graph-view/usage-pages.js";

test("usage browsing survives redraw/run switches, in-flight updates and retry without duplicate rows", async () => {
  const pages = new UsagePages();
  let release!: (value: unknown) => void;
  let calls = 0;
  const request = pages.load("first", () => { calls++; return new Promise(resolve => { release = resolve; }); });
  const original = pages.get("first");
  assert.equal(original.loading, true);
  await pages.load("first", () => { calls++; throw new Error("must not fetch twice"); });
  pages.get("second"); // Switching runs while a response is in flight.
  release({ reports: [{ seq: 10, reportId: "1" }], nextAfter: 10, hasMore: true });
  await request;
  assert.equal(calls, 1);
  assert.equal(pages.get("first"), original); // Snapshot renderer can read the same durable state.
  assert.equal(original.reports.length, 1);
  assert.equal(pages.get("second").reports.length, 0);
  await pages.load("first", (_id: string, cursor: number) => {
    assert.equal(cursor, 10); throw new Error("connection interrupted");
  });
  assert.equal(original.cursor, 10); assert.equal(original.reports.length, 1);
  assert.equal(original.error, "connection interrupted"); assert.equal(original.loading, false);
  await pages.load("first", async (_id: string, cursor: number) => {
    assert.equal(cursor, 10); return { reports: [{ seq: 12, reportId: "2" }], nextAfter: 12, hasMore: false };
  });
  assert.deepEqual(original.reports.map((r: { seq: number }) => r.seq), [10, 12]);
  assert.equal(original.error, null); assert.equal(original.cursor, 12);
});
