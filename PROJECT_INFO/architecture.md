# Архитектура и карта модулей

## Путь задачи

```text
Skill / CLI / MCP → WorkflowService → draft → validate → compiler
                                            ↓ prepare
                              immutable ExecutionPlan + preparedId
                                            ↓ start
                       RunController → detached supervisor
                                            ↓
                         Effect graph → pi/check worker processes
                                            ↓
                           SQLite journal → UI / watch / recovery
```

Клиенты описывают граф данными; TypeScript + Effect генерируется машинно.
Draft можно редактировать, а план запуска фиксирует граф, конкретные модели,
thinking, tools, prompts, skills, схемы вывода и generated source/hash.
`cwd` канонизируется, но живые файлы и Git HEAD подготовка не замораживает.

Supervisor живёт отдельно от harness; workers получают собственные процессы
и сессии. SQLite WAL/FULL хранит владельца, активации, checkpoints, исходы, waits,
usage и историю решений. Панель и watch читают одну проекцию состояния.

## Ответственность модулей

| Модули в `src/` | Назначение |
| --- | --- |
| `graph`, `expressions`, `catalog`, `authoring`, `public-schema`, `store` | Схема, роли, атомарное редактирование drafts |
| `compiler`, `compiler-versions`, `generated-module`, `runtime-contract` | Генерация и исполнение версионированного графа |
| `execution-plan`, `execution-types`, `prepared-plans` | Подготовка, проверка и идентичность плана |
| `run-controller`, `supervisor`, `run-runtime`, `run-store`, `sqlite` | Запуск, владение, gate, durable journal |
| `pi-worker`, `pi-worker-process`, `check-worker-process`, `process-client`, `process-groups` | Изоляция invocation, IPC, остановка и потомки |
| `model-runtime`, `capabilities`, `adapter-identity`, `image-boundary` | Каталог и доступные возможности конкретного маршрута модели |
| `sdk-auth-storage`, `credential-persistence`, `request-observation`, `provider-response` | Авторизация, отмена refresh и наблюдение запросов |
| `output-schema`, `output-repair`, `retry-policy`, `execution-failure` | Строгий вывод, ремонт формата, разрешённые повторы и ошибки |
| `operation-record`, `recovery-files`, `recovery-inspection`, `reconciliation` | Доказательства внешних действий и явное восстановление |
| `lineage`, `workspaces`, `collection`, `task-outcome`, `usage`, `presets` | Продолжения, Git, сбор результатов, итог, токены и пресеты |
| `service`, `cli`, `mcp`, `mcp-tools`, `doctor` | Общий интерфейс и диагностика |
| `observation`, `monitor`, `terminal`, `watch`, `dashboard`, `graph-view/` | Общая проекция, терминал и браузер |

## Почему так

- Один service для CLI/MCP предотвращает разные правила запуска у разных harness.
- Неизменный план позволяет проверить, какие инструкции и настройки исполнялись.
  Динамический map/цикл меняет число активаций, а не топологию плана.
- Owner tokens ограждают журнал от поздних записей старого supervisor.
  Идентичность запуска хранится в журнале, не выводится из пути наблюдателя.
- Pause прекращает допуск новой работы и дожидается листьев; cancel — отдельное
  действие. Успешные checkpoints при resume не выполняются повторно.
- Внешние эффекты нельзя сделать exactly-once одной транзакцией SQLite:
  после неопределённого результата нужны доказательства и reconciliation.
- Worktree изолирует параллельные изменения Git; integrate явно сливает принятые
  commits. Конфликт и dirty target не считаются успешным слиянием.
- Fresh reviewer не наследует переписку исполнителя; approve связан с реальной
  artifactRevision и criteria revision. Финальный accepted задаётся графом.
- SDK retries отключены; политика повторов описана явно и учитывает эффекты.
  Исправление формата ответа в той же сессии не равно повтору побочного действия.
- Permission profiles ограничивают инструменты, но не права ОС. In-process pool
  остаётся [экспериментом](experiments.md), а production использует отдельные workers.

[Контракты и подробные документы](README.md).
