# Grok subscription: narrow provider integration review

2026-09-08. Read-only review локально установленного `pi-xai-oauth@1.5.2`, его `extensions/xai/{catalog,models,responses}.ts` и существующего `../remote-pi/lib/xai-adapter.mjs`. Реальные auth files не читались, live запросы не выполнялись, соседний проект не изменялся.

Self-contained bridge возможен без загрузки extension entrypoint, global tools или session hooks: зарегистрировать собственный native provider `xai-auth` в `ModelRuntime`, использовать native `xaiProvider().auth.oauth`, импортировать только reviewed catalog/models/transport helpers через изолированный jiti loader с pi compat shim. Auth resolution остаётся в runtime; секреты не попадают в graph definition.

Существующий narrow adapter показывает полезную политику: cache-only catalog initialization, authenticated refresh отдельно, `curated-fallback` не рекламируется как entitlement, aliases расширяют только authenticated catalog entries, общий runtime model snapshot устанавливается перед stream. Наличие OAuth credential/название подписки не доказывает доступность конкретной Heavy model: нужен реальный model ID из entitlement catalog.

Ограничения текущего пакета:

- Peer range `>=0.80.1 <0.85.0` явно исключает выбранный pi 0.85.0. Bridge требует собственного fake-fetch contract test, затем live probe; code inspection этого не доказывает.
- `responses.ts` временно меняет `globalThis.fetch` для URL-scoped redirect guard. Изменение reference-counted и восстанавливается после последнего stream, но всё равно process-global.
- `models.ts` хранит mutable module-level `runtimeModels`, общий для catalog и transport. Shared module instance не изолирует разные аккаунты/entitlements. Отдельный worker process или shim с отдельным provider state предпочтительнее общего singleton.
- `responses → images.ts` импортирует `resizeImage` из coding-agent; соседний shim предоставляет только `getAgentDir`. Text-only narrow path и image path нельзя считать равно проверенными.
- Старый transport не заполняет `providerThinkingLevel`; соседний adapter фиксирует фактически отправленный reasoning effort по сериализованному request payload. Указывать requested thinking вместо observed нельзя.

Вывод: перенос reviewed narrow provider — технически обоснованный следующий шаг; весь глобальный plugin загружать не требуется. Transport compatibility, Heavy entitlement и реальные ответы остаются отдельными непроведёнными проверками.
