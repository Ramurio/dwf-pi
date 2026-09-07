/** Actual pi session/agent/tool loop; only inference is a deterministic fake transport. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type AssistantMessage,
  type Context,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

const PROVIDER = "dynamicwf-deterministic-spike";
const MODEL = "scripted-model-no-inference";
const resultSchema = Type.Object({
  verdict: Type.Union([Type.Literal("approve"), Type.Literal("revise")]),
  score: Type.Integer({ minimum: 0, maximum: 10 }),
  summary: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
type SubmittedResult = Static<typeof resultSchema>;
type ScriptStep = (context: Context, options?: SimpleStreamOptions) => AssistantMessage | Promise<AssistantMessage>;

function reply(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return {
    role: "assistant", content, stopReason, api: "openai-completions", provider: PROVIDER,
    model: MODEL, timestamp: 1,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}
function textReply(text: string): AssistantMessage {
  return reply([{ type: "text", text }]);
}
function toolReply(name: string, args: Record<string, unknown>, id = "call-1"): AssistantMessage {
  return reply([{ type: "toolCall", id, name, arguments: args }], "toolUse");
}
function gate<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

async function fixture(t: TestContext, steps: ScriptStep[], options: { strictRaw?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-pi-contract-"));
  const cwd = join(directory, "workspace");
  const agentDir = join(directory, "agent");
  await mkdir(cwd);
  await mkdir(agentDir);
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  // Poison discoverable resources: their absence in the worker is asserted below.
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
  await mkdir(join(cwd, ".pi", "skills", "poison"), { recursive: true });
  await writeFile(join(cwd, "AGENTS.md"), "POISON_PROJECT_CONTEXT");
  await writeFile(join(agentDir, "AGENTS.md"), "POISON_GLOBAL_CONTEXT");
  await writeFile(join(cwd, ".pi", "SYSTEM.md"), "POISON_SYSTEM_PROMPT");
  await writeFile(join(cwd, ".pi", "APPEND_SYSTEM.md"), "POISON_APPEND_PROMPT");
  await writeFile(join(cwd, ".pi", "extensions", "poison.ts"), 'throw new Error("POISON_EXTENSION_LOADED");');
  await writeFile(join(cwd, ".pi", "skills", "poison", "SKILL.md"),
    "---\nname: poison\ndescription: must not be loaded\n---\nPOISON_SKILL");

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false }, retry: { enabled: false },
    enableInstallTelemetry: false, enableAnalytics: false,
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    noContextFiles: true, systemPrompt: "You are an isolated deterministic contract worker.",
    appendSystemPrompt: [],
  });
  await resourceLoader.reload();
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
    modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
  });
  const calls: Context[] = [];
  modelRuntime.registerProvider(PROVIDER, {
    api: "openai-completions", baseUrl: "https://deterministic-spike.invalid/v1",
    apiKey: "fake-test-credential-not-a-secret",
    models: [{ id: MODEL, name: MODEL, reasoning: false, input: ["text"],
      contextWindow: 100_000, maxTokens: 1000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(_model, context, streamOptions) {
      const stream = createAssistantMessageEventStream();
      const index = calls.length;
      calls.push({ ...context, messages: structuredClone(context.messages),
        ...(context.tools ? { tools: context.tools.map(({ name, description, parameters }) => ({ name, description, parameters })) } : {}),
      });
      void (async () => {
        try {
          const step = steps[index];
          assert.ok(step, `Unexpected model call ${index + 1}`);
          const message = await step(context, streamOptions);
          if (message.stopReason === "error" || message.stopReason === "aborted") {
            stream.push({ type: "error", reason: message.stopReason, error: message });
          } else {
            stream.push({ type: "start", partial: message });
            assert.notEqual(message.stopReason, "pending");
            if (message.stopReason === "pending") throw new Error("Pending is not a terminal scripted reply");
            stream.push({ type: "done", reason: message.stopReason, message });
          }
        } catch (error) {
          const failure = { ...reply([], "error"), errorMessage: String(error) };
          stream.push({ type: "error", reason: "error", error: failure });
        }
      })();
      return stream;
    },
  });
  const model = modelRuntime.getModel(PROVIDER, MODEL);
  assert.ok(model);
  const submitted: SubmittedResult[] = [];
  const submitResult = defineTool({
    name: "submit_result", label: "Submit result", description: "Submit one structured worker result.",
    parameters: resultSchema,
    ...(options.strictRaw === false ? {} : {
      prepareArguments(args: unknown): SubmittedResult {
        // SDK conversion is convenient for general tools, but unacceptable for workflow contracts.
        if (!Check(resultSchema, args)) throw new Error("Strict raw output contract validation failed");
        return args;
      },
    }),
    async execute(_id, params) {
      submitted.push(structuredClone(params));
      return { content: [{ type: "text", text: "Result recorded" }], details: params };
    },
  });
  const { session, extensionsResult } = await createAgentSession({
    cwd, agentDir, settingsManager, resourceLoader, modelRuntime, model,
    thinkingLevel: "off", tools: ["submit_result"], customTools: [submitResult],
    sessionManager: SessionManager.inMemory(cwd),
  });
  t.after(async () => { session.clearQueue(); await session.abort(); session.dispose(); });
  const events: AgentSessionEvent[] = [];
  session.subscribe((event) => { events.push(event); });
  return { session, resourceLoader, extensionsResult, submitted, calls, events };
}

const validResult = { verdict: "approve", score: 9, summary: "Checks passed" } as const;

test("actual pi SDK isolates resources, enforces a tool allowlist and settles after agent_end", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, [() => toolReply("submit_result", validResult), () => textReply("Done")]);
  assert.deepEqual(f.resourceLoader.getSkills().skills, []);
  assert.deepEqual(f.resourceLoader.getAgentsFiles().agentsFiles, []);
  assert.deepEqual(f.resourceLoader.getAppendSystemPrompt(), []);
  assert.deepEqual(f.extensionsResult.extensions, []);
  assert.deepEqual(f.extensionsResult.errors, []);
  assert.deepEqual(f.session.getActiveToolNames(), ["submit_result"]);
  assert.doesNotMatch(f.session.systemPrompt, /POISON/);
  const endListenerEntered = gate<void>();
  const releaseEndListener = gate<void>();
  const unsubscribe = f.session.agent.subscribe(async (event) => {
    if (event.type === "agent_end") { endListenerEntered.resolve(); await releaseEndListener.promise; }
  });
  t.after(unsubscribe);
  const prompt = f.session.prompt("Review and submit the result");
  await endListenerEntered.promise;
  assert.equal(f.session.isIdle, false);
  assert.equal(f.events.some((e) => e.type === "agent_settled"), false);
  releaseEndListener.resolve();
  await prompt;
  await f.session.waitForIdle();
  assert.deepEqual(f.submitted, [validResult], JSON.stringify({ calls: f.calls.length, messages: f.session.state.messages }));
  assert.equal(f.calls.length, 2);
  for (const context of f.calls) assert.deepEqual(context.tools?.map((tool) => tool.name), ["submit_result"]);
  const types = f.events.map((e) => e.type);
  assert.ok(types.indexOf("agent_settled") > types.indexOf("agent_end"));
  assert.equal(types.filter((type) => type === "agent_settled").length, 1);
  assert.equal(f.session.isIdle, true);
});

test("disallowed tool invocation becomes an error result without executing a builtin", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, [() => toolReply("bash", { command: "printf SHOULD_NEVER_EXECUTE" }), () => textReply("No output")]);
  await f.session.prompt("Only submit_result is available");
  assert.deepEqual(f.submitted, []);
  const result = f.session.state.messages.find((message) => message.role === "toolResult");
  assert.ok(result && result.role === "toolResult");
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /Tool bash not found/);
});

for (const [name, args] of Object.entries({
  missing_field: { verdict: "approve", score: 9 },
  wrong_enum: { ...validResult, verdict: "maybe" },
  additional_field: { ...validResult, unexpected: true },
  coercible_number: { ...validResult, score: "9" },
  empty_summary: { ...validResult, summary: "" },
})) {
  test(`strict submit_result rejects ${name} before execute`, { timeout: 10_000 }, async (t) => {
    const f = await fixture(t, [() => toolReply("submit_result", args), () => textReply("Stopped without valid output")]);
    await f.session.prompt("Submit result");
    assert.deepEqual(f.submitted, []);
    const result = f.session.state.messages.find((message) => message.role === "toolResult");
    assert.ok(result && result.role === "toolResult");
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /Strict raw output contract validation failed/);
    assert.equal(f.session.isIdle, true);
    // A settled/pi-success turn does not prove workflow-output success.
    assert.ok(f.events.some((event) => event.type === "agent_settled"));
  });
}

test("plain schema validation alone coerces string numbers: raw check is required", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, [() => toolReply("submit_result", { ...validResult, score: "9" }), () => textReply("Done")], { strictRaw: false });
  await f.session.prompt("Submit result");
  assert.deepEqual(f.submitted, [validResult], JSON.stringify({ calls: f.calls.length, messages: f.session.state.messages }));
});

test("text-only completion settles without a structured output: adapter must reject missing result", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, [() => textReply(JSON.stringify(validResult))]);
  await f.session.prompt("Submit result");
  assert.deepEqual(f.submitted, []);
  assert.equal(f.session.isIdle, true);
  assert.ok(f.events.some((event) => event.type === "agent_settled"));
});

test("clearQueue plus abort drains steering/followup and waits for transport settlement", { timeout: 10_000 }, async (t) => {
  const entered = gate<void>();
  const f = await fixture(t, [async (_context, options) => {
    assert.ok(options?.signal);
    entered.resolve();
    await new Promise<void>((resolve) => {
      if (options.signal?.aborted) resolve();
      else options.signal?.addEventListener("abort", () => resolve(), { once: true });
    });
    return { ...reply([], "aborted"), errorMessage: "Cancelled by deterministic spike" };
  }, () => textReply("Fresh request after cancellation")]);
  const prompt = f.session.prompt("Wait for cancellation");
  await entered.promise;
  await f.session.prompt("STEER_MUST_NOT_RUN", { streamingBehavior: "steer" });
  await f.session.prompt("FOLLOWUP_MUST_NOT_RUN", { streamingBehavior: "followUp" });
  assert.equal(f.session.pendingMessageCount, 2);
  assert.equal(f.session.agent.hasQueuedMessages(), true);
  assert.deepEqual(f.session.clearQueue(), { steering: ["STEER_MUST_NOT_RUN"], followUp: ["FOLLOWUP_MUST_NOT_RUN"] });
  await f.session.abort();
  await prompt;
  assert.equal(f.session.pendingMessageCount, 0);
  assert.equal(f.session.agent.hasQueuedMessages(), false);
  assert.equal(f.session.isIdle, true);
  assert.equal(f.calls.length, 1);
  await f.session.prompt("Start a fresh request");
  assert.equal(f.calls.length, 2);
  assert.doesNotMatch(JSON.stringify(f.calls[1]?.messages), /STEER_MUST_NOT_RUN|FOLLOWUP_MUST_NOT_RUN/);
});

test("two actual sessions keep transcript and result state isolated", { timeout: 10_000 }, async (t) => {
  const first = await fixture(t, [() => toolReply("submit_result", validResult), () => textReply("A_DONE")]);
  const otherResult = { verdict: "revise", score: 3, summary: "Needs correction" } as const;
  const second = await fixture(t, [() => toolReply("submit_result", otherResult), () => textReply("B_DONE")]);
  await Promise.all([first.session.prompt("SESSION_A_SECRET_MARKER"), second.session.prompt("SESSION_B_SECRET_MARKER")]);
  assert.deepEqual(first.submitted, [validResult]);
  assert.deepEqual(second.submitted, [otherResult]);
  assert.doesNotMatch(JSON.stringify(first.session.state.messages), /SESSION_B_SECRET_MARKER|B_DONE/);
  assert.doesNotMatch(JSON.stringify(second.session.state.messages), /SESSION_A_SECRET_MARKER|A_DONE/);
  assert.notEqual(first.session.sessionId, second.session.sessionId);
});

test("pi allows repeated submit_result calls: workflow must enforce its own single-result policy", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, [
    () => toolReply("submit_result", validResult, "first-submit"),
    () => toolReply("submit_result", { ...validResult, summary: "Second submission" }, "second-submit"),
    () => textReply("Done twice"),
  ]);
  await f.session.prompt("Submit result");
  assert.equal(f.submitted.length, 2);
  assert.equal(f.session.isIdle, true);
});

test("abort alone starts a queued followup: clear queues before cancelling a worker", { timeout: 10_000 }, async (t) => {
  const entered = gate<void>();
  const f = await fixture(t, [async (_context, options) => {
    assert.ok(options?.signal);
    entered.resolve();
    await new Promise<void>((resolve) => {
      if (options.signal?.aborted) resolve();
      else options.signal?.addEventListener("abort", () => resolve(), { once: true });
    });
    return { ...reply([], "aborted"), errorMessage: "Cancelled" };
  }, () => textReply("Queued followup was run after abort")]);
  const prompt = f.session.prompt("Wait for cancellation");
  await entered.promise;
  await f.session.prompt("QUEUED_BEFORE_ABORT", { streamingBehavior: "followUp" });
  await f.session.abort();
  await prompt;
  assert.equal(f.calls.length, 2);
  assert.match(JSON.stringify(f.calls[1]?.messages), /QUEUED_BEFORE_ABORT/);
  assert.equal(f.session.pendingMessageCount, 0);
  assert.equal(f.session.isIdle, true);
});
