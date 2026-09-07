import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { createWorkflowModelRuntime, discoverWorkflowModels } from "../src/model-runtime.js";
import { createXaiSubscriptionProvider } from "../src/xai-provider.js";
import { executePiWorker } from "../src/pi-worker.js";
import type { PiWorkerRequest } from "../src/execution-types.js";
const packageRoot = join(homedir(), ".pi/agent/npm/node_modules/pi-xai-oauth");
const installed = existsSync(join(packageRoot, "package.json"));
async function fixture(t: TestContext, id = "grok-test-entitled") {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-xai-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const cachePath = join(directory, "catalog.json");
  await writeFile(cachePath, JSON.stringify({ schemaVersion: 2, fetchedAt: Date.now(), models: [{ id, name: id, apiBackend: "responses", reasoning: true, thinkingLevelMap: { low: "low", medium: "medium", high: "high" }, input: ["text"], inputProvenance: "authenticated-input-modalities", contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] }));
  const credentials = new InMemoryCredentialStore();
  await credentials.modify("xai-auth", async () => ({ type: "oauth", access: "TEST_ACCESS_NO_SECRET", refresh: "TEST_REFRESH_NO_SECRET", expires: Date.now() + 3_600_000 }));
  const options = { credentials, modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, grok: { agentDirectory: directory, packageRoot, cachePath } };
  return { directory, cachePath, credentials, options, id };
}

test("unsupported adapter package identity/version fails before helper import", async t => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-xai-version-")); t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "unrelated", version: "1.5.2" }));
  await assert.rejects(createXaiSubscriptionProvider({ agentDirectory: directory, packageRoot: directory }), /identity\/version/);
});

test("cache-only authenticated provider lists actual cached IDs without loading transport or touching fetch", { skip: !installed }, async t => {
  const f = await fixture(t);
  const before = globalThis.fetch;
  const runtime = await createWorkflowModelRuntime({ ...f.options, grok: { ...f.options.grok, catalogFetch: async () => { throw new Error("Network must not be called"); } } });
  const provider = runtime.getRegisteredNativeProvider("xai-auth") as Awaited<ReturnType<typeof createXaiSubscriptionProvider>>;
  assert.equal(provider.catalogSource(), "fresh-cache"); assert.equal(provider.transportLoaded(), false);
  assert.deepEqual(runtime.getAvailableSnapshot().filter(m => m.provider === "xai-auth").map(m => m.id), [f.id]);
  assert.equal(globalThis.fetch, before);
  const models = await discoverWorkflowModels(f.options);
  assert.deepEqual(models.filter(m => m.provider === "xai-auth"), [{ provider: "xai-auth", id: f.id, thinkingLevels: ["off", "minimal", "low", "medium", "high"] }]);
});

test("missing authenticated catalog never advertises curated fallback as account entitlement", { skip: !installed }, async t => {
  const f = await fixture(t); await rm(f.cachePath);
  const runtime = await createWorkflowModelRuntime(f.options);
  assert.deepEqual(runtime.getAvailableSnapshot().filter(m => m.provider === "xai-auth"), []);
});

function streamResponse(): Response {
  const response = { id: "resp-test", object: "response", status: "completed", model: "grok-test-entitled", output: [{ type: "function_call", id: "fc-test", call_id: "call-test", name: "submit_result", arguments: '{"answer":42}', status: "completed" }], usage: { input_tokens: 11, output_tokens: 4, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  const events = [
    { type: "response.created", response: { ...response, output: [], status: "in_progress" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc-test", call_id: "call-test", name: "submit_result", arguments: "", status: "in_progress" } },
    { type: "response.function_call_arguments.delta", item_id: "fc-test", output_index: 0, delta: '{"answer":42}' },
    { type: "response.output_item.done", output_index: 0, item: response.output[0] },
    { type: "response.completed", response },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("actual pi 0.85 + installed 1.5.2 transport accepts streamed tool output and records actual reasoning", { skip: !installed, timeout: 20000 }, async t => {
  const f = await fixture(t);
  const runtime = await createWorkflowModelRuntime(f.options);
  const model = runtime.getAvailableSnapshot().find(m => m.provider === "xai-auth")!;
  assert.ok(model);
  const requests: { url: string; payload: any; auth: string | null }[] = [];
  const before = globalThis.fetch;
  const fakeFetch: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), payload: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization") });
    return streamResponse();
  };
  const message = await runtime.streamSimple(model, { messages: [{ role: "user", content: "Submit answer 42", timestamp: 1 }], tools: [{ name: "submit_result", description: "Submit answer", parameters: { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"] } }] }, { reasoning: "high", fetch: fakeFetch }).result();
  assert.equal(message.stopReason, "toolUse", message.errorMessage);
  assert.equal(message.providerThinkingLevel, "high");
  assert.deepEqual(message.content.filter(part => part.type === "toolCall").map(part => part.arguments), [{ answer: 42 }]);
  assert.equal(message.usage.input, 11); assert.equal(message.usage.output, 4);
  assert.equal(requests.length, 1);
  assert.match(requests[0]!.url, /^https:\/\/cli-chat-proxy\.grok\.com\/v1\/responses/);
  assert.equal(requests[0]!.payload.reasoning.effort, "high");
  assert.equal(requests[0]!.auth, "Bearer TEST_ACCESS_NO_SECRET");
  assert.equal(globalThis.fetch, before);
});

test("actual worker submits result through the bridged transport and keeps output/auth separated", { skip: !installed, timeout: 20000 }, async t => {
  const f = await fixture(t);
  const runtime = await createWorkflowModelRuntime(f.options);
  const provider = runtime.getRegisteredNativeProvider("xai-auth")!;
  const stream = provider.streamSimple.bind(provider);
  let calls = 0;
  provider.streamSimple = (model, context, options) => stream(model, context, { ...options, fetch: async () => { calls++; return streamResponse(); } });
  const events: unknown[] = [];
  const request: PiWorkerRequest = { version: 1, cwd: f.directory, resourceDirectory: join(f.directory, "resources"), sessionDirectory: join(f.directory, "sessions"), task: "Submit answer 42", input: {}, config: { model: { provider: "xai-auth", id: f.id }, thinking: "high", tools: [], systemPrompt: "Solve the task.", skills: [], session: "fresh", permission: "read-only", outputSchema: { type: "object", additionalProperties: false, properties: { answer: { type: "integer" } }, required: ["answer"] } } };
  const result = await executePiWorker(request, { modelRuntime: runtime, onEvent: event => events.push(event) });
  assert.deepEqual(result.output, { answer: 42 }); assert.equal(calls, 1);
  assert.deepEqual(result.model, request.config.model); assert.equal(result.thinking, "high");
  assert.doesNotMatch(JSON.stringify({ result, events }), /TEST_ACCESS|TEST_REFRESH/);
});

test("transport restores fetch and scrubs arbitrary credential-bearing failures", { skip: !installed }, async t => {
  const f = await fixture(t); const runtime = await createWorkflowModelRuntime(f.options);
  const before = globalThis.fetch;
  const model = runtime.getAvailableSnapshot().find(m => m.provider === "xai-auth")!;
  const message = await runtime.streamSimple(model, { messages: [{ role: "user", content: "Failure test", timestamp: 1 }] }, { fetch: async () => { throw new Error("request bearer TEST_ACCESS_NO_SECRET and TEST_REFRESH_NO_SECRET failed"); } }).result();
  assert.equal(message.stopReason, "error");
  assert.doesNotMatch(message.errorMessage ?? "", /TEST_ACCESS|TEST_REFRESH/);
  assert.equal(globalThis.fetch, before);
});

test("provider instances keep account catalogs separate and refuse uncatalogued models", { skip: !installed }, async t => {
  const first = await fixture(t, "grok-account-one"); const second = await fixture(t, "grok-account-two");
  const a = await createWorkflowModelRuntime(first.options), b = await createWorkflowModelRuntime(second.options);
  assert.deepEqual(a.getAvailableSnapshot().filter(m => m.provider === "xai-auth").map(m => m.id), [first.id]);
  assert.deepEqual(b.getAvailableSnapshot().filter(m => m.provider === "xai-auth").map(m => m.id), [second.id]);
  const wrong = b.getAvailableSnapshot().find(m => m.provider === "xai-auth")!;
  let calls = 0;
  const result = await a.getRegisteredNativeProvider("xai-auth")!.streamSimple(wrong, { messages: [] }, { fetch: async () => { calls++; return streamResponse(); } }).result();
  assert.equal(result.stopReason, "error"); assert.equal(calls, 0); assert.match(result.errorMessage ?? "", /authenticated catalog/);
});

test("concurrent provider instances serialize legacy global fetch guards and restore original fetch", { skip: !installed, timeout: 20000 }, async t => {
  const first = await fixture(t, "grok-account-one"), second = await fixture(t, "grok-account-two");
  const a = await createWorkflowModelRuntime(first.options), b = await createWorkflowModelRuntime(second.options);
  const before = globalThis.fetch;
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let secondEntered = false;
  const context = { messages: [{ role: "user" as const, content: "Submit result", timestamp: 1 }] };
  const one = a.streamSimple(a.getAvailableSnapshot().find(m => m.provider === "xai-auth")!, context, { fetch: async () => { entered(); await held; return streamResponse(); } }).result();
  await started;
  const two = b.streamSimple(b.getAvailableSnapshot().find(m => m.provider === "xai-auth")!, context, { fetch: async () => { secondEntered = true; return streamResponse(); } }).result();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(secondEntered, false);
  release();
  const outcomes = await Promise.all([one, two]);
  assert.ok(outcomes.every(m => m.stopReason !== "error"), outcomes.map(m => m.errorMessage).join(";"));
  assert.equal(secondEntered, true); assert.equal(globalThis.fetch, before);
});

test("missing optional Grok adapter preserves native Codex discovery but explicit Grok reports safe failure", async t => {
  const f = await fixture(t);
  await f.credentials.modify("openai-codex", async () => ({ type: "oauth", access: "FAKE_CODEX_ACCESS", refresh: "FAKE_CODEX_REFRESH", expires: Date.now() + 3_600_000 }));
  const options = { ...f.options, refreshOnCreate: true, grok: { ...f.options.grok, packageRoot: join(f.directory, "absent-adapter") } };
  const { discoverWorkflowCatalog } = await import("../src/model-runtime.js");
  const catalog = await discoverWorkflowCatalog(options);
  assert.equal(catalog.issues.length, 1); assert.match(catalog.issues[0]!, /missing or unreadable/);
  assert.ok(catalog.models.some(model => model.provider === "openai-codex"));
  assert.ok(catalog.models.every(model => model.provider !== "xai-auth"));
  await assert.rejects(createWorkflowModelRuntime({ ...options, requiredProvider: "xai-auth" }), /missing or unreadable/);
  assert.ok(await createWorkflowModelRuntime({ ...options, requiredProvider: "openai-codex" }));
});

test("queued transport cancellation settles before the unrelated current stream", { skip: !installed, timeout: 20000 }, async t => {
  const f = await fixture(t); const runtime = await createWorkflowModelRuntime(f.options);
  const model = runtime.getAvailableSnapshot().find(m => m.provider === "xai-auth")!;
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const context = { messages: [{ role: "user" as const, content: "Submit result", timestamp: 1 }] };
  const first = runtime.streamSimple(model, context, { fetch: async () => { entered(); await held; return streamResponse(); } }).result();
  await started;
  const controller = new AbortController(); let calls = 0;
  const second = runtime.streamSimple(model, context, { signal: controller.signal, fetch: async () => { calls++; return streamResponse(); } }).result();
  controller.abort();
  try {
    const result = await second;
    assert.ok(result.stopReason === "error" || result.stopReason === "aborted"); assert.equal(calls, 0);
  } finally { release(); await first; }
});
