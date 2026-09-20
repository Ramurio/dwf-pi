import { createHash } from "node:crypto";
import { mkdir, realpath, stat, lstat, readdir, readFile, cp, mkdtemp, open } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import type { Json } from "./graph.js";
export { assertParallelWriterIsolation } from "./parallel-isolation.js";
import { assertJson } from "./output-schema.js";
import { runCheckProcess, type ProcessOptions } from "./process-client.js";
import type { IntegrationProgress } from "./operation-record.js";
import { observeRecoveryFiles } from "./recovery-files.js";

export interface WorkspaceAllocation { path: string; branch: string; base: string }
export interface WorkspaceRecord extends WorkspaceAllocation { head: string }
export interface GitOperationOptions extends ProcessOptions { onFinished?: () => void }
export interface AllocationRecovery { mode: "reattach" | "create" | "reuse-branch" | "replace-registration"; allocation: WorkspaceAllocation; registration?: string }
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
  /** Resume only the children phase: allocation is known, and no parent commit was admitted. */
  async reattach(source: string, key: string, value: Json, options: GitOperationOptions = {}): Promise<WorkspaceAllocation> {
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.path !== "string" ||
      typeof value.branch !== "string" || typeof value.base !== "string") throw new Error("Invalid persisted workspace allocation");
    const allocation = { path: value.path, branch: value.branch, base: value.base };
    if (allocation.branch !== `dynamicwf/${this.runId}/${digest(key)}`) throw new Error("Persisted workspace belongs to a different activation");
    await this.assertAllocation(allocation, options);
    await this.noOperation(allocation.path, options);
    if (await this.commonDirectory(allocation.path, options) !== await this.commonDirectory(source, options)) throw new Error("Persisted workspace belongs to a different repository");
    return allocation;
  }
  /** Only callers that prove no child was admitted may use allocation-gap recovery. */
  async inspectAllocationRecovery(source: string, key: string, value: Json, options: GitOperationOptions = {}): Promise<AllocationRecovery> {
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.path !== "string" || typeof value.branch !== "string" || typeof value.base !== "string") throw new Error("Invalid persisted workspace allocation");
    const allocation = { path: value.path, branch: value.branch, base: value.base }, suffix = digest(key);
    if (allocation.branch !== `dynamicwf/${this.runId}/${suffix}` || allocation.path !== join(await realpath(join(this.directory, "worktrees")), suffix) || !hashPattern.test(allocation.base)) throw new Error("Workspace allocation does not belong to this activation");
    let present = false;
    try { await lstat(allocation.path); present = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (present) return { mode: "reattach", allocation: await this.reattach(source, key, value, options) };
    const cwd = await realpath(source); await this.requireRepositoryRoot(cwd, options); await this.noOperation(cwd, options);
    await this.head(cwd, allocation.base, options);
    const branch = await this.git(cwd, ["rev-parse", "--verify", "--quiet", "--end-of-options", `refs/heads/${allocation.branch}^{commit}`], options, [0, 1]);
    if (branch.exitCode === 0 && branch.stdout.trim() !== allocation.base) throw new Error("Allocation branch changed; missing workspace requires artifact repair");
    const entries = (await this.git(cwd, ["worktree", "list", "--porcelain", "-z"], options)).stdout.split("\0\0").filter(Boolean).map(text => {
      const fields = new Map<string, string>();
      for (const line of text.split("\0").filter(Boolean)) { const at = line.indexOf(" "); fields.set(at < 0 ? line : line.slice(0, at), at < 0 ? "" : line.slice(at + 1)); }
      return fields;
    });
    const target = entries.filter(entry => entry.get("worktree") === allocation.path);
    if (target.length > 1 || entries.some(entry => entry.get("branch") === `refs/heads/${allocation.branch}` && entry.get("worktree") !== allocation.path)) throw new Error("Allocation branch is registered to another workspace");
    if (!target.length) return { mode: branch.exitCode === 0 ? "reuse-branch" : "create", allocation };
    const entry = target[0]!;
    if (branch.exitCode !== 0 || entry.get("branch") !== `refs/heads/${allocation.branch}` || entry.get("HEAD") !== allocation.base || entry.has("locked") || entry.has("detached") || entry.has("bare")) throw new Error("Missing workspace registration is not an unlocked allocation at its recorded base");
    const administrative = join(await this.commonDirectory(cwd, options), "worktrees"), matches: string[] = [];
    if (await realpath(administrative) !== administrative) throw new Error("Git worktree administration cannot use a symlink");
    for (const name of await readdir(administrative)) {
      const path = join(administrative, name), info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) continue;
      const marker = join(path, "gitdir");
      let targetPath: string;
      try { if (!(await lstat(marker)).isFile()) continue; targetPath = (await readFile(marker, "utf8")).replace(/\r?\n$/, ""); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      if (targetPath === join(allocation.path, ".git")) matches.push(path);
    }
    if (matches.length !== 1) throw new Error("Cannot identify the exact owned worktree registration");
    const registration = matches[0]!;
    for (const name of ["locked", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-apply", "rebase-merge", "BISECT_START"]) {
      try { await lstat(join(registration, name)); throw new Error(`Workspace registration requires inspection: ${name}`); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return { mode: "replace-registration", allocation, registration };
  }
  async recoverAllocation(source: string, key: string, value: Json, options: GitOperationOptions, onProgress: (value: Json) => void): Promise<WorkspaceAllocation> {
    const cwd = await realpath(source);
    return this.locked(cwd, async () => {
      const inspected = await this.inspectAllocationRecovery(cwd, key, value, options), { allocation } = inspected;
      if (inspected.mode === "reattach") return allocation;
      if (inspected.registration) {
        const recoveryDirectory = join(await realpath(this.directory), "recovery");
        await mkdir(recoveryDirectory, { recursive: true, mode: 0o700 });
        if ((await lstat(recoveryDirectory)).isSymbolicLink()) throw new Error("Recovery archive directory cannot be a symlink");
        const archive = await mkdtemp(join(recoveryDirectory, "allocation-"));
        // Preserve the exact admin directory (including any index) before removing this one registration.
        const before = await observeRecoveryFiles([inspected.registration]);
        await cp(inspected.registration, join(archive, "registration"), { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
        if ((await observeRecoveryFiles([inspected.registration])).digest !== before.digest) throw new Error("Worktree registration changed while archiving");
        await this.flushArchive(archive);
        const parent = await open(recoveryDirectory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try { await parent.sync(); } finally { await parent.close(); }
        onProgress({ phase: "registration-archived", archive, registration: inspected.registration, registrationDigest: before.digest, path: allocation.path });
        const fresh = await this.inspectAllocationRecovery(cwd, key, value, options);
        if (fresh.mode !== inspected.mode || fresh.registration !== inspected.registration) throw new Error("Allocation registration changed before recovery");
        if ((await observeRecoveryFiles([inspected.registration])).digest !== before.digest) throw new Error("Worktree registration changed before removal");
        onProgress({ phase: "removing-registration", archive, registration: inspected.registration, path: allocation.path });
        await this.git(cwd, ["worktree", "remove", "--", allocation.path], options);
        onProgress({ phase: "registration-removed", archive, path: allocation.path });
      }
      onProgress({ phase: "creating-worktree", mode: inspected.mode, path: allocation.path, branch: allocation.branch, base: allocation.base });
      await this.git(cwd, inspected.mode === "create"
        ? ["worktree", "add", "--no-track", "-b", allocation.branch, "--", allocation.path, allocation.base]
        : ["worktree", "add", "--", allocation.path, allocation.branch], options);
      await this.assertAllocation(allocation, options);
      if (await this.head(allocation.path, "HEAD", options) !== allocation.base) throw new Error("Allocation branch changed during recovery");
      onProgress({ phase: "allocation-restored", path: allocation.path, branch: allocation.branch, base: allocation.base });
      return allocation;
    });
  }
  private async flushArchive(path: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) for (const name of await readdir(path)) await this.flushArchive(join(path, name));
    else if (!info.isFile()) throw new Error("Unsupported special file in Git registration archive");
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | (info.isDirectory() ? constants.O_DIRECTORY : 0));
    try { await handle.sync(); } finally { await handle.close(); }
  }
  async integrate(target: string, sources: Json, owned: readonly WorkspaceRecord[], options: GitOperationOptions = {}, onProgress?: (progress: IntegrationProgress) => void): Promise<Json> {
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
      onProgress?.({phase:"ready",branch,originalHead,merged:[]});
      for (const source of records) {
        await this.assertAllocation(source, options);
        await this.clean(source.path, options);
        if (await this.commonDirectory(source.path, options) !== common) throw new Error("Integration source belongs to a different Git repository");
        if (await this.head(source.path, "HEAD", options) !== source.head) throw new Error("Integration source head changed after its recorded result");
        await this.clean(cwd, options);
        if (await this.branch(cwd, options) !== branch) throw new Error("Integration target branch changed during operation");
        const before = await this.head(cwd, "HEAD", options);
        await this.assertNoIgnoredCollision(cwd, source.head, options);
        onProgress?.({phase:"merging",branch,originalHead,merged:[...merged],current:{sourceHead:source.head,before}});
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
        onProgress?.({phase:"between",branch,originalHead,merged:[...merged]});
      }
      const head=await this.head(cwd,"HEAD",options);
      onProgress?.({phase:"complete",branch,originalHead,merged:[...merged],head});
      return { workspace: { path: cwd, branch, base: originalHead, head }, merged };
    });
  }
  /** Read-only evidence for recovery; committing or merging remains an ordinary admitted attempt. */
  async inspectWorktree(source: string, key: string, value: Json, requireClean: boolean): Promise<WorkspaceRecord> {
    const allocation = await this.reattach(source, key, value);
    if (requireClean) await this.clean(allocation.path, {});
    return { ...allocation, head: await this.head(allocation.path, "HEAD", {}) };
  }
  async inspectIntegration(target: string, sources: Json, owned: readonly WorkspaceRecord[], progress: IntegrationProgress | undefined, accepted: boolean): Promise<Json> {
    const cwd = await realpath(target), records = parseWorkspaceSources(sources);
    if (!records.length || new Set(records.map(source => source.branch)).size !== records.length) throw new Error("Invalid integration sources");
    await this.requireRepositoryRoot(cwd, {}); await this.clean(cwd, {});
    const branch = await this.branch(cwd, {}), head = await this.head(cwd, "HEAD", {}), common = await this.commonDirectory(cwd, {});
    if (accepted && !progress) throw new Error("Integration original checkpoint was not recorded");
    if (progress) {
      if (branch !== progress.branch) throw new Error("Integration target branch changed");
      if (progress.phase === "complete" && progress.head !== head) throw new Error("Integration target head changed after recorded completion");
      await this.git(cwd, ["merge-base", "--is-ancestor", progress.originalHead, head], {});
    }
    for (const source of records) {
      if (!owned.some(record => sameWorkspace(record, source))) throw new Error("Integration source is not a completed workspace from this run");
      await this.assertAllocation(source, {}); await this.clean(source.path, {});
      if (await this.commonDirectory(source.path, {}) !== common || await this.head(source.path, "HEAD", {}) !== source.head) throw new Error("Integration source repository or head changed");
      if (accepted) await this.git(cwd, ["merge-base", "--is-ancestor", source.head, head], {});
    }
    return { workspace: { path: cwd, branch, base: progress?.originalHead ?? head, head }, merged: records.map(record => record.head) };
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
      const result = await runCheckProcess("git", ["--no-optional-locks", ...gitConfiguration, ...args], cwd, options) as { exitCode: number; stdout: string; stderr: string };
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
