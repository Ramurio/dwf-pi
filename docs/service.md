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
appear on stderr. `--help` prints available tool names and usage.

The default store is `$DYNAMICWF_HOME/state.sqlite`, or `~/.dynamicwf/state.sqlite`
when that variable is absent. `--store` overrides it. Run resources, sessions,
generated modules and `supervisor.log` live beneath the store's sibling
`runs/<run-id>/` directory. These are persistent local execution data. A service can
use `:memory:` for catalog/authoring/preparation, but detached runs require a
persistent store path. Catalog/schema calls do not create a database.

## Tools

| Tool | Request fields | Result |
| --- | --- | --- |
| `catalog.list` | none | Built-in role names and descriptions |
| `catalog.describe` | `name` | Role definition and defaults |
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
| `run.attempts` | run `id`, activation `key`, optional `after`, `limit` | Archived attempts, separate current checkpoint, per-attempt accounting and history gaps |
| `run.pause` | run `id` | Public state after pause request |
| `run.resume` | run `id` | Public state after resume request |
| `run.cancel` | run `id` | Public state after cancellation request |
| `run.waits` | run `id` | Observed public state and durable wait records |
| `run.trace` | run `id`, optional `after`, `limit` | Durable routing records, summary, plan hash and exclusive cursor |
| `run.resolve` | run `id`, `waitId`, `response`, optional `resolvedBy` | Persisted answer and observed state; same-answer retry is idempotent |

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
skill or default-model changes. `workflow.prepare` now returns an envelope with the
execution plan under `plan` (previously the result was the plan itself). Library
`prepareExecutionPlan` still returns an `ExecutionPlan` directly. See
[prepared-start.md](prepared-start.md) for exact start, delivery retries and recovery.
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
whose external effects are uncertain. Such an activation reports that explicit
retry authorization/reconciliation is required; this service version does not yet
provide a reconciliation tool. Inspect the recorded effects before deciding how to
continue work.

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
