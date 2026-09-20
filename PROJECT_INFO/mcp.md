# MCP stdio adapter

`src/mcp.ts` exposes the same `WorkflowService` used by the CLI through MCP stdio.
It owns no scheduler and creates no alternative workflow representation. Tool
handlers validate requests, dispatch to the shared service and serialize results.
The backend remains pi workers supervised by detached local processes.

The adapter uses the official TypeScript SDK's stable v2 packages, pinned to
`@modelcontextprotocol/server@2.0.0` and the integration-test client
`@modelcontextprotocol/client@2.0.0`. The SDK's current stable line implements the
2026-07-28 protocol; `serveStdio` accepts modern connections and legacy clients that
begin with `initialize`. Both paths are exercised by this project's tests.
[Official SDK](https://github.com/modelcontextprotocol/typescript-sdk),
[stdio entry-point implementation](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/serveStdio.ts).

## Connecting a harness

From the repository, start the adapter with:

```sh
node --import tsx src/mcp.ts --store /absolute/path/state.sqlite --cwd /absolute/path/project
```

For a harness launched from another directory, use absolute loader and script paths.
The following is a typical MCP server launch definition; adapt the enclosing
configuration format to your harness:

```json
{
  "mcpServers": {
    "dynamicwf": {
      "command": "/absolute/path/to/node",
      "args": [
        "--import", "/absolute/path/to/dynamicwf-pi/node_modules/tsx/dist/loader.mjs",
        "/absolute/path/to/dynamicwf-pi/src/mcp.ts",
        "--store", "/absolute/path/to/state.sqlite",
        "--cwd", "/absolute/path/to/workspace"
      ]
    }
  }
}
```

The Node binary must satisfy the project's engine requirement. Install project
packages before connecting. `--store` defaults to `$DYNAMICWF_HOME/state.sqlite`,
otherwise `~/.dynamicwf/state.sqlite`; `--cwd` defaults to the MCP server process's
working directory. Requests that accept `cwd` can override the workspace. The
transport is local stdio, with no listening network server or server-side OAuth
configuration. pi provider credentials remain backend configuration and are not
copied from the host's conversation.

All stdout is reserved for MCP JSON-RPC. Startup errors and `--help` use stderr.
A harness may report dependency diagnostics from stderr without treating them as
protocol messages.

## Tool names and schemas

MCP tool names replace the shared service's dots with underscores. For example,
`workflow_patch` dispatches `workflow.patch` and `run_start` dispatches `run.start`.
Underscores also fit hosts that restrict model function names. There are no alternate
business semantics between the transports. `mcpToolDefinitions` maps each current
`serviceToolNames` entry one-to-one; count that export (currently 39 names) rather
than an older inventory. `tools/list` is the live list. Adapter `--help` writes
usage to stderr and does not enumerate tools.

| MCP tool family | Available names |
| --- | --- |
| Roles | `catalog_list`, `catalog_describe`, `catalog_models` |
| Diagnosis | `system_doctor` |
| Authoring | `workflow_schema`, `workflow_create`, `workflow_list`, `workflow_inspect`, `workflow_patch`, `workflow_validate`, `workflow_compile`, `workflow_prepare`, `workflow_prepared` |
| Execution | `run_start`, `run_status`, `run_list`, `run_inspect`, `run_events`, `run_usage`, `run_attempts`, `run_pause`, `run_resume`, `run_cancel`, `run_waits`, `run_resolve`, `run_trace`, `run_collections`, `run_retries`, `run_recovery`, `run_reconcile`, `run_reconciliations`, `run_continuation_inspect`, `run_continue`, `task_inspect`, `task_usage` |
| Presets | `preset_save`, `preset_list`, `preset_inspect`, `preset_run` |

Every tool advertises a closed object input schema, with required fields and field
constraints. `workflow_patch` includes the complete operation, node, edge, agent
configuration and recursive expression schemas; it is not an opaque JSON string or
an untyped operations array. TypeBox's repeated named definitions are bundled into
one set of local `$defs` and `#/$defs/...` references for portable schema consumers.
The server compiles those exact advertised schemas with strict, noncoercing validation
before serving calls. `workflow_schema` exposes the source contract when an agent
needs more detail. Tool annotations describe reads/mutations, idempotence and potential
external effects; they are not enforcement or an authorization system.

Request fields and execution behavior are documented in
[service.md](service.md). Preset scope defaults to project on save; reads without
explicit scope resolve project names before global names. Preset revisions are
immutable hashes. `preset_run` starts a fresh run from the stored frozen plan with
new optional input and does not reuse prior outputs. `run_continue` creates a
successor for the same user task; do not `run_start` an unrelated replacement that
copies saved JSON.

## Result envelope

Each successful call returns the same envelope in `structuredContent` and a JSON
text content block:

```json
{
  "content": [{"type":"text","text":"{\"ok\":true,\"result\":{\"id\":\"run-example\"}}"}],
  "structuredContent": {"ok":true,"result":{"id":"run-example"}}
}
```

The envelope keeps arrays and other service results compatible with clients that
expect an object `structuredContent`. Known tool validation and application failures
return `isError: true`, with `{ok:false,error:{name,message}}` on both surfaces;
validation details can include `error.issues`. Errors remain inspectable tool results
so an authoring agent can repair its request. Invalid JSON-RPC/protocol messages are
handled by the official SDK. This follows MCP's separation between execution errors
and protocol failures. [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

## Run lifetime and control

A normal sequence is `workflow_create` → `workflow_patch` → `workflow_validate` →
`workflow_prepare` → `run_start`. Preparation persists `{preparedId,planHash,cwd,createdAt,plan}` without
inference. Pass its `preparedId` and a caller-chosen `idempotencyKey` to `run_start`;
retry the same input/key to receive the same run. `workflow_prepared` inspects the
saved handle. See [prepared-start.md](prepared-start.md) for delivery conflicts,
workspace binding and interrupted launches. Start returns its run ID after initial
spawn (or the existing run on a delivery retry); the MCP request is
not held open until the workflow finishes. Use `run_status`/`run_inspect` and
incremental `run_events` (`after` → returned `nextAfter`) to observe execution.

Closing the MCP client/server releases its service connection and never invokes
run cancellation. Reconnect from any compatible harness with the same state store,
then inspect, pause, resume or cancel by run ID. An explicit `run_pause` stops new
admissions and drains current workers; `run_cancel` interrupts work separately.
Cancelling an MCP request or closing its transport is not a substitute for the
`run_cancel` tool.

The MCP host's permission UI does not create an OS sandbox for pi workers or check
blocks. Frozen role tool/permission settings and the current limitations documented
in [service.md](service.md) still apply. Preparation freezes plan bytes and the
canonical workspace path, not live cwd contents, Git HEAD or directory inode.
Failed/interrupted external effects are not silently retried: use `run_recovery`
then `run_reconcile` on the same run, or `run_continuation_inspect` then
`run_continue` for a revised graph of the same task. Keyed start/continue retries
return the same run; they are not an exact-once guarantee of worker side effects.
No inference, loop bounds or scheduling logic are implemented in this adapter.

## Verification

`node --import tsx --test tests/mcp.test.ts` uses the official SDK client and actual
stdio server processes. It verifies initialization, tool enumeration, complete
schemas, authoring, frozen preparation, detached execution, pause, original-client
closure, second-client inspection/resume, event cursors, structured errors, modern
protocol negotiation and stdout cleanliness. The execution path uses a real local
check process and JSON transformations, so these tests require no model credentials
or inference calls.
