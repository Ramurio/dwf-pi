import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { applyPatch, createDraft } from "../src/authoring.js";
import { resolveAgentConfig, roleNames, type AgentConfig } from "../src/catalog.js";
import { prepareExecutionPlan, verifyExecutionPlan } from "../src/execution-plan.js";
import { preparedExecutionId, type ExecutionPlan } from "../src/execution-types.js";
import { validateWorkflow, type WorkflowDefinition } from "../src/graph.js";
import { PreparedPlanStore } from "../src/prepared-plans.js";
import { RunController } from "../src/run-controller.js";
import { WorkflowService } from "../src/service.js";

const unavailableSkillTools = [[], ["grep"], ["grep", "find", "ls"], ["write", "edit"]] satisfies AgentConfig["tools"][];
const skillToolError = /skills require.*read.*bash/i;
const models = [{ provider: "offline-test", id: "frozen", thinkingLevels: ["off"] as const }];
function workflow(config: AgentConfig): WorkflowDefinition {
  return { schemaVersion: 1, id: "skill-delivery", name: "Skill delivery", revision: 1, entryGraph: "main", graphs: {
    main: { entry: "work", nodes: [
      { id: "work", kind: "agent", role: "general", task: { op: "literal", value: "Use the selected skill" }, config },
      { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "work"] } },
    ], edges: [{ from: "work", to: "done" }] },
  } };
}
async function fixture(t: TestContext) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "dynamicwf-skill-delivery-")));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, "selected"));
  await writeFile(join(cwd, "selected", "SKILL.md"), "---\nname: selected\ndescription: Selected frozen skill\n---\nRead the assigned input.");
  return { cwd, plan: await prepareExecutionPlan(workflow({ skills: ["selected"] }), { cwd, availableModels: models }) };
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
function inaccessibleSnapshot(plan: ExecutionPlan, tools: NonNullable<AgentConfig["tools"]>): ExecutionPlan {
  const changed = structuredClone(plan);
  changed.agents.main!.work!.tools = tools;
  const { hash: _, ...data } = changed;
  changed.hash = createHash("sha256").update(canonical(data)).digest("hex");
  return changed;
}

for (const tools of unavailableSkillTools) {
  const label = JSON.stringify(tools);
  const config: AgentConfig = { skills: ["selected"], tools, permission: "workspace-write" };
  test(`role resolution rejects skills with inaccessible tool set ${label}`, () => {
    assert.throws(() => resolveAgentConfig("general", config), skillToolError);
    assert.deepEqual(config.tools, tools);
  });
  test(`draft authoring and validation reject skills with inaccessible tool set ${label}`, () => {
    const definition = workflow(config);
    const validation = validateWorkflow(definition);
    assert.equal(validation.valid, false);
    assert.ok(validation.issues.some(issue => skillToolError.test(issue.message)));
    assert.throws(() => applyPatch(createDraft({ id: "skill-delivery", name: "Skills" }), {
      expectedRevision: 1, operations: [{ op: "addNode", graphId: "main", node: definition.graphs.main!.nodes[0]! }],
    }), skillToolError);
  });
  test(`prepare rejects skills with inaccessible tool set ${label} before model discovery or source reads`, async () => {
    let modelReads = 0;
    await assert.rejects(prepareExecutionPlan(workflow(config), {
      cwd: "/skill-delivery-test-missing-workspace",
      get availableModels() { modelReads++; return models; },
    }), skillToolError);
    assert.equal(modelReads, 0);
  });
}

test("selected skills preserve role default tools and explicit read/bash; empty skills need no reader", async t => {
  for (const role of roleNames) {
    const defaults = resolveAgentConfig(role);
    const selected = resolveAgentConfig(role, { skills: ["selected"] });
    assert.deepEqual(selected.tools, defaults.tools, role);
    assert.equal(selected.permission, defaults.permission, role);
  }
  const { cwd } = await fixture(t);
  for (const config of [
    { skills: ["selected"] },
    { skills: ["selected"], tools: ["read"] },
    { skills: ["selected"], tools: ["bash"], permission: "workspace-write" },
    { skills: [], tools: [] },
  ] satisfies AgentConfig[]) {
    const expected = resolveAgentConfig("general", config);
    const plan = await prepareExecutionPlan(workflow(config), { cwd, availableModels: models });
    assert.deepEqual(plan.agents.main!.work!.tools, expected.tools);
    assert.equal(plan.agents.main!.work!.permission, expected.permission);
    assert.equal(plan.agents.main!.work!.skills.length, config.skills.length);
  }
  assert.throws(() => resolveAgentConfig("general", { skills: ["selected"], tools: ["bash"] }), /read-only/);
});

for (const tools of [[], ["grep"]] satisfies AgentConfig["tools"][]) {
  test(`rehashing a frozen inaccessible skill cannot bypass plan verification ${JSON.stringify(tools)}`, async t => {
    const { plan } = await fixture(t);
    const bad = inaccessibleSnapshot(plan, tools);
    // Исходный граф сохраняет доступ к read по умолчанию. Меняются только
    // зафиксированные инструменты; хеш изменённого плана остаётся корректным.
    assert.equal(validateWorkflow(bad.workflow).valid, true);
    assert.throws(() => verifyExecutionPlan(bad), skillToolError);
  });
}

test("prepared plan saving and direct starting reject inaccessible skills before workspace admission", async t => {
  const { cwd, plan } = await fixture(t), bad = inaccessibleSnapshot(plan, []);
  const filename = join(cwd, "state.sqlite"), prepared = new PreparedPlanStore(filename), controller = new RunController(filename);
  try {
    const missing = join(cwd, "removed-workspace");
    await assert.rejects(prepared.save(bad, missing), skillToolError);
    await assert.rejects(controller.startPrepared(bad, null, missing), skillToolError);
    assert.deepEqual(controller.store.listRuns(), []);
  } finally { controller.close(); prepared.close(); }
});

test("persisted prepared plans are revalidated through store and public prepare/start lookups", async t => {
  const { cwd, plan } = await fixture(t), bad = inaccessibleSnapshot(plan, ["grep"]);
  const filename = join(cwd, "state.sqlite"), prepared = new PreparedPlanStore(filename);
  const missing = join(cwd, "removed-workspace"), id = preparedExecutionId(bad.hash, missing);
  const db = new DatabaseSync(filename);
  try {
    db.prepare("INSERT INTO workflow_plan_snapshots(hash,plan) VALUES(?,?)").run(bad.hash, JSON.stringify(bad));
    db.prepare("INSERT INTO workflow_prepared_plans(id,plan_hash,cwd,created_at) VALUES(?,?,?,?)").run(id, bad.hash, missing, 1);
  } finally { db.close(); }
  const service = new WorkflowService(filename, { cwd, availableModels: [] });
  try {
    assert.throws(() => prepared.get(id), skillToolError);
    await assert.rejects(service.dispatch("workflow.prepared", { preparedId: id }), skillToolError);
    await assert.rejects(service.dispatch("run.start", { preparedId: id, idempotencyKey: "invalid-skill", input: null }), skillToolError);
  } finally { service.close(); prepared.close(); }
});
