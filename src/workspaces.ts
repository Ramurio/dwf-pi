import { createHash } from "node:crypto";
import { mkdir, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveAgentConfig } from "./catalog.js";
import type { ExecutionPlan } from "./execution-types.js";
import type { Json, WorkflowDefinition } from "./graph.js";
import { assertJson } from "./output-schema.js";
import { runCheckProcess, type ProcessOptions } from "./process-client.js";

export interface WorkspaceAllocation { path: string; branch: string; base: string }
export interface WorkspaceRecord extends WorkspaceAllocation { head: string }
export interface GitOperationOptions extends ProcessOptions { onFinished?: () => void }
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const unsafeGitEnvironment = /^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|INDEX_VERSION|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|QUARANTINE_PATH|NAMESPACE|REPLACE_REF_BASE|NO_REPLACE_OBJECTS|SHALLOW_FILE|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM|CONFIG(?:_.*)?|EXEC_PATH|AUTHOR_.*|COMMITTER_.*|ATTR_SOURCE|INTERNAL_SUPER_PREFIX|PREFIX|EXTERNAL_DIFF)$/;
const hashPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const gitConfiguration = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "merge.autoStash=false", "-c", "user.name=Dynamic Workflow", "-c", "user.email=dynamicwf@localhost"];

/** Run-owned linked worktrees. Every Git command uses the same cancellable worker process plumbing as check nodes. */
export class GitWorkspaces {
  private readonly locks = new Map<string, Promise<void>>();
  constructor(readonly runId: string, readonly directory: string) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(runId)) throw new Error("Invalid workspace run ID");
  }
  async allocate(source: string, key: string, base: string | undefined, options: GitOperationOptions = {}, onAllocated?: (allocation: WorkspaceAllocation) => void): Promise<WorkspaceAllocation> {
    const cwd = await realpath(source);
    return this.locked(cwd, async () => {
      await this.requireRepositoryRoot(cwd, options);
      await this.clean(cwd, options);
      const commit = await this.head(cwd, base ?? "HEAD", options);
      await mkdir(join(this.directory, "worktrees"), { recursive: true, mode: 0o700 });
      const allocation = { path: join(await realpath(join(this.directory, "worktrees")), digest(key)), branch: `dynamicwf/${this.runId}/${digest(key)}`, base: commit };
      onAllocated?.(allocation); // journal intended path/branch before the mutating command
      await this.git(cwd, ["worktree", "add", "--no-track", "-b", allocation.branch, "--", allocation.path, commit], options);
      await this.assertAllocation(allocation, options);
      return allocation;
    });
  }
  async commit(allocation: WorkspaceAllocation, options: GitOperationOptions = {}): Promise<WorkspaceRecord> {
    return this.locked(allocation.path, async () => {
      await this.assertAllocation(allocation, options);
      await this.noOperation(allocation.path, options);
      if ((await this.git(allocation.path, ["status", "--porcelain=v1", "--untracked-files=all"], options)).stdout) {
        await this.git(allocation.path, ["add", "--all", "--", "."], options);
        const staged = await this.git(allocation.path, ["diff", "--cached", "--quiet", "--exit-code"], options, [0, 1]);
        if (staged.exitCode === 1) await this.git(allocation.path, ["commit", "--no-verify", "--no-gpg-sign", "-m", `dynamicwf: ${this.runId} ${allocation.branch.split("/").at(-1)!.slice(0, 12)}`], options);
      }
      await this.clean(allocation.path, options);
      const head = await this.head(allocation.path, "HEAD", options);
      await this.git(allocation.path, ["merge-base", "--is-ancestor", allocation.base, head], options);
      return { ...allocation, head };
    });
  }
  async integrate(target: string, sources: Json, owned: readonly WorkspaceRecord[], options: GitOperationOptions = {}): Promise<Json> {
    const cwd = await realpath(target);
    const records = parseWorkspaceSources(sources);
    if (!records.length) throw new Error("Integration requires at least one workspace source");
    if (new Set(records.map(source => source.branch)).size !== records.length) throw new Error("Duplicate integration source branch");
    for (const source of records) {
      if (!owned.some(record => sameWorkspace(record, source))) throw new Error("Integration source is not a completed workspace from this run");
    }
    return this.locked(cwd, async () => {
      await this.requireRepositoryRoot(cwd, options);
      await this.clean(cwd, options);
      const branch = await this.branch(cwd, options);
      const originalHead = await this.head(cwd, "HEAD", options);
      const common = await this.commonDirectory(cwd, options);
      const merged: string[] = [];
      for (const source of records) {
        await this.assertAllocation(source, options);
        await this.clean(source.path, options);
        if (await this.commonDirectory(source.path, options) !== common) throw new Error("Integration source belongs to a different Git repository");
        if (await this.head(source.path, "HEAD", options) !== source.head) throw new Error("Integration source head changed after its recorded result");
        await this.clean(cwd, options);
        if (await this.branch(cwd, options) !== branch) throw new Error("Integration target branch changed during operation");
        const before = await this.head(cwd, "HEAD", options);
        await this.assertNoIgnoredCollision(cwd, source.head, options);
        try {
          await this.git(cwd, ["merge", "--no-edit", "--no-ff", "--no-stat", "--no-verify", "--no-gpg-sign", "--no-overwrite-ignore", "--", source.head], options);
        } catch (error) {
          // Abort only the merge we admitted against a clean target, after its worker is reaped.
          // Already committed earlier sources remain committed; no hard reset or user-file deletion.
          const { signal: _, ...cleanup } = options;
          try {
            const merge = await this.git(cwd, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], cleanup, [0, 1]);
            if (merge.exitCode === 0) {
              if (merge.stdout.trim() !== source.head || await this.head(cwd, "HEAD", cleanup) !== before || await this.branch(cwd, cleanup) !== branch) throw new Error("Merge ownership changed; preserving Git state for reconciliation");
              await this.git(cwd, ["merge", "--abort"], cleanup);
            }
          } catch (cleanupError) {
            throw new Error(`Integration failed: ${message(error)}; merge cleanup requires reconciliation: ${message(cleanupError)}`);
          }
          throw new Error(`Integration failed; no approval implied: ${message(error)}`);
        }
        await this.clean(cwd, options);
        merged.push(source.head);
      }
      return { workspace: { path: cwd, branch, base: originalHead, head: await this.head(cwd, "HEAD", options) }, merged };
    });
  }
  private async assertAllocation(allocation: WorkspaceAllocation, options: GitOperationOptions): Promise<void> {
    const suffix = allocation.branch.slice(`dynamicwf/${this.runId}/`.length);
    if (!allocation.branch.startsWith(`dynamicwf/${this.runId}/`) || !/^[a-f0-9]{64}$/.test(suffix) || allocation.path !== join(await realpath(join(this.directory, "worktrees")), suffix) || !hashPattern.test(allocation.base)) throw new Error("Workspace allocation does not belong to this run");
    if (await realpath(allocation.path) !== allocation.path) throw new Error("Workspace path changed or uses a symlink");
    if (await this.branch(allocation.path, options) !== allocation.branch) throw new Error("Workspace branch changed after allocation");
    await this.git(allocation.path, ["merge-base", "--is-ancestor", allocation.base, "HEAD"], options);
  }
  private async head(cwd: string, ref: string, options: GitOperationOptions): Promise<string> {
    if (!ref || ref.includes("\0")) throw new Error("Invalid Git base reference");
    const value = (await this.git(cwd, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], options)).stdout.trim();
    if (!hashPattern.test(value)) throw new Error("Git did not resolve one commit object");
    return value;
  }
  private async branch(cwd: string, options: GitOperationOptions): Promise<string> {
    const result = await this.git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], options, [0, 1]);
    if (result.exitCode !== 0 || !result.stdout.trim()) throw new Error("Integration/worktree target must be on a named branch, not detached HEAD");
    return result.stdout.trim();
  }
  private async commonDirectory(cwd: string, options: GitOperationOptions): Promise<string> {
    return realpath(resolve(cwd, (await this.git(cwd, ["rev-parse", "--git-common-dir"], options)).stdout.trim()));
  }
  private async assertNoIgnoredCollision(cwd: string, head: string, options: GitOperationOptions): Promise<void> {
    // --no-overwrite-ignore alone is insufficient for every installed Git merge strategy.
    // Conservative case/Unicode folding protects case-insensitive worktrees even when core.ignorecase was changed.
    const normalize = (path: string) => path.normalize("NFC").toLowerCase();
    const ignored = new Set((await this.git(cwd, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], options)).stdout.split("\0").filter(Boolean).map(normalize));
    if (!ignored.size) return;
    const ignoredParents = new Set<string>();
    for (const path of ignored) {
      const segments = path.split("/");
      while (segments.length > 1) { segments.pop(); ignoredParents.add(segments.join("/")); }
    }
    const tracked = (await this.git(cwd, ["ls-tree", "-r", "--name-only", "-z", head], options)).stdout.split("\0").filter(Boolean);
    for (const rawPath of tracked) {
      const path = normalize(rawPath);
      let collision = ignored.has(path) || ignoredParents.has(path);
      const segments = path.split("/");
      while (segments.length > 1) { segments.pop(); collision ||= ignored.has(segments.join("/")); }
      if (collision) throw new Error(`Integration failed: tracked source path collides with ignored local content: ${rawPath}`);
    }
  }
  private async requireRepositoryRoot(cwd: string, options: GitOperationOptions): Promise<void> {
    const root = await realpath((await this.git(cwd, ["rev-parse", "--show-toplevel"], options)).stdout.trim());
    if (root !== cwd) throw new Error("Git worktree/integration source must be the repository root; set run.cwd to the Git root");
  }
  private async noOperation(cwd: string, options: GitOperationOptions): Promise<void> {
    const gitDirectory = (await this.git(cwd, ["rev-parse", "--absolute-git-dir"], options)).stdout.trim();
    for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-apply", "rebase-merge", "BISECT_START"]) {
      const path = join(gitDirectory, marker);
      try { await stat(path); throw new Error(`Git operation already in progress: ${marker}`); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
  private async clean(cwd: string, options: GitOperationOptions): Promise<void> {
    await this.noOperation(cwd, options);
    const status = await this.git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"], options);
    if (status.stdout) throw new Error(`Git workspace must be clean, including untracked files: ${cwd}`);
  }
  private async git(cwd: string, args: string[], options: GitOperationOptions, expected = [0]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const override = Object.keys(process.env).find(name => unsafeGitEnvironment.test(name));
    if (override) throw new Error(`Git environment override is unsupported for managed workspaces: ${override}. Unset it before launching the workflow.`);
    try {
      const result = await runCheckProcess("git", [...gitConfiguration, ...args], cwd, options) as { exitCode: number; stdout: string; stderr: string };
      if (!expected.includes(result.exitCode)) throw new Error(`git ${args[0]} failed (${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`);
      return result;
    } finally { options.onFinished?.(); }
  }
  private async locked<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(path) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.locks.set(path, current);
    await previous;
    try { return await operation(); }
    finally { release(); if (this.locks.get(path) === current) this.locks.delete(path); }
  }
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function sameWorkspace(a: WorkspaceRecord, b: WorkspaceRecord): boolean { return a.path === b.path && a.branch === b.branch && a.base === b.base && a.head === b.head; }
export function parseWorkspaceSources(value: unknown): WorkspaceRecord[] {
  assertJson(value);
  if (!Array.isArray(value)) throw new Error("Integration sources must be an array of workspace records or worktree results");
  return value.map(item => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid workspace source");
    const source = Object.hasOwn(item, "workspace") ? item.workspace : item;
    if (!source || typeof source !== "object" || Array.isArray(source) || Object.keys(source).length !== 4 || typeof source.path !== "string" || typeof source.branch !== "string" || typeof source.base !== "string" || typeof source.head !== "string" || !hashPattern.test(source.base) || !hashPattern.test(source.head)) throw new Error("Invalid workspace record");
    return { path: source.path, branch: source.branch, base: source.base, head: source.head };
  });
}

/** Every concurrent writer gets a worktree per fan-out item/branch, including nested fan-out. */
export function assertParallelWriterIsolation(workflow: WorkflowDefinition, frozen?: ExecutionPlan["agents"]): void {
  const visited = new Set<string>();
  function inspect(graphId: string, concurrent: boolean): void {
    const key = `${graphId}:${concurrent}`;
    if (visited.has(key)) return;
    visited.add(key);
    for (const node of workflow.graphs[graphId]!.nodes) {
      if (node.kind === "agent" && concurrent && (frozen?.[graphId]?.[node.id]?.permission ?? resolveAgentConfig(node.role, node.config).permission) !== "read-only") throw new Error(`Parallel writer ${graphId}/${node.id} requires an explicit worktree block inside its fan-out branch`);
      if (node.kind === "integrate" && concurrent) throw new Error(`Parallel integration ${graphId}/${node.id} requires its own worktree or sequential concurrency`);
      if (node.kind === "worktree") inspect(node.graphId, false);
      if (node.kind === "subworkflow") inspect(node.graphId, concurrent);
      if (node.kind === "map") inspect(node.graphId, concurrent || node.concurrency !== 1);
      if (node.kind === "parallel") for (const child of node.children) inspect(child.graphId, concurrent || (node.children.length > 1 && node.concurrency !== 1));
    }
  }
  inspect(workflow.entryGraph, false);
}
