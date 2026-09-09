# dynamicwf-pi

Динамические агентные workflow на pi: агент собирает блоки и связи через инструменты,
а система проверяет схему и машинно генерирует исполняемый TypeScript + Effect.
Один переносимый skill объясняет интерфейс любому совместимому harness.

## Состояние

Работают графовый authoring, девять ролей, машинная генерация TS + Effect и отдельный
supervisor с pi workers. Есть условия, циклы, динамический fan-out, вложенные графы,
pause/resume/cancel, durable journal, CLI/MCP, переносимый skill, терминальный watch
и проектные/глобальные пресеты. `dynamicwf ui` запускает локальный браузерный
монитор с графом, историей, токенами и управлением запусками. Граф и настройки фиксируются до запуска; закрытие
клиента не останавливает выполнение.

Настоящий Codex прошёл review→repair→review с паузой и возобновлением из другого
клиента; Grok 4.6 проверен отдельным вызовом. Heavy ID не обнаружен в обновлённом
каталоге аккаунта. Поддержка локальная, POSIX; модель выбирается из реального pi
каталога. По умолчанию нет лимитов стоимости, итераций или обязательных согласований.

- [Требования и критерии приёмки](docs/requirements.md)
- [Вопросы и открытые решения](docs/questions.md)
- [Ответы пользователя и принятые решения](docs/decisions.md)
- [Разбор проекта и приоритеты развития — 2026-09-10](docs/project-review-2026-09-10.md)
- [Архитектурное предложение](docs/architecture-proposal.md)
- [Итоги и сравнительные исследования](docs/research/README.md)
- [Результаты реализации и проверок](docs/progress.md)
- [Контракт графа](docs/graph-contract.md), [операции authoring](docs/authoring.md), [компилятор](docs/compiler.md)
- [CLI/service](docs/service.md), [MCP](docs/mcp.md), [установка и skill](docs/setup.md)
- [Диагностика и модели](docs/doctor.md), [Grok provider](docs/grok-provider.md)
- [Браузерный интерфейс](docs/browser-ui.md), [Пресеты](docs/presets.md), [терминальный watch](docs/watch.md), [council из четырёх reviewers](docs/examples.md)
- [Execution plan](docs/execution-plan.md), [журнал](docs/run-journal.md), [pi worker](docs/pi-worker.md)
- [Git worktree и интеграция](docs/workspaces.md), [live coding-проверка](docs/workspaces-live.md), [live MCP council](docs/council-live.md)

## Проверить локально

Требуется Node >=22.19.0; текущая проверенная среда — Node 26.8.1.

```sh
npm ci
npm run typecheck
npm test
npm run setup
dynamicwf system.doctor
dynamicwf catalog.models
dynamicwf ui
```

Установка создаёт ссылки на команду в `~/.local/bin` и skill в `~/.agents/skills`.
Если bin directory отсутствует в PATH, используй напечатанный абсолютный путь.
Harness может прочитать [SKILL.md](skills/dynamic-workflows/SKILL.md) напрямую или
подключить `dynamicwf mcp` как stdio server. Специфичные настройки harness не меняются.

CLI принимает один JSON-запрос через stdin и возвращает один JSON-ответ.
Без установки команда доступна как `npm run --silent cli -- <tool>`.
По умолчанию черновики и run journal хранятся в `~/.dynamicwf/state.sqlite`; путь можно задать
через `DYNAMICWF_HOME` или `--store /path/state.sqlite`.

```sh
echo '{"id":"demo","name":"My workflow"}' | dynamicwf workflow.create
echo '{"id":"demo"}' | dynamicwf workflow.inspect
echo '{}' | dynamicwf workflow.schema
```

Примеры операций addNode/connect и цикл review→repair находятся в документации
authoring. `workflow.validate` показывает ошибки незаконченного draft;
`workflow.compile` принимает только завершённую корректную схему и возвращает source/hash.
`workflow.prepare` показывает зафиксированные настройки. `run.start` принимает
`{id,cwd,input}` и быстро возвращает run ID; `run.status`, `run.inspect`, `run.events`
показывают фактическое состояние. `dynamicwf watch --run <id>` открывает компактный монитор: текущая работа,
история, схема и расход токенов на отдельных вкладках (1/2/3/4), без повторяющихся простыней.

`run.pause` дожидается текущих workers, `run.resume` продолжает, `run.cancel`
прерывает их. Завершённые checkpoints не повторяются при восстановлении.
Неопределённые внешние эффекты после crash не запускаются заново молча.
`preset.save {id:runId,name,scope}` сохраняет успешный план; `preset.run` повторяет
его с новым input и новыми сессиями. Все запросы — JSON, не код оркестрации.

Permission profiles ограничивают набор tools; это не OS sandbox. Выданный shell
работает с правами локального пользователя. Review verdict привязан к переданной
версии артефакта; автор обязан указать реальную версию проверяемых данных.
Для параллельных coding-веток используй `worktree`, для слияния одобренных результатов
— явный `integrate`. Исходный и целевой workspace должны быть чистыми Git roots;
конфликт не считается успешной интеграцией. Ветки и результаты сохраняются.

Live probe не входит в `npm test` и требует явно указать доступную модель:

```sh
npm run probe:pi -- --provider openai-codex --model gpt-5.6-sol
npm run probe:workflow -- --provider openai-codex --model gpt-5.6-sol
```

Результат выполненного live probe и границы его доказательства — в
[отчёте pi](docs/research/pi-live.md); сквозной запуск — в
[отчёте workflow](docs/research/workflow-live.md).

Проект самостоятельный. Соседний `remote-pi` не является его зависимостью.
