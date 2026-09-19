# Structured failure observations

Failures now carry a closed record `{version:1,code,phase,effects,message}` through
pi/check process boundaries, Effect execution, the journal, CLI/MCP and browser.
This is evidence for recovery decisions, not a retry policy or authorization.
Existing error strings remain available as technical diagnostics.

`code` distinguishes `configuration`, `resource`, `provider`, `output`, `process`,
`protocol`, `cancelled`, `interrupted`, `expression`, `uncertain-effect` and `unknown`.
`phase` identifies where the observed cause occurred: setup, execution, output,
routing, recovery, cleanup, or unknown. The phase of a cause is not the progress of
the whole graph; a worker's setup can fail after earlier nodes completed writes.

## Facts about task effects

`effects` describes the operation for which the failure was captured:

- `not-started`: task execution was not admitted, such as an unavailable executable,
  rejected configuration/resource setup, or cancellation before process admission;
- `read-only`: a verified pi worker had only read tools, or a pure graph expression
  failed. This describes the operation's granted capabilities, not an OS sandbox;
- `unknown`: task effects may have occurred, or the boundary cannot establish their
  outcome. A writer's failed output validation belongs here even when its file
  write itself succeeded. A process disappearance is not proof that nothing happened.

Private session/resource materialization, provider/account access and SDK cost are
not the task effects described by this field. `not-started` is not a rollback claim
about all local execution metadata. Accounting remains independently recorded.

Structural parents and the run summary conservatively retain `unknown`: one failed
read-only child does not prove that siblings or previous nodes made no writes.
Inspect per-activation records for the concrete facts. Browser summary identifies
the cause of stopping; node and attempt panels show that operation's effect state.
The terminal dashboard/log shows the concise code/phase/message instead of the
stack in its status line; activation summaries include their effect state.

## Classification boundaries

The worker emits branded `ExecutionFailure` values at known code paths. Output
submission/schema failures are `output`; configured model/tool/thinking/session
mismatches are `configuration`; unsafe/missing frozen resources are `resource`.
Cleanup that cannot confirm settlement is `process/cleanup/unknown`.

SDK assistant failure is the `provider` family. Optional `providerResponse` now
preserves observed HTTP status and valid Retry-After from the request boundary;
see [provider-responses.md](provider-responses.md) for coverage and limits.
We **do not infer** HTTP status, authentication rejection, transience, rate limits
or retryability from arbitrary error strings. Unknown SDK exceptions stay `unknown`.

A check that normally exits 1 or 7 still returns `{exitCode,stdout,stderr}` as graph
data. A negative reviewer verdict is likewise data. Neither becomes a transport or
runtime exception. Missing-command admission and a process failure *after* admission
are distinguished; the latter cannot claim `not-started`.

The IPC decoder validates exact fields, version and enums of structured failures. Legacy worker error
messages without a typed record remain unknown. Malformed protocol data produces a
protocol failure without echoing raw stdout. The first failure stops further frame
processing and event delivery; later messages cannot replace its cause. A successful
stream must contain exactly one object result, with no messages after it (blank lines
are allowed). Result payload validation remains the worker/runtime's responsibility.
Arbitrary SDK errors are not promoted
to trusted diagnostics because they start with a recognized phrase. This replaces
the former prefix allowlist, which could forward arbitrary trailing text.
Known local Grok adapter configuration errors retain their actionable diagnostics.

## Durable records and compatibility

`metadata.failure` is written atomically with an activation failure/interruption and
its event. Beginning a new attempt archives the old record and clears the current
failure while preserving worktree/wait metadata. History therefore retains the old
cause without making the recovered attempt appear to have failed.

Composite agent/check failures additionally retain `metadata.failureCauses` and
the event's `causes`, even when retry is denied. All causes participate in retry
selection, so this prevents a later excluded status from being hidden behind the
primary failure. The browser attempt/node panels expose the list; the new attempt
clears it after archiving. Older records without this list retain only known data.

`RunRecord.failure` is persisted separately for failed/interrupted runs. Successful
completion clears it. Run events retain the typed cause; normal summaries and
inspection expose it. CLI/MCP tool errors also include a typed record when the
application actually raised one. Untyped legacy journal errors are not retroactively
classified by parsing their text.

No graph/source/plan version changes are needed for this additive journal/IPC data.
Older v1/v2/v3 plans retain their frozen source/hash. Failed/uncertain side-effect
nodes remain blocked from implicit repetition. V6 [explicit retry policies](retry-policy.md)
can authorize a new attempt only for selected failures with confirmed safe task
effects and a durable decision. Observations alone do not authorize retry;
reconciliation of uncertain effects remains separate required work.
[Output repair](output-repair.md) is available as an explicit v4 policy, inside
the same settled worker session with only the result tool enabled.
[Collect policy](collection-policy.md) independently preserves child values and
failures without cancelling peers or authorizing retries.

## Validation

Offline tests cover exact protocol validation, accessor rejection, untrusted prefix
and stdout leakage, missing executable versus admitted process loss, nonzero check
data, a real SDK write followed by invalid structured output, per-response accounting,
provider errors without guessed transient status, atomic rollback, archive/current
clearing, real detached runtime→API→browser propagation, and adapter diagnostics.
The writer test confirms its artifact already exists and no whole-task retry occurs.
`spikes/ui-failure-smoke.ts` is a disposable no-model browser fixture.
