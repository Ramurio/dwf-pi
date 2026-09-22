import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { crc32 } from "node:zlib";
import { InMemoryCredentialStore, InMemoryModelsStore, type AssistantMessage, type ImageContent } from "@earendil-works/pi-ai";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { executePiWorker, type PiWorkerOptions } from "../src/pi-worker.js";
import type { PiWorkerRequest } from "../src/execution-types.js";
import { ExecutionFailure } from "../src/execution-failure.js";
import { MAX_INLINE_IMAGE_AGGREGATE_BASE64_CHARS, MAX_INLINE_IMAGE_COUNT } from "../src/image-boundary.js";
import { pngDigit } from "./helpers/test-images.js";

const provider = "image-context-test", modelId = "offline-vision";
const image = (data = pngDigit(2, 1).toString("base64")): ImageContent => ({ type: "image", mimeType: "image/png", data });
type Call = { name: string; arguments: Record<string, unknown> };
const submit = (answer: unknown = 42): Call => ({ name: "submit_result", arguments: { answer } });
const read = (): Call => ({ name: "read", arguments: { path: "small.png" } });

function response(calls: Call[]): Response {
  const output = calls.map((call, i) => ({ type: "function_call", id: `fc_${i}`, call_id: `call_${i}`, name: call.name, arguments: JSON.stringify(call.arguments), status: "completed" }));
  const result = { id: "offline-response", object: "response", model: modelId, status: "completed", output,
    usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5, input_tokens_details: { cached_tokens: 0 } } };
  const events = [
    { type: "response.created", response: { ...result, output: [], status: "in_progress" } },
    ...output.flatMap((item, i) => [
      { type: "response.output_item.added", output_index: i, item: { ...item, arguments: "", status: "in_progress" } },
      { type: "response.function_call_arguments.delta", item_id: item.id, output_index: i, delta: item.arguments },
      { type: "response.output_item.done", output_index: i, item },
    ]),
    { type: "response.completed", response: result },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}

async function fixture(t: TestContext, script: Call[][]) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-image-context-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "small.png"), pngDigit(2, 1));
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  runtime.registerProvider(provider, { api: "openai-responses", baseUrl: "https://offline.invalid", apiKey: "OFFLINE_TEST_ONLY", models: [{ id: modelId, name: modelId, reasoning: false, input: ["text", "image"], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  const request: PiWorkerRequest = {
    version: 1, cwd: directory, resourceDirectory: join(directory, "resources"), sessionDirectory: join(directory, "sessions"), task: "Read images and submit.", input: {},
    config: { model: { provider, id: modelId }, thinking: "off", tools: ["read"], systemPrompt: "Use tools.", skills: [], session: "fresh", permission: "read-only", outputSchema: { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"], additionalProperties: false } },
  };
  const payloads: { count: number; chars: number; tools: string[] }[] = [];
  const events: any[] = [];
  const options: PiWorkerOptions = { modelRuntime: runtime, onEvent: event => events.push(event), providerFetch: async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    const images: string[] = [];
    const visit = (value: any) => {
      if (!value || typeof value !== "object") return;
      if (value.type === "input_image") images.push(value.image_url.split(",")[1]);
      for (const child of Object.values(value)) visit(child);
    };
    visit(payload.input);
    payloads.push({ count: images.length, chars: images.reduce((n, data) => n + data.length, 0), tools: payload.tools.map((tool: any) => tool.name) });
    const calls = script[payloads.length - 1];
    assert.ok(calls, "Unexpected provider dispatch");
    return response(calls);
  } };
  return { request, options, payloads, events };
}

function restoreImages(request: PiWorkerRequest, images: ImageContent[]) {
  const manager = SessionManager.create(request.cwd, request.sessionDirectory);
  manager.appendMessage({ role: "user", content: images, timestamp: 1 });
  const previous: AssistantMessage = { role: "assistant", content: [{ type: "text", text: "Previous visit." }], api: "openai-responses", provider, model: modelId, stopReason: "stop", timestamp: 2,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  manager.appendMessage(previous);
  request.config.session = "continue-node";
  request.sessionFile = manager.getSessionFile()!;
}

function isLocalImageFailure(error: unknown) {
  assert.ok(error instanceof ExecutionFailure);
  assert.equal(error.failure.code, "resource");
  assert.equal(error.failure.effects, "read-only");
  assert.deepEqual(error.failure.diagnostic, { subcode: "image-invalid", dispatch: "not-dispatched" });
  assert.equal(error.failure.providerResponse, undefined);
  return true;
}

for (const mode of ["read", "continuation", "repair"] as const) {
  for (const count of [MAX_INLINE_IMAGE_COUNT, MAX_INLINE_IMAGE_COUNT + 1]) {
    test(`${mode}: ${count} images are checked across the full history before native fetch`, { timeout: 30000 }, async t => {
      const first = Array.from({ length: count }, read);
      if (mode === "repair") first.push(submit("invalid"));
      const f = await fixture(t, mode === "continuation" ? [[submit()]] : [first, [submit()]]);
      if (mode === "continuation") restoreImages(f.request, Array.from({ length: count }, () => image()));
      if (mode === "repair") f.request.config.outputRepair = { mode: "submit-only", maxRounds: 1 };
      if (count > MAX_INLINE_IMAGE_COUNT) {
        await assert.rejects(executePiWorker(f.request, f.options), isLocalImageFailure);
        assert.equal(f.payloads.length, mode === "continuation" ? 0 : 1);
        assert.ok(f.events.some(event => event.type === "agent_settled"));
        assert.deepEqual(f.events.filter(event => event.type === "usage.settled"), [{ type: "usage.settled", complete: false }]);
        assert.equal(f.events.filter(event => event.type === "usage.report").length, f.payloads.length);
        if (mode === "repair") assert.equal(f.events.filter(event => event.type === "output.repair").at(-1).progress.status, "failed");
      } else {
        const result = await executePiWorker(f.request, f.options);
        assert.deepEqual(result.output, { answer: 42 });
        assert.equal(f.payloads.at(-1)!.count, count);
        if (mode === "repair") assert.deepEqual(f.payloads.at(-1)!.tools, ["submit_result"]);
      }
    });
  }
}

/** Валидный PNG с дополнительным chunk: точный размер base64 без большого растра. */
function paddedPng(encodedChars: number): ImageContent {
  assert.equal(encodedChars % 4, 0);
  const png = pngDigit(2, 1);
  const chunk = Buffer.alloc(encodedChars / 4 * 3 - png.length);
  chunk.writeUInt32BE(chunk.length - 12, 0);
  chunk.write("dwFt", 4, "ascii");
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  const data = Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]).toString("base64");
  assert.equal(data.length, encodedChars);
  return image(data);
}

for (const mode of ["continuation", "repair"] as const) {
  for (const excess of [false, true]) {
    test(`${mode}: aggregate base64 ${excess ? "over" : "at"} 24 MiB is checked before native fetch`, { timeout: 30000 }, async t => {
      const f = await fixture(t, mode === "continuation" ? [[submit()]] : [[...(excess ? [read()] : []), submit("invalid")], [submit()]]);
      const half = MAX_INLINE_IMAGE_AGGREGATE_BASE64_CHARS / 2;
      restoreImages(f.request, [paddedPng(half), paddedPng(half + (mode === "continuation" && excess ? 4 : 0))]);
      if (mode === "repair") f.request.config.outputRepair = { mode: "submit-only", maxRounds: 1 };
      if (excess) {
        await assert.rejects(executePiWorker(f.request, f.options), isLocalImageFailure);
        assert.equal(f.payloads.length, mode === "continuation" ? 0 : 1);
        if (mode === "repair") assert.equal(f.events.filter(event => event.type === "output.repair").at(-1).progress.status, "failed");
      } else {
        assert.deepEqual((await executePiWorker(f.request, f.options)).output, { answer: 42 });
        assert.equal(f.payloads.at(-1)!.chars, MAX_INLINE_IMAGE_AGGREGATE_BASE64_CHARS);
        assert.equal(f.payloads.length, mode === "continuation" ? 1 : 2);
      }
    });
  }
}

for (const subcode of ["image-invalid", "image-unsupported"] as const) {
  test(`continued ${subcode} history keeps a local diagnostic and never enters output repair`, async t => {
    const f = await fixture(t, [[submit()]]);
    restoreImages(f.request, [subcode === "image-invalid" ? image("@@@@") : { ...image(), mimeType: "image/gif" }]);
    f.request.config.outputRepair = { mode: "submit-only", maxRounds: 1 };
    await assert.rejects(executePiWorker(f.request, f.options), (error: unknown) => {
      assert.ok(error instanceof ExecutionFailure);
      assert.equal(error.failure.code, subcode === "image-invalid" ? "resource" : "configuration");
      assert.deepEqual(error.failure.diagnostic, { subcode, dispatch: "not-dispatched" });
      assert.equal(error.failure.providerResponse, undefined);
      return true;
    });
    assert.equal(f.payloads.length, 0);
    assert.equal(f.events.some(event => event.type === "output.repair"), false);
    assert.ok(f.events.some(event => event.type === "agent_settled"));
  });
}
