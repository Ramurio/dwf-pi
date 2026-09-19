import { randomUUID, createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Cause, Effect, Exit, Option } from "effect";
import { executionFailure, failureRecord } from "./execution-failure.js";
import { parseOutputRepairProgress } from "./output-repair.js";
import type { OperationRecord } from "./operation-record.js";
import { groupMembers } from "./process-groups.js";
import { retryProgress, retryRemaining, RetryNotReady, permitsRetry } from "./retry-policy.js";
import type { ExecutionPlan, FrozenAgent, PiWorkerRequest } from "./execution-types.js";
import type { Json, Node } from "./graph.js";
import { assertJson, createOutputValidator } from "./output-schema.js";
import { runCheckProcess, runPiProcess, ProcessCancelled } from "./process-client.js";
import { activationKey, RunStore, type RunRecord } from "./run-store.js";
import { GitWorkspaces, parseWorkspaceSources, type GitOperationOptions, type WorkspaceRecord } from "./workspaces.js";
import type { RuntimeContext, WorkflowRuntime } from "./runtime-contract.js";
import { explicitOutcome } from "./task-outcome.js";
import { explainEdge, ExpressionError, type ExpressionScope } from "./expressions.js";
import type { Edge } from "./graph.js";
import { observeRecoveryFiles, recoveryGitDirectories } from "./recovery-files.js";
import { recoveryRoots } from "./recovery-inspection.js";

const errorOf = (error: unknown) => error instanceof Error ? error : new Error(String(error));
const slotKey = (context: RuntimeContext) => JSON.stringify([context.scope, context.graphId, context.nodeId]);
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export function describeFailureCause(cause: Cause.Cause<unknown>) {
  const error = Option.getOrUndefined(Cause.failureOption(cause));
  return error instanceof ExpressionError ? executionFailure("expression","execution","read-only",error.message).failure : failureRecord(error, {
    code: Cause.isInterruptedOnly(cause) ? "cancelled" : "unknown",phase:"execution",effects:"unknown",
    message:error instanceof Error ? error.message : "Execution interrupted before a checkpoint",
  });
}
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
  collect(context: RuntimeContext, itemId: string, work: () => Effect.Effect<Json, Error>): Effect.Effect<Json, Error> {
    return Effect.suspend(() => {
      const read = Effect.try({ try: () => {
        this.current();
        return this.store.collection(this.run.id, activationKey(context), itemId);
      }, catch: errorOf });
      const save = (result: import("./collection.js").CollectedResult) => Effect.try({ try: () => {
        const record = this.store.recordCollection(this.run.id, this.token, activationKey(context), itemId, result);
        return JSON.parse(JSON.stringify(record.result)) as Json;
      }, catch: errorOf });
      return read.pipe(Effect.flatMap(saved => saved ? Effect.succeed(JSON.parse(JSON.stringify(saved.result)) as Json) : Effect.suspend(work).pipe(
        Effect.matchCauseEffect({
          onSuccess: value => save({ status: "succeeded", value }),
          onFailure: cause => {
            // A composite cause can contain both an ordinary failure and interruption.
            if (Cause.isInterrupted(cause) || Cause.isDie(cause)) return Effect.failCause(cause);
            const failures = Array.from(Cause.failures(cause), error => describeFailureCause(Cause.fail(error)));
            // Control/recovery uncertainty and cleanup failures are not branch data.
            if (!failures.length || failures.some(failure => ["cancelled", "interrupted", "uncertain-effect"].includes(failure.code) || failure.phase === "cleanup")) return Effect.failCause(cause);
            // A branch may have written before a read-only leaf failed.
            return save({ status: "failed", failure: { ...failures[0]!, effects: "unknown" } });
          },
        }),
      )));
    });
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
  private async retryGate(context: RuntimeContext, signal: AbortSignal): Promise<string | undefined> {
    for (;;) {
      await this.gate(signal);
      const manual = this.store.pendingReconciliation(this.run.id, activationKey(context));
      if (manual) {
        const selected = this.store.getActivation(this.run.id, activationKey(context))!;
        const roots = recoveryRoots(this.current(), selected), gitDirectories = (await Promise.all(roots.map(recoveryGitDirectories))).flat();
        const workspace = await observeRecoveryFiles([...roots, ...gitDirectories], manual.workspace.excluded);
        if (workspace.digest !== manual.request.workspaceDigest) throw executionFailure("uncertain-effect", "recovery", "unknown", "Workspace changed after retry authorization; inspect and supersede the decision");
        return manual.request.decisionId;
      }
      const decision = this.store.scheduledRetry(this.run.id,activationKey(context));
      if (!decision) return;
      const remaining = retryRemaining(retryProgress(decision,"scheduled"));
      if (!remaining) return;
      // Small cancellable waits also let pause/resume recheck admission. No total time cap.
      await sleep(Math.min(100,remaining),undefined,{signal});
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
  route(context: RuntimeContext, edges: readonly Edge[], scope: ExpressionScope): Effect.Effect<string, Error> {
    return Effect.try({ try: () => {
      this.current();
      const key = activationKey(context);
      const decision = this.store.transition(this.run.id, key)?.decision ??
        this.store.recordTransition(this.run.id, this.token, key, explainEdge(context.nodeId, edges, scope)).decision;
      if (decision.error) throw executionFailure("expression","routing","read-only",decision.error);
      return decision.to!;
    }, catch: errorOf });
  }
  reuse(context: RuntimeContext, node: Extract<Node, { kind: "reuse" }>): Effect.Effect<Json, Error> {
    return Effect.try({ try: () => {
      const binding = this.store.reusedBinding(this.run.id, node.bindingId);
      if (!binding) throw new Error("Reuse binding is missing from this run's continuation receipt");
      if (binding.targetGraphId !== context.graphId || binding.targetNodeId !== node.id) throw new Error("Reuse binding does not match this node identity");
      const value = createOutputValidator(node.outputSchema)(binding.value);
      this.store.setActivationMetadata(this.run.id, this.token, activationKey(context), {
        reused: {
          bindingId: node.bindingId, sourceRunId: binding.sourceRunId, sourceKey: binding.sourceActivationKey,
          sourceAttempt: binding.sourceAttempt, outputDigest: binding.outputDigest, schemaDigest: binding.schemaDigest,
          ...(binding.producerSchemaDigest ? { producerSchemaDigest: binding.producerSchemaDigest } : {}),
          producerRunId: binding.producerRunId, producerKey: binding.producerKey, producerAttempt: binding.producerAttempt,
          producerGraphId: binding.producerGraphId, producerNodeId: binding.producerNodeId, invocation: false,
        },
      });
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
      const reconciliation = yield* Effect.tryPromise({ try: signal => runtime.retryGate(context,signal), catch: errorOf });
      const node = runtime.plan.workflow.graphs[context.graphId]?.nodes.find(item => item.id === context.nodeId);
      if (!node) return yield* Effect.fail(new Error("Activation is absent from frozen graph"));
      let executedAttempt: number | undefined;
      return yield* Effect.acquireUseRelease(
        Effect.try({ try: () => runtime.store.beginActivation(runtime.run.id, runtime.token, context, {
          kind: node.kind, sideEffect: ["agent", "check", "worktree", "integrate"].includes(node.kind),
          ...(reconciliation ? { reconciliation } : {}),
        }), catch: errorOf }),
        record => record.status === "succeeded" ? Effect.succeed(structuredClone(record.output!)) : Effect.suspend(() => { executedAttempt=record.attempt;return work(); }).pipe(
          Effect.tap(output => Effect.try({ try: () => {
            assertJson(output);
            runtime.store.completeActivation(runtime.run.id, runtime.token, record.key, output);
          }, catch: errorOf })),
        ),
        (record, exit) => Effect.sync(() => {
          if (record.status === "succeeded") return;
          const latest = runtime.store.getActivation(runtime.run.id, record.key);
          if (latest?.status === "running" && runtime.store.get(runtime.run.id).ownerToken === runtime.token) {
            const failure = Exit.isFailure(exit) ? describeFailureCause(exit.cause) : executionFailure("unknown","execution","unknown","Activation finished without a checkpoint").failure;
            const causes=Exit.isFailure(exit)?Array.from(Cause.failures(exit.cause),error=>describeFailureCause(Cause.fail(error))):[];
            const policy=node.kind === "agent" || node.kind === "check" ? node.retryPolicy : undefined;
            const retryEligible=Exit.isFailure(exit) && !Cause.isInterrupted(exit.cause) && !Cause.isDie(exit.cause) && causes.length>0 && causes.every(cause=>permitsRetry(policy,record.attempt,cause));
            runtime.store.failActivation(runtime.run.id, runtime.token, record.key,
              Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "Activation finished without a checkpoint",
              ["map","parallel","subworkflow","worktree","integrate"].includes(node.kind) ? {...failure,effects:"unknown"} : failure,
              {retryEligible,...((node.kind==="agent" || node.kind==="check") && causes.length>0?{retryCauses:causes}:{})});
          }
        }),
      ).pipe(Effect.catchAll(error => {
        const current = runtime.store.get(runtime.run.id);
        // A pause can race the outer gate; the journal atomically denies admission.
        if (current.ownerToken === runtime.token && current.desired === "paused" && /not accepting work/.test(error.message)) return runtime.step(context, work);
        if (error instanceof RetryNotReady) return runtime.step(context,work);
        const decision = runtime.store.scheduledRetry(runtime.run.id,activationKey(context));
        if (current.ownerToken === runtime.token && decision && decision.attempt === executedAttempt) return runtime.step(context,work);
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
      this.store.setActivationMetadata(this.run.id,this.token,key,{operation:{kind:"agent",cwd:request.cwd,task,input,sessionDirectory:request.sessionDirectory,resourceDirectory:request.resourceDirectory,...(request.sessionFile?{continuedSessionFile:request.sessionFile}:{})}});
      this.store.startUsage(this.run.id, this.token, key);
      this.checkReviewInput(node, config, input);
      try {
        const result = await runPiProcess(request, {
          signal, identity: workerToken,
          onStarting: workerToken => this.store.setActivationMetadata(this.run.id, this.token, key, { workerPid: null, workerToken, workerKind: "pi", workerLaunch: "reserved", cwd: request.cwd, model: { ...config.model }, thinking: config.thinking }),
          onStarted: workerPid => this.store.setActivationMetadata(this.run.id, this.token, key, { workerPid, workerLaunch: "started", workerGroupPid: workerPid, workerGroupState: "pending" }),
          onEvent: event => {
            if (event.type === "usage.report") {
              if (typeof event.reportId !== "string" || typeof event.stopReason !== "string") throw new Error("Invalid worker usage identity");
              const observedEffort = typeof event.observedEffort === "string" ? event.observedEffort : undefined;
              this.store.recordUsage(this.run.id, this.token, key, event.reportId, event.usage, event.stopReason, observedEffort);
            } else if (event.type === "usage.settled") {
              if (typeof event.complete !== "boolean") throw new Error("Invalid worker accounting completion");
              this.store.settleUsage(this.run.id, this.token, key, event.complete);
            } else if (event.type === "output.repair") {
              const progress = parseOutputRepairProgress(event.progress);
              if (!progress) throw new Error("Invalid worker output repair progress");
              // Metadata and its journal event commit together when progress arrives.
              this.store.setActivationMetadata(this.run.id, this.token, key, { outputRepair: progress });
            } else if (event.type === "session.started" && typeof event.sessionFile === "string") {
              this.store.setActivationMetadata(this.run.id, this.token, key, { sessionFile: event.sessionFile });
            } else this.store.appendEvent(this.run.id, this.token, "worker.event", { key, event: JSON.parse(JSON.stringify(event)) as Json });
          },
        });
        let output: Json;
        try { output = validate(result.output); }
        catch { throw executionFailure("output","output",config.permission === "read-only" ? "read-only" : "unknown","Worker result failed strict output schema validation"); }
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
      this.store.setActivationMetadata(this.run.id,this.token,key,{operation:{kind:"check",cwd,command:node.command,args:[...node.args]}});
      try {
        return await runCheckProcess(node.command, node.args, cwd, {
          signal, identity: workerToken,
          onStarting: workerToken => this.store.setActivationMetadata(this.run.id, this.token, key, { workerPid: null, workerToken, workerKind: "check", workerLaunch: "reserved", cwd }),
          onStarted: workerPid => this.store.setActivationMetadata(this.run.id, this.token, key, { workerPid, workerLaunch: "started", workerGroupPid: workerPid, workerGroupState: "pending" }),
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
    return {
      signal,
      onStarting: workerToken => this.store.setActivationMetadata(this.run.id, this.token, key, { workerPid: null, workerToken, workerKind: "check", workerLaunch: "reserved" }),
      onStarted: workerPid => this.store.setActivationMetadata(this.run.id, this.token, key, { workerPid, workerLaunch: "started", workerGroupPid: workerPid, workerGroupState: "pending" }),
      onFinished: () => this.clearPid(key),
    };
  }
  worktree(context: RuntimeContext, node: Extract<Node, { kind: "worktree" }>, child: (scope: readonly string[]) => Effect.Effect<Json, Error>): Effect.Effect<Json, Error> {
    const runtime = this;
    return Effect.gen(function* () {
      const key = activationKey(context);
      const childScope = [...context.scope, "node", node.id, "visit", String(context.visit), "worktree", "graph", node.graphId];
      const previous = runtime.store.getActivation(runtime.run.id, key)!.metadata;
      const operation:Extract<OperationRecord,{kind:"worktree"}>={kind:"worktree",source:runtime.workspaceCwd(context),childScope:[...childScope],...(node.base?{base:node.base}:{})};
      const resuming = previous.workspacePhase === "children" && previous.workspace !== undefined;
      const reconciliation = previous.reconciliation;
      const recoveringAllocation = previous.workspacePhase === "allocating" && previous.workspace !== undefined &&
        reconciliation && typeof reconciliation === "object" && !Array.isArray(reconciliation) && reconciliation.action === "retry";
      runtime.store.setActivationMetadata(runtime.run.id, runtime.token, key, { operation, ...(resuming ? {} : { workspacePhase: "allocating", childScope }) });
      const allocation = yield* processEffect(signal => resuming
        ? runtime.workspaces.reattach(runtime.workspaceCwd(context), key, previous.workspace!, runtime.gitOptions(context, signal))
        : recoveringAllocation
          ? runtime.workspaces.recoverAllocation(runtime.workspaceCwd(context), key, previous.workspace!, runtime.gitOptions(context, signal),
            progress => runtime.store.setActivationMetadata(runtime.run.id, runtime.token, key, { workspaceRecovery: progress }))
        : runtime.workspaces.allocate(runtime.workspaceCwd(context), key, node.base,
          runtime.gitOptions(context, signal), allocation => runtime.store.setActivationMetadata(runtime.run.id, runtime.token, key, { workspace: { ...allocation } })));
      runtime.store.setActivationMetadata(runtime.run.id, runtime.token, key, { workspacePhase: "children" });
      const result = yield* child(childScope);
      runtime.store.setActivationMetadata(runtime.run.id,runtime.token,key,{operation:{...operation,childResult:result}});
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
      const key=activationKey(context),operation:Extract<OperationRecord,{kind:"integrate"}>={kind:"integrate",target:this.workspaceCwd(context),sources};
      this.store.setActivationMetadata(this.run.id,this.token,key,{operation});
      const owned: WorkspaceRecord[] = [];
      for (const activation of this.store.listActivations(this.run.id)) {
        if (activation.kind === "worktree" && activation.status === "succeeded" && activation.output) owned.push(...parseWorkspaceSources([activation.output]));
      }
      return this.workspaces.integrate(operation.target,sources,owned,this.gitOptions(context,signal),progress=>this.store.setActivationMetadata(this.run.id,this.token,key,{operation:{...operation,progress}}));
    });
  }
  private clearPid(key: string): void {
    if (this.store.get(this.run.id).ownerToken === this.token && this.store.getActivation(this.run.id, key)?.status === "running") {
      const metadata = this.store.getActivation(this.run.id, key)!.metadata;
      if (metadata.workerGroupState === "pending" && typeof metadata.workerGroupPid === "number") {
        const remaining = groupMembers(metadata.workerGroupPid);
        if (remaining.length) throw executionFailure("uncertain-effect", "cleanup", "unknown", `Worker process group ${metadata.workerGroupPid} still has ${remaining.length} live process(es)`);
      }
      this.store.setActivationMetadata(this.run.id, this.token, key, { workerPid: null, workerLaunch: "settled",
        ...(metadata.workerGroupState === "pending" ? { workerGroupState: "empty" } : {}) });
    }
  }
  private checkReviewInput(node: Node, config: FrozenAgent, input: Json): void {
    if (node.kind !== "agent" || node.role !== "reviewer" || !Array.isArray(config.outputSchema.required) || !config.outputSchema.required.includes("artifactRevision")) return;
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.artifactRevision !== "string" || !input.artifactRevision) {
      throw executionFailure("configuration","setup","not-started","Reviewer input must identify the artifactRevision being reviewed");
    }
  }
  private checkReviewOutput(node: Node, config: FrozenAgent, input: Json, output: Json): void {
    if (node.kind !== "agent" || node.role !== "reviewer" || !Array.isArray(config.outputSchema.required) || !config.outputSchema.required.includes("artifactRevision")) return;
    const expected = input as Record<string, Json>;
    const actual = output as Record<string, Json>;
    if (actual.artifactRevision !== expected.artifactRevision ||
        (typeof expected.acceptanceCriteriaRevision === "string" && actual.acceptanceCriteriaRevision !== expected.acceptanceCriteriaRevision)) {
      throw executionFailure("output","output",config.permission === "read-only" ? "read-only" : "unknown","Reviewer verdict does not match the reviewed artifact/criteria revision");
    }
  }
}
