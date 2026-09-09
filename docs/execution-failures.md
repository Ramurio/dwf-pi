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

SDK assistant failure is currently the `provider` family. Pi's message often exposes
only a stop reason and arbitrary error text. We **do not infer** HTTP status,
authentication rejection, transience, rate limits or retryability from those strings.
Provider-specific structured status capture remains required work alongside the
adapter integration and retry policies. Unknown SDK exceptions stay `unknown`.

A check that normally exits 1 or 7 still returns `{exitCode,stdout,stderr}` as graph
data. A negative reviewer verdict is likewise data. Neither becomes a transport or
runtime exception. Missing-command admission and a process failure *after* admission
are distinguished; the latter cannot claim `not-started`.

The IPC decoder validates exact fields, version and enums. Legacy worker error
messages without a typed record remain unknown. Malformed protocol data produces a
protocol failure without echoing raw stdout. Arbitrary SDK errors are not promoted
to trusted diagnostics because they start with a recognized phrase. This replaces
the former prefix allowlist, which could forward arbitrary trailing text.
Known local Grok adapter configuration errors retain their actionable diagnostics.

## Durable records and compatibility

`metadata.failure` is written atomically with an activation failure/interruption and
its event. Beginning a new attempt archives the old record and clears the current
failure while preserving worktree/wait metadata. History therefore retains the old
cause without making the recovered attempt appear to have failed.

`RunRecord.failure` is persisted separately for failed/interrupted runs. Successful
completion clears it. Run events retain the typed cause; normal summaries and
inspection expose it. CLI/MCP tool errors also include a typed record when the
application actually raised one. Untyped legacy journal errors are not retroactively
classified by parsing their text.

No graph/source/plan version changes are needed for this additive journal/IPC data.
Older v1/v2/v3 plans retain their frozen source/hash. Execution admission is unchanged:
failed/uncertain side-effect nodes are still blocked from implicit repetition, even
if a new failure observation supplies more information. Explicit retry/collect
policies, output repair with closed write tools, and reconciliation remain separate
required implementation steps.

## Validation

Offline tests cover exact protocol validation, accessor rejection, untrusted prefix
and stdout leakage, missing executable versus admitted process loss, nonzero check
data, a real SDK write followed by invalid structured output, per-response accounting,
provider errors without guessed transient status, atomic rollback, archive/current
clearing, real detached runtime→API→browser propagation, and adapter diagnostics.
The writer test confirms its artifact already exists and no whole-task retry occurs.
`spikes/ui-failure-smoke.ts` is a disposable no-model browser fixture.
