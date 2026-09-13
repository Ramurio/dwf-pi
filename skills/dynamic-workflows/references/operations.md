# Operations

Watch, inspect, pause, await, and save presets after a run exists. Launch still uses `preparedId` plus a retained `idempotencyKey`; give the real run ID and watch command immediately after `run.start`. Closing this viewer does not stop the run.

## Watch and browser UI

Give the user the actual run ID and a ready-to-copy `dynamicwf watch --run <id>` command (including `--store` when used) immediately after launch, before waiting. For the browser interface, provide `dynamicwf ui --run <id>` with the same store; it prints a local URL and offers a graph, branch selection, current work, history, tokens, and pause/resume/cancel. Keep its server running while viewing; closing the browser or server does not stop workflows.

The terminal monitor opens a compact live dashboard: 1 current work, 2 history, 3 graph, 4 token usage; arrows scroll and q detaches. Use `--once` for a compact snapshot or `--graph --once` for the complete technical graph. Ctrl-C in the watcher only detaches the viewer.

Token totals come from recorded worker reports; active or missing reports make the total partial, and SDK cost is not a subscription charge. Details: [usage.md](usage.md). For your own observation, prefer short `run.status` calls and inspect details when the state warrants it; avoid printing repeated full graphs.

## Status, inspect, events, trace

Observe a run with `run.status`, inspect outputs/activations with `run.inspect`, and page events with `run.events {"id":"...","after":0}` followed by the returned `nextAfter`.

Technical `succeeded` means execution finished. Read `taskOutcome.decision`, reason, and evidence to report whether the task was accepted; arbitrary legacy output is `unclassified`. Evidence entries are declared JSON references/results, not yet runtime-certified artifact proofs.

Use `run.trace {"id":"run-...","after":0,"limit":100}` to explain actual routing. Records identify the source activation/scope/visit, the selected edge index, true/false conditions, conditions not evaluated after an earlier match, and routing errors. Page with `nextAfter` while `hasMore`. The browser's Trace tab links a decision to its source on the graph. A selected edge does not prove its target has started. Older plans report tracing as unsupported; do not reconstruct missing reasons from node colors or infer that an unvisited node was deliberately skipped.

`run.collections {"id":"run-...","key":"parent-activation-key","after":0}` pages durable collect items and totals; browser parent inspection exposes the same records.

## Pause, resume, cancel

`run.pause` stops admitting new work and drains active leaves before reporting `paused`; structural map/parallel parents can remain recorded as running at that checkpoint. `run.resume` continues the same live supervisor or recovers a verified-dead one. `run.cancel` interrupts workers and is irreversible for that run.

A caller timeout, closed tab, or stale heartbeat alone does not prove the run died; inspect the existing run rather than starting a duplicate. When to read before treating a run as dead or repeating work: [recovery.md](recovery.md).

## Awaits

`await` takes a nonempty `reason` expression, `input` expression, and strict object `responseSchema`; its output is the validated answer, usable by ordinary edges and bindings. It persists independently of the calling harness and keeps other branches running. An inconclusive finish ends execution without acceptance; await keeps it open for an answer. Do not equate either with approval.

When status is `waiting`, use `run.waits {"id":"run-..."}` to read the durable requests and their response contracts. Resolve a particular request with `run.resolve {"id":"run-...","waitId":"wait-...","response":{...},"resolvedBy":"agent"}` when the requested evidence is available. This can come from an authorized agent or the browser; it is not an automatic human approval requirement. The same answer is idempotent; a different answer to an already resolved request is rejected. Answering does not remove an operator pause. After verified supervisor death, resolution can relaunch the same run and replay completed checkpoints. `run.resume` alone does not supply an answer.

## Attempts

Inspect prior execution attempts with `run.attempts {"id":"run-id","key":"activation-key","after":0}`; copy the exact key from `run.inspect`. `records` pages archived attempts; `current` is a separate live observation and does not advance the archive cursor. Read errors and attempt-specific accounting; `missingArchived` marks older history that was never preserved. Reading attempts does not authorize retry or reconcile uncertain effects. In the browser, select a node and open **Попытки**.

When present, `metadata.operation` records the actual agent task/input and intended session/resource directories, check command/argv, worktree source/child result, or integration target/sources and merge progress. Browser **Операция этой попытки** exposes these on demand. These are recorded intent and observations, not proof that an external operation completed. Inspect real files and processes before drawing that conclusion. When to read: [recovery.md](recovery.md).

## Explicit presets

Saving requires both technical `succeeded` and task outcome `accepted`. Rejected, inconclusive, and unclassified results cannot become tested presets.

After a successful run, `preset.save {"id":"run-...","name":"review-council","scope":"project","cwd":"/workspace"}` saves its frozen execution plan; choose `global` for reuse across projects. There is no default automatic preset saving. `preset.list`, `preset.inspect`, and `preset.run` support explicit scope and revision; project presets shadow a same-name global preset when scope is omitted. Reuse with a new `input` and `cwd`. A preset includes concrete models and snapshotted skills, so a replay does not silently substitute changed defaults or models.

Report the actual run state, result, relevant evidence, and any unresolved work. A valid graph, a spawned supervisor, and a succeeded workflow are different outcomes; only the last proves that run completed.
