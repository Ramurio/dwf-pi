# Explicit automatic retry

An `agent` or `check` node can declare a frozen `retryPolicy`:

```json
{"codes":["process","provider"],"delayMs":5000,"maxAttempts":3}
```

The policy is absent by default, so automatic retry is disabled. `codes` selects
structured failure families; `delayMs` is a required nonnegative integer. Optional
`maxAttempts` includes the first execution. Omit it for unbounded attempts; there
is no hidden attempt limit. The policy belongs to the node, outside agent `config`.
It does not change graph topology or repeat an entire branch.

## Admission and effects

Every cause must match the selected codes and have confirmed `not-started` or
`read-only` task effects. Cancellation, interruption, uncertain effects, defects
and cleanup failure do not enter this loop. A check that exits normally with a
nonzero code remains graph data. A reviewer verdict is also data, not a retry cause.

A writing worker may fail before task admission and qualify for a retry. After it
has been admitted, unknown effects block retry even if its final JSON is invalid.
For that case, [submit-only output repair](output-repair.md) can explicitly repair
the result in the same settled session. It does not repeat the writing task.
Read-only describes granted tools, not an OS sandbox; model calls still spend tokens.

Selecting `provider` means selecting that whole currently reported failure family.
It does not claim a transient failure or select an HTTP status. Available HTTP facts
are recorded separately in [providerResponse](provider-responses.md); this policy
does not yet filter them or automatically adopt Retry-After. An unbounded policy can continue on a
persistent selected error until paused or cancelled.

## Durable decisions

The failure checkpoint, immutable retry decision, progress metadata and event are
committed together. The decision identifies the failed and next attempts, cause,
schedule time and frozen delay. Admission checks the current attempt, exact saved
decision, progress, failure and frozen policy inside the journal transaction. It
archives the failed attempt with `admitted` progress and starts a fresh attempt.
That decision cannot authorize another attempt after a crash during execution.

`metadata.retry.status` is `scheduled`, `admitted` or `abandoned`. A scheduled
decision has not yet admitted work. Terminal completion abandons outstanding
decisions; it does not erase their history. Failure to commit the decision or
admission rolls back the associated state changes and events.

Pause blocks new admission and drains active leaves. The delay continues in wall
time during a pause; resume after its expiry can admit immediately. Supervisor
death during backoff preserves the original deadline. Recovery still requires
resuming the existing run and verifying ownership. Death after admission cannot
reuse the consumed decision to repeat an uncertain side effect.

Delays up to the maximum safe integer are preserved, using short cancellable waits.
When the absolute deadline cannot be represented safely, `dueAt` is null and
`scheduledAt` plus `delayMs` remain authoritative. This is not an immediate retry.

`failurePolicy: "collect"` waits for a child's retries to finish, then collects its
final value or exhausted failure once. Independent await branches remain usable;
an await does not make the run `waiting` while a retry is pending. Cancellation
still interrupts the workflow rather than becoming a collected failure.

## Observation and accounting

`run.retries {"id":"run-...","key":"activation-key","after":0,"limit":100}`
pages immutable decisions by `seq`; `current` separately reports live progress.
Use `nextAfter` while `hasMore`. The matching MCP tool is read-only. A decision
proves scheduling, not admission: use attempt history and `retry.admitted` events
for actual execution. `run.attempts` preserves each failed checkpoint and its usage.

Each new worker invocation has independent report IDs and attempt accounting.
All recorded failed-response tokens remain in run totals; incomplete reports stay
partial. Output repair rounds, if enabled, remain within their invocation attempt.

CLI/watch and browser share `retryingKeys`. A backoff does not count as an active
worker or turn its waiting structural parent into active work. Browser Now, graph
and node inspector show pending retry, policy and paged decisions. Clock updates
do not duplicate append-only watch messages or reset history pages.

New plans use compiler/runtime v6. Frozen v1–v5 source/hash verification is retained;
older compilers reject authored retry policies. The golden v5 collect fixture was
generated at `6dcafc3` before retry support.

## Validation

Offline tests exercise actual detached command admission, delayed availability,
pause/cancel, supervisor SIGKILL during backoff, rollback and stale ownership,
attempt limits, unbounded retry, overflow-safe delay and collect/await interaction.
A real pi SDK fixture makes six invocations, preserving all failed-response usage;
another writes a file before invalid output and confirms no retry. Composite causes
must all match policy and effect requirements. Observation tests retain pending
retries even when recent completion history has moved beyond them.

`spikes/ui-retry-smoke.ts` creates an actual paused run in a disposable journal,
makes its previously missing command available, and serves the browser monitor.
Resume there to inspect admission and archived attempts without model calls.
SIGINT/SIGTERM cancels owned work and removes the fixture directory.
