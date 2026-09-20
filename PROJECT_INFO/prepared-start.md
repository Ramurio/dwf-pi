# Addressable plans and delivery-safe start

Prepare a draft with `workflow.prepare {id,cwd?,model?}`. It validates the canonical
workspace and returns a persisted `{preparedId,planHash,cwd,createdAt,plan}`. The
execution plan is under `plan`; this replaces the old service response that was
the plan directly. The library `prepareExecutionPlan` has not changed its return
type. `workflow.prepared {preparedId}` inspects a saved handle in the same journal.

`run.start {preparedId,input?,idempotencyKey?}` executes that snapshot. It does not
read the current draft, model defaults, role defaults or original skill files.
Models, thinking, prompts, tools, permissions, schemas, resources, generated source
and versions are already frozen. The worker still checks the frozen provider's
actual availability when it is invoked; unavailable credentials do not silently
select a different model. Preparation and inspection make no inference calls.

## Workspace and identity

The handle hashes a versioned tuple of plan hash and canonical workspace path.
Repeating preparation of identical content in the same workspace returns the same
handle and original creation time. A workspace symlink is resolved at preparation;
another canonical workspace yields a different handle even for the same plan.
Snapshots are stored once per plan hash and referenced by prepared handles.

Prepared start cannot include `id`, `cwd` or `model` overrides. Prepare again for a
different workspace or settings. First launch requires the recorded workspace to
exist as a directory and resolve to its recorded canonical path. A path redirected
through a new symlink fails. Workspace *contents*, Git HEAD and directory inode are
not frozen by this feature; artifact revision certification is separate work.

Inspection verifies plan/source/resource hashes, supported compiler/runtime bytes
and the handle's workspace/plan binding. It does not require the original workspace,
skills or authentication to exist. The handle is an address within one journal,
not an import token or signature. It cannot authenticate edits by someone able to
replace the database and all hashes. `:memory:` preparation remains possible, with
handles valid only during that service lifetime; detached start needs a file store.

## One key per intended run

Choose and retain a unique `idempotencyKey` **before** sending start. Its namespace
is the whole selected journal, not a client, draft or project. `run.continue` uses
the same key namespace and compares the full canonical continuation request, not
only preparedId/input. A start key cannot later bind a continuation, and the reverse
conflict fails without creating a run. For example:

```json
{"preparedId":"prepared-<returned 64 hex characters>","idempotencyKey":"repair-issue-42-attempt-1","input":{"task":"Fix issue 42"}}
```

Retry the exact prepared ID, JSON input and key if the response is lost. The service
returns the same run ID and its current public observation. JSON object key order
does not matter; array order and values do. Missing input means `null`. Stored JSON
normalization treats negative zero as zero and discards JavaScript object prototypes.
Another plan/workspace or input with that key produces a conflict, creating no run.
The binding and `run.created` event are committed atomically with run creation;
concurrent independent clients cannot create two runs for a key.

A new intended execution needs a new key. Omitting the key creates a fresh run on
every call. The compatibility form `run.start {id,cwd?,model?,input?}` prepares the
*current* draft and always creates a fresh run; it rejects `idempotencyKey`. It does
not promise to execute an earlier `workflow.prepare` response. Preset delivery
semantics are unchanged by this feature.

Successful preparation is not a tested preset and does not publish or save to a
preset library. Prepared data and key bindings have no automatic expiry. Explicit
retention/cleanup remains separate work; deleting a journal loses its dedup history.

## Failure windows and control intent

Duplicate lookup happens before resource resolution and workspace checks, so a
completed run can be returned even after its workspace or prepared snapshot becomes
unavailable. Completed, failed, cancelled, paused and interrupted runs keep their
outcomes and control intent. Delivery retry is not retrying failed execution.

If creation committed but no supervisor reservation was made, another delivery can
complete that initial launch. Reservation uses the existing atomic ownership fence;
only one client spawns. A pending reserve/spawn/attach window is observed without
stealing its reservation. If its process is later verified absent, the public
observation reports interruption. A duplicate start does not relaunch it; explicit
`run.resume` retains responsibility for recovery and uncertain effects.

This guarantees deduplication of the run-creation command, not exactly-once external
effects across all possible worker failures. Existing checkpoint/recovery rules
still apply. Neither a delivery retry nor a key changes the active graph.

## Observability and checks

Public status/inspection and `run.created` expose `preparedId` when present; the key
is not included. Browser **План запуска** shows graph revision, plan SHA-256 and the
saved handle, including for old-snapshot starts after a draft patch. Runs without a
recorded handle explicitly say so. Preparation is read back with
`workflow.prepared`; no raw prompts/resources are added to the browser snapshot.

`tests/prepared-start.test.ts` checks patch/removal/default drift, canonical workspace
binding, shared snapshots, four concurrent CLI deliveries and one real write,
lost-response retry after workspace removal, transactional rollback, conflicting
keys, create/reserve gaps, pause/terminal preservation, real SIGKILL with completed
effects, JSON equivalence, snapshot tampering and matching service/MCP validation.
Official MCP tests reconnect and repeat a prepared start while paused. Browser API
tests verify safe plan identity projection. `spikes/ui-prepared-smoke.ts` provides
a disposable browser fixture with an amended draft and one deduplicated old run.
