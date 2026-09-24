import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { WorkflowService } from "../src/service.js";
import { chooseEdge, evaluate } from "../src/expressions.js";
import { compileWorkflow } from "../src/compiler.js";
import { mcpToolDefinitions } from "../src/mcp-tools.js";
const resource = new URL("../skills/dynamic-workflows/recipes/implementation-review/C/patch.json", import.meta.url);
const models = ["plan", "implementation", "first", "second", "third"].map(id => ({ provider: "test", id, thinkingLevels: ["high", "medium", "low"] as const }));
const base = (cwd: string, count = 3) => ({ recipe: "implementation-loop", version: 1, id: "loop", name: "Local loop", cwd, task: "Fix local test", acceptanceCriteria: ["Checks pass"], projectPolicy: "Do not publish", contextFiles: [], checkCommand: "node", checkArgs: ["--version"],
  planner: { model: { provider: "test", id: "plan" }, thinking: "high" }, implementer: { model: { provider: "test", id: "implementation" }, thinking: "medium" },
  reviewers: ["first", "second", "third"].slice(0, count).map((id, i) => ({ id, perspective: `Perspective ${i}`, model: { provider: "test", id }, thinking: "low" })) });
const tree = "git-tree:" + "a".repeat(40);
test("public recipe: one to three independent reviewers, revision guards and deterministic compact preparation", async t => {
  const cwd = mkdtempSync(join(tmpdir(), "recipe-api-")); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const service = new WorkflowService(join(cwd, "journal.sqlite"), { cwd, availableModels: models }); t.after(() => service.close());
  const example = JSON.parse(readFileSync(new URL("../skills/dynamic-workflows/recipes/implementation-review/prepare.example.json", import.meta.url), "utf8"));
  const exampleRequest = { ...example, ...base(cwd), reviewers: example.reviewers.map((r: any, i: number) => ({ ...r, model: models[i + 2] && { provider: "test", id: models[i + 2]!.id } })) };
  assert.equal((await service.dispatch("workflow.recipe.prepare", exampleRequest) as any).summary.agents.length, 5);
  const original = readFileSync(resource); const description = await service.dispatch("workflow.recipe.describe", { recipe: "implementation-loop", version: 1 }) as any;
  assert.equal(description.parameters.additionalProperties, false);
  assert(mcpToolDefinitions.some(d => d.serviceTool === "workflow.recipe.prepare" && JSON.stringify(d.inputSchema) === JSON.stringify(description.parameters)));
  for (const count of [1, 2, 3]) {
    const request = base(cwd, count); const result = await service.dispatch("workflow.recipe.prepare", request) as any;
    const again = await service.dispatch("workflow.recipe.prepare", request) as any;
    assert.equal(result.preparedId, again.preparedId);
    assert.equal(result.summary.publication, "none"); assert.deepEqual(result.summary.check, { command: request.checkCommand, args: request.checkArgs });
    for (const reviewer of request.reviewers) assert.equal(result.summary.agents.find((a: any) => a.graphId === `review-${reviewer.id}`).perspective, reviewer.perspective);
    assert(!JSON.stringify(result).includes("SNAPSHOT_SOURCE")); assert(!JSON.stringify(result).includes('"graphs"'));
    const saved = await service.dispatch("workflow.prepared", { preparedId: result.preparedId }) as any;
    assert.equal(saved.planHash, result.planHash); compileWorkflow(saved.plan.workflow);
    assert.equal(saved.plan.workflow.graphs.pipeline.nodes.find((n: any) => n.id === "reviews").children.length, count);
    for (const reviewer of request.reviewers) {
      const frozen = saved.plan.agents[`review-${reviewer.id}`].review;
      assert.deepEqual(frozen.model, reviewer.model); assert.equal(frozen.thinking, reviewer.thinking);
      assert.equal(frozen.session, "fresh"); assert.equal(frozen.permission, "read-only");
      assert.deepEqual(frozen.tools, ["read", "grep", "find", "ls"]);
    }
    assert.equal(saved.plan.agents.pipeline.implement.session, "continue-node");
    const main = saved.plan.workflow.graphs.main, pipeline = saved.plan.workflow.graphs.pipeline;
    const input = result.input;
    const rootRoute = (candidate: any) => chooseEdge("candidate", main.edges, { input, nodes: { candidate } });
    const reviews = Object.fromEntries(request.reviewers.map(r => [r.id, { decision: "approve", artifactRevision: tree, acceptanceCriteriaRevision: input.acceptanceCriteriaRevision }]));
    const candidate = { result: { status: "accepted", checks: { exitCode: 0 }, artifactRevision: tree, review: reviews } };
    assert.equal(rootRoute(candidate), "accepted");
    for (const reviewer of request.reviewers) for (const [field, value] of [["decision", "request_changes"], ["decision", "inconclusive"], ["artifactRevision", "stale"], ["acceptanceCriteriaRevision", "stale"]]) {
      const denied = structuredClone(candidate); (denied.result.review as any)[reviewer.id][field!] = value;
      assert.equal(rootRoute(denied), "inconclusive");
    }
    const missing = structuredClone(candidate); delete (missing.result.review as any)[request.reviewers[0]!.id]; assert.equal(rootRoute(missing), "inconclusive");
    assert.equal(chooseEdge("inputBinding", main.edges, { input: { ...input, task: "altered" }, nodes: {} }), "invalidBinding");
    assert.equal(chooseEdge("inputBinding", main.edges, { input: {}, nodes: {} }), "invalidBinding");
    assert.equal(chooseEdge("inputBinding", main.edges, { input: { ...input, extra: true }, nodes: {} }), "invalidBinding");
    const pipelineRoute = (nodes: any) => chooseEdge("reviews", pipeline.edges, { input, nodes });
    assert.equal(pipelineRoute({ reviews, snapshot: { exitCode: 0, stdout: tree } }), "accepted");
    for (const reviewer of request.reviewers) {
      const denied = structuredClone(reviews); denied[reviewer.id]!.artifactRevision = "stale";
      assert.equal(pipelineRoute({ reviews: denied, snapshot: { exitCode: 0, stdout: tree } }), "implement");
    }
    assert.equal(pipelineRoute({ reviews, snapshot: { exitCode: 1, stdout: tree } }), "implement");
    assert.equal(chooseEdge("check", pipeline.edges, { input, nodes: { check: { exitCode: 1 } } }), "implement");
    const blocked = pipeline.nodes.find((n: any) => n.id === "blocked");
    assert.equal(evaluate(blocked.value.fields.approvedArtifactRevision, { input, nodes: { snapshot: { stdout: tree } } }), null);
    assert.deepEqual(main.nodes.find((n: any) => n.id === "candidate").expectedTreeFromResult, ["approvedArtifactRevision"]);
    assert.equal(Object.values(saved.plan.workflow.graphs).flatMap((g: any) => g.nodes).some((n: any) => n.kind === "integrate"), false);
  }
  assert.deepEqual(readFileSync(resource), original);
  const a = await service.dispatch("workflow.recipe.prepare", base(cwd)) as any;
  const changed = base(cwd); changed.reviewers[2]!.perspective = "different";
  assert.notEqual((await service.dispatch("workflow.recipe.prepare", changed) as any).preparedId, a.preparedId);
  await assert.rejects(service.dispatch("workflow.inspect", { id: "loop" }), /Workflow not found/);
});
test("perspectives with replacement tokens, quotes and newlines survive public preparation verbatim", async t => {
  const cwd = mkdtempSync(join(tmpdir(), "recipe-perspectives-")); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const service = new WorkflowService(join(cwd, "journal.sqlite"), { cwd, availableModels: models }); t.after(() => service.close());
  const perspectives = ["Проверь $$", "Проверь $&", "Проверь $`", "Проверь $'", 'Кавычки " и \\', "Первая строка\nВторая строка"];
  for (const perspective of perspectives) {
    const request = base(cwd, 1); request.reviewers[0]!.perspective = perspective;
    const original = structuredClone(request);
    const prepared = await service.dispatch("workflow.recipe.prepare", request) as any;
    assert.deepEqual(request, original);
    const agent = prepared.summary.agents.find((a: any) => a.graphId === "review-first");
    assert.equal(agent?.perspective, perspective);
    const saved = await service.dispatch("workflow.prepared", { preparedId: prepared.preparedId }) as any;
    assert.equal(saved.planHash, prepared.planHash);
    const review = saved.plan.workflow.graphs["review-first"].nodes.find((node: any) => node.id === "review");
    assert.equal(review.task.op, "literal");
    assert(review.task.value.includes(`Основной ракурс ревью (JSON): ${JSON.stringify(perspective)}\nСохраняйте независимость;`));
  }
  const database = new DatabaseSync(join(cwd, "journal.sqlite"));
  try {
    const before = (database.prepare("SELECT count(*) AS count FROM workflow_prepared_plans").get() as { count: number }).count;
    const invalid = base(cwd, 1); invalid.reviewers[0]!.model.id = "unavailable";
    await assert.rejects(service.dispatch("workflow.recipe.prepare", invalid), /reviewers\[0\].model.id: Model unavailable/);
    assert.equal((database.prepare("SELECT count(*) AS count FROM workflow_prepared_plans").get() as { count: number }).count, before);
  } finally { database.close(); }
});
test("recipe rejects malformed and unavailable settings without a draft or partial prepared handle", async t => {
  const cwd = mkdtempSync(join(tmpdir(), "recipe-errors-")); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const service = new WorkflowService(join(cwd, "journal.sqlite"), { cwd, availableModels: models }); t.after(() => service.close());
  const cases: [string, (value: any) => void, RegExp][] = [
    ["empty", v => { v.reviewers = []; }, /reviewers/], ["duplicate", v => { v.reviewers[1].id = "first"; }, /reviewers/],
    ["bad id", v => { v.reviewers[0].id = "bad.dot"; }, /reviewers\[0\].id/],
    ["unknown", v => { v.reviewers[2].model.extra = true; }, /reviewers\[2\].model.extra/],
    ["version", v => { v.version = 2; }, /version/], ["criteria", v => { v.acceptanceCriteria = []; }, /acceptanceCriteria/],
    ["argv", v => { v.checkArgs = ["\0"]; }, /checkArgs\[0\]/],
    ["missing model", v => { v.reviewers[0].model.id = "unavailable"; }, /reviewers\[0\].model.id: Model unavailable/],
    ["thinking", v => { v.reviewers[0].thinking = "max"; }, /reviewers\[0\].thinking: Unsupported thinking/],
    ["cwd", v => { v.cwd = join(cwd, "missing"); }, /ENOENT/],
  ];
  for (const [label, change, error] of cases) {
    const value: any = base(cwd); change(value);
    await assert.rejects(service.dispatch("workflow.recipe.prepare", value), error, label);
  }
  await assert.rejects(service.dispatch("workflow.inspect", { id: "loop" }), /Workflow not found/);
  const safe = base(cwd, 1);
  safe.checkArgs = ["-e", "require('node:fs').writeFileSync('marker','executed')"];
  const prepared = await service.dispatch("workflow.recipe.prepare", safe) as any;
  assert.equal(prepared.summary.check.command, "node");
  assert.equal(existsSync(join(cwd, "marker")), false);
});
test("recipe keyed start: invalid binding rejects before candidate and duplicate delivery keeps one run", { timeout: 30_000 }, async t => {
  const cwd = mkdtempSync(join(tmpdir(), "recipe-start-")); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const args of [["init", "-q"], ["config", "user.name", "Fixture"], ["config", "user.email", "fixture@localhost"], ["config", "commit.gpgsign", "false"], ["add", "."], ["commit", "--allow-empty", "-qm", "initial"]]) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" }); assert.equal(result.status, 0, result.stderr);
  }
  const service = new WorkflowService(join(cwd, "journal.sqlite"), { cwd, availableModels: models }); t.after(() => service.close());
  const prepared = await service.dispatch("workflow.recipe.prepare", base(cwd, 1)) as any;
  const input = { ...prepared.input, task: "different" };
  const request = { preparedId: prepared.preparedId, input, idempotencyKey: "one-delivery" };
  const started = await service.dispatch("run.start", request) as any;
  const repeated = await service.dispatch("run.start", request) as any; assert.equal(repeated.id, started.id);
  const deadline = Date.now() + 15_000;
  let status: any;
  do {
    status = await service.dispatch("run.status", { id: started.id });
    if (Date.now() > deadline) throw Error(`Timed out: ${status.status}`);
    if (!['succeeded', 'failed', 'cancelled'].includes(status.status)) await sleep(50);
  } while (!['succeeded', 'failed', 'cancelled'].includes(status.status));
  assert.equal(status.status, "succeeded"); assert.equal(status.taskOutcome?.decision, "inconclusive");
  assert.equal((await service.dispatch("run.list", {}) as any[]).length, 1);
  await assert.rejects(service.dispatch("run.start", { ...request, input: prepared.input }), /idempotency conflict/);
  assert.equal(readFileSync(resource).length > 0, true);
});
