# Shared service and CLI contract

`WorkflowService` in `src/service.ts` is the asynchronous application interface used
by the CLI and available to other harness adapters. It exposes
`dispatch(tool, request): Promise<unknown>` and `close()`. Requests are JSON objects:
unknown fields, malformed identifiers, non-JSON JavaScript values and invalid tool
arguments are rejected. Requests are copied at the boundary so a caller cannot
change an input while asynchronous preparation is running.

```ts
const service = new WorkflowService('/path/to/state.sqlite', { cwd: '/project' });
try {
  const prepared = await service.dispatch('workflow.prepare', { id: 'repair' }) as PreparedExecution;
  const result = await service.dispatch('run.start', {
    preparedId: prepared.preparedId, idempotencyKey: 'unique-intended-repair-run',
    input: { task: 'Implement the requested change' }
  });
} finally {
  service.close();
}
```

Closing the service releases its database connections. A started run belongs to a
separate detached supervisor process and continues independently. New clients can
inspect or control it using its returned run ID and the same store filename.

## CLI transport

```sh
npm run --silent cli -- catalog.list <<<'{}'
npm run --silent cli -- workflow.prepare --store /path/to/state.sqlite <<<'{"id":"repair","cwd":"/project"}'
npm run --silent cli -- run.start --store /path/to/state.sqlite <<<'{"preparedId":"prepared-RETURNED-HASH","idempotencyKey":"unique-repair-run","input":{"task":"Fix the failing check"}}'
npm run --silent cli -- run.status --store /path/to/state.sqlite <<<'{"id":"run-RETURNED-ID"}'
```

Each invocation reads one JSON request from stdin and writes one JSON response to
stdout. Empty stdin means `{}`. Success is `{"ok":true,"result":...}`; failure is
`{"ok":false,"error":{"name":"...","message":"..."}}` with exit status 1.
Validation errors can also include `error.issues`. Diagnostics from dependencies may
appear on stderr. `src/cli.ts --help` (`npm run --silent cli -- --help`, or `dynamicwf <tool> --help`) prints usage and the live `serviceToolNames` list after `Tools:`. Count that list rather than reusing an older inventory; the current export has 39 names. Installed `dynamicwf --help` only shows watch/ui/mcp entry points and example dotted names. MCP `--help` writes usage to stderr and does not enumerate tools.

The default store is `$DYNAMICWF_HOME/state.sqlite`, or `~/.dynamicwf/state.sqlite`
when that variable is absent. `--store` overrides it. Run resources, sessions,
generated modules and `supervisor.log` live beneath the store's sibling
`runs/<run-id>/` directory. These are persistent local execution data. A service can
use `:memory:` for catalog/authoring/preparation, but detached runs require a
persistent store path. Catalog/schema calls do not create a database.

## Tools

The CLI help `Tools:` line is `serviceToolNames.join(", ")`. Count those names instead of reusing an older inventory; the current export has 39 tools, all listed below.

| Tool | Request fields | Result |
| --- | --- | --- |
| `catalog.list` | none | Built-in role names and descriptions |
| `catalog.describe` | `name` | Role definition and defaults |
| `catalog.models` | optional `refresh` | `{models,issues}` from the cached authenticated catalog; `refresh:true` refreshes the Grok catalog over the network |
| `system.doctor` | optional `cwd` | Local Node/POSIX, workspace, store, Git and cached-model diagnosis; no inference |
| `workflow.schema` | none | Workflow, expression, draft, create and patch schemas |
| `workflow.create` | `id`, `name`, optional `entryGraph` | New editable draft |
| `workflow.list` | none | Draft IDs, names and revisions |
| `workflow.inspect` | `id` | Current draft, including incomplete graph |
| `workflow.patch` | `id`, `expectedRevision`, `operations` | Updated revision and validation result |
| `workflow.validate` | `id` | Graph validation result |
| `workflow.compile` | `id` | Generated TypeScript + Effect source and hash |
| `workflow.prepare` | `id`, optional `cwd`, `model` | Saved `{preparedId,planHash,cwd,createdAt,plan}`, with no inference |
| `workflow.prepared` | `preparedId` | Saved handle and verified full plan, without mutable resource reads |
| `run.start` | `preparedId`, optional `input`, `idempotencyKey`; or `id`, optional `input`, `cwd`, `model` | Started or deduplicated run public summary |
| `run.status` | run `id` | Public summary and observed process liveness |
| `run.list` | none | Public summaries and process liveness for stored runs |
| `run.inspect` | run `id` | Summary, frozen workflow, run input and activation journal |
| `run.events` | run `id`, optional `after` | `{events,nextAfter}` for incremental observation |
| `run.usage` | run `id`, optional `after`, `limit` | Token totals and a page of per-response SDK reports |
| `run.attempts` | run `id`, activation `key`, optional `after`, `limit` | Archived attempts, separate current checkpoint, per-attempt accounting and history gaps |
| `run.retries` | run `id`, activation `key`, optional `after`, `limit` | Immutable automatic retry decisions; current progress is separate, scheduling does not prove admission |
| `run.collections` | run `id`, activation `key`, optional `after`, `limit` | Committed collect-policy child results from one read snapshot |
| `run.pause` | run `id` | Public state after pause request |
| `run.resume` | run `id` | Public state after resume request |
| `run.cancel` | run `id` | Public state after cancellation request |
| `preset.save` | run `id`, `name`, optional `scope`, `cwd` | Immutable frozen-plan preset of an accepted succeeded run |
| `preset.list` | optional `scope`, `cwd` | Library summaries; omitted scope lists project then global, with shadowing |
| `preset.inspect` | `name`, optional `scope`, `revision`, `cwd` | Named or hashed revision, including the frozen plan |
| `preset.run` | `name`, optional `scope`, `revision`, `cwd`, `input` | Fresh run from that frozen plan; new sessions, no prior output reuse |
| `run.waits` | run `id` | Observed public state and durable wait records |
| `run.trace` | run `id`, optional `after`, `limit` | Durable routing records, summary, plan hash and exclusive cursor |
| `run.resolve` | run `id`, `waitId`, `response`, optional `resolvedBy` | Persisted answer and observed state; same-answer retry is idempotent |
| `run.recovery` | run `id`, activation `key` | Attempt, checkpoint, operation, blockers and workspace digest. Authorizes nothing |
| `run.reconcile` | run `id`, `key`, `attempt`, `checkpoint`, `workspaceDigest`, `decisionId`, `action` accept or retry, `actor`, `reason`, `evidence`; `accept` requires `output`; optional `supersedes` | Decision receipt; prepares the same run without launching workers or lifting pause |
| `run.reconciliations` | run `id`, optional `key` | Immutable decisions and application/supersession receipts. Reading authorizes nothing |
| `run.continuation.inspect` | source run `id` | Checkpoint, lineage, reusable outputs, writer-effect blockers and workspace digest. Authorizes nothing |
| `run.continue` | `preparedId`, `idempotencyKey`, `source` (`runId`, `checkpoint`, `planHash`), `actor`, `reason`, `evidence`, `workspaceDigest`, optional `input`, `reuse`, `dispositions` | New or idempotent continuation run public summary; reports the new run ID immediately |
| `task.inspect` | task `id` | Linked runs, receipts and reused output identities. Does not launch work |
| `task.usage` | task `id`, optional `after`, `limit` | Per-run and task SDK totals plus paged reports. Reuse adds no invocation; cost is not a subscription invoice |

Completed summaries include `taskOutcome` independently of technical status/output.
See [outcomes-and-waits.md](outcomes-and-waits.md) for resolution, pause and recovery.

`run.start.preparedId` identifies a saved plan in this journal. It cannot be combined
with `id`, `cwd` or `model`. The alternative `run.start.id` identifies a current draft
and always creates a new run; it does not accept `idempotencyKey`. Other run
operations take the returned run ID.
A missing run input defaults to JSON `null`; explicit `false`, `0`, `""`, objects,
arrays and `null` retain their JSON meaning. `cwd` defaults to the service's working
directory (the CLI process's working directory). A relative `cwd` is resolved against
that directory. `model` is exactly `{provider,id}` and supplies a default for nodes
without an explicit model; it does not replace per-node choices. Availability and
thinking behavior are described in [execution-plan.md](execution-plan.md).

The recommended prepared start uses the saved snapshot regardless of later draft,
skill or default-model changes. That snapshot is the frozen plan (validated graph,
generated source, versions, resolved models/thinking, prompts, tools, permissions,
schemas and skill bytes) plus a canonical workspace path. Live files under `cwd`,
Git HEAD and the directory inode are not frozen; workers read and write the current
workspace. `workflow.prepare` now returns an envelope with the
execution plan under `plan` (previously the result was the plan itself). Library
`prepareExecutionPlan` still returns an `ExecutionPlan` directly. See
[prepared-start.md](prepared-start.md) for exact start, delivery retries and recovery.
Keyed start deduplicates the launch command; it is not an exact-once guarantee of
worker side effects. A revised graph of the same user task uses
`run.continuation.inspect` then `run.continue`. Do not `run.start` an unrelated
replacement that copies saved JSON.
`workflow.prepared` exposes the concrete plan for inspection, including skill
snapshots; ordinary status responses omit that potentially large payload and owner
fencing tokens. They include workflow identity/revision, `planHash`, `sourceHash`,
`preparedId` when recorded, resolved agent model/thinking summaries, working directory, timestamps, status,
desired state, supervisor PID, and output or error when present. Observed state also
includes `supervisorAlive` and `workersAlive`; a database PID alone does not prove
liveness. `run.inspect` omits activation owner/worker fencing tokens. Public events
also remove the internal launch reservation and worker fencing tokens.

`presentation` is shared with browser and watch: technical status/intent, task
outcome, active/waiting activation keys and separately sampled process liveness.
Liveness distinguishes supervised, orphaned-workers, launching, stopped and unknown;
the observed timestamp is telemetry, not a timeout policy. Controller snapshot
samples OS processes and journal records; it is not an atomic OS/database transaction.

The event cursor `after` is a nonnegative safe integer, initially 0. Pass the returned
`nextAfter` to the next request. An empty page preserves the supplied cursor. Unknown
runs produce an error instead of a misleading empty page. There is currently no
pagination limit; applications should advance their cursors when observing long runs.

## Pause, cancellation and interrupted execution

Pause changes desired state immediately and blocks admission of new activations.
Already admitted leaf workers finish and checkpoint their results. State is
`pausing` while they drain, then `paused`; pause is not a kill signal. Resume opens
admission again. A running check or model request can therefore delay a completed
pause until it returns.

Cancellation is a separate operation. It prevents new activations and interrupts
active workers, with process-group cleanup. State may be `cancelling` before
`cancelled`. Cancellation is monotonic: a subsequent pause or resume cannot revoke
it. Controls applied to succeeded, failed or cancelled runs preserve their terminal
outcome. Inspect status/events to observe completion of a requested transition.

Observation compares stored process identities with current OS processes. A missing
supervisor with live recorded workers is not treated as an entirely stopped run.
When both supervisor and recorded workers are absent, the controller records an
interruption. Completed activation outputs remain durable. Resume can relaunch an
interrupted run, but it must not silently repeat a failed/interrupted agent or check
whose external effects are uncertain. Inspect with `run.recovery`, then record an
explicit `run.reconcile` accept or one-use retry; see [reconciliation.md](reconciliation.md).
That decision prepares the same run and does not launch workers or lift pause:
`run.resume` remains separate. Actor evidence is attestation, not proof of outside
effects. A revised graph of the same user task still uses `run.continuation.inspect`
then `run.continue`, not an unrelated replacement start.

## Permissions and current boundaries

Role tools and configured permissions are frozen and checked before worker startup.
Read-only configurations cannot grant `bash`, `write` or `edit`. These controls are
not an OS sandbox: `workspace-write` and `unrestricted` workers with shell tools can
execute commands with the host user's access, and `check` blocks run their configured
program directly. This version does not claim filesystem/network containment or
automatic Git worktree isolation. Choose the working directory and granted tools
with that behavior in mind.

No cost, iteration, timeout or concurrency cap is inserted by this service. Graph
conditions determine loops and dynamic fan-out; pause/cancel remain available for
runs that have no configured completion bound.

Validation: existing CLI authoring tests remain unchanged. `tests/service.test.ts`
checks strict requests, preparation/model selection, persisted detached execution
across service closure, pause/resume/cancel, event cursors and token-free public
inspection.

Attempt history and its cursor/current distinction are documented in [attempt-history.md](attempt-history.md). This read-only operation does not authorize repeated effects.

Structured failure records are described in [execution-failures.md](execution-failures.md). Run summaries expose `failure` for known failed/interrupted observations; activation details carry `metadata.failure`. CLI/MCP error envelopes include a typed failure only when the application actually raised one. These fields do not change retry admission.

An agent's frozen `config.outputRepair` can enable submit-only format repair;
see [output-repair.md](output-repair.md). `metadata.outputRepair` shows the latest
round, while `activation.metadata` events preserve progression with key and attempt.
Its report cursors refer to `run.usage` report IDs within that same attempt.

`run.collections {"id":"run-...","key":"parent-activation-key","after":0,"limit":100}`
pages committed collect-policy child results, with a whole-collection summary from
the same read snapshot. Child errors stay separate from successful values/verdicts;
recovery reuses both. See [collection-policy.md](collection-policy.md).
