# Git worktree and integration blocks

`worktree` allocates a run-owned Git branch and linked working tree, invokes a child
graph there, and commits its successful result. `integrate` explicitly merges
completed workspace artifacts into the current workspace. Both are graph data;
the compiler generates their TypeScript + Effect control flow.

```json
{"id":"candidate","kind":"worktree","graphId":"implement","input":{"op":"ref","path":["input"]}}
```

A worktree node accepts `graphId`, `input`, and optional `base` (a Git commit-ish).
Its source is the nearest containing allocated workspace, otherwise the run's root
working directory. Source/target cwd must be the canonical Git repository root; subdirectory runs are rejected before allocation rather than silently changing relative-file meaning. Source Git state must be clean, including untracked files, and
have no merge/rebase/cherry-pick/revert/bisect in progress. Explicit worktree creation
never silently excludes a user's uncommitted source changes. `base` defaults to
`HEAD` and resolves to one actual commit before allocation; Git receives the value
after `--end-of-options`, so option-looking strings are not executed as options.

The resulting branch is `dynamicwf/<run-id>/<activation-hash>`; files are retained
beneath the run directory's `worktrees/<activation-hash>/`. Each activation gets its
own branch, including separate dynamic map items and loop visits. The output is:

```json
{
  "result": {"the":"child graph's JSON output"},
  "workspace": {"path":"/absolute/worktree","branch":"dynamicwf/run-id/hash","base":"original-commit","head":"resulting-commit"}
}
```

Git linked worktrees share repository objects while keeping separate working trees
and branch checkouts. The implementation uses Git's documented worktree mechanism.
[Git worktree documentation](https://git-scm.com/docs/git-worktree).

## Workspace scope and commits

The runtime records each allocated path and child scope in the activation journal.
An agent or check resolves its working directory from the longest matching ancestor
scope. There is no globally mutable current directory, so sibling branches cannot
change each other's implicit cwd. A nested worktree gets a new scope. A check's
explicit `cwd` still overrides the implicit directory; this feature is workspace
allocation, not filesystem containment.

After the child graph succeeds, the runtime checks that the allocated branch is
still checked out and descends from the recorded base. It stages ordinary changes
with `git add --all`, respecting Git ignore rules, and commits when the index has a
change. Existing commits made by the child are retained. A clean unchanged child
produces no empty commit. Completion requires clean resulting Git state; dirty
submodule contents, changed branch identity, unresolved Git operations or ancestry
changes fail instead of publishing a misleading artifact head.

Runtime-owned Git commands disable repository hooks and signing and pass the local
identity `Dynamic Workflow <dynamicwf@localhost>` through command arguments. They do
not modify local/global Git identity settings. A failed/cancelled child is not
committed automatically and returns no successful workspace artifact. Its branch,
files and any already-existing commits remain available for inspection.

Inherited Git environment overrides for repository paths, index/object storage,
configuration or identity are rejected before runtime-owned Git commands. This
prevents a parent shell's `GIT_INDEX_FILE`, `GIT_DIR` or similar override from
redirecting these operations outside the selected repository. Errors identify
variable names without exposing their values.

## Explicit integration

```json
{
  "id":"merge","kind":"integrate",
  "sources":{"op":"array","items":[
    {"op":"ref","path":["nodes","council","left"]},
    {"op":"ref","path":["nodes","council","right"]}
  ]}
}
```

`sources` evaluates to a nonempty array of workspace records, or worktree outputs
containing a `workspace` record. A dynamic `map`'s output can therefore be passed
directly. Source ordering is merge ordering. Integration requires each exact
path/branch/base/head tuple to match a completed worktree activation in this run;
foreign or fabricated sources fail. It verifies the source's actual current HEAD,
branch, clean state and shared repository identity before merging. A source modified
after its successful result is rejected.

The target is the current allocated workspace, otherwise the root run directory.
It must be clean and on a named branch; detached targets are rejected. Sources merge
sequentially with `--no-ff --no-edit --no-overwrite-ignore`, preserving explicit merge commits. Before each merge, an additional path check rejects collisions between source tracked files and target ignored local files, including file/directory ancestor collisions. Matching uses conservative Unicode NFC normalization and lowercase comparison to protect case-insensitive filesystems; it may refuse a case-only collision even on a case-sensitive filesystem. This preserves ignored local content even with Git merge strategies where the flag alone is insufficient. The result
contains `{workspace:{path,branch,base,head},merged:[sourceHeads...]}`. A successful
Git merge is not a review approval: route to integration only after your graph's
review policy passes.

A conflict fails integration and aborts only the merge just admitted, after checking
its `MERGE_HEAD`, target branch and pre-merge HEAD. It never hard-resets the target or
removes user files. Earlier successful merges in the same integration node remain
committed; integration is a sequence of commits, not an all-or-nothing Git transaction.
If merge ownership changed or cleanup fails, state is preserved with a reconciliation
error. Git documents that merge abort attempts to reconstruct pre-merge state; this
runtime requires a clean target before admission to avoid mixing pre-existing edits
with merge changes. [Git merge documentation](https://git-scm.com/docs/git-merge).

## Parallel writers

Execution preparation rejects agents whose effective permission is not `read-only`
when they are inside a concurrent `map` or `parallel` branch without a worktree
wrapper inside that fan-out. A worktree surrounding the *entire* fan-out does not
isolate its individual writers. Nested fan-out requires its own wrappers. Explicit
`concurrency:1` can keep sequential writers in a shared workspace. Parallel integrate
blocks likewise require separate target worktrees or sequential execution.

Persisted-plan verification repeats this check using frozen permissions, so changing
a read-only frozen agent into a writer and recomputing the plan hash cannot bypass
isolation validation. Explicit check commands can still operate on shared workspaces
as authored; the runtime cannot infer arbitrary command effects. Read-only agents,
Git worktree directories and tool permissions are not an OS sandbox.

## Pause, cancellation and recovery

A worktree activation has `allocating`, `children`, `committing` and `complete`
phases. Allocating/committing count as active work while a pause drains. During the
children phase it is a structural parent, allowing the run to become paused when
its child leaves have stopped. Commit admission checks ownership, desired state and
current state atomically in SQLite. If pause wins between the runtime gate and
commit admission, the worktree remains parked until resume.

Every Git operation uses the existing process-group-aware check-worker plumbing,
including PID/token journaling and cancellation cleanup. Cancellation waits for
workers to be reaped; interrupted merges receive ownership-checked cleanup. Failure
or cancellation does not claim a new committed artifact. Worktree and integrate
activations are marked as external effects in the journal: completed outputs can
replay, but an interrupted allocation/commit/merge is not silently rerun. Inspect
retained Git state and reconcile uncertain effects explicitly.

Within a run, workspace mutations to the same target are serialized. This is not a
cross-run or cross-user repository lock; independently launched runs or humans can
still change shared Git state. No worktree/branch auto-deletion or dependency
installation is performed. Git-ignored/untracked dependencies from the source are
not copied into new worktrees. Keep state outside the source repository or ignore it
so the required clean-source check remains meaningful.

Validation: `tests/workspaces.test.ts` uses real temporary repositories and generated
runtime execution. It covers parallel disjoint edits plus integration, source/target
checks, commit identity, changed source heads, conflict abort, pause/resume,
cancellation with actual child PID cleanup, atomic commit admission and frozen-plan
parallel-writer validation. The tests never run Git mutation commands in this project.
