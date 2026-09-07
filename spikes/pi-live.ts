/** Opt-in paid/live probe: never runs as part of the offline test suite. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  createAgentSession, DefaultResourceLoader, defineTool, ModelRuntime,
  SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";

const { values } = parseArgs({ options: {
  provider: { type: "string" }, model: { type: "string" },
} });
if (!values.provider || !values.model) {
  throw new Error("Explicit --provider and --model are required for the live probe");
}
const runtime = await ModelRuntime.create({ allowModelNetwork: false });
const model = runtime.getAvailableSnapshot().find(m =>
  m.provider === values.provider && m.id === values.model);
if (!model) throw new Error("Requested model is not available in pi's authenticated catalog");

const directory = await mkdtemp(join(tmpdir(), "dynamicwf-pi-live-"));
const nonce = randomUUID();
const schema = Type.Object({ nonce: Type.Literal(nonce), answer: Type.Literal(42) },
  { additionalProperties: false });
let result: { nonce: string; answer: 42 } | undefined;
let submissions = 0;
const events: string[] = [];
const settings = SettingsManager.inMemory({
  retry: { enabled: false }, compaction: { enabled: false },
});
const loader = new DefaultResourceLoader({
  cwd: directory, agentDir: directory, settingsManager: settings,
  noExtensions: true, noSkills: true, noPromptTemplates: true,
  noThemes: true, noContextFiles: true,
  systemPrompt: "Solve the provided arithmetic task and submit the result using submit_result exactly once. Do not use any other tools.",
});

try {
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: directory, agentDir: directory, modelRuntime: runtime, model,
    thinkingLevel: "low", settingsManager: settings, resourceLoader: loader,
    sessionManager: SessionManager.create(directory, join(directory, "sessions")),
    tools: ["submit_result"],
    customTools: [defineTool({
      name: "submit_result", label: "Submit verified result",
      description: "Submit the answer and the exact nonce from the task.",
      parameters: schema,
      prepareArguments(args) {
        if (!Check(schema, args)) throw new Error("Invalid raw submission");
        return args;
      },
      async execute(_id, args) {
        if (result) throw new Error("Result already submitted");
        assert.ok(Check(schema, args));
        result = args;
        submissions++;
        return { content: [{ type: "text", text: "Accepted." }], details: {} };
      },
    })],
  });
  const unsubscribe = session.subscribe(event => { events.push(event.type); });
  // Probe-only deadline; this is not a product/run default limit.
  const timeout = setTimeout(() => {
    session.clearQueue();
    void session.abort();
  }, 90_000);
  const previousStop = session.agent.shouldStopAfterTurn;
  session.agent.shouldStopAfterTurn = async (context, signal) =>
    result !== undefined || (await previousStop?.(context, signal) ?? false);
  try {
    assert.deepEqual(session.getActiveToolNames(), ["submit_result"]);
    assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
    assert.deepEqual(loader.getSkills().skills, []);
    assert.deepEqual(loader.getExtensions().extensions, []);
    await session.prompt(`What is 6 * 7? Submit {nonce: ${JSON.stringify(nonce)}, answer: the number}.`);
    assert.deepEqual(result, { nonce, answer: 42 });
    assert.equal(submissions, 1);
    assert.ok(events.lastIndexOf("agent_settled") > events.lastIndexOf("agent_end"));
    assert.equal(session.isStreaming, false);
    const assistantMessages = session.messages.filter(m => m.role === "assistant");
    assert.ok(assistantMessages.length > 0);
    assert.ok(assistantMessages.every(m => m.stopReason !== "error" && m.stopReason !== "aborted"));
    const sessionFile = session.sessionFile;
    assert.ok(sessionFile);
    const restored = SessionManager.open(sessionFile);
    assert.equal(restored.getSessionId(), session.sessionId);
    assert.ok(restored.getEntries().some(entry => entry.type === "message"));
    console.log(JSON.stringify({
      passed: true, provider: model.provider, model: model.id,
      thinking: session.thinkingLevel, activeTools: session.getActiveToolNames(),
      submissions, assistantMessages: assistantMessages.length,
      inputTokens: assistantMessages.reduce((n, m) => n + m.usage.input, 0),
      outputTokens: assistantMessages.reduce((n, m) => n + m.usage.output, 0),
      settledAfterAgentEnd: true, transcriptReopened: true,
      externalResourcesLoaded: false,
    }, null, 2));
  } finally {
    clearTimeout(timeout);
    session.clearQueue();
    await session.abort();
    unsubscribe();
    session.dispose();
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
