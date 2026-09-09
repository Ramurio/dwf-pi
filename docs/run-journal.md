# Durable run journal

`RunStore` in `src/run-store.ts` persists an immutable `ExecutionPlan`, input and working directory, plus mutable run control state, node activations and ordered events. It uses separate tables from `DraftStore`, so both may share a database file without coupling draft revisions to active runs. Every process opens its own SQLite connection. Initialization sets `busy_timeout` before WAL; commits use `synchronous=FULL`.

Both stores use `openWorkflowDatabase`: connection/WAL setup gets short busy waits,
and a failed BUSY attempt closes its connection before retrying within a five-second
initialization window. Schema creation is transactional; successful connections
retain the existing 5000ms busy timeout for ordinary operations. Application writes
are never retried by this helper. SQLite can decline to invoke a busy handler when
waiting would cause a lock-promotion deadlock; a long busy timeout alone does not
cover every initialization race. [SQLite busy handler contract](https://www.sqlite.org/c3ref/busy_handler.html).

Validation includes 24 simultaneous CLI initializations, an actual competing
exclusive transaction, WAL/FULL/FK settings, preservation of committed data and
rollback after invalid schema SQL. The fix does not establish general safe retries
for workflow operations or resolve the separate incomplete-stdin process timeout.

## Launch ownership and control

`create({id, plan, input, cwd})` creates a queued run. `reserveLaunch(id)` atomically returns `{token, run}` and changes a queued/interrupted run with desired `running` and no owner to `running`. A second launcher fails. The launcher passes this token to its supervisor, which calls `attachPid(id, token, pid)`. Attaching a different PID to the same reservation fails. The reservation-to-attach gap is still owned: a missing PID alone does not authorize a second launch.

All supervisor writes require the current owner token. Ownership checks and writes happen within `BEGIN IMMEDIATE` transactions. Terminal completion and verified interruption clear ownership, fencing late messages. `heartbeat` records telemetry, not proof of process death.

`requestControl(id, "pause" | "resume" | "cancel")` persists an idempotent request and event. It never spawns a process. With a supervisor owner, pause changes status to `pausing`, resume changes it to `running`, and cancel changes it to `cancelling`. Cancellation is monotonic. Terminal runs never resurrect. Ownerless queued/paused runs can pause, queue for resume, or cancel immediately because they have no active execution owner.

The supervisor lets active leaves finish, then calls `markPaused(id, token)`. The store requires desired `paused` and no running leaf rows. Structural `map`, `parallel` and `subworkflow` activations may remain running while the live supervisor waits; their token and PID remain intact. Resume reuses this supervisor and token. An admission transaction checks both status and desired `running`, so a racing pause cannot start a new activation after the request commits.

`worktree` is structural only during its `children` phase; allocating and committing
remain active work. `admitWorkspaceCommit` atomically checks the running/desired
state before admitting commit. A superseded pause request does not abort a run
that another client has already resumed. Worktree/integrate activations retain
side-effect classification for crash recovery even though their children use
ordinary structural checkpoints.

`finish(id, token, outcome)` accepts `{status:"succeeded", output}`, `{status:"failed", error}`, or `{status:"cancelled"}`. It rejects running activation rows. Success requires desired `running`; cancellation requires a persisted cancellation request. Final result, status and event commit together. A worker that actually completes during cancellation may commit its successful activation checkpoint, but that does not turn the cancelled run into success.

## Activations and replay

Identity is exactly `JSON.stringify([context.scope, context.graphId, context.nodeId, context.visit])`. Scope remains an array, avoiding delimiter collisions between nested invocations. `beginActivation(id, token, context, {kind, sideEffect})` records running work before execution; `completeActivation` records output and success atomically with the corresponding event. `failActivation` records an error. Optional metadata holds a worker PID, pi session file, or other JSON fields.

`completed(id, key)` returns `{output}` only for succeeded rows, including explicit `null` output. A resumed scheduler can replay those outputs without executing the work again. Retrying an interrupted or failed pure/structural activation increments its attempt. Existing activation kind and side-effect classification cannot change.

An interrupted or failed side-effect activation is never implicitly repeated: its external operation may have happened even when its result was not journaled. A worktree in the children phase can reattach to its verified allocation and replay child checkpoints; uncertain child operations and allocation/commit phases still block recovery. There is deliberately no automatic exactly-once claim. This version provides no retry-authorization mutation.

## Outcomes and waits

Additive `workflow_task_outcomes` and `workflow_waits` tables preserve compatibility
with existing journal rows. Root finish metadata, terminal run state and outcome
event commit together; legacy end output is classified only by its accepted boolean.
An arbitrary legacy value is unclassified and cannot become a tested preset.

Await records bind request/reason/schema and response to one activation identity.
`openWait` is owner-fenced, `resolveWait` is a client action validated against the
persisted schema, and duplicate identical responses produce no second event.
Response and resolution event commit atomically. Waiting leaves do not prevent
operator pause; other admitted leaves keep running. `waiting` is observed when
there are open await leaves and no executing leaves, while desired stays running.
See [outcomes-and-waits.md](outcomes-and-waits.md) for resolution and recovery.

## Crash recovery responsibilities

`markInterrupted(id, token, error)` is a recovery fence, not a liveness check. The caller must first confirm the supervisor and its workers are dead. It converts every running activation to interrupted, preserves completed checkpoints, clears run ownership, and records an interruption event atomically. It preserves desired state: an interrupted pause can be resumed explicitly; an interrupted cancellation can be finalized with `requestControl(id,"cancel")` after process death has been established.

Do not infer death from a stale heartbeat, elapsed polling timeout, a missing database PID during launch, or a remembered PID alone. The service layer owns OS process inspection, launch handshakes and worker cleanup. Reclaiming an uncertain live launch reservation is unsafe even though token fencing prevents later journal writes: it cannot prevent an old process from producing external side effects.

## Query and test surface

Read APIs are `get`, `listRuns`, `getActivation`, `listActivations`, `completed` and `events(id, afterSeq)`. Event sequence numbers are global and increasing; a per-run cursor may have gaps. `appendEvent` is fenced, as are metadata updates. Read calls return deserialized copies and cannot mutate the immutable stored plan.

`tests/run-store.test.ts` checks competing connections and processes, stale tokens across all writer APIs, pause/resume and monotonic cancellation, persistent checkpoints including `null`, ambiguous scope identities, and failure injection into event insertion. SQLite triggers deliberately abort completion-event insertion to prove that both activation output and final run result roll back with their event.
