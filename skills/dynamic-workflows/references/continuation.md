# Continuation

Read this before continuing a revised task or reusing succeeded outputs. Do not replace a failed or incomplete run by preparing a new graph and starting an unrelated run that silently copies saved JSON.

Repeating an uncertain original operation still uses [recovery.md](recovery.md) (`run.reconcile`). Continuation does not skip those checks.

## Inspect, then continue

For a revised attempt of the same user task, inspect with `run.continuation.inspect {"id":"run-..."}`, prepare the revised graph, then `run.continue` with:

- the same global idempotency-key namespace as `run.start` (a start key cannot later bind a continuation, and the reverse conflict fails without creating a run)
- the exact source checkpoint and `planHash`
- `workspaceDigest` from a fresh inspect
- nonempty `actor`, `reason`, and `evidence`
- `input`
- exact reuse bindings

The response includes the new run ID immediately. Exact redelivery returns that run without rereading the workspace.

## What continuation does not do

Continuation does not mutate the live source plan, replay writes, lift a paused source, or skip recovery checks. The source plan and pause stay as they are. Recording or creating a successor is not `run.resume` of the source.

Unknown writer effects need an explicit `retain-effects` disposition bound to that attempt, with nonempty evidence. `retain-effects` keeps those original effects; it is not accept, retry, or a license to repeat the writer. Repeating an uncertain original operation still uses `run.reconcile`.

## Reuse

A `reuse` node (`bindingId`, strict `outputSchema`) exists only for continuation provenance of already completed outputs. It returns a snapshotted succeeded output without a model invocation. `run.start` rejects a reuse-bearing plan.

Reused reviewer verdicts keep `artifactRevision` (and criteria revision when present); an old approve cannot approve a new artifact. Revision-bound review reuse is required: do not treat a reused approve as a verdict on a different artifact or criteria revision.

Reuse adds no tokens. `task.inspect` and `task.usage` show linked original/continuation runs, plan change, and aggregated SDK usage. Details: [usage.md](usage.md).
