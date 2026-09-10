# Reconciliation of interrupted effects

This work implements the recovery scenario in the project audit. Operation capture,
worker/group observations and public `run.recovery` inspection are implemented below.
`run.reconcile` now accepts checked results and authorizes one-use retries through
CLI/MCP and the local browser form. Inspection shows decision provenance and
application receipts. The remaining Git fault-injection and repair cases are
distinguished from the implemented allocation recovery below.

## Persisted operation observations

`metadata.operation` is written before dispatching an agent/check or beginning a
managed workspace operation. Its closed JSON shape depends on `kind`:

- `agent`: actual `cwd`, evaluated `task` and `input`, intended session/resource
  directories, and optional continued session file. The configuration is addressed
  by the activation's graph/node in the immutable execution plan.
- `check`: actual `cwd`, command and argv sent to the worker.
- `worktree`: source workspace, child scope and optional requested base. Once its
  child graph returns, `childResult` is recorded before parent commit admission.
- `integrate`: target and evaluated source records. Progress records the target
  branch/original HEAD, already merged source heads and, before each merge, its
  source HEAD and target HEAD. `complete` adds the observed final HEAD.

The existing `metadata.workspace` and `workspacePhase` retain allocation ownership
and allocating/children/committing/complete phases. Intent is not proof that a
process started or that a write completed. A merge can finish before its next
journal write; a retained `merging` observation therefore remains uncertain until
the workspace is inspected. An aborted merge does not erase earlier completed
merges or the recorded operation intent.

The operation and its metadata event commit together. A rejected intent checkpoint
prevents the following external operation from starting. Observation callback
failure after a Git write retains uncertainty rather than rolling back user files.

Beginning a new attempt archives the previous operation/session/worker provenance
and clears it from the new current attempt. Worktree, wait and usage checkpoints
retain their existing replay semantics. Old records without operation data do not
gain invented historical inputs or paths. Graph source/hash versions are unchanged
by these additional observations.

Use existing explicit `run.inspect`, `run.attempts`, or expanded browser attempt
data to inspect these fields. Ordinary graph snapshots do not include evaluated
agent tasks, operation inputs or session/resource paths.

## Worker launch admission

Every managed agent/check process, including each individual Git command wrapper,
reserves its random worker identity in activation metadata before spawn. A rejected
reservation prevents launch. The process client waits for the synchronous PID
checkpoint callback to finish before sending the execution request over stdin;
callback failure or cancellation does not send the request. Death of the parent
in that gap disconnects IPC, so the wrapper stops without receiving its task.

`workerLaunch` records `reserved`, `started`, or `settled`. Started means the wrapper
PID was observed, not that its task began. Settled means the client finished waiting
for the wrapper and its output pipes, not certification of every descendant or
external effect. Each subsequent Git command reserves a fresh identity; beginning
a new activation attempt archives and clears the old launch observation.

Controller observation finds reserved workers lacking a PID by script and exact
worker-token marker in the OS process list. They count toward orphaned-worker
liveness, prevent owner release/relaunch, and can receive explicit cancellation.
Reading does not manufacture a historical PID checkpoint. Reservations with no
matching process are not themselves evidence of a live worker. Legacy journals do
not gain missing identities. The inventory is shared within one observation when
several missing-PID reservations or a supervisor reservation need it.

This closes the launch-before-PID tracking gap for new managed workers. Process
groups have the additional checks below. Escaped descendants and external effects
still require inspection; recorded-process observation must not be presented as
proof that all outside effects have settled.

## Remaining process groups

Before sending the request, the PID checkpoint also records `workerGroupPid` and
`workerGroupState:"pending"`. Managed wrappers are detached process group leaders.
Once the process client finishes waiting, the runtime checks OS group membership
before clearing the worker metadata or accepting its output. A nonempty group
produces an `uncertain-effect` failure in `cleanup`; the original group checkpoint
remains. Another Git command cannot overwrite it with a new reservation. Successful completion,
attempt replacement and owner release reject a pending group.

When the supervisor and recorded wrapper are gone, controller observation checks
that group number. Live members are exposed as `unresolvedGroups` in run status,
inspect and browser snapshots: activation key/attempt, group PID, numeric process
and parent IDs, OS state, and `ownership:"unverified"`. The shared presentation
reports `unresolved-groups`, including after an otherwise terminal run. Nonterminal
execution without a live supervisor is labelled as requiring process inspection, preserving pause
or cancellation intent. The browser explains the condition and links to the task.

The group number may have been reused since the checkpoint. These are candidates,
not certified owned descendants; cancellation does not signal a group merely from
this numeric match. An authorized actor can inspect their actual provenance and
settle the relevant processes. Once an OS read finds no non-zombie members, the
controller records `worker.group_empty` and clears the pending observation before
releasing the dead owner. The update compares the original worker token/group/key,
so a stale observation cannot clear a newer command. Repeated reads add no duplicate
empty events. Observation errors remain errors; an unknown OS state is treated as
potentially active, including macOS `?Es`.

A group verified empty is not polled indefinitely, so its later reuse does not
create a false blocker. Old records without a group checkpoint do not gain invented
proof. Processes that deliberately leave the group are outside this check; resolving
their effects still requires explicit evidence. Group observation is a prerequisite
for reconciliation, not an accept/retry decision or a complete resolution protocol.

## Explicit recovery inspection

`run.recovery {id,key}` (MCP `run_recovery`) inspects the exact current activation.
Copy its key from `run.inspect`; a display label is not an identity. Browser failed
attempts offer **Проверить состояние для восстановления**, with explicit refresh.
Ordinary graph polling does not scan files or return operation prompts.

The response includes `version`, run ID/plan hash, key/attempt, run status/desired,
`checkpoint`, `eventSeq`, `observedAt`, the recorded activation (without its worker
fencing token), output schema, process observations, blockers and `workspace`.
The checkpoint covers the whole run's current activations and committed collection
items from one SQLite read snapshot, together with the last event sequence. Answers
to awaits therefore invalidate it even when no activation or run timestamp changes.

Blockers distinguish a live or unsuitable run, a nonfailed attempt, structural
container, missing operation data, a completed ancestor, a committed collection
item, live execution processes and unresolved process groups. Child scope matching
includes the exact parent visit and map index/parallel child ID; a sibling's result
does not seal the selected child. A stopped failed/interrupted attempt can be
inspected while operator pause remains in force.

When blockers exist, `workspace` is null and no file tree is scanned. Otherwise the
inspection hashes the run workspace, actual operation cwd/source/target, recorded
managed worktrees and integration sources. Git administration directories and a
linked worktree's common directory are included, without running Git commands.
Broken administrative pointers fail the read rather than becoming a missing repo.

`workspace` names its canonical roots and exclusions and returns an aggregate digest,
entry/byte counts, leaf symlink paths and special-file paths. The digest includes
names, file bytes/sizes, type/mode and symlink targets. It is a content observation,
not a snapshot of timestamps, ownership, ACLs, extended attributes or outside state.
Files stream through SHA-256; before/after inode/size/time checks reject observed
replacement or modification during a read. Directories check their entry names.
Files open with no-follow/nonblocking flags, avoiding a substituted symlink/FIFO.
Overlapping roots are read once. Root symlinks resolve explicitly; nested symlinks
are recorded without reading their target contents, and sockets/FIFOs are not opened.

The journal, its WAL/SHM and this run's resources are excluded. Explicitly selected
managed worktree roots remain included even when beneath the run directory. Replacing
an excluded resource with a symlink does not exclude unrelated target data. Exclusions
are returned so their scope can be reviewed; this is not a complete artifact manifest
or a diff between inspections. There is no automatic preset or disk snapshot save.

After scanning, controller observation and the journal checkpoint are checked again.
A changed checkpoint or newly live process invalidates the inspection. Filesystem
reads are not an atomic transaction with SQLite or other editors: decision application
and execution admission recheck these facts. Unknown external effects and link
targets still need explicit evidence. Repeated inspection does not rerun work, rewrite
attempts, or alter usage. Read `run.attempts` for per-attempt accounting.

This command supplies evidence only. Empty blockers and a valid output schema do not
authorize accepting an output, retrying writes or overriding artifact/criteria bindings.

## Resolution contract

The complete feature must support accepting a checked result, authorizing another
execution after inspection, and ending the run. It must preserve the following:

1. Inspection identifies the run/plan, activation, exact attempt and checkpoint,
   actual operation, session/workspace and current process/Git observations.
   A journal digest alone is not proof that the filesystem is unchanged.
2. Resolution requires a stopped execution owner and verified absence of relevant
   live workers. Launch-before-PID persistence and orphan process groups must be
   accounted for before declaring a subject available for resolution. A stale
   heartbeat, closed harness, or caller timeout is insufficient.
3. A resolution is immutable and names its actor, reason, evidence, action and
   application conditions. Repeated delivery of the same decision is idempotent;
   changed checkpoints, attempts, plans or inspected workspace state invalidate it.
   No caller edits SQLite or the active graph to bypass admission.
4. Accept validates the actual node output contract. Reviewer results additionally
   match the saved artifact/criteria input. Old records lacking required evidence
   cannot supply invented bindings. Managed workspace outputs are derived or
   checked against real ownership, repository, branch, HEAD and child checkpoints.
5. Retry authorizes one new attempt of the selected operation. It does not imply
   all external writes were rolled back, or authorize repeating a whole graph.
   Safe worktree reattachment preserves completed children, including allocation
   and commit gaps after verifying the real Git state. Interrupted integration
   requires inspection of admitted and already committed sources.
6. Applying a decision archives the failed attempt and records its provenance.
   An accepted external result is visibly reconciled, not described as a new model
   response; existing token reports remain untouched. Operator pause and cancel
   retain their semantics. An explicit recovery path can reopen a failed run;
   ordinary resume alone must not bypass unresolved side effects.
7. Completed parent checkpoints and durable collected child results remain sealed.
   Resolving an old failure inside an already consumed result cannot silently
   rewrite the parent or alter the evidence used for a later decision.

Actor evidence can describe checks outside the runtime's local capabilities. It is
an explicit attestation, not automatic certification of every external effect.
Local workspace facts must remain distinguishable from those claims. The actor
can be an authorized agent; this does not introduce mandatory human approval.

## Required acceptance scenarios

Accept a writer result after confirmed writes with no repeated worker; retry after
inspection with original usage/attempt history; wrong output schema or reviewer
revision; stale checkpoint/workspace, duplicate/conflicting resolution delivery;
live owner/worker and process-launch gaps; pause/cancel during resolution; failed
run recovery; allocation/commit and partially integrated Git gaps; completed parent
or collected result protection; API/MCP and browser explanation of decisions.

Implemented cases and remaining gaps are distinguished below; the full feature is
not complete merely because the decision API is available.

## Applying a decision

CLI and MCP expose `run.reconcile`. Supply the exact `id`, activation `key`,
`attempt`, `checkpoint` and `workspaceDigest` from a fresh `run.recovery`, plus:

```json
{
  "decisionId": "actor-generated-stable-identity",
  "action": "accept",
  "actor": "authorized-agent",
  "reason": "Checked the already produced result and settled the operation",
  "evidence": [{ "description": "Specific observed files/checks and external effects" }],
  "output": { "exitCode": 0, "stdout": "example only", "stderr": "" }
}
```

This fragment illustrates a check result, not evidence for any real run. Retry uses
`action:"retry"` and omits `output`. Choose the decision ID before delivery. Exact
redelivery returns the persisted decision with its current application/supersession
receipt, even after the run finishes; different content with the same ID fails.
Reading `run.reconciliations` optionally filters by activation `key`.

New decisions require a fresh stopped/unconsumed checkpoint and filesystem digest.
The controller validates liveness and Git observations, then the store atomically
checks the complete journal checkpoint and appends the immutable decision. Actor
evidence remains an attestation. The SQLite transaction does not lock editors or
external services; filesystem observation has the limits documented above.

Accept validates the frozen output schema and recorded reviewer bindings. It
archives failed attempt N intact and creates succeeded checkpoint N+1, visibly
marked `metadata.reconciliation` without a worker/session/model invocation. Existing
response rows and cumulative spend remain intact; no new SDK response or ledger
entry is fabricated. History differentiates accepted checkpoints from model calls.

Retry remains pending until the runtime re-observes operation roots and Git
administration. The journal consumes the decision atomically with attempt N+1,
its original history and admission event. An admitted attempt that crashes needs
its own new resolution. Files changed while pending block execution before a new
attempt; use a fresh inspection and explicit `supersedes` to replace that decision.
The old decision stays immutable. Applied or unrelated decisions cannot be replaced.
Broad shared roots can conservatively invalidate another branch's pending decision.

Recording either action prepares the same run as interrupted or paused and clears
its current run-level failure projection; original failure events and attempt data
remain. It does not launch a supervisor or lift an existing pause. Resolve all
necessary operations, then call `run.resume`. Ordinary resume of a failed run does
not authorize uncertain writes. Cancellation and completed/collected results remain
sealed. Browser **Решения о восстановлении** fetches receipts explicitly and shows
the actor, reason, source/application attempts, supersession and raw evidence.

Managed Git acceptance verifies current ownership, repository, branch and HEAD.
Worktrees must be clean and match a saved completed child result (or exact child
root finish/end checkpoint). Integration requires a recorded original HEAD, clean
named target branch descending from it, unchanged completed owned source worktrees,
and every source HEAD included in the target ancestry. Git inspection disables
optional locks so status does not refresh the index between content observations.
It never commits or merges as part of an acceptance decision.

A verified existing worktree can retry allocation/commit gaps by reattaching and
replaying completed children before ordinary commit admission. Integration retry
checks a clean settled target and unchanged owned sources; earlier committed merges
remain and normal Git admission handles the remaining work. No rollback is implied.
Worktree failures before any allocation was recorded can retry normal allocation.

Initial allocation recovery now handles intent-only, retained-branch and valid
missing-registration states. It requires phase `allocating` with no admitted child
activation. The exact run/key path, base commit, branch and every registration using
that branch are checked. A branch at a different head, moved/locked registration,
foreign path, unresolved Git operation or malformed registration fails inspection.
A missing worktree after child checkpoints is not recreated beneath replayed outputs:
those checkpoints do not prove the missing uncommitted files can be reconstructed.

After one-use retry admission, the runtime rechecks allocation ownership. If the
exact registered path is missing, it copies that administrative directory, including
its index, into the run's private `recovery/allocation-*` directory. It verifies that
the source stayed unchanged, flushes archive files/directories and records the
archive path and source digest before removing that one registration with
`git worktree remove` without force. It then reuses the preserved branch; intent-only
recovery creates the branch at the recorded base. No global prune, forced branch
checkout, reset, or removal of an existing working directory is performed. Sibling
registrations remain. A rejected pre-removal checkpoint prevents removal; a failure
after removal retains the archive/branch and a fresh decision can recover the
branch-only state. Existing valid worktrees reattach with their files preserved.

Progress is recorded as `metadata.workspaceRecovery` and metadata events, including
`registration-archived`, `removing-registration`, `registration-removed`,
`creating-worktree` and `allocation-restored`. Starting another attempt archives and
clears the old progress. The original failed attempt and each consumed decision
remain independently inspectable.

## Browser decision form

Select a failed operation, request fresh inspection, then choose accepting a result
or authorizing one retry. The form collects the actor, reason and observed evidence;
accept additionally takes JSON output, checked against the same backend contract.
An existing pending retry must be explicitly selected for replacement. The form
keeps text, selection and focus across polls and keys drafts by run/activation/attempt.
Drafts remain in page memory; reloading does not persist private form text.

Before delivery the form freezes the request and a generated decision ID. A failed
response offers redelivery of those same bytes or explicit inspection/editing for
a new decision. It never silently substitutes a fresh checkpoint into an old
request. Receipts distinguish replaced decisions and pending/applied retries.
Saving does not start a supervisor or lift pause; continuation is a separate control.
The POST endpoint requires the local page origin, JSON content type and control
header, uses the existing private URL/host guard, and limits browser request bodies
to 1 MiB. The shared control/await/reconciliation body reader bounds raw bytes,
decodes UTF-8 only after collecting all chunks, and rejects invalid encoding before
dispatch. A Cyrillic character split between chunks cannot change the stored decision
or break its identical redelivery. CLI/MCP remain available for direct structured requests.

Still required: the full allocation/commit and multi-source integration crash matrix,
and evidence-preserving handling of malformed partial registrations. Missing worktree
files after admitted child work require explicit artifact repair and fresh inspection.
Isolated integration workspaces and versioned artifact proofs remain separate
requirements of the overall implementation plan.
