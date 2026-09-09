# Пресеты успешных workflow

Для сохранения требуются `status:succeeded` и `taskOutcome.decision:accepted`.
Технически завершённый rejected/inconclusive/unclassified запуск не считается
проверенным пресетом. Старый `end` с `accepted:true` совместим. См.
[результаты и ожидания](outcomes-and-waits.md).

Пресет сохраняет **execution plan успешного запуска**: граф, сгенерированный source,
модель, thinking, полный system prompt, tools, permissions, session policy, output
schema и байты подключённых skills. Он не сохраняет input/output запуска, usage,
сессии pi, процессные токены или auth storage. Текст задания и явно добавленные
skills остаются частью шаблона: выбирай область хранения с учётом их содержания.

CLI и MCP используют одни операции:

```json
{"id":"run-UUID","name":"review-loop","scope":"project"}
```

Передай это в `preset.save`. `id` здесь — успешный **run**, не draft workflow.
`scope` бывает `project` (по умолчанию) и `global`. Неуспешный либо ещё работающий
run нельзя объявить проверенным шаблоном.

- Project: `.dynamicwf/presets/<name>/<planHash>.json` в ближайшем Git root,
  либо в указанном `cwd`, если Git root отсутствует. JSON можно хранить в Git.
- Global: `presets/` рядом с выбранной SQLite database (по умолчанию
  `~/.dynamicwf/presets/`).

`preset.list {}` показывает обе области. Одноимённый проектный preset имеет
приоритет; глобальная запись получает `shadowed: true`. Можно выбрать `scope`
явно. `cwd` определяет проект; для запуска это также рабочая директория.

```json
{"name":"review-loop"}
```

`preset.inspect` возвращает полный зафиксированный план. `preset.run` с теми же
полями плюс `input` создаёт **новый run** с новым ID и новыми сессиями. Исходный
граф/план и записи старого run не меняются. Если модель больше недоступна, worker
завершится явной ошибкой; другая модель не подставляется молча.

```json
{"name":"review-loop","scope":"global","input":{"task":"Следующая задача"},"cwd":"/absolute/project"}
```

Версия preset — SHA-256 плана. `revision` позволяет выбрать конкретную сохранённую
версию; без него используется последняя по времени первого сохранения. Повторное
сохранение одинакового плана идемпотентно. Изменение draft не меняет уже сохранённый
preset. Runtime/compiler версии проверяются при чтении; неподдерживаемые снимки
не интерпретируются по новым правилам.

Файлы публикуются атомарно через exclusive link; незаконченная запись никогда
не становится читаемой revision. Проверяются source hash, plan hash, frozen config,
skills и пути. Проверки: `tests/presets.test.ts`, включая сохранение одновременно,
повреждение содержимого и реальный повторный запуск с изменённым input.
