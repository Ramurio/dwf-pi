import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareExecutionPlan, verifyExecutionPlan, type AvailableExecutionModel } from "../src/execution-plan.js";
import { createOutputValidator, defaultOutputSchema } from "../src/output-schema.js";
import type { AgentConfig } from "../src/catalog.js";
import type { WorkflowDefinition } from "../src/graph.js";

const models: AvailableExecutionModel[] = [
  { provider: "example", id: "basic", thinkingLevels: ["off"] },
  { provider: "openai-codex", id: "gpt-5.6-sol", thinkingLevels: ["off", "low", "medium", "high"] },
];
const options = { cwd: process.cwd(), availableModels: models };
function workflow(config?: AgentConfig): WorkflowDefinition {
  return { schemaVersion: 1, id: "sample", name: "Sample", revision: 1, entryGraph: "main", graphs: {
    main: { entry: "work", nodes: [
      { id: "work", kind: "agent", role: "general", task: { op: "literal", value: "Complete task" }, ...(config ? { config } : {}) },
      { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "work"] } },
    ], edges: [{ from: "work", to: "done" }] },
  } };
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
function rehash<T extends { hash: string }>(value: T): T { const { hash: _, ...data } = value; value.hash = createHash("sha256").update(canonical(data)).digest("hex"); return value; }

test("output repair is explicit, closed and frozen; policy changes invalidate the plan hash", async () => {
  const original = workflow({ outputRepair: { mode: "submit-only", maxRounds: 3 } });
  const plan = await prepareExecutionPlan(original, options);
  assert.equal(plan.runtimeVersion, "dynamicwf-runtime-v5");
  assert.deepEqual(plan.agents.main!.work!.outputRepair, { mode: "submit-only", maxRounds: 3 });
  assert.ok(Object.isFrozen(plan.agents.main!.work!.outputRepair));
  const changed = structuredClone(plan); changed.agents.main!.work!.outputRepair = { mode: "disabled" };
  assert.throws(() => verifyExecutionPlan(changed), /hash mismatch/);
  delete changed.agents.main!.work!.outputRepair;
  assert.throws(() => verifyExecutionPlan(rehash(changed)), /fields/);
  const disabled = await prepareExecutionPlan(workflow(), options);
  assert.deepEqual(disabled.agents.main!.work!.outputRepair, { mode: "disabled" });
  const unbounded = await prepareExecutionPlan(workflow({ outputRepair: { mode: "submit-only" } }), options);
  assert.deepEqual(unbounded.agents.main!.work!.outputRepair, { mode: "submit-only" });
  for (const policy of [{ mode: "disabled", maxRounds: 1 }, { mode: "submit-only", maxRounds: 0 }, { mode: "submit-only", maxRounds: 1.5 }, { mode: "submit-only", tools: ["write"] }]) {
    await assert.rejects(prepareExecutionPlan(workflow({ outputRepair: policy as any }), options));
  }
});

test("golden v3 plan retains its exact source, hash and absent repair policy; old plans cannot opt in", async () => {
  const saved = JSON.parse(await readFile(new URL("./fixtures/legacy-v3-plan.json", import.meta.url), "utf8"));
  const plan = verifyExecutionPlan(saved);
  assert.equal(plan.hash, "2d64083e65c7cf51a8a1330ad8dba584f65063b18e1665a5751431cea0acf8e0");
  assert.equal(plan.source, saved.source); assert.equal(plan.agents.main!.work!.outputRepair, undefined);
  const extra = structuredClone(plan); extra.agents.main!.work!.outputRepair = { mode: "submit-only" };
  assert.throws(() => verifyExecutionPlan(rehash(extra)), /fields/);
  const definition = structuredClone(plan);
  const node = definition.workflow.graphs.main!.nodes[0]!;
  assert.equal(node.kind, "agent"); if (node.kind === "agent") node.config = { outputRepair: { mode: "submit-only" } };
  assert.throws(() => verifyExecutionPlan(rehash(definition)), /requires compiler v4/);
});

test("plan freezes concrete model, role defaults, schema and generated code independently of caller", async () => {
  const original = workflow();
  const plan = await prepareExecutionPlan(original, options);
  assert.deepEqual(plan.agents.main!.work!.model, { provider: "openai-codex", id: "gpt-5.6-sol" });
  assert.equal(plan.agents.main!.work!.thinking, "medium");
  assert.deepEqual(plan.agents.main!.work!.outputSchema, defaultOutputSchema);
  assert.match(plan.agents.main!.work!.systemPrompt, /worker in a graph-authored workflow/);
  original.name = "changed";
  assert.equal(plan.workflow.name, "Sample");
  assert.ok(Object.isFrozen(plan.agents.main!.work!.tools));
  assert.deepEqual(verifyExecutionPlan(JSON.parse(JSON.stringify(plan))), plan);
  assert.deepEqual(await prepareExecutionPlan(workflow(), options), plan);
});
test("explicit prompt replaces role prompt and output schema is frozen", async () => {
  const schema = { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"] };
  const plan = await prepareExecutionPlan(workflow({ systemPrompt: "Assigned custom prompt", outputSchema: schema }), options);
  schema.required.push("other");
  assert.equal(plan.agents.main!.work!.systemPrompt, "Assigned custom prompt");
  assert.deepEqual(plan.agents.main!.work!.outputSchema.required, ["answer"]);
});
test("unavailable explicit node/default models fail with no fallback", async () => {
  await assert.rejects(prepareExecutionPlan(workflow({ model: { provider: "xai", id: "grok-heavy" } }), options), /Model unavailable: xai\/grok-heavy/);
  await assert.rejects(prepareExecutionPlan(workflow(), { ...options, defaultModel: { provider: "missing", id: "missing" } }), /Model unavailable/);
  await assert.rejects(prepareExecutionPlan(workflow(), { ...options, availableModels: [] }), /No authenticated/);
});
test("unsupported explicit thinking fails, while role default adapts before freezing", async () => {
  await assert.rejects(prepareExecutionPlan(workflow({ thinking: "max" }), options), /Unsupported thinking max/);
  const plan = await prepareExecutionPlan(workflow(), { ...options, defaultModel: { provider: "example", id: "basic" } });
  assert.equal(plan.agents.main!.work!.thinking, "off");
  const first = await prepareExecutionPlan(workflow(), { ...options, availableModels: [models[0]!] });
  assert.equal(first.agents.main!.work!.model.id, "basic");
});
test("workflows without agent nodes require neither model discovery nor credentials", async () => {
  const noAgents: WorkflowDefinition = { schemaVersion: 1, id: "pure", name: "Pure", revision: 1, entryGraph: "main", graphs: { main: { entry: "done", nodes: [{ id: "done", kind: "end", value: { op: "literal", value: 42 } }], edges: [] } } };
  const plan = await prepareExecutionPlan(noAgents, { cwd: process.cwd(), defaultModel: { provider: "missing", id: "missing" } });
  assert.deepEqual(Object.keys(plan.agents.main!), []);
});
test("skills snapshot full directory, binary and executable files survives originals edited and removed", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dwf-plan-"));
  try {
    await mkdir(join(cwd, "skill", "scripts"), { recursive: true });
    await writeFile(join(cwd, "skill", "SKILL.md"), "---\ndescription: My frozen skill\n---\n# My skill\nRead scripts/run.sh");
    await writeFile(join(cwd, "skill", "scripts", "run.sh"), "#!/bin/sh\necho original\n");
    await chmod(join(cwd, "skill", "scripts", "run.sh"), 0o755);
    await writeFile(join(cwd, "skill", "data.bin"), Buffer.from([0, 255, 128, 10]));
    const original = await prepareExecutionPlan(workflow({ skills: ["skill/SKILL.md"] }), { ...options, cwd });
    const snapshot = original.agents.main!.work!.skills[0]!;
    assert.deepEqual(Buffer.from(snapshot.files.find((file) => file.path === "data.bin")!.base64, "base64"), Buffer.from([0, 255, 128, 10]));
    assert.equal(snapshot.files.find((file) => file.path === "scripts/run.sh")!.executable, true);
    await writeFile(join(cwd, "skill", "SKILL.md"), "---\ndescription: My changed frozen skill\n---\nchanged");
    const updated = await prepareExecutionPlan(workflow({ skills: ["skill"] }), { ...options, cwd });
    assert.notEqual(updated.hash, original.hash);
    assert.notEqual(updated.agents.main!.work!.skills[0]!.hash, snapshot.hash);
    await rm(join(cwd, "skill"), { recursive: true });
    assert.deepEqual(verifyExecutionPlan(original), original);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
test("skills reject symlink resources, credential files and absent skill entry", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dwf-plan-"));
  try {
    await mkdir(join(cwd, "skill"));
    await writeFile(join(cwd, "skill", "SKILL.md"), "hello");
    await symlink(join(cwd, "skill", "SKILL.md"), join(cwd, "skill", "linked"));
    await assert.rejects(prepareExecutionPlan(workflow({ skills: ["skill"] }), { ...options, cwd }), /Symlink/);
    await rm(join(cwd, "skill", "linked"));
    await writeFile(join(cwd, "skill", ".env"), "TEST_SECRET=not-a-real-secret");
    await assert.rejects(prepareExecutionPlan(workflow({ skills: ["skill"] }), { ...options, cwd }), /Credential/);
    await rm(join(cwd, "skill", ".env"));
    await rm(join(cwd, "skill", "SKILL.md"));
    await assert.rejects(prepareExecutionPlan(workflow({ skills: ["skill"] }), { ...options, cwd }), /missing SKILL.md/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
test("tampered source, hash, version, agent set, frozen config and resource traversal fail verification", async () => {
  const plan = await prepareExecutionPlan(workflow(), options);
  const source = structuredClone(plan); source.source += "\nthrow Error('tampered')";
  assert.throws(() => verifyExecutionPlan(rehash(source)), /compiled source/);
  const model = structuredClone(plan); model.agents.main!.work!.model.id = "different";
  assert.throws(() => verifyExecutionPlan(model), /hash mismatch/);
  assert.throws(() => verifyExecutionPlan({ ...plan, runtimeVersion: "future" }), /version/);
  const missing = structuredClone(plan); delete missing.agents.main!.work;
  assert.throws(() => verifyExecutionPlan(rehash(missing)), /fields/);
  const config = structuredClone(plan); config.agents.main!.work!.tools.push("bash");
  assert.throws(() => verifyExecutionPlan(rehash(config)), /read-only/);
  const resource = structuredClone(plan);
  resource.agents.main!.work!.skills.push({ name: "skill", hash: "irrelevant", files: [{ path: "../outside", base64: "", executable: false }] });
  assert.throws(() => verifyExecutionPlan(rehash(resource)), /resource path/);
});
test("structured output validates JSON Schema 2020, draft7 local refs and arbitrary literal ref keys", () => {
  const validate = createOutputValidator({ type: "object", properties: { count: { $ref: "#/$defs/count" } }, required: ["count"], additionalProperties: false, $defs: { count: { type: "integer", minimum: 1 } } });
  assert.deepEqual(validate({ count: 2 }), { count: 2 });
  assert.throws(() => validate({ count: "2" }), /Invalid structured output/);
  assert.throws(() => validate({ count: 0 }), /Invalid structured output/);
  assert.throws(() => validate({ count: 2, extra: true }), /Invalid structured output/);
  const draft7 = createOutputValidator({ $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: { tuple: { type: "array", items: [{ type: "number" }], additionalItems: false } } });
  assert.deepEqual(draft7({ tuple: [2] }), { tuple: [2] });
  const literal = createOutputValidator({ type: "object", const: { $ref: "https://literal.example" } });
  assert.deepEqual(literal({ $ref: "https://literal.example" }), { $ref: "https://literal.example" });
});
test("invalid, remote, async and unknown keyword output schemas fail before inference", async () => {
  for (const schema of [
    { type: "array" }, { type: "object", typo: true }, { type: "object", properties: { x: { type: "banana" } } },
    { type: "object", $ref: "https://remote.example/schema" }, { type: "object", $async: true },
    { type: "object", $schema: "https://unsupported.example" },
  ]) {
    assert.throws(() => createOutputValidator(schema));
    await assert.rejects(prepareExecutionPlan(workflow({ outputSchema: schema }), options));
  }
});
test("output validation neither coerces, inserts defaults, strips fields nor accepts exotic JS values", () => {
  const validate = createOutputValidator({ type: "object", properties: { count: { type: "integer", default: 3 } }, required: ["count"], additionalProperties: false });
  const missing = {}; assert.throws(() => validate(missing)); assert.deepEqual(missing, {});
  const value = { count: "3" }; assert.throws(() => validate(value)); assert.equal(value.count, "3");
  for (const value of [{ count: NaN }, { count: undefined }, { count: 1n }, new Date(), { count: 1, get hidden() { throw Error("getter invoked"); } }]) assert.throws(() => validate(value), /JSON|data property/);
  const generic = createOutputValidator({ ...defaultOutputSchema });
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  assert.throws(() => generic({ result: cyclic }), /cyclic/);
  assert.throws(() => generic({ result: new Array(2) }), /sparse/);
  const original = { result: { mutable: true } }; const result = generic(original); original.result.mutable = false;
  assert.deepEqual(result, { result: { mutable: true } });
});

test("skill snapshot uses declared alias or original directory fallback and validates loadable metadata", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dwf-skill-metadata-"));
  try {
    await mkdir(join(cwd, "original-directory"));
    const path = join(cwd, "original-directory", "SKILL.md");
    await writeFile(path, "---\ndescription: A valid unnamed skill\n---\nRead this skill.");
    const unnamed = await prepareExecutionPlan(workflow({ skills: ["original-directory"] }), { ...options, cwd });
    assert.equal(unnamed.agents.main!.work!.skills[0]!.name, "original-directory");
    await writeFile(path, "---\nname: declared-alias\ndescription: A valid named skill\n---\nRead this skill.");
    const aliased = await prepareExecutionPlan(workflow({ skills: ["original-directory"] }), { ...options, cwd });
    assert.equal(aliased.agents.main!.work!.skills[0]!.name, "declared-alias");
    for (const invalid of ["# Missing metadata", "---\ndescription: ''\n---\nEmpty", "---\ndescription: [not, text]\n---\nWrong type", "---\nname: ../../outside\ndescription: Invalid name\n---\nBad"]) {
      await writeFile(path, invalid);
      await assert.rejects(prepareExecutionPlan(workflow({ skills: ["original-directory"] }), { ...options, cwd }), /description|skill name/);
    }
    const broken = structuredClone(aliased);
    const skill = broken.agents.main!.work!.skills[0]!;
    skill.files[0]!.base64 = Buffer.from("# Missing description").toString("base64");
    skill.hash = createHash("sha256").update(canonical({ name: skill.name, files: skill.files })).digest("hex");
    assert.throws(() => verifyExecutionPlan(rehash(broken)), /description/);
    const renamed = structuredClone(aliased);
    renamed.agents.main!.work!.skills[0]!.name = "mismatched-name";
    assert.throws(() => verifyExecutionPlan(rehash(renamed)), /differs from its frontmatter/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
