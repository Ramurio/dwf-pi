# Информация о dynamicwf-pi

Пользовательские установка и команды — в [README](../README.md).
Здесь описана действующая реализация. Переносимый skill имеет собственные
[references](../skills/dynamic-workflows/SKILL.md), чтобы работать без checkout.

## Начать здесь

- [Архитектура и модули](architecture.md)
- [Разработка, тесты и SDK patch](development.md)
- [Важные ошибки и ограничения](known-issues.md)
- [Эксперименты и отложенные направления](experiments.md)

## Сборка и запуск графа

| Документ | Содержание |
| --- | --- |
| [Граф](graph-contract.md) | Узлы, связи, выражения, роли |
| [Authoring](authoring.md) | Atomic patches, revision, валидация |
| [Компилятор](compiler.md) | Генерация TS + Effect и scopes |
| [Execution plan](execution-plan.md) | Frozen models/tools/skills и проверка |
| [Prepared start](prepared-start.md) | Идемпотентная доставка запуска |
| [CLI/service](service.md), [MCP](mcp.md) | Публичный интерфейс |
| [Установка](setup.md), [doctor](doctor.md), [native xAI](grok-provider.md) | Среда, модели и диагностика |
| [Пресеты](presets.md), [пример council](examples.md) | Повторное использование |

## Исполнение и восстановление

| Документ | Содержание |
| --- | --- |
| [Журнал и владение](run-journal.md), [pi worker](pi-worker.md) | Процессы, checkpoints, output, cancellation |
| [Исходы и ожидания](outcomes-and-waits.md) | accepted/rejected/inconclusive и await |
| [Worktrees и integrate](workspaces.md) | Git-изоляция и слияние |
| [Reconciliation](reconciliation.md), [история попыток](attempt-history.md) | Неопределённые эффекты и доказанное восстановление |
| [Продолжение задачи](../skills/dynamic-workflows/references/continuation.md) | Новый связанный план и reuse |
| [Retry](retry-policy.md), [output repair](output-repair.md) | Разные виды повторов |
| [Collect](collection-policy.md), [ошибки](execution-failures.md) | Независимые ветки и классификация отказов |
| [Provider responses](provider-responses.md) | Наблюдаемые HTTP-ответы |
| [Read boundaries](read-boundaries.md), [SQLite backup](sqlite-backup.md) | Доступность материалов и согласованные снимки |

## Наблюдение

[Браузер](browser-ui.md) · [Watch](watch.md) · [Общая проекция](observation.md) ·
[Фактические переходы](routing-trace.md) · [Usage](usage.md).

Исторические планы, разовые QA-отчёты, campaign logs и исследования не входят
в текущую документацию. Их можно найти в Git history; действующие ограничения
сохранены здесь. Старый зелёный лог доказывает только свой snapshot.
