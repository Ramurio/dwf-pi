# Collecting independent branch results

`parallel` and `map` accept `failurePolicy: "collect"`. The default (also available
explicitly as `"fail-fast"`) preserves ordinary Effect failure propagation and
the existing unwrapped outputs. The setting is frozen in a v5 workflow plan.
Concurrency remains separately configurable; omitting it imposes no artificial cap.

With collect, each successful child returns an envelope:

```json
{"status":"succeeded","value":{"decision":"request_changes"}}
```

A failed child returns:

```json
{"status":"failed","failure":{"version":1,"code":"provider","phase":"execution","effects":"unknown","message":"Pi assistant turn failed or was aborted"}}
```

`parallel` returns an object keyed by child IDs. `map` returns an array in input
order, regardless of completion order. A child verdict such as `request_changes`
or `inconclusive`, and a nonzero ordinary check exit, remain successful *execution*
values. An infrastructure failure is never synthesized into a reviewer vote.
Nested collections preserve their nested envelopes instead of flattening failures.
The following graph nodes decide whether to wait, retry through an explicit policy,
reject or accept. Collect itself has no retry, quorum or acceptance rule.

Inspect `nodes.council.correctness.status` before accessing
`nodes.council.correctness.value.decision`. Use `failure` only in the failed case.
Strict expression evaluation does not silently supply missing values.

## Failure and control boundaries

Only the child effect's ordinary typed error channel is collected, after its
finalizers finish. This includes failures evaluating a parallel child's input.
An invalid map items expression fails the parent before there are items to collect.
Effect defects/interruption and typed cancelled/interrupted/uncertain-effect errors
propagate, including when mixed with ordinary failures in a composite cause.
A cleanup failure also propagates because termination was not confirmed.
Writes of the collection checkpoint fail normally; an error saving that checkpoint
is not replaced with a fabricated child failure. Losing supervisor ownership cannot
commit results under a stale token. Ordinary child execution failures can include
other infrastructure errors; their effects remain unknown and are not retried.

The collection's failure cause is retained, but branch-level task effects are
conservatively `unknown`: an earlier node in that branch may have written before
a read-only node failed. Leaf activations retain their more specific observations.
For multiple ordinary failures in a composite cause, the envelope records the first
cause; individual activation records retain their own failures.
Collection does not roll back prior work or authorize repeating uncertain actions.

A failing child does not interrupt its independent peers under collect. Awaiting
children remain pending; pause gates new work while admitted children settle.
Cancellation still interrupts the run and does not become a successful collection.

## Durable identity and recovery

Each child result is committed to `workflow_collections` under the run ID, parent
activation key (including scope and graph visit), and item ID. Parallel uses its
authored child ID; map uses the zero-based input index as a string. The record also
retains its sequence, timestamp and original **parent** attempt number.

The result, parent `metadata.collectionSummary`, and `collection.settled` event
commit in one owner-fenced transaction. Identical repeated delivery reuses the
record; conflicting results fail. On supervisor recovery, a settled child returns
its saved envelope without re-entering its subgraph. This preserves failed as well
as successful children. Parent attempt changes do not reset these child checkpoints;
a new graph visit has a different key and its own collection.

If a crash occurs after a side-effect child failed but before its collection record
committed, no outcome is invented. Normal uncertain-effect admission still blocks
its repetition; explicit reconciliation remains necessary. Completed child nodes
can replay normally to fill a missing successful collection checkpoint.

SDK usage remains on original leaf activations/attempts, including failed children;
collection replay does not add usage. Collection envelopes and their small summary
are not worker token reports.

## Inspection

`run.collections {"id":"run-...","key":"parent-activation-key","after":0,"limit":100}`
pages immutable results in completion/commit order. Copy the key from `run.inspect`.
The response contains `enabled`, `summary` (`total`, `succeeded`, `failed`), `records`,
`nextAfter`, and `hasMore`. The summary covers the whole collection as of the same
SQLite read snapshot. Unknown activations fail; non-collect activations explicitly
return `enabled:false`. Page limits constrain response size, not workflow execution.
CLI and read-only MCP `run_collections` share this implementation.

The browser shows the policy and live summary on the parent node. **Результаты
веток** opens paged values/errors with original attempt identities. Paging state
survives redraws and run switches; the requested list/summary can be refreshed.
Terminal history displays collected failures even when the parent technically
succeeded, and append-only logs report changing collection counts.

## Compatibility and verification

V5 adds the generated runtime collection boundary. V1–v4 source/hash behavior is
preserved; older compilers reject authored failurePolicy instead of silently
ignoring it. The golden v4 fan-out plan, generated at `f933bd9`, retains its repair
configuration and returns ordinary unwrapped map values on the current runtime.

Tests use actual detached supervisors, checks and waits without inference. They
cover a failed writer beside completed/pending peers, SIGKILL and recovery without
repeating the writer, cancellation, default fail-fast, ordered map outputs, nested
results, input errors, typed control/cleanup failures, defects, journal rollback,
stale ownership, deduplication, conflicting delivery, paging and browser API reads.
