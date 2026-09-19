import { ExecutionFailure } from "../src/execution-failure.js";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createAssistantMessageEventStream, InMemoryCredentialStore, InMemoryModelsStore, type AssistantMessage, type OAuthCredentials } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { executePiWorker, type PiWorkerOptions } from "../src/pi-worker.js";
import type { PiWorkerRequest } from "../src/execution-types.js";

const provider = "dwf-oauth-test";
const modelId = "offline-oauth";
const accessSecret = "A0_TEST_ACCESS_NO_SECRET";
const refreshSecret = "RT0_TEST_REFRESH_NO_SECRET";
const fixtureDetail = "invalid_grant FIXTURE";
const closedAuthMessage = "Provider authentication failed before a request was sent; re-authenticate with local pi. Stored credentials were not replaced.";

async function fixture(t: TestContext, refreshToken: (credentials: OAuthCredentials) => Promise<OAuthCredentials>) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-wave5-c04-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const cwd = join(directory, "workspace");
  await mkdir(cwd);
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(provider, async () => ({ type: "oauth", access: accessSecret, refresh: refreshSecret, expires: Date.now() - 1000 }));
  const runtime = await ModelRuntime.create({ credentials, modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  let streamCalls = 0;
  let refreshCalls = 0;
  runtime.registerProvider(provider, {
    name: "fixture",
    api: "openai-completions",
    baseUrl: "https://offline.invalid",
    apiKey: "SNAPSHOT_ONLY_NOT_USED_FOR_OAUTH",
    oauth: {
      name: "fixture",
      login: async () => { throw new Error("no login"); },
      async refreshToken(credentials) {
        refreshCalls++;
        return refreshToken(credentials);
      },
      getApiKey: credentials => credentials.access,
    },
    models: [{ id: modelId, name: modelId, reasoning: false, input: ["text"], contextWindow: 1000, maxTokens: 16, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple() {
      streamCalls++;
      const stream = createAssistantMessageEventStream();
      void (async () => {
        const message: AssistantMessage = {
          role: "assistant",
          content: [{ type: "toolCall", id: "result", name: "submit_result", arguments: { answer: 42 } }],
          stopReason: "toolUse",
          provider, model: modelId, api: "openai-completions", timestamp: 1,
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        };
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: "toolUse", message });
      })();
      return stream;
    },
  });
  assert.ok(runtime.getAvailableSnapshot().some(model => model.provider === provider && model.id === modelId));
  const request: PiWorkerRequest = {
    version: 1,
    config: {
      model: { provider, id: modelId }, thinking: "off", systemPrompt: "FROZEN_PROMPT", tools: [], skills: [],
      session: "fresh", permission: "read-only",
      outputSchema: { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"], additionalProperties: false },
    },
    task: "TASK_MARKER", input: { request: 1 }, cwd,
    sessionDirectory: join(directory, "sessions"), resourceDirectory: join(directory, "resources"),
  };
  const events: unknown[] = [];
  const options: PiWorkerOptions = { modelRuntime: runtime, onEvent: event => events.push(event) };
  return { credentials, request, options, events, streamCalls: () => streamCalls, refreshCalls: () => refreshCalls };
}

function assertNoSecrets(value: unknown) {
  assert.doesNotMatch(JSON.stringify(value), /FIXTURE|RT0_TEST|A0_TEST|invalid_grant|SNAPSHOT_ONLY|TASK_MARKER|TEST_ACCESS|TEST_REFRESH/);
}

test("OAuth refresh failure is a closed setup provider failure before any model request", async t => {
  const f = await fixture(t, async () => { throw new Error(`${fixtureDetail} ${refreshSecret}`); });
  let failure: ExecutionFailure["failure"] | undefined;
  await assert.rejects(executePiWorker(f.request, f.options), (error: unknown) => {
    assert.ok(error instanceof ExecutionFailure);
    failure = error.failure;
    return true;
  });
  assert.equal(failure!.code, "provider");
  assert.equal(failure!.phase, "setup");
  assert.equal(failure!.effects, "not-started");
  assert.equal(failure!.message, closedAuthMessage);
  assert.deepEqual(failure!.diagnostic, { dispatch: "not-dispatched" });
  assert.equal(failure!.providerResponse, undefined);
  assert.equal(f.streamCalls(), 0);
  assert.equal(f.refreshCalls(), 1);
  const stored = await f.credentials.read(provider);
  assert.equal(stored?.type, "oauth");
  assert.equal(stored && stored.type === "oauth" ? stored.refresh : undefined, refreshSecret);
  assert.equal(stored && stored.type === "oauth" ? stored.access : undefined, accessSecret);
  assertNoSecrets({ failure, events: f.events });
});

test("successful OAuth refresh still admits the worker without leaking tokens", async t => {
  const f = await fixture(t, async credentials => {
    assert.equal(credentials.refresh, refreshSecret);
    return { access: "A1_ROTATED", refresh: "RT1_ROTATED", expires: Date.now() + 3_600_000 };
  });
  const result = await executePiWorker(f.request, f.options);
  assert.deepEqual(result.output, { answer: 42 });
  assert.equal(f.streamCalls(), 1);
  assert.equal(f.refreshCalls(), 1);
  const stored = await f.credentials.read(provider);
  assert.equal(stored && stored.type === "oauth" ? stored.refresh : undefined, "RT1_ROTATED");
  assert.doesNotMatch(JSON.stringify(result), /ROTATED|TEST_/);
  assertNoSecrets({ output: result.output, events: f.events });
});

test("cancellation during OAuth refresh remains cancellation and does not admit a model turn", async t => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(t, async () => { entered(); await gate; throw new Error(refreshSecret); });
  const controller = new AbortController();
  const running = executePiWorker(f.request, { ...f.options, signal: controller.signal });
  const checked = assert.rejects(running, (error: unknown) => {
    assert.ok(error instanceof ExecutionFailure);
    assert.equal(error.failure.code, "cancelled");
    assert.equal(error.failure.phase, "setup");
    assert.equal(error.failure.effects, "not-started");
    assertNoSecrets(error.failure);
    return true;
  });
  await started;
  controller.abort(); release();
  await checked;
  assert.equal(f.streamCalls(), 0);
});
