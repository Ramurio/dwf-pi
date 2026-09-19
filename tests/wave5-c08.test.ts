import { ExecutionFailure } from "../src/execution-failure.js";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createAssistantMessageEventStream, InMemoryCredentialStore, InMemoryModelsStore, type AssistantMessage, type Context, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { executePiWorker, type PiWorkerOptions } from "../src/pi-worker.js";
import type { PiWorkerRequest } from "../src/execution-types.js";

const provider = "dynamicwf-c08";
const modelId = "offline-scripted";
const zeros: AssistantMessage["usage"] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const known: AssistantMessage["usage"] = { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function reply(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"], usage = known): AssistantMessage {
  return { role: "assistant", content, stopReason, provider, model: modelId, api: "openai-completions", timestamp: 1, usage };
}
function gate() { let resolve!: () => void; const promise = new Promise<void>(res => { resolve = res; }); return { promise, resolve }; }
function zeroReports(events: unknown[]) {
  return (events as any[]).filter(event => event.type === "usage.report" && event.usage?.input === 0 && event.usage?.output === 0 && event.usage?.totalTokens === 0 && (event.usage.cacheRead ?? 0) === 0 && (event.usage.cacheWrite ?? 0) === 0 && (event.usage.reasoning ?? 0) === 0 && (event.stopReason === "aborted" || event.stopReason === "error"));
}
type Step = (context: Context, options?: SimpleStreamOptions) => AssistantMessage | Promise<AssistantMessage>;
async function scripted(t: TestContext, steps: Step[]) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-c08-scripted-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const cwd = join(directory, "workspace");
  await mkdir(cwd);
  const request: PiWorkerRequest = { version: 1, config: { model: { provider, id: modelId }, thinking: "off", systemPrompt: "FROZEN_PROMPT", tools: [], skills: [], session: "fresh", permission: "read-only", outputSchema: { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"], additionalProperties: false } }, task: "TASK", input: null, cwd, sessionDirectory: join(directory, "sessions"), resourceDirectory: join(directory, "resources") };
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const calls: Context[] = [];
  runtime.registerProvider(provider, { api: "openai-completions", baseUrl: "https://offline.invalid", apiKey: "OFFLINE_KEY", models: [{ id: modelId, name: modelId, reasoning: false, input: ["text"], contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }], streamSimple(_model, context, options) {
    const stream = createAssistantMessageEventStream(); const index = calls.length;
    calls.push(context);
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
  return { request, options, events, calls };
}
function encodeSse(events: object[]): string {
  return events.map((event: any) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
}
function incompleteReasoningSse(model = "offline-model"): Response {
  return new Response(encodeSse([
    { type: "response.created", response: { id: "resp-incomplete", object: "response", status: "in_progress", model, output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: "rs-incomplete", summary: [] } },
    { type: "response.reasoning_summary_text.delta", item_id: "rs-incomplete", output_index: 0, delta: "partial-think" },
  ]), { status: 200, headers: { "content-type": "text/event-stream" } });
}
function grokSse(name: string, args: Record<string, unknown>, model = "offline-model"): Response {
  const callId = `call-${name}-${JSON.stringify(args).length}`;
  const argumentsJson = JSON.stringify(args);
  const item = { type: "function_call", id: `fc-${callId}`, call_id: callId, name, arguments: argumentsJson, status: "completed" };
  const response = { id: `resp-${callId}`, object: "response", status: "completed", model, output: [item], usage: { input_tokens: 11, output_tokens: 4, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  return new Response(encodeSse([
    { type: "response.created", response: { ...response, output: [], status: "in_progress" } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "", status: "in_progress" } },
    { type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: argumentsJson },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response },
  ]), { status: 200, headers: { "content-type": "text/event-stream" } });
}
function hangingReasoningSse(signals: AbortSignal[], model = "offline-model"): Response {
  const encoder = new TextEncoder();
  const body = [
    { type: "response.created", response: { id: "resp-abort", object: "response", status: "in_progress", model, output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: "rs-abort", summary: [] } },
    { type: "response.reasoning_summary_text.delta", item_id: "rs-abort", output_index: 0, delta: "partial-think" },
  ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      const stop = () => { try { controller.close(); } catch { /* already closed */ } };
      if (signals.some(signal => signal.aborted)) stop();
      else for (const signal of signals) signal.addEventListener("abort", stop, { once: true });
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}
async function responsesWorld(t: TestContext, tools: PiWorkerRequest["config"]["tools"] = []) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-c08-sse-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  runtime.registerProvider("offline-http", { api: "openai-responses", baseUrl: "https://offline.invalid/v1", apiKey: "OFFLINE_KEY", models: [{ id: "offline-model", name: "Offline", reasoning: true, input: ["text"], contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  const request: PiWorkerRequest = { version: 1, cwd: directory, resourceDirectory: join(directory, "resources"), sessionDirectory: join(directory, "sessions"), task: "Return answer 42", input: null, config: { model: { provider: "offline-http", id: "offline-model" }, thinking: "off", tools, systemPrompt: "Use submit_result.", skills: [], session: "fresh", permission: "read-only", outputSchema: { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"], additionalProperties: false } } };
  return { runtime, request };
}
function abortSignals(controller: AbortController, init?: RequestInit): AbortSignal[] {
  return [controller.signal, init?.signal].filter((signal): signal is AbortSignal => !!signal);
}

test("scripted abort and error placeholders are unavailable; known aborted tokens and stop zeros still report", { timeout: 10_000 }, async t => {
  const started = gate(), controller = new AbortController();
  const abortedZeros = await scripted(t, [async (_context, options) => {
    started.resolve();
    if (!options?.signal?.aborted) await new Promise<void>(resolve => options!.signal!.addEventListener("abort", () => resolve(), { once: true }));
    return reply([], "aborted", zeros);
  }]);
  const running = executePiWorker(abortedZeros.request, { ...abortedZeros.options, signal: controller.signal }).then(value => ({ value }), error => ({ error }));
  try {
    await started.promise; controller.abort();
    const result = await running;
    assert.ok("error" in result && result.error instanceof ExecutionFailure);
    assert.equal(result.error.failure.code, "cancelled");
    assert.equal(zeroReports(abortedZeros.events).length, 0);
    assert.ok(abortedZeros.events.some((event: any) => event.type === "usage.unavailable"));
    assert.ok(abortedZeros.events.some((event: any) => event.type === "usage.settled" && event.complete === false));
  } finally { controller.abort(); await running; }

  const errored = await scripted(t, [() => reply([], "error", zeros)]);
  await assert.rejects(executePiWorker(errored.request, errored.options), (error: unknown) => {
    assert.ok(error instanceof ExecutionFailure); assert.equal(error.failure.code, "provider"); return true;
  });
  assert.equal(zeroReports(errored.events).length, 0);
  assert.ok(errored.events.some((event: any) => event.type === "usage.unavailable"));

  const startedKnown = gate(), controllerKnown = new AbortController();
  const abortedKnown = await scripted(t, [async (_context, options) => {
    startedKnown.resolve();
    if (!options?.signal?.aborted) await new Promise<void>(resolve => options!.signal!.addEventListener("abort", () => resolve(), { once: true }));
    return reply([], "aborted", known);
  }]);
  const runningKnown = executePiWorker(abortedKnown.request, { ...abortedKnown.options, signal: controllerKnown.signal }).then(value => ({ value }), error => ({ error }));
  try {
    await startedKnown.promise; controllerKnown.abort();
    await runningKnown;
    assert.ok(abortedKnown.events.some((event: any) => event.type === "usage.report" && event.usage.totalTokens === 5 && event.stopReason === "aborted"));
    assert.equal(zeroReports(abortedKnown.events).length, 0);
  } finally { controllerKnown.abort(); await runningKnown; }

  const stopped = await scripted(t, [() => reply([], "stop", zeros)]);
  await assert.rejects(executePiWorker(stopped.request, stopped.options));
  assert.ok(stopped.events.some((event: any) => event.type === "usage.report" && event.stopReason === "stop" && event.usage.totalTokens === 0));
});

test("openai-responses stream that ends before response.completed does not publish 0/0/0 usage", { timeout: 10_000 }, async t => {
  const world = await responsesWorld(t);
  const events: unknown[] = [];
  let fetches = 0;
  await assert.rejects(executePiWorker(world.request, { modelRuntime: world.runtime, onEvent: event => events.push(event), providerFetch: async () => { fetches++; return incompleteReasoningSse(); } }), (error: unknown) => {
    assert.ok(error instanceof ExecutionFailure); assert.equal(error.failure.code, "provider"); return true;
  });
  assert.equal(fetches, 1);
  assert.equal(zeroReports(events).length, 0);
  assert.ok(events.some((event: any) => event.type === "usage.unavailable"));
  assert.ok(events.some((event: any) => event.type === "usage.settled" && event.complete === false));
});

test("abort during openai-responses reasoning SSE is cancelled without placeholder usage", { timeout: 10_000 }, async t => {
  const world = await responsesWorld(t);
  const events: unknown[] = [];
  const fetched = gate();
  const controller = new AbortController();
  let fetches = 0;
  let fetchSignal: AbortSignal | undefined;
  const running = executePiWorker(world.request, {
    modelRuntime: world.runtime, signal: controller.signal, onEvent: event => events.push(event),
    providerFetch: async (_input, init) => {
      fetches++;
      fetchSignal = init?.signal ?? undefined;
      fetched.resolve();
      return hangingReasoningSse(abortSignals(controller, init));
    },
  }).then(value => ({ value }), error => ({ error }));
  try {
    await fetched.promise;
    await new Promise<void>(resolve => setTimeout(resolve, 100));
    controller.abort();
    const result = await running;
    assert.ok("error" in result && result.error instanceof ExecutionFailure);
    assert.equal(result.error.failure.code, "cancelled");
    assert.equal(fetches, 1);
    assert.equal(fetchSignal?.aborted, true);
    assert.equal(zeroReports(events).length, 0);
    assert.ok(events.some((event: any) => event.type === "usage.unavailable"));
    assert.ok(events.some((event: any) => event.type === "usage.settled" && event.complete === false));
  } finally { controller.abort(); await running; }
});

test("completed openai-responses usage is retained when a later reasoning stream is aborted", { timeout: 10_000 }, async t => {
  const world = await responsesWorld(t, ["ls"]);
  const events: unknown[] = [];
  const second = gate();
  const controller = new AbortController();
  let fetches = 0;
  const running = executePiWorker(world.request, {
    modelRuntime: world.runtime, signal: controller.signal, onEvent: event => events.push(event),
    providerFetch: async (_input, init) => {
      fetches++;
      if (fetches === 1) return grokSse("ls", { path: "." });
      second.resolve();
      return hangingReasoningSse(abortSignals(controller, init));
    },
  }).then(value => ({ value }), error => ({ error }));
  try {
    await second.promise;
    await new Promise<void>(resolve => setTimeout(resolve, 100));
    controller.abort();
    const result = await running;
    assert.ok("error" in result && result.error instanceof ExecutionFailure);
    assert.equal(result.error.failure.code, "cancelled");
    assert.equal(fetches, 2);
    assert.ok(events.some((event: any) => event.type === "usage.report" && event.usage.totalTokens === 15 && event.reportId === "1"));
    assert.equal(zeroReports(events).length, 0);
    assert.ok(events.some((event: any) => event.type === "usage.unavailable"));
    assert.ok(events.some((event: any) => event.type === "usage.settled" && event.complete === false));
  } finally { controller.abort(); await running; }
});
