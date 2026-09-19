import assert from "node:assert/strict";
import test from "node:test";
import {
  accountedRssBytes,
  FAKE_INFERENCE_LIMITATION,
  requireSdkApis,
  requireSuccessfulTurn,
  summarize,
} from "./session-pool-benchmark.js";

test("required SDK APIs are asserted instead of skipped", () => {
  requireSdkApis();
});

test("summarize rejects empty samples instead of skipping", () => {
  assert.throws(() => summarize([]), /empty/);
  const distribution = summarize([4, 1, 3, 2]);
  assert.equal(distribution.n, 4);
  assert.equal(distribution.min, 1);
  assert.equal(distribution.max, 4);
  assert.equal(distribution.mean, 2.5);
  assert.ok(distribution.p50 >= distribution.min);
  assert.ok(distribution.p90 <= distribution.max);
});

test("RSS accounting adds parent and owned children once", () => {
  assert.throws(() => accountedRssBytes(-1, []), /non-negative/);
  const rss = accountedRssBytes(1000, [200, 300]);
  assert.equal(rss.parentRssBytes, 1000);
  assert.equal(rss.childrenRssBytes, 500);
  assert.equal(rss.childCount, 2);
  assert.equal(rss.accountedRssBytes, 1500);
  assert.equal(rss.includesParentChildDoubleCount, false);
  assert.notEqual(rss.accountedRssBytes, rss.parentRssBytes);
  assert.notEqual(rss.accountedRssBytes, 1000 + 1000 + 500);
});

test("fake inference limitation is explicit", () => {
  assert.match(FAKE_INFERENCE_LIMITATION, /not Grok throughput/);
});

test("injected error turn cannot count as success", () => {
  assert.throws(
    () => requireSuccessfulTurn({ stopReason: "error", text: "", errorMessage: "offline-injected-error" }, "offline-echo:peer"),
    /cannot count as success/,
  );
  const ok = requireSuccessfulTurn({ stopReason: "stop", text: "offline-echo:peer" }, "offline-echo:peer");
  assert.equal(ok.stopReason, "stop");
  assert.equal(ok.text, "offline-echo:peer");
});
