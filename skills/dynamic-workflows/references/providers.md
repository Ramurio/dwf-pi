# Providers, catalog, and thinking

Read this when choosing models, diagnosing local prerequisites, or interpreting capabilities and thinking. The model in the caller's harness does not determine the pi worker's model. Explicit node provider/id/thinking is not silently substituted.

## Catalog and doctor

Inspect the actual interface with `catalog.list`, `catalog.describe {"name":"reviewer"}`, and `catalog.models {}`. Prefer concrete available provider/model identifiers; product subscription names are not model IDs. An explicitly unavailable model/thinking configuration is an error, not permission to silently downgrade.

`system.doctor {}` diagnoses local prerequisites without inference. It does not run models.

Grok uses pi's built-in `xai` provider, authenticated through `/login xai` → **Use a subscription**. Use `xai/grok-4.6` when present in the catalog; no `pi-xai-oauth` plugin is required. `catalog.models {"refresh":true}` explicitly refreshes the native xAI catalog. Ordinary startup stays cache-only. A listed model is not proof of account entitlement to every request.

The retired `xai-auth` provider is not silently aliased. Historical frozen runs remain readable but require an explicit continuation to change provider; inspect partial effects before resuming work.

## Capabilities and modalities

Treat raw model input separately from effective workflow input/tool-result capabilities (`supported` / `unsupported` / `unknown`). Missing modality metadata is unknown, not denial. Model-advertised vision does not certify the active adapter or tool route.

Optional `config.requirements` with `inputModalities` / `toolResultModalities` make prepare reject unknown or unsupported image needs. Ordinary text workflows need no extra ceremony.

## Thinking: requested, resolved, observed

Native image ability, current transport/tool support, configured thinking, and observed payload reasoning are distinct. Do not relabel `xhigh` as `high`. There is no silent `xhigh` downgrade.

An explicit thinking value must be supported by the chosen model or prepare fails. Role defaults may adapt thinking only when you did not set it; after prepare, the resolved value is frozen. Observed provider thinking on a payload is evidence of that request, not a license to rewrite the configured value.

## Credentials and adapter boundaries

Worker models and authentication come from the local provider setup, independently of the calling harness. Installing the command or skill does not turn a chat subscription name into an API model or transfer credentials between products.

No credential enters the graph, worker request, or public model catalog. Adapter identity, version, and content checks belong to the runtime boundary; missing or unsupported optional adapters produce catalog diagnostics and do not silently select a different provider. An explicitly requested adapter that cannot load fails; it is not replaced by another product.
