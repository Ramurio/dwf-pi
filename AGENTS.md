# dynamicwf-pi: ориентир для агента

Dynamicwf — локальная среда исполнения графовых агентных процессов на TypeScript + `Effect`
с независимыми исполнителями pi, SQLite-журналом, CLI/MCP и браузерной панелью.
Пользовательский вход — [README](README.md); подробности — в
[PROJECT_INFO](PROJECT_INFO/README.md). Начните с [архитектуры](PROJECT_INFO/architecture.md)
и [разработки](PROJECT_INFO/development.md). В индексе 15 тематических документов;
[граф/компилятор](PROJECT_INFO/graph-contract.md), [CLI/MCP](PROJECT_INFO/service.md) и
[план/запуск](PROJECT_INFO/execution-plan.md) описывают текущие публичные контракты.

## Карта проекта

- `src/graph.ts`, `authoring.ts`, `expressions.ts`, `compiler.ts`: схема и компиляция.
- `src/execution-plan.ts`, `prepared-plans.ts`: зафиксированные настройки и адресуемые планы.
- `src/run-controller.ts`, `supervisor.ts`, `run-runtime.ts`, `run-store.ts`: процессы и журнал.
- `src/pi-worker.ts`, `pi-worker-process.ts`, `process-client.ts`: SDK и обмен сообщениями с исполнителем.
- `src/recovery-*`, `reconciliation.ts`, `lineage.ts`, `workspaces.ts`: восстановление и Git.
- `src/service.ts`, `cli.ts`, `mcp*.ts`, `dashboard.ts`, `graph-view/`, `watch.ts`: интерфейсы.
- `skills/dynamic-workflows/`: переносимый пакет инструкций с собственными справочными материалами.
- `tests/`: регрессии; `spikes/`: воспроизводимые проверки и эксперименты, не рабочий планировщик.
- `patches/`, `scripts/`: проверенное локальное исправление SDK и установка.

## Проверки и инварианты

- `npm ci`, `npm run typecheck`, `npm test`. Node >=22.19.0; зависимости закреплены в lockfile.
- Скрипт postinstall применяет сохранённое в Git исправление `bash`-сигналов к SDK 0.85.1.
  При `--ignore-scripts` выполните `node scripts/apply-sdk-bash-signal.mjs`.
  Дополнительно `node scripts/apply-sdk-provider-contracts.mjs` сохраняет отсутствие
  скрытых Bedrock-повторов и происхождение usage. Оба скрипта входят в postinstall.
  Не редактируйте node_modules вручную.
- Граф — артефакт оркестрации. Следуйте [skill](skills/dynamic-workflows/SKILL.md):
  подготовка → запуск с ключом идемпотентности; сразу сообщайте ID запуска.
  Таймаут наблюдения не разрешает создать дубликат.
- Не добавляйте скрытые бюджеты, лимиты итераций/параллелизма или этапы согласования.
- `succeeded` не равно `accepted`; ревью связывается с реальной версией артефакта.
- Не повторяйте неопределённые внешние действия без явного разрешения восстановления.
  Владельца и исполнителей проверяют по идентичности процессов; heartbeat или PID недостаточно.
- Учётные данные остаются в SDK. Не ослабляйте запрет скрытых повторов, проверку входа
  и ограничения доступа к инструментам.
- Сессии исполнителей не загружают проектный AGENTS автоматически: нужные инструкции
  передаются явно в задании/входных данных или зафиксированном skill. `worktree` — не изоляция ОС.
- Документы о действующем проекте держите в PROJECT_INFO; README — для пользователя.
  Логи, отчёты отдельных запусков, секреты и временные артефакты не коммитьте.
- Важные ошибки/границы и тесты — в [known-issues.md](PROJECT_INFO/known-issues.md).
  Соседний remote-pi меняйте только по относящейся к нему задаче.
