import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { resolveAgentConfig, skillToolIssue, type AgentConfig } from "./catalog.js";
import { compileWorkflow, compilerVersion, type CompilerVersion } from "./compiler.js";
import { assertParallelWriterIsolation } from "./parallel-isolation.js";
import { runtimeVersion, type ExecutionPlan, type FrozenAgent, type SkillSnapshot } from "./execution-types.js";
import { assertJson, createOutputValidator, defaultOutputSchema } from "./output-schema.js";
import { isCompatiblePlanPair, supportsFrozenCapabilities, supportsOutputRepair } from "./compiler-versions.js";
import { parseAdapterIdentity } from "./adapter-identity.js";
import {
  noneAdapterCapabilities, parseAgentRequirements, parseFrozenCapabilities, parseReasoningSnapshot,
  requirementsSatisfied, type FrozenCapabilities,
} from "./capabilities.js";

type Thinking = FrozenAgent["thinking"];
export interface AvailableExecutionModel {
  provider: string;
  id: string;
  thinkingLevels: readonly Thinking[];
  capabilities?: FrozenCapabilities;
  adapterIdentity?: import("./adapter-identity.js").AdapterIdentityRecord | null;
}
export interface PrepareExecutionOptions {
  cwd: string;
  defaultModel?: { provider: string; id: string };
  /** Explicit authenticated catalog injection for tests; never performs discovery when supplied. */
  availableModels?: readonly AvailableExecutionModel[];
}
const levels: readonly Thinking[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export async function prepareExecutionPlan(workflow: unknown, options: PrepareExecutionOptions): Promise<ExecutionPlan> {
  const compiled = compileWorkflow(workflow);
  assertParallelWriterIsolation(compiled.workflow);
  const hasAgents = Object.values(compiled.workflow.graphs).some((graph) => graph.nodes.some((node) => node.kind === "agent"));
  const models = hasAgents ? options.availableModels ?? await discoverModels() : [];
  const agents: ExecutionPlan["agents"] = Object.create(null);
  for (const [graphId, graph] of Object.entries(compiled.workflow.graphs)) {
    agents[graphId] = Object.create(null);
    for (const node of graph.nodes) {
      if (node.kind !== "agent") continue;
      const config = resolveAgentConfig(node.role, node.config);
      const requestedModel = config.model ?? options.defaultModel;
      const model = requestedModel
        ? models.find((candidate) => candidate.provider === requestedModel.provider && candidate.id === requestedModel.id)
        : models.find((candidate) => candidate.provider === "openai-codex" && candidate.id === "gpt-5.6-sol") ?? models[0];
      if (!model) throw new Error(requestedModel ? `Model unavailable: ${requestedModel.provider}/${requestedModel.id}` : "No authenticated pi models available");
      if (!model.thinkingLevels.length || model.thinkingLevels.some((level) => !levels.includes(level))) throw new Error(`Invalid thinking capability catalog for ${model.provider}/${model.id}`);
      const requestedThinking = config.thinking ?? "medium";
      if (node.config?.thinking !== undefined && !model.thinkingLevels.includes(requestedThinking)) throw new Error(`Unsupported thinking ${requestedThinking} for ${model.provider}/${model.id}; supported: ${model.thinkingLevels.join(", ")}`);
      // Defaults adapt to actual model capabilities; explicit requests above never silently fall back.
      const thinking = model.thinkingLevels.includes(requestedThinking) ? requestedThinking
        : [...levels].reverse().find((level) => levels.indexOf(level) <= levels.indexOf(requestedThinking) && model.thinkingLevels.includes(level)) ?? model.thinkingLevels[0]!;
      const outputSchema = structuredClone(config.outputSchema ?? defaultOutputSchema);
      createOutputValidator(outputSchema);
      const skills: SkillSnapshot[] = [];
      for (const path of config.skills ?? []) skills.push(await snapshotSkill(path, options.cwd));
      if (new Set(skills.map((skill) => skill.name)).size !== skills.length) throw new Error(`Duplicate skill names at ${graphId}/${node.id}`);
      const capabilities = structuredClone(model.capabilities ?? noneAdapterCapabilities());
      const requirements = structuredClone(config.requirements ?? {});
      if (!requirementsSatisfied(requirements, capabilities)) {
        throw new Error(`Unsupported or unknown required image capability for ${model.provider}/${model.id}`);
      }
      agents[graphId]![node.id] = {
        model: { provider: model.provider, id: model.id }, thinking,
        systemPrompt: config.systemPrompt!, tools: [...config.tools!], skills,
        session: config.session!, permission: config.permission!, outputSchema,
        outputRepair: structuredClone(config.outputRepair!),
        requirements, capabilities,
        adapterIdentity: model.adapterIdentity === undefined ? null : structuredClone(model.adapterIdentity),
        reasoning: { available: [...model.thinkingLevels], requested: requestedThinking, resolved: thinking },
      };
    }
  }
  const data: Omit<ExecutionPlan, "hash"> = {
    version: 1, runtimeVersion, compilerVersion, workflow: compiled.workflow,
    source: compiled.source, sourceHash: compiled.hash, agents,
  };
  return verifyExecutionPlan({ ...data, hash: digest(data) });
}

async function discoverModels(): Promise<AvailableExecutionModel[]> {
  const { discoverWorkflowModels } = await import("./model-runtime.js");
  return discoverWorkflowModels();
}

/** Verify persisted content without consulting current auth, skills, or mutable role defaults. */
export function verifyExecutionPlan(value: unknown): ExecutionPlan {
  assertJson(value);
  const plan = object(value, "execution plan");
  keys(plan, ["version", "runtimeVersion", "compilerVersion", "workflow", "source", "sourceHash", "agents", "hash"], "execution plan");
  if (plan.version !== 1 || typeof plan.runtimeVersion !== "string" || typeof plan.compilerVersion !== "string" || !isCompatiblePlanPair(plan.runtimeVersion, plan.compilerVersion)) throw new Error("Unsupported execution plan/compiler/runtime version");
  const agents = object(plan.agents, "agents");
  // Сохранённый план проверяем с его разрешениями, а не с сегодняшними defaults роли.
  const compiled = compileWorkflow(plan.workflow, plan.compilerVersion as CompilerVersion, agents as ExecutionPlan["agents"]);
  if (plan.source !== compiled.source || plan.sourceHash !== compiled.hash) throw new Error("Execution plan compiled source or source hash mismatch");
  keys(agents, Object.keys(compiled.workflow.graphs), "agent graphs");
  for (const [graphId, graph] of Object.entries(compiled.workflow.graphs)) {
    const configs = object(agents[graphId], `agents.${graphId}`);
    keys(configs, graph.nodes.filter((node) => node.kind === "agent").map((node) => node.id), `agents.${graphId}`);
    for (const [nodeId, value] of Object.entries(configs)) verifyAgent(value, `${graphId}/${nodeId}`, String(plan.runtimeVersion));
  }
  assertParallelWriterIsolation(compiled.workflow, agents as ExecutionPlan["agents"]);
  const { hash, ...data } = plan;
  if (typeof hash !== "string" || hash !== digest(data)) throw new Error("Execution plan hash mismatch");
  return freeze(structuredClone(plan)) as unknown as ExecutionPlan;
}

function verifyAgent(value: unknown, location: string, runtime: string): void {
  const agent = object(value, location);
  const frozen = supportsFrozenCapabilities(runtime);
  const repair = supportsOutputRepair(runtime);
  keys(agent, ["model", "thinking", "systemPrompt", "tools", "skills", "session", "permission", "outputSchema", ...(repair ? ["outputRepair"] : []), ...(frozen ? ["requirements", "capabilities", "adapterIdentity", "reasoning"] : [])], location);
  if (!Array.isArray(agent.skills)) throw new Error(`${location}: skills must be an array`);
  if (frozen) {
    if (!parseAgentRequirements(agent.requirements)) throw new Error(`${location}: invalid requirements`);
    if (!parseFrozenCapabilities(agent.capabilities)) throw new Error(`${location}: invalid capabilities`);
    if (agent.adapterIdentity !== null && !parseAdapterIdentity(agent.adapterIdentity)) throw new Error(`${location}: invalid adapter identity`);
    if (!parseReasoningSnapshot(agent.reasoning)) throw new Error(`${location}: invalid reasoning snapshot`);
  }
  // Reuse config validation with all frozen values supplied; role defaults cannot alter the snapshot.
  const { skills, capabilities: _capabilities, adapterIdentity: _adapter, reasoning: _reasoning, ...config } = agent;
  resolveAgentConfig("general", { ...config, skills: [] } as AgentConfig);
  for (const key of ["model", "thinking", "systemPrompt", "tools", "session", "permission", "outputSchema"]) if (agent[key] === undefined) throw new Error(`${location}: missing ${key}`);
  const skillIssue = skillToolIssue(skills, agent.tools as FrozenAgent["tools"]);
  if (skillIssue) throw new Error(`${location}: ${skillIssue}`);
  createOutputValidator(object(agent.outputSchema, `${location}.outputSchema`));
  const names = new Set<string>();
  for (const value of skills) {
    const skill = object(value, `${location}.skill`);
    keys(skill, ["name", "hash", "files"], "skill");
    if (typeof skill.name !== "string" || !safeComponent(skill.name) || names.has(skill.name)) throw new Error("Invalid or duplicate skill name");
    names.add(skill.name);
    if (!Array.isArray(skill.files)) throw new Error("Invalid skill files");
    const paths = new Set<string>();
    for (const value of skill.files) {
      const file = object(value, "skill file");
      keys(file, ["path", "base64", "executable"], "skill file");
      if (typeof file.path !== "string" || !safeResourcePath(file.path) || paths.has(file.path)) throw new Error("Invalid or duplicate skill resource path");
      rejectCredentialPath(file.path);
      if (typeof file.base64 !== "string" || Buffer.from(file.base64, "base64").toString("base64") !== file.base64 || typeof file.executable !== "boolean") throw new Error("Invalid skill resource encoding or mode");
      paths.add(file.path);
    }
    for (const path of paths) for (const ancestor of parents(path)) if (paths.has(ancestor)) throw new Error("Skill file/directory path collision");
    if (!paths.has("SKILL.md")) throw new Error("Skill snapshot missing SKILL.md");
    const entry = skill.files.find(file => (file as Record<string, unknown>).path === "SKILL.md") as Record<string, unknown>;
    if (skillName(Buffer.from(entry.base64 as string, "base64").toString("utf8"), skill.name) !== skill.name) throw new Error("Frozen skill name differs from its frontmatter");
    if (skill.hash !== digest({ name: skill.name, files: skill.files })) throw new Error("Skill snapshot hash mismatch");
  }
}

async function snapshotSkill(request: string, cwd: string): Promise<SkillSnapshot> {
  const requested = resolve(cwd, request);
  const requestedStat = await lstat(requested);
  if (requestedStat.isSymbolicLink()) throw new Error(`Symlink skill path is unsupported: ${request}`);
  const root = requestedStat.isDirectory() ? requested : basename(requested) === "SKILL.md" && requestedStat.isFile() ? dirname(requested) : undefined;
  if (!root) throw new Error(`Skill must be a directory or SKILL.md: ${request}`);
  if ((await lstat(root)).isSymbolicLink()) throw new Error(`Symlink skill directory is unsupported: ${request}`);
  const fallbackName = basename(root);
  const files: SkillSnapshot["files"] = [];
  async function walk(relative: string): Promise<void> {
    for (const entry of (await readdir(join(root!, relative))).sort()) {
      const path = relative ? `${relative}/${entry}` : entry;
      if (!safeResourcePath(path)) throw new Error(`Invalid skill resource path: ${path}`);
      rejectCredentialPath(path);
      const full = join(root!, path);
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) throw new Error(`Symlink skill resource is unsupported: ${path}`);
      if (stat.isDirectory()) await walk(path);
      else if (stat.isFile()) files.push({ path, base64: (await readFile(full)).toString("base64"), executable: (stat.mode & 0o111) !== 0 });
      else throw new Error(`Unsupported skill resource file type: ${path}`);
    }
  }
  await walk("");
  if (!files.some((file) => file.path === "SKILL.md")) throw new Error(`Skill directory missing SKILL.md: ${request}`);
  const entry = files.find(file => file.path === "SKILL.md")!;
  const name = skillName(Buffer.from(entry.base64, "base64").toString("utf8"), fallbackName);
  return { name, files, hash: digest({ name, files }) };
}
/** Match pi's explicit-name / parent-directory fallback, and fail unrunnable skills at freeze time. */
function skillName(content: string, fallback: string): string {
  let frontmatter: Record<string, unknown>;
  try { ({ frontmatter } = parseFrontmatter(content)); }
  catch { throw new Error("Invalid skill frontmatter"); }
  if (typeof frontmatter.description !== "string" || !frontmatter.description.trim() || frontmatter.description.length > 1024) throw new Error("Skill requires a nonempty description of at most 1024 characters");
  const name = typeof frontmatter.name === "string" && frontmatter.name ? frontmatter.name : fallback;
  if (!safeComponent(name) || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error("Invalid skill name: use lowercase letters, numbers and single hyphens");
  return name;
}
function safeComponent(value: string): boolean { return value.length > 0 && value !== "." && value !== ".." && !/[\\/\x00-\x1f\x7f:]/.test(value); }
function safeResourcePath(value: string): boolean { return !isAbsolute(value) && value.split("/").every(safeComponent); }
function* parents(path: string): Generator<string> { const parts = path.split("/"); while (parts.length > 1) { parts.pop(); yield parts.join("/"); } }
function rejectCredentialPath(path: string): void {
  if (path.split("/").some((part) => /^(?:\.env(?:\..*)?|auth\.json|credentials(?:\.json)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|\.git|\.ssh|\.aws)$/i.test(part) || /\.(?:pem|key|p12|pfx)$/i.test(part))) throw new Error(`Credential or private metadata resource must not be snapshotted: ${path}`);
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}: expected object`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[], label: string): void {
  if (Object.keys(value).length !== expected.length || expected.some((key) => !Object.hasOwn(value, key))) throw new Error(`Invalid ${label} fields`);
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
function digest(value: unknown): string { return createHash("sha256").update(canonical(value), "utf8").digest("hex"); }
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
