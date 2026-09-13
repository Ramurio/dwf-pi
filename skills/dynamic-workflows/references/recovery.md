# Recovery

Read this before repeating an uncertain effect, accepting a failed operation's output, authorizing automatic retry, or signaling processes. Inspection is not authorization. A caller timeout, stale heartbeat, or closed harness does not prove the run died.

For a revised graph of the same user task, use [continuation.md](continuation.md). Continuation does not replace reconcile for an uncertain original operation.

## Intent, start, and settled are not completion

When present, `metadata.operation` records the actual agent task/input and intended session/resource directories, check command/argv, worktree source/child result, or integration target/sources and merge progress. These are recorded intent and observations, not proof that an external operation completed: a merge may finish before its next checkpoint. Inspect real files and processes before drawing that conclusion. A new attempt archives the old operation/session/worker provenance; missing legacy records remain unknown.

`metadata.workerLaunch` records wrapper reservation, observed start, or settlement. A worker can be alive before its PID checkpoint; status checks find new reservations by process identity. `started` does not prove the task began, and `settled` does not certify all descendants or external writes. Use controller observations rather than inferring liveness from a missing PID.

## Process groups

`run.status` / `run.inspect` can report `unresolvedGroups` after a worker exits: activation key/attempt, group PID, and candidate PID/parent/state with `ownership:"unverified"`. These block recovery and success until the group is observed empty. A reused group number can refer to unrelated processes; do not signal them based on that number alone or erase the checkpoint. Inspect actual process provenance and effects. Ordinary cancel does not kill candidates whose ownership is unverified. Browser **Группы процессов** shows the same evidence and links to the task. Processes that escaped the group and missing legacy observations still require separate evidence; an empty group is not complete reconciliation of all external effects.

## Failure records

Structured `failure` records identify the cause, phase, and task-effect state (`not-started`, `read-only`, `unknown`). Read the failing activation/attempt, not only the run summary: a read-only child does not establish that the whole graph made no writes. These observations are not retry authorization. Output failure can follow successful writes; do not rerun a writing worker just to fix its final JSON.

Provider failures can include `providerResponse.status` and `retryAfterMs`, observed at the request boundary. Absence remains unknown; do not parse error prose to invent a status or assume a temporary failure. HTTP 200 does not prove a complete assistant response. For composite agent/check errors, inspect `metadata.failureCauses`: a later cause can explain why the first apparently matching cause did not trigger retry. Ordinary check exit codes and reviewer verdicts remain graph data.

## Recovery inspection

Use `run.recovery {"id":"run-id","key":"activation-key"}` for explicit recovery inspection. It returns the exact attempt/plan, journal checkpoint/event sequence, operation and output contract, blockers, and a workspace content digest when stopped and unconsumed. Completed parents and durable collection items seal their child results. With blockers, files are not scanned. The workspace digest covers named roots and Git administration, excludes the named journal/run resources, and records nested links without following their targets. It does not certify outside effects or every filesystem attribute. Large workspaces require reading their files. Browser **Проверить состояние для восстановления** exposes the same snapshot; refresh after state changes.

Inspection itself authorizes nothing: it never accepts a result or retries work. Explicit `run.reconcile` records accept/retry decisions and is separately governed. Do not edit SQLite to substitute for it.

Completed checkpoints replay without repeating their operations. After a crash, a side-effect worker whose output was not committed is uncertain: its external action may already have happened. Recovery refuses to rerun it implicitly. Inspect the activation and real artifacts, report the uncertainty, and obtain an explicit resolution before repeating the action. Do not edit SQLite or erase checkpoint rows to force a retry. Pure transforms, awaits, and structural parents can recover through completed checkpoints. A worktree in its children phase can reattach after ownership/Git checks; uncertain child writes or interrupted allocation/commit still block recovery. Use `run.reconcile` for explicit recovery decisions; `run.resolve` only answers an await. Manual active-graph mutation is unavailable. An earlier retry decision consumed by the interrupted attempt does not authorize another execution.

## Reconcile

For an unconsumed failed operation, first inspect real effects and call `run.recovery`. Reconcile needs real effects and `run.recovery` without blockers. Then call `run.reconcile` with the exact `id`, `key`, `attempt`, `checkpoint`, `workspaceDigest`, a caller-generated stable `decisionId`, `action:"accept"|"retry"`, nonempty `actor`/`reason`, and a nonempty `evidence` array. `accept` additionally requires `output` matching the frozen contract and recorded reviewer artifact/criteria binding. The actor may be an authorized agent; this is not a mandatory human approval step. Exact redelivery returns the existing receipt; conflicting decision identity fails. Use `run.reconciliations {"id":"run-...","key":"activation-key"}` to read decisions and application/supersession facts.

Accept creates a visibly reconciled succeeded checkpoint and archives the failed attempt without invoking a worker or inventing SDK usage. Retry is consumed atomically with one next attempt; files are inspected again at admission. A stale pending retry can only be replaced by a fresh inspected decision with `supersedes:"old-decision-id"`. Applied decisions cannot be reused or superseded. Recording a decision prepares the same run but does not launch it or lift pause; explicitly `run.resume` after all required resolutions. Cancelled/succeeded runs and consumed child results remain sealed. Do not change consumed results, SQLite, or the active plan to force recovery.

Git decisions verify owned worktrees, current heads/ancestry, and child results. Initial allocation retries can reconstruct a missing owned worktree only while allocating and before any child activation: a retained branch must still match its recorded base; the exact unlocked registration is archived before targeted removal and recreation. No global prune, force, reset, or deletion of an existing worktree is performed. Changed/moved/locked or malformed registrations, and missing files after child work, require explicit repair and fresh inspection. Never erase uncertain Git state just to make recovery pass.

Browser **Решения о восстановлении** shows receipts/evidence; after inspection its form accepts a result or authorizes a retry with actor/reason/evidence and explicit replacement of a pending decision. Failed delivery can resend the frozen request with the same ID. Saving leaves continuation to the separate resume control.

## Submit-only output repair

When authoring an agent, `config.outputRepair: {"mode":"submit-only"}` explicitly enables format repair in the same session after task execution settles. Only `submit_result` remains available; the original task and writes are not repeated. Default is `{"mode":"disabled"}`. There is no implicit round limit; set a positive `maxRounds` only when that bound is part of the intended policy. Each extra assistant turn is one round. Provider errors and semantic evidence mismatches do not enter this loop. A workflow pause drains this already active worker; cancellation aborts it. `metadata.outputRepair` and journal metadata events expose rounds and their usage-report ranges in the same activation attempt. All known repair tokens are included in ordinary totals. Valid format does not establish approval or artifact correctness.

## Automatic retry

Automatic retry is allowed only with an explicit node-level policy and matching reasons/effects. Author `retryPolicy:{"codes":["provider"],"delayMs":5000,"provider":{"statuses":[429,503],"retryAfter":"honor"}}` on an agent or check, outside agent `config`. Absent policy disables retries. Optional positive `maxAttempts` includes the first attempt; omit it for unbounded attempts. Every failure cause must match selected codes and confirmed `not-started`/`read-only` task effects. Cancellation, interruption, unknown writes, and cleanup failures never qualify. Optional `provider.statuses` filters provider errors by observed HTTP status; missing status then denies retry. Without this filter the entire provider family remains selected. `provider.retryAfter:"honor"` takes the maximum of the configured delay and all valid server delays; omitted or `"ignore"` preserves the configured delay. Other selected failure codes are unaffected by the HTTP filter. Do not invent `providerResponse.status` from error text.

A durable decision authorizes one next attempt; pause blocks admission, and recovery retains the original chosen deadline. `run.retries {"id":"run-...","key":"activation-key","after":0}` pages decisions and any recorded composite `causes`; `current` reports separate live progress. Scheduled is not admitted. `run.attempts` and usage retain failed attempts and their tokens. Collect waits for child retries to settle before recording the final result. Whole-worker retries are distinct from submit-only output repair.
