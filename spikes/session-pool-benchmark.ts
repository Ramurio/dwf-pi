/** Offline createAgentSession pool experiment. Fake stream only; not Grok throughput. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setDefaultStreamFn } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type AssistantMessage,
  type Context,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { getApiProviders, streamSimple as globalStreamSimple } from "@earendil-works/pi-ai/compat";
import {
  AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

export const FAKE_INFERENCE_LIMITATION =
  "Fake injected inference is not Grok throughput. Elapsed construction/startup and RSS compare createAgentSession lifecycle under a deterministic local stream; they do not measure Grok tokens/s, latency, or provider concurrency.";
export const COMPARISON_SIZES = [1, 4, 8, 16] as const;
export const TIMING_SCOPE = {
  constructionMs: "createAgentSession only",
  startupMs: "per-session sessionSetup: SettingsManager/ResourceLoader + createAgentSession + fake stream until isIdle; excludes ModelRuntime.create and child Node spawn/import/hello",
  poolReadyMs: "parent-measured wall clock until the pool is ready: in-process includes ModelRuntime.create and all sessions; child-process includes spawn, import, hello, ModelRuntime.create and session create",
  notMeasured: "full OS/process cold start and Grok throughput",
} as const;
export const INSPECTED_GLOBAL_SDK_CLAIM =
  "Inspected only export identity of fetch, setDefaultStreamFn, compat.streamSimple, and getApiProviders() api names, plus no explicit setDefaultStreamFn/registerApiProvider/resetApiProviders/fetch mutations. Hidden default stream closure state is unobserved and is not claimed unchanged or isolated.";
const PROVIDER = "dynamicwf-session-pool-offline";
const MODEL = "fake-stream-not-grok";
const BENCH_PATH = fileURLToPath(import.meta.url);
const CHILD_MS = 60_000;

export type ScriptedTurn = (context: Context, options?: SimpleStreamOptions) => AssistantMessage | Promise<AssistantMessage>;
export interface Distribution { n: number; min: number; max: number; mean: number; p50: number; p90: number; }
export interface RssAccount {
  parentRssBytes: number;
  childrenRssBytes: number;
  childCount: number;
  accountedRssBytes: number;
  includesParentChildDoubleCount: false;
}
export interface AssistantTurnEvidence {
  stopReason: string;
  text: string;
  errorMessage?: string;
}
export interface PoolResult {
  mode: "in-process" | "child-process";
  n: number;
  constructionMs: Distribution;
  startupMs: Distribution;
  rss: RssAccount;
  accountedRssDistribution: Distribution;
  runtimeCreateMs?: number;
  poolReadyMs: number;
}
export interface ComparisonReport {
  limitation: string;
  timingScope: typeof TIMING_SCOPE;
  sizes: number[];
  includeChildProcess: boolean;
  results: PoolResult[];
}
export interface OfflineSession {
  id: string;
  session: AgentSession;
  cwd: string;
  constructionMs: number;
  startupMs: number;
}
type RuntimeModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;

export function requireSdkApis(): void {
  const missing: string[] = [];
  const needFn = (name: string, value: unknown) => {
    if (typeof value !== "function") missing.push(name);
  };
  needFn("createAgentSession", createAgentSession);
  needFn("ModelRuntime.create", ModelRuntime.create);
  needFn("ModelRuntime.registerProvider", ModelRuntime.prototype.registerProvider);
  needFn("SessionManager.inMemory", SessionManager.inMemory);
  needFn("SessionManager.getCwd", SessionManager.prototype.getCwd);
  needFn("SettingsManager.inMemory", SettingsManager.inMemory);
  needFn("DefaultResourceLoader", DefaultResourceLoader);
  needFn("AgentSession.prompt", AgentSession.prototype.prompt);
  needFn("AgentSession.abort", AgentSession.prototype.abort);
  needFn("AgentSession.dispose", AgentSession.prototype.dispose);
  needFn("AgentSession.waitForIdle", AgentSession.prototype.waitForIdle);
  needFn("AgentSession.clearQueue", AgentSession.prototype.clearQueue);
  needFn("setDefaultStreamFn", setDefaultStreamFn);
  needFn("compat.streamSimple", globalStreamSimple);
  needFn("getApiProviders", getApiProviders);
  needFn("createAssistantMessageEventStream", createAssistantMessageEventStream);
  if (missing.length > 0) {
    throw new Error(`Required SDK APIs unavailable (failing, not skipping): ${missing.join(", ")}`);
  }
}

export function snapshotGlobalSdkState() {
  return {
    fetch: globalThis.fetch,
    setDefaultStreamFn,
    globalStreamSimple,
    apiProviderApis: getApiProviders().map((provider) => provider.api),
  };
}

export function assertGlobalSdkStatePreserved(before: ReturnType<typeof snapshotGlobalSdkState>): void {
  const after = snapshotGlobalSdkState();
  assert.equal(after.fetch, before.fetch, "globalThis.fetch changed; experiment must not mutate SDK global fetch");
  assert.equal(after.setDefaultStreamFn, before.setDefaultStreamFn, "setDefaultStreamFn export identity changed");
  assert.equal(after.globalStreamSimple, before.globalStreamSimple, "compat streamSimple identity changed");
  assert.deepEqual(after.apiProviderApis, before.apiProviderApis, "global API provider registry changed; use ModelRuntime.registerProvider, not registerApiProvider");
}

export function sampleOwnRssBytes(): number {
  return process.memoryUsage.rss();
}

export function accountedRssBytes(parentRssBytes: number, ownedChildrenRssBytes: readonly number[]): RssAccount {
  if (!(parentRssBytes >= 0) || ownedChildrenRssBytes.some((value) => !(value >= 0))) {
    throw new Error("RSS samples must be non-negative");
  }
  const childrenRssBytes = ownedChildrenRssBytes.reduce((sum, value) => sum + value, 0);
  return {
    parentRssBytes,
    childrenRssBytes,
    childCount: ownedChildrenRssBytes.length,
    accountedRssBytes: parentRssBytes + childrenRssBytes,
    includesParentChildDoubleCount: false,
  };
}

export function summarize(samples: readonly number[]): Distribution {
  if (samples.length === 0) throw new Error("Cannot summarize empty samples");
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  const at = (p: number) => sorted[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))]!;
  return { n, min: sorted[0]!, max: sorted[n - 1]!, mean: sum / n, p50: at(0.5), p90: at(0.9) };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function msSince(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function reply(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return {
    role: "assistant",
    content,
    stopReason,
    api: "openai-completions",
    provider: PROVIDER,
    model: MODEL,
    timestamp: Date.now(),
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

function textReply(text: string): AssistantMessage {
  return reply([{ type: "text", text }]);
}

function echoTurn(id: string): ScriptedTurn {
  return () => textReply(`offline-echo:${id}`);
}

function errorTurn(message: string): ScriptedTurn {
  return () => ({ ...reply([], "error"), errorMessage: message });
}

function hangUntilAbortTurn(entered: { resolve: () => void }): ScriptedTurn {
  return async (_context, options) => {
    if (!options?.signal) throw new Error("Required stream abort signal is unavailable (failing, not skipping)");
    entered.resolve();
    await new Promise<void>((resolve) => {
      if (options.signal?.aborted) resolve();
      else options.signal?.addEventListener("abort", () => resolve(), { once: true });
    });
    return { ...reply([], "aborted"), errorMessage: "offline-aborted" };
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function gatedEchoTurn(id: string, entered: { resolve: () => void }, released: Promise<void>): ScriptedTurn {
  return async (_context, options) => {
    entered.resolve();
    await released;
    if (options?.signal?.aborted) {
      return { ...reply([], "aborted"), errorMessage: "offline-aborted-before-release" };
    }
    return textReply(`offline-echo:${id}`);
  };
}

function pushScripted(stream: ReturnType<typeof createAssistantMessageEventStream>, message: AssistantMessage): void {
  if (message.stopReason === "pending") throw new Error("Pending is not a terminal scripted reply");
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    stream.push({ type: "error", reason: message.stopReason, error: message });
    return;
  }
  stream.push({ type: "start", partial: message });
  stream.push({ type: "done", reason: message.stopReason, message });
}

function installScriptedStream(session: AgentSession, turns: ScriptedTurn[]): void {
  let index = 0;
  session.agent.streamFunction = (_model, context, options) => {
    const stream = createAssistantMessageEventStream();
    const stepIndex = index++;
    const step = turns[stepIndex];
    void (async () => {
      try {
        if (!step) throw new Error(`Unexpected model call ${stepIndex + 1} in offline script`);
        pushScripted(stream, await step(context, options));
      } catch (error) {
        pushScripted(stream, { ...reply([], "error"), errorMessage: error instanceof Error ? error.message : String(error) });
      }
    })();
    return stream;
  };
  session.agent.shouldStopAfterTurn = async () => true;
}

function registerOfflineProvider(runtime: ModelRuntime): void {
  runtime.registerProvider(PROVIDER, {
    api: "openai-completions",
    baseUrl: "https://session-pool-offline.invalid/v1",
    apiKey: "fake-test-credential-not-a-secret",
    models: [{
      id: MODEL, name: MODEL, reasoning: false, input: ["text"],
      contextWindow: 100_000, maxTokens: 1000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }],
    streamSimple(_model, context, streamOptions) {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        try {
          pushScripted(stream, await echoTurn("provider-fallback")(context, streamOptions));
        } catch (error) {
          pushScripted(stream, { ...reply([], "error"), errorMessage: error instanceof Error ? error.message : String(error) });
        }
      })();
      return stream;
    },
  });
}

export async function createOfflineRuntime(): Promise<{ runtime: ModelRuntime; model: RuntimeModel }> {
  requireSdkApis();
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  registerOfflineProvider(runtime);
  const model = runtime.getModel(PROVIDER, MODEL);
  if (!model) throw new Error("registerProvider did not publish the offline model (failing, not skipping)");
  return { runtime, model };
}

export async function createOfflineSession(options: {
  root: string;
  id: string;
  runtime: ModelRuntime;
  model: RuntimeModel;
  turns?: ScriptedTurn[];
  systemPrompt?: string;
}): Promise<OfflineSession> {
  requireSdkApis();
  const cwd = join(options.root, options.id, "cwd");
  const agentDir = join(options.root, options.id, "agent");
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  const sessionSetupStart = process.hrtime.bigint();
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
    enableInstallTelemetry: false,
    enableAnalytics: false,
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPrompt: options.systemPrompt ?? `offline-pool session=${options.id}`,
    appendSystemPrompt: [],
  });
  await resourceLoader.reload();
  const constructionStart = process.hrtime.bigint();
  const created = await createAgentSession({
    cwd, agentDir, settingsManager, resourceLoader,
    modelRuntime: options.runtime, model: options.model,
    thinkingLevel: "off", tools: [],
    sessionManager: SessionManager.inMemory(cwd),
  });
  const constructionMs = msSince(constructionStart);
  installScriptedStream(created.session, options.turns ?? [echoTurn(options.id)]);
  const startupMs = msSince(sessionSetupStart);
  assert.equal(created.session.isIdle, true);
  return { id: options.id, session: created.session, cwd: created.session.sessionManager.getCwd(), constructionMs, startupMs };
}

export async function disposeOfflineSession(session: AgentSession): Promise<void> {
  try { session.clearQueue(); } catch { /* already torn down */ }
  try { await session.abort(); } catch { /* already torn down */ }
  try { session.dispose(); } catch { /* already torn down */ }
}

async function promptSettled(session: AgentSession, text: string): Promise<{ rejected?: string }> {
  try {
    await session.prompt(text, { expandPromptTemplates: false });
    await session.waitForIdle();
    return {};
  } catch (error) {
    try { await session.waitForIdle(); } catch { /* still report rejection */ }
    return { rejected: error instanceof Error ? error.message : String(error) };
  }
}

function assistantText(message: { content?: unknown }): string {
  if (!Array.isArray(message.content)) return "";
  const parts: string[] = [];
  for (const part of message.content) {
    if (
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
    ) {
      parts.push(part.text);
    }
  }
  return parts.join("");
}

export function collectAssistantTurns(session: AgentSession): AssistantTurnEvidence[] {
  const turns: AssistantTurnEvidence[] = [];
  for (const message of session.messages) {
    if (message.role !== "assistant") continue;
    if (!("stopReason" in message) || typeof message.stopReason !== "string") continue;
    const evidence: AssistantTurnEvidence = {
      stopReason: message.stopReason,
      text: assistantText(message),
    };
    if ("errorMessage" in message && typeof message.errorMessage === "string") {
      evidence.errorMessage = message.errorMessage;
    }
    turns.push(evidence);
  }
  return turns;
}

export function requireSuccessfulTurn(turn: AssistantTurnEvidence, expectedEcho: string): AssistantTurnEvidence {
  if (turn.stopReason !== "stop") {
    throw new Error(`stopReason=${turn.stopReason} cannot count as success${turn.errorMessage ? `: ${turn.errorMessage}` : ""}`);
  }
  if (turn.errorMessage !== undefined && turn.errorMessage.length > 0) {
    throw new Error(`errorMessage cannot count as success: ${turn.errorMessage}`);
  }
  if (turn.text !== expectedEcho) {
    throw new Error(`assistant echo mismatch: expected ${JSON.stringify(expectedEcho)} in ${JSON.stringify(turn.text)}`);
  }
  return turn;
}

async function requireSuccessfulPrompt(session: AgentSession, text: string, expectedEcho: string): Promise<AssistantTurnEvidence> {
  const beforeCount = collectAssistantTurns(session).length;
  const settled = await promptSettled(session, text);
  const created = collectAssistantTurns(session).slice(beforeCount);
  const last = created.at(-1);
  if (settled.rejected) {
    throw new Error(`prompt rejected; isIdle=${session.isIdle} userPresent=${transcript(session).includes(text)} last=${JSON.stringify(last)}: ${settled.rejected}`);
  }
  if (!last) {
    throw new Error(`prompt() resolved and isIdle=${session.isIdle} userPresent=${transcript(session).includes(text)} but no assistant turn; that is not model success`);
  }
  return requireSuccessfulTurn(last, expectedEcho);
}

function transcript(session: AgentSession): string {
  return JSON.stringify(session.messages);
}

async function withTwoSessions<T>(
  turnsA: ScriptedTurn[],
  turnsB: ScriptedTurn[],
  work: (a: OfflineSession, b: OfflineSession) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "dynamicwf-sdk-pool-life-"));
  const before = snapshotGlobalSdkState();
  let a: OfflineSession | undefined;
  let b: OfflineSession | undefined;
  try {
    const { runtime, model } = await createOfflineRuntime();
    a = await createOfflineSession({ root, id: "a", runtime, model, turns: turnsA, systemPrompt: "offline-pool session=a" });
    b = await createOfflineSession({ root, id: "b", runtime, model, turns: turnsB, systemPrompt: "offline-pool session=b" });
    const result = await work(a, b);
    assertGlobalSdkStatePreserved(before);
    return result;
  } finally {
    if (a) await disposeOfflineSession(a.session);
    if (b) await disposeOfflineSession(b.session);
    await rm(root, { recursive: true, force: true });
  }
}

export async function runIsolationCheck(): Promise<{
  ok: true;
  sessionIds: [string, string];
  cwds: [string, string];
  assistants: [{ stopReason: "stop"; text: string }, { stopReason: "stop"; text: string }];
}> {
  return withTwoSessions([echoTurn("a")], [echoTurn("b")], async (a, b) => {
    const [assistantA, assistantB] = await Promise.all([
      requireSuccessfulPrompt(a.session, "SESSION_A_SECRET_MARKER", "offline-echo:a"),
      requireSuccessfulPrompt(b.session, "SESSION_B_SECRET_MARKER", "offline-echo:b"),
    ]);
    assert.notEqual(a.session.sessionId, b.session.sessionId);
    assert.notEqual(a.cwd, b.cwd);
    assert.notEqual(a.cwd, process.cwd());
    assert.notEqual(b.cwd, process.cwd());
    assert.match(a.session.systemPrompt, /session=a/);
    assert.match(b.session.systemPrompt, /session=b/);
    assert.doesNotMatch(a.session.systemPrompt, /session=b/);
    assert.doesNotMatch(b.session.systemPrompt, /session=a/);
    assert.match(transcript(a.session), /SESSION_A_SECRET_MARKER/);
    assert.match(transcript(b.session), /SESSION_B_SECRET_MARKER/);
    assert.doesNotMatch(transcript(a.session), /SESSION_B_SECRET_MARKER|offline-echo:b/);
    assert.doesNotMatch(transcript(b.session), /SESSION_A_SECRET_MARKER|offline-echo:a/);
    assert.equal(assistantA.stopReason, "stop");
    assert.equal(assistantB.stopReason, "stop");
    return {
      ok: true as const,
      sessionIds: [a.session.sessionId, b.session.sessionId],
      cwds: [a.cwd, b.cwd],
      assistants: [
        { stopReason: "stop" as const, text: assistantA.text },
        { stopReason: "stop" as const, text: assistantB.text },
      ],
    };
  });
}

export async function runAbortPeerCheck(): Promise<{
  peerCompleted: true;
  abortedSettled: true;
  abortedWhilePeerPending: true;
  peerAssistant: { stopReason: "stop"; text: string };
}> {
  const hangEntered = deferred();
  const peerEntered = deferred();
  const peerRelease = deferred();
  return withTwoSessions(
    [hangUntilAbortTurn({ resolve: hangEntered.resolve })],
    [gatedEchoTurn("peer", { resolve: peerEntered.resolve }, peerRelease.promise)],
    async (hang, peer) => {
      const hangPrompt = hang.session.prompt("HANG_PROMPT", { expandPromptTemplates: false });
      const peerPrompt = peer.session.prompt("PEER_COMPLETES", { expandPromptTemplates: false });
      await withTimeout(Promise.all([hangEntered.promise, peerEntered.promise]), 10_000, "both sessions did not enter their streams");
      assert.equal(hang.session.isIdle, false);
      assert.equal(peer.session.isIdle, false);
      hang.session.clearQueue();
      await hang.session.abort();
      await hangPrompt.catch(() => undefined);
      await hang.session.waitForIdle();
      assert.equal(hang.session.isIdle, true);
      assert.equal(peer.session.isIdle, false, "peer must still be pending while the other session is aborted");
      peerRelease.resolve();
      await withTimeout(peerPrompt, 10_000, "peer session did not complete after release");
      await peer.session.waitForIdle();
      const last = collectAssistantTurns(peer.session).at(-1);
      assert.ok(last, "peer produced no assistant turn");
      const peerAssistant = requireSuccessfulTurn(last, "offline-echo:peer");
      assert.equal(peer.session.isIdle, true);
      assert.match(transcript(peer.session), /PEER_COMPLETES/);
      assert.doesNotMatch(transcript(peer.session), /HANG_PROMPT/);
      assert.equal(peerAssistant.stopReason, "stop");
      return {
        peerCompleted: true as const,
        abortedSettled: true as const,
        abortedWhilePeerPending: true as const,
        peerAssistant: { stopReason: "stop" as const, text: peerAssistant.text },
      };
    },
  );
}

export async function runErrorPeerCheck(): Promise<{
  peerCompleted: true;
  errorObserved: true;
  peerAssistant: { stopReason: "stop"; text: string };
  errorAssistant: { stopReason: "error"; text: string; errorMessage?: string };
  promptResolvedOnError: boolean;
  errorSessionIdle: boolean;
  errorUserMessagePresent: boolean;
  injectedErrorCountsAsSuccess: false;
}> {
  return withTwoSessions([errorTurn("offline-injected-error")], [echoTurn("peer")], async (bad, peer) => {
    const beforeBad = collectAssistantTurns(bad.session).length;
    const [badSettled, peerAssistant] = await Promise.all([
      promptSettled(bad.session, "ERROR_SESSION"),
      requireSuccessfulPrompt(peer.session, "PEER_OK", "offline-echo:peer"),
    ]);
    const errorAssistantTurn = collectAssistantTurns(bad.session).slice(beforeBad).at(-1);
    assert.ok(errorAssistantTurn, "injected error must produce an assistant turn");
    assert.equal(errorAssistantTurn.stopReason, "error");
    assert.equal(peer.session.isIdle, true);
    assert.equal(bad.session.isIdle, true);
    assert.match(transcript(bad.session), /ERROR_SESSION/);
    assert.match(transcript(peer.session), /PEER_OK/);
    assert.doesNotMatch(transcript(peer.session), /ERROR_SESSION|offline-injected-error/);
    assert.throws(
      () => requireSuccessfulTurn(errorAssistantTurn, "offline-echo:peer"),
      /cannot count as success/,
    );
    assert.equal(peerAssistant.stopReason, "stop");
    return {
      peerCompleted: true as const,
      errorObserved: true as const,
      peerAssistant: { stopReason: "stop" as const, text: peerAssistant.text },
      errorAssistant: errorAssistantTurn.errorMessage !== undefined
        ? { stopReason: "error" as const, text: errorAssistantTurn.text, errorMessage: errorAssistantTurn.errorMessage }
        : { stopReason: "error" as const, text: errorAssistantTurn.text },
      promptResolvedOnError: badSettled.rejected === undefined,
      errorSessionIdle: bad.session.isIdle,
      errorUserMessagePresent: transcript(bad.session).includes("ERROR_SESSION"),
      injectedErrorCountsAsSuccess: false as const,
    };
  });
}

export async function runDisposeReuseCheck(): Promise<{
  peerCompleted: true;
  keepAssistant: { stopReason: "stop"; text: string };
  peerAssistant: { stopReason: "stop"; text: string };
}> {
  return withTwoSessions([echoTurn("dispose-me")], [echoTurn("peer-keep"), echoTurn("peer-reuse")], async (first, peer) => {
    await requireSuccessfulPrompt(first.session, "DISPOSE_ME", "offline-echo:dispose-me");
    const keepAssistant = await requireSuccessfulPrompt(peer.session, "KEEP_ME", "offline-echo:peer-keep");
    await disposeOfflineSession(first.session);
    const reused = await requireSuccessfulPrompt(peer.session, "REUSE_PEER", "offline-echo:peer-reuse");
    assert.equal(peer.session.isIdle, true);
    assert.match(transcript(peer.session), /KEEP_ME/);
    assert.match(transcript(peer.session), /REUSE_PEER/);
    assert.doesNotMatch(transcript(peer.session), /DISPOSE_ME/);
    assert.equal(keepAssistant.stopReason, "stop");
    assert.equal(reused.stopReason, "stop");
    return {
      peerCompleted: true as const,
      keepAssistant: { stopReason: "stop" as const, text: keepAssistant.text },
      peerAssistant: { stopReason: "stop" as const, text: reused.text },
    };
  });
}

export async function runLifecycleChecks() {
  const before = snapshotGlobalSdkState();
  const isolation = await runIsolationCheck();
  const abortPeer = await runAbortPeerCheck();
  const errorPeer = await runErrorPeerCheck();
  const disposeReuse = await runDisposeReuseCheck();
  assertGlobalSdkStatePreserved(before);
  return {
    isolation,
    abortPeer,
    errorPeer,
    disposeReuse,
    inspectedGlobalSdkState: {
      fetchIdentityUnchanged: true as const,
      setDefaultStreamFnIdentityUnchanged: true as const,
      streamSimpleIdentityUnchanged: true as const,
      apiProviderApisUnchanged: true as const,
      explicitMutations: [] as const,
      hiddenDefaultStreamClosureObserved: false as const,
      claim: INSPECTED_GLOBAL_SDK_CLAIM,
    },
  };
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  return value;
}

interface ChildWorker {
  rpc(request: Record<string, unknown>, expected: string): Promise<Record<string, unknown>>;
  dispose(): Promise<void>;
}

async function spawnChildWorker(): Promise<ChildWorker> {
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", BENCH_PATH, "--child-worker"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PI_OFFLINE: "1" },
  });
  if (child.pid === undefined) throw new Error("child pid missing");
  if (!child.stdin || !child.stdout || !child.stderr) throw new Error("child stdio missing");
  const stderrChunks: string[] = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderrChunks.push(chunk); });
  let buffer = "";
  const pendingLines: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else pendingLines.push(line);
      nl = buffer.indexOf("\n");
    }
  });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const stderrText = () => stderrChunks.join("");
  const line = () => {
    if (pendingLines.length > 0) return Promise.resolve(pendingLines.shift()!);
    return withTimeout(new Promise<string>((resolve) => { waiters.push(resolve); }), CHILD_MS, `child line timeout: ${stderrText()}`);
  };
  const hello = JSON.parse(await line()) as { type?: string };
  if (hello.type !== "hello") throw new Error(`child hello missing: ${JSON.stringify(hello)} ${stderrText()}`);
  const rpc = async (request: Record<string, unknown>, expected: string) => {
    child.stdin!.write(`${JSON.stringify(request)}\n`);
    const raw = await line();
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.type === "fatal") throw new Error(String(value.error));
    if (value.type !== expected) throw new Error(`expected ${expected} got ${raw} ${stderrText()}`);
    return value;
  };
  return {
    rpc,
    async dispose() {
      try {
        if (child.exitCode === null) {
          await rpc({ op: "dispose" }, "disposed");
          child.stdin!.end();
          await withTimeout(exit, CHILD_MS, `child exit timeout: ${stderrText()}`);
        }
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    },
  };
}

async function runInProcessPool(n: number): Promise<PoolResult> {
  const root = await mkdtemp(join(tmpdir(), "dynamicwf-sdk-pool-inproc-"));
  const before = snapshotGlobalSdkState();
  const sessions: OfflineSession[] = [];
  try {
    const poolReadyStart = process.hrtime.bigint();
    const { runtime, model } = await createOfflineRuntime();
    const runtimeCreateMs = msSince(poolReadyStart);
    const created = await Promise.all(Array.from({ length: n }, (_, i) => createOfflineSession({
      root, id: `s${i}`, runtime, model,
    })));
    const poolReadyMs = msSince(poolReadyStart);
    sessions.push(...created);
    const rss = accountedRssBytes(sampleOwnRssBytes(), []);
    const accountedRssDistribution = summarize([
      rss.accountedRssBytes,
      accountedRssBytes(sampleOwnRssBytes(), []).accountedRssBytes,
      accountedRssBytes(sampleOwnRssBytes(), []).accountedRssBytes,
    ]);
    await Promise.all(sessions.map((session) => requireSuccessfulPrompt(session.session, `PROMPT_${session.id}`, `offline-echo:${session.id}`)));
    assertGlobalSdkStatePreserved(before);
    return {
      mode: "in-process",
      n,
      constructionMs: summarize(sessions.map((session) => session.constructionMs)),
      startupMs: summarize(sessions.map((session) => session.startupMs)),
      rss,
      accountedRssDistribution,
      runtimeCreateMs,
      poolReadyMs,
    };
  } finally {
    for (const session of sessions) await disposeOfflineSession(session.session);
    await rm(root, { recursive: true, force: true });
  }
}

async function runChildProcessPool(n: number): Promise<PoolResult> {
  const workers: ChildWorker[] = [];
  try {
    const poolReadyStart = process.hrtime.bigint();
    const created = await Promise.all(Array.from({ length: n }, async (_, i) => {
      const worker = await spawnChildWorker();
      workers.push(worker);
      return worker.rpc({ op: "create", id: `s${i}` }, "created");
    }));
    const poolReadyMs = msSince(poolReadyStart);
    const childRss = await Promise.all(workers.map(async (worker) => finiteNumber((await worker.rpc({ op: "sample" }, "sampled")).rssBytes, "child rssBytes")));
    const rss = accountedRssBytes(sampleOwnRssBytes(), childRss);
    const accountedRssDistribution = summarize([
      rss.accountedRssBytes,
      accountedRssBytes(sampleOwnRssBytes(), await Promise.all(workers.map(async (worker) => finiteNumber((await worker.rpc({ op: "sample" }, "sampled")).rssBytes, "child rssBytes")))).accountedRssBytes,
      accountedRssBytes(sampleOwnRssBytes(), await Promise.all(workers.map(async (worker) => finiteNumber((await worker.rpc({ op: "sample" }, "sampled")).rssBytes, "child rssBytes")))).accountedRssBytes,
    ]);
    await Promise.all(workers.map((worker, i) => worker.rpc({ op: "prompt", text: `PROMPT_s${i}` }, "prompted")));
    return {
      mode: "child-process",
      n,
      constructionMs: summarize(created.map((row) => finiteNumber(row.constructionMs, "constructionMs"))),
      startupMs: summarize(created.map((row) => finiteNumber(row.startupMs, "startupMs"))),
      rss,
      accountedRssDistribution,
      poolReadyMs,
    };
  } finally {
    for (const worker of workers) await worker.dispose().catch(() => undefined);
  }
}

export async function runComparison(options: { sizes?: number[]; includeChildProcess?: boolean } = {}): Promise<ComparisonReport> {
  requireSdkApis();
  const sizes = options.sizes ?? [...COMPARISON_SIZES];
  if (sizes.length === 0) throw new Error("sizes must not be empty");
  for (const n of sizes) {
    if (!Number.isInteger(n) || n < 1) throw new Error(`invalid size ${n}`);
  }
  const includeChildProcess = options.includeChildProcess === true;
  const results: PoolResult[] = [];
  for (const n of sizes) {
    results.push(await runInProcessPool(n));
    if (includeChildProcess) results.push(await runChildProcessPool(n));
  }
  return { limitation: FAKE_INFERENCE_LIMITATION, timingScope: TIMING_SCOPE, sizes, includeChildProcess, results };
}

async function runChildWorker(): Promise<void> {
  requireSdkApis();
  const send = (value: unknown) => { process.stdout.write(`${JSON.stringify(value)}\n`); };
  send({ type: "hello", pid: process.pid });
  let root: string | undefined;
  let offline: OfflineSession | undefined;
  const cleanup = async () => {
    if (offline) {
      await disposeOfflineSession(offline.session);
      offline = undefined;
    }
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  };
  process.stdin.setEncoding("utf8");
  try {
    let buffer = "";
    for await (const chunk of process.stdin) {
      buffer += chunk;
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim() !== "") {
          const request = JSON.parse(line) as { op?: string; id?: string; text?: string };
          if (request.op === "create") {
            if (offline) throw new Error("child session already created");
            root = await mkdtemp(join(tmpdir(), "dynamicwf-sdk-pool-child-"));
            const createdRuntime = await createOfflineRuntime();
            offline = await createOfflineSession({
              root,
              id: request.id ?? "child",
              runtime: createdRuntime.runtime,
              model: createdRuntime.model,
            });
            send({
              type: "created",
              constructionMs: offline.constructionMs,
              startupMs: offline.startupMs,
              sessionId: offline.session.sessionId,
              cwd: offline.cwd,
              rssBytes: sampleOwnRssBytes(),
            });
          } else if (request.op === "prompt") {
            if (!offline) throw new Error("child session missing");
            if (typeof request.text !== "string") throw new Error("prompt text required");
            const result = await requireSuccessfulPrompt(offline.session, request.text, `offline-echo:${offline.id}`);
            send({ type: "prompted", stopReason: result.stopReason, text: result.text, rssBytes: sampleOwnRssBytes() });
          } else if (request.op === "sample") {
            send({ type: "sampled", rssBytes: sampleOwnRssBytes() });
          } else if (request.op === "abort") {
            if (!offline) throw new Error("child session missing");
            offline.session.clearQueue();
            await offline.session.abort();
            send({ type: "aborted" });
          } else if (request.op === "dispose") {
            await cleanup();
            send({ type: "disposed" });
            return;
          } else {
            throw new Error(`unknown child op ${String(request.op)}`);
          }
        }
        nl = buffer.indexOf("\n");
      }
    }
  } catch (error) {
    send({ type: "fatal", error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return BENCH_PATH === resolve(entry);
}

async function runCli(): Promise<void> {
  requireSdkApis();
  const before = snapshotGlobalSdkState();
  const lifecycle = await runLifecycleChecks();
  const comparison = await runComparison({ sizes: [...COMPARISON_SIZES], includeChildProcess: true });
  assertGlobalSdkStatePreserved(before);
  process.stdout.write(`${JSON.stringify({ limitation: FAKE_INFERENCE_LIMITATION, lifecycle, comparison }, null, 2)}\n`);
}

if (process.argv.includes("--child-worker")) {
  await runChildWorker();
} else if (isMainModule()) {
  await runCli();
}
