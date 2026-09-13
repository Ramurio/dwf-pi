/** Test-only preload for the real supervisor. Never imported by production entry points. */
import { writeSync } from "node:fs";
import { GitWorkspaces, type GitOperationOptions } from "../../src/workspaces.js";
import { RunStore } from "../../src/run-store.js";
const point = process.env.DYNAMICWF_TEST_GIT_CRASH_POINT;
const supported = ["allocation-intent", "allocation-created", "worktree-staged", "worktree-committed", "worktree-checkpoint", "merge-first", "merge-last", "integration-checkpoint"];
if (!point || !supported.includes(point)) throw new Error("Unknown Git crash fixture point");
function crash(): never {
  writeSync(2, `Fixture SIGKILL at ${point}\n`);
  process.kill(process.pid, "SIGKILL");
  throw new Error("Fixture SIGKILL did not stop the supervisor");
}
type GitCall = (this: GitWorkspaces, cwd: string, args: string[], options: GitOperationOptions, expected?: number[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
const prototype = GitWorkspaces.prototype as unknown as { git: GitCall }, originalGit = prototype.git;
let merges = 0;
prototype.git = async function(cwd, args, options, expected) {
  const result = await originalGit.call(this, cwd, args, options, expected);
  if (args[0] === "add" && point === "worktree-staged") crash();
  if (args[0] === "commit" && point === "worktree-committed") crash();
  if (args[0] === "worktree" && args[1] === "add" && point === "allocation-created") crash();
  if (args[0] === "merge" && args.includes("--no-ff") && result.exitCode === 0) {
    merges++;
    if ((point === "merge-first" && merges === 1) || (point === "merge-last" && merges === 2)) crash();
  }
  return result;
};
const metadata = RunStore.prototype.setActivationMetadata;
RunStore.prototype.setActivationMetadata = function(id, token, key, patch) {
  const result = metadata.call(this, id, token, key, patch);
  if (point === "allocation-intent" && patch.workspace && this.getActivation(id, key)?.metadata.workspacePhase === "allocating") crash();
  return result;
};
const complete = RunStore.prototype.completeActivation;
RunStore.prototype.completeActivation = function(id, token, key, output) {
  const kind = this.getActivation(id, key)?.kind;
  if ((kind === "worktree" && point === "worktree-checkpoint") || (kind === "integrate" && point === "integration-checkpoint")) crash();
  return complete.call(this, id, token, key, output);
};
