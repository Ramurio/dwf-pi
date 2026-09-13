# Four-perspective reviewer council

This remains a small, complete authoring example. Do not add continuation, reuse or
capability-requirement ceremony here. For a later revision of a real task, inspect
with `run.continuation.inspect` and create a successor through `run.continue` instead
of copying saved JSON into a new unrelated start.

The files in `examples/` are authoring requests and run input, not scheduler code:

- `council.create.json` creates the draft `review-council`.
- `council.patch.json` adds its blocks and connections in one revision-checked patch.
- `council.input.json` selects policy and identifies the artifact, requirements and review evidence.

The shape is:

```text
policy valid? ── yes ──▶ four parallel review calls ──▶ facts ──▶ verdict ──▶ result
     │                       │
     no                      ├─ correctness
     │                       ├─ verification
     ▼                       ├─ maintainability
invalid_policy               └─ requirements
```

Each branch invokes the same reusable `reviewer` graph with different perspective instructions. Each invocation has its own scope and fresh pi session. All four receive the same artifact, artifact revision, acceptance criteria and criteria revision. They do not see the other reviewers' votes before returning their own.

The perspectives are correctness/edge cases, verification evidence, maintainability/integration, and requirements/scope/compatibility. They use the catalog's read-only reviewer defaults, so they neither mutate the artifact nor need separate worktrees. The verification reviewer inspects actual evidence using its granted read tools; it does not pretend to execute shell checks. Supply test reports, or author a preceding `check` block if the workflow needs to run validation first.

## Create and launch

From this checkout, after installing the command:

```sh
dynamicwf workflow.create < examples/council.create.json
dynamicwf workflow.patch < examples/council.patch.json

dynamicwf workflow.validate <<'JSON'
{"id":"review-council"}
JSON
```

Edit `examples/council.input.json` before a real review. Replace the artifact revision placeholder with the identity of the actual artifact being reviewed. A Git commit identifies the artifact only if it is the reviewed tree; for uncommitted work, use a recorded tree/diff identity that includes those changes. Set paths and evidence to actual files. Change `acceptanceCriteriaRevision` when changing the criteria. This identity binding does not freeze files on disk: keep the artifact unchanged during council execution or review an immutable checkout/snapshot.

Inspect `catalog.describe` and `workflow.prepare` to see role defaults and resolved worker configuration. Select a concrete available model if the default does not fit the task. Use `workflow.patch` to replace the `reviewer.review` node with its original fields plus the desired `config`; the shared node config applies to all four invocations. For different per-perspective models or thinking levels, create distinct reviewer graphs and point each parallel branch at its corresponding graph. Graph configuration is fixed before launch.

`council.input.json` is the input value, so wrap it in a `run.start` request. This small command constructs that JSON envelope; all orchestration remains in the graph:

```sh
node -e 'const fs=require("node:fs"); process.stdout.write(JSON.stringify({id:"review-council",cwd:process.cwd(),input:JSON.parse(fs.readFileSync("examples/council.input.json","utf8"))}));' | dynamicwf run.start
```

Record the returned run ID and inspect its result with `run.inspect` or `dynamicwf watch --run <id>`. A successful run means the council computation finished; inspect `output.accepted` and `output.decision` to determine whether the artifact was approved. A computation can succeed with `request_changes`, `inconclusive`, or `invalid_policy` as its result.

## Policies and deterministic aggregation

The input policy supports exactly:

| Policy | Approval criterion |
| --- | --- |
| `unanimous` | Four `approve` decisions |
| `three-of-four` | At least three `approve` decisions |

An absent or unsupported policy returns `{accepted:false, decision:"invalid_policy", ...}` before any reviewer inference. `inconclusive` contributes no approval. Under `three-of-four`, three approving reviewers can outvote one `request_changes` or `inconclusive` verdict; the minority verdict and its findings remain in the result. Select `unanimous` when one non-approval must prevent acceptance. There is no hidden veto or arbitration model.

The graph's `facts` transform uses `all`, `any` and `eq`. Three-of-four is the OR of the four possible three-reviewer conjunctions. `verdict` uses lazy `select`: approve if the selected threshold is met; otherwise return `request_changes` if any reviewer explicitly requested changes, or `inconclusive` if none did. These are deterministic expression nodes, not LLM vote counting.

Every vote must match both input revisions. If even one vote carries a different artifact or criteria revision, the aggregate is `inconclusive` with `accepted:false` and `revisionConsistent:false`, regardless of how many approvals it contains. The normal pi reviewer runtime also validates individual revision bindings; the graph-level check preserves this invariant at the aggregation boundary. Missing required output fields fail evaluation rather than manufacturing an approval.

The result preserves all four original votes, summaries and findings under named perspective keys, plus policy, expected artifact/criteria revisions, aggregate decision and the consistency flag. It does not rewrite dissent as approval.

No iteration/time/token limits or human approval gates are added by this example. It performs one council round. To build an implementation/review loop, compose this council into the larger graph and connect `request_changes` back to the producer with the actual findings as feedback. Handle `inconclusive` through explicit evidence gathering, arbitration or a pause initiated by the control harness. Save a successful run's frozen plan with `preset.save` when it is a useful reusable workflow; a saved council still requires new valid artifact input each time.

## Verification

`tests/council.test.ts` loads the exact authoring JSON through `WorkflowService`, validates it, prepares an execution plan and executes the generated Effect graph. Mock reviewer results cover all 81 combinations of three verdicts across four reviewers, under both supported policies (162 evaluations). Further cases reject unsupported policy before worker admission, reject mismatched artifact/criteria revisions in every reviewer position, preserve findings, and use a barrier to prove four independent parallel scopes. These tests verify orchestration and policy behavior; they do not measure the quality of real model reviews.
