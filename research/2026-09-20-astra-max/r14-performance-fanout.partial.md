> Сохранённый незавершённый материал r14. У исходной операции нет завершённого результата и пары JSON. Текст сохранён как источник; текущие проверки и решения см. в реестре глобального сбора. Утверждения ниже относятся к исследованному снимку, а не к нынешней dev.

# r14 — Производительность и большой fanout

## Метаданные и provenance

- **ID:** r14. **Дата:** 2026-09-20. **Тип работы:** исследование, без реализации.
- **Study-source:** `e15bc407da8753fd6b683c0aa4a68634e3c458a7`; фактический HEAD нового worktree совпадает.
- **Publication baseline:** `3d8ba65ee84402c0e3b0587f70095b7847824a9f`. Это не ревизия измеренного study-source.
- Отчёты созданы только в `research/2026-09-20-astra-max/r14-performance-fanout.{md,json}` фактического cwd новой операции. Полные пути и хеши передаются итоговым результатом.
- Продолжение после `run-babf9b25-b8f5-45ad-b79c-2b2e5d31d2f0`: прежняя операция завершилась ошибкой provider/terminated, **не успешной сдачей исследования**. В старом worktree оба отчёта действительно отсутствуют; их SHA256 отсутствуют, а не восстановлены предположением.
- Прочитаны сохранённые `r14-actions.json`, два собственных probe-скрипта, их JSON-результаты и два тестовых лога из `/tmp/r14-fanout-ji0buw`. Старые команды не запускались, старые fixtures/worktree не изменялись. Хеши сохранённых материалов вычислены сейчас; прежнего подписанного manifest нет.
- Перенесены результаты измерений и тестов; заново проверены причинные пути в коде. Добавлена **одна небольшая проверка недостающих доказательств** в новом `/tmp/r14-continuation-631v2M`: точные исходники через `git archive` study-source, существующие зависимости dev через symlink только внутри `/tmp`. Она проверяет реальные `JSON.parse`, число чтений admission и валидную исполненную UI-топологию. Ни моделей, ни supervisor, ни команд графа этот новый probe не запускает.
- Рабочая среда: Node `v26.8.1`, Darwin arm64; Effect `3.22.1`, tsx `4.20.6`, TypeScript `5.9.3` закреплены в `package.json`. У worktree нет node_modules; пакеты не устанавливались. Результаты не являются оценкой пропускной способности live provider.

## Вывод

Доказаны **два performance bug**, не ошибки результата графа:

1. Контроль/допуск каждого шага многократно десериализует целиком неизменные `input` и `plan`: стоимость `O(A × (Binput + Bplan))`. Для map с N входами размером p получается `O(N²p)` только на разбор входа.
2. Поиск родительского workspace при допуске `check`/`worktree` читает все прежние активации через N+1 SQL, даже когда worktree вообще нет. Последовательность N проверок уже даёт квадратичное число чтений, независимо от одновременного fanout.

Остальные результаты — локальные идеи оптимизации проекции/хранения/измерения процессов, одно неизвестное о fairness и уже исправленный индекс active-work. Нет оснований добавлять caps, provider retries, менять FULL на менее надёжную запись или заменять процессы общим пулом.

## Coverage и метод

Прочитаны AGENTS, architecture, development целиком, known-issues, профильные graph-contract/execution-plan/run-journal/outcomes-and-waits/observation, история коммитов и соответствующий код. Проверены compiler → Effect → JournalRuntime → RunStore; collect; общая/браузерная проекции; spawn/check wrapper и границы cleanup. Соседние исследовательские отчёты не читались, веб не использовался.

Обозначения: N — число элементов fanout/проверок; A — накопленное число активаций; V — число статических определений узлов; B — размер сериализованных данных. Счётчики операций важнее единичных wall-clock измерений. Старые времена ниже — сохранённые измерения, не заново полученные результаты. Размеры fixtures — границы эксперимента, не runtime quota.

Что **не измерено**: настоящий SDK/provider fanout, реальная нагрузка пользователей, p95/p99, минимальная Node 22.19, браузерный DOM/layout под большой нагрузкой, физические записи диска/WAL, уникальная физическая память процессов, длительные аварийные сценарии нового варианта архитектуры. Полный `npm test` не запускался.

## Находки

### R14-B01 — bug: полная десериализация запуска на горячем пути контроля

**Триггер.** Валидный map по входному массиву `{i,pad}`; дочерний граф состоит из `end(null)`, родитель возвращает null. Нет модели, subprocess, Git, больших выходов или ошибок. Размер plan постоянен, размер input растёт с N.

**Код этой ревизии.** `src/run-store.ts:249-252` вызывает полный `get` из `owned`; `src/run-store.ts:295-314` выбирает `r.*`, разбирает `plan` и `input`, затем читает lineage. `src/run-runtime.ts:51-54,82-108,173-194` использует это для current/gate/retry/admission/completion; `src/run-store.ts:459-499,667-678,854-872` повторяет путь при записи активаций и collect.

**Ожидаемое / наблюдаемое.** Семантически проверке актуальных owner/status/desired необходимы свежие управляющие поля, но не повторный разбор всего неизменного входа. Ожидаемая граница оптимизированного hot path — управляющая работа пропорциональна A, исходный input не десериализуется при каждом gate. Сейчас на указанном графе `get = 6N+14`, с collect `9N+14`; каждый get разбирает **весь** input. Это воспроизведённая избыточная работа, а не нарушение обещанного SLA: результат остаётся правильным null.

| N; pad=1024 B | get без collect / с collect | байты input × get без / с collect | время, мс без / с collect |
|---|---:|---:|---:|
| 64 | 398 / 590 | 26 538 242 / 39 340 610 | 57,5 / 81,7 |
| 128 | 782 / 1166 | 104 314 890 / 155 538 570 | 146,1 / 201,5 |
| 256 | 1550 / 2318 | 413 693 450 / 618 671 882 | 477,0 / 656,3 |

Это вычисленный объём текста, подаваемого JSON.parse, **не чтение столько байтов с физического диска**. Plan разбирается дополнительно. В новом probe N=16/32 прямой перехват JSON.parse подтвердил равенство числа разборов точного текста input числу get: 110/206 без collect, 158/302 с collect. Подготовка/создание/резервирование/загрузка модуля выполнены до включения счётчиков.

**Воспроизведение.** E1 и новый E5; полностью исполняемый E5 приведён в приложении. Assertions проверяют обе формулы и null-выход.

**Контрдоказательства/границы.** При постоянном маленьком input этот компонент линейный по A. Для pad=0,N=256 старые времена 173,2/258,1 мс; одной только цифрой 656 мс нельзя оценивать эффект на модельный run. Не измерены allocation peak и утечка: старые heapDelta иногда отрицательны из-за GC. Нужны свежие owner/desired; кэширование всего изменяемого RunRecord недопустимо.

**Минимальное изменение (не внедрено).** Отделить чтение/проверку управляющей строки от полного публичного `get`; неизменный verified plan держать у supervisor либо получать отдельно для методов, которым он нужен. Не разбирать input там, где он не используется. Сохранить транзакционную проверку владельца и независимые копии публичного get.

**Риск.** Устаревшая отмена/пауза/owner или обход recovery/lineage fences при слишком широком кэше. **Приёмка.** На том же fixture число разборов исходного input после запуска не растёт как A; добавить счётчик, не хрупкий threshold времени. Прогнать ownership loss, pause/resume race, continuation/reconciliation, collect replay; output/события/атомарность прежние.

### R14-B02 — bug: поиск workspace читает всю историю активаций при каждом writer admission

**Триггер.** N последовательных `beginActivation(check)` → `completeActivation` на разрешённом плане с `concurrency:1`, без worktree. Команду check fixture намеренно не исполняет: измеряется только реальный долговечный допуск; это не mock SQL. Аналогичный контроль использует end.

**Код.** `src/run-store.ts:492,503-510` вызывает `listActivations` и лишь затем отбирает worktree-предков. `src/run-store.ts:663-665` сначала получает ключи, затем вызывает `getActivation` для **каждого**, а `580-588` разбирает context/output/metadata. Всё это находится внутри `BEGIN IMMEDIATE` (`240-243,459-460`). Дополнительный аналогичный поиск есть в `src/run-runtime.ts:288-294`; для continue-node ещё один общий проход — `226-228`.

**Ожидаемое / наблюдаемое.** Выбор cwd должен зависеть от точных предков текущей области, не от payload всех завершённых соседей. Даже без единственного worktree i-й допуск заново читает i предшествующих записей. На N begin/complete число `getActivation` точно `3N + N(N−1)/2`, а контроль end — `3N`. Никакой полезной информации о workspace из этих дополнительных записей не извлекается.

| N | getActivation end / check | listActivations check | время end / check, мс |
|---|---:|---:|---:|
| 64 | 192 / 2208 | 64 | 22,0 / 48,9 |
| 128 | 384 / 8512 | 128 | 52,1 / 176,9 |
| 256 | 768 / 33408 | 256 | 92,1 / 539,0 |
| 512 | 1536 / 132352 | 512 | 175,8 / 2201,5 |

Дополнительные обращения создают и подготовленные statement: при N=512 140032 prepare против 8704 у end; write-транзакций в обоих случаях 1024. N+1 SELECT — не N+1 внешних сетевых round trips, это синхронная локальная SQLite/JSON работа, удерживающая write transaction дольше необходимого.

**Воспроизведение.** E1 admission, E5 admission из приложения. Новый проверенный результат N=16/32: check 168/592 против end 48/96; metadata.operation содержит правильные command/cwd. Ни spawn, ни повтор внешнего действия не нужны.

**Контрдоказательства.** Прямое измерение не включает полную стоимость check runtime и не доказывает, что 2,2 с доминируют над моделью. Чистый end не имеет этой квадратичности. Само сохранение intent **до work** необходимо для аварийного окна; его нельзя удалять. Не каждая ветвь является writer; снижение concurrency не устраняет рост от накопленной истории.

**Минимальное изменение.** Отдельный точный lookup workspace-предков по структурным сегментам scope/ключам активаций вместо `listActivations`. Использовать его и в admission, и в workspaceCwd. Как промежуточное локальное улучшение — не декодировать output/не-worktree записи; простая замена N+1 на один полный SELECT уменьшает константу, но сама не устраняет квадратичный обход.

**Риск.** Неверный cwd у вложенных worktrees, близких префиксов, повторных visits или после recovery; недолговечный кэш не должен подменять intent. **Приёмка.** В графе без worktree суммарные чтения admission линейны по N; при наличии деревьев — зависят от глубины/числа релевантных предков, а не от всех соседних выходов. Проверить nested scopes, `1`/`10`, новые visits, возобновление children, сохранение intent при аварии до work и fence старого owner.

### R14-I01 — idea: группировать активации для graphSnapshot; не объявлять весь UI квадратичным

`src/graph-view/model.ts:43-53` для каждого статического узла фильтрует весь records. Составляющая стоит `O(VA)`; далее сортировка групп — `O(Σ Ak log Ak)`, проекция/сериализация пропорциональны объёму ответа. `activeWork` — другой, уже исправленный алгоритм.

Старый proxy probe на **фиксированной** топологии V=3: N=128/256/512/1024 дали 640/1280/2560/5120 чтений элементов records. При N=1024 снимок с null-выходами — 492518 B. Старый «growing» probe дал 1052672 чтения при V=1026,N=1024, **но был искусственным невалидным графом**: заменял leaf на набор недостижимых end и не исправлял entry. Его времена не используются как end-to-end доказательство.

Недостаток исправлен в evidence, не в продукте: новый E5 действительно prepare/исполняет map на 4 элемента с дочерней цепочкой из 16/32 узлов. V=18/34, A=66/130, чтения `(V+2)A` = 1320/4680. Два дополнительных прохода здесь — waitingKeys и summarizeUsage у succeeded-run; это не универсальная формула для любого статуса. Валидный fixture доказывает `VA`-составляющую, но не пользовательский UI timeout.

Полный polling-путь дороже чистой проекции: `RunController.snapshot` снова читает активации после observe (`src/run-controller.ts:98-105,229-240`), server загружает waits/trace и serializes ответ (`src/graph-view/server.ts:188-209`), браузер считает полную JSON-signature (`src/graph-view/app.js:1448-1469`). Poll планирует следующий запуск **после** await и ещё 1000 мс (`1632-1648`), а не бесконечно накладывает setInterval-запросы. Activity events читаются с cursor (`server.ts:194-196`) — утверждение «каждый poll перечитывает все events с нуля» неверно. Рендер неизменного снимка уже подавлен signature.

**Минимальная рекомендация.** Однопроходный индекс `(graphId,nodeId) → activations` внутри graphSnapshot, сохранить сортировку и контракт ответа; начать с него, не с переписывания UI/нового API. **Риск:** порядок, branches/usage, scope/visit, trace и навигация. **Приёмка:** глубоко равные snapshots на имеющихся fixtures и валидном E5; число обращений к исходному records `O(A+V)`. Оптимизация общей загрузки/проверки процессов — отдельный этап; нельзя кэшировать живость по heartbeat или безусловно по updatedAt.

### R14-I02 — idea: наблюдаемая многократная запись выходов — предмет аккуратной дедупликации, не повод ослабить журнал

E2: map из 128 leaf-строк по 2048 ASCII B, родительский end возвращает весь map; полезный текст 262144 B.

| Сумма B в измеренных колонках | fail-fast | collect |
|---|---:|---:|
| workflow_runs.output | 262529 | 266497 |
| workflow_activations.output | 787458 | 795394 |
| workflow_collections.result | 0 | 266368 |
| workflow_run_events.payload | 1086365 | 1375791 |
| Всего | **2136352** | **2704050** |

Это примерно 8,15×/10,32× полезного текста, **включая event metadata**, но исключая plan/input, индексы, file pages и WAL. Это не измерение write amplification накопителя. Копии объяснимы кодом: output+event у каждого leaf и родителей (`src/run-store.ts:673-678`), collection+event (`854-872`), run output+event (`431-456`). При collect добавляется одна транзакция на элемент: в E1 `writes=2N+5` против `3N+5` до finish. `collectionSummary` обновляется SQL-инкрементом, а не пересборкой всех детей (`866-870`); общий результат map всё равно материализуется.

**Минимальная рекомендация.** Сначала read-path для activity читать только нужные lifecycle events/поля, не payload всех типов ради collectActivity; это не требует менять сохранённый контракт. Лишь отдельно рассмотреть адресуемые immutable payload для точек/событий, если такие размеры реальны. **Риск:** миграция, exact JSON outputs, event consumers, crash/replay и очистка ссылок. **Приёмка:** неизменны output/event API и replay после аварии; проверять одновременно логические байты, SQLite/WAL размеры и latency, не смешивать их. Не усекать check stdout, результаты или доказательства молча; не выключать FULL и не объединять безопасностные checkpoints без нового crash-доказательства.

### R14-I03 — idea: учитывать цену процессов, сохраняя lifecycle model

E2 сохранил measurement настоящего `runCheckProcess`: N=1/4/8 собственных Node-команд ждали файл release, затем возвращали stdout=ok,exitCode=0. На каждую команду действительно были wrapper+command, всего 2N измеренных процессов; это не количество SDK workers или всего ОС.

| N | готовность всех, мс | RSS wrapper, B | RSS command, B |
|---|---:|---:|---:|
| 1 | 136,1 | 96862208 | 38207488 |
| 4 | 241,6 | 392609792 | 152748032 |
| 8 | 406,4 | 770244608 | 305086464 |

Сумма RSS при N=8 около 1,00 GiB, **не уникальная физическая память**, без родителя. Это один sample на размер с tsx/import overhead, без распределения/холодного старта ОС и без provider. Граница 10 с в script — fixture readiness failure guard, не лимит runtime. Старый spawn-probe не повторялся в продолжении.

`src/process-client.ts:144-164` резервирует identity до spawn и сохраняет PID до отправки запроса; `src/check-worker-process.ts:28-42` запускает отдельную команду, накапливает stdout/stderr и выдаёт JSON. Родитель ещё раз накапливает/парсит JSON (`process-client.ts:169-183`): суммарная память зависит и от размера выводов. Pi имеет отдельный путь `68-95`; измеренные RSS check-wrapper нельзя переносить на SDK-процесс.

**Минимальная рекомендация.** Развивать существующие offline fixtures учётом spawn→PID checkpoint→request→ready/result→exit/drain и памятью при коротких/больших выводах. Проверить стоимость импорта wrapper отдельно, без удаления изоляции. **Риск:** measurement instrumentation сама меняет timings; оптимизация spawn без fencing оставит процессы/повторит эффекты. **Приёмка:** результаты и cleanup на pre/post-admission cancel, disconnect, descendants и exit-without-close прежние; process-client retained suite 12/12 является базовой регрессией, не подтверждением большого live fanout.

Общий SDK pool **не рекомендован**: `tests/session-pool-lifecycle.test.ts:73-110` и `PROJECT_INFO/development.md` описывают контрпример SIGKILL общего процесса с продолжающимися detached bash effects. Здесь прочитан тест, но он заново не исполнен. Подставной benchmark `spikes/session-pool-benchmark.ts:1,27-35` сам ограничивает выводы startup/RSS, не throughput модели. Нет lifecycle-доказательства для смены production process model.

### R14-U01 — unknown: fairness/задержка контроля при синхронном burst

В E1 ни один 10-мс interval callback не выполнился внутри 12 коротких исполнений map; в самом длинном elapsed 656,3 мс. Поле старого probe `maxTimerGapMs` включает финальный промежуток после последнего тика, а при нуле тиков фактически равно времени всего измерения — **это не распределение event-loop delay**.

Код содержит синхронную SQLite/JSON работу; supervisor проверяет control каждые 100 мс, heartbeat раз в секунду (`src/supervisor.ts:29-42`). Это создаёт обоснованную гипотезу задержки timer/IPC на burst. Но новый/current store admission заново проверяет desired/owner; отсутствие timer тика не доказывает допуск после уже записанной pause или потерю cancellation. Pure fixture не запускает supervisor и не меряет доставку внешнего сигнала.

Контрдоказательство абсолютному утверждению «Effect никогда не уступает»: установленный `effect/src/Scheduler.ts:126-166` содержит MixedScheduler с microtask и timer yield, а `forEachParUnbounded` выделяет результирующий массив (`effect/src/internal/fiberRuntime.ts:2180-2189`). Асинхронный leaf меняет характер interleaving. Не установлена причина нестабильных process-тестов из known-issues; эти симптомы нельзя приписать найденным накладным расходам.

**Следующий эксперимент, не выполнен:** отдельный конечный fixture supervisor/БД с barrier, смесь чистых leaf и offline check, запись control из другого fixture-процесса; timestamps записанного desired, следующего admission, abort, exit/drain плюс event-loop delay. Сравнить до/после B01/B02 на Node 22.19 и 26. **Минимальное изменение сейчас:** только диагностический fixture; yield в runtime — лишь после доказательства. **Риск:** изменение порядка/финализаторов/паузы. **Приёмка:** нет новых admissions после durable pause, один выход/cleanup на cancel, timer latency описана распределением; без caps/retries/timeout операций пользователя.

### R14-A01 — already-fixed на study-source: active-work больше не сравнивает каждого контейнера со всеми записями

`src/observation.ts:7-35` строит trie по точным сегментам scope и проверяет префиксы. Стоимость `O(A+S+P)` плюс разбор retry metadata, память `O(S)`. Это уже коммит `a2c84e1`, присутствующий в e15bc40. Старый quadratic reference находится в **тесте**, не в runtime. `tests/active-work-index.test.ts:169-209` считает операции и сравнивает с независимым эталоном; retained E3 содержит все 8 успешных случаев этого файла, включая scope/visit/wait/retry и size512.

**Действие:** сохранить regression, не внедрять индекс повторно. Это исправление не устраняет отдельные полные проходы RunStore или `graphSnapshot` из B02/I01. Будущие изменения должны сохранить совпадение ordered identities, а не только счётчик.

## Уже исправленное и опровержения, отдельно от новых находок

**Study-source:**

- R14-RF01: «unbounded само по себе bug/скрытый cap» — опровергнуто контрактом и `src/compiler.ts:104-118`: заданное concurrency передаётся явно, иначе unbounded; results сохраняют порядок. Retained E4 проверил реальное перекрытие Effect и независимость scopes. Политика collect не является retry/approval.
- R14-RF02: «collect пересчитывает все результаты при каждом settle» — нет: SQL-инкремент summary (`src/run-store.ts:866-870`); накладные расходы B01 и копии выходов существуют отдельно.
- R14-RF03: skill delivery, stale asynchronous panel/control/await и wait disclosure/caret/scroll не переоткрывались. Сверены `src/catalog.ts:31-35,89-95`, `src/execution-plan.ts:122-127`, `src/graph-view/app.js:484-507,1162-1173,1448-1481,1514-1539`, известные исправления и git log. Это source-review, **не новый браузерный/live тест**. Оставшаяся общая disclosure boundary уже описана e15bc40 и не выдаётся здесь за новую находку.
- R14-RF04: «дорогой snapshot обязательно заново рисует DOM каждую секунду» — нет: signature убирает часы и подавляет неизменный render. Однако SQL/projection/JSON всё ещё выполняются.

**Post-study already-fixed — не переносить задним числом на e15bc40:**

- R14-PS01: `86f5e07` вынес parallel writer isolation в отдельный модуль и включил раннюю authoring validation. Diff к публикационному dev просмотрен; не предлагается внедрять повторно.
- R14-PS02: `3d8ba65` добавил документацию reviewer artifactRevision binding в skill/authoring. Просмотрен diff; не новая runtime feature этого исследования и не повторная рекомендация.
- `run-store`, `run-runtime`, observation, graph-view model/server, process-client/check-worker/sqlite и dependency pins **побайтово не менялись** между study-source и publication HEAD; tracked src/tests/pins dev чисты. Compiler/graph/execution-plan/workspaces менялись для ранней валидации; утверждение «весь compiler идентичен» не делается. Эмиссия map/parallel в просмотренном diff не менялась. Новые measurements выполнены на архиве study-source, а не на публикационном dev.

## Эксперименты: выполненное, перенесённое, предложенное

| ID | Происхождение; команда | Итог и границы |
|---|---|---|
| E1 | retained `node --import "$DEV/node_modules/tsx/dist/loader.mjs" "$OLD/measure.mts" "$DEV"` | 12 map cases, 8 admission cases, 8 synthetic projection cases. Реальный compiler/Effect/SQLite WAL/FULL, без subprocess/model. Формулы подтверждены assertions. Старый растущий UI synthetic невалиден; только micro-path evidence. |
| E2 | retained аналогичная команда с `amplification.mts` | 2 случая логических payload bytes; 3 случая настоящих check wrappers N=1/4/8, свои release fixtures и cleanup. SQL суммы — не WAL/disk I/O, RSS — не physical memory. |
| E3 | retained из dev: `node --import tsx --test --test-concurrency=1 tests/active-work-index.test.ts tests/run-runtime.test.ts tests/process-client.test.ts` | **26/26**, без failures/skips. Это сохранённый лог старой операции, заново suite не запускалась. |
| E4 | retained из dev; точная команда ниже | **3/3** выбранных теста; не все compiler/collection suites. Порядок/scope/concurrency и исключение control/cleanup/defect из collect. |
| E5 | **выполнен сейчас:** `node --import /tmp/r14-continuation-631v2M/base/node_modules/tsx/dist/loader.mjs /tmp/r14-continuation-631v2M/verify.mts /tmp/r14-continuation-631v2M/base` | Exit 0, 10 cases с assertions: 4 input parse, 4 admission, 2 валидные исполненные проекции. Источник `git archive e15bc40 src package.json`; 3 cmp hotpath файлов с cwd прошли. Не измеряет live provider/OS control latency. |

Точная сохранённая команда E4 (не повторялась):

```sh
node --import tsx --test --test-concurrency=1 --test-name-pattern='map, parallel and subworkflow|collect map and parallel|collect never converts' tests/compiler.test.ts tests/collection.test.ts
```

Все перечисленные старые scripts просмотрены до использования результатов. В retained action-list есть команды проверки прежнего dev HEAD, но нет их stdout: принадлежность всех старых timing samples ровно e15bc40 не является отдельной криптографической аттестацией. Новая точная проверка E5 и сверка hotpaths устраняют эту неопределённость для двух багов; старые wall times остаются ориентиром с явно указанным происхождением.

Предложены, **не выполнены**: mixed fairness/control experiment, измерение WAL/physical I/O, p95 spawn/import, Node22 comparison, новая pool crash/reconcile matrix. Ни полный npm test, ни live probe, ни наблюдение/управление пользовательскими run не выполнялись в продолжении.

## Источники и SHA256 сохранённых материалов

Все `src/*:line` выше относятся к study-source; документы — та же ревизия, кроме явно помеченных post-study diffs. Реестр диапазонов также дан в JSON. Никаких web/live-provider источников.

| Материал | SHA256, проверен 2026-09-20 |
|---|---|
| retained `r14-actions.json` | `1b1fae3cfc9edb6dd2f57abc61118cc47254600ce87c3e15871dacc7fbd66246` |
| OLD/measure.mts | `1c1cfb9017f01bdd0d5d1e7499a657df25caa99c506377b0fc4f98b64f225f19` |
| OLD/results.json | `45a15f1a4be6229b2b86a738430fddd0b58b44bcccfe197b91a558369a3b9a4b` |
| OLD/amplification.mts | `a51e6aa377e245189040cd031abd590bb6ceee3ace555f283c75e134d53843eb` |
| OLD/amplification.json | `0c5d01f95ccb82974b7ee14814540b64b789ee29eabfc0c2e13c47975558f630` |
| OLD/tests.tap | `712f92f260b41502a73b9430e5d518ef7e4ce4234e743eac2e7fc7f81f4fd8a6` |
| OLD/contracts.tap | `023ac5e25e7e788ebb2b1b4898a2c09941f733107b81af6cf3b3738ef395850b` |
| NEW/verify.mts | `e219abb823bb1eb48bff8fb8b8e8f4085b65dba8adcd77bc8c6655838b649e01` |
| NEW/verified.json | `7346533f0eb53d6f0b2ba21d427cc15ecbafdbe17b8eb6944c4d229dd3508c92` |

OLD=`/tmp/r14-fanout-ji0buw`, NEW=`/tmp/r14-continuation-631v2M`. Пути сохранённых материалов служат provenance, не указанием повторять запись в них. Сырые логи в Git не копируются. Для переносимого воспроизведения двух bugs не нужен OLD: полный новый fixture ниже.

## Приложение: воспроизводимый E5 без моделей и команд графа

В текущем репозитории, имея существующие зависимости, создать **новый** каталог; `DEPS` — каталог уже установленных node_modules (в этой операции использован разрешённый dev). Не выполнять install/checkout. Извлечь блок TypeScript ниже как `$P/verify.mts`.

```sh
P=$(mktemp -d /tmp/r14-reproduce-XXXXXX)
mkdir "$P/base"
git archive e15bc407da8753fd6b683c0aa4a68634e3c458a7 src package.json | tar -x -C "$P/base"
ln -s "$DEPS" "$P/base/node_modules"
# Сохранить следующий блок как "$P/verify.mts".
node --import "$P/base/node_modules/tsx/dist/loader.mjs" "$P/verify.mts" "$P/base"
```

Fixture создаёт/закрывает/удаляет только свои временные БД/сгенерированные модули с r14-префиксами. Вызовы `beginActivation(check)` не исполняют command. Assertions фиксируют текущее проблемное число операций; после оптимизации их нужно заменить на новый acceptance bound, не требовать сохранения накладных расходов.

```typescript
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const base = process.argv[2];
const mod = (p: string) => import(pathToFileURL(join(base,p)).href);
const {Effect} = await mod('node_modules/effect/dist/esm/index.js');
const {prepareExecutionPlan} = await mod('src/execution-plan.ts');
const {loadGeneratedModule} = await mod('src/generated-module.ts');
const {RunStore} = await mod('src/run-store.ts');
const {JournalRuntime} = await mod('src/run-runtime.ts');
const {graphSnapshot} = await mod('src/graph-view/model.ts');
const lit=(value:any)=>({op:'literal',value}), ref=(...path:string[])=>({op:'ref',path});
function definition(kind='end',collect=false) {
  return {schemaVersion:1,id:'probe',name:'r14 continuation',revision:1,entryGraph:'main',graphs:{
    main:{entry:'fan',nodes:[{id:'fan',kind:'map',graphId:'child',items:ref('input'),...(collect?{failurePolicy:'collect'}:{}),...(kind==='check'?{concurrency:1}:{})},{id:'done',kind:'end',value:lit(null)}],edges:[{from:'fan',to:'done'}]},
    child:{entry:'leaf',nodes:kind==='check'?[{id:'leaf',kind:'check',command:process.execPath,args:['--version']},{id:'done',kind:'end',value:lit(null)}]:[{id:'leaf',kind:'end',value:lit(null)}],edges:kind==='check'?[{from:'leaf',to:'done'}]:[]}
  }};
}
const ctx=(i:number)=>({graphId:'child',nodeId:'leaf',scope:['graph','main','node','fan','visit','0','map',String(i),'graph','child'],visit:0});
const rows:any[]=[];
for (const collect of [false,true]) for(const n of [16,32]) {
  const dir=await mkdtemp('/tmp/r14-cont-input-'),store=new RunStore(join(dir,'db.sqlite'));
  try {
    const plan=await prepareExecutionPlan(definition('end',collect),{cwd:dir,availableModels:[]});
    const input=Array.from({length:n},(_,i)=>({i,pad:'x'.repeat(1024)})),text=JSON.stringify(input);
    store.create({id:'run',plan,input,cwd:dir});const {run,token}=store.reserveLaunch('run');
    const program=await loadGeneratedModule(plan,dir);
    let gets=0,inputParses=0;const originalGet=store.get.bind(store),parse=JSON.parse;
    store.get=(...args:any[])=>{gets++;return originalGet(...args)};
    JSON.parse=function(value:any,...args:any[]){if(value===text)inputParses++;return parse(value,...args)} as typeof JSON.parse;
    try {assert.equal(await Effect.runPromise(program.run(new JournalRuntime(store,run,token,dir),input)),null)} finally {JSON.parse=parse;store.get=originalGet}
    assert.equal(gets,(collect?9:6)*n+14);assert.equal(inputParses,gets);
    rows.push({mode:'input',n,collect,gets,inputParses,inputBytes:Buffer.byteLength(text),parsedBytes:inputParses*Buffer.byteLength(text)});
  } finally {store.close();await rm(dir,{recursive:true,force:true})}
}
for(const kind of ['end','check']) for(const n of [16,32]) {
  const dir=await mkdtemp('/tmp/r14-cont-admit-'),store=new RunStore(join(dir,'db.sqlite'));
  try {
    const plan=await prepareExecutionPlan(definition(kind),{cwd:dir,availableModels:[]});
    store.create({id:'run',plan,input:null,cwd:dir});const {token}=store.reserveLaunch('run');
    let reads=0,lists=0;const read=store.getActivation.bind(store),list=store.listActivations.bind(store);
    store.getActivation=(...args:any[])=>{reads++;return read(...args)};store.listActivations=(...args:any[])=>{lists++;return list(...args)};
    for(let i=0;i<n;i++){const a=store.beginActivation('run',token,ctx(i),{kind,sideEffect:kind==='check'});if(kind==='check'){assert.equal(a.metadata.operation.cwd,dir);assert.equal(a.metadata.operation.command,process.execPath)}store.completeActivation('run',token,a.key,null)}
    assert.equal(reads,3*n+(kind==='check'?n*(n-1)/2:0));assert.equal(lists,kind==='check'?n:0);
    rows.push({mode:'admission',kind,n,reads,lists});
  } finally {store.close();await rm(dir,{recursive:true,force:true})}
}
// Valid, prepared AND executed topology: four map items, each is a chain ending in end.
for(const width of [16,32]) {
  const dir=await mkdtemp('/tmp/r14-cont-ui-'),store=new RunStore(join(dir,'db.sqlite'));
  try {
    const workflow=definition();workflow.graphs.child={entry:'leaf0',nodes:Array.from({length:width},(_,i)=>({id:'leaf'+i,kind:i===width-1?'end':'transform',value:lit(null)})),edges:Array.from({length:width-1},(_,i)=>({from:'leaf'+i,to:'leaf'+(i+1)}))} as any;
    const plan=await prepareExecutionPlan(workflow,{cwd:dir,availableModels:[]}),input=Array(4).fill(null);
    store.create({id:'run',plan,input,cwd:dir});const {run,token}=store.reserveLaunch('run'),program=await loadGeneratedModule(plan,dir);
    const output=await Effect.runPromise(program.run(new JournalRuntime(store,run,token,dir),input));store.finish('run',token,{status:'succeeded',output});
    const records=store.listActivations('run');let visits=0;
    const wrapped=new Proxy(records,{get(target,key,receiver){if(typeof key==='string'&&/^(0|[1-9]\d*)$/.test(key))visits++;return Reflect.get(target,key,receiver)}});
    const snapshot=graphSnapshot(store.get('run'),wrapped),nodes=width+2;
    assert.equal(records.length,4*width+2);assert.equal(visits,(nodes+2)*records.length);
    rows.push({mode:'projection-valid-executed',width,staticNodes:nodes,activations:records.length,recordVisits:visits,bytes:Buffer.byteLength(JSON.stringify(snapshot))});
  } finally {store.close();await rm(dir,{recursive:true,force:true})}
}
console.log(JSON.stringify({sourceRevision:'e15bc407da8753fd6b683c0aa4a68634e3c458a7',node:process.version,rows},null,2));
```
