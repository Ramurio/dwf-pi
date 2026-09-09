import { randomUUID, createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Cause, Effect, Exit } from "effect";
import type { ExecutionPlan, FrozenAgent, PiWorkerRequest } from "./execution-types.js";
import type { Json, Node } from "./graph.js";
import { assertJson, createOutputValidator } from "./output-schema.js";
import { runCheckProcess, runPiProcess, ProcessCancelled } from "./process-client.js";
import { activationKey, RunStore, type RunRecord } from "./run-store.js";
import { GitWorkspaces, parseWorkspaceSources, type GitOperationOptions, type WorkspaceRecord } from "./workspaces.js";
import type { RuntimeContext, WorkflowRuntime } from "./runtime-contract.js";
import { explicitOutcome } from "./task-outcome.js";

const errorOf = (error: unknown) => error instanceof Error ? error : new Error(String(error));
const slotKey = (context: RuntimeContext) => JSON.stringify([context.scope, context.graphId, context.nodeId]);
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
// Await the process promise during interruption: aborting an Effect must not
// publish terminal state before the worker has actually exited and drained.
function processEffect<A>(run: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, Error> {
  return Effect.async<A, Error>((resume, signal) => {
    const promise = run(signal);
    promise.then(value => resume(Effect.succeed(value)), error => resume(Effect.fail(errorOf(error))));
    return Effect.promise(() => promise.then(() => undefined, () => undefined));
  });
}

/** One instance belongs to one fenced supervisor. Generated code holds only graph-local control state. */
export class JournalRuntime implements WorkflowRuntime {
  private readonly plan: ExecutionPlan;
  private readonly workspaces: GitWorkspaces;
  constructor(readonly store: RunStore, readonly run: RunRecord, readonly token: string, readonly directory: string) {
    this.plan = run.plan;
    this.workspaces = new GitWorkspaces(run.id, directory);
  }
  private current(): RunRecord {
    const current = this.store.get(this.run.id);
    if (current.ownerToken !== this.token) throw new Error("Supervisor ownership lost");
    return current;
  }
  async gate(signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) throw new ProcessCancelled();
      const current = this.current();
      if (current.desired === "cancelled") throw new ProcessCancelled();
      if (current.desired === "running" && ["running", "waiting"].includes(current.status)) return;
      this.updatePause();
      await sleep(100, undefined, signal ? { signal } : {});
    }
  }
  updatePause(): void {
    const current = this.current();
    if (current.desired === "running") { this.store.updateWaiting(this.run.id, this.token); return; }
    if (current.desired !== "paused" || current.status === "paused") return;
    const hasLeaves = this.store.listActivations(this.run.id).some(item => item.status === "running" && !(item.kind === "await" && item.metadata.waiting === true) && (!["map", "parallel", "subworkflow", "worktree"].includes(item.kind) || (item.kind === "worktree" && item.metadata.workspacePhase !== "children")));
    if (!hasLeaves) this.store.markPaused(this.run.id, this.token);
  }

  finish(context: RuntimeContext, node: Extract<Node, { kind: "finish" }>, reason: Json, evidence: Json, value: Json): Effect.Effect<Json, Error> {
    return Effect.try({ try: () => {
      const outcome = explicitOutcome(node.decision, reason, evidence);
      this.store.setActivationMetadata(this.run.id, this.token, activationKey(context), { taskOutcome: JSON.parse(JSON.stringify(outcome)) as Json });
      return value;
    }, catch: errorOf });
  }
  wait(context: RuntimeContext, node: Extract<Node, { kind: "await" }>, reason: Json, input: Json): Effect.Effect<Json, Error> {
    return processEffect(async signal => {
      if (typeof reason !== "string" || !reason.trim()) throw new Error("Wait reason must evaluate to a nonempty string");
      const key = activationKey(context);
      const request = this.store.openWait(this.run.id, this.token, key, reason, input, node.responseSchema);
      this.updatePause();
      for (;;) {
        this.current();
        const wait = this.store.getWait(this.run.id, request.id);
        if (wait.status === "resolved") {
          await this.gate(signal);
          this.store.setActivationMetadata(this.run.id, this.token, key, { waiting: false });
          this.store.updateWaiting(this.run.id, this.token);
          return wait.response!;
        }
        await sleep(100, undefined, { signal });
      }
    });
  }
  step(context: RuntimeContext, work: () => Effect.Effect<Json, Error>): Effect.Effect<Json, Error> {
    const runtime = this;
    return Effect.suspend(() => Effect.gen(function* () {
      yield* Effect.tryPromise({ try: signal => runtime.gate(signal), catch: errorOf });
      const node = runtime.plan.workflow.graphs[context.graphId]?.nodes.find(item => item.id === context.nodeId);
      if (!node) return yield* Effect.fail(new Error("Activation is absent from frozen graph"));
      return yield* Effect.acquireUseRelease(
        Effect.try({ try: () => runtime.store.beginActivation(runtime.run.id, runtime.token, context, {
          kind: node.kind, sideEffect: ["agent", "check", "worktree", "integrate"].includes(node.kind),
        }), catch: errorOf }),
        record => record.status === "succeeded" ? Effect.succeed(structuredClone(record.output!)) : Effect.suspend(work).pipe(
          Effect.tap(output => Effect.try({ try: () => {
            assertJson(output);
            runtime.store.completeActivation(runtime.run.id, runtime.token, record.key, output);
          }, catch: errorOf })),
        ),
        (record, exit) => Effect.sync(() => {
          if (record.status === "succeeded") return;
          const latest = runtime.store.getActivation(runtime.run.id, record.key);
          if (latest?.status === "running" && runtime.store.get(runtime.run.id).ownerToken === runtime.token) {
            runtime.store.failActivation(runtime.run.id, runtime.token, record.key,
              Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "Activation finished without a checkpoint");
          }
        }),
      ).pipe(Effect.catchAll(error => {
        const current = runtime.store.get(runtime.run.id);
        // A pause can race the outer gate; the journal atomically denies admission.
        if (current.ownerToken === runtime.token && current.desired === "paused" && /not accepting work/.test(error.message)) return runtime.step(context, work);
        return Effect.fail(error);
      }));
    }));
  }

  agent(context: RuntimeContext, node: Extract<Node, { kind: "agent" }>, task: string, input: Json): Effect.Effect<Json, Error> {
    return processEffect(async signal => {
      const config = this.plan.agents[context.graphId]?.[node.id];
      if (!config) throw new Error("Missing frozen agent configuration");
      const validate = createOutputValidator(config.outputSchema);
      const key = activationKey(context);
      const workerToken = randomUUID();
      const sessionSlot = slotKey(context);
      const previous = config.session === "continue-node" ? this.store.listActivations(this.run.id)
        .filter(item => slotKey(item.context) === sessionSlot && item.context.visit < context.visit && item.status === "succeeded" && item.metadata.sessionFile)
        .sort((a, b) => b.context.visit - a.context.visit)[0]?.metadata.sessionFile : undefined;
      const request: PiWorkerRequest = {
        version: 1, config, task, input, cwd: this.workspaceCwd(context),
        sessionDirectory: join(this.directory, "sessions", digest(sessionSlot)),
        resourceDirectory: join(this.directory, "resources", workerToken),
        ...(previous ? { sessionFile: previous } : {}),
      };
      this.store.startUsage(this.run.id, this.token, key);
      this.checkReviewInput(node, config, input);
      try {
        const result = await runPiProcess(request, {
          signal, identity: workerToken,
          onStarted: workerPid => this.store.setActivationMetadata(this.run.id, this.token, key, { workerPid, workerToken, workerKind: "pi", cwd: request.cwd, model: { ...config.model }, thinking: config.thinking }),
          onEvent: event => {
            if (event.type === "usage.report") {
              if (typeof event.reportId !== "string" || typeof event.stopReason !== "string") throw new Error("Invalid worker usage identity");
              this.store.recordUsage(this.run.id, this.token, key, event.reportId, event.usage, event.stopReason);
            } else if (event.type === "usage.settled") {
              if (typeof event.complete !== "boolean") throw new Error("Invalid worker accounting completion");
              this.store.settleUsage(this.run.id, this.token, key, event.complete);
            } else if (event.type === "session.started" && typeof event.sessionFile === "string") {
              this.store.setActivationMetadata(this.run.id, this.token, key, { sessionFile: event.sessionFile });
            } else this.store.appendEvent(this.run.id, this.token, "worker.event", { key, event: JSON.parse(JSON.stringify(event)) as Json });
          },
        });
        const output = validate(result.output);
        this.checkReviewOutput(node, config, input, output);
        this.store.setActivationMetadata(this.run.id, this.token, key, {
          workerPid: null, sessionFile: result.sessionFile,
          model: result.model, thinking: result.thinking,
        });
        return output;
      } finally { this.clearPid(key); }
    });
  }
  check(context: RuntimeContext, node: Extract<Node, { kind: "check" }>): Effect.Effect<Json, Error> {
    return processEffect(async signal => {
      const key = activationKey(context);
      const workerToken = randomUUID();
      const cwd = node.cwd ? resolve(this.workspaceCwd(context), node.cwd) : this.workspaceCwd(context);
      try {
        return await runCheckProcess(node.command, node.args, cwd, {
          signal, identity: workerToken,
          onStarted: workerPid => this.store.setActivationMetadata(this.run.id, this.token, key, { workerPid, workerToken, workerKind: "check", cwd }),
        });
      } finally { this.clearPid(key); }
    });
  }
  private workspaceCwd(context: RuntimeContext): string {
    const parents = this.store.listActivations(this.run.id).filter(item => {
      const scope = item.metadata.childScope;
      return item.kind === "worktree" && Array.isArray(scope) && scope.length <= context.scope.length && scope.every((segment, index) => segment === context.scope[index]);
    }).sort((a, b) => (b.metadata.childScope as Json[]).length - (a.metadata.childScope as Json[]).length);
    const workspace = parents[0]?.metadata.workspace;
    return workspace && typeof workspace === "object" && !Array.isArray(workspace) && typeof workspace.path === "string" ? workspace.path : this.run.cwd;
  }
  private gitOptions(context: RuntimeContext, signal: AbortSignal): GitOperationOptions {
    const key = activationKey(context);
    const identity = randomUUID();
    return {
      signal, identity,
      onStarted: workerPid => this.store.setActivationMetadata(this.run.id, this.token, key, { workerPid, workerToken: identity, workerKind: "check" }),
      onFinished: () => this.clearPid(key),
    };
  }
  worktree(context: RuntimeContext, node: Extract<Node, { kind: "worktree" }>, child: (scope: readonly string[]) => Effect.Effect<Json, Error>): Effect.Effect<Json, Error> {
    const runtime = this;
    return Effect.gen(function* () {
      const key = activationKey(context);
      const childScope = [...context.scope, "node", node.id, "visit", String(context.visit), "worktree", "graph", node.graphId];
      const previous = runtime.store.getActivation(runtime.run.id, key)!.metadata;
      const resuming = previous.workspacePhase === "children" && previous.workspace !== undefined;
      if (!resuming) runtime.store.setActivationMetadata(runtime.run.id, runtime.token, key, { workspacePhase: "allocating", childScope });
      const allocation = yield* processEffect(signal => resuming
        ? runtime.workspaces.reattach(runtime.workspaceCwd(context), key, previous.workspace!, runtime.gitOptions(context, signal))
        : runtime.workspaces.allocate(runtime.workspaceCwd(context), key, node.base,
          runtime.gitOptions(context, signal), allocation => runtime.store.setActivationMetadata(runtime.run.id, runtime.token, key, { workspace: { ...allocation } })));
      runtime.store.setActivationMetadata(runtime.run.id, runtime.token, key, { workspacePhase: "children" });
      const result = yield* child(childScope);
      for (;;) {
        yield* Effect.tryPromise({ try: signal => runtime.gate(signal), catch: errorOf });
        const admitted = yield* Effect.try({ try: () => runtime.store.admitWorkspaceCommit(runtime.run.id, runtime.token, key), catch: errorOf });
        if (admitted) break;
      }
      const workspace = yield* processEffect(signal => runtime.workspaces.commit(allocation, runtime.gitOptions(context, signal)));
      runtime.store.setActivationMetadata(runtime.run.id, runtime.token, key, { workspace: { ...workspace }, workspacePhase: "complete" });
      return { result, workspace: { ...workspace } };
    });
  }
  integrate(context: RuntimeContext, _node: Extract<Node, { kind: "integrate" }>, sources: Json): Effect.Effect<Json, Error> {
    return processEffect(async signal => {
      const owned: WorkspaceRecord[] = [];
      for (const activation of this.store.listActivations(this.run.id)) {
        if (activation.kind === "worktree" && activation.status === "succeeded" && activation.output) owned.push(...parseWorkspaceSources([activation.output]));
      }
      return this.workspaces.integrate(this.workspaceCwd(context), sources, owned, this.gitOptions(context, signal));
    });
  }
  private clearPid(key: string): void {
    if (this.store.get(this.run.id).ownerToken === this.token && this.store.getActivation(this.run.id, key)?.status === "running") {
      this.store.setActivationMetadata(this.run.id, this.token, key, { workerPid: null });
    }
  }
  private checkReviewInput(node: Node, config: FrozenAgent, input: Json): void {
    if (node.kind !== "agent" || node.role !== "reviewer" || !Array.isArray(config.outputSchema.required) || !config.outputSchema.required.includes("artifactRevision")) return;
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.artifactRevision !== "string" || !input.artifactRevision) {
      throw new Error("Reviewer input must identify the artifactRevision being reviewed");
    }
  }
  private checkReviewOutput(node: Node, config: FrozenAgent, input: Json, output: Json): void {
    if (node.kind !== "agent" || node.role !== "reviewer" || !Array.isArray(config.outputSchema.required) || !config.outputSchema.required.includes("artifactRevision")) return;
    const expected = input as Record<string, Json>;
    const actual = output as Record<string, Json>;
    if (actual.artifactRevision !== expected.artifactRevision ||
        (typeof expected.acceptanceCriteriaRevision === "string" && actual.acceptanceCriteriaRevision !== expected.acceptanceCriteriaRevision)) {
      throw new Error("Reviewer verdict does not match the reviewed artifact/criteria revision");
    }
  }
}
