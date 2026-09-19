import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { continuationGitBlocker } from "../src/recovery-inspection.js";
import type { ActivationRecord } from "../src/run-store.js";

function activation(kind: string, key: string): ActivationRecord {
  return {
    runId: "run", key, kind, sideEffect: true, status: "failed", attempt: 1, ownerToken: "token",
    startedAt: 1, finishedAt: 2, metadata: {},
    context: { graphId: "main", nodeId: key, scope: ["graph", "main"], visit: 0 },
  };
}

function enoent(path: string) {
  return Object.assign(new Error(`ENOENT: no such file or directory, lstat '${path}'`), { code: "ENOENT" });
}

test("worktree ENOENT whose path contains integration is missing-child-workspace", () => {
  const path = join(tmpdir(), "integration", "worktree");
  const error = enoent(path);
  const blocker = continuationGitBlocker(activation("worktree", "tree"), error);
  assert.equal(blocker.code, "missing-child-workspace");
  assert.equal(blocker.key, "tree");
  assert.equal(blocker.message, error.message);
  const locked = new Error(`Missing workspace registration is not an unlocked allocation at its recorded base: ${path}`);
  assert.equal(continuationGitBlocker(activation("worktree", "tree"), locked).code, "locked-registration");
});

test("integrate failures are invalid-integration from kind, not path or message words", () => {
  const integrate = activation("integrate", "merge");
  const path = join(tmpdir(), "integration", "target");
  assert.equal(continuationGitBlocker(integrate, new Error("Invalid integration sources")).code, "invalid-integration");
  assert.equal(continuationGitBlocker(integrate, enoent(path)).code, "invalid-integration");
  assert.equal(continuationGitBlocker(integrate, new Error("owned workspace head changed")).code, "invalid-integration");
});
