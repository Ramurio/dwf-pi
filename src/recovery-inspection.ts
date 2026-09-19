import type { ActivationRecord, RunRecord } from "./run-store.js";
import type { CollectionRecord } from "./collection.js";
import { parseOperation } from "./operation-record.js";
import { recoveryDigest } from "./recovery-files.js";
import { GitWorkspaces, parseWorkspaceSources } from "./workspaces.js";
import type { ContinuationBlocker } from "./lineage.js";

export interface RecoveryBlocker { code: string; message: string; key?: string; itemId?: string }
const prefix = (path: readonly string[], start: readonly string[]) => start.length <= path.length && start.every((part, index) => path[index] === part);
const children = (activation: ActivationRecord) => [...activation.context.scope, "node", activation.context.nodeId, "visit", String(activation.context.visit)];

/** Completed parents and collected items are already consumed data, even in a failed run. */
export function recoveryBlockers(run: RunRecord, selected: ActivationRecord, activations: readonly ActivationRecord[], collections: readonly CollectionRecord[]): RecoveryBlocker[] {
  const result: RecoveryBlocker[] = [];
  if (!["failed", "interrupted", "paused"].includes(run.status) || run.ownerToken !== null) result.push({ code: "run-not-stopped", message: "Recovery requires a failed or interrupted checkpoint with no execution owner." });
  if (run.desired === "cancelled") result.push({ code: "cancelled", message: "Cancellation cannot be undone by recovery." });
  if (!["failed", "interrupted"].includes(selected.status)) result.push({ code: "attempt-not-failed", message: "The selected attempt is not a failed or interrupted checkpoint." });
  if (!["agent", "check", "worktree", "integrate"].includes(selected.kind)) result.push({ code: "structural-checkpoint", message: "Inspect the failed operation inside this structural checkpoint." });
  if (!parseOperation(selected.metadata.operation)) result.push({ code: "missing-operation", message: "The actual operation was not recorded; historical inputs or paths cannot be reconstructed as evidence." });
  for (const parent of activations) if (parent.key !== selected.key && parent.status === "succeeded" && prefix(selected.context.scope, children(parent))) {
    result.push({ code: "completed-parent", key: parent.key, message: "A completed parent already consumed this child result." });
  }
  for (const item of collections) {
    const parent = activations.find(a => a.key === item.key);
    if (parent && prefix(selected.context.scope, [...children(parent), parent.kind === "map" ? "map" : "parallel", item.itemId])) {
      result.push({ code: "collected-item", key: item.key, itemId: item.itemId, message: "A durable collection item already consumed this child result." });
    }
  }
  return result;
}

/** Whole-run checkpoints prevent changing a subject after another branch consumes it. */
export function recoveryCheckpoint(run: RunRecord, activations: readonly ActivationRecord[], collections: readonly CollectionRecord[], eventSeq = 0): string {
  return recoveryDigest({ eventSeq, run: { id: run.id, planHash: run.plan.hash, status: run.status, desired: run.desired, ownerToken: run.ownerToken,
    updatedAt: run.updatedAt, output: run.output ?? null, failure: run.failure ?? null }, activations, collections });
}
export function recoveryRoots(run: RunRecord, activation: ActivationRecord): string[] {
  const operation = parseOperation(activation.metadata.operation);
  const paths = [run.cwd];
  if (operation?.kind === "agent" || operation?.kind === "check") paths.push(operation.cwd);
  if (operation?.kind === "worktree") paths.push(operation.source);
  if (operation?.kind === "integrate") {
    paths.push(operation.target);
    const sources = Array.isArray(operation.sources) ? operation.sources : [operation.sources];
    for (const source of sources) if (source && typeof source === "object" && !Array.isArray(source)) {
      const workspace = source.workspace ?? source;
      if (workspace && typeof workspace === "object" && !Array.isArray(workspace) && typeof workspace.path === "string") paths.push(workspace.path);
    }
  }
  const workspace = activation.metadata.workspace;
  if (workspace && typeof workspace === "object" && !Array.isArray(workspace) && typeof workspace.path === "string") paths.push(workspace.path);
  return [...new Set(paths)].sort();
}
export function recoveryOutputContract(run: RunRecord, activation: ActivationRecord): Record<string, unknown> | null {
  if (activation.kind === "agent") return run.plan.agents[activation.context.graphId]?.[activation.context.nodeId]?.outputSchema ?? null;
  const workspace = { type: "object", required: ["path", "branch", "base", "head"], additionalProperties: false,
    properties: { path: { type: "string", minLength: 1 }, branch: { type: "string", minLength: 1 }, base: { type: "string", pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }, head: { type: "string", pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" } } };
  if (activation.kind === "check") return { type: "object", required: ["exitCode", "stdout", "stderr"], additionalProperties: false,
    properties: { exitCode: { type: "integer" }, stdout: { type: "string" }, stderr: { type: "string" } } };
  if (activation.kind === "worktree") return { type: "object", required: ["result", "workspace"], additionalProperties: false, properties: { result: {}, workspace } };
  if (activation.kind === "integrate") return { type: "object", required: ["workspace", "merged"], additionalProperties: false, properties: { workspace, merged: { type: "array", items: { type: "string" } } } };
  return null;
}

/** Read-only Git/operation evidence used by recovery and continuation. Never recovers, retries or mutates Git. */
export async function inspectUncertainWriterGit(
  git: GitWorkspaces,
  activation: ActivationRecord,
  activations: readonly ActivationRecord[],
): Promise<void> {
  const operation = parseOperation(activation.metadata.operation);
  if (!operation) throw new Error("The actual operation was not recorded; historical inputs or paths cannot be reconstructed as evidence.");
  if (operation.kind === "worktree") {
    if (activation.metadata.workspace === undefined) {
      if (activation.metadata.workspacePhase === "allocating") return;
      throw new Error("No owned workspace allocation was recorded");
    }
    const allocating = activation.metadata.workspacePhase === "allocating"
      && !activations.some(item => item.key !== activation.key && operation.childScope.every((part, index) => item.context.scope[index] === part));
    if (allocating) {
      const inspected = await git.inspectAllocationRecovery(operation.source, activation.key, activation.metadata.workspace);
      if (inspected.mode !== "reattach") throw new Error("Missing child workspace is not attached at its recorded allocation");
    } else {
      await git.inspectWorktree(
        operation.source,
        activation.key,
        activation.metadata.workspace,
        activation.metadata.workspacePhase === "complete",
      );
    }
    return;
  }
  if (operation.kind === "integrate") {
    const owned = activations
      .filter(item => item.kind === "worktree" && item.status === "succeeded" && item.output !== undefined)
      .flatMap(item => parseWorkspaceSources([item.output!]));
    await git.inspectIntegration(operation.target, operation.sources, owned, operation.progress, false);
  }
}

export function continuationGitBlocker(activation: ActivationRecord, error: unknown): ContinuationBlocker {
  const message = error instanceof Error ? error.message : String(error);
  const errno = (error as NodeJS.ErrnoException).code;
  if (activation.kind === "integrate") {
    return { code: "invalid-integration", key: activation.key, message };
  }
  if (/unlocked allocation|registration requires inspection/i.test(message)) {
    return { code: "locked-registration", key: activation.key, message };
  }
  if (errno === "ENOENT" || /no owned workspace|missing child workspace|not attached|no such file|cannot identify the exact owned/i.test(message)) {
    return { code: "missing-child-workspace", key: activation.key, message };
  }
  return { code: "unresolved-worktree-ownership", key: activation.key, message };
}
