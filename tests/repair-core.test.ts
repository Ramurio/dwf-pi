import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { createReadToolDefinition } from "@earendil-works/pi-coding-agent";
import { createWorkflowModelRuntime } from "../src/model-runtime.js";
import { createXaiSubscriptionProvider } from "../src/xai-provider.js";
import { executePiWorker } from "../src/pi-worker.js";
import type { PiWorkerRequest } from "../src/execution-types.js";
import { ExecutionFailure } from "../src/execution-failure.js";
import { wrapImageProducingTool } from "../src/image-boundary.js";
import { noneAdapterCapabilities } from "../src/capabilities.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { readInstalledSdkIdentity, reviewedSdkVersions, type SdkIdentity } from "../src/adapter-identity.js";
import { jpegDigit, oversizedPng, pngDigit } from "./helpers/test-images.js";
import {
  consumedRequestIndex,
  extractToolIO,
  lastOutboundIndex,
  lsRoundTripConsumed,
  normalizeTransportToolCallId,
  provenLsRoundTrips,
  publishedLsRoundTrips,
  recordSuccessfulLsCompletion,
  type SuccessfulLsCompletion,
  type ToolIoTurn,
} from "./helpers/tool-round-trip.js";
import {
  defaultRepairLiveEvidencePath,
  publishRepairLiveEvidence,
  REPAIR_LIVE_EVIDENCE_ENV,
  resolveRepairLiveEvidencePath,
} from "./helpers/repair-live-evidence.js";
import { readFileSync } from "node:fs";

const packageRoot = join(homedir(), ".pi/agent/npm/node_modules/pi-xai-oauth");

test("CORE repair scripts and reviewed helper are present; skip is not success", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(typeof pkg.scripts["test:repair:core"], "string");
  assert.equal(typeof pkg.scripts["test:repair:live"], "string");
  assert.match(pkg.scripts.test, /test-concurrency=4/);
  assert.doesNotMatch(pkg.scripts.test, /test:repair:live/);
  assert.equal(pkg.dependencies["@earendil-works/pi-ai"], "0.85.1");
  assert.equal(existsSync(join(packageRoot, "package.json")), true, "reviewed pi-xai-oauth helper is required for CORE image/adapter regressions");
  assert.equal(existsSync(join(packageRoot, "extensions/xai/images.ts")), true);
  assert.match(pkg.scripts["test:repair:core"], /lineage\.test\.ts/);
  assert.match(pkg.scripts["test:repair:core"], /continuation\.test\.ts/);
  assert.match(pkg.scripts["test:repair:core"], /task-usage\.test\.ts/);
  assert.match(pkg.scripts["test:repair:core"], /graph-view-task-scope\.test\.ts/);
});

function grokSse(name: string, args: Record<string, unknown>, model = "grok-4.6"): Response {
  const callId = `call-${name}-${JSON.stringify(args).length}`;
  const argumentsJson = JSON.stringify(args);
  const item = { type: "function_call", id: `fc-${callId}`, call_id: callId, name, arguments: argumentsJson, status: "completed" };
  const response = { id: `resp-${callId}`, object: "response", status: "completed", model, output: [item], usage: { input_tokens: 11, output_tokens: 4, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  const events = [
    { type: "response.created", response: { ...response, output: [], status: "in_progress" } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "", status: "in_progress" } },
    { type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: argumentsJson },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
}

function extractImages(payload: unknown): { mimeType: string; digest: string; chars: number }[] {
  const found: { mimeType: string; digest: string; chars: number }[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    const record = value as Record<string, unknown>;
    if (record.type === "input_image" && typeof record.image_url === "string") {
      const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(record.image_url);
      if (match) found.push({ mimeType: match[1]!, digest: match[2]!.slice(0, 24), chars: match[2]!.length });
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(payload);
  return found;
}

async function grokFixture(t: TestContext, id = "grok-4.6", extra: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-repair-core-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const cachePath = join(directory, "catalog.json");
  const model: Record<string, unknown> = {
    id, name: id, apiBackend: "responses", reasoning: true,
    thinkingLevelMap: { low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
    contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  if (extra.omitModalities !== true) {
    model.input = extra.input ?? ["text", "image"];
    model.inputProvenance = extra.inputProvenance ?? "authenticated-accepts-images";
  }
  await writeFile(cachePath, JSON.stringify({ schemaVersion: 2, fetchedAt: Date.now(), models: [model] }));
  const credentials = new InMemoryCredentialStore();
  await credentials.modify("xai-auth", async () => ({ type: "oauth", access: "TEST_ACCESS_NO_SECRET", refresh: "TEST_REFRESH_NO_SECRET", expires: Date.now() + 3_600_000 }));
  const options = { credentials, modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, grok: { agentDirectory: directory, packageRoot, cachePath } };
  return { directory, cachePath, credentials, options, id };
}

test("PNG and JPEG read results are converted into outbound Grok images, a later tool is replayed, xhigh is sent, resize runs, and session continuation submits", { timeout: 60000 }, async t => {
  const f = await grokFixture(t);
  const png = pngDigit(3);
  const jpeg = await jpegDigit(8);
  const huge = oversizedPng();
  await writeFile(join(f.directory, "panel-a.png"), png);
  await writeFile(join(f.directory, "panel-b.jpg"), jpeg);
  await writeFile(join(f.directory, "panel-c.png"), huge);
  const runtime = await createWorkflowModelRuntime(f.options);
  const provider = runtime.getRegisteredNativeProvider("xai-auth") as Awaited<ReturnType<typeof createXaiSubscriptionProvider>>;
  const requests: { payload: any }[] = [];
  const script = [
    () => grokSse("read", { path: "panel-a.png" }),
    () => grokSse("read", { path: "panel-b.jpg" }),
    () => grokSse("ls", { path: "." }),
    () => grokSse("submit_result", { png: 3, jpeg: 8, files: 3 }),
  ];
  const before = globalThis.fetch;
  const fakeFetch: typeof fetch = async (_input, init) => {
    requests.push({ payload: JSON.parse(String(init?.body)) });
    const next = script[requests.length - 1];
    if (!next) throw new Error("unexpected extra provider request");
    return next();
  };
  const request: PiWorkerRequest = {
    version: 1, cwd: f.directory, resourceDirectory: join(f.directory, "resources"), sessionDirectory: join(f.directory, "sessions"),
    task: "Inspect the workspace panels and list files, then submit.", input: {},
    config: { model: { provider: "xai-auth", id: f.id }, thinking: "xhigh", tools: ["read", "ls"], systemPrompt: "Use tools.", skills: [], session: "fresh", permission: "read-only",
      outputSchema: { type: "object", additionalProperties: false, properties: { png: { type: "integer" }, jpeg: { type: "integer" }, files: { type: "integer" } }, required: ["png", "jpeg", "files"] } },
  };
  const events: unknown[] = [];
  const result = await executePiWorker(request, { modelRuntime: runtime, providerFetch: fakeFetch, onEvent: event => events.push(event) });
  assert.deepEqual(result.output, { png: 3, jpeg: 8, files: 3 });
  assert.equal(requests.length, 4);
  assert.equal(requests[0]!.payload.reasoning.effort, "xhigh");
  const imageTurns = requests.flatMap(request => extractImages(request.payload));
  assert.ok(imageTurns.some(image => image.mimeType === "image/png"));
  assert.ok(imageTurns.some(image => image.mimeType === "image/jpeg"));
  assert.ok(imageTurns.length >= 2);
  const second = JSON.stringify(requests[1]!.payload);
  assert.match(second, /panel-a|image\/png|attached in the following user message|input_image/);
  const third = JSON.stringify(requests[2]!.payload);
  assert.match(third, /function_call_output|ls/);
  assert.equal(globalThis.fetch, before);
  const observed = events.filter((event: any) => event.type === "usage.report").map((event: any) => event.observedEffort);
  assert.ok(observed.includes("xhigh"));
  const continued = await executePiWorker({ ...request, config: { ...request.config, session: "continue-node" }, sessionFile: result.sessionFile, task: "Continue and submit the same structured result.", resourceDirectory: join(f.directory, "resources-2") }, {
    modelRuntime: runtime, providerFetch: async (_input, init) => {
      requests.push({ payload: JSON.parse(String(init?.body)) });
      return grokSse("submit_result", { png: 3, jpeg: 8, files: 3 });
    },
  });
  assert.deepEqual(continued.output, { png: 3, jpeg: 8, files: 3 });
  assert.equal(continued.sessionFile, result.sessionFile);
  const model = runtime.getAvailableSnapshot().find(item => item.provider === "xai-auth")!;
  const hugeData = huge.toString("base64");
  await runtime.streamSimple(model, { messages: [{ role: "user", content: [{ type: "text", text: "see" }, { type: "image", mimeType: "image/png", data: hugeData }], timestamp: 1 }], tools: [] }, { reasoning: "xhigh", fetch: async (_input, init) => {
    const payload = JSON.parse(String(init?.body));
    const images = extractImages(payload);
    assert.equal(payload.reasoning.effort, "xhigh");
    assert.ok(images.length >= 1);
    assert.ok(images[0]!.chars < hugeData.length || provider.resizeObservations().some(item => item.wasResized && item.width < 2200));
    return grokSse("submit_result", { ok: true });
  } }).result();
  assert.ok(provider.resizeObservations().some(item => item.wasResized));
});

test("text-only Grok route keeps a working text tool path and guards unexpected image reads", { timeout: 30000 }, async t => {
  const f = await grokFixture(t, "grok-text", { input: ["text"], inputProvenance: "authenticated-input-modalities" });
  const runtime = await createWorkflowModelRuntime(f.options);
  await writeFile(join(f.directory, "notes.txt"), "alpha");
  await writeFile(join(f.directory, "photo.png"), pngDigit(2));
  const requests: any[] = [];
  const script = [
    () => grokSse("read", { path: "photo.png" }),
    () => grokSse("read", { path: "notes.txt" }),
    () => grokSse("submit_result", { answer: 42 }),
  ];
  const request: PiWorkerRequest = {
    version: 1, cwd: f.directory, resourceDirectory: join(f.directory, "resources"), sessionDirectory: join(f.directory, "sessions"),
    task: "Read files then submit.", input: {},
    config: { model: { provider: "xai-auth", id: f.id }, thinking: "high", tools: ["read"], systemPrompt: "Use tools.", skills: [], session: "fresh", permission: "read-only",
      outputSchema: { type: "object", additionalProperties: false, properties: { answer: { type: "integer" } }, required: ["answer"] } },
  };
  const result = await executePiWorker(request, { modelRuntime: runtime, providerFetch: async (_input, init) => {
    const payload = JSON.parse(String(init?.body));
    requests.push(payload);
    assert.equal(extractImages(payload).length, 0);
    return script[requests.length - 1]!();
  } });
  assert.deepEqual(result.output, { answer: 42 });
  assert.equal(requests.length, 3);
  assert.match(JSON.stringify(requests[1]), /does not accept image tool results|photo.png|notes.txt/);
});

test("incompatible restored image history fails before a request and leaves the session file unchanged", { timeout: 20000 }, async t => {
  const vision = await grokFixture(t);
  const runtime = await createWorkflowModelRuntime(vision.options);
  await writeFile(join(vision.directory, "photo.png"), pngDigit(1));
  const request: PiWorkerRequest = {
    version: 1, cwd: vision.directory, resourceDirectory: join(vision.directory, "resources"), sessionDirectory: join(vision.directory, "sessions"),
    task: "Read then submit.", input: {},
    config: { model: { provider: "xai-auth", id: vision.id }, thinking: "high", tools: ["read"], systemPrompt: "Use tools.", skills: [], session: "fresh", permission: "read-only",
      outputSchema: { type: "object", additionalProperties: false, properties: { answer: { type: "integer" } }, required: ["answer"] } },
  };
  const first = await executePiWorker(request, { modelRuntime: runtime, providerFetch: async (_input, init) => {
    const payload = JSON.parse(String(init?.body));
    if (extractImages(payload).length) return grokSse("submit_result", { answer: 1 });
    return grokSse("read", { path: "photo.png" });
  } });
  const before = await readFile(first.sessionFile);
  let fetches = 0;
  await assert.rejects(executePiWorker({
    ...request, resourceDirectory: join(vision.directory, "resources-2"),
    sessionFile: first.sessionFile, config: { ...request.config, session: "continue-node", capabilities: noneAdapterCapabilities() },
  }, { modelRuntime: runtime, providerFetch: async () => { fetches++; return grokSse("submit_result", { answer: 1 }); } }), (error: unknown) => {
    assert.ok(error instanceof ExecutionFailure);
    assert.equal(error.failure.diagnostic?.subcode, "image-unsupported");
    assert.equal(error.failure.diagnostic?.dispatch, "not-dispatched");
    return true;
  });
  assert.equal(fetches, 0);
  assert.deepEqual(await readFile(first.sessionFile), before);
});

test("a write before local image rejection leaves effects unknown and sends no request for that turn", { timeout: 20000 }, async t => {
  const f = await grokFixture(t, "grok-text", { input: ["text"], inputProvenance: "authenticated-input-modalities" });
  const runtime = await createWorkflowModelRuntime(f.options);
  const provider = runtime.getRegisteredNativeProvider("xai-auth")!;
  const original = provider.streamSimple.bind(provider);
  let fetches = 0;
  let injected = false;
  provider.streamSimple = (model, context, options) => {
    if (context.messages.some(message => JSON.stringify(message).includes("artifact.txt"))) {
      injected = true;
      const png = pngDigit(9).toString("base64");
      context = { ...context, messages: [...context.messages, { role: "user", content: [{ type: "image", mimeType: "image/png", data: png }], timestamp: Date.now() }] };
    }
    return original(model, context, options);
  };
  const request: PiWorkerRequest = {
    version: 1, cwd: f.directory, resourceDirectory: join(f.directory, "resources"), sessionDirectory: join(f.directory, "sessions"),
    task: "Write then continue.", input: {},
    config: { model: { provider: "xai-auth", id: f.id }, thinking: "high", tools: ["write"], systemPrompt: "Use tools.", skills: [], session: "fresh", permission: "workspace-write",
      outputSchema: { type: "object", additionalProperties: false, properties: { answer: { type: "integer" } }, required: ["answer"] } },
  };
  await assert.rejects(executePiWorker(request, { modelRuntime: runtime, providerFetch: async () => {
    fetches++;
    if (fetches === 1) return grokSse("write", { path: "artifact.txt", content: "written" });
    throw new Error("second request must not be sent");
  } }), (error: unknown) => {
    assert.ok(error instanceof ExecutionFailure);
    assert.equal(error.failure.code, "configuration");
    assert.equal(error.failure.effects, "unknown");
    assert.equal(error.failure.diagnostic?.subcode, "image-unsupported");
    assert.equal(error.failure.diagnostic?.dispatch, "not-dispatched");
    assert.equal(error.failure.diagnostic?.sentReasoning, undefined);
    return true;
  });
  assert.equal(injected, true);
  assert.equal(fetches, 1);
  assert.equal(await readFile(join(f.directory, "artifact.txt"), "utf8"), "written");
});

test("malformed and unsupported images fail locally; HTTP facts stay numeric; later failures do not inherit status", { timeout: 20000 }, async t => {
  const f = await grokFixture(t);
  const runtime = await createWorkflowModelRuntime(f.options);
  const model = runtime.getAvailableSnapshot().find(item => item.provider === "xai-auth")!;
  const before = globalThis.fetch;
  const invalid = await runtime.streamSimple(model, { messages: [{ role: "user", content: [{ type: "image", mimeType: "image/png", data: "%%%%" }], timestamp: 1 }] }, { fetch: async () => { throw new Error("network must not run"); } }).result();
  assert.equal(invalid.stopReason, "error");
  assert.equal(globalThis.fetch, before);
  let calls = 0;
  const request: PiWorkerRequest = {
    version: 1, cwd: f.directory, resourceDirectory: join(f.directory, "resources"), sessionDirectory: join(f.directory, "sessions"),
    task: "Submit", input: {},
    config: { model: { provider: "xai-auth", id: f.id }, thinking: "xhigh", tools: [], systemPrompt: "Submit.", skills: [], session: "fresh", permission: "read-only",
      outputSchema: { type: "object", additionalProperties: false, properties: { answer: { type: "integer" } }, required: ["answer"] } },
  };
  await assert.rejects(executePiWorker(request, { modelRuntime: runtime, providerFetch: async () => {
    calls++;
    return new Response("PRIVATE_HTTP_BODY", { status: 429, headers: { "retry-after": "4", authorization: "SECRET" } });
  } }), (error: unknown) => {
    assert.ok(error instanceof ExecutionFailure);
    assert.equal(error.failure.code, "provider");
    assert.deepEqual(error.failure.providerResponse, { status: 429, retryAfterMs: 4000 });
    assert.equal(error.failure.diagnostic?.dispatch, "http-observed");
    assert.doesNotMatch(JSON.stringify(error.failure), /PRIVATE_HTTP|SECRET|TEST_ACCESS/);
    return true;
  });
  assert.equal(calls, 1);
  let turn = 0;
  await assert.rejects(executePiWorker({ ...request, cwd: f.directory, resourceDirectory: join(f.directory, "resources-2"), sessionDirectory: join(f.directory, "sessions-2"),
    config: { ...request.config, tools: ["ls"] } }, { modelRuntime: runtime, providerFetch: async () => {
    turn++;
    if (turn === 1) return grokSse("ls", { path: "." });
    return new Response("not-an-event-stream", { status: 200, headers: { "content-type": "text/event-stream" } });
  } }), (error: unknown) => {
    assert.ok(error instanceof ExecutionFailure);
    assert.equal(error.failure.code, "provider");
    assert.notEqual(error.failure.providerResponse?.status, 429);
    return true;
  });
});

test("explicit image requirements freeze adapter identity and reject stale text-only catalogs", async t => {
  const f = await grokFixture(t);
  const { discoverWorkflowCatalog } = await import("../src/model-runtime.js");
  const models = await discoverWorkflowCatalog(f.options);
  const plan = await prepareExecutionPlan({
    schemaVersion: 1, id: "img", name: "img", revision: 1, entryGraph: "main",
    graphs: { main: { entry: "work", nodes: [
      { id: "work", kind: "agent", role: "general", task: { op: "literal", value: "See" }, config: { tools: ["read"], requirements: { toolResultModalities: ["image"] } } },
      { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "work"] } },
    ], edges: [{ from: "work", to: "done" }] } },
  }, { cwd: f.directory, availableModels: models.models });
  assert.equal(plan.agents.main!.work!.capabilities?.effective.toolResult.state, "supported");
  assert.equal(plan.agents.main!.work!.adapterIdentity?.capabilityRevision, "dynamicwf-xai-bridge-v1");
  await assert.rejects(prepareExecutionPlan(plan.workflow, { cwd: f.directory, availableModels: [{ provider: "xai-auth", id: "grok-4.6", thinkingLevels: ["high"] }] }), /unknown required image|Unsupported or unknown/);
  const denied = wrapImageProducingTool(createReadToolDefinition(f.directory), noneAdapterCapabilities());
  await writeFile(join(f.directory, "x.png"), pngDigit(5));
  await assert.rejects(denied.execute("t", { path: "x.png" }, undefined, undefined, { cwd: f.directory } as never));
});

test("frozen image requirements fail before execution when the live catalog is text-only or unknown", { timeout: 30000 }, async t => {
  const { discoverWorkflowCatalog } = await import("../src/model-runtime.js");
  async function rejectWith(id: string, visionExtra: Record<string, unknown>, liveExtra: Record<string, unknown>) {
    const vision = await grokFixture(t, id, visionExtra);
    const models = await discoverWorkflowCatalog(vision.options);
    const plan = await prepareExecutionPlan({
      schemaVersion: 1, id: "drift", name: "drift", revision: 1, entryGraph: "main",
      graphs: { main: { entry: "work", nodes: [
        { id: "work", kind: "agent", role: "general", task: { op: "literal", value: "See" }, config: { model: { provider: "xai-auth", id }, tools: ["read"], thinking: "high", requirements: { toolResultModalities: ["image"] } } },
        { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "work"] } },
      ], edges: [{ from: "work", to: "done" }] } },
    }, { cwd: vision.directory, availableModels: models.models });
    const frozen = plan.agents.main!.work!;
    assert.equal(frozen.capabilities?.effective.toolResult.state, "supported");
    const live = await grokFixture(t, id, liveExtra);
    const runtime = await createWorkflowModelRuntime(live.options);
    assert.ok(runtime.getAvailableSnapshot().some(m => m.provider === "xai-auth" && m.id === id));
    let fetches = 0;
    await assert.rejects(executePiWorker({
      version: 1, cwd: live.directory, resourceDirectory: join(live.directory, "resources"), sessionDirectory: join(live.directory, "sessions"),
      task: "Read images", input: {}, config: { ...frozen, session: "fresh" },
    }, { modelRuntime: runtime, providerFetch: async () => { fetches++; return grokSse("submit_result", { ok: true }, id); } }), (error: unknown) => {
      assert.ok(error instanceof ExecutionFailure, String(error));
      assert.equal(error.failure.diagnostic?.subcode, "image-unsupported", JSON.stringify(error.failure));
      assert.equal(error.failure.code, "configuration");
      assert.equal(error.failure.diagnostic?.dispatch, "not-dispatched");
      return true;
    });
    assert.equal(fetches, 0);
  }
  await rejectWith("grok-4.6", {}, { input: ["text"], inputProvenance: "authenticated-input-modalities" });
  await rejectWith("grok-lab", { input: ["text", "image"], inputProvenance: "authenticated-accepts-images" }, { input: ["text"], inputProvenance: "conservative-default" });
});

test("capability drift without explicit requirements returns recoverable image-read feedback and still submits", { timeout: 30000 }, async t => {
  const vision = await grokFixture(t);
  const { discoverWorkflowCatalog } = await import("../src/model-runtime.js");
  const models = await discoverWorkflowCatalog(vision.options);
  const plan = await prepareExecutionPlan({
    schemaVersion: 1, id: "drift2", name: "drift2", revision: 1, entryGraph: "main",
    graphs: { main: { entry: "work", nodes: [
      { id: "work", kind: "agent", role: "general", task: { op: "literal", value: "See" }, config: { tools: ["read"], thinking: "high" } },
      { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "work"] } },
    ], edges: [{ from: "work", to: "done" }] } },
  }, { cwd: vision.directory, availableModels: models.models });
  const frozen = plan.agents.main!.work!;
  assert.equal(frozen.capabilities?.effective.toolResult.state, "supported");
  const live = await grokFixture(t, "grok-4.6", { input: ["text"], inputProvenance: "authenticated-input-modalities" });
  await writeFile(join(live.directory, "photo.png"), pngDigit(2));
  await writeFile(join(live.directory, "notes.txt"), "alpha");
  const runtime = await createWorkflowModelRuntime(live.options);
  const payloads: unknown[] = [];
  const script = [
    () => grokSse("read", { path: "photo.png" }),
    () => grokSse("read", { path: "notes.txt" }),
    () => grokSse("submit_result", { answer: 42 }),
  ];
  const result = await executePiWorker({
    version: 1, cwd: live.directory, resourceDirectory: join(live.directory, "resources"), sessionDirectory: join(live.directory, "sessions"),
    task: "Read files then submit.", input: {},
    config: { ...frozen, session: "fresh", outputSchema: { type: "object", additionalProperties: false, properties: { answer: { type: "integer" } }, required: ["answer"] } },
  }, { modelRuntime: runtime, providerFetch: async (_input, init) => {
    const payload = JSON.parse(String(init?.body));
    payloads.push(payload);
    assert.equal(extractImages(payload).length, 0);
    return script[payloads.length - 1]!();
  } });
  assert.deepEqual(result.output, { answer: 42 });
  assert.equal(payloads.length, 3);
  assert.match(JSON.stringify(payloads[1]), /does not accept image tool results|photo.png|notes.txt/);
});

test("authenticated inputModalities image provenance prepares and transports a PNG through the worker", { timeout: 30000 }, async t => {
  const f = await grokFixture(t, "grok-4.6", { input: ["text", "image"], inputProvenance: "authenticated-input-modalities" });
  const { discoverWorkflowCatalog } = await import("../src/model-runtime.js");
  const models = await discoverWorkflowCatalog(f.options);
  const grok = models.models.find(model => model.provider === "xai-auth" && model.id === f.id);
  assert.equal(grok?.capabilities?.raw.input.state, "supported");
  assert.equal(grok?.capabilities?.raw.input.provenance, "authenticated-input-modalities");
  assert.equal(grok?.capabilities?.effective.toolResult.state, "supported");
  const plan = await prepareExecutionPlan({
    schemaVersion: 1, id: "modalities", name: "modalities", revision: 1, entryGraph: "main",
    graphs: { main: { entry: "work", nodes: [
      { id: "work", kind: "agent", role: "general", task: { op: "literal", value: "See" }, config: { tools: ["read"], thinking: "high", requirements: { toolResultModalities: ["image"] } } },
      { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "work"] } },
    ], edges: [{ from: "work", to: "done" }] } },
  }, { cwd: f.directory, availableModels: models.models });
  assert.equal(plan.agents.main!.work!.capabilities?.effective.toolResult.state, "supported");
  await writeFile(join(f.directory, "panel.png"), pngDigit(7));
  const runtime = await createWorkflowModelRuntime(f.options);
  const payloads: unknown[] = [];
  const script = [
    () => grokSse("read", { path: "panel.png" }),
    () => grokSse("submit_result", { answer: 7 }),
  ];
  const result = await executePiWorker({
    version: 1, cwd: f.directory, resourceDirectory: join(f.directory, "resources"), sessionDirectory: join(f.directory, "sessions"),
    task: "Read the panel and submit.", input: {},
    config: { ...plan.agents.main!.work!, session: "fresh", outputSchema: { type: "object", additionalProperties: false, properties: { answer: { type: "integer" } }, required: ["answer"] } },
  }, { modelRuntime: runtime, providerFetch: async (_input, init) => {
    const payload = JSON.parse(String(init?.body));
    payloads.push(payload);
    return script[payloads.length - 1]!();
  } });
  assert.deepEqual(result.output, { answer: 7 });
  assert.ok(payloads.some(payload => extractImages(payload).some(image => image.mimeType === "image/png")));
});

async function writerThenAdapterFailure(t: TestContext, mutate: (scratch: string) => Promise<void> | void, sdkIdentity?: () => SdkIdentity): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), "dynamicwf-adapter-live-"));
  t.after(async () => { await rm(scratch, { recursive: true, force: true }); });
  await cp(packageRoot, scratch, { recursive: true });
  const f = await grokFixture(t);
  const runtime = await createWorkflowModelRuntime({ ...f.options, grok: { ...f.options.grok, packageRoot: scratch, ...(sdkIdentity ? { sdkIdentity } : {}) } });
  let fetches = 0;
  await assert.rejects(executePiWorker({
    version: 1, cwd: f.directory, resourceDirectory: join(f.directory, "resources"), sessionDirectory: join(f.directory, "sessions"),
    task: "Write then continue.", input: {},
    config: { model: { provider: "xai-auth", id: f.id }, thinking: "high", tools: ["write"], systemPrompt: "Use tools.", skills: [], session: "fresh", permission: "workspace-write",
      outputSchema: { type: "object", additionalProperties: false, properties: { answer: { type: "integer" } }, required: ["answer"] } },
  }, { modelRuntime: runtime, providerFetch: async () => {
    fetches++;
    if (fetches === 1) {
      await mutate(scratch);
      return grokSse("write", { path: "artifact.txt", content: "written" });
    }
    throw new Error("second request must not be sent");
  } }), (error: unknown) => {
    assert.ok(error instanceof ExecutionFailure, String(error));
    assert.equal(error.failure.code, "configuration");
    assert.equal(error.failure.effects, "unknown");
    assert.equal(error.failure.diagnostic?.subcode, "adapter-content-mismatch");
    assert.equal(error.failure.diagnostic?.dispatch, "not-dispatched");
    assert.equal(error.failure.diagnostic?.sentReasoning, undefined);
    const publicText = JSON.stringify(error.failure);
    assert.doesNotMatch(publicText, /TEST_ACCESS|TEST_REFRESH|ENOENT|EACCES/);
    assert.doesNotMatch(error.failure.message, new RegExp(scratch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(publicText, new RegExp(scratch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    return true;
  });
  assert.equal(fetches, 1);
  assert.equal(await readFile(join(f.directory, "artifact.txt"), "utf8"), "written");
}

test("scratch adapter manifest failure after writer admission is a local not-dispatched configuration error", { timeout: 30000 }, async t => {
  await writerThenAdapterFailure(t, async scratch => { await writeFile(join(scratch, "package.json"), "{not-json"); });
});

test("scratch adapter identity/version failure after writer admission is a local not-dispatched configuration error", { timeout: 30000 }, async t => {
  await writerThenAdapterFailure(t, async scratch => {
    await writeFile(join(scratch, "package.json"), JSON.stringify({ name: "pi-xai-oauth", version: "9.9.9" }));
  });
});

test("SDK mismatch after writer admission is a local not-dispatched configuration error", { timeout: 30000 }, async t => {
  let sdk = readInstalledSdkIdentity();
  await writerThenAdapterFailure(t, () => {
    sdk = { piAi: "0.0.0", piCodingAgent: reviewedSdkVersions.piCodingAgent, piAgentCore: reviewedSdkVersions.piAgentCore };
  }, () => sdk);
});

function ioTurn(invocation: ToolIoTurn["invocation"], index: number, calls: ToolIoTurn["calls"], results: ToolIoTurn["results"] = calls.map(call => ({ id: call.id }))): ToolIoTurn {
  return { invocation, index, calls, results };
}

test("current-invocation ls round trips ignore historical payload ids and same-turn submit", () => {
  assert.equal(normalizeTransportToolCallId("call_ls_new|fc_ls_new"), "call_ls_new");
  assert.equal(normalizeTransportToolCallId("call_plain"), "call_plain");
  assert.equal(normalizeTransportToolCallId("  "), "");

  const extracted = extractToolIO({
    input: [
      { type: "function_call", id: "fc_hist", call_id: "call_hist", name: "ls", arguments: "{}" },
      { type: "function_call_output", call_id: "call_hist", output: "old listing" },
      { type: "function_call", id: "fc_ls_new", call_id: "call_ls_new", name: "ls", arguments: "{}" },
      { type: "function_call_output", call_id: "call_ls_new", output: "fresh listing" },
    ],
  });
  assert.deepEqual(extracted.calls.map(call => call.id), ["call_hist", "call_ls_new"]);
  assert.deepEqual(extracted.results.map(result => result.id), ["call_hist", "call_ls_new"]);

  const historicalSecond: ToolIoTurn[] = [
    ioTurn("second", 0, [{ name: "ls", id: "call_hist" }, { name: "submit_result", id: "call_submit_1" }]),
    ioTurn("second", 1, [{ name: "ls", id: "call_hist" }, { name: "submit_result", id: "call_submit_1" }, { name: "ls", id: "call_ls_new" }]),
  ];
  assert.equal(lsRoundTripConsumed([], historicalSecond, "second"), false, "history-only payload ls cannot prove current consumption");

  const completions: SuccessfulLsCompletion[] = [];
  assert.equal(recordSuccessfulLsCompletion(completions, { invocation: "second", toolCallId: "call_ls_new|fc_ls_new", afterRequestIndex: -1 }), undefined);
  assert.equal(completions.length, 0);
  recordSuccessfulLsCompletion(completions, { invocation: "second", toolCallId: "call_ls_new|fc_ls_new", afterRequestIndex: lastOutboundIndex([historicalSecond[0]!], "second") });
  assert.deepEqual(completions[0], { invocation: "second", toolName: "ls", succeeded: true, toolCallId: "call_ls_new", afterRequestIndex: 0 });

  const sameTurn: ToolIoTurn[] = [ioTurn("second", 0, [{ name: "ls", id: "call_hist" }, { name: "ls", id: "call_ls_new" }, { name: "submit_result", id: "call_submit_2" }])];
  assert.equal(consumedRequestIndex(completions[0]!, sameTurn), undefined, "ls result in the completion request is not a later consumption");
  assert.equal(lsRoundTripConsumed(completions, sameTurn, "second"), false);

  let submissions = 0;
  const prepareArguments = (raw: unknown) => { submissions++; return raw; };
  const gatedPrepare = (turns: ToolIoTurn[], raw: unknown) => {
    if (!lsRoundTripConsumed(completions, turns, "second")) throw new Error("blocked");
    return prepareArguments(raw);
  };
  assert.throws(() => gatedPrepare(sameTurn, { listed: true }), /blocked/);
  assert.equal(submissions, 0, "rejected submit must not increment the worker submission count");

  const later = [
    ioTurn("second", 0, [{ name: "read", id: "call_read" }, { name: "ls", id: "call_hist" }]),
    ioTurn("second", 1, [{ name: "ls", id: "call_hist" }, { name: "ls", id: "call_ls_new" }]),
  ];
  assert.equal(consumedRequestIndex(completions[0]!, later), 1);
  assert.equal(lsRoundTripConsumed(completions, later, "second"), true);
  assert.deepEqual(provenLsRoundTrips(completions, later), [{
    invocation: "second", toolName: "ls", succeeded: true, toolCallId: "call_ls_new", afterRequestIndex: 0, consumedRequestIndex: 1,
  }]);
  assert.deepEqual(publishedLsRoundTrips(completions, later, id => `redacted:${id}`), [{
    invocation: "second", toolName: "ls", succeeded: true, toolCallId: "redacted:call_ls_new", afterRequestIndex: 0, consumedRequestIndex: 1,
  }]);
  assert.equal((gatedPrepare(later, { listed: true }) as { listed: boolean }).listed, true);
  assert.equal(submissions, 1);

  const firstCompletions: SuccessfulLsCompletion[] = [];
  recordSuccessfulLsCompletion(firstCompletions, { invocation: "first", toolCallId: "call_hist", afterRequestIndex: 1 });
  const firstTurns = [
    ioTurn("first", 0, []),
    ioTurn("first", 1, [{ name: "read", id: "call_read" }]),
    ioTurn("first", 2, [{ name: "read", id: "call_read" }, { name: "ls", id: "call_hist" }]),
  ];
  assert.equal(lsRoundTripConsumed(firstCompletions, firstTurns, "first"), true);
  assert.equal(lsRoundTripConsumed(firstCompletions, historicalSecond, "second"), false, "a prior invocation's ls id replayed in continuation history is not a fresh round trip");
});

test("live evidence publication is portable without a sibling control directory", async t => {
  const layout = await mkdtemp(join(tmpdir(), "dynamicwf-live-evidence-"));
  t.after(async () => { await rm(layout, { recursive: true, force: true }); });
  const checkout = join(layout, "candidate");
  await mkdir(checkout);
  const resolved = resolveRepairLiveEvidencePath({ packageRoot: checkout, env: {} });
  assert.equal(resolved.source, "default");
  assert.equal(resolved.path, defaultRepairLiveEvidencePath(checkout));
  assert.equal(resolved.path, join(checkout, "scratch", "repair-live-latest.json"));
  assert.doesNotMatch(resolved.path, /control\/evidence/);
  await publishRepairLiveEvidence(resolved.path, "{\"ok\":true}\n");
  assert.equal(await readFile(resolved.path, "utf8"), "{\"ok\":true}\n");

  const overrideDir = join(layout, "explicit", "nested");
  const overridePath = join(overrideDir, "repair-live-latest.json");
  const overridden = resolveRepairLiveEvidencePath({
    packageRoot: checkout,
    cwd: layout,
    env: { [REPAIR_LIVE_EVIDENCE_ENV]: join("explicit", "nested", "repair-live-latest.json") },
  });
  assert.equal(overridden.source, "override");
  assert.equal(overridden.path, overridePath);
  await publishRepairLiveEvidence(overridden.path, "{\"override\":true}\n");
  assert.equal(await readFile(overridePath, "utf8"), "{\"override\":true}\n");

  const blocked = join(layout, "blocked-file");
  await writeFile(blocked, "not-a-directory");
  await assert.rejects(publishRepairLiveEvidence(join(blocked, "repair-live-latest.json"), "{}\n"));
  assert.equal(await readFile(blocked, "utf8"), "not-a-directory");
  assert.ok(!existsSync(join(layout, "control")));
  assert.ok(!existsSync(resolve(checkout, "../control/evidence")));
});

test("default live evidence publication leaves an existing sibling control directory unchanged", async t => {
  const layout = await mkdtemp(join(tmpdir(), "dynamicwf-live-evidence-sibling-"));
  t.after(async () => { await rm(layout, { recursive: true, force: true }); });
  const checkout = join(layout, "candidate");
  const siblingDir = join(layout, "control", "evidence");
  const siblingPath = join(siblingDir, "repair-live-latest.json");
  const sentinelPath = join(siblingDir, "SENTINEL");
  await mkdir(checkout);
  await mkdir(siblingDir, { recursive: true });
  await writeFile(sentinelPath, "keep-me\n");

  const resolved = resolveRepairLiveEvidencePath({ packageRoot: checkout, env: {} });
  assert.equal(resolved.source, "default");
  assert.equal(resolved.path, join(checkout, "scratch", "repair-live-latest.json"));
  assert.notEqual(resolved.path, siblingPath);
  await publishRepairLiveEvidence(resolved.path, "{\"ok\":true}\n");
  assert.equal(await readFile(resolved.path, "utf8"), "{\"ok\":true}\n");
  assert.equal(await readFile(sentinelPath, "utf8"), "keep-me\n");
  assert.ok(!existsSync(siblingPath));

  const overridden = resolveRepairLiveEvidencePath({
    packageRoot: checkout,
    env: { [REPAIR_LIVE_EVIDENCE_ENV]: siblingPath },
  });
  assert.equal(overridden.source, "override");
  assert.equal(overridden.path, siblingPath);
  await publishRepairLiveEvidence(overridden.path, "{\"override\":true}\n");
  assert.equal(await readFile(siblingPath, "utf8"), "{\"override\":true}\n");
  assert.equal(await readFile(sentinelPath, "utf8"), "keep-me\n");
  assert.equal(await readFile(resolved.path, "utf8"), "{\"ok\":true}\n");

  const blocked = join(siblingDir, "blocked-file");
  await writeFile(blocked, "not-a-directory");
  await assert.rejects(publishRepairLiveEvidence(join(blocked, "repair-live-latest.json"), "{}\n"));
  assert.equal(await readFile(blocked, "utf8"), "not-a-directory");
  assert.equal(await readFile(sentinelPath, "utf8"), "keep-me\n");
  assert.equal(await readFile(siblingPath, "utf8"), "{\"override\":true}\n");
});
