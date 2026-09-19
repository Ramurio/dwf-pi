import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// @ts-expect-error Browser module is checked separately with checkJs.
import { activationTarget, reportOrigin } from "../src/graph-view/task-scope.js";

function snapshotActivation(branch: "correctness" | "security") {
  const scope = [
    "graph",
    "main",
    "node",
    "council",
    "visit",
    "0",
    "parallel",
    branch,
    "graph",
    "review",
  ];
  return {
    runId: "run-src",
    graphId: "review",
    nodeId: "review",
    node: { id: "review" },
    key: `review:${branch}`,
    // Snapshot projection stores JSON.stringify(context.scope); see src/graph-view/model.ts.
    scope: JSON.stringify(scope),
  };
}

test("opening an activation selects that graph branch, not all branches", () => {
  const left = snapshotActivation("correctness");
  const right = snapshotActivation("security");
  assert.notEqual(left.scope, right.scope);

  const target = activationTarget(left, "run-dst");
  assert.equal(target.runId, "run-src");
  assert.equal(target.graphId, "review");
  assert.equal(target.nodeId, "review");
  assert.equal(target.scope, left.scope);

  const origin = reportOrigin({ key: right.key, runId: "run-src" }, [left, right], "run-dst");
  assert.ok(origin);
  assert.equal(origin.scope, right.scope);
  assert.equal(origin.nodeId, "review");

  const stripped = {
    runId: origin.runId,
    graphId: origin.graphId,
    nodeId: origin.nodeId,
    node: origin.nodeId ? { id: origin.nodeId } : null,
  };
  assert.equal(
    activationTarget(stripped, "run-dst").scope,
    "",
    "a partial origin without scope still means all branches",
  );

  const activations = [left, right];
  const visible = target.scope
    ? activations.filter((item) => item.scope === target.scope)
    : activations;
  assert.deepEqual(
    visible.map((item) => item.key),
    [left.key],
    "selectedGraph treats empty scope as every branch",
  );

  assert.equal(
    activationTarget({ graphId: "review", node: { id: "review" } }, "run-dst").scope,
    "",
  );
});

test("token report origin is opened as a whole activation target", () => {
  const app = readFileSync(new URL("../src/graph-view/app.js", import.meta.url), "utf8");
  assert.match(app, /void openActivation\(a\)/);
  assert.match(app, /void openActivation\(origin\)/);
  assert.match(app, /state\.scope = target\.scope/);
  assert.doesNotMatch(
    app,
    /openActivation\(\{\s*runId: origin\.runId,\s*graphId: origin\.graphId,\s*nodeId: origin\.nodeId/,
  );
});
