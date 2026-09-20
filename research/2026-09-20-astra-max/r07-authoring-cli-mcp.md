# r07 — Контракты authoring, CLI и MCP

## Metadata

- **ID:** r07; **тема:** Контракты authoring, CLI и MCP; **дата исследования и продолжения:** 2026-09-20 (UTC).
- **study-source / sourceRevision:** `e15bc407da8753fd6b683c0aa4a68634e3c458a7`; HEAD фактического нового cwd независимо проверен и совпал.
- **Фактический cwd / место записи:** `/Users/ramu/.dynamicwf/runs/run-9dbb044c-664f-4dd8-96c0-57192dc4ed89/worktrees/8d0df569d4397e843e1b707095a63f510e8ed8eb9e8834415833e52a9c52599b`. Это новая операция, не запись в старую ветвь или integration-dev.
- **publicationRevision:** `3d8ba65ee84402c0e3b0587f70095b7847824a9f`; HEAD разрешённого dev отдельно прочитан и совпал. Два более поздних исправления выделены ниже; file:line находок по-прежнему относятся к study-source.
- **Исторические offline-проверки:** разрешённый integration-dev на sourceRevision (по исходному отчёту и retained commands), Node `v26.8.1`, macOS; в исходном worktree зависимостей не было. Сейчас те команды **не запускались**. Пакеты не устанавливались.
- Записаны только два назначенных отчёта в новом cwd; новый scratch — `/tmp/r07-continuation-7GpzfL`. Старые own reports и `/tmp/r07-authoring-MCi7LO` только прочитаны. Сеть, credentials, live provider, пользовательские runs/процессы и установленный runtime не затрагивались; чужие отчёты не читались. Реализации, commit/push/checkout/reset нет.

## Continuation provenance — происхождение и независимая сверка

Исходная операция `run-babf9b25-b8f5-45ad-b79c-2b2e5d31d2f0` имеет статус **failed**, а не успешный выход исследователя. `retainedEvidence` сообщает provider failure; причина/квоты не исследуются, неизвестные внешние операции не повторяются. Оба сохранённых отчёта уже были содержательно полны; старое JSON-поле `status:complete` само по себе не доказывает успешную отправку результата. Новый пакет завершён проверкой и переносом материалов, не повторным прогоном приложения.

Старый worktree: `/Users/ramu/.dynamicwf/runs/run-babf9b25-b8f5-45ad-b79c-2b2e5d31d2f0/worktrees/8d0df569d4397e843e1b707095a63f510e8ed8eb9e8834415833e52a9c52599b`. Сначала прочитаны собственные md/json и сохранённые 17 записей команд `r07-actions.json`. Хеши и размеры совпали с входным retainedEvidence:

| Старый файл | Байты | Проверенный SHA256 |
|---|---:|---|
| `r07-authoring-cli-mcp.md` | 42614 | `784dad9ca2a0231a9c4141a0a817a5449feba71bbaa12f2bbead66f64782361c` |
| `r07-authoring-cli-mcp.json` | 34475 | `effce81a205f19b5e13d7d57ab4a6c2fb06c78dc86b8761a4d0c62933a39b844` |

**Перенесено:** R07-B01–B04, R07-I01, исходные R07-E01–E03, четыре refutations и четыре unknowns. Сохранённые логи независимо подтверждают **178+3 passed**; обе probe summaries — описанные четыре контрпримера. Это исторические результаты, **0 новых запусков тестов приложения**. Команды в retained actions не содержат exit-ответов; они сверены с отдельными сохранёнными outputs, а не приняты за доказательство success сами по себе.

**Перепроверено сейчас:** причинные строки исходников, контракты ошибок/схем/prepare, git history, соответствие IDs и выводов обоих форматов. Markdown-fixture побайтово равен старому JS: 9790 байт, SHA256 `33aa61f55b19b1300145772e8bbdbe28eee63440188cb0c139250d03da947c20`. Проверена 81 уникальная явная file:line ссылка старого пакета. Уточнены только диапазоны `tests/store.test.ts`: сводная ссылка 9–77 → 9–75, initialization 52–77 → 50–75 (в файле 75 строк); смысл контрдоказательства не изменён.

**Добавлено:** R07-E04/E05 и отдельные post-study R07-PSAF01/02. Между source и publication побайтово совпадают 13 профильных файлов (список в JSON), в том числе service/store/authoring/lineage/CLI/MCP/public-schema/prepared-plans; блок schema declarations в graph.ts также одинаков. Изменения graph validation/execution-plan прочитаны отдельно. Границы B01–B04 этими двумя коммитами не исправлены по статической сверке; нового динамического воспроизведения на publicationRevision нет.

Полные пути/хеши retained commands и пяти собственных offline-файлов — в JSON `continuationProvenance.retainedOfflineEvidence`; сырые логи не перенесены. Итоговые отчёты не побайтовые копии: добавлено происхождение, разграничены этапы и уточнены цитаты; самостоятельный fixture оставлен без изменений.

## Итог

**4 исторически воспроизведённых на study-source bug и 1 idea.** Потери правок при CAS и подмены подготовленного плана не обнаружены. Основной путь onboarding подтверждён исходными **178/178** профильными тестами и **3/3** выбранными тестами, без ошибок; результаты перенесены, не получены повторно. Эти положительные проверки не покрывали найденные контрпримеры.

| ID | Класс | Приоритет | Суть |
|---|---|---|---|
| R07-B01 | bug | средний | `run.continue` через CLI принимает массивы вместо строковых хешей и `reuse:null`, MCP их отвергает |
| R07-B02 | bug | средний | Проигрыш именно SQLite CAS теряет тип и поля `RevisionConflictError` |
| R07-B03 | bug | низкий | Публичная `workflow.schema.result.draft` не компилируется закреплённым Ajv из-за повторных `$id` |
| R07-B04 | bug | средний | Уже начатый `workflow.prepare` способен открыть два соединения после `WorkflowService.close()` |
| R07-I01 | idea | низкий | Выделить общую диагностику неверного запроса вместо разных transport-specific ошибок |

`findingCount=5` относится к этой таблице / массиву JSON `findings`; опровержения и границы проверки вынесены отдельно.

## Coverage и метод

Основное покрытие ниже — исходная операция; дополнение continuation описано в R07-E04/E05.

Сначала прочитаны `AGENTS.md`, architecture/development/known-issues, затем service/authoring/execution-plan/graph-contract/models-and-setup, README и установленный в репозитории SKILL. Просмотрены общий `git log -16 --oneline` и история профильных файлов. Исследуется текущая dev-ревизия, не старый main.

Проверены:

- Чистый authoring: закрытые схемы, JSON-граница, порядок операций, rollback, `operationIndex`, заморозка результата, семантически незавершённый черновик.
- Хранение: сравнение revision в чистой функции **и** SQLite CAS; разница двух путей конфликта.
- Все 39 объявлений MCP: соответствие имён сервису, компиляция input schemas и representative arguments существующим тестом. Это не exhaustive differential testing каждого поля всех 39 операций.
- CLI: один JSON stdin/ответ, delayed/chunked UTF-8 через EOF, exit status и stderr. MCP: настоящий stdio и официальный клиент, legacy initialize и pin `2026-07-28`, text/structuredContent, переподключение.
- Prepare/start: замороженный план, canonical cwd, дедупликация, старый снимок после изменения draft/удаления skill, запрет override, повреждение снимка, повтор доставки после завершения/паузы/прерывания.
- Onboarding: fixture-установка в временные bin/skills directories, CLI из другого cwd, самодостаточные ссылки skill; doctor только с подставленным каталогом моделей.
- Дополнительные контрпримеры: реальная SQLite и CLI/MCP на собственных fixture-данных. В continuation-probe источник и преемник оставались `paused`, supervisor не создавался.

Не выполнялись полный `npm test`, typecheck, live inference, настройка пользователя или web-запросы. Полный runtime recovery и браузер не являются предметом этого отчёта.

## Находки

### R07-B01 — разные принимаемые формы `run.continue` [bug]

**Факт / триггер.** В корректном запросе continuation заменить `source.checkpoint` и `source.planHash` на одноэлементные массивы с теми же строками. Отдельный контрпример — явно передать `reuse:null` при отсутствии reuse-узлов.

**Код этой ревизии:**

- `src/lineage.ts:244` проверяет `sha256.test(String(sourceValue.checkpoint))` и аналогично planHash, а `:254` возвращает уже приведённые строки. `String([hash]) === hash`.
- `src/lineage.ts:259` использует `bindingList(value.reuse ?? [])`: явный `null` становится отсутствующим массивом.
- `src/service.ts:274-282` использует этот parser напрямую и канонизирует его результат для дедупликации.
- `src/mcp-tools.ts:37,40` публикует соответственно `type:string` и `type:array`; `src/mcp.ts:19,25-26` проверяет схему до сервиса. Ajv работает без coercion (`src/output-schema.ts:35`).

**Ожидание.** Один закрытый контракт запроса: обе поверхности отвергают неправильные типы до создания continuation. Это согласуется с `PROJECT_INFO/service.md:11-15,208-214`.

**Наблюдение, R07-E02.** Для одного fixture-store официальный MCP-клиент сначала получил:

```text
Invalid structured output: data/source/checkpoint must be string; data/source/planHash must be string
```

Число runs осталось 1. Тот же JSON через настоящий `src/cli.ts run.continue` вернул `ok:true`, exit 0, новый `paused` run; число записей стало 2. Затем корректный запрос со строками через MCP вернул **тот же ID**: разные по схеме входы сведены parser-ом к одному canonical request. `reuse:null` также принят CLI как повторная доставка, а MCP отвергнут.

**Контрдоказательства / границы.** Неверный *строковый* checkpoint из 64 нулей отвергнут без нового run. Сверка сохранённых checkpoint/planHash/workspaceDigest в `src/run-controller.ts:422-427` остаётся действенной. Это **не** обход проверки свежести, авторизации или доказательство повторного внешнего действия. Воспроизводитель не запускал исполнителей. Корректные строки и обычная дедупликация работают.

**Минимальная рекомендация (не внедрена).** Проверять тип обоих source-хешей до regex, убрать `String(...)` на этой границе; различать отсутствующий `reuse` и явный `null`. Добавить differential cases к parser/service/MCP/CLI.

**Риск.** Отказ клиентам, ранее полагавшимся на недокументированную coercion. Не менять каноническую форму корректных старых запросов и историю ключей.

**Приёмка.** `[hash]`, вложенный массив и `reuse:null` отвергаются обеими поверхностями до изменения runs/receipts; корректные строки, omitted reuse и `[]` сохраняют поведение, прежний корректный ключ возвращает исходный ID.

### R07-B02 — CAS-конфликт теряет структурную диагностику [bug]

**Факт / триггер.** Два редактора прочитали одну revision, оба успешно прошли `applyPatch`, первый записал revision 2, второй проиграл условный UPDATE.

**Код:** `src/store.ts:42-49`: чтение и чистая проверка находятся перед CAS; при `changes!==1` бросается обычный `Error`. Ранний конфликт, напротив, — `RevisionConflictError` с полями (`src/authoring.ts:44-47,60`). CLI и MCP сохраняют revision-поля только для этого класса (`src/cli.ts:30-31`, `src/mcp.ts:32`). Переносимый skill учит обрабатывать именно структурный конфликт (`skills/dynamic-workflows/SKILL.md:58-71`).

**Ожидание.** Конкурентная и уже устаревшая правка должны давать один исправимый тип конфликта с expected/actual revision; проигравший пакет не записывается.

**Наблюдение, R07-E02.** Два отдельных CLI-процесса работают с реальной временной SQLite. Fixture добавляет **только барьер после фактического чтения `DraftStore.get`**, чтобы оба дошли до CAS с revision 1; алгоритм UPDATE и сериализация ошибок не подменены. Один ответ успешен, проигравший — exit 1:

```json
{"name":"Error","message":"Revision conflict while saving workflow: race"}
```

`expectedRevision`/`actualRevision` отсутствуют. Итоговая revision — 2, в draft ровно одна из двух новых graph-записей.

**Контрдоказательства.** Потери обновления **нет**: SQL `WHERE ... revision=?` работает. При последовательном повторе stale patch и CLI, и MCP возвращают одинаковый `RevisionConflictError`, expected 1 / actual 2. `operationIndex` и rollback обычного неудачного пакета подтверждены `skill-handoff`. Существующий `tests/store.test.ts:9-34` проверяет последовательный stale editor, не проигрыш после общего чтения; конкурентный тест `:50-75` проверяет initialization/list, не patch CAS.

**Минимальная рекомендация.** При failed CAS прочитать актуальную revision и выбросить `RevisionConflictError(request.expectedRevision, actualRevision)`, сохранив атомарный условный UPDATE. Не повторять применение пакета автоматически.

**Риск.** Совместимость потребителей, различающих текст/класс старого `Error`; actualRevision — наблюдаемая текущая версия, при третьем писателе она уже может быть выше версии победителя.

**Приёмка.** Детерминированный барьерный тест: один победитель, один типизированный конфликт expected 1 / actual 2, одна запись пакета. Отдельно закрепить тот же envelope в CLI и MCP. Принудительный CAS race MCP в этом исследовании не запускался; его потеря полей следует из общего store и inspected serializer.

### R07-B03 — непереносимая опубликованная схема draft [bug]

**Факт / триггер.** Получить `workflow.schema`, взять JSON-копию `result.draft` и скомпилировать её установленным `Ajv2020`.

**Код:** `src/authoring.ts:36-39` вкладывает NodeSchema и EdgeSchema; обе содержат собственные циклические определения Json/Expr (`src/graph.ts:73-75`). `src/service.ts:91-93` отдаёт сырой DraftSchema. Публичный patch уже отдельно проходит `portableInputSchema` (`src/authoring.ts:31-33`); draft — нет. Дедупликация named definitions существует в `src/public-schema.ts:20-48`.

**Ожидание.** Опубликованная схема черновика пригодна для самостоятельной JSON Schema-проверки клиента, в том числе незавершённого draft.

**Наблюдение, R07-E02.** Компиляция JSON-сериализованного результата закреплённым Ajv 8.20.0 завершается:

```text
reference "Json" resolves to more than one schema
```

Это ошибка построения валидатора, до проверки документа. В том же цикле `workflow`, `expression`, `create` и `patch` компилируются. Контрольное применение существующего `portableInputSchema` к draft даёт компилируемую схему, принимающую пустой корректный черновик. Исходники не менялись.

**Контрдоказательства.** Внутренний TypeBox authoring работает; CLI/MCP create/patch не заблокированы. Старый баг «patch без id» не возвращается. Доказана несовместимость с **закреплённым Ajv**, не со всеми возможными schema processors. Если считать `draft` исключительно TypeBox-представлением для чтения человеком, область дефекта уже; однако инструмент публикует его как схему рядом с переносимыми контрактами (`src/mcp-tools.ts:52`, `PROJECT_INFO/service.md:55-56`).

**Минимальная рекомендация.** Публиковать отдельную переносимую копию DraftSchema на границе `workflow.schema`, аналогично patch; внутреннюю схему не мутировать. Альтернатива — один общий cyclic bundle без повторных `$id`.

**Риск.** Сохранность литералов и имён свойств, стабильность `$ref`; не применять глобальную замену строк/ключей.

**Приёмка.** Все пять опубликованных схем отдельно компилируются pinned Ajv после JSON round-trip; draft принимает пустой черновик, отвергает лишние поля и malformed nodes. Уже существующие literal/schema-position regressions остаются зелёными.

### R07-B04 — ленивые соединения открываются после close [bug]

**Факт / триггер.** В файловой БД уже есть валидный draft. Создать новый WorkflowService, не открывавший draft/plan store; вызвать `const pending = service.dispatch('workflow.prepare', {id})`, сразу `service.close()`, затем дождаться pending и ещё раз вызвать close.

**Код:** `src/service.ts:66-69` проверяет closed только при входе; `:116` приостанавливает prepare на `await executionWorkspace`; `:118-119` после возобновления вызывает ленивые getters. В `:48-59` нет проверки closed. Первый close выставляет флаг (`:61-64`), повторный немедленно выходит. `src/prepared-plans.ts:28-40` затем реально обращается к SQLite.

**Ожидание.** Close освобождает соединения и не оставляет сервис способным заново открыть неуправляемые им ресурсы. Это не требование отменять уже созданный supervisor: документация разделяет эти действия (`PROJECT_INFO/service.md:30-32`).

**Наблюдение, R07-E02.** Без таймеров или подмены функций prepare завершился успешно **после close**. После второго close `late.drafts.list()` и `late.plans.get(preparedId)` успешно запросили БД: оба соединения всё ещё открыты. Приватные TypeScript-поля использованы только fixture-ом для наблюдения/закрытия. Новые публичные dispatch уже отвергаются как `Workflow service is closed`.

**Контрдоказательства / границы.** Нормальный `await dispatch; close()` действительно закрывает соединение. CLI использует именно этот порядок (`src/cli.ts:21,34`), поэтому обычный CLI-путь не объявляется сломанным. MCP `server.onclose` вызывает service.close (`src/mcp.ts:37`), но обрыв реального MCP в этом конкретном окне не воспроизводился: распространение туда — inference. Доказаны позднее открытие и отсутствие закрытия, не рост production RSS, постоянная блокировка БД или исчерпание дескрипторов. Соединения могут исчезнуть при GC/завершении процесса.

**Минимальная рекомендация.** Общий guard closed в ленивых getters, включая повторное использование существующих объектов; либо явно согласованный протокол завершения уже начатых dispatch с закрытием после их окончания. Для минимального исправления данного пути достаточно не разрешать новые DB-acquisitions после close. Не добавлять автоматическую отмену runs.

**Риск.** Определить поведение уже начатого запроса: контролируемая ошибка closed вместо успешного позднего prepare. Не обещать откат побочных эффектов, успевших завершиться до close.

**Приёмка.** Детерминированный immediate-close fixture не оставляет открытых draft/plan connections и не даёт повторному close пропустить новые ресурсы; обычное завершение, двойной close, отказ будущему dispatch и независимость уже созданного supervisor сохраняются.

### R07-I01 — общая диагностика неверного запроса [idea]

В R07-E02 одинаковые malformed requests отвергнуты обеими поверхностями, но сообщения/классы различаются:

- `catalog.list {extra:true}`: CLI — `Unexpected request field`, MCP — `Invalid structured output: ... additional properties`.
- `workflow.create {id:"bad/id",name:"Bad"}`: CLI — `AuthoringError`, MCP — обычный `Error` от Ajv.
- Корректно сформированный stale patch даёт одинаковый `RevisionConflictError` с полями.

Причина — предварительный Ajv в MCP (`src/mcp.ts:19,25`) и ручные проверки/TypeBox в сервисе (`src/service.ts:372-395`, `src/authoring.ts:144-146`); error-envelope сериализаторы также дублируются. **Не считаю саму разницу текста багом:** документы гарантируют оболочку и сохранение известных полей, не побайтовую идентичность сообщений всех валидаторов. На MCP text и structuredContent совпали во всех проверенных ответах.

Минимальная идея — общая сериализация ошибок и устойчивый request-validation code/path, не переписывание всего authoring и не изменение исполнения. Риск — совместимость error.name/message у клиентов. Приёмка — curated corpus одинаковых malformed JSON имеет общий машинный code/path на обеих поверхностях; semantic ошибки сохраняют operationIndex/revisions/failure. Новых лимитов, retries или approvals это не требует.

## Выполненные эксперименты

**R07-E01–E03 — исторические выполненные команды. Не запускайте их со старыми /tmp-путями:** они сохранены для аудита; для самостоятельного нового воспроизведения используйте уникальный scratch из приложения. В новой операции выполнены только R07-E04/E05.

### R07-E01 — основной профильный набор

```sh
cd /Users/ramu/.local/state/dynamicwf-evaluation-20260920/integration-dev
TMPDIR=/tmp/r07-authoring-MCi7LO/tmp node --import tsx --test --test-concurrency=1 \
  tests/authoring.test.ts tests/public-patch-schema.test.ts \
  tests/public-schema-literals.test.ts tests/json-array-boundary.test.ts \
  tests/service.test.ts tests/cli.test.ts tests/mcp.test.ts \
  tests/prepared-start.test.ts tests/skill-handoff.test.ts \
  tests/setup.test.ts tests/doctor.test.ts
```

**Результат:** exit 0, 178 passed, 0 failed/cancelled/skipped, около 123.8 s. TMPDIR предварительно создан. Набор выполнялся последовательно, не параллельно полному npm test. Только fixture-исполнители/SQLite/временные ссылки. В prepared-start имеется недостижимый agent со snapshot skill, но модель не вызывается; это не доказательство качества skill или провайдера.

### R07-E02 — собственный differential/lifecycle/CAS probe

```sh
cd /Users/ramu/.local/state/dynamicwf-evaluation-20260920/integration-dev
TMPDIR=/tmp/r07-authoring-MCi7LO/tmp node --import tsx \
  /tmp/r07-authoring-MCi7LO/contract-probes.mjs "$PWD" /tmp/r07-authoring-MCi7LO
```

Выполнено дважды: исходный probe, затем версия с дополнительными контрпроверками wrong checkpoint / null reuse / portable draft / обычного close. Оба завершились; итоговый JSON assertions подтверждает четыре описанных дефекта. Точный финальный fixture приведён ниже, SHA256 его файла: `33aa61f55b19b1300145772e8bbdbe28eee63440188cb0c139250d03da947c20`.

Границы: реальный CLI, официальный MCP client/server и SQLite; только CAS использует контролируемый барьер чтения. Live provider не участвовал. Сам fixture создаёт только свои данные и закрывает свои клиенты/соединения. Проверки специально утверждают **нынешнее дефектное поведение**; это воспроизводитель, не предлагаемый regression test после исправления.

### R07-E03 — дополнительный контроль существующих тестов

```sh
cd /Users/ramu/.local/state/dynamicwf-evaluation-20260920/integration-dev
TMPDIR=/tmp/r07-authoring-MCi7LO/tmp node --import tsx --test --test-concurrency=1 \
  --test-name-pattern='drafts persist|failed patch|continuation request parsing' \
  tests/store.test.ts tests/lineage.test.ts
```

**Результат:** exit 0, 3 passed, 0 failed, около 1.1 s. Остальные тесты этих файлов не выбирались; в частности, 24-процессный initialization test не запускался. Положительный parser-test не включает найденные `[hash]` и null cases.

### R07-E04 — сверка сохранённого и итогового пакета (выполнено сейчас)

```sh
python3 /tmp/r07-continuation-7GpzfL/verify-retained.py
python3 /tmp/r07-continuation-7GpzfL/verify-retained.py --final
```

Cwd — новый worktree. Проверены старые bytes/SHA256, JSON, 24 исходных ID, совпадение fixture, totals сохранённых тестов и assertions обеих probe summaries. После переноса проверены структура обоих отчётов, сохранение ID/классификаций и неизменность fixture. Контроль диапазонов выявил уточнение цитат store, описанное в provenance. Первая попытка сборки остановилась на SyntaxError собственного временного publish-helper до записи отчётов; final-check тогда не нашёл файлов. После исправления только helper сборка и проверка выполнены успешно; это не дефект Dynamicwf. Проверяющий скрипт только читает файлы/Git; приложение не импортирует, исторические команды не исполняет. Хеш скрипта указан в JSON. Новые итоговые SHA256 вычислены после окончательной записи и переданы в tool result.

### R07-E05 — статическая сверка study-source / publication (выполнено сейчас)

```sh
git log --oneline e15bc407da8753fd6b683c0aa4a68634e3c458a7..3d8ba65ee84402c0e3b0587f70095b7847824a9f
git diff --name-only e15bc407da8753fd6b683c0aa4a68634e3c458a7 3d8ba65ee84402c0e3b0587f70095b7847824a9f -- src tests package.json package-lock.json PROJECT_INFO skills
git show 86f5e07 -- src/parallel-isolation.ts src/workspaces.ts src/compiler.ts src/execution-plan.ts tests/parallel-authoring.test.ts
git show 3d8ba65 -- skills/dynamic-workflows/SKILL.md skills/dynamic-workflows/references/authoring.md
```

Прочитаны ровно два более поздних коммита; соответствующие правки выделены в R07-PSAF01/02. Дополнительно перечитаны `src/run-runtime.ts:237-239,264,359-372`. Сравнение байтов 13 файлов и schema declarations выполнено в E04. Новые тесты parallel-authoring прочитаны, **не запускались**. Это проверка кода и документации, не новый runtime/provider result.

## Already-fixed / refutations — study-source

- **R07-AF01 [already-fixed].** Публичный patch включает обязательный `id`; MCP и workflow.schema публикуют одну форму. Литералы `$id`/`$ref`/`$defs` не переписываются как схемы, компенсированные holes в массивах отвергаются. `src/authoring.ts:31-33,148-164`, `src/public-schema.ts:3-48`; профильные public-patch/public-schema-literals/json-array-boundary и skill-handoff прошли. R07-B03 относится только к другому полю — draft.
- **R07-AF02 [already-fixed].** CLI читает stdin асинхронно до EOF (`src/cli.ts:18-19`; в просмотренной истории есть `146193d`). Большой delayed UTF-8 тест прошёл. MCP help/startup errors не загрязняют stdout; envelope одинаков в text/structuredContent. Установленный во временный каталог executable работает из другого cwd. Это не подтверждение всех сторонних MCP hosts.
- **R07-AF03 [already-fixed / refutation].** Prepared start действительно берёт сохранённый plan, а не текущий draft: `src/service.ts:121-143`, `src/prepared-plans.ts:28-52`, `src/execution-plan.ts:89-106`, `src/run-controller.ts:113-127`. `prepared-start` прошёл, включая четыре конкурентных CLI-доставки с одной записью/эффектом, removed workspace и сохранение paused/interrupted/terminal. Отсутствие заморозки живых файлов и Git HEAD — документированная граница, не баг. Проверка не доказывает однократность произвольных внешних действий.
- **R07-AF04 [already-fixed, статическая проверка].** Skill delivery без reading tool уже блокируется: `src/catalog.ts:31-35,93-95`, `src/execution-plan.ts:125-127`; текущие документы прямо это описывают. Отдельные skill-delivery/SDK tests здесь не запускались. Исправления асинхронного владения панелью/control/await и сохранения disclosure/caret/scroll не переоткрываются; UI вне coverage r07.

## Post-study already-fixed — отдельно от находок study-source

- **R07-PSAF01 [already-fixed].** Коммит `86f5e0756e67fa7a18e925d77b7d2728db2f0627` уже добавил раннюю authoring parallel-isolation validation. На `3d8ba65ee84402c0e3b0587f70095b7847824a9f`: `src/parallel-isolation.ts:5-35`, `src/graph.ts:198-200`, `src/execution-plan.ts:94-104`, `tests/parallel-authoring.test.ts:49-173`. `patch` сохраняет редактируемый draft с `validation.valid:false`, называет writer и нужный worktree; validate/compile/prepare используют общую проверку, сохранённый план — frozen permissions. Произвольные эффекты check не выводятся, worktree не sandbox. **Повторно внедрять это не предлагается.** Проверка r07 статическая, новые regressions не исполнены.
- **R07-PSAF02 [already-fixed, документация].** Коммит `3d8ba65ee84402c0e3b0587f70095b7847824a9f` уже уточнил reviewer binding: `skills/dynamic-workflows/SKILL.md:110-115`, `skills/dynamic-workflows/references/authoring.md:128-156` на publicationRevision. Для reviewer, чья итоговая схема требует `artifactRevision`, версия должна быть верхнеуровневым полем входа; вывод копирует её точно. Хеш нового отчёта критика — не замена версии проверяемого артефакта. Runtime-проверки существовали уже на study-source: `src/run-runtime.ts:237-239,264,359-372`. Это docs-only изменение, не новое runtime поведение; **повторная правка не предлагается**. Форма произвольного runtime ref заранее не доказана статическим графом.

Эти две записи не входят в `findingCount=5` и не смешиваются с четырьмя source already-fixed/refutations. B01–B04 относятся к другим границам.

## Unknowns и предложенные, но не выполненные проверки

- **R07-U01 [unknown].** Реальные catalog/auth/provider capabilities и поведение платных вызовов не проверялись. Doctor с injected models и успешный offline MCP не подтверждают live-доступ.
- **R07-U02 [unknown].** Совместимость со сторонними MCP hosts и минимальным Node 22.19.0 не проверялась. Выполнены официальный pinned client и legacy initialize на Node 26.8.1.
- **R07-U03 [unknown].** Частота естественного CAS race и реального MCP disconnect в окне prepare не измерена. Первый дефект доказан управляемым межпроцессным schedule, второй — прямым библиотечным immediate-close. Предложены transport-specific regressions, но не добавлены.
- **R07-U04 [unknown].** Нет exhaustive differential corpus для всех полей всех 39 tools, а также доказательства стабильности полного процессного набора под нагрузкой. Известные flaky full-suite наблюдения в known-issues не превращаются в новую находку и не считаются опровергнутыми 181 успешной профильной проверкой.

## Инспектированные источники

Все file:line находок и исходных refutations относятся к sourceRevision; исключение — явно помеченный раздел post-study с publicationRevision. Основные группы:

1. `AGENTS.md`; `PROJECT_INFO/architecture.md`, `development.md`, `known-issues.md`; README — ограничения, маршрут, границы тестов.
2. `PROJECT_INFO/service.md:11-62,208-228`; `PROJECT_INFO/authoring.md:65-110`; `PROJECT_INFO/execution-plan.md`; `PROJECT_INFO/graph-contract.md`; `PROJECT_INFO/models-and-setup.md`; `skills/dynamic-workflows/SKILL.md:36-86` — заявленные контракты и onboarding.
3. `src/authoring.ts:19-172`, `src/store.ts:19-50`, `src/graph.ts:37-75`, `src/catalog.ts:31-35,66-95`, `src/output-schema.ts:6-67`, `src/public-schema.ts:3-48` — реализация границ.
4. `src/service.ts:42-143,274-283,327-399`; `src/cli.ts:8-34`; `src/mcp.ts:13-68`; `src/mcp-tools.ts:7-94`; `bin/dynamicwf.mjs:4-23` — transports и lifetime.
5. `src/execution-plan.ts:33-150`, `src/prepared-plans.ts:7-52`, `src/run-controller.ts:108-127,193-227,413-464`, `src/lineage.ts:173-261`, `src/reconciliation.ts:18-30`, `src/sqlite.ts:9-31` — фиксация, parser, хранение.
6. `scripts/setup.ts:13-56`, `src/doctor.ts:27-90`, profile tests, `tests/store.test.ts:9-75`, `tests/lineage.test.ts:20-31` — onboarding и контрдоказательства.
7. `package.json` — Node/dependency versions; фактические `git rev-parse HEAD`, профильный `git log`, исходы R07-E01/E02/E03. Внешних источников и web-доступа в исследовании нет.

Дополнение continuation (R07-S09–S12 в JSON): собственные старые md/json; retained `r07-actions.json`; сохранённые `/tmp/r07-authoring-MCi7LO/{contract-probes.mjs,profile-tests.log,parser-tests.log,probe-summary.json,probe-summary-controls.json}`; Git-diff двух post-study commits; R07-E04/E05. Источники соседних исследователей не использованы.

## Приложение: самостоятельное воспроизведение R07-E02

Это предложенная самостоятельная проверка, **не новый выполненный запуск continuation**. Для воспроизведения study-source нужна копия именно `e15bc407da8753fd6b683c0aa4a68634e3c458a7` с уже установленными зависимостями; текущий integration-dev уже на publicationRevision. Не переиспользуйте исторические каталоги и не меняйте живую установку. Из подходящей dev-копии создайте уникальный каталог, сохраните следующий JS как `$PROBE/contract-probes.mjs` и выполните команду ниже. Сам JS принимает путь исходников и **свой** scratch-каталог; рабочие БД создаёт только внутри него.

```sh
PROBE=$(mktemp -d /tmp/r07-authoring-repro-XXXXXX)
mkdir "$PROBE/tmp"
# Сохранить следующий листинг в "$PROBE/contract-probes.mjs".
TMPDIR="$PROBE/tmp" node --import tsx "$PROBE/contract-probes.mjs" "$PWD" "$PROBE"
```

<!-- R07_FIXTURE_START -->
```js
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const [dev, scratch, mode, label] = process.argv.slice(2);
const load = file => import(pathToFileURL(join(dev,file)).href);
const require = createRequire(join(dev,'package.json'));
const loader = require.resolve('tsx');
const { WorkflowService } = await load('src/service.ts');
const { DraftStore } = await load('src/store.ts');
if (mode === 'cas-worker') {
  const original = DraftStore.prototype.get;
  let first = true;
  DraftStore.prototype.get = function(id) {
    const draft = original.call(this,id);
    if (id === 'race' && first) {
      first = false;
      writeFileSync(join(scratch, `ready-${label}`), String(draft.revision));
      const deadline = Date.now()+15000;
      while (!existsSync(join(scratch,'go'))) {
        if (Date.now()>deadline) throw Error('probe barrier timeout');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);
      }
    }
    return draft;
  };
  process.argv = [process.execPath, join(dev,'src/cli.ts'),'workflow.patch','--store',join(scratch,'state.sqlite')];
  await load('src/cli.ts');
} else {
  const { RunStore } = await load('src/run-store.ts');
  const { mcpToolDefinitions } = await load('src/mcp-tools.ts');
  const { createOutputValidator } = await load('src/output-schema.ts');
  const { parseContinuationRequest } = await load('src/lineage.ts');
  const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/client')).href);
  const { StdioClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/client/stdio')).href);
  const result = {};
  const cas = await mkdtemp(join(scratch,'cas-'));
  const initial = new DraftStore(join(cas,'state.sqlite')); initial.create({id:'race',name:'Race'}); initial.close();
  const children = ['a','b'].map(name => {
    const child = spawn(process.execPath,['--import',loader,fileURLToPath(import.meta.url),dev,cas,'cas-worker',name],{stdio:['pipe','pipe','pipe']});
    let out='',err=''; child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);
    child.stdin.end(JSON.stringify({id:'race',expectedRevision:1,operations:[{op:'addGraph',graphId:name}]}));
    return {child,done:new Promise((res,rej)=>{child.once('error',rej);child.once('close',code=>{try { res({code,body:JSON.parse(out)}); } catch(e) {rej(e);} });})};
  });
  const deadline=Date.now()+15000;
  while (!['a','b'].every(x=>existsSync(join(cas,`ready-${x}`)))) { assert.ok(Date.now()<deadline); await delay(10); }
  writeFileSync(join(cas,'go'),'');
  const replies = await Promise.all(children.map(x=>x.done));
  assert.equal(replies.filter(x=>x.body.ok).length,1);
  const losing = replies.find(x=>!x.body.ok);
  assert.equal(losing.code,1); assert.equal(losing.body.error.name,'Error'); assert.equal(losing.body.error.expectedRevision,undefined);
  const check = new DraftStore(join(cas,'state.sqlite')); const final = check.get('race');check.close();
  assert.equal(final.revision,2); assert.equal(Object.keys(final.graphs).length,2);
  result.cas={readRevision:1,winningRevision:final.revision,successes:1,failure:losing.body.error,lostUpdate:false};

  const dir = await mkdtemp(join(scratch,'continuation-')); const cwd=join(dir,'workspace');await mkdir(cwd);
  const filename=join(dir,'state.sqlite'), service=new WorkflowService(filename,{cwd,availableModels:[]}), store=new RunStore(filename);
  const callCli=(tool,input)=>{const r=spawnSync(process.execPath,['--import',loader,join(dev,'src/cli.ts'),tool,'--store',filename],{input:JSON.stringify(input),encoding:'utf8',timeout:15000,cwd}); assert.ifError(r.error); return {code:r.status,body:JSON.parse(r.stdout)};};
  let client;
  try {
    await service.dispatch('workflow.create',{id:'pure',name:'Pure'});
    await service.dispatch('workflow.patch',{id:'pure',expectedRevision:1,operations:[{op:'addNode',graphId:'main',node:{id:'done',kind:'end',value:{op:'ref',path:['input']}}}]});
    const prepared=await service.dispatch('workflow.prepare',{id:'pure'});
    store.create({id:'run-fixture',plan:prepared.plan,input:null,cwd:prepared.cwd});store.requestControl('run-fixture','pause');
    const inspected=await service.dispatch('run.continuation.inspect',{id:'run-fixture'});
    assert.equal(inspected.blockers.length,0);
    const valid={preparedId:prepared.preparedId,idempotencyKey:'r07-cont',source:{runId:'run-fixture',checkpoint:inspected.checkpoint,planHash:inspected.planHash},actor:'fixture',reason:'offline contract probe',evidence:['fixture only'],workspaceDigest:inspected.workspace.digest};
    const malformed={...valid,source:{...valid.source,checkpoint:[inspected.checkpoint],planHash:[inspected.planHash]}};
    const validate=createOutputValidator(mcpToolDefinitions.find(x=>x.serviceTool==='run.continue').inputSchema);
    assert.throws(()=>validate(malformed));assert.deepEqual(parseContinuationRequest(malformed),parseContinuationRequest(valid));
    client=new Client({name:'r07-contract',version:'1'});
    const transport=new StdioClientTransport({command:process.execPath,args:['--import',loader,join(dev,'src/mcp.ts'),'--store',filename,'--cwd',cwd],stderr:'pipe'});
    transport.stderr?.on('data',()=>{});await client.connect(transport);
    const mcp=await client.callTool({name:'run_continue',arguments:malformed});
    assert.equal(mcp.isError,true);assert.equal(store.listRuns().length,1);
    const wrong=callCli('run.continue',{...valid,idempotencyKey:'r07-wrong',source:{...valid.source,checkpoint:'0'.repeat(64)}});assert.equal(wrong.code,1);assert.match(wrong.body.error.message,/checkpoint or plan changed/);assert.equal(store.listRuns().length,1);
    const cli=callCli('run.continue',malformed); assert.equal(cli.code,0);assert.equal(cli.body.ok,true);assert.equal(cli.body.result.status,'paused');
    assert.equal(store.listRuns().length,2);
    const duplicate=await client.callTool({name:'run_continue',arguments:valid}); assert.equal(duplicate.structuredContent.result.id,cli.body.result.id);
    const nullable=callCli('run.continue',{...valid,reuse:null});assert.equal(nullable.code,0);assert.equal(nullable.body.result.id,cli.body.result.id);
    const nullableMcp=await client.callTool({name:'run_continue',arguments:{...valid,reuse:null}});assert.equal(nullableMcp.isError,true);
    const errors=[];
    for (const [tool,input] of [['catalog.list',{extra:true}],['workflow.create',{id:'bad/id',name:'Bad'}],['workflow.patch',{id:'pure',expectedRevision:1,operations:[{op:'addGraph',graphId:'more'}]}]]) {
      const cli=callCli(tool,input), mcp=await client.callTool({name:tool.replaceAll('.','_'),arguments:input});
      assert.equal(cli.body.ok,false);assert.equal(mcp.isError,true);
      const text=mcp.content.find(x=>x.type==='text');assert.deepEqual(JSON.parse(text.text),mcp.structuredContent);
      errors.push({tool,cli:cli.body.error,mcp:mcp.structuredContent.error});
    }
    result.continuation={mcpError:mcp.structuredContent.error,cliAccepted:cli.body.ok,status:cli.body.result.status,persistedRuns:2,redeliveryWithStringHashesSameId:true,wrongHashRejectedWithoutNewRun:true,nullReuseAcceptedByCliAndRejectedByMcp:true,noSupervisor:cli.body.result.supervisorPid===null,nullableReuseAcceptedByParser:!!parseContinuationRequest({...valid,reuse:null}),schemaRejectsNullReuse:(()=>{try{validate({...valid,reuse:null});return false;}catch{return true;}})()};
    result.errors=errors;
    const { Ajv2020 }=await import(pathToFileURL(require.resolve('ajv/dist/2020.js')).href);
    const schemas=JSON.parse(JSON.stringify(await service.dispatch('workflow.schema',{})));
    result.schemaCompilation={};
    for(const [name,schema] of Object.entries(schemas)) {try {new Ajv2020({strict:true,allErrors:true,allowUnionTypes:true,strictTuples:false}).compile(schema);result.schemaCompilation[name]='compiled';}catch(e){result.schemaCompilation[name]=e.message;}}
    const { portableInputSchema }=await load('src/public-schema.ts');
    const portableValidate=new Ajv2020({strict:true,allErrors:true,allowUnionTypes:true,strictTuples:false}).compile(portableInputSchema(schemas.draft));
    assert.equal(portableValidate({schemaVersion:1,id:'empty',name:'Empty',revision:1,entryGraph:'main',graphs:{main:{entry:'start',nodes:[],edges:[]}}}),true);
    result.schemaCompilation.portableDraft='compiled; incomplete draft accepted';
    const normal = new WorkflowService(filename,{cwd,availableModels:[]});await normal.dispatch('workflow.inspect',{id:'pure'});normal.close();assert.throws(()=>normal.drafts.list());
    const late = new WorkflowService(filename,{cwd,availableModels:[]});
    const preparation=late.dispatch('workflow.prepare',{id:'pure'});
    late.close(); const p=await preparation;late.close();
    const draftsOpen=late.drafts.list().length>0, plansOpen=late.plans.get(p.preparedId).preparedId===p.preparedId;
    assert.ok(draftsOpen && plansOpen);await assert.rejects(late.dispatch('workflow.list'),/closed/);
    result.closeRace={returnedAfterClose:true,draftsStillOpen:draftsOpen,plansStillOpen:plansOpen,futureDispatchRejected:true,normalAwaitThenCloseClosesConnection:true};
    late.drafts.close();late.plans.close(); // only fixture cleanup; normal close is a no-op
  } finally {await client?.close();store.close();service.close();await rm(dir,{recursive:true,force:true});await rm(cas,{recursive:true,force:true});}
  console.log(JSON.stringify(result,null,2));
}
```
<!-- R07_FIXTURE_END -->
