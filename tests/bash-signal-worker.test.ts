import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createAssistantMessageEventStream, InMemoryCredentialStore, InMemoryModelsStore, type AssistantMessage, type Context, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { executePiWorker, type PiWorkerOptions } from "../src/pi-worker.js";
import type { PiWorkerRequest } from "../src/execution-types.js";

const provider = "offline-bash-signal";
const modelId = "offline-scripted";
function reply(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return { role: "assistant", content, stopReason, provider, model: modelId, api: "openai-completions", timestamp: 1,
    usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
const submit = (args: Record<string, unknown> = { answer: 42 }) => reply([{ type: "toolCall", id: "result", name: "submit_result", arguments: args }], "toolUse");
type Step = (context: Context, options?: SimpleStreamOptions) => AssistantMessage | Promise<AssistantMessage>;
async function fixture(t: TestContext, steps: Step[]) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-worker-test-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const cwd = join(directory, "workspace");
  await mkdir(cwd);
  const request: PiWorkerRequest = { version: 1, config: { model: { provider, id: modelId }, thinking: "off", systemPrompt: "FROZEN_PROMPT", tools: [], skills: [], session: "fresh", permission: "read-only", outputSchema: { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"], additionalProperties: false } }, task: "TASK_MARKER", input: { request: 1 }, cwd, sessionDirectory: join(directory, "sessions"), resourceDirectory: join(directory, "resources") };
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const calls: Context[] = [];
  runtime.registerProvider(provider, { api: "openai-completions", baseUrl: "https://offline.invalid", apiKey: "TEST_CREDENTIAL_MUST_NOT_LEAK", models: [{ id: modelId, name: modelId, reasoning: false, input: ["text"], contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }], streamSimple(_model, context, options) {
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

test("offline worker reports real bash signal as tool error", async t => {
  const f = await fixture(t, [() => reply([{ type: "toolCall", id: "signal", name: "bash", arguments: { command: "printf evidence; kill -TERM $$" } }], "toolUse"), () => submit()]);
  f.request.config.permission = "workspace-write"; f.request.config.tools = ["bash"];
  assert.deepEqual((await executePiWorker(f.request, f.options)).output, { answer: 42 });
  const end = f.events.find((e: any) => e.type === "tool_execution_end" && e.toolName === "bash") as any;
  assert.ok(end); assert.equal(end.isError, true);
  // Worker public events intentionally omit tool payloads; inspect the actual SDK transcript.
  assert.match(JSON.stringify(f.calls[1]!.messages), /evidence/);
  assert.match(JSON.stringify(f.calls[1]!.messages), /SIGTERM/);
});
test("check-worker signal remains process/execution/unknown with exit 1 (no change)", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "src/check-worker-process.ts"], { stdio: ["pipe", "pipe", "pipe"] });
  let out = ""; child.stdout.on("data", chunk => { out += chunk; }); child.stderr.resume();
  const done = new Promise(resolve => child.on("close", resolve));
  child.stdin.end(JSON.stringify({ command: "/bin/bash", args: ["-c", "kill -TERM $$"], cwd: process.cwd() }));
  assert.equal(await done, 1);
  const result = JSON.parse(out); assert.equal(result.type, "error");
  assert.equal(result.failure.code, "process"); assert.equal(result.failure.phase, "execution"); assert.equal(result.failure.effects, "unknown");
  assert.match(result.failure.message, /SIGTERM/);
});
