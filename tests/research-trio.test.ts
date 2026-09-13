import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Cause, Effect, Exit } from "effect";
import { createAssistantMessageEventStream, InMemoryCredentialStore, InMemoryModelsStore, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ExecutionFailure, executionFailure } from "../src/execution-failure.js";
import type { AvailableExecutionModel } from "../src/execution-plan.js";
import type { ExecutionPlan, FrozenAgent, PiWorkerRequest, PreparedExecution } from "../src/execution-types.js";
import { loadGeneratedModule } from "../src/generated-module.js";
import type { Json, Node, WorkflowDefinition } from "../src/graph.js";
import { createOutputValidator } from "../src/output-schema.js";
import { executePiWorker, type PiWorkerOptions } from "../src/pi-worker.js";
import { JournalRuntime } from "../src/run-runtime.js";
import { RunStore } from "../src/run-store.js";
import { WorkflowService } from "../src/service.js";
import type { RuntimeContext } from "../src/runtime-contract.js";

const recipeUrl = new URL("../skills/dynamic-workflows/recipes/research-trio/", import.meta.url);
const source = (name: string) => readFile(new URL(`${name}.json`, recipeUrl), "utf8").then(text => JSON.parse(text));
const branches = ["r1", "r2", "r3"] as const;
type Branch = typeof branches[number];
type ResearchDecision = "complete" | "inconclusive" | "failed";
type SynthDecision = "accepted" | "inconclusive";
const branchOf: Record<string, Branch> = { "researcher-1": "r1", "researcher-2": "r2", "researcher-3": "r3" };
const documented: Record<string, { model: { provider: string; id: string }; thinking: FrozenAgent["thinking"] }> = {
  "researcher-1": { model: { provider: "test", id: "research-r1" }, thinking: "off" },
  "researcher-2": { model: { provider: "test", id: "research-r2" }, thinking: "low" },
  "researcher-3": { model: { provider: "test", id: "research-r3" }, thinking: "medium" },
  main: { model: { provider: "test", id: "research-synth" }, thinking: "high" },
};
const availableModels = [
  { provider: "test", id: "research-r1", thinkingLevels: ["off", "low", "medium", "high"] as const },
  { provider: "test", id: "research-r2", thinkingLevels: ["off", "low", "medium", "high"] as const },
  { provider: "test", id: "research-r3", thinkingLevels: ["off", "low", "medium", "high"] as const },
  { provider: "test", id: "research-synth", thinkingLevels: ["off", "low", "medium", "high"] as const },
];

function applyDocumentedSettings(patch: any, settings = documented) {
  const next = structuredClone(patch);
  for (const operation of next.operations) {
    if (operation.op === "addNode" && operation.node?.kind === "agent") {
      const spec = settings[operation.graphId];
      assert.ok(spec, operation.graphId);
      operation.node.config.model = spec.model;
      operation.node.config.thinking = spec.thinking;
    }
  }
  return next;
}

function report(id: Branch, decision: Exclude<ResearchDecision, "failed">) {
  return {
    decision, summary: `${id} ${decision}`,
    findings: decision === "complete" ? [{ claim: `${id} claim`, basis: `${id} basis` }] : [],
    evidence: decision === "complete" ? [{ source: `${id}.md`, excerpt: `${id} excerpt` }] : [],
    uncertainties: decision === "inconclusive" ? [`${id} missing`] : [],
  };
}
function synthesis(decision: SynthDecision) {
  return {
    decision, summary: `synth ${decision}`,
    reason: decision === "accepted" ? "All three reports were complete." : "Synthesis remains inconclusive.",
    evidence: ["named collect envelopes"], disagreements: [] as { topic: string; positions: string[] }[],
    uncertainties: decision === "inconclusive" ? ["unresolved"] : [],
  };
}

async function loadRecipe(settings: typeof documented | null = documented, models: readonly AvailableExecutionModel[] = availableModels) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "dynamicwf-research-trio-")));
  const filename = join(directory, "state.sqlite");
  const service = new WorkflowService(filename, { cwd: directory, availableModels: models });
  const close = async () => { service.close(); await rm(directory, { recursive: true, force: true }); };
  try {
    const created = await service.dispatch("workflow.create", await source("create")) as WorkflowDefinition;
    const patch = settings ? applyDocumentedSettings(await source("patch"), settings) : await source("patch");
    const patched = await service.dispatch("workflow.patch", patch) as { workflow: WorkflowDefinition; validation: { valid: boolean; issues: unknown[] } };
    const input = await source("input") as Record<string, Json>;
    return { service, directory, filename, created, patched, input, close };
  } catch (error) { await close(); throw error; }
}

async function loadPrepared(settings: typeof documented | null = documented, models: readonly AvailableExecutionModel[] = availableModels) {
  const fixture = await loadRecipe(settings, models);
  try {
    assert.equal(fixture.patched.validation.valid, true);
    const prepared = await fixture.service.dispatch("workflow.prepare", { id: fixture.created.id, cwd: fixture.directory }) as PreparedExecution;
    const module = await loadGeneratedModule(prepared.plan, fixture.directory);
    return { ...fixture, prepared, module };
  } catch (error) { await fixture.close(); throw error; }
}

function attachAgent(
  runtime: JournalRuntime,
  plan: ExecutionPlan,
  handler: (context: RuntimeContext, node: Extract<Node, { kind: "agent" }>, task: string, input: Json) => Json | Promise<Json>,
) {
  runtime.agent = (context, node, task, input) => Effect.tryPromise({
    try: async () => {
      const config = plan.agents[context.graphId]?.[node.id];
      if (!config) throw new Error("Missing frozen agent configuration");
      const result = await handler(context, node, task, input);
      try { return createOutputValidator(config.outputSchema)(result); }
      catch { throw executionFailure("output", "output", "read-only", "Worker result failed strict output schema validation"); }
    },
    catch: error => error instanceof Error ? error : new Error(String(error)),
  });
}

async function executeRun(
  store: RunStore, plan: ExecutionPlan, module: { run(runtime: JournalRuntime, input: Json): Effect.Effect<Json, Error> },
  directory: string, input: Json, id: string,
  handler: (context: RuntimeContext, node: Extract<Node, { kind: "agent" }>, task: string, input: Json) => Json | Promise<Json>,
) {
  store.create({ id, plan, input, cwd: directory });
  const launch = store.reserveLaunch(id);
  const runtime = new JournalRuntime(store, launch.run, launch.token, directory);
  attachAgent(runtime, plan, handler);
  const exit = await Effect.runPromiseExit(module.run(runtime, input));
  if (Exit.isSuccess(exit)) {
    store.finish(id, launch.token, { status: "succeeded", output: exit.value });
    return { status: "succeeded" as const, output: exit.value as Record<string, any>, run: store.get(id) };
  }
  const error = Cause.squash(exit.cause);
  const current = store.get(id);
  if (current.ownerToken === launch.token) {
    for (const item of store.listActivations(id).filter(item => item.status === "running")) {
      store.failActivation(id, launch.token, item.key, error instanceof Error ? error.message : String(error));
    }
    store.finish(id, launch.token, {
      status: "failed", error: error instanceof Error ? error.message : String(error),
      ...(error instanceof ExecutionFailure ? { failure: error.failure } : {}),
    });
  }
  return { status: "failed" as const, error, run: store.get(id) };
}

function outcomesHandler(research: Record<Branch, ResearchDecision>, synth: SynthDecision, inputJson: Record<string, any>) {
  return (context: RuntimeContext, node: Extract<Node, { kind: "agent" }>, task: string, input: Json) => {
    const given = input as Record<string, any>;
    if (node.role === "synthesizer") {
      assert.equal(task, inputJson.synthesis.assignment);
      assert.deepEqual(Object.keys(given.research).sort(), [...branches]);
      assert.equal(Object.hasOwn(given, "r1"), false);
      assert.equal(Object.hasOwn(given, "r2"), false);
      assert.equal(Object.hasOwn(given, "r3"), false);
      return synthesis(synth);
    }
    const branch = branchOf[context.graphId];
    assert.ok(branch);
    assert.equal(task, inputJson[branch].assignment);
    assert.equal(given.assignment, inputJson[branch].assignment);
    assert.equal(given.question, inputJson.question);
    assert.deepEqual(given.criteria, inputJson.criteria);
    assert.deepEqual(given.sources, inputJson.sources);
    for (const key of ["r1", "r2", "r3", "research", "synthesis"]) assert.equal(Object.hasOwn(given, key), false);
    if (research[branch] === "failed") throw executionFailure("provider", "execution", "read-only", `${branch} provider failure`);
    return report(branch, research[branch]);
  };
}

test("research-trio JSON authors through WorkflowService and prepare freezes four explicit models without fallback", async () => {
  const shipped = await source("patch");
  assert.equal(shipped.expectedRevision, 1);
  assert.equal(shipped.operations.some((operation: any) => operation.op === "addGraph" && operation.graphId === "main"), false);
  assert.ok(shipped.operations.some((operation: any) => operation.op === "addGraph" && operation.graphId === "researcher-1"));
  const serialized = JSON.stringify(shipped);
  assert.match(serialized, /REPLACE_WITH_CATALOG_PROVIDER/);
  assert.match(serialized, /REPLACE_WITH_R1_MODEL_ID/);
  assert.match(serialized, /REPLACE_WITH_SYNTHESIZER_MODEL_ID/);
  assert.equal(serialized.includes("retryPolicy"), false);
  assert.equal(serialized.includes("outputRepair"), false);
  assert.equal(serialized.includes("\"concurrency\""), false);

  const unfilled = await loadRecipe(null);
  try {
    await assert.rejects(unfilled.service.dispatch("workflow.prepare", { id: unfilled.created.id, cwd: unfilled.directory }), /Model unavailable: REPLACE_WITH_CATALOG_PROVIDER\/REPLACE_WITH_/);
  } finally { await unfilled.close(); }

  const missing = await loadRecipe({ ...documented, "researcher-1": { model: { provider: "test", id: "missing-model" }, thinking: "off" } });
  try {
    await assert.rejects(missing.service.dispatch("workflow.prepare", { id: missing.created.id, cwd: missing.directory }), /Model unavailable: test\/missing-model/);
  } finally { await missing.close(); }

  const thinking = await loadRecipe({ ...documented, main: { model: { provider: "test", id: "research-synth" }, thinking: "xhigh" } });
  try {
    await assert.rejects(thinking.service.dispatch("workflow.prepare", { id: thinking.created.id, cwd: thinking.directory }), /Unsupported thinking xhigh/);
  } finally { await thinking.close(); }

  const fixture = await loadPrepared();
  try {
    assert.equal(fixture.created.revision, 1);
    assert.equal(fixture.patched.workflow.revision, 2);
    assert.deepEqual(await fixture.service.dispatch("workflow.validate", { id: fixture.created.id }), { valid: true, issues: [] });
    const preparedAgain = await fixture.service.dispatch("workflow.prepared", { preparedId: fixture.prepared.preparedId }) as PreparedExecution;
    assert.equal(preparedAgain.planHash, fixture.prepared.planHash);
    const plan = fixture.prepared.plan;
    const research = plan.workflow.graphs.main!.nodes.find(node => node.id === "research") as Extract<Node, { kind: "parallel" }>;
    assert.equal(research.failurePolicy, "collect");
    assert.deepEqual(research.children.map(child => child.id), [...branches]);
    assert.equal(research.concurrency, undefined);
    const agents = [
      plan.agents["researcher-1"]!.investigate!,
      plan.agents["researcher-2"]!.investigate!,
      plan.agents["researcher-3"]!.investigate!,
      plan.agents.main!.aggregate!,
    ];
    assert.deepEqual(agents.map(agent => agent.model.id), ["research-r1", "research-r2", "research-r3", "research-synth"]);
    assert.deepEqual(agents.map(agent => agent.thinking), ["off", "low", "medium", "high"]);
    assert.equal(new Set(agents.map(agent => `${agent.model.provider}/${agent.model.id}`)).size, 4);
    for (const agent of agents) {
      assert.equal(agent.session, "fresh");
      assert.equal(agent.permission, "read-only");
      assert.deepEqual([...agent.tools], ["read", "grep", "find", "ls"]);
      assert.deepEqual(agent.skills, []);
      assert.equal(agent.tools.includes("bash"), false);
      assert.equal(agent.reasoning?.requested, agent.thinking);
      assert.equal(agent.reasoning?.resolved, agent.thinking);
      createOutputValidator(agent.outputSchema);
    }
  } finally { await fixture.close(); }
});

test("stale patch revision is rejected and prepared start-request matches the existing contract", async () => {
  const fixture = await loadPrepared();
  const store = new RunStore(fixture.filename);
  try {
    await assert.rejects(fixture.service.dispatch("workflow.patch", { ...applyDocumentedSettings(await source("patch")), expectedRevision: 1 }), /Revision conflict: expected 1, actual 2/);
    const startRequest = { preparedId: fixture.prepared.preparedId, idempotencyKey: "research-trio-offline-1", input: fixture.input };
    assert.deepEqual(Object.keys(startRequest).sort(), ["idempotencyKey", "input", "preparedId"]);
    assert.match(startRequest.preparedId, /^prepared-[a-f0-9]{64}$/);
    await assert.rejects(fixture.service.dispatch("run.start", { ...startRequest, cwd: fixture.directory }), /cannot override/);
    await assert.rejects(fixture.service.dispatch("run.start", { ...startRequest, id: fixture.created.id }), /cannot override/);
    await assert.rejects(fixture.service.dispatch("run.start", { ...startRequest, model: { provider: "test", id: "research-r1" } }), /cannot override/);
    const first = store.create({
      id: "runStartContract", plan: fixture.prepared.plan, input: startRequest.input, cwd: fixture.prepared.cwd,
      start: { preparedId: startRequest.preparedId, idempotencyKey: startRequest.idempotencyKey },
    });
    const repeated = store.create({
      id: "runStartOther", plan: fixture.prepared.plan, input: startRequest.input, cwd: fixture.prepared.cwd,
      start: { preparedId: startRequest.preparedId, idempotencyKey: startRequest.idempotencyKey },
    });
    assert.equal(repeated.id, first.id);
    assert.equal(first.preparedId, startRequest.preparedId);
    assert.throws(() => store.create({
      id: "runStartConflict", plan: fixture.prepared.plan, input: { ...fixture.input, question: "other" }, cwd: fixture.prepared.cwd,
      start: { preparedId: startRequest.preparedId, idempotencyKey: startRequest.idempotencyKey },
    }), /idempotency conflict/);
    assert.equal(store.listRuns().length, 1);
  } finally { store.close(); await fixture.close(); }
});

test("collect admits three independent researchers together, holds the synthesizer, and keeps named results", { timeout: 15_000 }, async () => {
  const fixture = await loadPrepared();
  const store = new RunStore(fixture.filename);
  try {
    const admitted = new Set<string>();
    const completed: string[] = [];
    let aggregateStarted = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const result = await executeRun(store, fixture.prepared.plan, fixture.module, fixture.directory, fixture.input, "runBarrier", async (context, node, task, input) => {
      if (node.role === "synthesizer") {
        aggregateStarted += 1;
        assert.deepEqual([...completed].sort(), [...branches]);
        assert.match(task, /SYNTH_ONLY_ASSIGNMENT/);
        for (const branch of branches) assert.doesNotMatch(JSON.stringify(input), new RegExp(`${branch.toUpperCase()}_ONLY_ASSIGNMENT`));
        return synthesis("accepted");
      }
      const branch = branchOf[context.graphId]!;
      assert.equal(context.nodeId, "investigate");
      assert.match(task, new RegExp(`${branch.toUpperCase()}_ONLY_ASSIGNMENT`));
      for (const other of branches.filter(item => item !== branch)) {
        assert.doesNotMatch(task, new RegExp(`${other.toUpperCase()}_ONLY_ASSIGNMENT`));
        assert.doesNotMatch(JSON.stringify(input), new RegExp(`${other.toUpperCase()}_ONLY_ASSIGNMENT`));
      }
      assert.doesNotMatch(JSON.stringify(input), /SYNTH_ONLY_ASSIGNMENT/);
      admitted.add(branch);
      if (admitted.size === 3) release();
      await barrier;
      assert.equal(aggregateStarted, 0);
      await sleep({ r3: 0, r1: 30, r2: 60 }[branch]!);
      completed.push(branch);
      return report(branch, "complete");
    });
    assert.equal(result.status, "succeeded");
    assert.deepEqual(completed, ["r3", "r1", "r2"]);
    assert.equal(aggregateStarted, 1);
    assert.equal(result.output.accepted, true);
    assert.equal(result.output.decision, "accepted");
    assert.equal(result.run.taskOutcome?.decision, "accepted");
    assert.equal(result.run.taskOutcome?.source, "explicit");
    const parent = store.listActivations("runBarrier").find(item => item.kind === "parallel")!;
    const page = store.collections("runBarrier", parent.key);
    assert.deepEqual(page.records.map(record => record.itemId), ["r3", "r1", "r2"]);
    assert.equal(page.summary.succeeded, 3);
    assert.deepEqual(Object.keys(result.output.reports).sort(), [...branches]);
    assert.equal(store.listActivations("runBarrier").find(item => item.kind === "finish" && item.status === "succeeded")?.context.nodeId, "accepted");
  } finally { store.close(); await fixture.close(); }
});

test("every complete/inconclusive/failure combination and both synthesizer verdicts use finish guards", { timeout: 60_000 }, async () => {
  const fixture = await loadPrepared();
  const store = new RunStore(fixture.filename);
  try {
    const choices: ResearchDecision[] = ["complete", "inconclusive", "failed"];
    let cases = 0;
    for (const r1 of choices) for (const r2 of choices) for (const r3 of choices) for (const synth of ["accepted", "inconclusive"] as const) {
      const research = { r1, r2, r3 };
      const id = `runCombo${cases}`;
      const result = await executeRun(store, fixture.prepared.plan, fixture.module, fixture.directory, fixture.input, id, outcomesHandler(research, synth, fixture.input));
      const expectedAccepted = r1 === "complete" && r2 === "complete" && r3 === "complete" && synth === "accepted";
      assert.equal(result.status, "succeeded", `${id}`);
      if (result.status !== "succeeded") continue;
      const output = result.output;
      assert.equal(result.run.taskOutcome?.decision, expectedAccepted ? "accepted" : "inconclusive", `${id}`);
      assert.equal(output.accepted, expectedAccepted, `${id}`);
      assert.equal(output.decision, expectedAccepted ? "accepted" : "inconclusive", `${id}`);
      assert.equal(output.synthesis.decision, synth, `${id}`);
      assert.equal(store.listActivations(id).find(item => item.kind === "finish" && item.status === "succeeded")?.context.nodeId, expectedAccepted ? "accepted" : "inconclusive");
      for (const branch of branches) {
        const envelope = output.reports[branch] as { status: string; value?: { decision: string }; failure?: { effects: string; code: string } };
        if (research[branch] === "failed") {
          assert.equal(envelope.status, "failed", `${id}/${branch}`);
          assert.equal(Object.hasOwn(envelope, "value"), false, `${id}/${branch}`);
          assert.equal(envelope.failure?.effects, "unknown");
          assert.equal(envelope.failure?.code, "provider");
        } else {
          assert.equal(envelope.status, "succeeded", `${id}/${branch}`);
          assert.equal(envelope.value?.decision, research[branch]);
        }
      }
      if (r1 === "failed" || r2 === "failed" || r3 === "failed") assert.match(String(output.reason), /failed/);
      else if (r1 === "inconclusive" || r2 === "inconclusive" || r3 === "inconclusive") assert.match(String(output.reason), /inconclusive/);
      else assert.equal(output.reason, synthesis(synth).reason);
      cases++;
    }
    assert.equal(cases, 54);
  } finally { store.close(); await fixture.close(); }
});

test("aggregator failure or invalid output fails the run while collected reports remain", async () => {
  const fixture = await loadPrepared();
  const store = new RunStore(fixture.filename);
  try {
    const research = { r1: "complete", r2: "complete", r3: "complete" } as const;
    const failed = await executeRun(store, fixture.prepared.plan, fixture.module, fixture.directory, fixture.input, "runAggFail", (context, node, task, input) => {
      if (node.role === "synthesizer") throw executionFailure("provider", "execution", "read-only", "synthesizer provider failure");
      return outcomesHandler(research, "accepted", fixture.input)(context, node, task, input);
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.run.taskOutcome, undefined);
    const failedParent = store.listActivations("runAggFail").find(item => item.kind === "parallel")!;
    const failedPage = store.collections("runAggFail", failedParent.key);
    assert.equal(failedPage.summary.succeeded, 3);
    assert.equal(failedPage.summary.failed, 0);
    assert.equal(store.listActivations("runAggFail").some(item => item.kind === "finish" && item.status === "succeeded"), false);

    const invalid = await executeRun(store, fixture.prepared.plan, fixture.module, fixture.directory, fixture.input, "runAggInvalid", (context, node, task, input) => {
      if (node.role === "synthesizer") return { decision: "accepted" };
      return outcomesHandler(research, "accepted", fixture.input)(context, node, task, input);
    });
    assert.equal(invalid.status, "failed");
    assert.ok(invalid.error instanceof ExecutionFailure);
    assert.equal(invalid.error.failure.code, "output");
    assert.equal(invalid.run.taskOutcome, undefined);
    const invalidParent = store.listActivations("runAggInvalid").find(item => item.kind === "parallel")!;
    assert.equal(store.collections("runAggInvalid", invalidParent.key).summary.succeeded, 3);
  } finally { store.close(); await fixture.close(); }
});

const workerProvider = "dynamicwf-worker-test";
test("executePiWorker offline SDK uses four fresh sessions and isolated researcher contexts", { timeout: 30_000 }, async () => {
  const workerSettings: Record<string, { model: { provider: string; id: string }; thinking: FrozenAgent["thinking"] }> = {
    "researcher-1": { model: { provider: workerProvider, id: "offline-r1" }, thinking: "off" },
    "researcher-2": { model: { provider: workerProvider, id: "offline-r2" }, thinking: "off" },
    "researcher-3": { model: { provider: workerProvider, id: "offline-r3" }, thinking: "off" },
    main: { model: { provider: workerProvider, id: "offline-synth" }, thinking: "off" },
  };
  const workerModels = Object.values(workerSettings).map(spec => ({ provider: spec.model.provider, id: spec.model.id, thinkingLevels: ["off"] as const }));
  const fixture = await loadPrepared(workerSettings, workerModels);
  try {
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
    const calls: Context[] = [];
    const workers = [
      { graphId: "researcher-1", nodeId: "investigate", branch: "r1" as const },
      { graphId: "researcher-2", nodeId: "investigate", branch: "r2" as const },
      { graphId: "researcher-3", nodeId: "investigate", branch: "r3" as const },
      { graphId: "main", nodeId: "aggregate", branch: "synth" as const },
    ];
    runtime.registerProvider(workerProvider, {
      api: "openai-completions", baseUrl: "https://offline.invalid", apiKey: "TEST_CREDENTIAL_MUST_NOT_LEAK",
      models: workers.map(worker => ({ id: workerSettings[worker.graphId]!.model.id, name: workerSettings[worker.graphId]!.model.id, reasoning: false, input: ["text"], contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
      streamSimple(_model, context) {
        const stream = createAssistantMessageEventStream();
        const index = calls.length;
        calls.push({ ...context, messages: structuredClone(context.messages), ...(context.tools ? { tools: context.tools.map(({ name, description, parameters }) => ({ name, description, parameters })) } : {}) });
        const worker = workers[index]!;
        const args = worker.branch === "synth" ? synthesis("accepted") : report(worker.branch, "complete");
        const message: AssistantMessage = {
          role: "assistant",
          content: [{ type: "toolCall", id: "result", name: "submit_result", arguments: args }],
          stopReason: "toolUse", provider: workerProvider, model: workerSettings[worker.graphId]!.model.id, api: "openai-completions", timestamp: 1,
          usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        };
        queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: "toolUse", message }); });
        return stream;
      },
    });
    const options: PiWorkerOptions = { modelRuntime: runtime };
    const envelopes = Object.fromEntries(branches.map(branch => [branch, { status: "succeeded", value: report(branch, "complete") }]));
    const sessionFiles: string[] = [];
    for (const worker of workers) {
      const config = structuredClone(fixture.prepared.plan.agents[worker.graphId]![worker.nodeId]!) as FrozenAgent;
      assert.equal(config.session, "fresh");
      const recipeInput = fixture.input as any;
      const input = (worker.branch === "synth"
        ? { question: recipeInput.question, criteria: recipeInput.criteria, assignment: recipeInput.synthesis.assignment, research: envelopes }
        : { question: recipeInput.question, criteria: recipeInput.criteria, sources: recipeInput.sources, assignment: recipeInput[worker.branch].assignment }) as Json;
      const task = worker.branch === "synth" ? recipeInput.synthesis.assignment as string : recipeInput[worker.branch].assignment as string;
      const request: PiWorkerRequest = {
        version: 1, config, task, input, cwd: fixture.directory,
        sessionDirectory: join(fixture.directory, "sessions", worker.branch),
        resourceDirectory: join(fixture.directory, "resources", worker.branch),
      };
      const result = await executePiWorker(request, options);
      sessionFiles.push(result.sessionFile);
      assert.deepEqual(createOutputValidator(config.outputSchema)(result.output), result.output);
    }
    assert.equal(new Set(sessionFiles).size, 4);
    assert.equal(calls.length, 4);
    for (const [index, worker] of workers.entries()) {
      const payload = JSON.stringify(calls[index]!.messages);
      if (worker.branch === "synth") {
        assert.match(payload, /SYNTH_ONLY_ASSIGNMENT/);
        for (const branch of branches) assert.doesNotMatch(payload, new RegExp(`${branch.toUpperCase()}_ONLY_ASSIGNMENT`));
      } else {
        assert.match(payload, new RegExp(`${worker.branch.toUpperCase()}_ONLY_ASSIGNMENT`));
        for (const other of branches.filter(item => item !== worker.branch)) assert.doesNotMatch(payload, new RegExp(`${other.toUpperCase()}_ONLY_ASSIGNMENT`));
        assert.doesNotMatch(payload, /SYNTH_ONLY_ASSIGNMENT/);
      }
    }
  } finally { await fixture.close(); }
});
