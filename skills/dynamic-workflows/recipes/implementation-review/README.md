# Реализация с независимым ревью

Три переносимых стартовых рецепта для изменения кода в выделенном Git worktree.
В каждом есть реализация, настоящая команда проверки, снимок Git-артефакта,
независимое ревью текущего артефакта и обратная связь исполнителю.

| Рецепт | Организация работы |
| --- | --- |
| [S](S/patch.json) | План → реализация → проверка → независимое ревью. |
| [P](P/patch.json) | План и предварительное ревью исходного артефакта выполняются параллельно; затем реализация, проверка и новое ревью. |
| [C](C/patch.json) | После плана, реализации и проверки два независимых reviewer проверяют корректность и контракт. Нужны оба `approve`. |

`create.json`, `patch.json`, `validate.json` в каждом каталоге — готовые запросы
официального authoring API; `input.json` — нейтральный пример задачи. Это рецепты,
не сохранённые tested presets и не утверждение превосходства одной топологии.
Предыдущие проверки иной ревизии helpers не одобряют эту ревизию автоматически.

## Привязка к проекту

Нужны Node.js, Git и доступный Dynamicwf. Подставьте реальные файлы, критерии,
политику проекта и доступную команду проверки в копию
[parameters.example.json](parameters.example.json). Пример `normalizeLabel` лишь
показывает формат: helper не создаёт исходники или тесты этой функции.
`projectPolicy` должен явно передавать применимые инструкции проекта, поскольку
workers не подхватывают проектный AGENTS.md автоматически. `contextFiles` — пути
от корня будущего worktree, доступные исполнителям; проверьте их заранее.

```sh
node /path/to/implementation-review/instantiate.mjs \
  --recipe /path/to/implementation-review/S \
  --parameters /path/to/task-parameters.json \
  --out /path/to/task-recipe
```

Команда только создаёт файлы. Она не запускает workers и не обращается к сети.
Выход должен находиться вне исходного recipe; существующие symlink aliases
исходного каталога и его родителей проверяются до записи. Результат включает
обновлённые запросы create/patch/validate, input и сведения о привязке.

Передайте содержимое `create.json` в `workflow.create`. Перед отправкой
`patch.json` в `workflow.patch` установите `expectedRevision` из фактической
`revision` ответа create (в CLI/MCP envelope — `result.revision`). Затем передайте
`validate.json` в `workflow.validate`. Выполните `workflow.prepare` с `id` нового
workflow и `cwd` — корнем целевого чистого Git checkout, например
`{"id":"implementation-review-example","cwd":"/path/to/project"}`.
`workflow.prepare` не принимает input. Изучите подготовленный план и вызовите
`run.start` с полученным `preparedId`, явным `idempotencyKey` и полем `input`,
содержащим полный JSON-объект из `input.json`; путь к файлу не заменяет объект.
При старте по `preparedId` не передавайте повторно `id`, `cwd` или `model`.
Сразу сообщите пользователю run ID. Таймаут наблюдения не означает необходимость
нового запуска. Подробные поля и команды — в [основном skill](../../SKILL.md).

Команда проверки и literal argv фиксируются в `patch.json`; изменение
`input.checkCommand` или `input.checkArgs` не меняет исполняемую команду:
несовпадение завершает граф до выделения worktree. Для другой команды повторите
instantiate и prepare. Shell не используется; метасимволы остаются аргументами.
Команда проверки зависит от проекта и должна проверять реальные критерии.

В рецептах сохранены выбранные модели, P0 system prompts, tools, permission,
схемы вывода, session, retry и output repair. Planner использует `xhigh`,
implementer — `medium`, reviewer — `high`; implementer продолжает свою сессию,
reviewer получает свежую. Не заменяйте явно выбранные настройки молча при
недоступности модели. Английский текст сохранённых system prompts — часть
конфигурации; обычные инструкции задачи и сообщения рецепта даны по-русски.

## Что означает принятие

После успешной проверки артефакт получает настоящую `git-tree:<sha>` revision.
Ревью связано с этой revision и `acceptanceCriteriaRevision`; обе проверяются
корневым графом. Для C каждый reviewer должен одобрить ту же текущую версию.
Неуспешная команда и `request_changes`/`inconclusive` возвращают обратную связь
исполнителю. Конкретный `blocked` завершает путь без принятия.
Произвольных лимитов итераций или обязательного approval gate нет.

Технический `succeeded` не равен корневому `accepted`. Результат содержит
закоммиченный worktree и доказательства; автоматического слияния нет.
Перед использованием результата проверьте корневой outcome, фактический check,
актуальные вердикты, соответствие committed tree и границы изменений.
Worktree и tool permission profile не являются OS sandbox.

## Helpers и границы проверки

[snapshot.mjs](snapshot.mjs) копирует реальный per-worktree Git index во
временный файл, выполняет `git add --all -- .` и `write-tree`. Исходный index
остаётся побайтно неизменным. Учитываются staged, unstaged, nonignored untracked
и принудительно staged ignored файлы. Для отсутствующего index временный index
тоже изначально отсутствует — это семантика runtime staging, без подстановки HEAD.
Linked worktrees разрешаются через Git; вложенный cwd и перечисленные в helper
унаследованные Git overrides отвергаются. Снимок описывает Git-артефакт с
действующими ignore/filter правилами, а не все файлы компьютера. Внешний
конкурентный writer между снимком, ревью и commit не изолируется helper.

[verify-command.mjs](verify-command.mjs) сохраняет реальный exit/signal и
stdout/stderr команды; текст stdout (включая JSON и TAP) не определяет успех.
Успех требует exit 0 и одинакового tree до/после проверки. `commandExecuted`
отличает ошибку запуска от процесса, который был запущен и завершился ошибкой.
Вывод буферизуется в памяти без произвольного `maxBuffer` cap.

JSON самодостаточны: helpers встроены в статичные check args, поэтому workers
не зависят от пути установки skill. Поддерживаемые исходники helpers — два
`.mjs` файла. После их изменения обновите все три определения:

```sh
node skills/dynamic-workflows/recipes/implementation-review/embed-helpers.mjs
node --import tsx --test tests/implementation-recipes.test.ts
```

Тест сравнивает точные embedded bytes с поддерживаемыми исходниками, проходит
официальные create/patch/compile, проверяет маршруты, реальные временные Git
репозитории, большие stdout/stderr и alias protection. Это offline-проверки
без моделей. Для сохранения новой ревизии как tested preset требуется её
собственный реальный smoke с корневым accepted и текущими доказательствами.
