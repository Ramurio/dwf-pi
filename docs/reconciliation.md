# Reconciliation of interrupted effects

This work implements the recovery scenario in the project audit. Operation capture
and worker launch reservations are implemented below. The public inspection/resolution protocol and Git-specific
resolution paths are still being implemented; their proposed contracts are not
available service commands yet.

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

## Resolution contract being implemented

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

These acceptance scenarios remain open until the full resolution protocol exists.
