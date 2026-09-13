---
name: dynamic-workflows
description: Create, run, monitor, pause, and reuse graph-authored workflows with independent pi workers through dynamicwf CLI or MCP. Use for multi-agent pipelines, review loops, conditional routing, parallel work, and dynamic fan-out.
---

# Dynamic workflows

Turn the user's process into blocks and connections. The graph is the orchestration artifact: assemble it before launch; the runtime validates and compiles it to TypeScript + Effect. Do not write scheduler code, JS loops, generated TypeScript, worker-spawning scripts, or a second execution engine. There is no autonomous nested spawning. Task-specific implementation code or a check command is allowed only when that is the work assigned to a node.

Pi workers and the supervisor live outside the calling harness. Closing the CLI, MCP connection, or harness does not cancel a run. The same workflow can be controlled from any harness with this skill and a shell or MCP connection.

For the standard three independent researchers then a synthesizer, start at [recipes/research-trio/README.md](recipes/research-trio/README.md). Copy those JSON files and follow that launch sequence. That recipe does not require reading `workflow.schema` or the recovery/continuation manuals first.

## Use the available transport

Prefer installed MCP tools when available: CLI `workflow.create` corresponds to MCP `workflow_create`, with the same JSON arguments. Otherwise invoke `dynamicwf <tool>` with one JSON object on stdin; stdout is `{ "ok": true, "result": ... }` or an error envelope. Check `ok`, not only process exit. A quoted heredoc or a JSON file preserves prompts and literal shell characters:

```sh
dynamicwf workflow.create <<'JSON'
{"id":"review-flow","name":"Implementation and independent review"}
JSON
```

Use a consistent `--store /absolute/state.sqlite` if selecting a nondefault journal. Execution `cwd` is a separate field; pass the intended workspace explicitly to `workflow.prepare` when working from a different directory.

## Route

1. Choose CLI or MCP (same JSON arguments).
2. Choose the task, or a shipped recipe such as [research-trio](recipes/research-trio/README.md).
3. Configure explicitly from the current catalog: models, thinking, task, `cwd`, and store. Do not substitute an unavailable model or thinking.
4. `workflow.create`, then `workflow.patch` with `id`, `expectedRevision`, and `operations`. Check `ok`; for patch also `result.validation.valid`.
5. `workflow.validate`, then `workflow.prepare`. Inspect the prepared `plan`. Keep `preparedId`.
6. `run.start` with that `preparedId`, the input, and a prechosen `idempotencyKey`. Do not use the draft-id start shortcut. Do not pass `cwd` or `model` on top of `preparedId`.
7. Immediately give the user the real `result.id` and a ready-to-copy `dynamicwf watch --run <id>` command (include `--store` when used), before waiting.
8. Observe with `run.status` / `run.inspect`. Read `taskOutcome` to report acceptance. Do not auto-save a preset.

Discover models with `catalog.models {}` and role defaults with `catalog.describe {"name":"..."}`. For non-standard graphs, get exact fields from `workflow.schema {}` after this route — schema is not an entry barrier for the shipped recipe. When to read: [operations.md](references/operations.md) for watch/UI, pause, awaits, attempts, and presets; [authoring.md](references/authoring.md) for expressions, roles, collect, reviews, snapshots, and worktrees; [providers.md](references/providers.md) for catalog, capabilities, and thinking.

A new draft is usually revision `1`. Take later values from `result.revision` / `result.workflow.revision` (or `workflow.inspect`). On a revision conflict, inspect the latest draft and rebase; do not resend a stale patch blindly.

`workflow.prepare {"id":"...","cwd":"/absolute/workspace"}` freezes models, thinking, role defaults, skill snapshots, schemas, and generated code into `{preparedId,planHash,cwd,createdAt,plan}`. `workflow.prepared {"preparedId":"..."}` rereads that handle from the same journal. Inspect `plan` before start.

Choose and retain `idempotencyKey` before sending start. Save a start request that contains only `preparedId`, `input`, and that key. Identical delivery retries return the same run, including after completion; a conflicting plan or input fails. A new intended run needs a new key. A lost response is retried with the unchanged request. Start cannot override a prepared workspace or model: prepare again for those changes. The older `run.start {"id":"draft-id",...}` path prepares the current draft again and creates a new run on every call; it cannot guarantee execution of the snapshot you inspected.

## Invariants

These decisions are not optional and are not replaced by a recipe or a worker verdict:

- The graph is the orchestration artifact. There is no autonomous nested spawning.
- The model in the caller's harness does not determine the pi worker's model. Explicit node provider/id/thinking is not silently substituted; an unavailable choice is a prepare error.
- `session:"fresh"` isolates that visit. `continue-node` continues successful prior visits of that node within its invocation scope.
- Permission profiles are tool/prompt constraints, not an OS sandbox. A granted shell can access more than the working directory. Read-only denies mutation tools; it does not freeze cwd contents or grant web access. A researcher role does not imply web tools.
- `failurePolicy:"collect"` preserves failed branches as envelopes. A technical failure is not a vote. Check `status` before reading `value`. Author downstream routing explicitly.
- Technical `succeeded` means the graph finished. Root `finish` / `taskOutcome.decision` distinguishes `accepted` from `succeeded`. Child decisions remain local. A synthesizer or reviewer verdict cannot bypass the authored finish guard.
- Review `approve` is bound to the real `artifactRevision` (and criteria revision when present). Do not fabricate revision identity. An old approve cannot approve new work.
- There are no automatic iteration, token, wall-time, or concurrency caps and no implicit human-approval gate. Do not add arbitrary limits or approval steps. Express the user's actual completion criterion.
- `preset.save` is explicit and only after technical `succeeded` and task outcome `accepted`. There is no automatic preset save.
- Closing the harness does not stop execution. A caller timeout, closed tab, or stale heartbeat does not prove the run died; inspect the existing run rather than starting a duplicate.

## When to read

| Situation | Read |
| --- | --- |
| Non-standard authoring: expressions, lazy feedback, roles/config, review loops, collect, snapshots, worktrees | [references/authoring.md](references/authoring.md) |
| Watch/UI, status/inspect/events/trace, pause/resume/cancel, awaits, attempts, explicit presets | [references/operations.md](references/operations.md) |
| Before repeating an uncertain effect, inspecting failures, output repair, automatic retry, or reconcile | [references/recovery.md](references/recovery.md) |
| Before continuing a revised task or reusing succeeded outputs | [references/continuation.md](references/continuation.md) |
| Catalog/doctor, capabilities/modalities, credentials/adapter, requested vs resolved vs observed thinking | [references/providers.md](references/providers.md) |
| Per-response and task-level token accounting | [references/usage.md](references/usage.md) |

Do not replace a failed or incomplete run by preparing a new graph and starting an unrelated run that silently copies saved JSON. When to read: [continuation.md](references/continuation.md).

After a crash, a side-effect worker whose output was not committed is uncertain. Do not rerun it implicitly. When to read: [recovery.md](references/recovery.md) before any reconcile, retry, or accept.

Report the actual run state, result, relevant evidence, and any unresolved work. A valid graph, a spawned supervisor, and a succeeded workflow are different outcomes; only the last proves that run completed. Then read `taskOutcome` to say whether the task was accepted.
