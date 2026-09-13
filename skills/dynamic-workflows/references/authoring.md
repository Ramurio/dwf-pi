# Authoring

Use this when the task is not the shipped [research-trio](../recipes/research-trio/README.md) recipe, or when you need expressions, roles, collect, reviews, snapshots, or worktrees. Get exact fields and expression forms from `workflow.schema {}` rather than inventing block types. The graph remains the orchestration artifact; do not write scheduler code, JS loops, generated TypeScript, worker-spawning scripts, or a second execution engine.

## Discover, then patch

Inspect the actual interface with `catalog.list`, `catalog.describe {"name":"reviewer"}`, `catalog.models {}`, and `workflow.schema {}`. Model catalog, capabilities, and thinking belong to [providers.md](providers.md).

Use `workflow.create`, then `workflow.patch` with `id`, `expectedRevision`, and an `operations` array. Operations add/replace/remove blocks and graphs, set an entry, and connect/disconnect edges. A patch increments the revision once. On a revision conflict, inspect the latest draft and rebase the intended changes; do not overwrite another editor's changes blindly.

`workflow.create` already creates the empty entry graph (normally `main`); add its nodes directly. Add only additional graphs with `addGraph`. The successful patch envelope contains `result.workflow` and `result.validation`; take the next expected revision from `result.workflow.revision`.

Define each block's job, input, structured output, and next transitions:

- `agent` for reasoning/work
- `check` for a fixed command and argument array without a shell
- `transform` for declarative expressions
- conditional edges for branches and cycles
- `parallel` for named branches
- `map` for runtime-derived arrays
- `subworkflow` for composition
- `await` for a durable answer (see [operations.md](operations.md))
- `finish` for the task outcome
- `worktree` / `integrate` for isolated Git writers
- `reuse` only for continuation provenance of already completed outputs (see [continuation.md](continuation.md))

The runtime supplies scopes and visit identities for nested work. Each `map` child receives the raw array item as its `input`; its outputs return in input order. Each `parallel` child receives its configured input expression and returns under its child ID.

## Finish versus legacy end

`finish` returns `value` and declares `decision` (`accepted`, `rejected`, `inconclusive`), a nonempty `reason` expression, and an `evidence` expression producing an array. The root finish determines the task outcome; child decisions remain local. Legacy `end` returns data; only its explicit `accepted` boolean supplies legacy acceptance. Technical `succeeded` is not acceptance.

## Expressions and lazy feedback

Expressions read `input` and completed node outputs through `nodes`. Output references can be absent on the first visit. Select feedback lazily, so a first iteration uses the original input and later iterations use the review result:

```json
{"op":"select","when":{"op":"exists","value":{"op":"ref","path":["nodes","review"]}},"then":{"op":"ref","path":["nodes","review"]},"otherwise":{"op":"ref","path":["input"]}}
```

Wire the selected value into the implementer's input alongside the task as needed. `select` evaluates only the chosen branch. Ordinary `ref` to missing data fails; an unconditional feedback reference is not a valid first iteration.

## Collect

For independent fan-out where one failure should not interrupt peers, set `failurePolicy:"collect"` on `map` or `parallel`. Default `fail-fast` keeps ordinary unwrapped outputs. Collect wraps each child as `{"status":"succeeded","value":...}` or `{"status":"failed","failure":...}`; parallel keeps child IDs and map keeps input order. Check status before reading value/decision. A successful execution may still contain `request_changes` or `inconclusive`; a technical failure is not a vote. Author downstream routing explicitly.

Collected results survive supervisor recovery without replaying settled child graphs. Cancellation, cleanup failure, and unresolved side-effect recovery still stop execution. `run.collections {"id":"run-...","key":"parent-activation-key","after":0}` pages durable items and totals. This policy neither retries a failed child nor approves its work. Collect preserves ordinary typed failures; it does not rewrite `failure.effects`, including conservative `unknown` on the collected envelope.

## Roles and agent config

Inspect role defaults and override only what the task needs. The current catalog includes general, researcher, planner, implementer, reviewer, verifier, synthesizer, arbiter, and orchestrator. Do not invent catalog role names. The orchestrator role returns planning/routing data for the fixed graph; it does not gain runtime graph-editing powers.

Each agent block can select model provider/id, thinking, system prompt, tool allowlist, skills, output schema, session policy, and permission profile. A custom system prompt replaces the role prompt. `fresh` isolates a visit; `continue-node` continues successful prior visits of that node within its invocation scope. Prefer concrete available provider/model identifiers; product subscription names are not model IDs. An explicitly unavailable model/thinking configuration is an error, not permission to silently downgrade. The model selected in the caller's harness does not determine the pi worker's model. Role defaults may adapt thinking when you did not set it; an explicit thinking value must be supported by the chosen model.

Use explicit structured output contracts for routing. The default reviewer requires a real `artifactRevision` in its input and returns that revision with `decision` (`approve`, `request_changes`, or `inconclusive`), summary, and findings. When acceptance criteria have a revision, carry that identity as well. Obtain revision identity from the actual artifact or producer output; do not fabricate it. An `approve` verdict for an old artifact cannot approve new work.

Read-only profiles deny mutation tools. `workspace-write` and `unrestricted` are tool/prompt profiles, not OS sandboxes; a granted shell can access more than the working directory. Choose permissions within the user's authorized task. A `check` command also has the local process account's privileges. Merely giving a researcher role does not grant web access; use only actually available tools.

There are no automatic iteration, token, wall-time, or concurrency limits and no mandatory human approval gate. Do not add arbitrary caps or approval steps. Express the user's actual completion criterion and honor requested limits when applicable. Pause if evidence shows the workflow needs intervention rather than pretending that an exhausted/unproductive loop succeeded.

Output-repair and retry policies are opt-in and belong in [recovery.md](recovery.md). Do not add them unless they are the intended policy.

## Review loops

Substantial work should be decomposed into verifiable implementation, check, and review stages with revision-bound reviews. Small workflows may stay a handful of blocks. Surface externally supplied research or independent QA in node input/evidence instead of implying workers gathered it themselves.

For review loops, return to the producer on `request_changes` and pass the findings. Declare acceptance only on the configured successful verdict. Handle `inconclusive` explicitly by gathering missing evidence, arbitration, or an `await` block. An inconclusive finish ends execution without acceptance; await keeps it open for an answer. Do not equate either with approval. For a reviewer council, create independent branches and an explicit all/any/quorum/arbitration policy, selected for the user's task. Keep dissent and evidence in the result.

## Snapshots and resources

Before launch, use `workflow.validate {"id":"..."}` and resolve every issue. `workflow.prepare {"id":"...","cwd":"/absolute/workspace"}` resolves concrete models, thinking, role defaults, skill snapshots, schemas, and generated code, then persists an immutable execution plan. `config.skills` snapshots the selected skill directories, including supported research-resource subtrees that actually live in those directories, with their files, hashes, and any source URL/date notes present in the skill files. There is no generic project-resource snapshot feature and no implied web access for read-only researchers. Credential, symlink, and unsafe path checks still apply. The result is `{preparedId,planHash,cwd,createdAt,plan}`; inspect `plan` and retain `preparedId` for the exact launch. `workflow.prepared {"preparedId":"..."}` reads it again from the same journal without rereading the draft or skills. `workflow.compile` exposes generated source for inspection; it is not a request to maintain that source manually. Active runs retain their launch snapshot even if the authoring draft changes.

A harness may discover this skill through a setup symlink. Snapshotting a skill for `config.skills` requires a real directory (or its `SKILL.md`); a symlink root is rejected. Copy the skill tree when a worker must receive these files.

## Worktrees and integrate

Use explicit workspaces or independent worktrees when parallel writers need isolation. Wrap each concurrent coding branch in a `worktree` block whose child graph performs its changes. The source Git workspace must be clean; the runtime creates a run-owned branch, supplies that worktree as the child's cwd, and commits successful changes. The output is `{result, workspace:{path,branch,base,head}}`. Nested concurrent writers need separate worktrees as well. Review the actual returned commit and integrate approved branches through an explicit `integrate` block with an array of these workspace records or complete worktree results. Integration refuses dirty targets and mismatched sources; a conflict is a failure, never an approval. Shared `check` commands remain the author's explicit responsibility. Worktrees coordinate files; they do not confine a granted shell.

Owned Git worktree recovery limits are in [recovery.md](recovery.md).
