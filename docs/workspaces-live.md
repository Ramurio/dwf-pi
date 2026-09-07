# Live pi + Git workspace verification

The opt-in probe [`spikes/workspace-live.ts`](../spikes/workspace-live.ts) verified
actual pi workers and Git integration in a disposable clean repository. It is not
part of the offline test suite and requires an explicitly selected authenticated
provider/model:

```sh
node --import tsx spikes/workspace-live.ts \
  --provider openai-codex --model gpt-5.6-sol \
  --output /tmp/dynamicwf-workspace-live-evidence.json
```

The probe creates `answer.mjs` exporting an incorrect answer of 41 and authors the
workflow through the shared create/patch service. Its graph is:

```text
worktree
  └─ implementer → actual Node assert(answer() === 42)
         ↑                │ failed
         └────────────────┘
                          │ passed
                    runtime commit
                          ↓
              fresh independent reviewer
                     │            │
                  approve       other verdict
                     ↓            ↓
                  integrate    declined end
                     ↓
        actual Node assertion in original repo
                     ↓
                    done
```

The implementer must change the real file to compute `6 * 7`. Git operations are
runtime-owned; the agent does not orchestrate commits or write the workflow loop.
The independent reviewer receives the committed workspace path, exact artifact
revision, acceptance-criteria revision and the actual check output. The graph only
admits integration after an `approve` verdict. A different verdict is a probe
failure and leaves the original repository unintegrated.

The 180-second observation deadline belongs to this opt-in probe; it is not a
runtime workflow limit. On completion or failure, the probe explicitly drains any
remaining workers before removing its own temporary repository/worktrees. Evidence
is emitted only after successful cleanup. It never mutates this project's Git tree.

## Observed run

Verified at **2026-09-07 23:20:41 UTC** (2026-09-08 locally). Run ID:
`run-5d4e9de8-0d99-4808-84af-666b960d9792`.

| Evidence | Observed value |
| --- | --- |
| Worker provider/model | `openai-codex/gpt-5.6-sol` |
| Actual thinking | `low` for both workers |
| Actual agent calls | 2: implementer and fresh reviewer |
| Frozen plan hash | `f4e9948b5099ad51da2088bf11559e41c881a5fdcb275b8c1a40b8ea0f4f3ed1` |
| Initial fixture commit | `ee240ac97c683c215834c09d97d6e8ff72d33694` |
| Candidate worktree commit | `8959ee21eea5d1b714992c8419bc7f6bc1959bab` |
| Integrated `main` commit | `c9ae595deadc37ef8654ecd715705577b9222039` |
| Allocated workspace assertion | exit 0, actual answer 42 |
| Original repository assertion | exit 0, actual answer 42 |
| Reviewer decision | `approve`, no findings |
| Reviewed artifact revision | Exact candidate commit above |
| Criteria revision | `answer-six-times-seven-v1` |
| Cleanup | Temporary repository and linked worktrees removed |

The candidate branch was
`dynamicwf/run-5d4e9de8-0d99-4808-84af-666b960d9792/0b291d9c8be9b54b81f94b3d53bfcf0c6b47d555dadba7b1154ebca3996ba242`.
The implementer's recorded process cwd and the child assertion's actual
`process.cwd()` both matched that branch's allocated worktree directory. The
reviewer's cwd remained the original temporary repository, and its separate session
read the supplied candidate path through the real `read` tool. The final assertion's
cwd matched the original repository, and its Git state was clean after integration.

Observed implementer tools: `bash`, `read`, `edit`, `bash`, `bash`, `submit_result`.
Observed reviewer tools: `read`, `submit_result`. The probe checks the reviewer's own
read event, not merely whether some worker used a read tool.

These observations prove the live model→allocated files→Git commit→independent
review→explicit merge→actual root check path for this run. They complement the
model-free tests for parallel worktrees, conflicts, pause admission, cancellation,
changed source heads, ignored-file preservation and inherited Git environment
rejection; the live probe does not replace those failure-path checks.
