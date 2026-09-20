# Grok through native pi xAI OAuth

Dynamicwf uses pi's built-in `xai` provider. No `pi-xai-oauth` extension or custom
transport bridge is loaded. Authenticate in pi with `/login xai` → **Use a subscription**.
For Grok 4.6 configure `{ "provider": "xai", "id": "grok-4.6" }`; `xhigh` and image
capabilities come from the installed native pi catalog. `catalog.models {}` shows
credential-backed available models; `catalog.models {"refresh":true}` explicitly
refreshes the native xAI catalog. Ordinary startup remains cache-only.

The worker uses the same native provider as pi. Its frozen tool allowlist,
`submit_result` contract, session continuation, image guards and usage accounting
remain in force. Serialized native xAI reasoning effort is observed at the fetch
boundary; configured thinking is not substituted for observed effort.

The retired provider ID `xai-auth` is not an alias for `xai`. Old runs and their
frozen plans remain readable, including historical adapter identities. Executing
an old worker fails before dispatch with migration guidance. To continue a failed
task with the new provider, author an explicit continuation after inspecting any
partial writes; do not alter the original plan or blindly repeat its effects.

Offline verification: `tests/native-xai.test.ts` and `tests/repair-core.test.ts`
exercise native catalog discovery, Responses tool calls, PNG/JPEG transport,
resizing, xhigh payloads, continued sessions, capability drift and HTTP failure
accounting without an installed extension. `npm run test:repair:live` makes real
native xAI calls using temporary image fixtures and publishes sanitized evidence
under `scratch/repair-live-latest.json` by default.
