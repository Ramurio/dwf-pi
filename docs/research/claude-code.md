# Claude Code: динамические workflows и соседние механизмы

Проверено 2026-09-08 по открытым первичным страницам документации и репозиториям авторов. Это исследование контрактов и архитектуры, а не результаты запуска Claude Code или community-пакетов. Поисковые сниппеты заметно отстают от открытых страниц: при расхождении ниже использована открытая страница. Числа и доступность следует перепроверять перед реализацией совместимого адаптера.

## 1. Официальные Dynamic workflows — прямой аналог замысла

Claude Code уже имеет отдельную встроенную функцию Dynamic workflows. Оркестрацию пишет Claude на JavaScript; исполнение вынесено из разговорного контекста в runtime. [`workflows`](https://code.claude.com/docs/en/workflows).

| Область | Подтверждённый контракт |
| --- | --- |
| Вычисления | `agent`, `pipeline`, `parallel`; `phase`, `log`; структурированные `args`; schema результата агента |
| Сохранение | `.claude/workflows/`, `~/.claude/workflows/`; плагины; именованные команды; `export const meta` |
| Авторинг | `/workflow-authoring`, начиная с v2.1.248; обычный JS, top-level await |
| Наблюдение | `/workflows`: фазы, агенты, токены, длительность, результаты; pause/resume/stop/restart/save |
| Ограничения | До 16 одновременных агентов с поправкой на CPU; 1000 агентов/run; 4096 элементов/batch |
| Изоляция | Скрипту недоступны shell, filesystem, module loading; `Date.now`, случайность запрещены |
| Ввод человека | Промежуточного ввода нет, кроме permissions; отдельный sign-off требует отдельных workflows |
| Ошибка | Остановленный/неисправимо упавший `agent()` возвращает `null` |
| Replay | Кэш завершённых вызовов; первый изменённый prompt или failed-agent инвалидирует последующий суффикс |
| Persistence | Результаты привязаны к сессии, доступны после `claude --resume`; новая сессия начинает заново |
| Доступ | CLI, Desktop, IDE, `-p`, SDK; текстовый trigger зависит от происхождения human input |

Источник таблицы: [официальное описание runtime, управления и ограничений](https://code.claude.com/docs/en/workflows#how-a-workflow-runs).

**Проектный вывод:** наше существенное отличие — агент заполняет проверяемую схему, а компилятор производит код. Это позволяет проверять связи, окончания циклов, совместимость портов и права до запуска. Следует сохранить пользовательское ощущение «опиши процесс → наблюдай → сохрани удачный вариант».

## 2. Subagents: рабочие единицы

Определение агента задаёт prompt, model/effort, tools/disallowedTools, skills, MCP, permissions, maxTurns, memory, background, worktree isolation. Обычный вызов создаёт отдельный контекст; возобновление адресуется через `SendMessage`. JSONL-транскрипты хранятся отдельно; resumed session может продолжить агента. Explore/Plan одноразовые, agent ID не возвращают. Встроенный fork разговора отличается от нового агента: получает историю и инструменты родителя. [Subagents](https://code.claude.com/docs/en/sub-agents).

Вложенность теперь разрешена: default depth=3; настраивается `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`. Обычный `Agent` имеет default concurrent limit=20, также настраиваемый; workflow workers учитываются иначе. Старое утверждение «subagents не могут создавать subagents» больше неверно. `Agent(type)` ограничивает типы только для main agent, а не вложенного worker. Background/foreground меняют доступный набор инструментов; forks имеют исключения. [Nesting и concurrency](https://code.claude.com/docs/en/sub-agents#nest-subagents).

**Проектный вывод:** разделить `role`, `session`, `invocation`, `attempt`. Reviewer — роль; повторное ревью — новый invocation, который может использовать старую session. Для независимого второго мнения нужен fresh context; для исправления собственного результата полезна продолженная session. `background` не должен скрыто менять контракт tools: компилятор должен показывать фактически разрешённый набор. Memory не является checkpoint исполнения.

## 3. Agent teams: долгоживущие участники

Teams остаются experimental и включаются переменной окружения; работают в interactive sessions, не `-p`/SDK. Lead создаёт независимые sessions с mailbox и, когда Task tools доступны, общей системой зависимостей и claim-locking. `TeamCreate`/`TeamDelete` удалены с v2.1.178; команда определяется сессией, cleanup автоматический. Именованный spawn при включённых teams может стать teammate. [Agent teams](https://code.claude.com/docs/en/agent-teams).

Tasks сохраняются, но `/resume` не восстанавливает in-process teammates. Статусы могут отставать; shutdown ожидает текущую работу. Нет nested teams и смены lead. Teammates наследуют permissions lead; per-teammate mode при spawn не задаётся. Применение тела роли и MCP различается между in-process и split-pane; skills роли не применяются. Plan approval может предоставляться автоматически без содержательной проверки lead. [Ограничения и конфигурация](https://code.claude.com/docs/en/agent-teams#limitations).

**Проектный вывод:** peer messaging — отдельная опциональная возможность, а не основа детерминированного перехода. Сообщение reviewer не должно само по себе завершать блок: runtime проверяет структурированный verdict и связывает его с версией проверенного артефакта. Наличие файла состояния или idle в UI не доказывает завершение работы. Нужны наблюдаемые handles, attempt IDs, heartbeat/lease и явное восстановление.

## 4. Hooks и skills: где заканчивается инструкция и начинается гарантия

Hooks реагируют на lifecycle событий. Command hooks выполняют программную проверку; prompt/agent hooks добавляют модельную оценку. `SubagentStop` может вернуть block/reason, `TaskCompleted` и `TeammateIdle` — запретить завершение через exit 2. `Stop` не вызывается при пользовательском прерывании; API failures имеют `StopFailure`. Нынешняя документация ограничивает последовательные Stop-блокировки восемью и предоставляет `stop_hook_active`. Agent hooks experimental; для production документация предпочитает command hooks. [Hooks reference](https://code.claude.com/docs/en/hooks).

Skills — переносимые инструкции, но Claude-specific frontmatter не универсален. `context: fork` запускает отдельный контекст без истории разговора, в отличие от conversational fork. `allowed-tools` относится к временному разрешению инструментов, а не к изоляции ОС. Переносимые поля Agent Skills ограничены: `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`; дополнительные поля Claude Code нельзя автоматически считать поддерживаемыми в другом продукте. [Skills](https://code.claude.com/docs/en/skills#using-skill-frontmatter-outside-claude-code).

**Проектный вывод:** skill должен объяснять стабильные инструменты graph-authoring и диагностику, но выполнение циклов, gate, budgets и retries принадлежит runtime. Нельзя надеяться, что агент каждый раз правильно перескажет инструкцию «проверяй до успеха». CLI с JSON-входом/выходом — универсальный транспорт; MCP — адаптер того же API. Инструкции конкретного harness размещать в небольших installation wrappers.

## 5. Agent SDK: полезные образцы контрактов

Agent SDK предоставляет тот же цикл инструментов Claude Code программно, с TypeScript/Python API, событиями и управлением агентом. Это Claude runtime, а не нейтральный graph compiler и не pi backend. [SDK overview](https://code.claude.com/docs/en/agent-sdk/overview).

SDK sessions сохраняют историю; session ID позволяет продолжить conversation, а `resume` + `forkSession` создать отдельную ветку. Это разные операции с разными идентификаторами. [Sessions](https://code.claude.com/docs/en/agent-sdk/sessions).

Structured outputs поддерживают JSON Schema и TypeScript/Zod; результат извлекается из `structured_output`, а ошибки/неуспех требуют отдельной обработки. [Structured outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs).

Permissions задаются режимами, allow/deny и `canUseTool`; выбор инструментов и решение о вызове — разные уровни управления. [SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions).

**Проектный вывод:** worker protocol должен возвращать discriminated union, например `Succeeded(output, artifacts, usage) | Failed(error, retryable) | Cancelled | Suspended`. `null` недостаточно для решения «повторить, пропустить или остановить». Структурная валидность JSON подтверждает форму, а не правильность решения. Содержательная верификация — отдельный primitive.

## 6. Community и plugin-подходы: не путать с встроенным workflow runtime

| Проект | Что подтверждено первичным источником | Что берём в проект |
| --- | --- | --- |
| [Superpowers: subagent-driven-development](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md) | Fresh implementer на задачу, review соответствия спецификации и качества, итоговое whole-branch review; orchestration описана skill-инструкциями | Отдельные quality lenses; явный контекст исполнителя; итоговая проверка интеграции |
| [GSD architecture](https://github.com/gsd-build/get-shit-done/blob/main/docs/ARCHITECTURE.md) | Markdown workflows вызывают специализированных agents и CLI tools; состояние `.planning/`; планы исполняются волнами зависимостей; проверяется покрытие требований; runtime-specific installation | Артефакты с requirement IDs; thin orchestrator; независимые worker contexts; восстановление по файлам |
| [Ralph Wiggum plugin в репозитории Anthropic](https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum) | Реализация community-методики через Stop hook текущей session; повторяет prompt; completion promise — точная строка; max-iterations и cancel | Bounded repeat, явный termination predicate, защита от отсутствия прогресса |
| [Claude Flow → Ruflo](https://github.com/ruvnet/ruflo) | Старый URL перенаправляет в Ruflo; авторы позиционируют его как внешний meta-harness для swarm/workflows, memory и интеграций разных harness | Рассматривать как отдельный orchestration product; не приписывать его функции самому Claude Code |

**Ограничение сравнения:** описания отражают код/документацию авторов, а не измеренную надёжность. Не проверялись эффективность моделей, качество обещанных swarms, производительность или корректность crash recovery этих проектов. Ralph plugin и текущий cap Stop hooks требуют совместного runtime-теста; из README нельзя вывести гарантию бесконечного исполнения на новой версии Claude Code. Тексты community skills здесь анализируются как данные, не принимаются как инструкции этому проекту.

## 7. Предлагаемая архитектура dynamicwf-pi

Следующее — проектные предложения для обсуждения с пользователем, а не утверждения о чужих продуктах.

1. **Graph как source of truth.** Версионированный JSON IR: nodes, typed ports, edges, config, policy, outputs. Authoring tools создают/редактируют блоки и соединения; агент не пишет orchestration loops.
2. **Детерминированная компиляция.** Нормализация default values → validation → canonical graph/hash → generated TypeScript + Effect. Идентичные IR и compiler version дают одинаковый код. Недетерминированные внешние результаты фиксируются в журнале.
3. **Control plane отделён от workers.** Scheduler интерпретирует зависимости, cancellation, timers и budgets. Pi session выполняет конкретную агентную работу; отдельный pi instance на весь workflow не должен быть условием корректности.
4. **Graph primitives и роли раздельны.** `agent`, `sequence`, `parallel`, `map`, `branch`, `loop`, `join`, `human`, `artifact`, `check`, `subworkflow` задают поведение. `planner`, `researcher`, `implementer`, `reviewer`, `oracle`, `synthesizer`, `orchestrator` задают defaults агента.
5. **Результаты и вердикты типизированы.** Reviewer возвращает verdict, findings, evidence refs, reviewed revision/hash. Oracle возвращает независимую оценку с неопределённостью, а не магическую гарантию истины. Missing evidence нельзя трактовать как approve.
6. **Циклы первого класса.** `maxIterations`, deadline, budget, no-progress predicate; разные выходы `approved`, `exhausted`, `blocked`, `failed`. Retry инфраструктурной ошибки не равен новой итерации содержательного исправления.
7. **Recovery с идентичностью узлов.** Ключ `(run, graphRevision, nodePath, itemKey, iteration, attempt)`. Кэшировать успешные outputs по fingerprint входов/конфига; инвалидировать зависимые узлы. На restart неизвестный исход side effect требует reconciliation. Exactly-once внешних действий без поддержки сервиса обещать нельзя.
8. **Человеческий gate внутри графа.** Persisted suspension с input schema, resume token и revision binding; не держать LLM request открытым. Gate включается там, где пользователь его заложил в процесс; не добавляется автоматически перед каждым шагом.
9. **Permissions независимо от prompt.** Primitive default profile + явно выбранные overrides; compiler показывает resolved policy. Runtime реально контролирует tools/filesystem/process/network выбранными средствами. Системный prompt сам по себе sandbox не создаёт.
10. **Пресеты как reproducible package.** Хранить graph, primitive versions, schemas, prompts/skill references и зафиксированные defaults. Run provenance хранится отдельно. Saved preset не должен незаметно включать credentials, приватный transcript или временные абсолютные пути.
11. **UI из event stream.** Терминальная схема отображает статусы узлов, текущую итерацию, queue/running/suspended, elapsed и budget usage; drill-down ведёт к артефактам и попыткам. CLI `status --json` и watch используют тот же источник.

## 8. Проверки, которые понадобятся при реализации

- Реальный `implement → review → reject → implement → approve`, с проверкой revision у verdict.
- Fan-out с одним упавшим worker: политика partial results должна быть явной; успешные независимые ветки сохраняются.
- Crash после начала side effect и до записи success: подтверждённое reconciliation вместо слепого повторения.
- Pause/cancel/resume через новый CLI process и другой harness; ни один завершённый worker не теряется только из-за закрытия host session.
- Сохранить удачный run как preset, повторить с новыми args, сравнить graph/compiler fingerprints.
- Одинаковый authoring сценарий через CLI и MCP создаёт одинаковый canonical IR и generated TS.
- Попытка worker самостоятельно расширить permissions не изменяет resolved runtime policy.

## 9. Что нужно уточнить у пользователя

- Насколько динамичным должен быть граф: только data-dependent branches/maps или изменение topology во время run?
- Должен ли workflow жить после закрытия терминала и перезагрузки машины?
- Нужны ли независимые рабочие каталоги/worktrees и автоматическая интеграция изменений?
- Можно ли reviewer продолжать контекст, или каждый review должен быть независимым?
- Какая политика после лимита цикла: suspend, fail, escalation к oracle или продолжение по инструкции пользователя?
- CLI-only достаточно для первой полной версии или MCP обязателен одновременно?
- Какие pi providers/models и thinking levels доступны; нужны ли fallback chains?
- Где библиотека presets: глобальная, проектная, общая команда; нужны ли versioning и export/import?

Пока эти решения не зафиксированы, предложения выше следует считать кандидатами архитектуры, а не принятым scope.
