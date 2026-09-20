# Разработка и проверки

Команды выполняются из корня репозитория. Нужны Node >=22.19.0, Git и POSIX-среда.
Точные версии SDK/Effect/TypeScript закреплены в `package.json` и `package-lock.json`.
`tsx` и TypeScript нужны в runtime для generated modules, поэтому это dependencies.

```sh
npm ci
npm run typecheck
npm test
```

`npm test` запускает `tests/*.test.ts` и `spikes/*.test.ts` с concurrency 4.
Это регрессии с реальным SDK, SQLite, временными Git-репозиториями и процессами,
но подставным inference. Они не требуют квот подписки. Смотрите skips и ограничения
конкретной среды. Тест выбора transition использует изолированный Chrome fixture;
прочитайте `tests/graph-transition-scope.test.ts` при диагностике браузера.

## Проверки по областям

| Область | Основные suites в `tests/` |
| --- | --- |
| Graph/authoring | `graph`, `authoring`, `compiler`, `public-patch-schema`, `council` |
| Plan/start | `execution-plan`, `prepared-start`, `service`, `mcp`, `skill-handoff` |
| Processes/journal | `run-controller`, `run-store`, `run-runtime`, `process-client`, `process-groups` |
| SDK/providers | `pi-worker`, `native-xai`, `image-boundary`, `capabilities`, `provider-response` |
| Recovery/Git | `recovery-inspection`, `reconciliation`, `continuation`, `allocation-recovery`, `git-recovery-crash`, `workspaces` |
| Usage/attempts | `usage-pages`, `attempt-history`, `task-usage` |
| UI | `dashboard`, `graph-view`, `graph-view-task-scope`, `graph-transition-scope`, `monitor`, `terminal` |

Названия в таблице — basename; запускайте нужные файлы через
`node --import tsx --test tests/<name>.test.ts`. Полный набор нужен после изменений
общих контрактов/процессов; для текста достаточно проверить ссылки и команды.

## Локальный SDK patch

Pi-coding-agent 0.85.1 может принять Bash exit с потерянным signal за успех.
`patches/pi-coding-agent-0.85.1-bash-signal.patch` и
`scripts/apply-sdk-bash-signal.mjs` исправляют waiter и Bash backend только внутри
локального `node_modules`. `npm ci` применяет patch через postinstall.
Если lifecycle scripts отключены, выполните:

```sh
node scripts/apply-sdk-bash-signal.mjs
```

Установщик требует точную версию и SHA256 исходных/исправленных файлов, проверяет
весь набор до записи и отказывается от неизвестного/смешанного состояния.
Не правьте глобальный SDK и не обходите проверку версии. При обновлении зависимости
сначала проверьте signal-регрессии на чистом upstream; только затем удаляйте patch,
установщик, postinstall и соответствующий lockfile metadata.
Проверки: `bash-signal`, `bash-signal-worker`, `pi-worker`, `process-client`.

## Явные probes

`spikes/` содержит воспроизводимые эксперименты и ручные UI fixtures, а не второй
scheduler. `npm run test:spikes` запускает только offline `*.test.ts`.
Live команды требуют доступной модели и тратят квоту:

```sh
npm run probe:pi -- --provider openai-codex --model MODEL_FROM_CATALOG
npm run probe:workflow -- --provider openai-codex --model MODEL_FROM_CATALOG
```

`npm run test:repair:live` — отдельный native xAI probe; по умолчанию пишет
игнорируемый `scratch/repair-live-latest.json`. Не запускайте его ради документации.
`npm run probe:sdk-clean-import` проверяет импорт SDK в чистой установке и может
потребовать сеть для установки пакетов. Результаты экспериментов и их границы —
в [experiments.md](experiments.md).

## Состояние и документация

Не храните credentials, SQLite journals, сырые логи, model transcripts, screenshots
и campaign packets в Git. Рабочее состояние — `$DYNAMICWF_HOME` / `~/.dynamicwf`;
локальные disposable результаты — игнорируемый `scratch/` или внешний каталог.
Не удаляйте живые worktrees, journals или пользовательские данные при уборке.

README — для пользователя, AGENTS — краткая карта агенту, PROJECT_INFO — контракты
и поддержка. При изменении поведения обновляйте профильный документ и
[known-issues.md](known-issues.md), если меняется важный инвариант.
Работающий dashboard загружает код при запуске: после runtime-обновления его
нужно перезапустить, сохранив настройки и адрес. Старые frozen runners не обновляются
из-за коммита в основной checkout.
