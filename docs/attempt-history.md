# Durable activation attempt history

A graph visit and an execution attempt have different identities. The activation key
contains graph, invocation scope, node and zero-based visit. Recovery can make another
attempt of that same activation. Re-entering a loop creates a new visit instead.

`workflow_activations` remains the current checkpoint used by replay. Before
`beginActivation` replaces an unsuccessful checkpoint, its complete record is inserted
into `workflow_activation_history` in the same transaction as the replacement and
`activation.started`. Failure at any step rolls all three back. Successful checkpoints
are reused without a new attempt; uncertain side effects still cannot be repeated
without the explicit recovery mechanisms required by the execution contract.

The archive retains the previous attempt number, original status/error, start/end
times, output if recorded, and operation/session/workspace metadata. Current metadata
updates do not change the archived checkpoint. This adds no retry policy or new
admission permission. In particular, read-only agents are not automatically retried
just because historical attempts can now be inspected.

## Public inspection

`run.attempts {id,key,after?,limit?}` (MCP `run_attempts`) reads one activation. Obtain
`key` from `run.inspect`; do not reconstruct it from a display label. It returns:

- `records`: archived attempts ordered by attempt number;
- `current`: the separate current checkpoint as observed during this read;
- `totalAttempts`, `archived`, `missingArchived`: recorded extent and known gaps;
- `nextAfter`, `hasMore`: exclusive archived-attempt cursor and pagination state.

The default page is 100 records, maximum 1000. This is a response size, not an
execution or retry limit. An empty page preserves its cursor. Current is returned on
every request and never advances the archive cursor: it may become archived after a
later recovery, and its changed status must not be cached as an immutable page row.
The page, current checkpoint, counts and accounting share one SQLite read snapshot.
Reading does not observe OS processes, reconcile ownership or restart execution.

Existing journals may already have overwritten earlier attempts. Their missing
records remain explicitly counted; events are not used to fabricate complete history.
The next replacement preserves the available current checkpoint and leaves the older
gap visible. Another scope or visit has a separate history.

## Accounting and metadata

Each returned attempt has `accounting`: `recorded`, `complete`, `responses`, and
`usage` (nullable). These values are derived only from SDK ledger rows for that exact
run/key/attempt. Missing reports remain unknown, even if another attempt spent tokens.
Partial reports preserve known spend. Aggregate activation/run accounting still sums
all responses once, independently of the attempt archive.

Internal owner/worker fencing tokens and cumulative usage projection fields are
removed from public attempt metadata. An explicit attempt inspection can include
recorded local workspace/session paths, errors and outputs. Browser **Данные попытки**
shows these on demand; it does not read session files or expose raw prompts through
the graph snapshot. The read-only browser endpoint uses the same public projection.

## Browser behavior and validation

Select a node and open **Попытки** beneath its activation. Archived and latest
attempts appear separately with status, time, error/output and per-attempt spend.
**Обновить попытки** refreshes current and retrieves newly archived records; **Ещё
попытки** pages older history. Data is explicitly labelled as of the request. Pages
survive graph/tab redraws, run switches and failed fetches without duplicate rows.

`tests/attempt-history.test.ts` checks transactional rollback, retained original
errors/metadata, immutable pagination versus changing current, separate usage totals,
legacy gaps, scope/visit identity, public redaction, browser/API equality and client
paging. A real SIGKILL/recovery test preserves the interrupted await checkpoint and
does not repeat its preceding file write. This history is groundwork for typed
failures, retry/collect policies, output repair and reconciliation; those remain
separate required work.
