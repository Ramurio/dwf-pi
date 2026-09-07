import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createAssistantMessageEventStream, InMemoryCredentialStore, InMemoryModelsStore, type AssistantMessage, type Context, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { executePiWorker, type PiWorkerOptions } from "../src/pi-worker.js";
import type { PiWorkerRequest } from "../src/execution-types.js";

const provider = "dynamicwf-worker-test";
const modelId = "offline-scripted";
function reply(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return { role: "assistant", content, stopReason, provider, model: modelId, api: "openai-completions", timestamp: 1,
    usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
const submit = (args: Record<string, unknown> = { answer: 42 }) => reply([{ type: "toolCall", id: "result", name: "submit_result", arguments: args }], "toolUse");
type Step = (context: Context, options?: SimpleStreamOptions) => AssistantMessage | Promise<AssistantMessage>;
function gate() { let resolve!: () => void; const promise = new Promise<void>(res => { resolve = res; }); return { promise, resolve }; }
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

test("actual SDK worker returns exact output, curated events, usage and persisted session after settlement", async t => {
  const f = await fixture(t, [() => submit()]);
  const result = await executePiWorker(f.request, f.options);
  assert.deepEqual(result.output, { answer: 42 });
  assert.deepEqual(result.usage, { input: 2, output: 3, totalTokens: 5, cost: 0 });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0]?.tools?.map(tool => tool.name), ["submit_result"]);
  assert.ok(f.events.some((e: any) => e.type === "agent_settled"));
  assert.doesNotMatch(JSON.stringify(f.events), /TASK_MARKER|TEST_CREDENTIAL|answer/);
  assert.ok(SessionManager.open(result.sessionFile).getEntries().some(entry => entry.type === "message"));
});

for (const [name, step, expected] of [
  ["missing result", () => reply([{ type: "text", text: '{"answer":42}' }]), /without exactly one/],
  ["coercible output", () => submit({ answer: "42" }), /strict output schema/],
  ["additional property", () => submit({ answer: 42, extra: true }), /strict output schema/],
  ["missing property", () => submit({}), /strict output schema/],
  ["duplicate submissions in one turn", () => reply([{ type: "toolCall", id: "one", name: "submit_result", arguments: { answer: 42 } }, { type: "toolCall", id: "two", name: "submit_result", arguments: { answer: 42 } }], "toolUse"), /more than once/],
  ["assistant failure", () => reply([], "error"), /assistant turn failed/],
] as const) test(`worker rejects ${name}`, async t => { const f = await fixture(t, [step]); await assert.rejects(executePiWorker(f.request, f.options), expected); });

test("cancellation drains queued followup and steering before abort and disposes settled session", { timeout: 10000 }, async t => {
  const entered = gate();
  const f = await fixture(t, [async (_context, options) => {
    entered.resolve(); await new Promise<void>(res => { if (options?.signal?.aborted) res(); else options?.signal?.addEventListener("abort", () => res(), { once: true }); }); return reply([], "aborted");
  }]);
  const controller = new AbortController(); let session: any;
  const running = executePiWorker(f.request, { ...f.options, signal: controller.signal, onSession: value => { session = value; } });
  await entered.promise;
  await session.prompt("FORBIDDEN_FOLLOWUP", { streamingBehavior: "followUp" });
  await session.prompt("FORBIDDEN_STEER", { streamingBehavior: "steer" });
  controller.abort();
  await assert.rejects(running, /cancelled/);
  assert.equal(f.calls.length, 1); assert.equal(session.pendingMessageCount, 0); assert.equal(session.isIdle, true);
});

test("continued node reuses transcript and measures only new invocation usage", async t => {
  const f = await fixture(t, [() => submit(), () => submit({ answer: 43 })]);
  f.request.config.session = "continue-node";
  const first = await executePiWorker(f.request, f.options);
  const second = await executePiWorker({ ...f.request, task: "SECOND_TASK", sessionFile: first.sessionFile, resourceDirectory: join(f.directory, "resources-second") }, f.options);
  assert.equal(second.sessionFile, first.sessionFile);
  assert.deepEqual(second.output, { answer: 43 });
  assert.equal(second.usage.totalTokens, 5);
  assert.match(JSON.stringify(f.calls[1]?.messages), /TASK_MARKER/);
});

test("frozen resources exclude discovered project context and skills", async t => {
  const f = await fixture(t, [() => submit()]);
  await mkdir(join(f.request.cwd, ".pi", "skills", "poison"), { recursive: true });
  await writeFile(join(f.request.cwd, "AGENTS.md"), "POISON_PROJECT_CONTEXT");
  await writeFile(join(f.request.cwd, ".pi", "SYSTEM.md"), "POISON_SYSTEM");
  await writeFile(join(f.request.cwd, ".pi", "APPEND_SYSTEM.md"), "POISON_APPEND");
  await writeFile(join(f.request.cwd, ".pi", "skills", "poison", "SKILL.md"), "---\nname: poison\ndescription: unwanted\n---\nPOISON_SKILL");
  const text = "---\nname: selected\ndescription: frozen selected skill\n---\nFROZEN_SKILL_BODY";
  f.request.config.skills = [{ name: "selected", hash: "test", files: [{ path: "SKILL.md", base64: Buffer.from(text).toString("base64"), executable: false }, { path: "scripts/check.sh", base64: Buffer.from("echo frozen\n").toString("base64"), executable: true }] }];
  await executePiWorker(f.request, f.options);
  assert.doesNotMatch(f.calls[0]?.systemPrompt ?? "", /POISON/);
  assert.match(f.calls[0]?.systemPrompt ?? "", /FROZEN_PROMPT/);
  assert.equal(await readFile(join(f.request.resourceDirectory, "selected", "SKILL.md"), "utf8"), text);
});

for (const path of ["../escape", "/escape", "nested/../../escape", "nested\\escape", "nested//escape"]) test(`reject unsafe snapshot path ${path}`, async t => {
  const f = await fixture(t, []); f.request.config.skills = [{ name: "bad", hash: "test", files: [{ path: "SKILL.md", base64: "", executable: false }, { path, base64: "", executable: false }] }];
  await assert.rejects(executePiWorker(f.request, f.options), /Unsafe frozen skill path/); assert.equal(f.calls.length, 0);
});
test("reject symlink resource directory", async t => {
  const f = await fixture(t, []); await symlink(f.request.cwd, f.request.resourceDirectory);
  await assert.rejects(executePiWorker(f.request, f.options), /real directory/);
});
test("reject clamped thinking instead of silently changing configured model behavior", async t => {
  const f = await fixture(t, []); f.request.config.thinking = "high";
  await assert.rejects(executePiWorker(f.request, f.options), /unsupported/); assert.equal(f.calls.length, 0);
});
test("pre-cancelled worker admits no work", async t => {
  const f = await fixture(t, []); const controller = new AbortController(); controller.abort();
  await assert.rejects(executePiWorker(f.request, { ...f.options, signal: controller.signal }), /cancelled/); assert.equal(f.calls.length, 0);
});

test("a post-submission assistant error invalidates the recorded result", async t => {
  const f = await fixture(t, [() => submit()]);
  await assert.rejects(executePiWorker(f.request, { ...f.options, onSession(session) {
    session.agent.subscribe(event => { if (event.type === "agent_end") session.agent.state.messages.push(reply([], "error")); });
  } }), /assistant turn failed/);
});

test("worker awaits full agent settlement, including async end listeners", async t => {
  const f = await fixture(t, [() => submit()]);
  const entered = gate(), release = gate(); let done = false;
  const running = executePiWorker(f.request, { ...f.options, onSession(session) {
    session.agent.subscribe(async event => { if (event.type === "agent_end") { entered.resolve(); await release.promise; } });
  } }).then(result => { done = true; return result; });
  await entered.promise;
  assert.equal(done, false);
  assert.equal(f.events.some((event: any) => event.type === "agent_settled"), false);
  release.resolve();
  assert.deepEqual((await running).output, { answer: 42 });
});

test("fresh workers cannot accept continuation and read-only cannot grant bash", async t => {
  const f = await fixture(t, []);
  await assert.rejects(executePiWorker({ ...f.request, sessionFile: "/unused" }, f.options), /Fresh worker/);
  f.request.config.tools = ["bash"];
  await assert.rejects(executePiWorker(f.request, f.options), /read-only/);
  assert.equal(f.calls.length, 0);
});

test("worker child emits only NDJSON and terminal error for malformed input", { timeout: 10000 }, async () => {
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../src/pi-worker-process.ts", import.meta.url))], { stdio: ["pipe", "pipe", "pipe", "ipc"] });
  let output = ""; child.stdout!.on("data", chunk => { output += chunk.toString(); }); child.stderr!.resume();
  const exited = new Promise<number | null>((res, rej) => { child.on("error", rej); child.on("close", res); });
  child.stdin!.end("not JSON");
  assert.equal(await exited, 1);
  const messages = output.trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(messages.map(message => message.type), ["ready", "error"]);
});

for (const method of ["SIGTERM", "disconnect"] as const) test(`worker child cancels incomplete stdin on ${method}`, { timeout: 10000 }, async () => {
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../src/pi-worker-process.ts", import.meta.url))], { stdio: ["pipe", "pipe", "pipe", "ipc"] });
  let output = ""; let cancelled = false;
  child.stdout!.on("data", chunk => { output += chunk.toString(); if (!cancelled && output.includes('"ready"')) { cancelled = true; if (method === "disconnect") child.disconnect(); else child.kill(method); } }); child.stderr!.resume();
  const exited = new Promise<number | null>((res, rej) => { child.on("error", rej); child.on("exit", res); });
  assert.equal(await exited, 130);
  const messages = output.trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(messages.map(message => message.type), ["ready", "error"]);
  assert.equal(messages[1].error, "Pi worker cancelled");
});

test("a closed supervisor output pipe cancels bootstrap without an uncaught EPIPE", { timeout: 20_000 }, async t => {
  const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), fileURLToPath(new URL("../src/pi-worker-process.ts", import.meta.url))], { stdio: ["pipe", "pipe", "pipe", "ipc"] });
  let stderr = "";
  child.stderr!.setEncoding("utf8").on("data", data => { stderr += data; });
  child.stdin!.on("error", () => {});
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  const exited = new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
  child.stdout!.destroy();
  assert.equal(await exited, 130);
  assert.doesNotMatch(stderr, /Unhandled 'error' event|Error: write EPIPE/);
});

for (const alias of [undefined, "declared-alias"]) test(`frozen skill prepared from ${alias ? "declared alias" : "directory fallback"} runs through actual SDK`, async t => {
  const f = await fixture(t, [() => submit()]);
  const skillDirectory = join(f.request.cwd, "original-directory");
  await mkdir(skillDirectory);
  const content = `---\n${alias ? `name: ${alias}\n` : ""}description: A selected frozen skill\n---\nInspect assigned input.`;
  await writeFile(join(skillDirectory, "SKILL.md"), content);
  const { prepareExecutionPlan } = await import("../src/execution-plan.js");
  const plan = await prepareExecutionPlan({ schemaVersion: 1, id: "skills", name: "Skills", revision: 1, entryGraph: "main", graphs: { main: { entry: "work", nodes: [
    { id: "work", kind: "agent", role: "general", task: { op: "literal", value: "Submit result" }, config: { skills: ["original-directory"], thinking: "off", tools: [], outputSchema: f.request.config.outputSchema } },
    { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "work"] } },
  ], edges: [{ from: "work", to: "done" }] } } }, { cwd: f.request.cwd, availableModels: [{ provider, id: modelId, thinkingLevels: ["off"] }] });
  f.request.config = plan.agents.main!.work!;
  await rm(skillDirectory, { recursive: true });
  assert.deepEqual((await executePiWorker(f.request, f.options)).output, { answer: 42 });
  assert.equal(await readFile(join(f.request.resourceDirectory, alias ?? "original-directory", "SKILL.md"), "utf8"), content);
});

test("worker rejects unsafe skill names before filesystem admission", async t => {
  const f = await fixture(t, []);
  f.request.config.skills = [{ name: "../escape", hash: "test", files: [{ path: "SKILL.md", base64: "", executable: false }] }];
  await assert.rejects(executePiWorker(f.request, f.options), /Unsafe frozen skill name/);
});
