# Usage accounting

Read this when reporting tokens, cost, or completeness of usage. Token totals come from recorded worker reports. SDK cost is an estimate, not a subscription invoice.

## Per-response records

Use `run.usage {"id":"...","after":0,"limit":100}` to inspect token totals and the original per-response SDK reports; paginate with `nextAfter` while `hasMore`. Page size 1–1000 is an API response limit, not a workflow budget.

New runs record each completed model response before validating the worker result, preserving known usage after failure/cancellation. Cache read/write is separate; reasoning is already part of output. A cancelled or unreported response remains partial. Older runs retain their worker totals without invented per-response records or cache detail.

Stored fields include input, output, provider total, cacheRead/cacheWrite, reasoning when present, and SDK cost. Do not derive a total by adding partial fields from different providers. Unknown detail stays unknown. A missing field does not become a known zero.

If breakdown exists for only some responses, the known sum is kept with `partialFields` naming incomplete fields. Summary flags such as `cacheReadPartial`, `cacheWritePartial`, `reasoningPartial`, and `costPartial` are independent. A complete total does not mean a complete breakdown. Partial, unknown, and zero are distinct.

`usage.settled` reports accounting completeness independently of task success. A completed response with an invalid result can have complete usage; a cancelled stream leaves partial usage while keeping numbers already received.

## Task-level totals

`task.inspect` and `task.usage` show linked original/continuation runs, plan change, and aggregated SDK usage. Do not add report rows, archived attempts, and cumulative metadata together. Reused outputs add no model call and are not missing agent reports. Unknown cost does not become zero.

Reuse adds no tokens. Details of continuation linkage: [continuation.md](continuation.md).
