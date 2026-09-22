// @ts-check
/** Browsing state for run/task token views. Outstanding fetches must not paint under a different identity. */

/**
 * @typedef {{ taskId?: string | null }} LineageRef
 * @typedef {{ id: string, lineage?: LineageRef | null, usage?: { totalTokens?: number } | null, graphs?: unknown }} RunRef
 * @typedef {{
 *   id: string | null,
 *   run: RunRef | null,
 *   runs: RunRef[],
 *   usageScope: "run" | "task",
 *   taskUsage: { taskId?: string, summary?: { totalTokens?: number } } | null,
 *   linkedRuns: RunRef[],
 *   taskFetch: number,
 *   graph: string | null,
 *   scope: string,
 *   node: string | null,
 *   transition?: unknown,
 *   signature: string,
 *   filter: string,
 *   controlError: string | null,
 *   taskUsageError: string | null,
 * }} ViewState
 * @typedef {{ runId: string | null, graphId: string | null, nodeId: string | null, scope: string }} ActivationTarget
 */

/** @param {RunRef[] | undefined} runs @param {string | null | undefined} id */
export function listedTaskId(runs, id) {
  if (!id || !Array.isArray(runs)) return null;
  return runs.find((run) => run.id === id)?.lineage?.taskId ?? null;
}

/** @param {string | null | undefined} previousTaskId @param {string | null | undefined} nextTaskId */
export function sameTaskNavigation(previousTaskId, nextTaskId) {
  return Boolean(previousTaskId && nextTaskId && previousTaskId === nextTaskId);
}

/**
 * Invalidate task-scoped data before the incoming run can render.
 * Keep whole-task selection only when the sidebar already names the same task.
 * @param {ViewState} state
 * @param {string} id
 */
export function beginRunSelection(state, id) {
  const previousTaskId = state.run?.lineage?.taskId ?? listedTaskId(state.runs, state.id);
  if (state.id === id) return { changed: false, sameTask: true, previousTaskId };
  const nextTaskId = listedTaskId(state.runs, id);
  const sameTask = sameTaskNavigation(previousTaskId, nextTaskId);
  state.id = id;
  state.run = null;
  state.graph = null;
  state.scope = "";
  state.node = null;
  state.transition = null;
  state.signature = "";
  state.filter = "all";
  state.controlError = null;
  if (!sameTask) {
    state.usageScope = "run";
    state.taskUsage = null;
    state.linkedRuns = [];
    state.taskUsageError = null;
    state.taskFetch += 1;
  }
  return { changed: true, sameTask, previousTaskId, nextTaskId };
}

/**
 * After the snapshot arrives, drop leftover task totals if the run is not the same task.
 * @param {ViewState} state
 * @param {string | null | undefined} previousTaskId
 */
export function reconcileTaskScopeAfterSnapshot(state, previousTaskId) {
  const nextTaskId = state.run?.lineage?.taskId ?? null;
  if (sameTaskNavigation(previousTaskId, nextTaskId)) {
    return { sameTask: true };
  }
  state.usageScope = "run";
  state.taskUsage = null;
  state.linkedRuns = [];
  state.taskUsageError = null;
  return { sameTask: false };
}

/** @param {Pick<ViewState, "usageScope" | "taskUsage" | "run">} state */
export function taskUsageForView(state) {
  const taskId = state.run?.lineage?.taskId;
  if (state.usageScope !== "task" || !taskId || !state.taskUsage) return null;
  if (state.taskUsage.taskId !== taskId) return null;
  return state.taskUsage;
}

/** @param {Pick<ViewState, "run" | "linkedRuns">} state */
export function linkedRunsForView(state) {
  const taskId = state.run?.lineage?.taskId;
  if (!taskId || !Array.isArray(state.linkedRuns)) return [];
  return state.linkedRuns.filter((run) => run.lineage?.taskId == null || run.lineage.taskId === taskId);
}

/**
 * @param {Pick<ViewState, "usageScope" | "taskUsage" | "run">} state
 * @returns {number | null}
 */
export function viewTokenTotal(state) {
  const taskUsage = taskUsageForView(state);
  if (taskUsage) return taskUsage.summary?.totalTokens ?? null;
  if (state.usageScope === "task" && state.run?.lineage?.taskId) return null;
  const total = state.run?.usage?.totalTokens;
  return typeof total === "number" ? total : null;
}

/**
 * @param {ViewState} state
 * @param {number} seq
 * @param {string} taskId
 * @param {{ taskId?: string }} usage
 * @param {RunRef[]} linkedRuns
 */
export function applyTaskScopeFetch(state, seq, taskId, usage, linkedRuns) {
  if (seq !== state.taskFetch) return false;
  if (state.run?.lineage?.taskId !== taskId) return false;
  if (usage?.taskId && usage.taskId !== taskId) return false;
  state.taskUsage = usage;
  state.linkedRuns = linkedRuns;
  state.taskUsageError = null;
  return true;
}

/**
 * @param {ViewState} state
 * @param {number} seq
 * @param {string} taskId
 * @param {string} message
 */
export function applyTaskScopeError(state, seq, taskId, message) {
  if (seq !== state.taskFetch) return false;
  if (state.run?.lineage?.taskId !== taskId) return false;
  state.taskUsageError = message;
  return true;
}

/**
 * @param {{ runId?: string | null, graphId?: string | null, node?: { id?: string | null } | null, nodeId?: string | null, scope?: string | null }} activation
 * @param {string | null | undefined} currentRunId
 * @returns {ActivationTarget}
 */
export function activationTarget(activation, currentRunId) {
  return {
    runId: activation.runId ?? currentRunId ?? null,
    graphId: activation.graphId ?? null,
    nodeId: activation.node?.id ?? activation.nodeId ?? null,
    scope: activation.scope ?? "",
  };
}

/**
 * @param {{ key?: string, runId?: string | null }} report
 * @param {Array<{ key?: string, runId?: string | null, graphId?: string | null, node?: { id?: string | null } | null, nodeId?: string | null }>} activations
 * @param {string | null | undefined} currentRunId
 * @returns {ActivationTarget | null}
 */
export function reportOrigin(report, activations, currentRunId) {
  const activation = activations.find(
    (item) => item.key === report.key && (!report.runId || !item.runId || item.runId === report.runId),
  );
  if (activation) return activationTarget(activation, report.runId ?? currentRunId);
  if (report.runId) return { runId: report.runId, graphId: null, nodeId: null, scope: "" };
  return null;
}
