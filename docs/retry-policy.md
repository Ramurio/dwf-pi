# Explicit automatic retry

An `agent` or `check` node can declare a frozen `retryPolicy`:

```json
{"codes":["process","provider"],"delayMs":5000,"maxAttempts":3,
 "provider":{"statuses":[429,503],"retryAfter":"honor"}}
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

Without `provider.statuses`, selecting the `provider` code selects the whole
reported family, including errors without an HTTP response. A nonempty unique
`statuses` list restricts provider failures to the observed HTTP status; a missing
status fails that filter. Values are integers 100–599. HTTP 200 can accompany a
broken stream, so the status is response evidence, not a claim of successful work.
The filter does not affect other selected codes such as `process` or `resource`.
`provider` options require `codes` to include `provider`.

`provider.retryAfter: "honor"` sets the next attempt's delay to the maximum of
`delayMs` and valid observed Retry-After delays. Missing/invalid headers leave the
configured delay in effect. `"ignore"` or an omitted option preserves the configured
delay. There is no server-delay cap. A supplied header never shortens the workflow's
minimum delay, and these options never authorize unknown effects. Every cause in a
composite failure must pass the filter; all its valid delays contribute to the
maximum. An unbounded policy can continue on a persistent selected error until
paused or cancelled. See [providerResponse](provider-responses.md) for capture limits.

## Durable decisions

The failure checkpoint, immutable retry decision, progress metadata and event are
committed together. The decision identifies the failed and next attempts, cause,
schedule time and chosen delay. For a composite error, `causes` preserves all typed
causes used in the decision; older records may retain only the primary failure.
Admission checks the current attempt, exact saved
decision, progress, failures and frozen policy inside the journal transaction. It
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

New plans use compiler/runtime v7. Frozen v1–v6 source/hash verification is retained;
v1–v5 reject authored retry policies, and v6 rejects the new provider options.
Existing v6 policies retain their original delay and code-family selection.
The golden v5 collect fixture was generated at `6dcafc3` before retry support;
the v6 retry fixture was generated at `61fdb9a` and executes on the new detached runtime.

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
