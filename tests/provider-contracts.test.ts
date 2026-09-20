import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { executePiWorker } from "../src/pi-worker.js";
import type { PiWorkerRequest } from "../src/execution-types.js";

async function world(t: TestContext, api: "openai-completions" | "openai-responses" | "bedrock-converse-stream", baseUrl = "https://offline.invalid/v1") {
  const directory = await mkdtemp(join(tmpdir(), "dwf-provider-contract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  runtime.registerProvider("contract-fixture", { api, baseUrl, apiKey: "DUMMY", models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  const request: PiWorkerRequest = { version: 1, cwd: directory, sessionDirectory: join(directory, "sessions"), resourceDirectory: join(directory, "resources"), task: "Return answer", input: null, config: { model: { provider: "contract-fixture", id: "fixture" }, thinking: "off", tools: [], skills: [], permission: "read-only", session: "fresh", systemPrompt: "Use submit_result", outputSchema: { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"], additionalProperties: false } } };
  return { runtime, request };
}
function response(api: string, mode: "missing" | "zero" | "positive", call = "submit_result") {
  const args = call === "submit_result" ? '{"answer":42}' : '{}';
  const usage = mode === "missing" ? undefined : mode === "zero" ? [0, 0] : [10, 3];
  if (api === "openai-completions") {
    const base = { id: "chat-fixture", object: "chat.completion.chunk", created: 1, model: "fixture" };
    const chunks: object[] = [
      { ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call-fixture", type: "function", function: { name: call, arguments: args } }] }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
    if (usage) chunks.push({ ...base, choices: [], usage: { prompt_tokens: usage[0], completion_tokens: usage[1], total_tokens: usage[0]! + usage[1]! } });
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  }
  const item = { type: "function_call", id: "fc-fixture", call_id: "call-fixture", name: call, arguments: args, status: "completed" };
  const result = { id: "resp-fixture", object: "response", status: "completed", model: "fixture", output: [item], ...(usage ? { usage: { input_tokens: usage[0], output_tokens: usage[1], total_tokens: usage[0]! + usage[1]! } } : {}) };
  const events = [
    { type: "response.created", response: { ...result, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "", status: "in_progress" } },
    { type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: args },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: result },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}
for (const api of ["openai-completions", "openai-responses"] as const) {
  for (const mode of ["missing", "zero", "positive"] as const) test(`${api} keeps missing provider usage distinct from explicit ${mode}`, async t => {
    const f = await world(t, api); const events: any[] = [];
    const result = await executePiWorker(f.request, { modelRuntime: f.runtime, providerFetch: async () => response(api, mode), onEvent: event => events.push(event) });
    assert.deepEqual(result.output, { answer: 42 });
    const reports = events.filter(event => event.type === "usage.report");
    assert.equal(reports.length, mode === "missing" ? 0 : 1);
    if (reports.length) assert.equal(reports[0].usage.totalTokens, mode === "positive" ? 13 : 0);
    assert.equal(events.find(event => event.type === "usage.settled").complete, mode !== "missing");
  });
  test(`${api} keeps partial accounting across output repair`, async t => {
    const f = await world(t, api); f.request.config.outputRepair = { mode: "submit-only", maxRounds: 1 };
    const events: any[] = []; let calls = 0;
    const result = await executePiWorker(f.request, { modelRuntime: f.runtime, providerFetch: async () => ++calls === 1 ? response(api, "missing", "unknown_tool") : response(api, "positive"), onEvent: event => events.push(event) });
    assert.deepEqual(result.output, { answer: 42 }); assert.equal(calls, 2);
    assert.equal(events.filter(event => event.type === "usage.report").length, 1);
    assert.equal(events.find(event => event.type === "usage.settled").complete, false);
  });
}

test("Bedrock sends one HTTP attempt for transient errors, transport loss and cancellation", { timeout: 20_000 }, async t => {
  const keys = ["AWS_BEDROCK_FORCE_HTTP1", "AWS_BEDROCK_SKIP_AUTH", "AWS_MAX_ATTEMPTS"] as const;
  const previous = keys.map(key => process.env[key]);
  process.env.AWS_BEDROCK_FORCE_HTTP1 = "1"; process.env.AWS_BEDROCK_SKIP_AUTH = "1"; process.env.AWS_MAX_ATTEMPTS = "9";
  try {
    for (const mode of ["503", "429", "transport", "cancel"]) {
      let count = 0; const controller = new AbortController();
      const server = createServer((request, reply) => {
        count++; request.resume();
        if (mode === "transport") request.socket.destroy();
        else { reply.writeHead(mode === "429" ? 429 : 503, { "content-type": "application/json", "x-amzn-errortype": mode === "429" ? "ThrottlingException" : "ServiceUnavailableException" }); reply.end('{"message":"offline fixture"}'); }
        if (mode === "cancel") controller.abort();
      });
      server.listen(0, "127.0.0.1"); await once(server, "listening");
      try {
        const f = await world(t, "bedrock-converse-stream", `http://127.0.0.1:${(server.address() as any).port}`);
        await assert.rejects(executePiWorker(f.request, { modelRuntime: f.runtime, signal: controller.signal }));
        assert.equal(count, 1, mode);
      } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    }
  } finally { keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }); }
});
