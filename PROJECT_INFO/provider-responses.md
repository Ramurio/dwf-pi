# Provider HTTP observations

A provider failure can carry optional closed numeric facts:

```json
{"version":1,"code":"provider","phase":"execution","effects":"read-only",
 "message":"Pi assistant turn failed or was aborted",
 "providerResponse":{"status":429,"retryAfterMs":12000}}
```

`status` is an observed HTTP response status, not a number extracted from error
text. `retryAfterMs` comes from a valid `Retry-After` delta-seconds or IMF-fixdate
header. Invalid, unsupported or unsafe values remain absent. An elapsed date
produces zero. Absolute dates are evaluated against the worker's local clock.
The journal does not store the response body, cookies, request URL, authorization
or arbitrary headers in this record.

## Boundaries

Each assistant request has its own response observation. A later network failure
does not inherit the preceding response's HTTP status, including across tool turns
and output repair. Only a failed assistant turn attaches these facts to its
structured failure. An HTTP 200 followed by a broken event stream remains HTTP 200;
the runtime does not turn it into an invented server status or infer that execution
succeeded. An aborted workflow retains its cancellation semantics.

The pinned pi SDK exposes `onResponse`, but some OpenAI SDK paths invoke it only
after successful admission. The worker therefore also wraps per-request `fetch`
for the reviewed OpenAI completions/responses, Codex and Grok APIs. This observes
failures before SDK/adapter sanitization and returns the original Response untouched.
Other APIs retain the SDK callback and report only the facts actually available.
No global fetch replacement is introduced by this observer. The legacy Grok
adapter's existing serialized redirect guard remains separate.

Session-level retry and provider HTTP retries are both disabled. The worker passes
`maxRetries: 0` on every request. Codex uses SSE: the pinned SDK's automatic
WebSocket continuation/fallback loop can retry independently of `maxRetries`.
This fixes an earlier gap where disabling session retry still left HTTP client
defaults in effect. The same concrete provider/model and thinking configuration
continue to apply. Worker process isolation and workflow-level admission policies
are unchanged.

Authentication/catalog refresh before the inference boundary and transports that
do not expose a response can still produce failures without HTTP facts. Absence is
unknown, not zero or proof of a temporary failure. No classification is inferred
from arbitrary error strings or provider-specific body codes.

## Persistence and UI

The optional field is validated at IPC, failure and journal boundaries, including
closed nested fields and rejection of accessors. Old version-1 failures with no
response field remain valid. No graph/source version bump is required for these
additional observed facts. Existing prepared plans retain their exact source/hash.

Runtime checkpoints, collected failures, retry decisions, attempt archives, run
summaries and service/MCP inspection preserve the same failure object. Browser
run/node/attempt panels and terminal watch show the available status and delay.
Token accounting remains independent; an error response does not make partial
usage complete or certify zero spending.

The [retry policy](retry-policy.md) can explicitly select `provider.statuses` and
`provider.retryAfter: "honor"` in v7 plans. With no provider options, code-family
selection and configured delay retain their original behavior. HTTP observations
alone do not authorize retries. A graph can also read the facts in a collected
failure when explicitly authoring downstream decisions.

## Verification

Offline tests use real pinned native Codex and OpenAI SDK transports against fake
HTTP responses, and the installed Grok 1.5.2 bridge against the same kind of boundary.
They verify exact 401/403/429/503 observations, preserved `Retry-After`, one HTTP
attempt, header/body isolation, request-local response scope and callback-only
providers. Runtime→service→browser/terminal propagation is exercised independently
of rendering. `spikes/ui-provider-smoke.ts` runs a real SDK error through a journal
checkpoint and serves a disposable browser fixture without inference or credentials.

These tests verify the installed transport integration, not live account entitlement,
all possible provider APIs, adapter source fingerprinting or future SDK versions.
