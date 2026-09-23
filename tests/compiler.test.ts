import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { type TestContext } from "node:test";
import { Effect } from "effect";
import ts from "typescript";
import { compileWorkflow, type CompilerVersion } from "../src/compiler.js";
import type { Expr, Graph, Json, WorkflowDefinition } from "../src/graph.js";
import type { RuntimeContext, WorkflowRuntime } from "../src/runtime-contract.js";
import { chooseEdge } from "../src/expressions.js";
import { verifyExecutionPlan } from "../src/execution-plan.js";
import { loadGeneratedModule } from "../src/generated-module.js";

const literal = (value: Json): Expr => ({ op: "literal", value });
for (const fixtureName of ["legacy-v3-plan.json", "frozen-role-defaults-plan.json"]) test(`golden ${fixtureName} still executes on the current runtime contract`, async t => {
  const plan = verifyExecutionPlan(JSON.parse(await readFile(new URL(`./fixtures/${fixtureName}`, import.meta.url), "utf8")));
  const directory = await mkdtemp(join(process.cwd(), ".compiler-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const module = await loadGeneratedModule(plan, directory);
  let agentCalls = 0, routeCalls = 0;
  const { runtime, steps } = recorder(() => { agentCalls++; return Effect.succeed({ result: "legacy" }); });
  runtime.route = (context, edges, scope) => { routeCalls++; return Effect.try(() => chooseEdge(context.nodeId, edges, scope)); };
  assert.deepEqual(await Effect.runPromise(module.run(runtime, null)), { result: "legacy" });
  assert.equal(agentCalls, 1); assert.equal(routeCalls, 1);
  assert.deepEqual(steps.map(step => step.nodeId), [plan.workflow.graphs.main!.entry, "done"]);
});
test("agent/integrate source hashes for compiler v1-v9 remain unchanged", async () => {
  const saved = JSON.parse(await readFile(new URL("./fixtures/compiler-v1-v9-operation-hashes.json", import.meta.url), "utf8"));
  for (const [version, hash] of Object.entries(saved.hashes)) {
    const compiled = compileWorkflow(saved.workflow, version as CompilerVersion);
    assert.equal(compiled.hash, hash, version);
    assert.doesNotMatch(compiled.source, /stepOperation/);
  }
  assert.match(compileWorkflow(saved.workflow).source, /stepOperation/);
});
const ref = (...path: string[]): Expr => ({ op: "ref", path });
const definition = (graphs: Record<string, Graph>, entryGraph = "main"): WorkflowDefinition => ({
  schemaVersion: 1, id: "compiler-test", name: "Compiler test", revision: 1, entryGraph, graphs,
});

async function load(t: TestContext, workflow: WorkflowDefinition) {
  const compiled = compileWorkflow(workflow);
  const directory = await mkdtemp(join(process.cwd(), ".compiler-test-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const tsPath = join(directory, "workflow.ts");
  await writeFile(tsPath, compiled.source);
  const program = ts.createProgram([tsPath], {
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
    verbatimModuleSyntax: true, skipLibCheck: true, noEmit: true,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], "Generated TS must typecheck");
  const output = ts.transpileModule(compiled.source, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext }, reportDiagnostics: true,
  });
  assert.deepEqual(output.diagnostics ?? [], []);
  const path = join(directory, "workflow.mjs");
  await writeFile(path, output.outputText);
  const module = await import(pathToFileURL(path).href) as {
    run: (runtime: WorkflowRuntime, input: Json) => Effect.Effect<Json, Error>;
  };
  return { ...compiled, run: module.run };
}

function recorder(agent?: WorkflowRuntime["agent"], check?: WorkflowRuntime["check"]) {
  const steps: RuntimeContext[] = [];
  const runtime: WorkflowRuntime = {
    collect: (_context, _id, work) => work().pipe(Effect.map(value => ({ status: "succeeded", value } as Json))),
    route: (context, edges, scope) => Effect.try(() => chooseEdge(context.nodeId, edges, scope)),
    step(context, work) { return Effect.suspend(() => { steps.push(structuredClone(context)); return work(); }); },
    stepOperation(context, node, prepare) {
      return this.step(context, () => Effect.try({ try: prepare, catch: error => error instanceof Error ? error : new Error(String(error)) }).pipe(Effect.flatMap(inputs => {
        if (inputs.kind === "agent" && node.kind === "agent") return this.agent(context, node, inputs.task, inputs.input);
        if (inputs.kind === "integrate" && node.kind === "integrate") return this.integrate(context, node, inputs.sources);
        return Effect.fail(new Error("Mismatched fixture operation"));
      })));
    },
    agent: agent ?? (() => Effect.fail(new Error("Unexpected agent node"))),
    worktree: () => Effect.fail(new Error("Unexpected worktree node")),
    integrate: () => Effect.fail(new Error("Unexpected integrate node")),
    check: check ?? (() => Effect.fail(new Error("Unexpected check node"))),
    finish: (_context, _node, _reason, _evidence, value) => Effect.succeed(value),
    wait: () => Effect.fail(new Error("Unexpected await node")),
    reuse: () => Effect.fail(new Error("Unexpected reuse node")),
  };
  return { runtime, steps };
}

test("collect map and parallel generate typechecked TypeScript with separately wrapped child outputs", async t => {
  const workflow = definition({
    main: { entry: "fan", nodes: [
      { id: "fan", kind: "parallel", failurePolicy: "collect", children: [{ id: "items", graphId: "items", input: literal([1,2]) }] },
      { id: "done", kind: "end", value: ref("nodes", "fan") },
    ], edges: [{ from: "fan", to: "done" }] },
    items: { entry: "map", nodes: [
      { id: "map", kind: "map", failurePolicy: "collect", graphId: "value", items: ref("input") },
      { id: "done", kind: "end", value: ref("nodes", "map") },
    ], edges: [{ from: "map", to: "done" }] },
    value: { entry: "done", nodes: [{ id: "done", kind: "end", value: ref("input") }], edges: [] },
  });
  const compiled = await load(t, workflow), { runtime } = recorder();
  assert.deepEqual(await Effect.runPromise(compiled.run(runtime,null)), { items: { status: "succeeded", value: [{ status: "succeeded", value: 1 }, { status: "succeeded", value: 2 }] } });
});

const reviewWorkflow = definition({ main: {
  entry: "implement",
  nodes: [
    { id: "implement", kind: "agent", role: "implementer", task: literal("Implement fixes") },
    { id: "review", kind: "agent", role: "reviewer", task: literal("Review changes"), input: ref("nodes", "implement") },
    { id: "done", kind: "end", value: ref("nodes", "review") },
  ],
  edges: [
    { from: "implement", to: "review" },
    { from: "review", to: "implement" },
    { from: "review", to: "done", when: { op: "eq", left: ref("nodes", "review", "verdict"), right: literal("approve") } },
  ],
} });

test("generated Effect loop executes rejected review backedge and then approval", async (t) => {
  const compiled = await load(t, reviewWorkflow);
  const inputs: Json[] = [];
  const r = recorder((context, _node, task, input) => {
    assert.equal(typeof task, "string");
    inputs.push(input);
    return Effect.succeed(context.nodeId === "implement" ? { revision: context.visit + 1 } : { verdict: context.visit === 0 ? "revise" : "approve" });
  });
  assert.deepEqual(await Effect.runPromise(compiled.run(r.runtime, { request: "Fix bug" })), { verdict: "approve" });
  assert.deepEqual(r.steps.map(({ nodeId, visit }) => [nodeId, visit]), [["implement", 0], ["review", 0], ["implement", 1], ["review", 1], ["done", 0]]);
  assert.deepEqual(inputs, [{ request: "Fix bug" }, { revision: 1 }, { request: "Fix bug" }, { revision: 2 }]);
  assert.match(compiled.source, /while \(true\)/);
  assert.match(compiled.source, /switch \(pc\)/);
  assert.doesNotMatch(compiled.source, /runGraph/);
});

test("map, parallel and subworkflow compile into real Effect concurrency with ordered results and distinct scopes", async (t) => {
  const workflow = definition({
    main: { entry: "fan", nodes: [
      { id: "fan", kind: "map", graphId: "branch", items: ref("input"), concurrency: 3 },
      { id: "done", kind: "end", value: ref("nodes", "fan") },
    ], edges: [{ from: "fan", to: "done" }] },
    branch: { entry: "fork", nodes: [
      { id: "fork", kind: "parallel", children: [
        { id: "slow", graphId: "nested", input: { op: "object", fields: { item: ref("input"), delay: literal(20), label: literal("slow") } } },
        { id: "fast", graphId: "nested", input: { op: "object", fields: { item: ref("input"), delay: literal(1), label: literal("fast") } } },
      ] },
      { id: "done", kind: "end", value: ref("nodes", "fork") },
    ], edges: [{ from: "fork", to: "done" }] },
    nested: { entry: "call", nodes: [
      { id: "call", kind: "subworkflow", graphId: "leaf", input: ref("input") },
      { id: "done", kind: "end", value: ref("nodes", "call") },
    ], edges: [{ from: "call", to: "done" }] },
    leaf: { entry: "work", nodes: [
      { id: "work", kind: "agent", role: "general", task: literal("Echo") },
      { id: "done", kind: "end", value: ref("nodes", "work") },
    ], edges: [{ from: "work", to: "done" }] },
  });
  const compiled = await load(t, workflow);
  const completed: string[] = [];
  let active = 0;
  let maxActive = 0;
  let admitAll!: () => void;
  const allAdmitted = new Promise<void>(resolve => { admitAll = resolve; });
  const fastDone = new Map<string, { promise: Promise<void>; resolve: () => void }>();
  for (const item of ["A", "B", "C"]) {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    fastDone.set(item, { promise, resolve: release });
  }
  const r = recorder((_context, _node, _task, input) => Effect.gen(function* () {
    assert.ok(input && !Array.isArray(input) && typeof input === "object");
    active++; maxActive = Math.max(maxActive, active);
    if (active === 6) admitAll();
    yield* Effect.promise(() => allAdmitted);
    if (input.label === "slow") yield* Effect.promise(() => fastDone.get(input.item as string)!.promise);
    completed.push(`${input.item}:${input.label}`);
    if (input.label === "fast") fastDone.get(input.item as string)!.resolve();
    active--;
    return input;
  }));
  const result = await Effect.runPromise(compiled.run(r.runtime, ["A", "B", "C"]).pipe(Effect.timeout("20 seconds")));
  assert.deepEqual(result, ["A", "B", "C"].map((item) => ({ slow: { item, delay: 20, label: "slow" }, fast: { item, delay: 1, label: "fast" } })));
  assert.equal(maxActive, 6, "map and default unbounded parallel overlap child execution");
  assert.ok(completed.indexOf("A:fast") < completed.indexOf("A:slow"));
  assert.equal(new Set(r.steps.map((s) => JSON.stringify([s.graphId, s.nodeId, s.scope, s.visit]))).size, r.steps.length);
  assert.ok(r.steps.every((s) => s.visit === 0));
  assert.equal(r.steps.length, 32, "every structural and leaf node passes runtime.step");
  assert.match(compiled.source, /Effect\.forEach/);
  assert.match(compiled.source, /concurrency: 3/);
  assert.match(compiled.source, /concurrency: "unbounded"/);
});

test("branch defaults to graph input, explicit bindings and check results are preserved", async (t) => {
  const workflow = definition({ main: { entry: "identity", nodes: [
    { id: "identity", kind: "branch" },
    { id: "bound", kind: "branch", input: literal("bound") },
    { id: "check", kind: "check", command: "node", args: ["--version"] },
    { id: "done", kind: "end", value: { op: "array", items: [ref("nodes", "identity"), ref("nodes", "bound"), ref("nodes", "check")] } },
  ], edges: [{ from: "identity", to: "bound" }, { from: "bound", to: "check" }, { from: "check", to: "done" }] } });
  const compiled = await load(t, workflow);
  const r = recorder(undefined, (_context, node) => {
    assert.equal(node.command, "node");
    assert.deepEqual(node.args, ["--version"]);
    return Effect.succeed({ exitCode: 0 });
  });
  assert.deepEqual(await Effect.runPromise(compiled.run(r.runtime, "original")), ["original", "bound", { exitCode: 0 }]);
  assert.equal(r.steps.length, 4);
});

test("canonical source and hash are stable; code-looking strings and prototype keys remain data", async (t) => {
  const payload = JSON.parse('{"__proto__":{"injected":true},"text":"`); throw new Error(\\"INJECTED\\"); // ${globalThis.compromised = true}"}') as Json;
  const workflow = definition({ main: { entry: "constructor", nodes: [
    { id: "constructor", kind: "transform", value: literal(payload) },
    { id: "done", kind: "end", value: ref("nodes", "constructor") },
  ], edges: [{ from: "constructor", to: "done" }] } });
  const compiled = await load(t, workflow);
  const reordered = { graphs: workflow.graphs, entryGraph: workflow.entryGraph, revision: workflow.revision, name: workflow.name, id: workflow.id, schemaVersion: workflow.schemaVersion };
  assert.equal(compiled.source, compileWorkflow(reordered).source);
  assert.equal(compiled.hash, compileWorkflow(reordered).hash);
  assert.match(compiled.hash, /^[0-9a-f]{64}$/);
  const r = recorder();
  const output = await Effect.runPromise(compiled.run(r.runtime, null));
  assert.deepEqual(output, payload);
  assert.ok(output && typeof output === "object" && Object.hasOwn(output, "__proto__"));
  assert.equal(Object.hasOwn(globalThis, "compromised"), false);
});

test("reuse nodes compile on v9, call runtime.reuse without agents, and are rejected by v8", async (t) => {
  const workflow = definition({ main: { entry: "prior", nodes: [
    { id: "prior", kind: "reuse", bindingId: "planner", outputSchema: { type: "object", properties: { result: {} }, required: ["result"], additionalProperties: false } },
    { id: "done", kind: "end", value: ref("nodes", "prior") },
  ], edges: [{ from: "prior", to: "done" }] } });
  assert.throws(() => compileWorkflow(workflow, "dynamicwf-effect-v8"), /reuse nodes require compiler v9/);
  const compiled = await load(t, workflow);
  let reuseCalls = 0;
  const r = recorder();
  r.runtime.reuse = (_context, node) => {
    reuseCalls++;
    assert.equal(node.bindingId, "planner");
    return Effect.succeed({ result: "frozen-output" });
  };
  assert.deepEqual(await Effect.runPromise(compiled.run(r.runtime, null)), { result: "frozen-output" });
  assert.equal(reuseCalls, 1);
  assert.equal(r.steps.length, 2);
});
test("invalid graphs fail compilation and non-string agent task fails without invoking runtime.agent", async (t) => {
  assert.throws(() => compileWorkflow({}), /schemaVersion|entryGraph|graphs/);
  const workflow = definition({ main: { entry: "work", nodes: [
    { id: "work", kind: "agent", role: "general", task: literal(123) },
    { id: "done", kind: "end", value: ref("nodes", "work") },
  ], edges: [{ from: "work", to: "done" }] } });
  const compiled = await load(t, workflow);
  const r = recorder();
  const outcome = await Effect.runPromise(Effect.either(compiled.run(r.runtime, null)));
  assert.equal(outcome._tag, "Left");
  if (outcome._tag === "Left") assert.match(outcome.left.message, /Agent task must evaluate to a string/);
  assert.equal(r.steps.length, 1);
});

test("object field order has identical direct and compiled error precedence", async t => {
  for (const [missing, invalid] of [["z", "a"], ["2", "10"]]) {
    const fields = { [missing!]: ref("input", "missing"), [invalid!]: { op: "not", value: ref("input", "flag") } as Expr };
    const when: Expr = { op: "exists", value: { op: "object", fields } };
    const edges = [{ from: "start", to: "yes", when }, { from: "start", to: "no" }];
    const workflow = definition({ main: { entry: "start", nodes: [
      { id: "start", kind: "branch" }, { id: "yes", kind: "end", value: literal("yes") }, { id: "no", kind: "end", value: literal("no") },
    ], edges } });
    const compiled = await load(t, workflow);
    for (const flag of [1, true]) {
      const scope = { input: { flag }, nodes: {} };
      const { runtime } = recorder();
      if (flag === 1) {
        assert.throws(() => chooseEdge("start", edges, scope), /boolean/);
        await assert.rejects(Effect.runPromise(compiled.run(runtime, scope.input)), /boolean/);
      } else {
        assert.equal(chooseEdge("start", edges, scope), "no");
        assert.equal(await Effect.runPromise(compiled.run(runtime, scope.input)), "no");
      }
    }
  }
});
