# Состояние работы

2026-09-08: завершены исследование, технические probes и первое ядро authoring/codegen.
Ответы пользователя сохранены в [decisions.md](decisions.md); ожидать анкету больше не нужно.

## Что работает и чем проверено

- Исследованы официальные Claude Code Dynamic workflows, девять движков/подходов,
  pi SDK/RPC и переносимость; первичные ссылки в `docs/research/`.
- Pinned npm зависимости и lockfile; pi public import packaging workaround
  `@earendil-works/pi-server@0.85.0` объявлен явно.
- TypeScript graph contract, девять ролей, structured reviewer verdict с revision.
  Строгие schemas, семантическая проверка, циклы, nested graph refs, immutable snapshots.
- Expression AST без eval; явные bindings, boolean routing, ordered conditions/fallback.
- Authoring операции create/add/replace/remove/connect/disconnect/setEntry; atomic patch,
  revision guard; незавершённые drafts сохраняются с отдельной validation.
- SQLite draft storage с CAS. CLI работает между процессами; 24 concurrent first opens
  проверяют WAL/schema initialization. `busy_timeout` установлен до WAL pragma.
- Компилятор выдаёт actual TS+Effect while/switch/forEach, а не runGraph wrapper.
  Сгенерированные модули проходят strict TypeScript и выполняются в тестах: review loop,
  nested map/parallel/subworkflow, scope/visit identity, input-order и data/code separation.
- Pi SDK offline probes используют actual session/tool loop и fake transport.
  Доказаны clearQueue-before-abort, raw schema validation, settlement и изоляция ресурсов.
- Live pi `openai-codex/gpt-5.6-sol`: один валидный submit_result, низкий thinking,
  settlement и повторное открытие transcript. Повторять без новой причины не нужно.
- Effect memory-engine probes выявили replay behavior и отсутствие немедленной отмены
  активной activity; memory engine не выбран как durable backend.

Команды проверки: `npm run typecheck`, `npm test`. Реальный model call — отдельный
`npm run probe:pi -- --provider ... --model ...`, не часть обычного тестирования.
Последний полный запуск: typecheck прошёл; 62 tests passed, 0 failed, 0 skipped.
Проверены локальные Markdown-ссылки и `git diff --check`.

## Оставшаяся работа — полный объём цели

1. Замороженный execution plan: model resolution, role/skill snapshots, output-schema
   subset validation, permissions; compile должен ссылаться на fixed runtime/catalog версии.
2. Workflow runtime: отдельный supervisor process, журнал run/activations/events,
   pi worker processes, pause/pausing/resume/cancel; восстановление без слепого повтора
   неопределённых внешних эффектов. `runtime-contract.ts` пока только интерфейс.
3. Настоящий pi backend compiled graphs: strict submit_result exactly once, isolated
   resource loader, session policy, actual errors/usage, abort queues и process cleanup.
4. Grok subscription adapter: есть OAuth metadata и установленный pi-xai-oauth@1.5.2,
   но native ModelRuntime не регистрирует alias xai-auth автоматически. См. grok-integration.
   Нужен provider-only bridge в отдельном worker; shared global fetch state учитывать.
5. Worktree policy и integration step для параллельных writers; council как композиция
   ролей/графа с настройкой policy и привязкой verdict к проверенной версии.
6. Presets: глобальные/проектные, snapshots содержимого, сохранение успешного run,
   новые inputs без копирования credentials/транскрипта в шаблон.
7. Общий application service для CLI/MCP (сейчас CLI напрямую dispatch), переносимый
   skill, setup/doctor и запуск из внешнего cwd. Generated imports пока проверены под
   project package scope: resolver для глобальной runs directory ещё нужен.
8. Terminal watch реального event stream и схема со всеми активными ветками.
9. Полный live сценарий author→run→pause→resume→review-loop→save preset→rerun через
   два клиента; проверка требований по фактическим результатам.

По умолчанию не добавлять лимиты или human approvals. Граф фиксирован до запуска;
ручное редактирование работающего графа не нужно. Oracle — отдельный проект.

## Следующее действие

Продолжать с execution plan и журналируемого runtime под уже имеющийся generated
contract. Изучить current sources/tests, не начинать исследование заново. Сначала
замкнуть один настоящий worker→review loop и независимость от harness, затем
добавлять preset/MCP/watch на ту же модель состояния. Цель остаётся активной.
