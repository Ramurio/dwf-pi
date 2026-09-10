import { diagnoseSystem } from "./doctor.js";
import { discoverWorkflowCatalog } from "./model-runtime.js";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { CreateDraftSchema, DraftPatchSchema, DraftSchema } from "./authoring.js";
import { roleCatalog, roleNames } from "./catalog.js";
import { compileWorkflow } from "./compiler.js";
import { prepareExecutionPlan, type PrepareExecutionOptions } from "./execution-plan.js";
import { ExprSchema, validateWorkflow, WorkflowSchema, type Json } from "./graph.js";
import { assertJson } from "./output-schema.js";
import { RunController } from "./run-controller.js";
import type { ActivationRecord, AttemptRecord, RunEvent, RunRecord } from "./run-store.js";
import { DraftStore } from "./store.js";
import { PresetLibrary, presetName, presetRevision, presetSummary, type PresetScope } from "./presets.js";
import { summarizeUsage } from "./usage.js";
import { PreparedPlanStore, executionWorkspace } from "./prepared-plans.js";

export const serviceToolNames = [
  "catalog.list", "catalog.describe", "catalog.models", "system.doctor", "workflow.schema", "workflow.create", "workflow.list", "workflow.inspect",
  "workflow.patch", "workflow.validate", "workflow.compile", "workflow.prepare", "run.start", "run.status",
  "run.list", "run.inspect", "run.events", "run.usage", "run.pause", "run.resume", "run.cancel",
  "preset.save", "preset.list", "preset.inspect", "preset.run", "run.waits", "run.resolve", "run.trace", "workflow.prepared", "run.attempts", "run.collections", "run.retries", "run.recovery", "run.reconcile", "run.reconciliations",
] as const;
export type ServiceToolName = typeof serviceToolNames[number];
export type WorkflowServiceOptions = Omit<PrepareExecutionOptions, "cwd"> & { cwd?: string };
export function defaultStorePath(): string {
  return join(process.env.DYNAMICWF_HOME ?? join(homedir(), ".dynamicwf"), "state.sqlite");
}

/** Shared harness-independent application API. Closing releases clients, never the detached run. */
export class WorkflowService {
  readonly filename: string;
  readonly cwd: string;
  private drafts?: DraftStore;
  private controller?: RunController;
  private plans?: PreparedPlanStore;
  private closed = false;
  private readonly executionOptions: Omit<PrepareExecutionOptions, "cwd">;
  constructor(filename = defaultStorePath(), options: WorkflowServiceOptions = {}) {
    this.filename = filename === ":memory:" ? filename : resolve(filename);
    this.cwd = resolve(options.cwd ?? process.cwd());
    const { cwd: _, ...executionOptions } = options;
    this.executionOptions = structuredClone(executionOptions);
  }
  private getDrafts(): DraftStore {
    if (!this.drafts) this.drafts = new DraftStore(this.filename);
    return this.drafts;
  }
  private getController(): RunController {
    if (this.filename === ":memory:") throw new Error("Detached runs require a persistent store filename");
    if (!this.controller) this.controller = new RunController(this.filename);
    return this.controller;
  }
  private getPlans(): PreparedPlanStore {
    if (!this.plans) this.plans = new PreparedPlanStore(this.filename);
    return this.plans;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.drafts?.close(); } finally { try { this.controller?.close(); } finally { this.plans?.close(); } }
  }
  async dispatch(tool: string, request: unknown = {}): Promise<unknown> {
    if (this.closed) throw new Error("Workflow service is closed");
    assertJson(request);
    request = structuredClone(request);
    switch (tool) {
      case "catalog.list":
        object(request, []);
        return roleNames.map(name => ({ name, description: roleCatalog[name].description }));
      case "catalog.models": {
        const input = object(request, ["refresh"]);
        if (input.refresh !== undefined && typeof input.refresh !== "boolean") throw new Error("Expected boolean refresh");
        if (this.executionOptions.availableModels !== undefined) return { models: structuredClone(this.executionOptions.availableModels), issues: [] };
        return discoverWorkflowCatalog(input.refresh === undefined ? {} : { refresh: input.refresh });
      }
      case "system.doctor": {
        const input = object(request, ["cwd"]);
        const cwd = input.cwd === undefined ? this.cwd : resolve(this.cwd, nonemptyString(input.cwd, "cwd"));
        return diagnoseSystem({ cwd, filename: this.filename, ...(this.executionOptions.availableModels === undefined ? {} : { availableModels: this.executionOptions.availableModels }) });
      }
      case "catalog.describe": {
        const input = object(request, ["name"]);
        const name = identifier(input.name);
        if (!Object.hasOwn(roleCatalog, name)) throw new Error(`Unknown role: ${name}`);
        return roleCatalog[name as keyof typeof roleCatalog];
      }
      case "workflow.schema":
        object(request, []);
        return { workflow: WorkflowSchema, expression: ExprSchema, draft: DraftSchema, create: CreateDraftSchema, patch: DraftPatchSchema };
      case "workflow.create":
        return this.getDrafts().create(request as unknown as Parameters<DraftStore["create"]>[0]);
      case "workflow.list":
        object(request, []);
        return this.getDrafts().list();
      case "workflow.patch": {
        const input = object(request, ["id", "expectedRevision", "operations"]);
        return this.getDrafts().patch(identifier(input.id), {
          expectedRevision: input.expectedRevision, operations: input.operations,
        } as Parameters<DraftStore["patch"]>[1]);
      }
      case "workflow.inspect": case "workflow.validate": case "workflow.compile": {
        const input = object(request, ["id"]);
        const workflow = this.getDrafts().get(identifier(input.id));
        return tool === "workflow.inspect" ? workflow : tool === "workflow.validate" ? validateWorkflow(workflow) : compileWorkflow(workflow);
      }
      case "workflow.prepared": {
        const input = object(request, ["preparedId"]);
        return this.getPlans().get(preparedIdentifier(input.preparedId));
      }
      case "workflow.prepare": {
        const input = object(request, ["id", "cwd", "model"]);
        const cwd = await executionWorkspace(input.cwd === undefined ? this.cwd : resolve(this.cwd, nonemptyString(input.cwd, "cwd")));
        const options = { ...this.executionOptions, ...(input.model === undefined ? {} : { defaultModel: model(input.model) }) };
        const plan = await prepareExecutionPlan(this.getDrafts().get(identifier(input.id)), { ...options, cwd });
        return this.getPlans().save(plan, cwd);
      }
      case "run.start": {
        const input = object(request, ["id", "preparedId", "idempotencyKey", "input", "cwd", "model"]);
        const value = Object.hasOwn(input, "input") ? input.input as Json : null;
        if (Object.hasOwn(input, "preparedId")) {
          if (["id", "cwd", "model"].some(key => Object.hasOwn(input, key))) throw new Error("Prepared start cannot override id, cwd or model; prepare a new plan instead");
          const start = { preparedId: preparedIdentifier(input.preparedId), ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: nonemptyString(input.idempotencyKey, "idempotencyKey") }) };
          const controller = this.getController();
          const existing = controller.store.findStart(start, value);
          let run;
          if (existing) run = await controller.completeStart(existing.id);
          else {
            const prepared = this.getPlans().get(start.preparedId);
            run = await controller.startPrepared(prepared.plan, value, prepared.cwd, start);
          }
          return publicObservation(controller.snapshot(run.id));
        }
        if (Object.hasOwn(input, "idempotencyKey")) throw new Error("Idempotent start requires preparedId; prepare the draft first");
        const id = identifier(input.id);
        const cwd = input.cwd === undefined ? this.cwd : resolve(this.cwd, nonemptyString(input.cwd, "cwd"));
        const options = { ...this.executionOptions, ...(input.model === undefined ? {} : { defaultModel: model(input.model) }) };
        const controller = this.getController();
        const run = await controller.start(this.getDrafts().get(id), value, cwd, options);
        return publicObservation(controller.snapshot(run.id));
      }
      case "run.list": {
        object(request, []);
        const controller = this.getController();
        return controller.store.listRuns().map(run => publicObservation(controller.snapshot(run.id)));
      }
      case "run.status": case "run.inspect": {
        const input = object(request, ["id"]);
        const controller = this.getController();
        const observed = controller.snapshot(identifier(input.id));
        const summary = publicObservation(observed);
        return tool === "run.status" ? summary : {
          ...summary, input: observed.run.input, workflow: observed.run.plan.workflow,
          activations: controller.store.listActivations(observed.run.id).map(publicActivation),
        };
      }
      case "run.recovery": {
        const input = object(request, ["id", "key"]);
        return this.getController().recovery(identifier(input.id), nonemptyString(input.key, "key"));
      }
      case "run.reconcile": return this.getController().reconcile(request);
      case "run.reconciliations": {
        const input = object(request, ["id", "key"]);
        return this.getController().store.reconciliations(identifier(input.id), input.key === undefined ? undefined : nonemptyString(input.key, "key"));
      }
      case "run.events": {
        const input = object(request, ["id", "after"]);
        const id = identifier(input.id);
        const after = input.after === undefined ? 0 : cursor(input.after);
        const controller = this.getController();
        controller.snapshot(id); // Distinguish an unknown run from an empty event page; reconcile dead processes.
        const events = controller.store.events(id, after).map(publicEvent);
        return { events, nextAfter: events.at(-1)?.seq ?? after };
      }
      case "run.usage": {
        const input = object(request, ["id", "after", "limit"]);
        const id = identifier(input.id);
        const controller = this.getController();
        controller.store.get(id);
        const after = input.after === undefined ? 0 : cursor(input.after);
        const limit = input.limit === undefined ? 100 : cursor(input.limit);
        return { summary: summarizeUsage(controller.store.listActivations(id)), ...controller.store.usageReports(id, after, limit) };
      }
      case "run.trace": {
        const input = object(request, ["id", "after", "limit"]), id = identifier(input.id);
        const store = this.getController().store;
        return { planHash: store.get(id).plan.hash, summary: store.transitionSummary(id),
          ...store.transitions(id, input.after === undefined ? 0 : cursor(input.after), input.limit === undefined ? 100 : cursor(input.limit)) };
      }
      case "run.pause": case "run.resume": case "run.cancel": {
        const input = object(request, ["id"]);
        const id = identifier(input.id);
        const controller = this.getController();
        await controller.control(id, tool.slice(4) as "pause" | "resume" | "cancel");
        return publicObservation(controller.snapshot(id));
      }
      case "run.attempts": {
        const input = object(request, ["id", "key", "after", "limit"]);
        const page = this.getController().store.attempts(identifier(input.id), nonemptyString(input.key,"key"),
          input.after === undefined ? 0 : cursor(input.after), input.limit === undefined ? 100 : cursor(input.limit));
        return publicAttempts(page);
      }
      case "run.collections": {
        const input = object(request, ["id", "key", "after", "limit"]);
        return this.getController().store.collections(identifier(input.id), nonemptyString(input.key,"key"),
          input.after === undefined ? 0 : cursor(input.after), input.limit === undefined ? 100 : cursor(input.limit));
      }
      case "run.retries": {
        const input = object(request, ["id", "key", "after", "limit"]);
        return this.getController().store.retries(identifier(input.id), nonemptyString(input.key,"key"),
          input.after === undefined ? 0 : cursor(input.after), input.limit === undefined ? 100 : cursor(input.limit));
      }
      case "run.waits": {
        const input = object(request, ["id"]);
        const id = identifier(input.id);
        const controller = this.getController();
        return { ...publicObservation(controller.snapshot(id)), waits: controller.store.waits(id) };
      }
      case "run.resolve": {
        const input = object(request, ["id", "waitId", "response", "resolvedBy"]);
        if (!Object.hasOwn(input, "response")) throw new Error("Wait response is required");
        const controller = this.getController(), id = identifier(input.id);
        const wait = await controller.resolve(id, identifier(input.waitId), input.response as Json,
          input.resolvedBy === undefined ? "client" : nonemptyString(input.resolvedBy, "resolvedBy"));
        return { ...publicObservation(controller.snapshot(id)), wait };
      }
      case "preset.save": {
        const input = object(request, ["id", "name", "scope", "cwd"]);
        const scope = presetScope(input.scope) ?? "project";
        const cwd = input.cwd === undefined ? this.cwd : resolve(this.cwd, nonemptyString(input.cwd, "cwd"));
        const library = await this.presetLibrary(scope, cwd);
        const run = this.getController().observe(identifier(input.id)).run;
        const record = await library.save(presetName(input.name), run);
        return { ...presetSummary(record), scope, directory: library.root };
      }
      case "preset.list": {
        const input = object(request, ["scope", "cwd"]);
        const scope = presetScope(input.scope);
        const cwd = input.cwd === undefined ? this.cwd : resolve(this.cwd, nonemptyString(input.cwd, "cwd"));
        const output = [];
        const selected = new Set<string>();
        for (const current of scope ? [scope] : ["project", "global"] as const) {
          const library = await this.presetLibrary(current, cwd);
          for (const record of await library.list()) {
            output.push({ ...presetSummary(record), scope: current, directory: library.root, shadowed: selected.has(record.name) });
            selected.add(record.name);
          }
        }
        return output;
      }
      case "preset.inspect": case "preset.run": {
        const input = object(request, tool === "preset.run" ? ["name", "scope", "revision", "cwd", "input"] : ["name", "scope", "revision", "cwd"]);
        const name = presetName(input.name);
        const scope = presetScope(input.scope);
        const revision = input.revision === undefined ? undefined : presetRevision(input.revision);
        const cwd = input.cwd === undefined ? this.cwd : resolve(this.cwd, nonemptyString(input.cwd, "cwd"));
        for (const current of scope ? [scope] : ["project", "global"] as const) {
          const library = await this.presetLibrary(current, cwd);
          if (!(await library.versions(name)).length) continue;
          const record = await library.read(name, revision);
          if (tool === "preset.inspect") return { ...presetSummary(record), scope: current, directory: library.root, plan: record.plan };
          const run = await this.getController().startPrepared(record.plan, Object.hasOwn(input, "input") ? input.input as Json : null, cwd);
          return { ...publicObservation(this.getController().snapshot(run.id)), preset: { name, scope: current, revision: record.revision } };
        }
        throw new Error(`Preset not found: ${name}`);
      }
      default: throw new Error(`Unknown tool: ${tool}`);
    }
  }
  private async presetLibrary(scope: PresetScope, cwd: string): Promise<PresetLibrary> {
    if (scope === "global") {
      if (this.filename === ":memory:") throw new Error("Global presets require a persistent store filename");
      return new PresetLibrary(join(dirname(this.filename), "presets"));
    }
    const workspace = await realpath(cwd);
    let root = workspace;
    for (;;) {
      if (existsSync(join(root, ".git"))) return new PresetLibrary(join(root, ".dynamicwf", "presets"));
      if (dirname(root) === root) break;
      root = dirname(root);
    }
    return new PresetLibrary(join(workspace, ".dynamicwf", "presets"));
  }
}

/** Public status deliberately excludes the generated source, skill payloads, input and owner fencing token. */
export function publicRunSummary(run: RunRecord) {
  return {
    id: run.id, workflow: { id: run.plan.workflow.id, name: run.plan.workflow.name, revision: run.plan.workflow.revision },
    planHash: run.plan.hash, sourceHash: run.plan.sourceHash,
    ...(run.preparedId === undefined ? {} : { preparedId: run.preparedId }),
    agents: Object.entries(run.plan.agents).flatMap(([graphId, agents]) => Object.entries(agents).map(([nodeId, agent]) => ({
      graphId, nodeId, model: agent.model, thinking: agent.thinking, permission: agent.permission, session: agent.session,
    }))),
    cwd: run.cwd, status: run.status, desired: run.desired, supervisorPid: run.supervisorPid,
    createdAt: run.createdAt, updatedAt: run.updatedAt, heartbeatAt: run.heartbeatAt,
    ...(run.taskOutcome === undefined ? {} : { taskOutcome: run.taskOutcome }),
    ...(run.failure === undefined ? {} : { failure: run.failure }),
    ...(run.output === undefined ? {} : { output: run.output }), ...(run.error === undefined ? {} : { error: run.error }),
  };
}
function publicObservation(observed: ReturnType<RunController["snapshot"]>) {
  return { ...publicRunSummary(observed.run), supervisorAlive: observed.supervisorAlive, workersAlive: observed.workersAlive, unresolvedGroups: observed.unresolvedGroups, presentation: observed.presentation };
}
function publicActivation(record: ActivationRecord) {
  const { ownerToken: _, metadata, ...fields } = record;
  const { workerToken: __, ...publicMetadata } = metadata;
  return { ...fields, metadata: publicMetadata };
}
/** Explicit inspection keeps operation/session provenance but excludes fences and cumulative usage. */
export function publicAttempts(page: ReturnType<RunController["store"]["attempts"]>) {
  const project = (record: AttemptRecord) => {
    const { metadata, ...activation } = publicActivation(record);
    const { usage: _, usageLedgerVersion: _v, usageReportCount: _c, usageRecordedAttempts: _a, usageComplete: _complete, ...details } = metadata;
    return { ...activation, accounting: record.accounting, metadata: details };
  };
  return { ...page, current: project(page.current), records: page.records.map(project) };
}
function publicEvent(event: RunEvent): RunEvent {
  if (event.type === "run.reserved") return { ...event, payload: {} };
  if (event.type === "activation.metadata" && event.payload !== null && typeof event.payload === "object" && !Array.isArray(event.payload)) {
    const metadata = event.payload.metadata;
    if (metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)) {
      const { workerToken: _, ...rest } = metadata;
      return { ...event, payload: { ...event.payload, metadata: rest } };
    }
  }
  return event;
}
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected JSON object");
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Unexpected request field");
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) throw new Error("Expected a workflow, run or role identifier");
  return value;
}
function preparedIdentifier(value: unknown): string {
  if (typeof value !== "string" || !/^prepared-[a-f0-9]{64}$/.test(value)) throw new Error("Expected prepared plan identifier");
  return value;
}
function nonemptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.length || value.includes("\0")) throw new Error(`Expected nonempty ${field} string without NUL`);
  return value;
}
function model(value: unknown): { provider: string; id: string } {
  const input = object(value, ["provider", "id"]);
  return { provider: nonemptyString(input.provider, "model.provider"), id: nonemptyString(input.id, "model.id") };
}
function cursor(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Expected a nonnegative safe integer event cursor");
  return value;
}
function presetScope(value: unknown): PresetScope | undefined {
  if (value === undefined || value === "global" || value === "project") return value;
  throw new Error("Expected preset scope global or project");
}
