# Общий сервис, CLI и MCP

[Индекс](README.md) · [Установка](models-and-setup.md) · [План и запуск](execution-plan.md)

Оглавление: [сервис](#service) · [CLI](#cli) · [инструменты](#tools) ·
[публичное состояние](#state) · [управление](#control) · [MCP](#mcp).

<a id="service"></a>
## Сервис и время жизни

`WorkflowService` из `src/service.ts` — асинхронный интерфейс приложения:
`dispatch(tool, request): Promise<unknown>` и `close()`. CLI и MCP используют один
сервис без собственного планировщика. JSON-запросы строго проверяются: неизвестные поля,
неверные ID/аргументы и не-JSON значения JS отвергаются. Вход копируется до асинхронной
подготовки, поэтому вызывающая сторона не может изменить его в процессе.

```ts
const service = new WorkflowService('/path/to/state.sqlite', { cwd: '/project' });
try {
  const prepared = await service.dispatch('workflow.prepare', { id: 'repair' }) as PreparedExecution;
  const result = await service.dispatch('run.start', {
    preparedId: prepared.preparedId, idempotencyKey: 'unique-intended-repair-run',
    input: { task: 'Implement the requested change' }
  });
} finally {
  service.close();
}
```

Это фрагмент API, предполагающий существующий черновик. `close` закрывает соединения БД,
но не отменяет запущенный отдельный supervisor. Другой клиент с тем же журналом и ID
может наблюдать и управлять запуском.

<a id="cli"></a>
## CLI: ввод и ошибки

```sh
npm run --silent cli -- catalog.list <<<'{}'
npm run --silent cli -- workflow.prepare --store /path/to/state.sqlite <<<'{"id":"repair","cwd":"/project"}'
npm run --silent cli -- run.start --store /path/to/state.sqlite <<<'{"preparedId":"prepared-RETURNED-HASH","idempotencyKey":"unique-repair-run","input":{"task":"Fix the failing check"}}'
npm run --silent cli -- run.status --store /path/to/state.sqlite <<<'{"id":"run-RETURNED-ID"}'
```

Примеры с `<<<` рассчитаны на `bash`/zsh; heredoc с маркером в кавычках или JSON-файл
тоже подходят. Один вызов читает один JSON-объект со stdin и выдаёт один JSON-ответ
в stdout. Пустой stdin означает `{}`. Успех: `{"ok":true,"result":...}`; ошибка:
`{"ok":false,"error":{"name":"...","message":"..."}}` с кодом выхода 1.
Проверка может добавить `error.issues`, редактирование — нулевой `operationIndex`,
конфликт версий — `expectedRevision`/`actualRevision`, типизированный отказ — `failure`.
Диагностика зависимостей может появляться в stderr.

`npm run --silent cli -- --help` или `dynamicwf <tool> --help` печатает справку
и актуальные `serviceToolNames` после `tools`: сейчас их 39. `dynamicwf --help` показывает
только точки входа watch/ui/mcp и примеры имён с точками. MCP --help пишет справку
в stderr без перечисления инструментов. Источник истины для схем — `workflow.schema`
и MCP `tools`/`list`, не сохранённый ранее перечень.

Журнал по умолчанию: `$DYNAMICWF_HOME/state.sqlite`, иначе `~/.dynamicwf/state.sqlite`;
--store переопределяет его. Ресурсы, сессии, сгенерированные модули и supervisor.log
лежат рядом с БД в `runs/<run-id>/`. Это постоянные локальные данные, не артефакты Git.
`:memory:` подходит для каталога/редактирования/подготовки, но не запуска отдельного
процесса. Запросы каталога/схемы не создают БД.

<a id="tools"></a>
## Инструменты и поля запросов

Все поля ниже обязательны, кроме отмеченных `?`; `{}` — пустой объект.
`id` в `workflow`.* — ID черновика, в `run`.* — возвращённый ID запуска, в `task`.* — ID задачи.

| Инструмент | Поля запроса | Результат |
| --- | --- | --- |
| `catalog.list` | `{}` | Встроенные роли и описания |
| `catalog.describe` | `name` | Роль и настройки по умолчанию |
| `catalog.models` | `refresh?` | `{models,issues}`; явное обновление встроенного xAI по сети |
| `system.doctor` | `cwd?` | Локальные предпосылки без вызовов модели |
| `workflow.schema` | `{}` | Схемы `workflow`/`Expr`/черновика/создания и публичного изменения |
| `workflow.create` | `id`, `name`, `entryGraph?` | Новый редактируемый черновик |
| `workflow.list` | `{}` | ID, имена и версии |
| `workflow.inspect` | `id` | Текущий, в том числе незавершённый черновик |
| `workflow.patch` | `id`, `expectedRevision`, `operations` | Новая версия и результат проверки |
| `workflow.validate` | `id` | Результат проверки графа |
| `workflow.compile` | `id` | Сгенерированный TS + `Effect` и его хеш |
| `workflow.prepare` | `id`, `cwd?`, `model?` | Сохранённый `{preparedId,planHash,cwd,createdAt,plan}` |
| `workflow.prepared` | `preparedId` | Проверенная сохранённая запись подготовки и полный план |
| `run.start` | `preparedId`, `input?`, `idempotencyKey?`; либо `id`, `input?`, `cwd?`, `model?` | Новый либо дедуплицированный запуск |
| `run.status` | `id` | Публичный итог и наблюдаемая живость |
| `run.list` | `{}` | Итоги и живость сохранённых запусков |
| `run.inspect` | `id` | Итог, зафиксированный граф, вход и активации |
| `run.events` | `id`, `after?` | `{events,nextAfter}` |
| `run.usage` | `id`, `after?`, `limit?` | Итоги и страница отчётов SDK об ответах |
| `run.attempts` | `id`, `key`, `after?`, `limit?` | Архив, отдельная текущая точка, учёт/пробелы |
| `run.retries` | `id`, `key`, `after?`, `limit?` | Неизменные решения о повторе и отдельный текущий прогресс |
| `run.collections` | `id`, `key`, `after?`, `limit?` | Зафиксированные результаты детей и сводка одного снимка чтения |
| `run.pause` | `id` | Состояние после запроса паузы |
| `run.resume` | `id` | Состояние после запроса продолжения |
| `run.cancel` | `id` | Состояние после запроса отмены |
| `preset.save` | `id`, `name`, `scope?`, `cwd?` | Пресет неизменного плана принятого успешного запуска без узлов `reuse` |
| `preset.list` | `scope?`, `cwd?` | Библиотеки `project`/`global` с приоритетом проектного имени |
| `preset.inspect` | `name`, `scope?`, `revision?`, `cwd?` | Именованная либо выбранная по хешу версия с полным планом |
| `preset.run` | `name`, `scope?`, `revision?`, `cwd?`, `input?` | Новый запуск, новые сессии, без повторного использования старых выходов |
| `run.waits` | `id` | Публичное состояние и сохраняемые ожидания |
| `run.trace` | `id`, `after?`, `limit?` | Записи переходов, сводка, `planHash` и курсор |
| `run.resolve` | `id`, `waitId`, `response`, `resolvedBy?` | Сохранённый ответ и состояние; повтор ответа идемпотентен |
| `run.recovery` | `id`, `key` | Попытка, точка, операция, препятствия и хеш каталога; не разрешает действий |
| `run.reconcile` | `id`, `key`, `attempt`, `checkpoint`, `workspaceDigest`, `decisionId`, `action`, `actor`, `reason`, `evidence`, `supersedes?`; для `accept` ещё `output` | Квитанция `accept`/`retry`, без запуска исполнителя или снятия паузы |
| `run.reconciliations` | `id`, `key?` | Решения, квитанции применения/замещения |
| `run.continuation.inspect` | `id` | Контрольная точка, связи запусков, доступные для `reuse` выходы, препятствия и хеш |
| `run.continue` | `preparedId`, `idempotencyKey`, `source:{runId,checkpoint,planHash}`, `actor`, `reason`, `evidence`, `workspaceDigest`, `input?`, `reuse?`, `dispositions?` | Новый либо дедуплицированный запуск-продолжение; немедленно сообщите ID |
| `task.inspect` | `id` | Связанные запуски, квитанции и идентичности повторно использованных выходов |
| `task.usage` | `id`, `after?`, `limit?` | Учёт отдельных запусков/задачи и страницы отчётов |

`run.start.preparedId` нельзя совмещать с `id`/`cwd`/`model`. Форма с ID черновика всегда
создаёт новый запуск и не принимает `idempotencyKey`. Отсутствующий `input` становится
JSON `null`; `false`, 0, пустая строка, объекты и массивы сохраняют смысл. `cwd` по умолчанию —
рабочий каталог сервиса/CLI; относительный путь разрешается от него. `model` — ровно
`{provider,id}`, значение по умолчанию только для узлов без явной модели, не замена
индивидуального выбора узла.

Подробности: [редактирование/пресеты](authoring.md), [идемпотентный запуск](execution-plan.md#delivery),
[исходы/ожидания/сбор](outcomes-and-waits.md), [попытки](run-journal.md#attempts),
[ошибки/повторы/формат](retry-and-failures.md), [восстановление](reconciliation.md).
Изменённый граф **той же задачи** запускайте через инспекцию → `run.continue`,
а не несвязанный `start` со скопированным JSON: [переносимый контракт](../skills/dynamic-workflows/references/continuation.md).

<a id="state"></a>
## Публичное состояние и курсоры

Обычный статус не отдаёт большое содержимое плана или защитные токены владельца.
Он включает идентичность/версию графа, `planHash`/`sourceHash`, `preparedId` при наличии,
сводки модели/`thinking`, `cwd`, временные метки, `status`/`desired`, PID supervisor, `output`/`error`
и независимый `taskOutcome`. `supervisorAlive`/`workersAlive` — проверка процессов, не вывод
из PID в БД. `run.inspect` убирает токены владельца/исполнителя активации; публичные
события — также резервирование запуска и токены исполнителя. Явная инспекция содержит
входы/выходы, поэтому не публикуйте её как обезличенный лог.

`presentation` общая с браузером/watch: технический статус/намерение, исход задачи,
ключи активных/ожидающих/повторяемых активаций и отдельно проверенная живость процессов.
ОС и журнал не образуют атомарную общую транзакцию. [Подробная проекция](observation.md).

`run.events.after` — неотрицательное безопасное целое, изначально 0. Передавайте `nextAfter`
в следующий запрос; пустая страница сохраняет курсор. Неизвестный запуск — ошибка.
У `events` пока нет ограничения размера страницы: продвигайте курсор на длинных запусках.
`usage`/attempts/retries/collections/trace имеют отдельные курсоры и размер страницы
1–1000 (по умолчанию 100), не лимиты исполнения.

<a id="control"></a>
## Пауза, отмена и прерывание

Пауза сразу меняет `desired` и закрывает допуск новых активаций, но даёт уже принятым
листовым исполнителям завершиться и записать контрольные точки. До этого `pausing`,
затем `paused`. Длинная команда/ответ модели задерживает паузу. Продолжение открывает допуск.
Отмена отдельно запрещает допуск и прерывает исполнителей с очисткой групп процессов:
`cancelling` → `cancelled`. Она монотонна, пауза/продолжение её не отменяют. У конечных
`succeeded`/`failed`/`cancelled` управление сохраняет исход.

Отсутствующий supervisor при живых исполнителях не означает остановку. Когда оба
подтверждённо отсутствуют и группы разрешены, контроллер фиксирует прерывание,
сохраняя завершённые выходы. `resume` не повторяет неопределённые эффекты `agent`/`check`.
Сначала `run.recovery` → явный `run.reconcile` `accept`/одноразовый `retry`, затем отдельно
`run.resume`. Доказательства автора — свидетельство, не машинное подтверждение внешних эффектов.

Инструменты/разрешения фиксируются до запуска исполнителя. `read-only` запрещает `bash`/`write`/`edit`;
`workspace-write`/`unrestricted` с оболочкой имеют права пользователя ОС. `check` запускает
заданный исполняемый файл. Это не ограничение файлов/сети и не автоматическое создание
worktrees: [изоляция Git](workspaces.md) задаётся графом. Нет скрытых ограничений стоимости,
итераций, времени или параллелизма.

<a id="mcp"></a>
## Подключение MCP по stdio

`src/cli.ts` читает CLI-запросы; `src/mcp.ts` проверяет и сериализует запросы того же
`WorkflowService`. Закреплены официальные `@modelcontextprotocol/server@2.0.0` и тестовый
клиент `@modelcontextprotocol/client@2.0.0`. SDK реализует протокол 2026-07-28;
`serveStdio` принимает современные подключения и старые клиенты с initialize.
Оба пути покрыты тестами. [SDK](https://github.com/modelcontextprotocol/typescript-sdk),
[`serveStdio`](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/serveStdio.ts).

Из копии репозитория:

```sh
node --import tsx src/mcp.ts --store /absolute/path/state.sqlite --cwd /absolute/path/project
```

Из другого каталога используйте установленный исполняемый файл либо абсолютные пути
загрузчика/скрипта. Пример определения сервера (внешнюю форму настройте под приложение):

```json
{
  "mcpServers": {
    "dynamicwf": {
      "command": "/absolute/path/to/node",
      "args": [
        "--import", "/absolute/path/to/dynamicwf-pi/node_modules/tsx/dist/loader.mjs",
        "/absolute/path/to/dynamicwf-pi/src/mcp.ts",
        "--store", "/absolute/path/to/state.sqlite",
        "--cwd", "/absolute/path/to/workspace"
      ]
    }
  }
}
```

Node должен удовлетворять engines; зависимости установите заранее. Журнал по умолчанию
тот же, `cwd` — директория сервера MCP. Это локальный stdio, без сетевого слушателя и
серверной авторизации OAuth. Учётные данные pi остаются настройкой исполнителя,
не копируются из чата. Stdout целиком занят JSON-RPC; ошибки запуска/справка — stderr.

Точки в именах сервиса превращаются в подчёркивания: `workflow.patch` → workflow_patch,
`run.continuation.inspect` → run_continuation_inspect. Все 39 инструментов отображаются
один-к-одному через `mcpToolDefinitions`; отличий бизнес-семантики нет. Все входные схемы
закрыты. Workflow_patch публикует полную рекурсивную схему операций/узлов/рёбер/`config`/`Expr`,
не непрозрачную строку. Повторные определения `TypeBox` собраны в локальные $defs/#/$defs/...;
сервер компилирует именно эти схемы строго, без приведения типов. Аннотации описывают
чтение/изменения/идемпотентность/эффекты, но не являются авторизацией или принудительным ограничением.

Успех повторяет одну оболочку ответа в `structuredContent` и текстовом блоке JSON:

```json
{
  "content": [{"type":"text","text":"{\"ok\":true,\"result\":{\"id\":\"run-example\"}}"}],
  "structuredContent": {"ok":true,"result":{"id":"run-example"}}
}
```

Так даже массивы результатов сервиса совместимы с объектным `structuredContent`.
Известные ошибки проверки/приложения возвращают `isError`:`true` и одинаковый
`{ok:false,error:{name,message}}` с дополнительными полями на обеих поверхностях.
Агент может исправить запрос. Ошибки JSON-RPC обрабатывает официальный SDK отдельно:
[спецификация инструментов](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

Последовательность: `create` → `patch` → `validate` → `prepare` → `start` с `preparedId`/ключом.
`start` возвращает ID после первоначального создания процесса, не ждёт завершения графа.
Закрытие клиента, сервера или отмена запроса MCP **не заменяет** run_cancel.
Подключитесь снова к тому же журналу для статуса/инспекции/событий/управления.
Диалог разрешений вызывающего приложения не создаёт изоляцию ОС. Подготовка фиксирует
план/путь, не живые файлы. Адаптер не вызывает модели и не задаёт своих пределов циклов/планировщика.

Преобразование переносимой JSON Schema обходит только позиции схемы. Значения
`const`, `enum`, примеров и неизвестных ключевых слов остаются данными; имена
пользовательских свойств не переименовываются. Одинаковые определения объединяются
независимо от порядка ключей объекта, но порядок элементов массива учитывается.
Регрессии: `public-schema-literals`, `public-patch-schema`, `mcp`.

## Проверки

`tests/service.test.ts` проверяет строгие запросы, подготовку/выбор модели, независимое
исполнение после `close`, управление/курсоры и удаление токенов из публичной инспекции.
`tests/cli.test.ts`, `tests/public-patch-schema.test.ts`, `tests/skill-handoff.test.ts`
закрепляют передачу управления CLI/MCP, ошибки и публичную схему изменения с обязательным `id`.
`tests/mcp.test.ts` запускает настоящие stdio-процессы и официальный клиент:
инициализацию, список инструментов/схемы, редактирование/подготовку, отдельный `check`,
паузу, переподключение/продолжение, курсоры, ошибки, согласование протокола и чистоту
stdout — без учётных данных и вызовов модели.

## Рецепт implementation-loop

CLI/MCP: `workflow.recipe.describe {"recipe":"implementation-loop","version":1}` →
`workflow.recipe.prepare` с полями из describe → компактные `summary`, `preparedId`,
`input` → `run.start` с этими `preparedId`/`input` и заранее сохранённым
`idempotencyKey`. CLI принимает те же JSON-аргументы; MCP использует имена
`workflow_recipe_describe`/`workflow_recipe_prepare`. Ошибки неизвестной версии,
поля, модели/thinking отклоняются без fallback. Подготовка не запускает команду,
workers или публикацию. Просмотрите полномочия в summary и при необходимости
`workflow.prepared`; сохранённого draft нет. Не повторяйте подготовку вместо
повторной доставки start после потерянного ответа.
