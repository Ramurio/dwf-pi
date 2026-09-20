# Output format repair

An agent can finish real work and then submit malformed JSON. Repeating a writing
task to fix this can repeat its effects. `agent.config.outputRepair` instead
controls additional formatting rounds inside the same pi invocation:

```json
{"outputRepair":{"mode":"submit-only"}}
```

The default is `{"mode":"disabled"}`. `submit-only` has no implicit round, token or
time limit. An author may explicitly choose `maxRounds`, a positive safe integer,
to bound the additional rounds. Each round is one assistant turn, including a
text-only reply or calls to unavailable tools. Exhausting the configured rounds
leaves a typed `output` failure. It never falls back to rerunning the task.

The initial prompt runs with the frozen original tool grant. After its complete
settlement, missing, schema-invalid or duplicate submissions can enter repair.
The SDK active tool registry is replaced with only `submit_result`; every other
tool, including read tools, is unavailable. A model hallucinating `write`, `edit`
or `bash` receives tool errors. The schema stays unchanged and each repair round
must submit exactly one valid result. State from rejected submissions is reset
between rounds, but the transcript and task effects are preserved. The task
prompt is not resent. The prompt explicitly forbids inventing evidence or changing
a verdict merely to satisfy the schema.

Tool calls already admitted in the original assistant turn are allowed to settle
before this boundary; repair does not roll them back. This is an SDK tool grant,
not an OS sandbox or a guarantee about external processes started by earlier work.
SDK extensions, retries and automatic compaction remain disabled.

Configuration/resource, provider/transport, protocol and cancellation failures do
not enter repair. A provider failure during repair ends the invocation. Semantic
checks after the worker returns, such as matching the reviewed artifact revision,
also remain failures; format repair does not certify artifacts, tests or verdicts.
The invocation's task-effect certainty includes its earlier work: closing tools
does not turn an earlier writer into a read-only invocation.

Repair remains part of the already admitted worker. A workflow pause drains it;
pause does not suspend a model response or end an unbounded formatting policy.
Cancel aborts the session, clears queues and drains cleanup as usual. A crash does
not grant permission to restart a writer. A later authorized graph visit with
`continue-node` can reuse the transcript and restores the new invocation's full
frozen tool grant.

## Journal and inspection

Each round emits `output.repair` progress with `round`, `status`
(`running`, `succeeded`, `invalid`, `failed`), original `cause`
(`missing`, `schema`, `duplicate`) and `afterReport` / `throughReport` cursors.
The supervisor commits `metadata.outputRepair` together with an
`activation.metadata` event containing the activation key and attempt. Current
metadata shows the latest round; journal events preserve prior rounds. Replacing
an unsuccessful activation archives this metadata and clears it for the new
attempt. A formatting round is not a new activation attempt or graph visit.

SDK report IDs increase across initial work and all repair rounds in the same
invocation. A settled round's reports have numeric IDs in
`(afterReport, throughReport]`, filtered by this run, activation key and attempt
in `run.usage`. Reports are recorded before result validation and counted exactly
once in node/run totals. A `running` progress record has no final report boundary;
its live usage still appears in the ordinary ledger. Aborted/unreported responses
remain partial. A lingering `running` repair on a stopped activation means no
settlement was confirmed, not that the repair is still running.

Browser node/attempt inspection displays the round and report range; terminal
active work and append-only logs show progression without clock-only duplicates.
`succeeded` here means the output format passed, not task acceptance.

## Compatibility and validation

V4 prepared plans freeze the policy in their hashed agent configuration. V1–v3
plans retain their old bytes and disable repair. The v3 golden agent plan verifies
and executes on the current runtime contract.

Offline tests use the real pi SDK, session persistence and tool dispatch with a
scripted model transport. They exercise writes followed by invalid output, all
seven denied original tools during repair, missing/duplicate results, explicit
bounds, unbounded multi-round success, provider errors, cancellation, exact usage,
and restoration of original tools on a later continued invocation. Journal tests
cover atomic progress events, API/browser projection and attempt archival.
