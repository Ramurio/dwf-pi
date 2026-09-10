# Reconciliation of interrupted effects

This work implements the recovery scenario in the project audit. Operation capture
is implemented below. The public inspection/resolution protocol and Git-specific
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
