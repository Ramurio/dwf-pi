import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, InMemoryCredentialStore, InMemoryModelsStore, type AssistantMessage, type Context, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { executePiWorker, type PiWorkerOptions } from "../src/pi-worker.js";
import type { PiWorkerRequest } from "../src/execution-types.js";
import { ExecutionFailure } from "../src/execution-failure.js";

const provider = "dynamicwf-campaign-errors";
const modelId = "offline-scripted";
const secret = "TEST_CREDENTIAL_MUST_NOT_LEAK";
const promptMarker = "PROMPT_CONTENTS_MUST_NOT_LEAK";
function reply(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return { role: "assistant", content, stopReason, provider, model: modelId, api: "openai-completions", timestamp: 1,
    usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
const submit = (args: Record<string, unknown> = { answer: 42 }) => reply([{ type: "toolCall", id: "result", name: "submit_result", arguments: args }], "toolUse");
type Step = (context: Context, options?: SimpleStreamOptions) => AssistantMessage | Promise<AssistantMessage>;
function gate() { let resolve!: () => void; const promise = new Promise<void>(res => { resolve = res; }); return { promise, resolve }; }
async function rejectFailure(request: PiWorkerRequest, options: PiWorkerOptions) {
  let failure: ExecutionFailure["failure"] | undefined;
  await assert.rejects(executePiWorker(request, options), (error: unknown) => {
    assert.ok(error instanceof ExecutionFailure); failure = error.failure; return true;
  });
  return failure!;
}
async function fixture(t: TestContext, steps: Step[]) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-campaign-errors-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const cwd = join(directory, "workspace");
  await mkdir(cwd);
  const request: PiWorkerRequest = { version: 1, config: { model: { provider, id: modelId }, thinking: "off", systemPrompt: "FROZEN_PROMPT", tools: [], skills: [], session: "fresh", permission: "read-only", outputSchema: { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"], additionalProperties: false } }, task: promptMarker, input: { request: 1 }, cwd, sessionDirectory: join(directory, "sessions"), resourceDirectory: join(directory, "resources") };
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const calls: Context[] = [];
  runtime.registerProvider(provider, { api: "openai-completions", baseUrl: "https://offline.invalid", apiKey: "OFFLINE_KEY", models: [{ id: modelId, name: modelId, reasoning: false, input: ["text"], contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }], streamSimple(_model, context, options) {
    const stream = createAssistantMessageEventStream(); const index = calls.length;
    calls.push({ ...context, messages: structuredClone(context.messages), ...(context.tools ? { tools: context.tools.map(({ name, description, parameters }) => ({ name, description, parameters })) } : {}) });
    void (async () => {
      let result: AssistantMessage;
      try { assert.ok(steps[index], `Unexpected model call ${index}`); result = await steps[index](context, options); }
      catch (error) { result = { ...reply([], "error"), errorMessage: String(error) }; }
      if (result.stopReason === "error" || result.stopReason === "aborted") stream.push({ type: "error", reason: result.stopReason, error: result });
      else if (result.stopReason !== "pending") { stream.push({ type: "start", partial: result }); stream.push({ type: "done", reason: result.stopReason, message: result }); }
    })(); return stream;
  } });
  const events: unknown[] = [];
  const options: PiWorkerOptions = { modelRuntime: runtime, onEvent: event => events.push(event) };
  return { directory, request, calls, options, events };
}
function assertPrivate(failure: ExecutionFailure["failure"]) {
  assert.doesNotMatch(JSON.stringify(failure), new RegExp(`${secret}|${promptMarker}|OFFLINE_KEY|Bearer|sk-secret`, "i"));
}

test("safe SDK finish_reason is preserved on provider error without inventing HTTP status", async t => {
  const f = await fixture(t, [() => ({ ...reply([], "error"), errorMessage: "Provider finish_reason: content_filter" })]);
  const failure = await rejectFailure(f.request, f.options);
  assert.equal(failure.code, "provider");
  assert.equal(failure.phase, "execution");
  assert.equal(failure.effects, "read-only");
  assert.equal(failure.message, "Pi assistant turn failed: Provider finish_reason: content_filter");
  assert.equal(failure.providerResponse, undefined);
  assert.doesNotMatch(failure.message, /aborted|401|429/);
  assertPrivate(failure);
});

test("allowlisted provider code survives JSON SDK text while bodies, prompts and status guesses do not", async t => {
  const f = await fixture(t, [() => ({ ...reply([], "error"), errorMessage: `OpenAI API error (401): ${JSON.stringify({ message: `${secret} ${promptMarker}`, type: "insufficient_quota", code: "insufficient_quota", headers: { authorization: secret } })}` })]);
  const failure = await rejectFailure(f.request, f.options);
  assert.equal(failure.code, "provider");
  assert.equal(failure.message, "Pi assistant turn failed: insufficient_quota");
  assert.equal(failure.providerResponse, undefined);
  assert.doesNotMatch(failure.message, /401|aborted|authorization/i);
  assertPrivate(failure);
});

test("unsafe SDK errorMessage stays the generic error fallback", async t => {
  const f = await fixture(t, [() => ({ ...reply([], "error"), errorMessage: `401 network temporary ${secret} ${promptMarker} https://example.invalid Bearer sk-secret {\"prompt\":\"${promptMarker}\"}` })]);
  const failure = await rejectFailure(f.request, f.options);
  assert.equal(failure.code, "provider");
  assert.equal(failure.message, "Pi assistant turn failed");
  assert.equal(failure.providerResponse, undefined);
  assert.doesNotMatch(JSON.stringify(failure), /401|temporary|example\.invalid/);
  assertPrivate(failure);
});

test("SDK abort without user cancellation is a provider abort, not cancelled", async t => {
  const f = await fixture(t, [() => ({ ...reply([], "aborted"), errorMessage: `Request was aborted ${secret}` })]);
  const failure = await rejectFailure(f.request, f.options);
  assert.equal(failure.code, "provider");
  assert.equal(failure.message, "Pi assistant turn was aborted");
  assert.equal(failure.providerResponse, undefined);
  assert.notEqual(failure.diagnostic?.dispatch, "not-dispatched");
  assertPrivate(failure);
});

test("user AbortSignal stays cancelled and does not publish SDK abort text", { timeout: 10_000 }, async t => {
  const started = gate(), controller = new AbortController();
  const f = await fixture(t, [async (_context, options) => {
    started.resolve();
    if (!options?.signal?.aborted) await new Promise<void>(resolve => options!.signal!.addEventListener("abort", () => resolve(), { once: true }));
    return { ...reply([], "aborted"), errorMessage: `Request was aborted ${secret} ${promptMarker}` };
  }]);
  const running = executePiWorker(f.request, { ...f.options, signal: controller.signal }).then(value => ({ value }), error => ({ error }));
  try {
    await started.promise; controller.abort();
    const result = await running;
    assert.ok("error" in result && result.error instanceof ExecutionFailure);
    assert.equal(result.error.failure.code, "cancelled");
    assert.equal(result.error.failure.message, "Pi worker cancelled");
    assertPrivate(result.error.failure);
  } finally { controller.abort(); await running; }
});

test("mixed error and aborted turns keep the generic fallback", async t => {
  const f = await fixture(t, [() => submit()]);
  const failure = await rejectFailure(f.request, { ...f.options, onSession(session) {
    session.agent.subscribe(event => {
      if (event.type === "agent_end") {
        session.agent.state.messages.push({ ...reply([], "error"), errorMessage: "Provider finish_reason: content_filter" });
        session.agent.state.messages.push({ ...reply([], "aborted"), errorMessage: "Request was aborted" });
      }
    });
  } });
  assert.equal(failure.code, "provider");
  assert.equal(failure.message, "Pi assistant turn failed or was aborted");
  assert.doesNotMatch(failure.message, /content_filter/);
});

test("observed HTTP status stays independent of SDK error text and response bodies", { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-campaign-errors-http-"));
  try {
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
    runtime.registerProvider("offline-http", { api: "openai-responses", baseUrl: "https://offline.invalid/v1", apiKey: "offline", models: [{ id: "offline-model", name: "Offline", reasoning: false, input: ["text"], contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
    const request: PiWorkerRequest = { version: 1, cwd: directory, resourceDirectory: join(directory, "resources"), sessionDirectory: join(directory, "sessions"), task: promptMarker, input: null, config: { model: { provider: "offline-http", id: "offline-model" }, thinking: "off", tools: [], systemPrompt: "Use submit_result.", skills: [], session: "fresh", permission: "read-only", outputSchema: { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"], additionalProperties: false } } };
    const failure = await rejectFailure(request, { modelRuntime: runtime, providerFetch: async () => new Response(JSON.stringify({ error: { message: `401 ${secret}`, type: "insufficient_quota", code: "insufficient_quota" } }), { status: 503, headers: { "retry-after": "2", authorization: secret } }) });
    assert.equal(failure.code, "provider");
    assert.deepEqual(failure.providerResponse, { status: 503, retryAfterMs: 2000 });
    assert.equal(failure.diagnostic?.dispatch, "http-observed");
    assert.match(failure.message, /^Pi assistant turn failed/);
    assert.doesNotMatch(failure.message, /aborted|401|503/);
    assertPrivate(failure);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("unknown finish_reason identifiers fall back without echo", async t => {
  const f = await fixture(t, [() => ({ ...reply([], "error"), errorMessage: "Provider finish_reason: PRIVATE_CUSTOMER_NAME" })]);
  const failure = await rejectFailure(f.request, f.options);
  assert.equal(failure.code, "provider");
  assert.equal(failure.message, "Pi assistant turn failed");
  assert.equal(failure.providerResponse, undefined);
  assert.doesNotMatch(JSON.stringify(failure), /PRIVATE_CUSTOMER_NAME/);
  assertPrivate(failure);
});

test("exact SDK terminated reason is preserved while observed HTTP 200 stays independent", async t => {
  const f = await fixture(t, [async (_context, options) => {
    const fetchImpl = options?.fetch;
    assert.ok(fetchImpl);
    await fetchImpl("https://offline.invalid/v1/chat/completions", { method: "POST", body: "{}" });
    return { ...reply([], "error"), errorMessage: "terminated" };
  }]);
  const failure = await rejectFailure(f.request, { ...f.options, providerFetch: async () => new Response(JSON.stringify({ error: { message: secret } }), { status: 200, headers: { authorization: secret } }) });
  assert.equal(failure.code, "provider");
  assert.equal(failure.phase, "execution");
  assert.equal(failure.message, "Pi assistant turn failed: terminated");
  assert.deepEqual(failure.providerResponse, { status: 200 });
  assert.equal(failure.diagnostic?.dispatch, "http-observed");
  assert.doesNotMatch(failure.message, /200|aborted|HTTP/);
  assertPrivate(failure);
});

test("exact fetch failed transport text is preserved without inventing HTTP status", async t => {
  const f = await fixture(t, [() => ({ ...reply([], "error"), errorMessage: "fetch failed" })]);
  const failure = await rejectFailure(f.request, f.options);
  assert.equal(failure.code, "provider");
  assert.equal(failure.message, "Pi assistant turn failed: fetch failed");
  assert.equal(failure.providerResponse, undefined);
  assert.doesNotMatch(failure.message, /200|401|503|aborted/);
  assertPrivate(failure);
});
