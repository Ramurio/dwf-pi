# Pi SDK 0.85.0: детерминированный runtime spike

Дата: 2026-09-08. Исполняемый источник: [`spikes/pi-contract.test.ts`](../../spikes/pi-contract.test.ts).

Это **реальные `createAgentSession`, Agent loop, resource loader, tool execution и session events** из `@earendil-works/pi-coding-agent@0.85.0`. Только model transport заменён детерминированным `ModelRuntime.registerProvider(..., { streamSimple })`: он возвращает заранее заданные protocol events. Это не live inference и не продуктовый pi adapter.

## Воспроизведение и результат

```sh
npm ci
node --import tsx --test spikes/pi-contract.test.ts
npm run typecheck
```

13 tests passed, 0 failed, 0 cancelled; тестовый файл занимает около 0.8 s на текущей машине. Отдельная проверка файла через `tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --skipLibCheck --types node spikes/pi-contract.test.ts` проходит. Общий typecheck проекта проверяется отдельно при интеграции параллельных изменений. Node выводит upstream deprecation warning для `module.register()`; тесты не подавляют его.

В установленной версии публичный import coding-agent требует дополнительный `@earendil-works/pi-server@0.85.0`: без него корневой probe обнаружил `ERR_MODULE_NOT_FOUND` в `experimental/server.js`. Прямой pin в проекте — workaround packaging, не требование нашего workflow API.

## Что доказано запуском

| Контракт | Наблюдаемое поведение |
| --- | --- |
| Resource isolation | `DefaultResourceLoader` с `noExtensions`, `noSkills`, `noPromptTemplates`, `noThemes`, `noContextFiles`, явным system prompt и пустым append prompt не загружает подложенные project/global `AGENTS.md`, project `SYSTEM.md`/`APPEND_SYSTEM.md`, project skill и extension, который бросил бы exception. Extensions/errors, skills, context files пусты; effective prompt не содержит poison markers. |
| Allowlist | `tools: ["submit_result"]` вместе с `customTools` предоставляет ровно один инструмент во всех запросах модели. Поддельный вызов `bash` возвращает `Tool bash not found` без запуска builtin. |
| Structured result | Actual custom `submit_result` получает валидные TypeBox arguments и сохраняет результат. SDK затем делает ещё один model turn, если не настроить явную политику завершения. |
| Strict raw contract | `prepareArguments` + TypeBox `Check` отклоняет missing required field, неверный enum, extra property, пустой summary и `score: "9"` до вызова `execute`. |
| SDK coercion | **Один TypeBox schema недостаточен для строгой проверки исходных данных.** Без `prepareArguments` SDK принимает строку `"9"` и передаёт `execute` число `9`. Причина: `validateToolArguments` вызывает `Value.Convert` до проверки. |
| Settlement | Если async subscriber на `session.agent` удерживает `agent_end`, session остаётся busy и `agent_settled` ещё отсутствует. После release, `prompt()` и `waitForIdle()` завершаются, `agent_settled` приходит ровно один раз после `agent_end`. |
| Missing output | Обычный ответ текстом, даже если это JSON нужной формы, не вызывает `submit_result`. При этом session успешно settles. Workflow обязан проверять наличие contract output самостоятельно. |
| Invalid output | Ошибка `submit_result` становится error tool result; последующий текстовый ответ может завершить session. `agent_settled` не означает валидный workflow output. |
| Repeated output | Pi допускает два успешных вызова `submit_result` в одной session. Exactly-one policy и выбор поведения при повторе принадлежат workflow runtime. |
| Cancellation with clearing | `session.clearQueue()` возвращает обе очереди и очищает session/agent queues. Если затем вызвать `await session.abort()`, fake transport получает abort, session settles и queued prompts не исполняются и не попадают в следующий запрос. |
| Cancellation without clearing | **`session.abort()` сам по себе не отменяет ожидающую followup работу.** В тесте он abort-ит первый запрос, затем session запускает queued followup как второй model call. Для отмены worker необходимо закрыть приём новых сообщений, очистить очереди и только после этого abort/settle. |
| Separate workers | Две созданные и запущенные параллельно session имеют разные session IDs, независимые transcripts и результатные коллекции. Маркеры первого worker отсутствуют во втором и наоборот. |

## Изоляция тестового окружения

Каждый test использует временные `cwd`/`agentDir`, `SessionManager.inMemory`, `SettingsManager.inMemory`, `InMemoryCredentialStore`, `InMemoryModelsStore`, `modelsPath: null`, `allowModelNetwork: false`, `refreshOnCreate: false`. Provider уникального тестового имени имеет явно fake credential и URL в `.invalid`; запросы обслуживаются локальной функцией. Реальные auth files не читаются; live provider transport не вызывается. Auto-compaction, retries, analytics и install telemetry выключены. После теста session abort/dispose и временные файлы удаляются.

## Выводы для будущего adapter

1. Создавать worker через явные session/resources/settings/model runtime параметры; не полагаться на default discovery.
2. Contract tool обязан проверять **raw** arguments до coercion. После settlement runtime проверяет ровно один валидный результат, отдельно от stop reason и transport errors.
3. Для hard cancellation порядок: запретить новые входящие prompts → `clearQueue()` → `await abort()`/`waitForIdle()` → dispose. Текущий spike доказывает значение первых API операций, но не реализует конкурентный admission gate.
4. Для событий UI `agent_end` означает окончание agent loop, `agent_settled` — окончание session continuation. Нельзя публиковать terminal worker success раньше settlement и contract validation.
5. Public mutable hook в 0.85.0 называется `agent.streamFunction`; старое предполагаемое имя `streamFn` не является полем Agent. Здесь использован provider registration, чтобы проверить и model runtime path.

## Ограничения доказательства

Не проверены качество или совместимость реальной модели, OAuth, реальная сеть, token accounting, crash recovery, compaction/retry continuations, filesystem/OS sandbox, malicious extensions, worktree isolation, concurrent queue-admission race, kill зависшего транспорта и process isolation. Tool allowlist — ограничение доступных tools, не OS sandbox. Изолированные in-memory transcripts не доказывают изоляцию двух процессов, памяти ОС или общего рабочего дерева. Доказательство `agent_settled` здесь включает delayed core event subscriber при выключенных compaction/retry; эти дополнительные continuation paths требуют собственных integration tests.
