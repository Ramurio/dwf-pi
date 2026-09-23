import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm, symlink, cp, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareExecutionPlan, verifyExecutionPlan, type AvailableExecutionModel } from "../src/execution-plan.js";
import { createOutputValidator, defaultOutputSchema } from "../src/output-schema.js";
import type { AgentConfig } from "../src/catalog.js";
import { WorkflowValidationError, type WorkflowDefinition } from "../src/graph.js";

import { invalidSchemaCases, prepareSchemaCaseIds, validSchemaCases } from "./helpers/schema-cases.js";

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
  assert.equal(plan.runtimeVersion, "dynamicwf-runtime-v9");
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

test("golden v7 plan retains its exact source, hash and original agent keys without frozen capabilities", async () => {
  const saved = JSON.parse(await readFile(new URL("./fixtures/legacy-v7-plan.json", import.meta.url), "utf8"));
  const plan = verifyExecutionPlan(saved);
  assert.equal(plan.hash, "cb0e10a004ada73cda3a09257365b79a35b40e39d579223cdfe2c3f5b8301c1a");
  assert.equal(plan.runtimeVersion, "dynamicwf-runtime-v7");
  assert.equal(plan.compilerVersion, "dynamicwf-effect-v7");
  assert.equal(plan.source, saved.source);
  assert.equal(plan.agents.main!.work!.capabilities, undefined);
  assert.equal(plan.agents.main!.work!.adapterIdentity, undefined);
  const extra = structuredClone(plan); extra.agents.main!.work!.capabilities = { raw: { input: { state: "unknown", provenance: "x" } }, effective: { input: { state: "unknown", provenance: "x" }, toolResult: { state: "unknown", provenance: "x" }, imageMimeTypes: [], adapterRevision: "none" } };
  assert.throws(() => verifyExecutionPlan(rehash(extra)), /fields/);
});
test("golden v8 plan retains frozen capabilities and original keys without reuse semantics", async () => {
  const saved = JSON.parse(await readFile(new URL("./fixtures/legacy-v8-plan.json", import.meta.url), "utf8"));
  const plan = verifyExecutionPlan(saved);
  assert.equal(plan.hash, "1b3df3fc5bce4d674e5d611ee98b835e21dfb89e832847f10983959f9359948a");
  assert.equal(plan.runtimeVersion, "dynamicwf-runtime-v8");
  assert.equal(plan.compilerVersion, "dynamicwf-effect-v8");
  assert.equal(plan.source, saved.source);
  assert.ok(plan.agents.main!.work!.capabilities);
  assert.equal(plan.workflow.graphs.main!.nodes.some(node => node.kind === "reuse"), false);
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
// Снимок подготовлен отдельной копией каталога: general тогда имел workspace-write.
// Сейчас тот же исходный граф недопустим, но разрешения старого плана не меняются.
test("frozen plan survives role default changes without weakening new authoring", async () => {
  const saved = JSON.parse(await readFile(new URL("./fixtures/frozen-role-defaults-plan.json", import.meta.url), "utf8"));
  const plan = verifyExecutionPlan(saved);
  assert.deepEqual(plan, saved);
  assert.equal(plan.agents.main!.worker!.permission, "workspace-write");
  assert.deepEqual(plan.agents.main!.worker!.tools, ["bash"]);
  await assert.rejects(prepareExecutionPlan(saved.workflow, options), /read-only/);

  const denied = structuredClone(plan);
  denied.agents.main!.worker!.permission = "read-only";
  assert.throws(() => verifyExecutionPlan(rehash(denied)), /read-only/);
  const schema = structuredClone(plan);
  schema.agents.main!.worker!.outputSchema = { type: "nonexistent-type" };
  assert.throws(() => verifyExecutionPlan(rehash(schema)), /schema/i);
  const missing = structuredClone(plan);
  delete missing.agents.main!.worker;
  assert.throws(() => verifyExecutionPlan(rehash(missing)), /fields/);
  const skill = structuredClone(plan);
  skill.agents.main!.worker!.tools = [];
  skill.agents.main!.worker!.skills = [{ name: "needs-reader", hash: "invalid", files: [] }];
  assert.throws(() => verifyExecutionPlan(rehash(skill)), /require the read or bash/);
});
test("explicit prompt replaces role prompt and output schema is frozen", async () => {
  const schema = { ...structuredClone(validSchemaCases["answer-override"].schema), required: [...validSchemaCases["answer-override"].schema.required] };
  const plan = await prepareExecutionPlan(workflow({ systemPrompt: "Assigned custom prompt", outputSchema: schema }), options);
  schema.required.push("other");
  assert.equal(plan.agents.main!.work!.systemPrompt, "Assigned custom prompt");
  assert.deepEqual(plan.agents.main!.work!.outputSchema.required, ["answer"]);
});
test("unavailable explicit node/default models fail with no fallback", async () => {
  await assert.rejects(prepareExecutionPlan(workflow({ model: { provider: "xai", id: "grok-heavy" } }), options), /main\/work: Model unavailable: xai\/grok-heavy/);
  await assert.rejects(prepareExecutionPlan(workflow(), { ...options, defaultModel: { provider: "missing", id: "missing" } }), /Model unavailable/);
  await assert.rejects(prepareExecutionPlan(workflow(), { ...options, availableModels: [] }), /No authenticated/);
});
test("unsupported explicit thinking fails, while role default adapts before freezing", async () => {
  await assert.rejects(prepareExecutionPlan(workflow({ thinking: "max" }), options), /main\/work: Unsupported thinking max/);
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
test("physical copy of the shipped skill snapshots referenced resources and stays frozen after the source is removed", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dwf-shipped-skill-"));
  const source = fileURLToPath(new URL("../skills/dynamic-workflows", import.meta.url));
  const required = [
    "SKILL.md", "references/authoring.md", "references/operations.md", "references/recovery.md",
    "references/continuation.md", "references/providers.md", "references/usage.md",
    "recipes/research-trio/README.md", "recipes/research-trio/create.json",
    "recipes/research-trio/patch.json", "recipes/research-trio/input.json",
  ];
  try {
    const skillDir = join(cwd, "dynamic-workflows");
    await cp(source, skillDir, { recursive: true });
    assert.equal((await lstat(skillDir)).isSymbolicLink(), false);
    const captured = Object.fromEntries(await Promise.all(required.map(async path => [path, await readFile(join(skillDir, path))])));
    const original = await prepareExecutionPlan(workflow({ skills: ["dynamic-workflows"] }), { ...options, cwd });
    const snapshot = original.agents.main!.work!.skills[0]!;
    assert.equal(snapshot.name, "dynamic-workflows");
    const files = new Map(snapshot.files.map(file => [file.path, file]));
    for (const path of required) {
      const frozen = files.get(path);
      assert.ok(frozen, path);
      assert.equal(frozen.base64, captured[path]!.toString("base64"));
    }
    JSON.parse(Buffer.from(files.get("recipes/research-trio/create.json")!.base64, "base64").toString("utf8"));
    JSON.parse(Buffer.from(files.get("recipes/research-trio/patch.json")!.base64, "base64").toString("utf8"));
    JSON.parse(Buffer.from(files.get("recipes/research-trio/input.json")!.base64, "base64").toString("utf8"));
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: dynamic-workflows\ndescription: changed after freeze\n---\nchanged");
    await rm(join(skillDir, "references"), { recursive: true });
    await rm(join(skillDir, "recipes"), { recursive: true });
    assert.deepEqual(verifyExecutionPlan(original), original);
    for (const path of required) assert.equal(files.get(path)!.base64, captured[path]!.toString("base64"));
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
    await symlink(join(cwd, "skill"), join(cwd, "skill-root-link"));
    await assert.rejects(prepareExecutionPlan(workflow({ skills: ["skill-root-link"] }), { ...options, cwd }), /Symlink/);
    await rm(join(cwd, "skill-root-link"));
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
  const validate = createOutputValidator(validSchemaCases["local-ref"].schema);
  assert.deepEqual(validate({ count: 2 }), { count: 2 });
  assert.throws(() => validate({ count: "2" }), /Invalid structured output/);
  assert.throws(() => validate({ count: 0 }), /Invalid structured output/);
  assert.throws(() => validate({ count: 2, extra: true }), /Invalid structured output/);
  const draft7 = createOutputValidator(validSchemaCases["draft7-tuple"].schema);
  assert.deepEqual(draft7({ tuple: [2] }), { tuple: [2] });
  const literal = createOutputValidator(validSchemaCases["literal-ref"].schema);
  assert.deepEqual(literal({ $ref: "https://literal.example" }), { $ref: "https://literal.example" });
});
test("invalid output schemas fail direct compilation with independent diagnostics", () => {
  for (const [id, { schema, message }] of Object.entries(invalidSchemaCases)) {
    assert.throws(() => createOutputValidator(schema), { message }, id);
  }
  createOutputValidator(validSchemaCases["answer-override"].schema);
});
test("invalid, remote, async and unknown keyword output schemas fail before inference", async () => {
  for (const id of prepareSchemaCaseIds) {
    const { schema, message } = invalidSchemaCases[id];
    let modelReads = 0;
    await assert.rejects(prepareExecutionPlan(workflow({ outputSchema: schema }), {
      cwd: options.cwd,
      get availableModels() { modelReads++; return models; },
    }), (error: unknown) => {
      assert.ok(error instanceof WorkflowValidationError, id);
      assert.deepEqual(error.issues, [{ path: "$.graphs.main.nodes[0].config.outputSchema", message }], id);
      return true;
    });
    assert.equal(modelReads, 0, id);
  }
});
test("schema fixtures are deeply frozen and mutable copies are independent", () => {
  function assertFrozen(value: unknown): void {
    if (value !== null && typeof value === "object") {
      assert.ok(Object.isFrozen(value));
      Object.values(value).forEach(assertFrozen);
    }
  }
  [invalidSchemaCases, validSchemaCases, prepareSchemaCaseIds].forEach(assertFrozen);
  const original = validSchemaCases["answer-override"].schema;
  const copy = { ...structuredClone(original), properties: { answer: { ...original.properties.answer } }, required: [...original.required] };
  copy.required.push("other");
  copy.properties.answer.type = "string";
  assert.deepEqual(original.required, ["answer"]);
  assert.equal(original.properties.answer.type, "integer");
  assert.notEqual(copy.properties, original.properties);
});
test("output validation neither coerces, inserts defaults, strips fields nor accepts exotic JS values", () => {
  const validate = createOutputValidator(validSchemaCases["count-with-default"].schema);
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
