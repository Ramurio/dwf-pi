---
name: dynamic-workflows
description: Create, run, monitor, pause, and reuse graph-authored workflows with independent pi workers through dynamicwf CLI or MCP. Use for multi-agent pipelines, review loops, conditional routing, parallel work, and dynamic fan-out.
---

# Dynamic workflows

Turn the user's process into blocks and connections. The graph is assembled before launch, validated and compiled automatically to TypeScript + Effect. Pi workers and the supervisor live outside the calling harness. The same workflow can be controlled from any harness with this skill and a shell or MCP connection.

## Use the available transport

Prefer installed MCP tools when available: CLI `workflow.create` corresponds to MCP `workflow_create`, with the same JSON arguments. Otherwise invoke `dynamicwf <tool>` with one JSON object on stdin; stdout is `{ "ok": true, "result": ... }` or an error envelope. Check `ok`, not only process exit. A quoted heredoc or a JSON file preserves prompts and literal shell characters:

```sh
dynamicwf workflow.create <<'JSON'
{"id":"review-flow","name":"Implementation and independent review"}
JSON
```

Use a consistent `--store /absolute/state.sqlite` if selecting a nondefault journal. Execution `cwd` is a separate field; pass the intended workspace explicitly when launching from a different directory. Closing the CLI, MCP connection, or harness does not cancel a run.

## Author the graph

Discover the actual interface with `catalog.list`, `catalog.describe {"name":"reviewer"}`, `catalog.models {}`, and `workflow.schema {}`. `system.doctor {}` diagnoses local prerequisites without inference; `catalog.models {"refresh":true}` explicitly refreshes the Grok account catalog when needed. Use `workflow.create`, then `workflow.patch` with `id`, `expectedRevision`, and an `operations` array. Operations add/replace/remove blocks and graphs, set an entry, and connect/disconnect edges. A patch increments the revision once. On a revision conflict, inspect the latest draft and rebase the intended changes; do not overwrite another editor's changes blindly.

Define each block's job, input, structured output and next transitions. Use `agent` for reasoning/work, `check` for a fixed command and argument array without a shell, and `transform` for declarative expressions. Use conditional edges for branches and cycles, `parallel` for named branches, `map` for runtime-derived arrays, and `subworkflow` for composition. The runtime supplies scopes and visit identities for nested work. An `end` block returns the graph result. Get exact fields and expression forms from the schema rather than inventing new block types.

`workflow.create` already creates the empty entry graph (normally `main`); add its nodes directly. Add only additional graphs with `addGraph`. Each `map` child receives the raw array item as its `input`; its outputs return in input order. Each `parallel` child receives its configured input expression and returns under its child ID.
The successful patch envelope contains `result.workflow` and `result.validation`; take the next expected revision from `result.workflow.revision`.

Do not write or edit scheduler code, JS loops, generated TypeScript, worker-spawning scripts, or a second execution engine. The authoring artifact is the graph. Task-specific implementation code or a check command is allowed when that is the actual work assigned to a node.

Expressions read `input` and completed node outputs through `nodes`. Output references can be absent on the first visit. Select feedback lazily, so a first iteration uses the original input and later iterations use the review result:

```json
{"op":"select","when":{"op":"exists","value":{"op":"ref","path":["nodes","review"]}},"then":{"op":"ref","path":["nodes","review"]},"otherwise":{"op":"ref","path":["input"]}}
```

Wire the selected value into the implementer's input alongside the task as needed. `select` evaluates only the chosen branch. Ordinary `ref` to missing data fails; an unconditional feedback reference is not a valid first iteration.

Before launch, use `workflow.validate {"id":"..."}` and resolve every issue. `workflow.prepare` resolves concrete models, thinking, role defaults, skill snapshots, schemas and generated code into an immutable execution plan. `workflow.compile` exposes generated source for inspection; it is not a request to maintain that source manually. Active runs retain their launch snapshot even if the authoring draft changes.

## Choose workers and review policy

Inspect role defaults and override only what the task needs. The current catalog includes general, researcher, planner, implementer, reviewer, verifier, synthesizer, arbiter and orchestrator. Do not invent catalog role names. The orchestrator role returns planning/routing data for the fixed graph; it does not gain runtime graph-editing powers.

Each agent block can select model provider/id, thinking, system prompt, tool allowlist, skills, output schema, session policy and permission profile. A custom system prompt replaces the role prompt. `fresh` isolates a visit; `continue-node` continues successful prior visits of that node within its invocation scope. Prefer concrete available provider/model identifiers; product subscription names are not model IDs. An explicitly unavailable model/thinking configuration is an error, not permission to silently downgrade. The model selected in the caller's harness does not determine the pi worker's model.

Use explicit structured output contracts for routing. The default reviewer requires a real `artifactRevision` in its input and returns that revision with `decision` (`approve`, `request_changes`, or `inconclusive`), summary and findings. When acceptance criteria have a revision, carry that identity as well. Obtain revision identity from the actual artifact or producer output; do not fabricate it. An `approve` verdict for an old artifact cannot approve new work.

For review loops, return to the producer on `request_changes` and pass the findings. End only on the configured successful verdict. Handle `inconclusive` explicitly by gathering missing evidence, arbitration, or pausing the run from the control harness. Do not equate it with approval. For a reviewer council, create independent branches and an explicit all/any/quorum/arbitration policy, selected for the user's task. Keep dissent and evidence in the result.

There are no automatic iteration, token, wall-time or concurrency limits and no mandatory human approval gate. Do not add arbitrary caps or approval steps. Express the user's actual completion criterion and honor requested limits when applicable. Pause if evidence shows the workflow needs intervention rather than pretending that an exhausted/unproductive loop succeeded.

Read-only profiles deny mutation tools. `workspace-write` and `unrestricted` are tool/prompt profiles, not OS sandboxes; a granted shell can access more than the working directory. Choose permissions within the user's authorized task. A `check` command also has the local process account's privileges. Use explicit workspaces or independent worktrees when parallel writers need isolation. Merely giving a researcher role does not grant web access; use only actually available tools.

Wrap each concurrent coding branch in a `worktree` block whose child graph performs its changes. The source Git workspace must be clean; the runtime creates a run-owned branch, supplies that worktree as the child's cwd, and commits successful changes. The output is `{result, workspace:{path,branch,base,head}}`. Nested concurrent writers need separate worktrees as well. Review the actual returned commit and integrate approved branches through an explicit `integrate` block with an array of these workspace records or complete worktree results. Integration refuses dirty targets and mismatched sources; a conflict is a failure, never an approval. Shared `check` commands remain the author's explicit responsibility. Worktrees coordinate files; they do not confine a granted shell.

## Run and control

Launch with `run.start {"id":"...","cwd":"/absolute/workspace","input":...}`. Record the returned run ID. Observe it with `run.status`, inspect outputs/activations with `run.inspect`, and page events with `run.events {"id":"...","after":0}` followed by the returned `nextAfter`. Give the user the actual run ID and a ready-to-copy `dynamicwf watch --run <id>` command (including `--store` when used) immediately after launch, before waiting. The monitor opens a compact live dashboard: 1 current work, 2 history, 3 graph, 4 token usage; arrows scroll and q detaches. Use `--once` for a compact snapshot or `--graph --once` for the complete technical graph. Token totals come from recorded worker reports; active or missing reports make the total partial, and SDK cost is not a subscription charge. For your own observation, prefer short `run.status` calls and inspect details when the state warrants it; avoid printing repeated full graphs.

`run.pause` stops admitting new work and drains active leaves before reporting `paused`; structural map/parallel parents can remain recorded as running at that checkpoint. `run.resume` continues the same live supervisor or recovers a verified-dead one. `run.cancel` interrupts workers and is irreversible for that run. Ctrl-C in the watcher only detaches the viewer. A caller timeout, closed tab, or stale heartbeat alone does not prove the run died; inspect the existing run rather than starting a duplicate.

Completed checkpoints replay without repeating their operations. After a crash, a side-effect worker whose output was not committed is uncertain: its external action may already have happened. Recovery refuses to rerun it implicitly. Inspect the activation and real artifacts, report the uncertainty, and obtain an explicit resolution before repeating the action. Do not edit SQLite or erase checkpoint rows to force a retry. Pure transforms and structural parents can recover through their completed child checkpoints. The current interface does not offer manual active-graph mutation or a retry-authorization tool.

## Save and reuse

After a successful run, `preset.save {"id":"run-...","name":"review-council","scope":"project","cwd":"/workspace"}` saves its frozen execution plan; choose `global` for reuse across projects. There is no default automatic preset saving. `preset.list`, `preset.inspect`, and `preset.run` support explicit scope and revision; project presets shadow a same-name global preset when scope is omitted. Reuse with a new `input` and `cwd`. A preset includes concrete models and snapshotted skills, so a replay does not silently substitute changed defaults or models.

Report the actual run state, result, relevant evidence and any unresolved work. A valid graph, a spawned supervisor, and a succeeded workflow are different outcomes; only the last proves that run completed.
