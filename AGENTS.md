# dynamicwf-pi: ориентир для агента

Dynamicwf — локальный runtime графовых агентных workflow на TypeScript + Effect
с независимыми pi workers, SQLite-журналом, CLI/MCP и браузерной панелью.
Пользовательский вход — [README](README.md); подробности — в
[PROJECT_INFO](PROJECT_INFO/README.md). Начните с [архитектуры](PROJECT_INFO/architecture.md)
и [разработки](PROJECT_INFO/development.md).

## Карта проекта

- `src/graph.ts`, `authoring.ts`, `expressions.ts`, `compiler.ts`: схема и компиляция.
- `src/execution-plan.ts`, `prepared-plans.ts`: замороженные настройки и адресуемые планы.
- `src/run-controller.ts`, `supervisor.ts`, `run-runtime.ts`, `run-store.ts`: процессы и журнал.
- `src/pi-worker.ts`, `pi-worker-process.ts`, `process-client.ts`: SDK и worker IPC.
- `src/recovery-*`, `reconciliation.ts`, `lineage.ts`, `workspaces.ts`: восстановление и Git.
- `src/service.ts`, `cli.ts`, `mcp*.ts`, `dashboard.ts`, `graph-view/`, `watch.ts`: интерфейсы.
- `skills/dynamic-workflows/`: переносимый пользовательский skill с собственными references.
- `tests/`: регрессии; `spikes/`: воспроизводимые probes/эксперименты, не production scheduler.
- `patches/`, `scripts/`: проверенный локальный SDK patch и установка.

## Проверки и инварианты

- `npm ci`, `npm run typecheck`, `npm test`. Node >=22.19.0; зависимости закреплены lockfile.
- Postinstall применяет tracked Bash-signal patch к SDK 0.85.1; при `--ignore-scripts`
  выполните `node scripts/apply-sdk-bash-signal.mjs`. Не редактируйте node_modules вручную.
- Граф — артефакт оркестрации. При использовании workflow следуйте
  [skill](skills/dynamic-workflows/SKILL.md): prepare → start с idempotency key,
  сразу сообщить run ID, не создавать новый run из-за таймаута наблюдения.
- Не добавляйте скрытые budgets, iteration/concurrency caps или approval gates.
- `succeeded` не равно `accepted`; ревью связывается с реальной версией артефакта.
- Не повторяйте неопределённые side effects без явного reconciliation. Owner/worker
  identity проверяется по процессам; heartbeat или PID сами по себе недостаточны.
- Credentials остаются в SDK. Не ослабляйте no-retry, input validation и tool boundaries.
- Сессии workers не подхватывают проектный AGENTS автоматически: нужные инструкции
  передаются явно в task/input или frozen skill. Worktree — не OS sandbox.
- Документы о действующем проекте держите в PROJECT_INFO; README — для пользователя.
  Логи, отчёты отдельных запусков, auth и временные artifacts не коммитьте.
- Важные ошибки/границы и тесты записаны в [known-issues.md](PROJECT_INFO/known-issues.md).
  Соседний remote-pi меняйте только по относящейся к нему задаче.
