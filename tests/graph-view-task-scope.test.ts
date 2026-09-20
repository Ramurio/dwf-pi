import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// @ts-expect-error Browser module is checked separately with checkJs.
import { activationTarget, applyTaskScopeError, applyTaskScopeFetch, beginRunSelection, linkedRunsForView, reconcileTaskScopeAfterSnapshot, reportOrigin, taskUsageForView, viewTokenTotal } from "../src/graph-view/task-scope.js";

function state(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-qa-target",
    run: {
      id: "run-qa-target",
      lineage: { taskId: "task-linked" },
      usage: { totalTokens: 0 },
    },
    runs: [
      { id: "run-qa-original", lineage: { taskId: "task-linked" } },
      { id: "run-qa-target", lineage: { taskId: "task-linked" } },
      { id: "run-qa-unrelated", lineage: { taskId: "task-unrelated" } },
    ],
    usageScope: "task",
    taskUsage: { taskId: "task-linked", summary: { totalTokens: 34 } },
    linkedRuns: [
      { id: "run-qa-original", lineage: { taskId: "task-linked" }, graphs: [] },
      { id: "run-qa-target", lineage: { taskId: "task-linked" }, graphs: [] },
    ],
    taskFetch: 1,
    graph: "main",
    scope: "",
    node: null,
    signature: "continuation",
    filter: "all",
    controlError: null,
    taskUsageError: null,
    ...overrides,
  };
}

test("whole-task totals stay bound to the selected task identity", () => {
  assert.equal(viewTokenTotal(state()), 34);
  assert.equal(
    viewTokenTotal({
      usageScope: "task",
      taskUsage: { taskId: "task-linked", summary: { totalTokens: 34 } },
      run: { id: "run-qa-unrelated", lineage: { taskId: "task-unrelated" }, usage: { totalTokens: 7 } },
    }),
    null,
    "task scope must not substitute unrelated task data or the run-only subtotal",
  );
  assert.equal(taskUsageForView(state({ usageScope: "run" })), null);
});

test("selecting an unrelated task clears task scope before the new snapshot can render", () => {
  const current = state();
  const { changed, sameTask, previousTaskId } = beginRunSelection(current, "run-qa-unrelated");
  assert.equal(changed, true);
  assert.equal(sameTask, false);
  assert.equal(current.id, "run-qa-unrelated");
  assert.equal(current.run, null);
  assert.equal(current.usageScope, "run");
  assert.equal(current.taskUsage, null);
  assert.equal(current.linkedRuns.length, 0);
  assert.equal(current.taskFetch, 2);
  assert.equal(current.signature, "");
  current.run = { id: "run-qa-unrelated", lineage: { taskId: "task-unrelated" }, usage: { totalTokens: 7 } };
  reconcileTaskScopeAfterSnapshot(current, previousTaskId);
  assert.equal(current.usageScope, "run");
  assert.equal(viewTokenTotal(current), 7);
});

test("selecting the source run of the same task keeps whole-task paging data", () => {
  const current = state();
  const cachedUsage = current.taskUsage;
  const { sameTask, previousTaskId } = beginRunSelection(current, "run-qa-original");
  assert.equal(sameTask, true);
  assert.equal(current.usageScope, "task");
  assert.equal(current.taskUsage, cachedUsage);
  assert.equal(current.taskFetch, 1);
  current.run = { id: "run-qa-original", lineage: { taskId: "task-linked" }, usage: { totalTokens: 34 } };
  assert.equal(reconcileTaskScopeAfterSnapshot(current, previousTaskId).sameTask, true);
  assert.equal(viewTokenTotal(current), 34);
});

test("stale task-usage fetches and errors are dropped after a task switch", () => {
  const current = state();
  beginRunSelection(current, "run-qa-unrelated");
  current.run = { id: "run-qa-unrelated", lineage: { taskId: "task-unrelated" }, usage: { totalTokens: 7 } };
  assert.equal(
    applyTaskScopeFetch(current, 1, "task-linked", { taskId: "task-linked", summary: { totalTokens: 34 } }, [
      { id: "run-qa-original", lineage: { taskId: "task-linked" } },
    ]),
    false,
  );
  assert.equal(current.taskUsage, null);
  assert.equal(
    applyTaskScopeError(current, 1, "task-linked", "task-usage failed"),
    false,
  );
  assert.equal(current.taskUsageError, null);
  assert.equal(
    applyTaskScopeFetch(current, current.taskFetch, "task-unrelated", { taskId: "task-unrelated", summary: { totalTokens: 7 } }, [
      { id: "run-qa-unrelated", lineage: { taskId: "task-unrelated" } },
    ]),
    true,
  );
  current.usageScope = "task";
  assert.equal(viewTokenTotal(current), 7);
});

test("linked run snapshots from another task cannot leak into the current whole-task agents list", () => {
  const current = state({
    run: { id: "run-qa-unrelated", lineage: { taskId: "task-unrelated" }, usage: { totalTokens: 7 } },
    linkedRuns: [
      { id: "run-qa-original", lineage: { taskId: "task-linked" } },
      { id: "run-qa-unrelated", lineage: { taskId: "task-unrelated" } },
    ],
  });
  assert.deepEqual(linkedRunsForView(current).map((run: { id: string }) => run.id), ["run-qa-unrelated"]);
});

test("task-scope agent and report links open the producer run and activation", () => {
  const planner = {
    runId: "run-qa-original",
    graphId: "main",
    key: "plan-key",
    node: { id: "plan" },
    nodeId: "plan",
  };
  assert.deepEqual(activationTarget(planner, "run-qa-target"), {
    runId: "run-qa-original",
    graphId: "main",
    nodeId: "plan",
    scope: "",
  });
  assert.deepEqual(
    reportOrigin({ key: "plan-key", runId: "run-qa-original" }, [planner], "run-qa-target"),
    { runId: "run-qa-original", graphId: "main", nodeId: "plan", scope: "" },
  );
  assert.deepEqual(activationTarget({ graphId: "main", node: { id: "broken" } }, "run-qa-target"), {
    runId: "run-qa-target",
    graphId: "main",
    nodeId: "broken",
    scope: "",
  });
});

test("browser client wires producer navigation and task-identity rendering", () => {
  const app = readFileSync(new URL("../src/graph-view/app.js", import.meta.url), "utf8");
  assert.match(app, /from "\.\/task-scope\.js"/);
  assert.match(app, /beginRunSelection/);
  assert.match(app, /reconcileTaskScopeAfterSnapshot/);
  assert.match(app, /taskUsageForView/);
  assert.match(app, /openActivation/);
  assert.match(app, /reportOrigin/);
  assert.match(app, /void openActivation\(a\)/);
  assert.match(app, /void openActivation\(origin\)/);
  assert.doesNotMatch(
    app,
    /state\.graph = a\.graphId;\s*state\.scope = "";\s*state\.node = a\.node\.id;\s*renderInspector\(\)/,
  );
});
