import assert from "node:assert/strict";
import test from "node:test";
import {
  accountedRssBytes,
  assertGlobalSdkStatePreserved,
  COMPARISON_SIZES,
  FAKE_INFERENCE_LIMITATION,
  INSPECTED_GLOBAL_SDK_CLAIM,
  requireSdkApis,
  requireSuccessfulTurn,
  runAbortPeerCheck,
  runComparison,
  runDisposeReuseCheck,
  runErrorPeerCheck,
  runIsolationCheck,
  snapshotGlobalSdkState,
  TIMING_SCOPE,
} from "../spikes/session-pool-benchmark.js";

test("required createAgentSession APIs are present and are not skipped", () => {
  requireSdkApis();
});

test("inspected global SDK identities do not claim hidden stream isolation", () => {
  assert.match(INSPECTED_GLOBAL_SDK_CLAIM, /Hidden default stream closure state is unobserved/);
  assert.match(INSPECTED_GLOBAL_SDK_CLAIM, /not claimed unchanged or isolated/);
});

test("in-process sessions isolate prompt, history and cwd", { timeout: 20_000 }, async () => {
  const before = snapshotGlobalSdkState();
  const result = await runIsolationCheck();
  assert.equal(result.ok, true);
  assert.notEqual(result.sessionIds[0], result.sessionIds[1]);
  assert.notEqual(result.cwds[0], result.cwds[1]);
  assert.equal(result.assistants[0].stopReason, "stop");
  assert.equal(result.assistants[1].stopReason, "stop");
  assert.match(result.assistants[0].text, /offline-echo:a/);
  assert.match(result.assistants[1].text, /offline-echo:b/);
  assertGlobalSdkStatePreserved(before);
});

test("abort one pending session while the peer is still pending", { timeout: 20_000 }, async () => {
  const result = await runAbortPeerCheck();
  assert.equal(result.peerCompleted, true);
  assert.equal(result.abortedSettled, true);
  assert.equal(result.abortedWhilePeerPending, true);
  assert.equal(result.peerAssistant.stopReason, "stop");
  assert.match(result.peerAssistant.text, /offline-echo:peer/);
});

test("error in one session while the peer completes", { timeout: 20_000 }, async () => {
  const result = await runErrorPeerCheck();
  assert.equal(result.peerCompleted, true);
  assert.equal(result.errorObserved, true);
  assert.equal(result.peerAssistant.stopReason, "stop");
  assert.match(result.peerAssistant.text, /offline-echo:peer/);
  assert.equal(result.errorAssistant.stopReason, "error");
  assert.equal(result.injectedErrorCountsAsSuccess, false);
  assert.equal(result.errorSessionIdle, true);
  assert.equal(result.errorUserMessagePresent, true);
  assert.throws(
    () => requireSuccessfulTurn(result.errorAssistant, "offline-echo:peer"),
    /cannot count as success/,
  );
});

test("dispose one session and reuse the peer", { timeout: 20_000 }, async () => {
  const result = await runDisposeReuseCheck();
  assert.equal(result.peerCompleted, true);
  assert.equal(result.keepAssistant.stopReason, "stop");
  assert.match(result.keepAssistant.text, /offline-echo:peer-keep/);
  assert.equal(result.peerAssistant.stopReason, "stop");
  assert.match(result.peerAssistant.text, /offline-echo:peer-reuse/);
});

test("in-process comparison reports distributions for N=1,4,8,16", { timeout: 120_000 }, async () => {
  const report = await runComparison({ sizes: [...COMPARISON_SIZES], includeChildProcess: false });
  assert.equal(report.limitation, FAKE_INFERENCE_LIMITATION);
  assert.deepEqual(report.timingScope, TIMING_SCOPE);
  assert.match(report.timingScope.startupMs, /excludes ModelRuntime/);
  assert.match(report.timingScope.poolReadyMs, /spawn, import, hello/);
  assert.deepEqual(report.sizes, [1, 4, 8, 16]);
  assert.equal(report.results.length, 4);
  for (const [index, n] of COMPARISON_SIZES.entries()) {
    const result = report.results[index];
    assert.ok(result);
    assert.equal(result.mode, "in-process");
    assert.equal(result.n, n);
    assert.equal(result.constructionMs.n, n);
    assert.equal(result.startupMs.n, n);
    assert.equal(typeof result.poolReadyMs, "number");
    assert.ok(Number.isFinite(result.poolReadyMs));
    assert.ok(result.poolReadyMs >= 0);
    assert.equal(result.rss.childCount, 0);
    assert.equal(result.rss.childrenRssBytes, 0);
    assert.equal(result.rss.accountedRssBytes, result.rss.parentRssBytes);
    assert.equal(result.rss.includesParentChildDoubleCount, false);
    assert.ok(result.rss.parentRssBytes > 0);
    assert.ok(result.constructionMs.min <= result.constructionMs.max);
    assert.ok(result.startupMs.min <= result.startupMs.max);
  }
});

test("child-process RSS is parent plus owned children without double counting", { timeout: 60_000 }, async () => {
  const report = await runComparison({ sizes: [1], includeChildProcess: true });
  const child = report.results.find((result) => result.mode === "child-process");
  const inProcess = report.results.find((result) => result.mode === "in-process");
  assert.ok(child);
  assert.ok(inProcess);
  assert.equal(child.n, 1);
  assert.equal(child.rss.childCount, 1);
  assert.equal(child.rss.accountedRssBytes, child.rss.parentRssBytes + child.rss.childrenRssBytes);
  assert.ok(child.rss.childrenRssBytes > 0);
  assert.ok(child.rss.parentRssBytes > 0);
  assert.notEqual(child.rss.accountedRssBytes, child.rss.parentRssBytes);
  assert.equal(child.rss.includesParentChildDoubleCount, false);
  assert.equal(typeof child.poolReadyMs, "number");
  assert.ok(Number.isFinite(child.poolReadyMs));
  assert.ok(child.poolReadyMs >= 0);
  assert.match(report.timingScope.poolReadyMs, /spawn, import, hello/);
  assert.deepEqual(
    accountedRssBytes(child.rss.parentRssBytes, [child.rss.childrenRssBytes]),
    {
      parentRssBytes: child.rss.parentRssBytes,
      childrenRssBytes: child.rss.childrenRssBytes,
      childCount: 1,
      accountedRssBytes: child.rss.accountedRssBytes,
      includesParentChildDoubleCount: false,
    },
  );
});


test("success evidence must match the exact session echo, not another session prefix", () => {
  assert.throws(
    () => requireSuccessfulTurn({ stopReason: "stop", text: "offline-echo:s10" }, "offline-echo:s1"),
    /echo mismatch/,
  );
  assert.equal(requireSuccessfulTurn({ stopReason: "stop", text: "offline-echo:s1" }, "offline-echo:s1").text, "offline-echo:s1");
});
