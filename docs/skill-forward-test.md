# Portable skill forward test

2026-09-08. Performed by an agent that did not author `skills/dynamic-workflows/SKILL.md`. For this exercise, authoring guidance came only from that skill, installed CLI help, and public `workflow.schema`. Repository implementation and tests were not consulted during the exercise. The agent had earlier implementation context from other tasks; this is an independent skill-author review, not a fresh-context human usability study.

## Setup

Installed executable and skill symlinks through `scripts/setup.ts --bin-dir ... --skills-dir ...` under `/tmp/dynamicwf-skill-forward.Lc2HwS`. Every invocation used the installed CLI from an external temporary workspace, JSON on stdin, and a consistent explicit `--store` filename. Global test presets lived beside that temporary custom store; project presets lived in the temporary workspace. No real global installation or harness settings changed.

The driver only invoked CLI tools, parsed envelopes, asserted outputs, and observed status. Workflow branching, fan-out and cycles were authored as graph blocks and edges through `workflow.create` and `workflow.patch`. No handwritten scheduling code, generated-code edits, direct service imports, check commands, or model calls were used.

## Scenario and observed results

The main branch uses `input.enabled` to choose either a dynamic map of `input.items` or a disabled terminal. Each map item is a linked record `{value,next}`. The child graph uses lazy `select` to choose original input on its first visit and previous `advance` output later. Conditional edges loop until `next` is null and return the final value. Different chain lengths exercise independent child visits.

The first patch tried to add the already-created entry graph and was rejected atomically with `Graph already exists: main`. Inspecting the draft showed that `workflow.create` had already created it. The corrected patch omitted that operation. Validation returned `valid:true` without issues. Compilation returned source hash `b673817adfdf9c6cd07c2ac82d470e31106c817323a171448f24dc24249ad3a1`.

First run `run-2f26e816-0c08-4325-bb82-289f3832db07` succeeded with output `["a2","b1","c3"]` for three items of lengths 2, 1 and 3. Inspection showed `current` visits `[0,1]`, `[0]`, and `[0,1,2]` in separate map scopes. Each child received the raw array element as input. No sibling-state leakage or worker model calls appeared.

Saved that successful run as `forward-saved` in project and global scopes. Both retained frozen revision/plan hash `19d967729c661b88ae0559bf4736d2f198a3d282f794cb120bd2e488173a7c05`. Listing both reported project `shadowed:false` and global `shadowed:true` for the same name.

Then replaced the draft's main `done` block with literal `DRAFT_CHANGED` and ran these checks:

| Run | Source | Observed output |
| --- | --- | --- |
| `run-96c9c5ee-963c-48f0-89b0-47d389aef02f` | Edited draft | `"DRAFT_CHANGED"` |
| `run-0d31c936-febd-4652-98aa-3f42732c95a7` | Project preset, new two-item input | `["z2","q1"]` |
| `run-8ef4d5d2-ecbd-444f-a9b9-d8e77a66a4ba` | Global preset, new three-item input | `["x1","y2","z3"]` |
| `run-c13600bc-ba26-4700-a36e-db52d828e84a` | Project preset, `enabled:false` | `"disabled"` |

Both preset runs retained the saved plan hash after draft edits. The disabled run recorded exactly two activations, `route` and `skipped`, without admitting the map. All five runs succeeded. Installed `watch --once` displayed both graphs, conditional edges, dynamic-map relationship, visit counts, and the unvisited branch.

## Suggested skill clarifications

The task completed through the public contract, with one recoverable authoring mistake. Useful additions:

1. `workflow.create` already creates its empty entry graph. Inspect the returned draft; use `addGraph` for additional graphs.
2. A map child receives the raw array element as `input`. The schema lists `items` and `graphId` but does not describe the child binding. The test chose this natural interpretation before a later runtime-author message confirmed it; actual run inspection then verified it.
3. Describe the `workflow.patch` response wrapper, or tell authors to inspect the returned object before reading its revision. A probe printing top-level `revision` found no value. Subsequent edits correctly obtained it through `workflow.inspect`, so this did not affect execution.

These are guidance improvements, not execution failures. The reviewer did not edit the skill.

The skill author subsequently applied all three clarifications: the pre-created
entry graph, raw map-item input, and `result.workflow.revision` in CLI responses.

## Cleanup

Before removal, `run.list` reported all five runs terminal with `supervisorAlive:false` and `workersAlive:0`. An OS process listing found no remaining supervisor or worker associated with the temporary root. The temporary installation, state, presets, and workspace were removed together. No real global presets, credentials, or user repositories changed.
