import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { applyPatch, createDraft, type AuthoringOperation } from "./authoring.js";
import { compileWorkflow } from "./compiler.js";
import type { Expr, Json } from "./graph.js";
import type { ExecutionPlan, FrozenAgent } from "./execution-types.js";
import type { InputSchema } from "./public-schema.js";

type Profile = { model: { provider: string; id: string }; thinking: FrozenAgent["thinking"] };
type Reviewer = Profile & { id: string; perspective: string };
export type ImplementationRequest = { recipe: "implementation-loop"; version: 1; id: string; name: string; cwd?: string; task: string; acceptanceCriteria: string[]; projectPolicy: string; contextFiles: string[]; checkCommand: string; checkArgs: string[]; planner: Profile; implementer: Profile; reviewers: Reviewer[] };
const text = { type: "string", minLength: 1, pattern: "^[^\\u0000]+$" };
const id = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$" };
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)): InputSchema => ({ type: "object", properties, required, additionalProperties: false });
const profile = obj({ model: obj({ provider: text, id: text }), thinking: { enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] } });
export const recipePrepareSchema = obj({ recipe: { const: "implementation-loop" }, version: { const: 1 }, id, name: text, cwd: text, task: text,
  acceptanceCriteria: { type: "array", minItems: 1, items: text }, projectPolicy: text,
  contextFiles: { type: "array", items: text }, checkCommand: text, checkArgs: { type: "array", items: { type: "string", pattern: "^[^\\u0000]*$" } },
  planner: profile, implementer: profile, reviewers: { type: "array", minItems: 1, items: obj({ id, perspective: text, model: obj({ provider: text, id: text }), thinking: { enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] } }) },
}, ["recipe", "version", "id", "name", "task", "acceptanceCriteria", "projectPolicy", "contextFiles", "checkCommand", "checkArgs", "planner", "implementer", "reviewers"]);
export function describeRecipe(request: unknown) {
  const value = record(request, "request", ["recipe", "version"]);
  version(value);
  return { recipe: "implementation-loop", version: 1, parameters: recipePrepareSchema,
    constraints: ["Явные модели и thinking каждой роли; непустой список уникальных reviewer id; команда и вход задачи зафиксированы в плане.", "Только локальный worktree; публикации, CI и автоматического merge нет."],
    example: { recipe: "implementation-loop", version: 1, id: "example", name: "Пример", cwd: "/path/to/project", task: "Исправьте локальный дефект", acceptanceCriteria: ["Проверки проходят"], projectPolicy: "Сохраняйте контракт", contextFiles: [], checkCommand: "node", checkArgs: ["--test"], planner: { model: { provider: "provider", id: "model" }, thinking: "high" }, implementer: { model: { provider: "provider", id: "model" }, thinking: "medium" }, reviewers: [{ id: "correctness", perspective: "Корректность", model: { provider: "provider", id: "model" }, thinking: "high" }] } };
}
function record(value: unknown, path: string, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`${path}: expected object`);
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) if (!keys.includes(key)) throw Error(`${path}.${key}: unknown field`);
  return result;
}
function version(value: Record<string, unknown>) {
  if (value.recipe !== "implementation-loop") throw Error("recipe: expected implementation-loop");
  if (value.version !== 1) throw Error("version: unsupported implementation-loop version");
}
function string(value: unknown, path: string, nonempty = true): string {
  if (typeof value !== "string" || value.includes("\0") || (nonempty && !value.trim())) throw Error(`${path}: expected ${nonempty ? "nonempty " : ""}string without NUL`);
  return value;
}
function identifier(value: unknown, path: string) {
  const result = string(value, path);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(result) || ["__proto__", "constructor", "prototype"].includes(result)) throw Error(`${path}: invalid identifier`);
  return result;
}
function array(value: unknown, path: string, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min) throw Error(`${path}: expected array with at least ${min} item(s)`);
  return value;
}
function validateProfile(value: unknown, path: string, reviewer = false): Profile {
  const data = record(value, path, reviewer ? ["id", "perspective", "model", "thinking"] : ["model", "thinking"]);
  const m = record(data.model, `${path}.model`, ["provider", "id"]);
  const thinking = data.thinking;
  if (!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(thinking as string)) throw Error(`${path}.thinking: invalid thinking level`);
  return { model: { provider: string(m.provider, `${path}.model.provider`), id: string(m.id, `${path}.model.id`) }, thinking: thinking as Profile["thinking"] };
}
export function parseRecipe(request: unknown): ImplementationRequest {
  const data = record(request, "request", Object.keys(recipePrepareSchema.properties!)); version(data);
  const reviewers = array(data.reviewers, "reviewers", 1).map((value, index) => {
    const path = `reviewers[${index}]`, profile = validateProfile(value, path, true), fields = value as Record<string, unknown>;
    return { ...profile, id: identifier(fields.id, `${path}.id`), perspective: string(fields.perspective, `${path}.perspective`) };
  });
  if (new Set(reviewers.map(r => r.id)).size !== reviewers.length) throw Error("reviewers: duplicate id");
  return { recipe: "implementation-loop", version: 1, id: identifier(data.id, "id"), name: string(data.name, "name"),
    ...(data.cwd === undefined ? {} : { cwd: string(data.cwd, "cwd") }), task: string(data.task, "task"),
    acceptanceCriteria: array(data.acceptanceCriteria, "acceptanceCriteria", 1).map((v, i) => string(v, `acceptanceCriteria[${i}]`)),
    projectPolicy: string(data.projectPolicy, "projectPolicy"),
    contextFiles: array(data.contextFiles, "contextFiles").map((v, i) => string(v, `contextFiles[${i}]`)),
    checkCommand: string(data.checkCommand, "checkCommand"), checkArgs: array(data.checkArgs, "checkArgs").map((v, i) => string(v, `checkArgs[${i}]`, false)),
    planner: validateProfile(data.planner, "planner"), implementer: validateProfile(data.implementer, "implementer"), reviewers };
}
const literal = (value: Json): Expr => ({ op: "literal", value });
const ref = (...path: string[]): Expr => ({ op: "ref", path });
const eq = (left: Expr, right: Expr): Expr => ({ op: "eq", left, right });
const all = (...items: Expr[]): Expr => ({ op: "all", items });
const not = (value: Expr): Expr => ({ op: "not", value });
const exists = (value: Expr): Expr => ({ op: "exists", value });
const canonical = (v: unknown): string => v && typeof v === "object" ? Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v);
const resource = new URL("../skills/dynamic-workflows/recipes/implementation-review/", import.meta.url);
/** Versioned, bundled structural template. Fail closed when its graph changes. */
export async function buildImplementationRecipe(params: ImplementationRequest) {
  const bytes = await readFile(fileURLToPath(new URL("C/patch.json", resource)));
  if (createHash("sha256").update(bytes).digest("hex") !== "a7dd48b4256019e7d1622a71b8394f8e7af1e3abcdd6d1aa134028ec8d5d5527") throw Error("implementation-loop v1: bundled template changed; version the recipe before changing behavior");
  const patch = JSON.parse(bytes.toString()) as { operations: AuthoringOperation[]; expectedRevision: number };
  const ops = patch.operations;
  const node = (graph: string, id: string) => {
    const found = ops.find(o => o.op === "addNode" && o.graphId === graph && o.node.id === id);
    if (!found || found.op !== "addNode") throw Error(`Recipe template missing ${graph}/${id}`);
    return found.node;
  };
  const edge = (graph: string, from: string, to: string) => {
    const found = ops.find(o => o.op === "connect" && o.graphId === graph && o.edge.from === from && o.edge.to === to);
    if (!found || found.op !== "connect") throw Error(`Recipe template missing edge ${graph}/${from}/${to}`);
    return found.edge;
  };
  const input = { task: params.task, acceptanceCriteria: params.acceptanceCriteria, checkCommand: params.checkCommand, checkArgs: params.checkArgs,
    projectPolicy: params.projectPolicy, contextFiles: params.contextFiles,
    acceptanceCriteriaRevision: "sha256:" + createHash("sha256").update(canonical({ task: params.task, acceptanceCriteria: params.acceptanceCriteria })).digest("hex") };
  const binding = all(...Object.entries(input).flatMap(([key, value]) => [exists(ref("input", key)), eq(ref("input", key), literal(value))]));
  // Bind the entire input as well: no extra fields may override task-bound v1 semantics.
  const exact = all(binding, eq(ref("input"), literal(input)));
  edge("main", "inputBinding", "candidate").when = exact;
  edge("main", "inputBinding", "invalidBinding").when = not(exact);
  const invalid = node("main", "invalidBinding");
  if (invalid.kind !== "finish") throw Error("Invalid template binding node");
  invalid.reason = literal("Вход задачи или команды отличается от замороженного рецепта v1. Подготовьте новый план.");
  const plan = node("pipeline", "plan"), implement = node("pipeline", "implement"), check = node("pipeline", "check"), reviews = node("pipeline", "reviews");
  if (plan.kind !== "agent" || implement.kind !== "agent" || check.kind !== "check" || reviews.kind !== "parallel") throw Error("Invalid implementation template nodes");
  plan.config = { ...plan.config, ...params.planner };
  implement.config = { ...implement.config, ...params.implementer };
  // The command is only ever supplied by an explicit caller, never from a worker result.
  check.args[3] = JSON.stringify({ command: params.checkCommand, args: params.checkArgs });
  const oldReview = node("review-correctness", "review"), oldDone = node("review-correctness", "done");
  if (oldReview.kind !== "agent" || oldDone.kind !== "finish") throw Error("Invalid reviewer template");
  reviews.children = params.reviewers.map(r => ({ id: r.id, graphId: `review-${r.id}`, input: structuredClone(reviews.children[0]!.input) }));
  const reviewerOps: AuthoringOperation[] = params.reviewers.flatMap(r => {
    const graphId = `review-${r.id}`;
    const review = structuredClone(oldReview);
    review.config = { ...review.config, model: r.model, thinking: r.thinking };
    if (review.task.op !== "literal" || typeof review.task.value !== "string") throw Error("Invalid reviewer task");
    // A replacement function treats the caller's perspective as data, not as
    // String.replace substitution syntax ($$, $&, $`, $').
    review.task.value = review.task.value.replace(/Основной ракурс ревью:[^\n]*/, () => `Основной ракурс ревью (JSON): ${JSON.stringify(r.perspective)}\nСохраняйте независимость; не читайте ответ другого reviewer.`);
    return [{ op: "addGraph", graphId }, { op: "addNode", graphId, node: review }, { op: "addNode", graphId, node: structuredClone(oldDone) }, { op: "setEntry", graphId, nodeId: "review" }, { op: "connect", graphId, edge: { from: "review", to: "done" } }] as AuthoringOperation[];
  });
  const kept = ops.filter(o => !["review-correctness", "review-contract"].includes(o.graphId));
  // addGraph operations must precede all node operations.
  kept.splice(1, 0, ...reviewerOps.filter(o => o.op === "addGraph"));
  kept.splice(kept.findIndex(o => o.op === "setEntry"), 0, ...reviewerOps.filter(o => o.op !== "addGraph"));
  const votes = (root: "pipeline" | "main") => params.reviewers.flatMap(r => {
    const base = root === "pipeline" ? ["nodes", "reviews", r.id] : ["nodes", "candidate", "result", "review", r.id];
    return root === "pipeline" ? [exists(ref(...base, "decision")), exists(ref(...base, "artifactRevision")), exists(ref(...base, "acceptanceCriteriaRevision")), eq(ref(...base, "decision"), literal("approve")), eq(ref(...base, "artifactRevision"), ref("nodes", "snapshot", "stdout")), eq(ref(...base, "acceptanceCriteriaRevision"), ref("input", "acceptanceCriteriaRevision"))] :
      [exists(ref(...base, "decision")), exists(ref(...base, "artifactRevision")), exists(ref(...base, "acceptanceCriteriaRevision")), eq(ref(...base, "decision"), literal("approve")), eq(ref(...base, "artifactRevision"), ref("nodes", "candidate", "result", "artifactRevision")), eq(ref(...base, "acceptanceCriteriaRevision"), ref("input", "acceptanceCriteriaRevision"))];
  });
  const approved = all(eq(ref("nodes", "snapshot", "exitCode"), literal(0)), ...votes("pipeline"));
  edge("pipeline", "reviews", "accepted").when = approved;
  edge("pipeline", "reviews", "implement").when = not(approved);
  const rootApproved = all(eq(ref("nodes", "candidate", "result", "status"), literal("accepted")), eq(ref("nodes", "candidate", "result", "checks", "exitCode"), literal(0)), ...votes("main"));
  edge("main", "candidate", "accepted").when = rootApproved;
  edge("main", "candidate", "inconclusive").when = not(rootApproved);
  const result = applyPatch(createDraft({ id: params.id, name: params.name }), { expectedRevision: 1, operations: kept });
  if (!result.validation.valid) throw Error(`Invalid implementation-loop v1: ${JSON.stringify(result.validation.issues)}`);
  compileWorkflow(result.workflow);
  return { workflow: result.workflow, input };
}
export function recipeSummary(plan: ExecutionPlan) {
  const agents = Object.entries(plan.agents).flatMap(([graphId, nodes]) => Object.entries(nodes).map(([nodeId, agent]) => ({ graphId, nodeId, model: agent.model, thinking: agent.thinking, tools: agent.tools, permission: agent.permission, session: agent.session,
    ...(graphId.startsWith("review-") ? { perspective: (() => { const task = plan.workflow.graphs[graphId]?.nodes.find(n => n.id === "review"); return task?.kind === "agent" && task.task.op === "literal" && typeof task.task.value === "string" ? (() => { const match = task.task.value.match(/Основной ракурс ревью \(JSON\): (.*)\n/); return match ? JSON.parse(match[1]!) as string : null; })() : null; })() } : {}) })));
  const pipeline = plan.workflow.graphs.pipeline!;
  const check = pipeline.nodes.find(n => n.id === "check");
  if (check?.kind !== "check") throw Error("Recipe check missing");
  const command = JSON.parse(check.args[3]!) as { command: string; args: string[] };
  return { agents, check: command, feedback: "check failure and non-unanimous review return to implement", acceptance: "all reviewers approve current tree and criteria revision; root rechecks; commit bound to approved tree", treeBinding: ["approvedArtifactRevision"], publication: "none" };
}
