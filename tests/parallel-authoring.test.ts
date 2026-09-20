import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Client, type CallToolResult } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { applyPatch, createDraft, type AuthoringOperation } from "../src/authoring.js";
import { compileWorkflow } from "../src/compiler.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { validateWorkflow, WorkflowValidationError, type Graph, type Node, type WorkflowDefinition } from "../src/graph.js";

const literal = (value: any) => ({ op: "literal" as const, value });
const input = { op: "ref" as const, path: ["input"] };
const graph = (first: Node): Graph => ({ entry: first.id,
  nodes: [first, { id: "done", kind: "end", value: input }], edges: [{ from: first.id, to: "done" }] });
function reportFlow(kind: "parallel" | "map" = "parallel"): WorkflowDefinition {
  return { schemaVersion: 1, id: "reports", name: "Параллельные отчёты", revision: 1, entryGraph: "main", graphs: {
    main: graph(kind === "map" ? { id: "research", kind, graphId: "researcher", items: literal(["one.md", "two.md"]) }
      : { id: "research", kind, children: [
        { id: "one", graphId: "researcher", input: literal("one.md") },
        { id: "two", graphId: "researcher", input: literal("two.md") },
      ] }),
    researcher: graph({ id: "report", kind: "agent", role: "researcher", task: literal("Исследуй и запиши только свой отчёт."),
      config: { permission: "workspace-write", tools: ["read", "write"] } }),
  } };
}
function authoringOperations(flow: WorkflowDefinition): AuthoringOperation[] {
  return Object.entries(flow.graphs).flatMap(([graphId, value]) => [
    ...(graphId === "main" ? [] : [{ op: "addGraph" as const, graphId }]),
    ...value.nodes.map(node => ({ op: "addNode" as const, graphId, node })),
    ...value.edges.map(edge => ({ op: "connect" as const, graphId, edge })),
  ]);
}
function isolate(flow: WorkflowDefinition): void {
  flow.graphs.isolated = graph({ id: "workspace", kind: "worktree", graphId: "researcher", input });
  const fan = flow.graphs.main!.nodes[0]!;
  if (fan.kind === "map") fan.graphId = "isolated";
  else if (fan.kind === "parallel") for (const child of fan.children) child.graphId = "isolated";
}
function invalid(flow: WorkflowDefinition, path = "$.graphs.researcher.nodes[0]") {
  const result = validateWorkflow(flow);
  assert.equal(result.valid, false);
  assert.equal(result.issues[0]?.path, path);
  assert.match(result.issues[0]!.message, /worktree/);
  return result;
}

for (const kind of ["parallel", "map"] as const) test(`${kind}: запись разных отчётов отклоняется уже при patch/validate до каталога моделей`, async () => {
  const flow = reportFlow(kind);
  const result = applyPatch(createDraft({ id: flow.id, name: flow.name }), { expectedRevision: 1, operations: authoringOperations(flow) });
  assert.deepEqual(result.validation, invalid(flow));
  assert.equal(result.workflow.revision, 2, "Черновик сохраняется и допускает исправляющий patch");
  assert.throws(() => compileWorkflow(flow), WorkflowValidationError);
  await assert.rejects(prepareExecutionPlan(flow, { cwd: process.cwd(), availableModels: [] }), WorkflowValidationError);
  isolate(flow);
  assert.equal(validateWorkflow(flow).valid, true);
  const plan = await prepareExecutionPlan(flow, { cwd: process.cwd(), availableModels: [{ provider: "fixture", id: "offline", thinkingLevels: ["off"] }] });
  assert.equal(plan.agents.researcher!.report!.permission, "workspace-write");
});

test("валидация использует разрешение роли, проверяет subworkflow и оба контекста общего графа", () => {
  const flow = reportFlow();
  flow.graphs.researcher!.nodes[0] = { id: "report", kind: "agent", role: "verifier", task: literal("Проверь результат.") };
  invalid(flow);
  flow.graphs.wrapper = graph({ id: "delegate", kind: "subworkflow", graphId: "researcher", input });
  const parallel = flow.graphs.main!.nodes[0]!;
  if (parallel.kind !== "parallel") throw Error("fixture");
  for (const child of parallel.children) child.graphId = "wrapper";
  flow.graphs.main!.nodes.unshift({ id: "first", kind: "subworkflow", graphId: "researcher", input });
  flow.graphs.main!.entry = "first";
  flow.graphs.main!.edges.unshift({ from: "first", to: "research" });
  invalid(flow);
});

test("общий внешний worktree и внутренний concurrency=1 не изолируют соседние ветви", () => {
  const flow = reportFlow();
  flow.graphs.outer = graph({ id: "shared", kind: "worktree", graphId: "main", input });
  flow.entryGraph = "outer";
  invalid(flow);
  flow.graphs.wrapper = graph({ id: "inner", kind: "map", graphId: "researcher", items: literal([1]), concurrency: 1 });
  const parallel = flow.graphs.main!.nodes[0]!;
  if (parallel.kind !== "parallel") throw Error("fixture");
  for (const child of parallel.children) child.graphId = "wrapper";
  invalid(flow);
  flow.graphs.wrapper = graph({ id: "inner", kind: "worktree", graphId: "researcher", input });
  assert.equal(validateWorkflow(flow).valid, true);
});

test("вложенное разветвление после worktree требует собственной изоляции", () => {
  const flow = reportFlow(); isolate(flow);
  flow.graphs.inner = graph({ id: "again", kind: "map", graphId: "researcher", items: literal([1, 2]) });
  const workspace = flow.graphs.isolated!.nodes[0]!;
  if (workspace.kind !== "worktree") throw Error("fixture");
  workspace.graphId = "inner";
  invalid(flow);
});

test("read-only, явная последовательность и единственная ветвь сохраняют прежнее поведение", () => {
  const flow = reportFlow();
  const writer = flow.graphs.researcher!.nodes[0]!;
  if (writer.kind !== "agent") throw Error("fixture");
  writer.config = { permission: "read-only", tools: ["read"] };
  assert.equal(validateWorkflow(flow).valid, true);
  writer.config = { permission: "unrestricted", tools: [] };
  invalid(flow);
  const parallel = flow.graphs.main!.nodes[0]!;
  if (parallel.kind !== "parallel") throw Error("fixture");
  parallel.concurrency = 1;
  assert.equal(validateWorkflow(flow).valid, true);
  delete parallel.concurrency;
  parallel.children.pop();
  assert.equal(validateWorkflow(flow).valid, true);
});

test("integrate под fan-out выявляется рано; check не получает выдуманный профиль разрешений", () => {
  const flow = reportFlow();
  flow.graphs.researcher!.nodes[0] = { id: "report", kind: "integrate", sources: literal([]) };
  invalid(flow);
  isolate(flow);
  assert.equal(validateWorkflow(flow).valid, true);
  const checkFlow = reportFlow();
  checkFlow.graphs.researcher!.nodes[0] = { id: "report", kind: "check", command: "node", args: ["--version"] };
  assert.equal(validateWorkflow(checkFlow).valid, true);
});

test("частичные графы, рекурсия и неверная конфигурация дают issues, а не исключение обхода", () => {
  for (const mutate of [
    (flow: WorkflowDefinition) => { delete flow.graphs.researcher; },
    (flow: WorkflowDefinition) => { flow.graphs.researcher = graph({ id: "report", kind: "subworkflow", graphId: "main", input }); },
    (flow: WorkflowDefinition) => { const writer = flow.graphs.researcher!.nodes[0]!; if (writer.kind === "agent") writer.config = { permission: "read-only", tools: ["bash"] }; },
  ]) { const flow = reportFlow(); mutate(flow); assert.equal(validateWorkflow(flow).valid, false); }
});

for (const transport of ["CLI", "MCP"]) test(`${transport}: агент получает конкретный узел и исправляет черновик без prepare/start`, { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dwf-parallel-authoring-"));
  const store = join(directory, "state.sqlite");
  let client: Client | undefined;
  try {
    if (transport === "MCP") {
      client = new Client({ name: "parallel-authoring-fixture", version: "1" });
      await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", resolve("src/mcp.ts"), "--store", store], stderr: "pipe" }));
    }
    const call = async (tool: string, request: Record<string, unknown>) => {
      let envelope: any;
      if (client) {
        const raw = await client.callTool({ name: tool.replaceAll(".", "_"), arguments: request }) as CallToolResult;
        envelope = raw.structuredContent;
        assert.equal(raw.isError ?? false, false);
      } else {
        const raw = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", tool, "--store", store], { input: JSON.stringify(request), encoding: "utf8", timeout: 15000 });
        assert.equal(raw.status, 0, raw.stderr + raw.stdout); envelope = JSON.parse(raw.stdout);
      }
      assert.equal(envelope.ok, true, JSON.stringify(envelope));
      return envelope.result;
    };
    const flow = reportFlow();
    await call("workflow.create", { id: flow.id, name: flow.name });
    const result = await call("workflow.patch", { id: flow.id, expectedRevision: 1, operations: authoringOperations(flow) });
    assert.deepEqual(result.validation, invalid(flow));
    assert.deepEqual(await call("workflow.validate", { id: flow.id }), result.validation);
    isolate(flow);
    const repair: AuthoringOperation[] = [
      { op: "addGraph", graphId: "isolated" },
      ...flow.graphs.isolated!.nodes.map(node => ({ op: "addNode" as const, graphId: "isolated", node })),
      ...flow.graphs.isolated!.edges.map(edge => ({ op: "connect" as const, graphId: "isolated", edge })),
      { op: "replaceNode", graphId: "main", node: flow.graphs.main!.nodes[0]! },
    ];
    assert.equal((await call("workflow.patch", { id: flow.id, expectedRevision: result.workflow.revision, operations: repair })).validation.valid, true);
    assert.equal((await call("workflow.validate", { id: flow.id })).valid, true);
  } finally { await client?.close(); await rm(directory, { recursive: true, force: true }); }
});
