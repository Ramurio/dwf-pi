# Four-reviewer council live proof

2026-09-08. Opt-in probe: `node --import tsx spikes/council-live.ts --live`. Running the file without `--live` only prints usage; it is not part of `npm test`.

The probe uses the official MCP Client and the public `bin/dynamicwf.mjs mcp` entrypoint. It submits the exact `examples/council.create.json` and `examples/council.patch.json` through MCP, then overrides only the shared reviewer configuration to `openai-codex/gpt-5.6-sol`, thinking `low`, fresh sessions, read-only permission, and normal `read`, `grep`, `find`, `ls` tools. Role prompts, four perspectives, output schema, and deterministic council aggregation remain those of the example. No instruction forces approval and no schema fixes the decision to approve.

## Actual review evidence

The temporary artifact was an ES module containing `export function answer() { return 42; }`. Before launching the council, the probe actually ran Node's test runner against a test checking named function import, zero arity, synchronous numeric return value, and repeated calls. Its JSON report recorded the executed command, exit code 0, actual TAP output, and source/test SHA-256 values. Reviewers received paths to source, tests, report, and acceptance criteria.

Acceptance criteria covered only the small module's named zero-argument synchronous API, deterministic numeric 42, and absence of I/O or mutable global state. Reviewers were explicitly told that they could inspect supplied execution evidence and could not claim to have run tests themselves.

Source artifact revision: `6512b1c1a66da9d5ad54aeb8ccb1bffd221abd101cabe5cc9ab7f80f32c3b3bb`.

Acceptance-criteria revision: `79633e9040b3811a6b3e38492c3c2f4633593cacdeb385c1a622153f31b6796f`.

## Observed outcome

Run `run-1cf60a44-9ec0-4c8e-b2d0-80f078ea6ffe` succeeded with plan hash `8407ea644ddcd5f956cf96e97617d4801f1895503eb88d9a3d42e352564bebe9`.

| Evidence | Observed result |
| --- | --- |
| Genuine reviewer workers | 4 |
| Distinct persisted sessions | 4 |
| Maximum simultaneous agent loops, from start/settled journal events | 4 |
| Maximum simultaneous worker processes, from PID metadata intervals | 4 |
| First MCP client closed after start | Yes |
| New MCP client observed live detached supervisor | Yes |
| Artifact and criteria revisions identical in every vote | Yes |
| Policy and deterministic aggregate | `unanimous`, `approve`, `accepted:true` |
| Revision consistency | `true` |
| Source unchanged after read-only reviews | Yes |

All four perspectives—correctness, verification, maintainability, requirements—returned actual `approve` votes. Each used four `read` calls before `submit_result`; maintainability additionally used `ls`. The verification reviewer retained two informational findings describing test coverage and the supplied execution report, and explicitly stated that it had not independently run tests. Other reviewers returned no findings. Dissent, if produced on a later invocation, is printed unchanged before the probe's expected-success assertions; it is never replaced with a fabricated vote.

The four recorded reviewer activation durations were approximately 27.33, 36.89, 27.71 and 27.27 seconds, with their starts spanning 18 milliseconds. Actual SDK lifecycle events independently verified four-way overlap. Aggregate provider-reported usage was input 14,209, output 2,408, total tokens 18,025; total tokens includes the provider's cache accounting and is not assumed to equal input plus output.

The fixture's observation deadline is a probe cleanup bound, not a graph/runtime limit. The authored council has no added concurrency or iteration cap. On failure, the probe cancels and drains the existing run before removing its temporary state; if termination cannot be confirmed it retains the directory and reports that fact.

This invocation reported `passed:true` and `cleanupComplete:true`. All temporary artifacts, sessions, state and MCP connections were cleaned up. No credentials or raw provider error strings are included in this report. This proves the tested four-worker council and harness-independent continuation path; it does not establish correctness for arbitrary future review tasks.
