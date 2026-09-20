# r01 — Корректность графа, выражений и компилятора

## Metadata

- **ID:** r01.
- **Тема:** Корректность графа, выражений и компилятора.
- **Исходная ревизия:** `e15bc407da8753fd6b683c0aa4a68634e3c458a7`.
- **Дата:** 2026-09-20 (UTC).
- **Характер работы:** независимое исследование без реализации, завершение сохранённого пакета в новой операции. Исторический отчёт относил HEAD старого worktree и тогдашнего dev к study-source. Сейчас независимо проверено: HEAD нового фактического cwd — study-source, HEAD integration-dev — publication revision ниже. Запись — только два назначенных отчёта в новом cwd.
- **Среда исторических проверок E01–E09:** Node `v26.8.1`; существующие зависимости integration-dev, без установки. Исходники и тесты экспортированы через `git archive` в собственный `/tmp/r01-graph-compiler.PkapHE`; зависимости подключены симлинком. Исходники, tests, PROJECT_INFO, package/lock и integration-dev не изменялись.
- **Итого:** 3 воспроизведённых `bug`, 1 `unknown`, 3 `already-fixed`/опровержения. `findingCount = 7` включает все семь записей ниже, а не семь новых дефектов. 143/143 профильных регрессии прошли в исходном исследовании; сохранённые агрегаты перепроверены чтением, тесты в continuation не перезапускались.

## Continuation provenance — новая операция, не повтор старого writer

- **sourceRun:** `run-babf9b25-b8f5-45ad-b79c-2b2e5d31d2f0`; **новая операция:** `run-9dbb044c-664f-4dd8-96c0-57192dc4ed89`, тот же ID `r01`, новый cwd из runtime.
- **Study-source** остаётся `e15bc407da8753fd6b683c0aa4a68634e3c458a7`; **publication revision** — `3d8ba65ee84402c0e3b0587f70095b7847824a9f`. Последний HEAD dev прочитан только Git-командой, ничего в dev не записывалось.
- По retainedEvidence старая операция имела статус **failed** (provider/execution, HTTP 429, effects unknown). Поле `metadata.status=complete` в старом JSON — запись автора файла, **не доказательство успешной сдачи** прежней операции. Новый complete относится к завершению и проверке этого пакета, не к повтору внешнего действия или устранению причины 429.

Проверенные исходные файлы **своей** старой ветви:

| Файл | Байты | SHA256, совпал с retainedEvidence |
|---|---:|---|
| `r01-graph-compiler.md` | 42455 | `f3f3e692d85d4cae7577d72cd61b9095a108d7bab14a0b002fd20f040e9a9364` |
| `r01-graph-compiler.json` | 36578 | `4a588ab8dd8a5b34e1f09c3a3240562718daf68de4869de1e6cf78d2b3a0b308` |

Оба файла полны по основным находкам и трём главным воспроизводителям, но пакет не был полностью согласован: JSON ссылался на отсутствовавшие полные fixtures E03/E07/E08; некоторые диапазоны ссылок выходили за EOF. Поэтому это **перенос с ограниченным дополнением**, а не побайтовая копия и не ранее успешный выход.

**Перенесено:** все семь исходных ID/классификаций, причины B01–B03, исторические наблюдения E01–E09 и рекомендации без внедрения. **Перепроверено сейчас:** исходные SHA256/размеры/JSON; все четыре core-файла; критические file:line и контрдоказательства; равенство 20 текущих/сохранённых source/test-файлов байтам Git study-source; согласованность семи ID в MD/JSON; сохранённые итоги тестов 131+12, fail/skip=0. Проверено соответствие восьми оставшихся TS-fixtures буквальным текстам в `r01-actions.json` с тремя явно просмотренными строковыми исправлениями harness. Команды из actions **не исполнялись**. Три уже встроенных TS-блока старого MD совпали с файлами fixtures.

**Добавлено:** полные E03/E07/E08 и обе exploratory fixtures E09 из собственных сохранённых материалов; исправлены диапазоны `expressions.ts` до 134, `generated-module.ts` до 39, `mcp-tools.ts` до 94; явно разделены фазы и post-study already-fixed. Для U01 добавлено контрдоказательство из уже существовавшего транспортного контракта. Новых продуктовых находок и новых behavioral tests нет.

`preservedActionEvidence` имеет SHA256 `5510cce0b7edb1ef7b1632daf587fe664739a794691f0c4b89c7c6aacb868e4f`; это **список команд, не журнал их stdout/exit**. Для E03–E09 исходы перенесены из старых отчётов и сверены со смыслом кода/fixture, а не заново наблюдались. Для E01/E02 дополнительно сохранились локальные summaries: `baseline.tap` SHA256 `64f96a4a8a418d37f1050b49adff25d774181d0ade5cb56c43c3952de7ec61e9`, `boundaries.tap` SHA256 `70df526a00b03ea38250f5cdb3be6f81c0cb67a93ef1df3b3915217c7fa5ec11`. Сырые логи не публикуются.

Старая ветвь и `/tmp/r01-graph-compiler.PkapHE` только читались. Соседние отчёты не читались. Новые providers, live run, процессы исполнителей, SSH, установки и модельные команды не запускались.

## Краткий вывод

| ID | Класс | Вывод |
|---|---|---|
| r01-B01 | bug | Сортировка ключей компилятором меняет порядок вычисления `object.fields`; внутри `exists` это меняет fallback на ошибку маршрутизации. Контрпример — обычный JSON. |
| r01-B02 | bug | Прямая граница `validateWorkflow` пропускает массив с компенсированной дыркой и унаследованным getter; выполняет getter, принимает граф, после `parseWorkflow` граф уже невалиден, сгенерированный результат — `[]`. Только внутрипроцессный API, не JSON-транспорт. |
| r01-B03 | bug | `workflow.schema.draft` содержит повторные `$id: Json` и не компилируется стандартным Ajv2020. Уже исправленная публичная схема patch этого дефекта не имеет. |
| r01-U01 | unknown | `-0` сохраняется прямым evaluator, но становится `0` в compiled source. Побитовый контракт не определён; различия решения графа не показано, поэтому не bug. |
| r01-AF01 | already-fixed | Обычные компенсированные дырки в authoring/output действительно отклоняются; прежнюю ошибку этих двух границ не переоткрывать. |
| r01-AF02 | already-fixed | Литералы `$id/$ref/$defs` при переносе схем сохраняются; публичный patch требует `id`. |
| r01-AF03 | already-fixed | `chooseEdge` и `explainEdge` используют один routing core, сохраняют приоритет условий, fallback и short-circuit. |

Главный практический приоритет — B01: это расхождение семантики экспортированного evaluator и сгенерированного исполнения на допустимом графе. B02 важен как нарушение явно обещанной границы `unknown → проверенный JSON`, но не является удалённым выполнением кода из JSON. B03 затрагивает публикацию схемы, а не работоспособность внутренних операций над черновиками.

## Coverage

### Прочитано и сопоставлено в исходном исследовании

По сохранённому отчёту сначала прочитаны `AGENTS.md`, `PROJECT_INFO/architecture.md`, `development.md`, `known-issues.md`, затем полностью `graph-contract.md`, профильные разделы `authoring.md` и `execution-plan.ts`, текущий `git log` и история целевых файлов. Последние изменения skill delivery и панели учтены как контекст; их старые симптомы не выносятся в дефекты и их профильные UI/SDK-тесты здесь не запускались.

Основные файлы прочитаны полностью: `src/graph.ts`, `src/expressions.ts`, `src/compiler.ts`, `src/public-schema.ts`. Дополнительно исследованы `authoring.ts`, `output-schema.ts`, `generated-module.ts`, `runtime-contract.ts`, `compiler-versions.ts`, `run-runtime.ts`, `mcp-tools.ts`, релевантные участки `service.ts`/`execution-plan.ts`, тесты и schema fixtures.

| Область | Что реально проверено | Граница вывода |
|---|---|---|
| Схема графа | Ссылки/дубликаты/достижимость/структурный путь к end, запрет рекурсии, строгие AST/config, snapshots, ранняя компиляция outputSchema | Структурный путь не доказывает завершение произвольного цикла; это документированный контракт, не баг |
| Выражения | `select`, `all`, `any`, `exists`, строгий boolean, MissingReference, JSON equality, собственные поля, отрицательные ветви | Не создавался второй полный production interpreter; сравнивались прямой evaluator/route и реально загруженный generated module |
| Компилятор | Реальные TypeScript diagnostics сгенерированных модулей в существующем compiler suite; loops, map/parallel/subworkflow, порядок результатов, scopes, legacy-v3, v9 reuse | Не проверялись все старые версии компилятора и все runtime feature combinations |
| Scopes/replay | Дополнительный map из двух экземпляров двухпроходного цикла; узел `constructor`; 16 уникальных activation keys; replay пропускает работу завершённого map | Replay в этом дополнительном probe — детерминированная cache fixture, не crash/recovery supervisor |
| Публичные схемы | Сохранение literal data, merge definitions, escaping, idempotence; настоящий ответ `WorkflowService.dispatch('workflow.schema')` | Сервис только `:memory:`, без запуска workflow/controller/provider |
| JSON corner cases | Компенсированные дырки, exotic array prototype/getter, detached snapshot, signed zero | Не доказана защита от произвольных Proxy/traps; JSON CLI/MCP не переносит prototype/getter |

Не запускались полный `npm test`, live provider, pi/dynamicwf/subagents, SSH, реальные пользовательские run, браузер или recovery пользовательского журнала. Веб не использовался. Успешные offline fixtures не являются свидетельством о live provider.

## Находки

### r01-B01 — Канонизация `object.fields` меняет наблюдаемую семантику `exists`

**Класс:** bug. **Приоритет:** средний. **Уверенность:** воспроизведено на текущей ревизии, включая настоящий `JournalRuntime` с отдельными in-memory БД.

**Факты кода:**

- `src/compiler.ts:17-23` рекурсивно сортирует **все** ключи объектов, затем восстанавливает данные через `JSON.parse`; рёбра проходят через это в `src/compiler.ts:68`, узлы — в `src/compiler.ts:121`.
- `src/expressions.ts:54` обходит `object.fields` в порядке `Object.entries`, вычисляя каждый элемент немедленно.
- `src/expressions.ts:56-58`: `exists` возвращает `false` только при `MissingReference`; другую ошибку не подавляет. Это закреплено `tests/expressions.test.ts:28-36`.
- `src/run-runtime.ts:126-134` сохраняет решение `explainEdge`, затем превращает его ошибку в routing failure.

**Триггер:** условие ребра ниже, поля именно в порядке `z`, затем `a`; вход `{flag: 1}`, поля `missing` нет:

```json
{"op":"exists","value":{"op":"object","fields":{"z":{"op":"ref","path":["input","missing"]},"a":{"op":"not","value":{"op":"ref","path":["input","flag"]}}}}}
```

**Ожидание:** generated execution и прямые `evaluate`/`chooseEdge` одного принятого AST должны совпадать по успеху/ошибке и выбору перехода. Конкретная политика порядка полей может быть определена явно; незаметно разные политики у двух путей — дефект.

**Наблюдение:**

1. `validateWorkflow` принимает граф. `evaluate` исходного AST даёт `false`; `chooseEdge`/`explainEdge` выбирают fallback `no`.
2. Generated module сначала вычисляет `a` и падает с `Condition must return a boolean`, не доходя до `z`.
3. В offline `JournalRuntime` исходные рёбра дают терминальный результат `no`, `reason: fallback`, успешные активации `start` и `no`. Тот же compiled plan даёт `reason: error`; успешна только `start`, терминальный узел не допущен.
4. Перестановка полей в исходном AST меняет прямой результат, но **не меняет source hash**. Значит, предположение канонизатора о незначимости порядка конфликтует с порядком evaluator.

**Причина:** отсутствие значения и ошибка типа — разные эффекты evaluator. Порядок вычисления становится наблюдаемым через `exists`, хотя ключи JSON-объекта считаются незначимыми для хеша.

**Контрдоказательства / границы:**

- При `flag: true` и `flag: false` оба пути выбирают `no`.
- Обычные `select(exists(ref), then, otherwise)`, `all`/`any` short-circuit работают; это не переоткрытие общего lazy-evaluation дефекта.
- При исходном порядке `a,z` ошибка есть и в прямом evaluator.
- Это не инъекция кода и не изменение массива рёбер: меняются вложенные поля AST. В проекте нет отдельного production interpreter всего графа; сравнение относится к экспортированным expression/routing API и generated runtime.

**Воспроизведение:** E03 (`probe-parity.ts`), E04 (`probe-journal-parity.ts`); полная fixture E04 приведена ниже.

**Минимальное изменение, не внедрено:** определить единый порядок вычисления `object.fields` и использовать его в evaluator. Например, обход отсортированных ключей согласует оба пути и сохраняет детерминированный source hash; нужно отдельно учесть числоподобные имена полей. Альтернатива — сохранять порядок значимых AST-полей при сериализации, но это меняет контракт канонического source/hash и требует решения о версии компилятора.

**Риск:** изменение приоритета ошибок в прямом API; при изменении сериализации — несовместимость сохранённых source/hash. `evaluate` также загружается старыми generated modules, поэтому политику нужно проверить на legacy fixtures, а не только на v9.

**Критерий приёмки:** для обеих перестановок `z/a`, числоподобных ключей, valid/invalid boolean и присутствующего/отсутствующего поля прямой evaluator, `chooseEdge`, `explainEdge` и загруженный module совпадают по результату или типу/смыслу ошибки. Политика documented; existing lazy/legacy regressions сохранены. Нельзя просто подавить все ошибки внутри `exists`.

### r01-B02 — `validateWorkflow` пропускает exotic array и выполняет унаследованный код

**Класс:** bug. **Приоритет:** средний для прямого TS API; низкая применимость к обычному JSON-транспорту. **Уверенность:** воспроизведено.

**Факты кода:** `src/graph.ts:77-79` прямо обещает защиту до schema walking, включая getters и unusual prototypes. Но `src/graph.ts:85` исключает массивы из проверки prototype; `src/graph.ts:89` сравнивает только количество enumerable keys с `length`. `Check` вызывается в `src/graph.ts:101`. `parseWorkflow` клонирует уже принятый объект в `src/graph.ts:243-246`.

**Триггер:** массив длины 1 без собственного индекса `0`, с собственным `extra:42` и prototype, наследующим `Array.prototype` и определяющим getter `0 → 7`. Этот массив — literal в единственном end-узле.

**Ожидание:** отказ до getter/TypeBox walking; `parseWorkflow`, если принял значение, должен возвращать валидный snapshot без потери принятого содержимого.

**Наблюдение:**

- `validateWorkflow` возвращает `{valid:true,issues:[]}` и вызывает getter один раз.
- `parseWorkflow` снова вызывает getter; snapshot имеет `length=1`, свойство `extra`, но собственного `0` нет. Повторный `validateWorkflow(snapshot)` уже возвращает false.
- `compileWorkflow` принимает исходник, вызывает getter ещё раз; canonical array serialization пропускает дырку. Реально загруженный модуль возвращает пустой массив `[]`.
- Отдельная dense `Array`-subclass в `graph.nodes` с переопределённым `entries()` также принимается; во время validation метод вызывается 3 раза. Поэтому одного исправления подсчёта ключей недостаточно для обещания «не исполнять inherited code».

**Причина:** граф имеет собственную, более слабую JSON-границу; последующий TypeBox читает унаследованный индекс, а structuredClone убирает этот prototype. Успех проверки и смысл snapshot расходятся.

**Контрдоказательства / границы:**

- **Обычные** компенсированные дырки без prototype (`extra`, `01`, `-1`, `4294967295`) в graph literal всё же отвергаются TypeBox. По одному сравнению длины нельзя было объявлять их обходом; это проверено отдельно.
- `output-schema.assertJson` и `applyPatch` отвергают именно описанную sparse fixture **без getter**: `src/output-schema.ts:13-15`, `src/authoring.ts:154-156`. Исправление этих двух границ действительно есть.
- `JSON.parse` не может создать такой prototype/getter. Продемонстрировано нарушение прямого `unknown` API, а не запуск JavaScript из графа, доставленного по JSON. Полный путь подготовки плана дополнительно имеет строгий `assertJson`; прохождение до реального запуска не заявляется.

**Воспроизведение:** E05, `probe-exotic-array.ts`, ниже; assertions включают compiled output, getter counts и отрицательные controls.

**Минимальное изменение, не внедрено:** в graph JSON preflight проверять точную последовательность собственных индексов, как уже сделано в authoring/output; до schema walking либо отвергать nonstandard array prototypes, либо обходить массивы без вызова их переопределяемых методов. После этого убрать дублирование логики JSON-границы настолько, насколько допускает совместимость диагностик.

**Риск:** array subclasses / cross-realm arrays, ранее принимавшиеся прямым API, могут стать недопустимыми; необходимо явно определить эту границу. Простое исправление count-check устраняет sparse bypass, но не dense subclass callback.

**Критерий приёмки:** обе exotic fixtures отклоняются до getter/`entries`; обычные плотные, frozen и shared noncyclic JSON остаются допустимыми; `validateWorkflow(x).valid` в поддерживаемом домене влечёт `validateWorkflow(parseWorkflow(x)).valid`; compile не превращает принятый массив длины 1 в `[]`.

### r01-B03 — Публичная схема `draft` не перенесена в единый local-ref bundle

**Класс:** bug. **Приоритет:** средний для потребителей `workflow.schema`. **Уверенность:** воспроизведено через настоящий публичный service method.

**Факты кода:**

- `src/authoring.ts:36-39` встраивает `NodeSchema` и `EdgeSchema`, каждый со своим cyclic `$defs` (`src/graph.ts:73-74`).
- `src/service.ts:91-93` возвращает внутренний `DraftSchema` напрямую как публичную JSON Schema.
- Для patch уже применяется `portableInputSchema`: `src/authoring.ts:30-33`; helper умеет объединять определения (`src/public-schema.ts:20-48`).

**Триггер:** получить `workflow.schema` у `WorkflowService(':memory:')`, сделать обычный JSON roundtrip ответа и скомпилировать `schemas.draft` отдельным `new Ajv2020({strict:true,allowUnionTypes:true})`.

**Ожидание:** опубликованная полная схема черновика компилируется как самостоятельный документ и может проверить `createDraft(...)`.

**Наблюдение:** ошибка **`reference "Json" resolves to more than one schema`** ещё до проверки любого черновика. Одинаковые `$id:Json` находятся в definitions под `graphs/.../nodes/items` и `graphs/.../edges/items`. При `strict:false` ошибка та же. Вызов существующего `portableInputSchema(schemas.draft)` устраняет неоднозначность: та же Ajv принимает созданный draft и отвергает extra property.

**Контрдоказательства / границы:**

- Внутренний `Check(DraftSchema,draft)` успешен — это не поломка authoring TypeBox API.
- Публичный `patch` компилируется и принимает корректный запрос с `id`; уже исправленный patch не переоткрывается.
- Отдельная компиляция опубликованных `workflow`/`expression` в exploratory probe с `strict:false` успешна; утверждение не распространяется на все схемы ответа.
- Запуска workflow, чтения credentials и сетевого запроса в fixture нет: service создан с `:memory:`, вызван только `workflow.schema`.

**Воспроизведение:** E06, `probe-schema-service.ts`, ниже.

**Минимальное изменение, не внедрено:** на границе публикации возвращать portable-копию DraftSchema, оставив внутреннюю TypeBox-схему неизменной; добавить регрессию всего ответа `workflow.schema`, а не только patch.

**Риск:** внешние потребители, привязанные к текущим named `$id`, увидят другую форму ссылок; набор принимаемых JSON-черновиков должен остаться прежним. Не нужно ослаблять Ajv strictness — конфликт сохраняется и без неё.

**Критерий приёмки:** каждый публикуемый schema document отдельно компилируется используемым стандартным валидатором после JSON roundtrip; draft принимает пустой корректный черновик и отвергает неизвестные поля; patch/id и literal-preservation regressions проходят; internal DraftSchema не меняет семантику.

### r01-U01 — Signed zero: наблюдаемое различие, но недостаточно оснований для bug

**Класс:** unknown — неизвестна требуемая семантика знака нуля.

`src/expressions.ts:50` через structuredClone сохраняет `Object.is(value,-0)`, тогда как `src/compiler.ts:18` сериализует `-0` как `0`. E08 подтвердил: parsed JSON `-0` принят; прямой результат имеет знак минус, generated — нет; source hashes для ±0 одинаковы. Контрдоказательство против объявления bug: DSL equality (`src/expressions.ts:36-37`) считает их равными, JSON.stringify обоих даёт `0`; расхождения переходов/данных после JSON-транспорта не показано. В существующей accepted fixture signed zero допускается (`tests/json-array-boundary.test.ts`), но это не определяет побитовую семантику компилятора.

**Дополнительно проверено в continuation:** `PROJECT_INFO/execution-plan.md:171-174` прямо описывает нормализацию `-0 → 0` для идемпотентной JSON-доставки. Для транспорта это ожидаемое поведение, не unknown. Неопределённым здесь остаётся только побитовый контракт прямого evaluator относительно compiler. Новый тест не запускался.

**Рекомендация, не внедрена:** сначала зафиксировать, является ли Json числовой/JSON-эквивалентностью или требует сохранения signed zero; затем добавить один прямой/generated/transport test. **Риск:** попытка сохранять `-0` меняет source/hash без продемонстрированной пользовательской пользы. **Приёмка:** явный единый контракт, а не автоматическое объявление ещё одного bug.

## Already-fixed / опровержения на study-source

### r01-AF01 — Строгие массивы authoring/output уже исправлены

**Класс:** already-fixed. История `7209b98f0e221f692a5712d64e363c32ba08ba0b` меняла authoring/output и добавила `tests/json-array-boundary.test.ts`; текущие `src/authoring.ts:154-156` и `src/output-schema.ts:13-15` проверяют имена индексов, не только количество ключей. Профильный suite прошёл. E05 дополнительно проверил отказ на exotic sparse fixture без getter. Это не отрицает отдельно воспроизведённый B02 в `graph.ts`; там другая реализация границы. Рекомендация — сохранить защиту и включить graph в общую матрицу. Риск переноса — изменение диагностик; приёмка — прежние accepted/rejected cases без побочных вызовов.

### r01-AF02 — Literal-preserving перенос и публичный patch/id уже исправлены

**Класс:** already-fixed. `0894d1f9a6eb5ac7b37160af3c6466c0057b83f8` изменил перенос схем; теперь `src/public-schema.ts:38-41` различает schema positions и JSON data. `const`/`enum`/`default`/`examples`, имена `$id/$ref/$defs/__proto__`, escaped refs, repeated definitions и конфликтующие определения проверены существующим suite. `src/authoring.ts:33` публикует patch вместе с `id`; `tests/public-patch-schema.test.ts:8-33` прошёл, включая настоящий service patch. Рекомендация — не возвращать универсальный рекурсивный rewrite всех объектов. Риск такого упрощения — изменение допустимых literal data; приёмка — сохранение текущих regressions. B03 относится только к ещё не преобразованному draft.

### r01-AF03 — Routing core и short-circuit согласованы

**Класс:** already-fixed. После `9ea773400c0a52193700bfc60c028675b67bfe8b` `chooseEdge` и `explainEdge` используют общий `routeEdge` (`src/expressions.ts:85-134`). E01 прошёл независимое сравнение 781 последовательности рёбер, каждую с/без посторонних рёбер, плюс точные traces и falsy thrown values. Никакой общей ошибки «fallback раньше condition» или «explain вычисляет хвост» не обнаружено. Рекомендация — сохранить core и дополнить его compiled-AST parity fixture B01, не писать второй router. Риск — тестировать два wrapper одного core как независимые реализации; приёмка — сравнение с внешним reference и generated module.

## Выполненные эксперименты — исходное исследование

E01–E09 выполнены в sourceRun, не повторены в continuation. Наблюдения ниже исторические; текущая проверка материалов описана отдельно. Все команды выполнялись последовательно, без полного `npm test`. `$P` в таблице — `/tmp/r01-graph-compiler.PkapHE`. Указанные probe files — собственные временные fixtures, не новые repository tests.

| ID | Команда из `$P` | Наблюдаемый исход | Граница |
|---|---|---|---|
| E01 | `node --import tsx --test --test-concurrency=1 tests/graph.test.ts tests/expressions.test.ts tests/compiler.test.ts tests/routing-equivalence.test.ts tests/json-array-boundary.test.ts tests/public-schema-literals.test.ts` | 131 pass, 0 fail/skip; generated TS diagnostics успешны внутри compiler suite | Offline, mock runtime, не live model; не полный typecheck проекта |
| E02 | `node --import tsx --test --test-concurrency=1 tests/public-patch-schema.test.ts tests/campaign-schema.test.ts tests/authoring.test.ts` | 12 pass, 0 fail/skip | Local schema/service fixtures, без запуска run |
| E03 | `node --import tsx probe-parity.ts` | B01: direct false/fallback, generated boolean error; hash одинаков при перестановке полей; оба boolean controls дают fallback | Простой injectable runtime, не журнал |
| E04 | `node --import tsx probe-journal-parity.ts` | B01 подтверждён в `JournalRuntime`: original AST fallback/no против generated error, разные traces/набор допущенных узлов | Два собственных RunStore `:memory:`, без supervisor/workers |
| E05 | `node --import tsx probe-exotic-array.ts` | B02: getter counts 1/2/3; valid→invalid snapshot; generated `[]`; dense subclass entries=3; 4 обычных hole controls rejected | In-process non-JSON fixture; authoring/output reject до getter |
| E06 | `node --import tsx probe-schema-service.ts` | B03: raw draft Ajv compile error; portable draft accepts; patch compiles; TypeBox accepts | Service `:memory:`, только schema dispatch |
| E07 | `node --import tsx probe-scopes.ts` | 16 уникальных активаций; visits 0/1 локальны двум map items; сохранены prior feedback/input; cache replay только fan/done; 7 lazy controls | Cache fixture не заменяет crash-recovery тесты |
| E08 | `node --import tsx probe-zero.ts` | Direct -0, generated +0, одинаковый source hash, DSL eq=true, wire=`0` | Только факт; продуктовая ошибка не установлена |
| E09 | `node --import tsx probe-boundaries.ts`; `node --import tsx probe-public.ts` | Обычные compensated holes отвергнуты; draft конфликтует и при strict:false, workflow/expression/patch отдельно компилируются | Exploratory checks; не весь JSON Schema vocabulary |

Два начальных черновика probes имели синтаксические опечатки в самих временных fixtures; после исправления только в `/tmp` повторные запуски успешны. Они не учитываются как продуктовые ошибки. Сырые логи не публикуются.

## Post-study already-fixed — отдельно от находок на базе

Эти две записи — контекст публикации, **не новые находки study-source**, не входят в `findingCount=7`. Проверены через Git objects и diff, без запуска новых suites.

- **r01-PSAF01 — already-fixed, publication context.** `86f5e0756e67fa7a18e925d77b7d2728db2f0627` добавил раннюю `parallelWriterIsolationIssues` после успешной проверки ссылок/циклов/config: на publication `src/graph.ts:198-199`; общая чистая проверка — `src/parallel-isolation.ts:6-36`; compiler передаёт frozen agents в `src/compiler.ts:28-29`, проверка сохранённого плана — `src/execution-plan.ts:94-104`. Авторинг и compile теперь используют эту границу, а не откладывают её только до подготовки. Повторно внедрять не предлагается; произвольные эффекты `check` этим не выводятся. Новые `parallel-authoring`/`parallel-reports-recipe` suites отмечены в истории, **здесь не запускались**.
- **r01-PSAF02 — already-fixed, исправление документации.** `3d8ba65ee84402c0e3b0587f70095b7847824a9f`: `skills/dynamic-workflows/SKILL.md:110-114` и `skills/dynamic-workflows/references/authoring.md:128-156` явно требуют верхнеуровневую входную `artifactRevision` для соответствующей reviewer schema и точное копирование версии рецензируемого артефакта, не хеша нового отчёта критика. Изменение документации просмотрено; runtime binding заново не исследовался, поведенческое исправление этим коммитом не заявляется. Повторно дописывать эти инструкции не предлагается.

**Сопоставление с B01–B03:** diff study-source→publication не меняет `canonical`, evaluator, graph `jsonIssue`/клонирование, DraftSchema, portable helper или публикацию `workflow.schema`. Поэтому по исходникам причины остаются применимы. Это **инференс по коду**, не новое воспроизведение на publication. В частности, точное число вызовов `entries()` в B02 относится только к study-source: новая изоляционная проверка добавляет обход, и прежнее число нельзя автоматически переносить.

## Проверки continuation — действительно выполнены сейчас

| ID | Команда / метод | Исход | Граница |
|---|---|---|---|
| r01-C01 | `shasum -a 256` и `wc -c` двух назначенных файлов своей старой ветви; `json.loads` | Оба SHA256 и размера совпали; JSON валиден, файлы не symlink | Не доказывает успешную сдачу старой операции |
| r01-C02 | `git rev-parse HEAD`; `git -C <integration-dev> rev-parse HEAD`; `git log --oneline <source>..<publication>`; `git show`/`git diff` профильных файлов и двух коммитов | cwd=study-source, dev=publication; причины находок сверены по коду, два post-study изменения учтены отдельно | Без checkout, Git-записей и без исполнения publication code |
| r01-C03 | Inline `python3`: byte equality 20 файлов с `git show <source>:<path>`; чтение агрегатов сохранённых TAP | Все 20 совпали в cwd и старой offline-копии; 131+12 pass, fail/skip=0 | Не хешировались весь archive, Node binary и все зависимости; тесты не повторены |
| r01-C04 | Inline `python3`: извлечение TS heredoc и только строковых replace из AST команд (без `eval`/`exec`), сравнение файлов/MD; проверки ID и file:line | 8 fixtures согласованы, 3 существовавших TS-блока совпали; найдены и исправлены отсутствующие блоки и диапазоны ссылок | Это проверка материала и синтаксически явных строк, не исполнение старых команд или повтор наблюдений E03–E09 |

Исходные полные команды E01–E09 доступны в preservedActionEvidence; новые inline-проверки читают данные, а не запускают эти команды. Окончательные JSON, ссылки, разрешённые пути записи и SHA256 обоих отчётов проверяются перед сдачей. Полный npm test, новые behavioural probes и предложенные исправления не выполнялись.

## Воспроизводители

### Подготовка offline-копии

Для независимого будущего воспроизведения выполнить из worktree исходной ревизии. В continuation этот setup не запускался; никогда не используйте прежний `$P` как место записи. Все создаваемые модули/БД/файлы остаются под собственным префиксом `/tmp/r01-*`. Никакой установки пакетов:

```sh
DEPS=/Users/ramu/.local/state/dynamicwf-evaluation-20260920/integration-dev/node_modules
P=$(mktemp -d /tmp/r01-graph-compiler.XXXXXX)
git archive e15bc407da8753fd6b683c0aa4a68634e3c458a7 src tests package.json tsconfig.json | tar -x -C "$P"
ln -s "$DEPS" "$P/node_modules"
cd "$P"
```

Ниже — полные сохранённые fixtures (E03/E07/E08/E09 дополнены при continuation, без повторного исполнения); записать каждую под указанным именем в `$P`, запускать командой из таблицы. Они используют установленный tsx, поэтому TS assertions `as any` здесь только сокращают harness, не обходят `compileWorkflow`/`prepareExecutionPlan` validation.

### E04 / `probe-journal-parity.ts`

```ts
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import { prepareExecutionPlan } from './src/execution-plan.ts';
import { RunStore } from './src/run-store.ts';
import { JournalRuntime } from './src/run-runtime.ts';
import { loadGeneratedModule } from './src/generated-module.ts';
import { evaluate } from './src/expressions.ts';
const literal=(value:any)=>({op:'literal',value});
const expression={op:'exists',value:{op:'object',fields:{z:{op:'ref',path:['input','missing']},a:{op:'not',value:{op:'ref',path:['input','flag']}}}}};
const workflow:any={schemaVersion:1,id:'parity',name:'Parity',revision:1,entryGraph:'main',graphs:{main:{entry:'start',nodes:[{id:'start',kind:'branch'},{id:'yes',kind:'end',value:literal('yes')},{id:'no',kind:'end',value:literal('no')}],edges:[{from:'start',to:'yes',when:expression},{from:'start',to:'no'}]}}};
const input={flag:1};
const plan=await prepareExecutionPlan(workflow,{cwd:process.cwd(),availableModels:[]});
const loaded=await loadGeneratedModule(plan,'./generated-journal-parity');
for (const mode of ['original-AST','generated']) {
 const store=new RunStore(':memory:');
 try{
  store.create({id:'r01-fixture',plan,input,cwd:process.cwd()});
  const {token,run}=store.reserveLaunch('r01-fixture');
  const runtime=new JournalRuntime(store,run,token,process.cwd());
  const original=Effect.gen(function*(){
   const nodes:any=Object.create(null),context={graphId:'main',nodeId:'start',scope:['graph','main'],visit:0};
   nodes.start=yield* runtime.step(context,()=>Effect.succeed(structuredClone(input)));
   const to=yield* runtime.route(context,plan.workflow.graphs.main.edges,{input,nodes});
   const terminal:any=plan.workflow.graphs.main.nodes.find(n=>n.id===to);
   return yield* runtime.step({...context,nodeId:to},()=>Effect.try({try:()=>evaluate(terminal.value,{input,nodes}),catch:e=>e as Error}));
  });
  const result=await Effect.runPromise(Effect.either(mode==='generated'?loaded.run(runtime,input):original));
  const trace=store.transitions('r01-fixture').records.map(r=>r.decision);
  const activations=store.listActivations('r01-fixture').map(a=>({node:a.context.nodeId,status:a.status}));
  console.log(JSON.stringify({mode,result:result._tag==='Right'?result.right:{error:result.left.message},trace,activations}));
  assert.equal(trace[0].reason,mode==='generated'?'error':'fallback');
 }finally{store.close();}
}
```

### E05 / `probe-exotic-array.ts`

```ts
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import { validateWorkflow, parseWorkflow } from './src/graph.ts';
import { compileWorkflow } from './src/compiler.ts';
import { loadGeneratedModule } from './src/generated-module.ts';
import { assertJson } from './src/output-schema.ts';
import { createDraft, applyPatch } from './src/authoring.ts';
const w=(value:any):any=>({schemaVersion:1,id:'probe',name:'Probe',revision:1,entryGraph:'main',graphs:{main:{entry:'done',nodes:[{id:'done',kind:'end',value:{op:'literal',value}}],edges:[]}}});
let calls=0;
const proto=Object.create(Array.prototype,{'0':{get(){calls++;return 7;}}});
const a=Object.assign(new Array(1),{extra:42});
Object.setPrototypeOf(a,proto);
const workflow=w(a);
assert.deepEqual(validateWorkflow(workflow),{valid:true,issues:[]});
assert.equal(calls,1);
assert.throws(()=>assertJson(workflow),/sparse or extended array/);
assert.throws(()=>applyPatch(createDraft({id:'draft',name:'Draft'}),{expectedRevision:1,operations:[{op:'addNode',graphId:'main',node:workflow.graphs.main.nodes[0]}]}),/sparse or extended arrays/);
assert.equal(calls,1,'strict boundaries must not call the inherited getter');
const parsed=parseWorkflow(workflow), value=(parsed.graphs.main.nodes[0] as any).value.value;
assert.equal(calls,2);
assert.equal(Object.hasOwn(value,'0'),false);
assert.equal(value.length,1);
assert.equal(validateWorkflow(parsed).valid,false);
const compiled=compileWorkflow(workflow);
assert.equal(calls,3);
const module=await loadGeneratedModule({source:compiled.source,sourceHash:compiled.hash} as any,'./generated-exotic-array');
const result=await Effect.runPromise(module.run({step:(_c:any,work:any)=>Effect.suspend(work)} as any,null));
assert.deepEqual(result,[]);
let iterations=0;
class Dense extends Array { *entries(){iterations++;yield* super.entries();} }
const d=w(null);d.graphs.main.nodes=Dense.from(d.graphs.main.nodes);
assert.equal(validateWorkflow(d).valid,true);
assert.ok(iterations>0);
for(const key of ['extra','01','-1','4294967295']) {
 const ordinary=Object.assign(new Array(1),{[key]:42});
 assert.equal(validateWorkflow(w(ordinary)).valid,false,'ordinary compensated holes are still rejected by TypeBox');
}
console.log(JSON.stringify({validation:'accepted',getterCalls:calls,parsedLength:value.length,parsedHasOwnZero:false,revalidation:'rejected',generated:result,denseSubclassEntries:iterations,ordinaryHoleControls:4,authoringAndOutput:'rejected without getter'}));
```

### E06 / `probe-schema-service.ts`

```ts
import assert from 'node:assert/strict';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { Check } from 'typebox/value';
import { WorkflowService } from './src/service.ts';
import { createDraft, DraftSchema } from './src/authoring.ts';
import { portableInputSchema } from './src/public-schema.ts';
const service=new WorkflowService(':memory:');
try {
 const schemas:any=JSON.parse(JSON.stringify(await service.dispatch('workflow.schema')));
 const draft=createDraft({id:'example',name:'Example'});
 const opts={strict:true,allowUnionTypes:true};
 let error;
 try{new Ajv2020(opts).compile(schemas.draft);}catch(e){error=String(e);}
 assert.match(error!,/reference "Json" resolves to more than one schema/);
 const portable=portableInputSchema(schemas.draft);
 const validate=new Ajv2020(opts).compile(portable);
 assert.equal(validate(draft),true);
 assert.equal(validate({...draft,extra:true}),false);
 const patch=new Ajv2020(opts).compile(schemas.patch);
 assert.equal(patch({id:'example',expectedRevision:1,operations:[{op:'addGraph',graphId:'child'}]}),true);
 const ids:any[]=[];
 function walk(v:any,path='$'){if(v && typeof v==='object'){if(v.$id==='Json')ids.push(path);for(const [k,x] of Object.entries(v))walk(x,`${path}/${k}`);}}
 walk(schemas.draft);
 console.log(JSON.stringify({error,jsonDefinitionLocations:ids,internalAccepts:Check(DraftSchema,draft),portableAccepts:validate(draft),patch:'compiles'}));
}finally{service.close();}
```

### E03 / `probe-parity.ts`

```ts
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import { compileWorkflow } from './src/compiler.ts';
import { loadGeneratedModule } from './src/generated-module.ts';
import { evaluate, chooseEdge, explainEdge } from './src/expressions.ts';
import { validateWorkflow } from './src/graph.ts';
const literal=(value:any)=>({op:'literal',value});
const ref=(...path:string[])=>({op:'ref',path});
const make=(expr:any)=>({schemaVersion:1,id:'parity',name:'parity',revision:1,entryGraph:'main',graphs:{main:{entry:'start',nodes:[{id:'start',kind:'branch'},{id:'yes',kind:'end',value:literal('yes')},{id:'no',kind:'end',value:literal('no')}],edges:[{from:'start',to:'yes',when:expr},{from:'start',to:'no'}]}}});
const fields={z:ref('input','missing'),a:{op:'not',value:ref('input','flag')}};
const expr={op:'exists',value:{op:'object',fields}};
const input={flag:1};
const w=make(expr);
assert.equal(validateWorkflow(w).valid,true);
const interpreted=evaluate(expr as any,{input,nodes:{}});
const chosen=chooseEdge('start',w.graphs.main.edges as any,{input,nodes:{}});
const trace=explainEdge('start',w.graphs.main.edges as any,{input,nodes:{}});
const compiled=compileWorkflow(w);
const module=await loadGeneratedModule({source:compiled.source,sourceHash:compiled.hash} as any,'./generated-parity');
const runtime:any={step:(_c:any,work:any)=>Effect.suspend(work), route:(c:any,e:any,s:any)=>Effect.try({try:()=>chooseEdge(c.nodeId,e,s),catch:e=>e as Error})};
const result=await Effect.runPromise(Effect.either(module.run(runtime,input)));
console.log(JSON.stringify({interpreted,chosen,trace,generated:result._tag==='Left'?{error:result.left.message}:result.right}));
assert.equal(interpreted,false);assert.equal(chosen,'no');assert.equal(result._tag,'Left');
const sortedExpr={...expr,value:{...expr.value,fields:{a:fields.a,z:fields.z}}};
console.log('equalHashes',compiled.hash===compileWorkflow(make(sortedExpr)).hash);
console.log('sortedDirect',(()=>{try{return evaluate(sortedExpr as any,{input,nodes:{}})}catch(e){return String(e)}})());
for(const flag of [true,false]){
 const s={input:{flag},nodes:{}};const direct=evaluate(expr as any,s);
 const value=await Effect.runPromise(module.run(runtime,s.input));
 console.log(JSON.stringify({control:flag,direct,value}));
}
```

### E07 / `probe-scopes.ts`

```ts
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import { compileWorkflow } from './src/compiler.ts';
import { loadGeneratedModule } from './src/generated-module.ts';
import { chooseEdge, evaluate, ExpressionError } from './src/expressions.ts';
import { activationKey } from './src/run-store.ts';
const literal=(value:any)=>({op:'literal',value});
const ref=(...path:string[])=>({op:'ref',path});
const exists=(value:any)=>({op:'exists',value});
const select=(when:any,then:any,otherwise:any)=>({op:'select',when,then,otherwise});
const workflow:any={schemaVersion:1,id:'scope',name:'Scope',revision:1,entryGraph:'main',graphs:{
 main:{entry:'fan',nodes:[{id:'fan',kind:'map',graphId:'child',items:ref('input')},{id:'done',kind:'end',value:ref('nodes','fan')}],edges:[{from:'fan',to:'done'}]},
 child:{entry:'constructor',nodes:[
  {id:'constructor',kind:'transform',value:select(exists(ref('nodes','constructor')),literal(true),literal(false))},
  {id:'data',kind:'transform',value:{op:'object',fields:{input:ref('input'),tick:ref('nodes','constructor'),prior:select(exists(ref('nodes','feedback')),ref('nodes','feedback'),literal('initial'))}}},
  {id:'feedback',kind:'transform',value:ref('nodes','constructor')},
  {id:'done',kind:'end',value:ref('nodes','data')}],edges:[{from:'constructor',to:'data'},{from:'data',to:'feedback'},{from:'feedback',to:'constructor'},{from:'feedback',to:'done',when:ref('nodes','feedback')}]}
}};
const compiled=compileWorkflow(workflow), module=await loadGeneratedModule({source:compiled.source,sourceHash:compiled.hash} as any,'./generated-scopes');
const steps:any[]=[],cache=new Map<string,any>();
const runtime:any={
 step:(context:any,work:any)=>Effect.suspend(()=>{steps.push(structuredClone(context));const key=activationKey(context);return cache.has(key)?Effect.succeed(structuredClone(cache.get(key))):work().pipe(Effect.tap((value:any)=>Effect.sync(()=>{cache.set(key,structuredClone(value));})));}),
 route:(c:any,edges:any,scope:any)=>Effect.try({try:()=>chooseEdge(c.nodeId,edges,scope),catch:e=>e as Error})};
const expected=['A','B'].map(input=>({input,tick:true,prior:false}));
assert.deepEqual(await Effect.runPromise(module.run(runtime,['A','B'])),expected);
assert.equal(steps.length,16);assert.equal(new Set(steps.map(activationKey)).size,16);
assert.deepEqual(steps.filter(c=>c.nodeId==='constructor').map(c=>c.visit).sort(),[0,0,1,1]);
steps.length=0;
assert.deepEqual(await Effect.runPromise(module.run(runtime,['A','B'])),expected);
assert.deepEqual(steps.map(c=>c.nodeId),['fan','done']);
for(const [expr,expected] of [
 [{op:'all',items:[literal(false),{op:'not',value:literal(1)}]},false],
 [{op:'any',items:[literal(true),{op:'not',value:literal(1)}]},true],
 [select(literal(false),ref('input','missing'),literal(2)),2],
 [{op:'all',items:[]},true],
 [{op:'any',items:[]},false],
 [exists(literal(null)),true],
]) assert.deepEqual(evaluate(expr as any,{input:{},nodes:{}}),expected);
assert.throws(()=>evaluate(exists({op:'not',value:literal(1)}) as any,{input:null,nodes:{}}),ExpressionError);
console.log(JSON.stringify({result:expected,distinctFirstPassActivations:16,replaySteps:steps.map(c=>c.nodeId),lazyControls:7}));
```

### E08 / `probe-zero.ts`

```ts
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import { compileWorkflow } from './src/compiler.ts';
import { evaluate } from './src/expressions.ts';
import { loadGeneratedModule } from './src/generated-module.ts';
const literal=(value:any)=>({op:'literal',value});
const make=(value:any)=>({schemaVersion:1,id:'zero',name:'Zero',revision:1,entryGraph:'main',graphs:{main:{entry:'done',nodes:[{id:'done',kind:'end',value:literal(value)}],edges:[]}}});
const compiled=compileWorkflow(make(JSON.parse('-0')));
const module=await loadGeneratedModule({source:compiled.source,sourceHash:compiled.hash} as any,'./generated-zero');
const runtime:any={step:(_c:any,work:any)=>Effect.suspend(work)};
const direct=evaluate(literal(-0) as any,{input:null,nodes:{}});
const generated=await Effect.runPromise(module.run(runtime,null));
assert.equal(Object.is(direct,-0),true);assert.equal(Object.is(generated,-0),false);
assert.equal(evaluate({op:'eq',left:literal(-0),right:literal(0)} as any,{input:null,nodes:{}}),true);
assert.equal(compiled.hash,compileWorkflow(make(0)).hash);
console.log(JSON.stringify({directMinusZero:Object.is(direct,-0),generatedMinusZero:Object.is(generated,-0),sameSourceHash:true,dslEquals:true,wireOutput:JSON.stringify(direct)}));
```

### E09 / `probe-boundaries.ts`

```ts
import { validateWorkflow, parseWorkflow } from './src/graph.ts';
import { compileWorkflow } from './src/compiler.ts';
import { evaluate } from './src/expressions.ts';
import { assertJson } from './src/output-schema.ts';
const lit=(value:any)=>({op:'literal', value});
const w=(value:any)=>({schemaVersion:1,id:'probe',name:'probe',revision:1,entryGraph:'main',graphs:{main:{entry:'done',nodes:[{id:'done',kind:'end',value:lit(value)}],edges:[]}}});
function result(fn:()=>unknown){try{return {ok:true,value:fn()};}catch(e){return {ok:false,name:e?.constructor?.name,message:e?.message};}}
for (const key of ['extra','01','-1','4294967295']) {
 const a=Object.assign(new Array(1), {[key]: 42});
 console.log(JSON.stringify({case:'hole',key,valid:result(()=>validateWorkflow(w(a))),parse:result(()=>parseWorkflow(w(a))),compile:result(()=>compileWorkflow(w(a)).hash)}));
}
const a=Object.assign(new Array(2),{0:7, extra:42});
console.log(JSON.stringify({case:'partially-dense',valid:validateWorkflow(w(a)),compile:result(()=>compileWorkflow(w(a))),strict:result(()=>assertJson(a))}));
for (const value of [-0, 0, Number.MAX_VALUE, 1e20]) console.log(JSON.stringify({case:'number',minusZero:Object.is(value,-0),valid:validateWorkflow(w(value)),source:compileWorkflow(w(value)).source.match(/const node = (.*)/)?.[1]}));
```

### E09 / `probe-public.ts`

```ts
import { Ajv2020 } from 'ajv/dist/2020.js';
import { WorkflowSchema, ExprSchema } from './src/graph.ts';
import { DraftSchema, PublicDraftPatchSchema } from './src/authoring.ts';
import { portableInputSchema } from './src/public-schema.ts';
const capture=(fn:()=>unknown)=>{try{return {ok:true,value:fn()};}catch(e){return {ok:false,error:String(e)}}};
for(const [name,schema] of Object.entries({workflow:WorkflowSchema,expression:ExprSchema,draft:DraftSchema,patch:PublicDraftPatchSchema})){
 const serialized=JSON.parse(JSON.stringify(schema));
 const direct=capture(()=>{new Ajv2020({strict:false}).compile(serialized);return 'compiled'});
 const portable=capture(()=>{new Ajv2020({strict:false}).compile(portableInputSchema(serialized));return 'compiled'});
 console.log(JSON.stringify({name,keys:Object.keys(serialized),ref:serialized.$ref,definitionRefs:Object.fromEntries(Object.entries(serialized.$defs??{}).map(([k,v]:any)=>[k,{id:v.$id,ref:v.$ref}])),direct,portable}));
}
```

## Источники и качество доказательств

Если не указано post-study/publication, все file:line относятся к study-source `e15bc407da8753fd6b683c0aa4a68634e3c458a7`, не к старому main и не к смещённым строкам publication revision. Ключевые источники:

- `PROJECT_INFO/graph-contract.md:32-34,77-94,97-120,165-184,188-209,234-275`: snapshots, JSON/AST, lazy refs, routing, canonical source, scopes и границы тестов.
- `PROJECT_INFO/architecture.md`; `PROJECT_INFO/development.md` (профильные offline-наборы); `PROJECT_INFO/known-issues.md` (исправленные границы); `PROJECT_INFO/authoring.md:84-118` (атомарность, JSON boundary, неполные drafts).
- `src/graph.ts:43-75,77-103,105-202,243-254`: схема, preflight, семантическая проверка, clone/freeze.
- `src/expressions.ts:19-79,85-134`: чтение собственных полей, порядок/evaluation/errors, общий router.
- `src/compiler.ts:17-23,63-76,80-132`; `src/generated-module.ts:12-39`: канонизация, generated control flow, настоящая загрузка модуля.
- `src/public-schema.ts:20-48`; `src/authoring.ts:30-39,144-164`; `src/service.ts:91-93`; `src/mcp-tools.ts:52-59,80-94`: публичные и внутренние схемы, место конвертации.
- `src/output-schema.ts:5-45`; `src/run-runtime.ts:126-134,173-215`; `src/execution-plan.ts:32-80,89-105`: строгая JSON-граница, журнал маршрутизации, фиксация плана.
- Исполненные тесты E01/E02; дополнительно прочитанные `tests/routing-trace.test.ts`, начало `tests/run-runtime.test.ts` — только источники для безопасного устройства fixture, их полные suites не запускались.
- История: `7209b98f0e221f692a5712d64e363c32ba08ba0b`, `0894d1f9a6eb5ac7b37160af3c6466c0057b83f8`, `9ea773400c0a52193700bfc60c028675b67bfe8b`, `ba0bb589977ef9ab7bf32b780808e8bb6a815cff`; последний HEAD `e15bc40` и предыдущие исправления панели/skills просмотрены через git log. История объясняет изменения; продуктовые исходы относятся к исходному исследованию, а текущая операция независимо проверила код и сохранённые материалы без повторного исполнения.

**Неразрешённые вопросы:** контракт signed zero (U01); политика совместимости порядка ошибок для старых compiler versions (B01); допустимость cross-realm/subclass arrays для прямого API (B02); поведение сторонних schema consumers кроме установленного Ajv (B03). Node 22.19, произвольные Proxy и полная матрица recovery/collect/version combinations не проверены. Никакой неподтверждённый live-эффект не выведен из offline-успеха.

**Предложено, но не выполнено:** изменения кода, новые repository regressions, расширенный property-based differential corpus и повтор на минимальной версии Node. Ни одна рекомендация не внедрена; git commit/push/checkout/reset не выполнялись.

**Provenance-пути:** абсолютные пути только к своей старой ветви/actions и новому месту публикации приведены в `continuationProvenance` JSON. Там же сохранены SHA256 восьми fixtures и проверенных TAP summaries. Отчёт не содержит credentials или сырых логов.
