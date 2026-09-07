# dynamicwf-pi

Динамические агентные workflow на pi: агент собирает блоки и связи через инструменты,
а система проверяет схему и машинно генерирует исполняемый TypeScript + Effect.
Один переносимый skill объясняет интерфейс любому совместимому harness.

## Состояние

Исследование и проверка pi + Effect выполнены, ответы пользователя получены.
Работают authoring CLI, сохранение черновиков, валидатор, каталог ролей и компилятор.
Сгенерированные программы проходят исполняемые тесты; настоящий pi вызван отдельно.
Supervisor, pi backend графа, pause/resume, MCP, skill, presets и watch ещё в работе.
Архитектурный черновик читать вместе с принятыми решениями.

- [Требования и критерии приёмки](docs/requirements.md)
- [Вопросы и открытые решения](docs/questions.md)
- [Ответы пользователя и принятые решения](docs/decisions.md)
- [Архитектурное предложение](docs/architecture-proposal.md)
- [Итоги и сравнительные исследования](docs/research/README.md)
- [Состояние работы и следующий этап](docs/progress.md)
- [Контракт графа](docs/graph-contract.md), [операции authoring](docs/authoring.md), [компилятор](docs/compiler.md)

## Проверить локально

Требуется Node >=22.19.0; текущая проверенная среда — Node 26.8.1.

```sh
npm ci
npm run typecheck
npm test
npm run --silent cli -- catalog.list
```

CLI принимает один JSON-запрос через stdin и возвращает один JSON-ответ.
Для машинного чтения используй `--silent`, чтобы npm не добавлял свой banner.
По умолчанию черновики хранятся в `~/.dynamicwf/state.sqlite`; путь можно задать
через `DYNAMICWF_HOME` или `--store /path/state.sqlite`.

```sh
echo '{"id":"demo","name":"My workflow"}' | npm run --silent cli -- workflow.create
echo '{"id":"demo"}' | npm run --silent cli -- workflow.inspect
echo '{}' | npm run --silent cli -- workflow.schema
```

Примеры операций addNode/connect и цикл review→repair находятся в документации
authoring. `workflow.validate` показывает ошибки незаконченного draft;
`workflow.compile` принимает только завершённую корректную схему и возвращает source/hash.
Команда запуска самого workflow пока не реализована.

Live probe не входит в `npm test` и требует явно указать доступную модель:

```sh
npm run probe:pi -- --provider openai-codex --model gpt-5.6-sol
```

Результат выполненного live probe и границы его доказательства — в
[отчёте pi](docs/research/pi-live.md).

Проект самостоятельный. Соседний `remote-pi` не является его зависимостью.
