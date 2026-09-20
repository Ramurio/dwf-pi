# Dynamicwf: доказательный обзор V3 — неполный пакет

Дата: 2026-09-20. Study: `e15bc407da8753fd6b683c0aa4a68634e3c458a7`. Publication: `3d8ba65ee84402c0e3b0587f70095b7847824a9f`. ID: 00-summary.

**Решение: inconclusive; статус blocked; manifestComplete=false.** Проверены 15 полных исследований и 6 полных критиков из ожидаемых 16+8. Это не accepted и не 24 успешных операции.

## Что отсутствует и почему

Текущие r14, c02, c07 имеют оболочки **failed**, phase=execution, effects=unknown: `Git workspace must be clean, including untracked files`. Value/results у них нет. Это отказ подготовки/исполнения рабочего дерева, не доказательство дефекта исследуемого Dynamicwf и не основание чистить пользовательские файлы. r14 performance/fanout отсутствует; r03/r04 и r13 не имеют завершённого текущего независимого ревью.

Локально осталось 44 первичных файла: 42 точно совпадают с 21 успешной парой, ещё два — исторический **blocked c07**, не текущий producer. Они сохранены без изменения, но исключены из complete-count. Старые partial evidence не подменяют недостающий успешный output. Все 24 ожидаемые записи, producer paths, snapshot heads, реальные SHA256, причины отсутствия и digests находятся в `00-manifest.json`.

## Происхождение и режимы

13 research исторически max; r06/r09 финализированы V2 low; V3 планировал r14/c02/c07 low, но все три current wrapper failed до успешного результата. 15 research + 6 critics reuse без модельного перезапуска. Агрегатор low. run-9dbb044c официально cancel после paused/0workers, старые max agents не возобновлялись (вход пользователя).

terminated/HTTP200; 44 primary files сохранены; отсутствовавшие summary/manifest не считаются исполненным shell. Старый c07 blocked не заменяет current failed.

Источник V3 — run-b46cf9ab-6e57-4c7a-83dc-e44802a4ab9c; предшественники run-babf9b25 и run-9dbb044c сохранены в manifest. Историческое имя astra-max не описывает режим всей коллекции. Смена на openai-codex/gpt-6-astra thinking=low — явное решение пользователя, не fallback. r14 не объявляется финализированным на low: новая операция failed.

## Метод и степень доказанности

Сначала разобраны status wrappers, затем успешные результаты. Заново прочитаны байты 21 MD/JSON пары из producer workspace, распарсен JSON, проверены sourceRevision, SHA256, локальное побайтовое совпадение и Git snapshot blobs. Для c01/c03/c04/c05/c06/c08 независимо вычислен SHA256 compact JSON exact researchResults pair (`sort_keys=True,separators=(",",":"),ensure_ascii=False`); все шесть совпали с переданным output, JSON и MD. Для отсутствующих c02/c07 текущего digest нет. Исторический digest c07 не переносится.

Агрегатор не запускал модели, providers, live runs, npm tests или behavioral fixtures. Поведенческие результаты ниже принадлежат исследователям/критикам; successful mock не доказывает live поведение. Выполнены чтение исходников/истории и integrity audit. Ссылки file:line относятся к e15bc40; два post-study изменения учтены отдельно.

До дедупликации: {'bug': 31, 'unknown': 17, 'already-fixed': 33, 'idea': 9}. Это число claims, не число независимых дефектов и не квота замечаний.

## Порядок минимальных изменений

### G01 — очередь 1: r06-B01, r06-B02, R16-B01
Ложная безопасность файловой границы: directory entries Git, index flags и alias inode — три разных дефекта, не один баг.

**Минимальный шаг:** Сначала защита локальных байтов: канонизация directory collision, проверка скрытых index-флагов, безопасная запись helper без следования hardlink.

**Зависимости/риск:** Независимые точечные изменения; не применять force/reset/удаление данных.

**Приёмка:** Отказ до мутации; source/destination bytes и HEAD неизменны в отрицательных сценариях; fresh output и нормальный merge работают.

### G07 — очередь 1: R15-001
Тест читает stdout/stderr на exit до drain: ложные pass/fail, не доказанная ошибка production cancel.

**Минимальный шаг:** Исправить test oracle до расширения fault injection: дождаться drain/close с корректным fallback.

**Зависимости/риск:** Может идти параллельно G01, без изменения runtime timeout.

**Приёмка:** Поздние assertion bytes наблюдаемы; exit code 130 сохранён; инъекции ложного pass/fail больше не проходят.

### G02 — очередь 2: R02-B01, R02-B02, R02-B03, r04-B01
Потеря исходного отказа при нормализации Cause/cleanup/rollback. Общая тема, но три runtime места и SQLite guard исправлять раздельно.

**Минимальный шаг:** Сохранять составную причину и secondary cleanup error; не переводить неопределённый эффект в безопасный повтор.

**Зависимости/риск:** r04 без c02: сначала независимый offline повтор. Согласовать execution-failure с recovery gate.

**Приёмка:** Первичная ошибка видна, cleanup завершён/его отказ записан; следующий writer не допускается при неизвестной очистке.

### G03 — очередь 3: R05-B01, R05-B02
Повтор доставки путается с новым запуском: fenced source ошибочно relaunch; committed continuation не доводится до reserve.

**Минимальный шаг:** Разделить наблюдение уже доставленного исходного start и завершение первоначального запуска successor.

**Зависимости/риск:** После error/effect gate; не ослаблять resume fence.

**Приёмка:** Один ID и один эффект при повторе и create-before-reserve; stale source не исполняется.

### G06 — очередь 3: R12-B01, R13-B01
SDK transport boundary: отсутствие usage не равно нулю; Bedrock attempts не равно maxRetries. Это разные дефекты.

**Минимальный шаг:** R12: сохранить missing usage на входе ledger. R13: сначала независимая проверка c07, затем точечный version-checked maxAttempts=1, если подтверждено.

**Зависимости/риск:** Не менять пользовательский AWS env; не вводить provider retries или бюджеты.

**Приёмка:** Unknown usage остаётся partial/н/д, настоящий zero допустим; локальные 503/429 дают одну отправку на turn без graph retry. Live billing не заявляется.

### G04 — очередь 4: r01-B01, r01-B02, r01-B03, R07-B03, R07-B01, R07-B02, R07-B04, R03-001, R03-002
Границы графа/API/process: порядок object.fields, snapshot JSON, уникальность schema names, типы CLI, CAS error, service close, locale и UTF-8.

**Минимальный шаг:** r01-B03 и R07-B03 — один механизм конфликтующих named definitions, один patch и общая CLI/MCP regression. Остальные независимы.

**Зависимости/риск:** Для r03 сначала отсутствующее c02; для compiler учитывать версию/hash и direct/generated parity.

**Приёмка:** Единая семантика и диагностика входов; chunk split не меняет Unicode; закрытый сервис не открывает новые соединения.

### G05 — очередь 5: R09-B01, R09-B02, R10-B01, R10-B02, R10-B03, r11-B01, r11-B02, r11-B03, r11-B04, R12-B02
Проекция UI: порядок чтений, pending load, замена DOM, камера и подпись attempt. R09-B02/r11-B01 имеют общий механизм удаления focused элемента, но разные контролы и regressions.

**Минимальный шаг:** Сначала поколения list/recovery и single-flight task load; затем semantic focus restore для await/SVG, видимость focus и согласованный zoom.

**Зависимости/риск:** Сохранить visit ownership A→B→A, guard старого 401, disclosure/caret/scroll.

**Приёмка:** Native browser reordered responses и keyboard tests; никаких повторных POST и переноса focus между чужими run.

## Критика, дубли и конфликты

r01-B03/R07-B03 — один дефект публичной draft schema; оба ID сохранены. R09-B02/r11-B01 объединены по замене focused DOM, но требуют отдельных UI тестов. R15-004/R16-F02/R08-F01 подтверждают одну исправленную доставку skill; R09-AF01/R15-005/r11-AF03 — повторные подтверждения UI guards, не новые bugs.

Завершённые c01/c03/c04/c05/c06/c08 одобряют достоверность исследовательских пакетов, не внедрение всех рекомендаций. Ни один producer bug ими не опровергнут. c05 явно сообщает CDP timeout полного повтора R09: независимый сценарий подтверждает BUTTON→BODY/SUMMARY→BODY, но trusted Tab/Space заново не подтверждены. Это ограничение сохранено, не скрыто общим approve.

R13-B01 сохраняется как producer bug с offline 3/1/1/1 запросами; **не независимо подтверждён текущим критиком**. Старый c07 не оспорил fixture, а не завершил содержательную проверку. Поэтому нельзя считать R13 ни refuted, ни pair-approved. r03/r04 также author-supported без c02. Отказ fetch/clean workspace — отсутствие evidence, а не голос.

## Уже исправлено — не внедрять повторно

На study-source: доставка frozen skill с read/bash; владение поздними snapshot/control/await ответами; await disclosure/caret/scroll; pause/resume admission; ряд fencing/recovery/usage/ARIA контрактов из индекса ниже. Оставшиеся list-order/focus/missing-usage — другие механизмы, не отмена этих исправлений.

После study: **86f5e07** уже добавил раннюю authoring parallel-isolation validation; **3d8ba65** уточнил reviewer binding. Не предлагать их заново и не переписывать первичные хеши под publication.

## Unknowns и идеи

- **r01-U01 [unknown]** Сохранение знака -0 не определено контрактом — r01, c01
- **r01-AF01 [already-fixed]** Компенсированные дырки authoring/output отклоняются — r01, c01
- **r01-AF02 [already-fixed]** Literal-preserving conversion и публичный patch/id работают — r01, c01
- **r01-AF03 [already-fixed]** Общий router сохраняет порядок, fallback и short-circuit — r01, c01
- **R02-AF01 [already-fixed]** Pause/resume admission race уже исправлена в study source — r02, c01
- **R03-003 [already-fixed]** Сохранённая launch provenance и CAS уже защищают от другой установки и обычного PID mismatch — r03, c02 (ревью отсутствует)
- **R03-004 [already-fixed]** Резервация до spawn, запись PID до stdin и ожидание exit+drained pipes реализованы — r03, c02 (ревью отсутствует)
- **R03-005 [already-fixed]** Неопределённые process groups блокируют освобождение owner; PGID не считается доказанным ownership — r03, c02 (ревью отсутствует)
- **R03-006 [unknown]** Атомарность проверки идентичности и последующего сигнала при настоящем PID/PGID reuse не доказана — r03, c02 (ревью отсутствует)
- **R03-007 [unknown]** Причина документированных macOS process-test flakes остаётся неизвестной — r03, c02 (ревью отсутствует)
- **r04-I01 [idea]** Явная граница совместимости схемы журнала — r04, c02 (ревью отсутствует)
- **r04-A01 [already-fixed]** WAL setup и согласованный backup уже имеют защитные контракты — r04, c02 (ревью отсутствует)
- **r04-A02 [already-fixed]** Fencing и атомарные checkpoints действуют — r04, c02 (ревью отсутствует)
- **r04-A03 [already-fixed]** Recovery связывает согласованный журнал, файлы и одноразовое решение — r04, c02 (ревью отсутствует)
- **r04-U01 [unknown]** Machine/power-loss durability не измерена — r04, c02 (ревью отсутствует)
- **r04-U02 [unknown]** Некорректный UTF-8 в именах на другой POSIX FS — r04, c02 (ревью отсутствует)
- **R05-AF01 [already-fixed]** Ручное reconciliation замещает автоматический retry и расходует разрешение один раз — r05, c03
- **R05-AF02 [already-fixed]** Stale await не возобновляет источник continuation; использованные предки и элементы коллекций запечатаны — r05, c03
- **R05-U01 [unknown]** Вторичная unknown-причина может не участвовать в continuation retain-effects gate — r05, c03
- **r06-A01 [already-fixed]** Привязка вердикта, проверка текущего source HEAD и provenance reuse уже существуют — r06, c03
- **r06-A02 [already-fixed]** Crash recovery уже сохраняет frontier, точный complete HEAD и историю; частичная интеграция не обещает общего rollback — r06, c03
- **r06-A03 [already-fixed]** Ранняя authoring-валидация параллельной записи добавлена после study-source — r06, c03
- **r06-A04 [already-fixed]** Документация reviewer binding уточнена после study-source — r06, c03
- **r06-U01 [unknown]** Не проверено end-to-end расхождение после snapshot/review из-за посторонней конкурентной записи — r06, c03
- **R07-I01 [idea]** Общая машинно-читаемая диагностика неверных запросов — r07, c04
- **R08-F01 [already-fixed]** Обычные выбранные skills доступны всем шести ролям; отсутствие read/bash отклоняется заранее. — r08, c04
- **R08-F02 [unknown]** Manual-only frontmatter остаётся отдельной, неописанной границей explicit skills. — r08, c04
- **R08-F03 [idea]** Для этих шести ролей нужны task-specific схемы и независимый oracle, а не только {result:any}. — r08, c04
- **R08-F04 [unknown]** Качество текущих шести role prompts со skills и устойчивость к injection ещё не измерены. — r08, c04
- **R09-I01 [idea]** Короткий безопасный переход от причины остановки к конкретной операции — r09, c05
- **R09-AF01 [already-fixed]** Владение асинхронными эффектами панели уже связано с исходным run visit — r09, c05
- **R09-AF02 [already-fixed]** Идентичность, черновик, раскрытие и положение редактора await уже сохраняются — r09, c05
- **R09-AF03 [already-fixed]** Старый await не запускает заменённый или отменяемый run — r09, c05
- **R09-U01 [unknown]** IME и озвучивание динамических изменений assistive technology — r09, c05
- **r11-I01 [idea]** Отделить immutable geometry от live states и масштабировать инспектор активаций — r11, c06
- **r11-U01 [unknown]** Не определён обязательный агрегатный статус разных конечных исходов одного узла в нескольких scope — r11, c06
- **r11-AF01 [already-fixed]** Разведение маршрутов, масок и корректность возвратов подтверждены — r11, c06
- **r11-AF02 [already-fixed]** Trace scope, ARIA-selection и полные текстовые имена исправлены — r11, c06
- **r11-AF03 [already-fixed]** Async ownership и состояние wait редактора не следует переоткрывать — r11, c06
- **R12-I01 [idea]** Явно хранить provenance observedEffort — r12, c06
- **R12-AF01 [already-fixed]** Ledger, legacy и partial/zero корректны после корректного входа — r12, c06
- **R12-AF02 [already-fixed]** Ancestor provenance, operation intent, trace и исходы имеют раздельные значения — r12, c06
- **R12-U01 [unknown]** Частота успешного missing-usage у live провайдеров не установлена — r12, c06
- **R12-U02 [unknown]** Согласованность summary/page при конкурентной записи не проверена — r12, c06
- **R12-U03 [unknown]** Server-side effort и точность SDK pricing/invoice не установлены — r12, c06
- **R13-I01 [idea]** Не обещать неизменность credentials по одному семейству ModelsError — r13, c07 (ревью отсутствует)
- **R13-U01 [unknown]** Forced-kill persistence не доказана cooperative-abort тестами — r13, c07 (ревью отсутствует)
- **R13-A01 [already-fixed]** Завершившийся OAuth refresh сохраняется при caller abort; failed refresh не стирает credential — r13, c07 (ревью отсутствует)
- **R13-A02 [already-fixed]** OpenAI/Codex/xAI: проверенные no-retry и безопасные HTTP observations — r13, c07 (ревью отсутствует)
- **R13-A03 [already-fixed]** Frozen model/thinking/tools и skill delivery проверяются до inference — r13, c07 (ревью отсутствует)
- **R13-A04 [already-fixed]** Cancel, IPC и output repair закрывают проверенные lifecycle-гонки — r13, c07 (ревью отсутствует)
- **R15-002 [idea]** Добавить native-browser oracle к исправленному await editor — r15, c08
- **R15-003 [unknown]** Причина исторических process timeouts и null exit остаётся неизвестной — r15, c08
- **R15-004 [already-fixed]** Frozen skill доставляется не только на диск; reader проверяется до допуска — r15, c08
- **R15-005 [already-fixed]** UI visit guards и сохранение await disclosure/caret/scroll уже в текущем коде — r15, c08
- **R16-I01 [idea]** Показывать состояние SDK patch отдельной read-only проверкой doctor — r16, c08
- **R16-U01 [unknown]** Полнота воспроизводимого clean install не установлена — r16, c08
- **R16-F01 [already-fixed]** SDK bash signal обработан как ошибка; patch installer проверяет байты до записи — r16, c08
- **R16-F02 [already-fixed]** Выбранный frozen skill доставляется и реально читается SDK — r16, c08

Remaining6roles: выполнен **offline corpus/design**, не model eval. Live provider frequency/billing, forced-kill persistence, PID reuse races, clean install, screen readers/IME и полная publication matrix не доказаны. Нет оснований добавлять скрытые retries, бюджеты, лимиты или approvals.

## Реализационные карточки подтверждённых авторских bug claims

Ниже сохранены trigger, результат, адрес кода, воспроизводитель, контрдоказательства и минимальная рекомендация. Полные fixture sources находятся в указанной primary паре; команды со старыми /tmp — исторические: для нового выполнения извлечь fixture в новый уникальный каталог, не переигрывать старую запись вслепую. Полный объект каждой находки без потери полей есть в summary JSON.

### r01-B01 — Канонизация object.fields меняет exists/fallback на routing error
Источник: `research/2026-09-20-astra-max/r01-graph-compiler.json`; critic `c01`: complete.

**Код/evidence:** file: src/compiler.ts; lines: 17-23; fact: Рекурсивная сортировка ключей всех объектов перед JSON.parse; file: src/compiler.ts; lines: 68,121; fact: Канонизация применяется к рёбрам и узлам; file: src/expressions.ts; lines: 54-58; fact: Object.entries задаёт порядок вычисления; exists подавляет только MissingReference; file: src/run-runtime.ts; lines: 126-134; fact: Ошибка explainEdge сохраняется и становится routing failure; file: tests/expressions.test.ts; lines: 28-36; fact: exists не должен подавлять ошибки типа

**Триггер:** input: flag: 1; expression: op: exists; value: op: object; fields: z: op: ref; path: input; missing; a: op: not; value: op: ref; path: input; flag; orderRequirement: В исходном AST z вставлен раньше a; expression используется условием ребра start->yes перед fallback start->no

**Ожидается:** Прямые evaluate/chooseEdge/explainEdge и generated execution одного принятого AST совпадают по успеху/ошибке и переходу

**Наблюдалось:** validation: valid; directEvaluation: False; directDestination: no; directTraceReason: fallback; generatedError: Condition must return a boolean; generatedTraceReason: error; directJournalActivations: start:succeeded; no:succeeded; generatedJournalActivations: start:succeeded; hashObservation: Перестановка z/a не меняет source hash, но меняет прямой результат

**Причина:** Порядок вычисления object fields наблюдаем через различие MissingReference и других ошибок; канонизатор предполагает его незначимость

**Воспроизведение:** experiments: r01-E03; r01-E04; fixture: Markdown: E04 / `probe-journal-parity.ts`; command: cd $P && node --import tsx probe-journal-parity.ts; environment: Offline archive исходной ревизии; availableModels: []; два отдельных RunStore(':memory:'); без supervisor/workers

**Контрдоказательства:** При boolean flag true/false оба пути выбирают fallback; В исходном порядке a,z прямой evaluator также падает; Select и all/any short-circuit проходят существующие и дополнительные проверки; Это не инъекция кода, не изменение порядка массива рёбер и не доказательство дефекта live provider

**Минимальная правка, риск, тест:** implemented: False; minimalChange: Определить единый порядок object.fields и применять его в evaluator, например обход отсортированных ключей с тестом числоподобных имён. Альтернатива: сохранять значимый порядок AST при сериализации с решением о версии compiler/source hash.; risk: Приоритет ошибок прямого API может измениться; изменение сериализации нарушает старые source/hash. Старые generated modules также загружают текущий evaluator.; acceptance: Обе перестановки полей и числоподобные ключи дают одинаковую семантику direct/generated; Проверены valid/invalid boolean и присутствующее/отсутствующее поле; Choose/explain/generated JournalRuntime согласованы по результату или ошибке; Legacy и lazy regressions сохранены; exists не подавляет все ошибки подряд

### r01-B02 — Прямая graph JSON-граница выполняет inherited code и принимает нестабильный snapshot
Источник: `research/2026-09-20-astra-max/r01-graph-compiler.json`; critic `c01`: complete.

**Код/evidence:** file: src/graph.ts; lines: 77-89; fact: Обещана защита от getters/prototypes; массивы исключены из prototype-check, проверяется только количество ключей; file: src/graph.ts; lines: 98-103; fact: После слабого preflight запускается TypeBox Check; file: src/graph.ts; lines: 243-246; fact: После validation выполняется structuredClone без повторной проверки; file: src/compiler.ts; lines: 19; fact: Канонизация map/join пропускает единственную дырку; file: src/authoring.ts; lines: 154-156; fact: Строгая проверка собственных индексов уже есть на authoring-границе; file: src/output-schema.ts; lines: 13-15; fact: Та же более строгая проверка уже есть на output-границе

**Триггер:** Literal = Array(1) без собственного 0, с extra:42 и prototype поверх Array.prototype, содержащим getter 0, возвращающий 7. Дополнительный случай: dense Array subclass в graph.nodes с переопределённым entries().

**Ожидается:** Отказ до getter/method; принятый parseWorkflow snapshot должен оставаться валидным без потери данных

**Наблюдалось:** initialValidation: valid; getter вызван один раз; parse: getter вызван повторно; snapshot length=1, own 0 отсутствует; повторная validation false; compile: getter вызван третий раз; generated output []; denseSubclass: validation valid; overridden entries вызван 3 раза; controls: Четыре обычных compensated holes отвергнуты TypeBox; authoring/output отвергают exotic sparse fixture без getter

**Причина:** Разные реализации JSON-границы: graph принимает inherited numeric read, structuredClone удаляет prototype, canonicalization затем теряет дырку. Dense subclass показывает дополнительный риск вызова переопределяемых array methods.

**Воспроизведение:** experiments: r01-E05; r01-E09; fixture: Markdown: E05 / `probe-exotic-array.ts`; command: cd $P && node --import tsx probe-exotic-array.ts

**Контрдоказательства:** Обычные sparse+extra массивы без exotic prototype не обходят итоговую TypeBox validation; JSON.parse не создаёт такие getters/prototypes; удалённый exploit через JSON не продемонстрирован; Authoring/output исправлены и отказывают до getter; Подготовка плана имеет дополнительный assertJson; прохождение fixture до реального запуска не заявляется

**Минимальная правка, риск, тест:** implemented: False; minimalChange: Проверять точные собственные индексы в graph preflight и либо отклонять nonstandard array prototypes до schema walking, либо не вызывать переопределяемые методы входного массива. По возможности согласовать JSON boundary с authoring/output.; risk: Изменение допустимости subclasses/cross-realm arrays и диагностик прямого API. Только исправления количества ключей недостаточно для dense subclass.; acceptance: Обе exotic fixtures отклоняются до getter/entries; Плотные, frozen и shared noncyclic JSON по-прежнему допустимы; Validation success в поддерживаемом домене влечёт валидность parseWorkflow snapshot; Compile не превращает принятый массив длины 1 в []

### r01-B03 — workflow.schema.draft содержит конфликтующие named definitions
Источник: `research/2026-09-20-astra-max/r01-graph-compiler.json`; critic `c01`: complete.

**Код/evidence:** file: src/authoring.ts; lines: 36-39; fact: DraftSchema включает два cyclic bundle через NodeSchema и EdgeSchema; file: src/graph.ts; lines: 73-74; fact: Оба bundle определяют Json и Expr; file: src/service.ts; lines: 91-93; fact: Публичный ответ возвращает внутренний DraftSchema без conversion; file: src/authoring.ts; lines: 30-33; fact: PublicDraftPatchSchema уже преобразована portableInputSchema; file: src/public-schema.ts; lines: 20-48; fact: Существующий helper устраняет неоднозначность repeated definitions

**Триггер:** JSON roundtrip ответа workflow.schema, затем new Ajv2020({strict:true,allowUnionTypes:true}).compile(schemas.draft)

**Ожидается:** Самостоятельная опубликованная JSON Schema компилируется и проверяет результат createDraft

**Наблюдалось:** error: reference "Json" resolves to more than one schema; duplicatePositions: graphs patternProperties / nodes / items / $defs / Json; graphs patternProperties / edges / items / $defs / Json; strictFalse: Та же ошибка; afterPortableConversion: Compile успешен; draft принят; extra property отвергнуто; internalTypeBox: Принимает draft; publicPatch: Компилируется и принимает корректный patch с id

**Причина:** Внутренняя TypeBox-схема опубликована без уже существующей нормализации local refs

**Воспроизведение:** experiments: r01-E06; r01-E09; fixture: Markdown: E06 / `probe-schema-service.ts`; command: cd $P && node --import tsx probe-schema-service.ts; environment: WorkflowService(':memory:'); только schema dispatch; без controller

**Контрдоказательства:** Internal authoring TypeBox работает; Публичный patch/id уже исправлен и работает; Exploratory probe отдельно компилирует workflow/expression/patch с strict:false; Проблема возникает до validation данных, без run/model/provider

**Минимальная правка, риск, тест:** implemented: False; minimalChange: Публиковать portable-копию DraftSchema, не меняя internal TypeBox schema; проверять весь schema response в отдельной регрессии; risk: Форма named refs изменится для потребителей; набор принимаемых JSON drafts должен остаться прежним; acceptance: Все schema documents ответа по отдельности компилируются стандартным валидатором после JSON roundtrip; Draft принимает пустой корректный черновик и отвергает extra property; Patch/id и literal-preserving regressions сохранены; Ослабление Ajv strictness не используется как обход

### R02-B01 — step.catchAll сокращает составной Cause перед collect
Источник: `research/2026-09-20-astra-max/r02-effect-execution.json`; critic `c01`: complete.

**Код/evidence:** src/run-runtime.ts:205-214; src/run-runtime.ts:69-76; src/compiler.ts:109-125

**Триггер:** Обычная первая failure + cleanup/typed cancelled/interrupted/uncertain-effect/Effect interrupt в parallel или sequential Cause дочернего step; retry не разрешён.

**Ожидается:** Сохранить полный Cause после checkpoint; collect отклоняет запрещённую смесь без collection.settled.

**Наблюдалось:** Direct collect отказывает; generated graph после step возвращает Effect Success с failed-оболочкой первой причины. Новые cleanup/typed-interrupted/interrupt cases записали 1 коллекцию; defect case вернул Failure и 0. Две typed причины видны в metadata.failureCauses листа, но не в Cause родителя.

**Причина:** Effect 3.22.1 catchAll/matchEffect передаёт только первую typed failure, если нет defect; возврат Effect.fail(error) теряет остальной Cause. Проверка retry в release ещё использует полный Cause и работает консервативно.

**Воспроизведение:** fixture: Markdown, приложение A, r02-offline-probe; command: R02-TMP/verify.mts через node --import DEPS/tsx/dist/loader.mjs; полный bootstrap в Markdown; cases: generated-cleanup; generated-typed-interrupted; generated-interrupt; generated-defect; fixtureSha256: 1f7c80f94aec31c0372c0de9af675187786b0f5e885c27e7305d2b41fadbb22b

**Контрдоказательства:** Direct collect корректно отвергает опасные mixtures; дефекты остаются Failure.; Retry policy анализирует все причины до catchAll; опасный retry не воспроизведён.; Нет доказательства успешного run.cancel: actual AbortController и desired=cancelled отдельно закрывают допуск.; Nested retained fail-fast подтверждает потерю interrupt, но его запланированная вторая typed cleanup не дошла до журнала.

**Минимальная правка, риск, тест:** minimalChange: Cause-aware обработчик; при отсутствии разрешённого admission/retry вернуть Effect.failCause(originalCause), сохранить guards executedAttempt/owner/cancel.; risk: Наивный catchAllCause может поймать defect/interruption как разрешение новой работы; нельзя отменять уже исправленный admission race. Сохранение Cause затронет internal fail-fast sibling interruption, не только user cancel; нужна проверка совместимости вложенного fan-out.; acceptanceCriteria: Generated map и parallel не собирают обе формы опасного mixed Cause и не выполняют следующий writer.; Исходные причины сохраняются, запись retry остаётся консервативной.; Обычные errors collect, replay, safe retry и pause/resume проходят.; implementationPerformed: False; acceptanceSuiteStatus: proposed-not-run

### R02-B02 — clearPid в finally замещает исходный отказ; untyped cleanup пропускает следующий writer
Источник: `research/2026-09-20-astra-max/r02-effect-execution.json`; critic `c01`: complete.

**Код/evidence:** src/run-runtime.ts:279-285; src/run-runtime.ts:270; src/run-runtime.ts:348-356; src/run-runtime.ts:26-39; src/workspaces.ts:287-294

**Триггер:** Основная операция отклонилась, затем clearPid выбрасывает ошибку группы или транзакции workerLaunch=settled.

**Ожидается:** Первичная и cleanup причины сохранены раздельно; неполный cleanup не превращается в branch data и не допускает следующие узлы.

**Наблюдалось:** Контрольный ENOENT — process/setup/not-started и empty group. При SQLite trigger на cleanup остаётся только unknown/execution/unknown, ENOENT утрачен. Collect возвращает Effect Success, следующий реальный check пишет marker, прежняя group pending; finish(succeeded) отдельно отказывает. Retained живой собственный потомок также замещает SIGKILL на uncertain-effect/cleanup.

**Причина:** JS-finally замещает исходное отклонение. Сырые cleanup исключения не получают фазу cleanup; fallback execution позволяет collect собрать их как обычный отказ.

**Воспроизведение:** fixture: Markdown, приложение A; cases: ordinary-missing-check; cleanup-checkpoint-followed-by-writer; injection: SQLite BEFORE INSERT activation.metadata с workerLaunch=settled, только child scope; command: Полный bootstrap приложения A; новый /tmp/r02-reproduce-*

**Контрдоказательства:** pending группа сохранена, retry той же активации блокируется.; RunStore.finish и supervisor cleanup_uncertain не признают terminal success.; SQL trigger — отказ транзакции fixture, не измерение реального дискового сбоя.

**Минимальная правка, риск, тест:** minimalChange: Разделить outcome операции и cleanup, скомпоновать причины, нормализовать инфраструктурные исключения на cleanup-границе как cleanup/unknown. Учесть Git callback; исправлять совместно с B01.; risk: Нельзя очищать неподтверждённый PID/group или объявлять действия безопасно повторяемыми. AggregateError без поддержки Cause/классификации недостаточен.; acceptanceCriteria: Обе причины доступны при ENOENT/SIGKILL + cleanup fault.; Нет collected failed data и следующий writer не стартует.; pending/ownership не скрываются; штатный ENOENT остаётся собираемым.; Отдельные agent/Git fault fixtures перед переносом решения.; implementationPerformed: False; acceptanceSuiteStatus: proposed-not-run

### R02-B03 — Interruption ждёт cleanup Promise, но подавляет ошибку очистки
Источник: `research/2026-09-20-astra-max/r02-effect-execution.json`; critic `c01`: complete.

**Код/evidence:** src/run-runtime.ts:35-40; src/run-runtime.ts:191-202

**Триггер:** AbortController после старта собственного check; SQLite trigger отклоняет cleanup settled checkpoint.

**Ожидается:** Interruption остаётся управляющей причиной, после drain доступна отдельная реальная cleanup-ошибка без ложной ошибки для обычного ProcessCancelled.

**Наблюдалось:** В E06 подтверждено достижение cleanup callback. Exit Failure/interrupted=true, failures=[] и defects=[]; cleanup marker отсутствует в error активации, group=pending. E05 показывает такой же исход.

**Причина:** Async canceler ждёт promise.then(success=>undefined,rejection=>undefined); поздний reject через resume уже не доставляется в прерванную операцию.

**Воспроизведение:** fixture: Markdown, приложение A; case: interrupt-and-cleanup-checkpoint; command: Полный bootstrap приложения A; новый /tmp/r02-reproduce-*

**Контрдоказательства:** Drain не отменён: существующий runtime-test проверяет ожидание реального процесса.; Новый эксперимент не доказывает живой процесс после Exit.; Отмена не стала Success; pending-group/ownership fence сохраняется.

**Минимальная правка, риск, тест:** minimalChange: Сохранить await/drain, различить ожидаемый отказ операции при отмене и cleanup outcome; скомпоновать последний с interruption либо отдельно надёжно сохранить diagnostics.; risk: Просто вернуть rejected Promise нельзя: обычный ProcessCancelled станет ложным cleanup defect. Нельзя менять owner fencing или порядок drain.; acceptanceCriteria: Abort+cleanup fault оставляет interruption и cleanup marker, не допускает collection/retry/следующий writer.; Обычный abort без cleanup fault остаётся штатной отменой и ждёт процесса.; Раздельные fixtures для первичного отказа, cleanup fault и их сочетания.; implementationPerformed: False; acceptanceSuiteStatus: proposed-not-run

### R03-001 — LC_ALL=C у наблюдателя превращает живой supervisor с Unicode-путём журнала в interrupted на macOS
Источник: `research/2026-09-20-astra-max/r03-process-lifecycle.json`; critic `c02`: **отсутствует; только producer evidence**.

**Код/evidence:** src/run-controller.ts:29-34; src/run-controller.ts:43-63; src/run-controller.ts:66-67; src/run-controller.ts:229-264; src/supervisor.ts:31-37; carriedFrom: Последняя частичная команда-черновик retained r03-actions.json; не ранее опубликованный отчёт; rechecked: Ссылки и механизм по исходникам текущего cwd на study-source; свежий полный locale fixture E08, OS-контроль E10; newFinding: False

**Триггер:** Darwin/macOS; Unicode в пути журнала (в fixture — каталог «журнал»); workerless supervisor в await; LC_ALL=C только у наблюдателя. Supervisor запущен и наблюдается живым в UTF-8 locale.

**Ожидается:** Смена locale представления ps не должна менять идентичность OS-процесса. observe должен сохранить supervisorAlive=true, owner и waiting; неверный owner/run/store/script по-прежнему должен отвергаться.

**Наблюдалось:** E08: ASCII-каталог — liveBefore=true, utf8Alive=true, cAlive=true, status=waiting, ownerRetained=true, interruptedEvents=0. Unicode-каталог — liveBefore=true, utf8Alive=true, cAlive=false, status=interrupted, ownerRetained=false, interruptedEvents=1; supervisor сам остановился после fencing. E10: C скрывает буквальный Unicode argv через M- notation, en_US.UTF-8 сохраняет его.

**Причина:** ps вызывается с унаследованной locale. На проверенной macOS при C Unicode argv представляются через M- notation, а matchesCommand сравнивает их с буквальными Unicode script/store. Несовпадение принимается за отсутствие нужного процесса, затем observe записывает markInterrupted при отсутствии workers/groups.

**Воспроизведение:** fixture: locale.mjs; fixtureSha256: 8878ebb3f32314796129b6841a3cbdd89323006dede328dfd724d820c3460f90; markdownSection: Приложение A; command: TMPDIR="$ROOT" node --import "$ROOT/study-source/node_modules/tsx/dist/loader.mjs" "$ROOT/locale.mjs" "$ROOT/study-source" "$ROOT"; setup: Новый mktemp -d /tmp/r03-repro-XXXXXX; скопировать src и package.json из study-source cwd, symlink на существующие node_modules разрешённого dev; сохранить приложение под указанным именем в новом ROOT. Полная подготовка в Markdown, раздел 5. Никаких старых fixtures/живых БД.

**Контрдоказательства:** E01: текущая защита другой установки с пробелами в пути и legacy/pre-attach проходит; это не переоткрытие 37ff399.; E08: тот же Unicode-run перед сменой locale жив; ASCII-run при C также жив.; При живом распознанном worker или pending непустой группе guard не разрешает markInterrupted; не доказан запуск двух writers.; На Linux/Node 22.19 не выполнялось; не заявляется одинаковый формат ps на всех платформах.

**Минимальная правка, риск, тест:** minimalChange: Стабилизировать кодировку argv-представления обоих вызовов ps в общем адаптере: для macOS передавать проверенную UTF-8 locale только дочернему ps, не менять locale запуска/задания. При невозможности получить достоверное представление вернуть ошибку/unknown, а не доказательство смерти.; risk: Locale и формат ps платформозависимы; нельзя без проверки предполагать наличие C.UTF-8 на macOS или ослаблять точные owner/run/store/script сравнения.; acceptance: Сохранённый Unicode store и Unicode script распознаются наблюдателями с C и UTF-8 locale, с attached PID и в pre-attach окне.; Контрольный ASCII-case и wrong owner/run/store/script остаются корректными; observe не пишет run.interrupted для живого waiting supervisor.; Проверка работает на macOS и выбранной поддерживаемой POSIX-платформе; ошибки ps не очищают owner.; implemented: False

### R03-002 — Поблочное декодирование stdin повреждает UTF-8 task/input и check args на границе pipe chunks
Источник: `research/2026-09-20-astra-max/r03-process-lifecycle.json`; critic `c02`: **отсутствует; только producer evidence**.

**Код/evidence:** src/pi-worker-process.ts:22-29; src/check-worker-process.ts:22-29; src/process-client.ts:90-94; src/process-client.ts:159-163; src/pi-worker.ts:312; carriedFrom: Последняя частичная команда-черновик retained r03-actions.json; не ранее опубликованный отчёт; rechecked: Ссылки и механизм по исходникам текущего cwd на study-source; свежий split stdin + обычный runCheckProcess E09; newFinding: False

**Триггер:** UTF-8 многобайтный символ пересекает границу chunk stdin. JSON остаётся синтаксически допустимым, если разрез внутри строкового значения. Это возможно при одном штатном stdin.end(JSON.stringify(request)), не только при нескольких write.

**Ожидается:** Обёртка должна получить те же строки, которые сериализовал клиент, независимо от фрагментации pipe; check должен исполнить точные args, pi — получить точные task/input/cwd/config.

**Наблюдалось:** У настоящего check wrapper после split внутри «А»: exitCode=0 и stdout «��Б» вместо «АБ». У настоящего pi wrapper перехват результата JSON.parse зафиксировал task «��Б»; version=999 завершил вызов configuration до auth/model. Штатный runCheckProcess с аргументом из 70000 «А» вернул exitCode=0, 70002 символа и 4 U+FFFD вместо исходных 70000; SHA отличался. ASCII-префикс x сдвинул выравнивание: 70001 символ, 0 замен, SHA совпал.

**Причина:** Buffer.toString()/String(Buffer) декодируют каждый chunk независимо и заменяют оборванные последовательности. Последующее сложение строк не восстанавливает байты; JSON.parse принимает U+FFFD внутри JSON-строки. У stdout в process-client уже используется setEncoding("utf8"), у stdin двух entrypoints нет потокового decoder.

**Воспроизведение:** fixture: utf8.mjs; fixtureSha256: a278a8d8a7e75201b37318c3a82bb04fb834f7f677f0c400ac728484d577c16a; markdownSection: Приложение B; command: TMPDIR="$ROOT" node --import "$ROOT/study-source/node_modules/tsx/dist/loader.mjs" "$ROOT/utf8.mjs" "$ROOT/study-source" "$ROOT"; setup: Новый mktemp -d /tmp/r03-repro-XXXXXX; скопировать src и package.json из study-source cwd, symlink на существующие node_modules разрешённого dev; сохранить приложение под указанным именем в новом ROOT. Полная подготовка в Markdown, раздел 5. Никаких старых fixtures/живых БД.

**Контрдоказательства:** E01 подтверждает literal args/отсутствие shell expansion: причина не shell quoting.; Контроль с x перед Unicode не повреждается: ошибка зависит от границ байтов, а не от любого русского текста.; В pi-проверке намеренно нет модели: доказана порча разобранного request, но не live provider prompt. Перенос в prompt при валидном запросе — вывод из src/pi-worker.ts:312.; ready/result NDJSON тесты и ошибки malformed JSON проходят, но не проверяют UTF-8, пересекающий границу stdin.

**Минимальная правка, риск, тест:** minimalChange: Декодировать stdin потоково в обоих entrypoints (StringDecoder/setEncoding UTF-8) либо собрать Buffer до EOF и декодировать один раз. Сохранить abort/destroy, EOF admission и отказ до исполнения при незавершённом вводе; не вводить новые лимиты запроса.; risk: Общий reader не должен сломать отмену до EOF, обработку закрытой трубы или строгую семантику JSON. Если вводится fatal UTF-8 decoding, его отказ должен оставаться setup/not-started.; acceptance: Разрезать 2-, 3- и 4-байтные символы во всех внутренних позициях; оба wrapper должны сохранить точные строки.; Штатный runCheckProcess с большим Unicode-аргументом должен дать исходный SHA; ASCII-префиксы не меняют смысл.; Тесты SIGTERM/disconnect на незавершённом stdin и PID-checkpoint-before-send остаются зелёными.; Проверить task/input/cwd без вызова модели; успешный offline тест не объявлять проверкой провайдера.; implemented: False

### r04-B01 — Вторичный ROLLBACK скрывает исходный отказ хранения
Источник: `research/2026-09-20-astra-max/r04-journal-recovery.json`; critic `c02`: **отсутствует; только producer evidence**.

**Код/evidence:** src/run-store.ts:240-243; src/run-store.ts:673-679; catch выполняет database.exec("ROLLBACK") до throw error; исключение cleanup заменяет первичное.; Новая E09 сравнила полную исходную activation и события после ABORT и обоих FULL-путей.; Первичный error из completeActivation непосредственно подтверждён исторической E03 и новой E09.; carried: True; continuationCodeRechecked: True; continuationReproduced: True

**Триггер:** SQLite сама отменяет транзакцию при SQLITE_FULL: fixture ограничивает max_page_count текущим page_count и пытается сохранить output 256 KiB. Это не quota продукта и не заполнение физического диска.

**Ожидается:** Исключение RunStore сохраняет первичный errcode=13 и причину database or disk is full; незавершённые изменения не фиксируются.

**Наблюдалось:** directSql: errcode: 13; message: database or disk is full; runStore: errcode: 1; message: cannot rollback - no transaction is active; abortControl: errcode: 1811; message: r04 injected ABORT; activationAndEventsUnchanged: True; connectionReusableAfterFixtureLimitRemoved: True; subsequentSuccessEvents: 1; integrity: ok; foreignKeyViolations: 0

**Воспроизведение:** command: node --import tsx --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { RunStore, activationKey } from './src/run-store.ts';
const dir = await mkdtemp('/tmp/r04-full-repro-');
const store = new RunStore(dir + '/state.sqlite');
const plan = {
  version: 1, runtimeVersion: 'dynamicwf-runtime-v1', compilerVersion: 'test',
  source: '', sourceHash: 'source', hash: 'plan', agents: {},
  workflow: { version: 1, id: 'workflow', name: 'Fixture', revision: 1,
    entryGraph: 'main', graphs: {} },
}; // Минимальная fixture низкоуровневого журнала, не план для запуска.
try {
  store.create({ id: 'run', plan, input: null, cwd: dir });
  const { token } = store.reserveLaunch('run');
  const context = { scope: ['root'], graphId: 'main', nodeId: 'work', visit: 0 };
  const key = activationKey(context);
  store.beginActivation('run', token, context, { kind: 'transform', sideEffect: false });
  const db = store.database; // Только fixture: TS private, не публичный API.
  const pages = db.prepare('PRAGMA page_count').get().page_count;
  db.exec(`PRAGMA max_page_count=${pages}`);
  const payload = 'x'.repeat(256 * 1024);
  let direct, wrapped;
  try {
    db.exec('BEGIN IMMEDIATE');
    db.prepare('UPDATE workflow_activations SET output=? WHERE run_id=?')
      .run(JSON.stringify(payload), 'run');
    db.exec('COMMIT');
  } catch (e) { direct = e; }
  assert.equal(direct.errcode, 13);
  const events = store.events('run');
  try { store.completeActivation('run', token, key, payload); }
  catch (e) { wrapped = e; }
  assert.equal(wrapped.errcode, 1);
  assert.match(wrapped.message, /cannot rollback/);
  assert.equal(store.getActivation('run', key).status, 'running');
  assert.equal(store.getActivation('run', key).output, undefined);
  assert.deepEqual(store.events('run'), events);
  db.exec('PRAGMA max_page_count=100000');
  store.completeActivation('run', token, key, 'small result');
  assert.deepEqual(db.prepare('PRAGMA integrity_check').all()
    .map(r => r.integrity_check), ['ok']);
  console.log({ direct: direct.message, wrapped: wrapped.message });
} finally { store.close(); await rm(dir, { recursive: true, force: true }); }
NODE; note: Самодостаточная offline fixture из корня checkout с установленными зависимостями. mkdtemp создаёт новую /tmp/r04-full-repro-*; current-bug assertions намеренно ожидают 1. После исправления ожидать 13. Минимальный plan не предназначен для запуска графа.; experiments: E03; E09

**Контрдоказательства:** refs: tests/run-store.test.ts:380-402; tests/attempt-history.test.ts:24-35; tests/reconciliation.test.ts:76-91; explanation: Зелёные RAISE(ABORT) тесты оставляют активную транзакцию для явного rollback; это не ветвь auto-rollback. E09 подтвердила различие.; refs: E03; E09; explanation: Частичная фиксация/потеря данных не обнаружена; соединение сохранило работоспособность. Не заявлены corruption или replay внешнего действия.

**Минимальная правка, риск, тест:** minimumChange: Сохранить первичное исключение независимо от результата cleanup ROLLBACK; вторичную ошибку хранить отдельно при необходимости. Не добавлять автоматические повторы записей и не полагаться без проверки на новые API Node.; risk: Безусловное подавление cleanup failure может спрятать неизвестное состояние соединения; важна отдельная диагностика.; acceptanceCriteria: FULL-проба возвращает первичную причину и errcode=13.; Состояние и события до/после отказа совпадают.; RAISE(ABORT) сохраняет свою причину, после восстановления ресурса возможен новый commit.; Проверить минимальную Node 22.19; application writes не повторяются автоматически.; implemented: False

### R05-B01 — Fence continuation ошибочно отклоняет точный повтор исходного run.start
Источник: `research/2026-09-20-astra-max/r05-idempotency-continuation.json`; critic `c03`: complete.

**Код/evidence:** src/service.ts:128-130; src/run-controller.ts:124-127; src/run-controller.ts:193-201; src/run-store.ts:323-324

**Триггер:** Завершить prepared run.start с ключом, создать для него run.continue и повторить тот же исходный запрос start.

**Ожидается:** Вернуть исходный run ID, текущее состояние и lineage без резервирования, spawn и новой работы.

**Наблюдалось:** Ошибка Run was replaced by a continuation and cannot be relaunched. До continuation тот же запрос возвращал исходный ID. Источник остался succeeded, события не изменились, всего два run, один check-эффект преемника.

**Причина:** Service на найденной доставке вызывает completeStart, который безусловно вызывает launch. continuationLaunchable=false пропускает только workspace-check, не reserve. reserveLaunch бросает fence-ошибку раньше проверки статуса; catch launch распознаёт только Run is not launchable.

**Воспроизведение:** experimentId: R05-E02; fixtureSection: Приложение A, первый сценарий; command: TMPDIR=/tmp/r05-idempotency-probe-bKHuz5 node --import tsx /tmp/r05-idempotency-probe-bKHuz5/probe.mjs; runs: 2; faultInjection: False; scope: Настоящие WorkflowService, SQLite, supervisor и локальный check; agent-узлов нет. Полный fixture сохранён в Markdown.

**Контрдоказательства:** Дедупликация записи run работает: третьего run и повторной записи не было.; Запрет resume источника правилен и тоже подтверждён probe.; Для уже сохранённого ответа await аналогичная повторная доставка уже реализована правильно; это не повторное открытие исправленной ошибки stale waits.

**Минимальная правка, риск, тест:** implemented: False; minimalChange: При финализации первоначальной доставки возвращать fenced run как наблюдение; не ослаблять общий reserveLaunch/resume fence. Обработать также fence, появившийся между чтением и reserve.; risk: Слишком широкий catch может скрыть реальный отказ запуска либо разрешить исполнение заменённого источника.; acceptanceCriteria: Повтор исходного start после continuation из succeeded/paused/interrupted возвращает тот же ID и lineage без новых событий или резерваций.; Конфликт input/operation остаётся ошибкой.; Resume источника и новый ответ его открытому await запрещены.; Конкурентный fence/start-repeat не запускает источник.

### R05-B02 — Повтор continuation не завершает первоначальный запуск после create-before-reserve
Источник: `research/2026-09-20-astra-max/r05-idempotency-continuation.json`; critic `c03`: complete.

**Код/evidence:** src/run-store.ts:1106-1129; src/run-controller.ts:416-417; src/run-controller.ts:429-436; src/run-controller.ts:453-464; src/service.ts:278-279

**Триггер:** Неприостановленный continuation зафиксирован вместе с queued target и source fence, но отправитель исчез до completeStart/reserve; новый клиент повторяет точный run.continue.

**Ожидается:** Завершить первоначальный запуск unfenced ownerless queued/running после проверки workspace, не создавая нового run и не возобновляя interrupted/paused/terminal.

**Наблюдалось:** Три повторные доставки через новый WorkflowService вернули тот же queued, owner=null, ноль активаций и run.reserved, без файла эффекта. Источник уже fenced. Explicit resume запустил цель и записал одну строку.

**Причина:** createContinuation фиксирует target, receipt и fence раньше completeStart. Service duplicate-path и controller duplicate/race-return paths возвращают сохранённую запись без финализации первоначального запуска.

**Воспроизведение:** experimentId: R05-E02; fixtureSection: Приложение A, второй сценарий; command: TMPDIR=/tmp/r05-idempotency-probe-bKHuz5 node --import tsx /tmp/r05-idempotency-probe-bKHuz5/probe.mjs; runs: 2; faultInjection: Только в процессе fixture метод completeStart временно бросает исключение при наличии receipt, после commit до reserve; затем восстановлен.; scope: Сохранённое состояние прочитано и повтор доставлен через новый сервис. Настоящий SIGKILL отправляющего клиента в этом окне не выполнялся.

**Контрдоказательства:** Same-run обещание continuation формально соблюдено; отдельное обещание восстановления create-gap в документе continuation не сформулировано.; Bug относится к потере продвижения первоначального запуска, не к дублированию. Для эквивалентного окна prepared-start финализация уже реализована.; Обычные concurrent continuation и повтор после успеха проходят существующие тесты.; Явный resume — рабочий обход без нового ключа; вероятность окна не измерялась.

**Минимальная правка, риск, тест:** implemented: False; minimalChange: Использовать безопасный финализатор первоначального старта для найденной continuation, включая race-return paths: только unfenced queued, desired=running, owner=null; проверять workspace/Git. Остальные состояния только возвращать.; risk: Ошибка объединения путей может снять паузу, повторить неопределённую попытку или потребовать удалённый cwd у завершённого run. Учитывать R05-B01 для цепочки continuations.; acceptanceCriteria: Fault после commit до reserve и повтор из нового клиента дают одну резервацию, одного преемника и один check-эффект.; Конкурентные повторы не размножают supervisor.; Paused/interrupted/terminal/fenced цели не исполняются от повторной доставки.; Удалённый cwd завершённой цели не мешает чтению; изменённый workspace до первой резервации остаётся отказом.

### r06-B01 — Игнорируемый вложенный Git-репозиторий обходит защиту коллизий; integrate перезаписывает незафиксированные байты
Источник: `research/2026-09-20-astra-max/r06-worktrees-artifacts.json`; critic `c03`: complete.

**Код/evidence:** src/workspaces.ts:250-267; src/workspaces.ts:176-179; PROJECT_INFO/workspaces.md:87-104; E02; E03; E04

**Триггер:** В чистом для внешнего Git назначении .gitignore содержит cache/. В cache находится отдельный Git repository и изменённый, не закоммиченный cache/value.txt. Собственный завершённый source worktree принудительно отслеживает cache/value.txt с другим содержимым.

**Ожидается:** Отказать до merge из-за коллизии с игнорируемыми локальными данными; сохранить bytes, HEAD назначения и вложенную историю.

**Наблюдалось:** В сохранённой fixture Git ls-files --others --ignored --exclude-standard -z вернул cache/ одной записью. integrate завершился успешно; HEAD внешнего repo изменился, cache/value.txt стал WORKER вместо UNCOMMITTED USER DATA. Во вложенной истории осталось LOCAL COMMITTED BASE, а не потерянные незакоммиченные bytes.

**Причина:** NFC/lowercase-нормализация сохраняет конечный slash cache/. Проверка tracked cache/value.txt ищет ignored.has('cache/value.txt') и префикс ignored.has('cache'), но множество содержит только 'cache/'. ignoredParents содержит 'cache', однако его проверяют лишь против полного tracked path. Защита не видит вложенность. Передаваемый --no-overwrite-ignore в сохранённом локальном прогоне также не остановил merge.

**Воспроизведение:** fixture: reproduction.script, первый цикл, mode=ignored-nested; historicalCommand: cd /tmp/r06-frozen-baseline-LLFhzs/source && TMPDIR=/tmp/r06-frozen-baseline-LLFhzs/tmp node --import tsx /tmp/r06-frozen-baseline-LLFhzs/probes/reproduce.mts /tmp/r06-frozen-baseline-LLFhzs/source /tmp/r06-frozen-baseline-LLFhzs/probes; freshCommand: См. reproduction.freshCommand; старые каталоги для нового запуска не использовать.

**Контрдоказательства:** Та же коллизия без .gitignore (unignored-nested) отвергнута, bytes и HEAD сохранены.; Обычный игнорируемый каталог без вложенного .git (ignored-regular) дал запись cache/value.txt и был отвергнут; bytes и HEAD сохранены.; Штатные tests/workspaces.test.ts:313-334,357-372 проходят для обычного ignored-файла и варианта регистра. Они не проверяют collapsed directory entry cache/.; Это не отсутствие всей защиты ignored и не общий эффект любого merge: нужны конкретная структура directory entry и source collision.

**Минимальная правка, риск, тест:** minimalChange: Канонизировать directory entries ignored так, чтобы конечный '/' не мешал сравнению префиксов; сохранять NUL-разбор, NFC/casefold и обе стороны file/directory collision. Добавить вложенный ignored Git repository в профильный regression test. Не обходить проблему force/reset/удалением файлов.; risk: Консервативный отказ может затронуть намеренную замену локальных ignored-каталогов; это безопаснее перезаписи. Нельзя потерять уже существующую защиту имён с пробелами/переводами строк, casefold и parent-path collisions.; acceptance: ignored-nested отказывает до первой мутации merge, HEAD назначения и незакоммиченные bytes побайтно сохранены; unignored-nested и ignored-regular по-прежнему отказывают без потери данных; Непересекающийся source продолжает интегрироваться; Для directory/file и case/Unicode вариантов сохранена консервативная защита

**Границы:** Доказано прямым вызовом настоящего GitWorkspaces с его собственными allocations/commits, без модели и без пользовательских данных. owned передан напрямую; слой журнала не обходится гипотезой — runtime сам собирает owned из succeeded worktree. Другие Git/platforms не испытывались. Точный исторический номер версии Git отдельно в логе не записан; нынешняя версия Git приведена лишь как observation новой операции.

### r06-B02 — assume-unchanged/skip-worktree превращают изменённые tracked-файлы в ложное clean и скрывают их из коммита артефакта
Источник: `research/2026-09-20-astra-max/r06-worktrees-artifacts.json`; critic `c03`: complete.

**Код/evidence:** src/workspaces.ts:28-38; src/workspaces.ts:42-54; src/workspaces.ts:282-285; src/workspaces.ts:161-173; skills/dynamic-workflows/recipes/implementation-review/snapshot.mjs:21-27; PROJECT_INFO/workspaces.md:24-26; PROJECT_INFO/workspaces.md:52-56; E02; E03; E04

**Триггер:** Для существующего tracked-файла явно задан git update-index --assume-unchanged либо --skip-worktree, затем bytes изменены на диске. Отдельно флаг установлен в source и в выделенном child worktree; runtime сам эти флаги не устанавливает и перенос между индексами не предполагается.

**Ожидается:** Не выдавать такой каталог за чистый и не завершать worktree с артефактом, молча пропустившим его неигнорируемые правки. При неподдерживаемой семантике индекса безопасно отказать до side effect с конкретной причиной.

**Наблюдалось:** Для обоих флагов status пуст. allocate принял source с UNCOMMITTED SOURCE, но child получил старое base. В child изменённый other.txt остался UNCOMMITTED CHILD, а commit вернул прежний head==base и git show HEAD:other.txt показал old other. snapshot выдал прежнее git-tree:HEAD^{tree}. integrate непересекающегося new.txt в скрыто грязное назначение тоже успешен. После снятия флага source allocation правильно отказывает must be clean.

**Причина:** clean полностью доверяет status. commit ещё и условно вызывает add только при непустом status. snapshot копирует индекс вместе со специальными flags и использует обычный add --all; последний также не включает скрытую правку. Корректный хеш Git-дерева тем самым не является доказательством всех прочитанных ревьюером bytes.

**Воспроизведение:** fixture: reproduction.script, второй цикл, flag=assume-unchanged и flag=skip-worktree; historicalCommand: cd /tmp/r06-frozen-baseline-LLFhzs/source && TMPDIR=/tmp/r06-frozen-baseline-LLFhzs/tmp node --import tsx /tmp/r06-frozen-baseline-LLFhzs/probes/reproduce.mts /tmp/r06-frozen-baseline-LLFhzs/source /tmp/r06-frozen-baseline-LLFhzs/probes; freshCommand: См. reproduction.freshCommand.

**Контрдоказательства:** Снятие каждого флага возвращает обнаружение dirty source — это не обычный отказ status для всех изменений.; snapshot честно совпадает с результатом стандартного staging; криптографической ошибки или несуществующего commit hash нет. Недостаточен более сильный вывод о чистоте рабочих bytes.; Git намеренно доверяет assume-unchanged; skip-worktree используется sparse-checkout. Это специальные состояния, требующие явного включения, а не дефект любого обычного checkout.; Игнорируемые зависимости по контракту не копируются; здесь проверялись уже tracked-файлы без правила .gitignore.; Tests implementation-recipes:95-123 подтверждают staged/unstaged/deleted/forced-ignored/missing-index, но флаги update-index не покрывают.

**Минимальная правка, риск, тест:** minimalChange: Явно определить поддержку index flags. Минимально безопасно обнаруживать assume-unchanged/skip-worktree и отклонять неподдерживаемое состояние до allocation/integration/commit, а snapshot давать тот же отказ. Если sparse-checkout должен поддерживаться, нужна проверка реально присутствующих bytes через временный индекс без изменения пользовательского индекса; автоматически снимать флаги в реальном индексе нельзя.; risk: Безусловный запрет flags ограничит легитимный sparse checkout и пользовательские настройки производительности. Более точная проверка должна учитывать absent sparse paths и Git filters, иначе получатся ложные отказы или иной Git-артефакт.; acceptance: Для обоих флагов изменённый присутствующий tracked-файл не приводит к ложному clean/успешному пропуску правки; Индекс пользователя, его flags и рабочие bytes сохраняются при отказе; Нормальные staged/unstaged/forced-ignored/missing-index сценарии сохраняют согласованность snapshot и commit; Политика для неизменённого flagged-файла и отсутствующего sparse path явно документирована и проверена; Регрессию восстановления через общий clean добавить отдельно; сейчас это предложенная проверка

**Границы:** Воспроизведено пропускание правки в коммите/выделенном дереве и допуск скрыто грязного назначения, не перезапись этого файла при конфликтующем merge. Данные скрытого tracked-файла на диске сохранились. Влияние общего clean на recovery — вывод по коду, отдельный recovery fixture с флагами не запускался.

### R07-B01 — CLI принимает неправильные типы continuation request, которые отвергает MCP
Источник: `research/2026-09-20-astra-max/r07-authoring-cli-mcp.json`; critic `c04`: complete.

**Код/evidence:** src/lineage.ts:244; src/lineage.ts:254; src/lineage.ts:259; src/service.ts:274-282; src/mcp-tools.ts:37-40; src/mcp.ts:19-26; src/output-schema.ts:35; parseContinuationRequest применяет String к source.checkpoint и source.planHash до проверки и возвращает приведённые строки.; Одноэлементный JSON-массив [hash] превращается в тот же hash.; value.reuse ?? [] превращает явный null в отсутствие reuse.; MCP публикует string для обоих source-хешей и array для reuse и валидирует вход до сервиса без coercion.

**Триггер:** В корректном run.continue заменить source.checkpoint и source.planHash на [исходнаяСтрока]. Отдельный случай: reuse:null без reuse-узлов.

**Ожидается:** Обе поверхности отвергают неверные типы до изменения runs/receipts.

**Наблюдалось:** mcp: isError:true; Invalid structured output: data/source/checkpoint must be string; data/source/planHash must be string; число fixture runs осталось 1; cli: exit 0, ok:true, создан новый paused run, число fixture runs стало 2; normalRedelivery: Корректный запрос со строками через MCP возвратил тот же ID, что ошибочная форма через CLI; reuseNull: CLI принял null как повторную доставку; MCP отвергнул null; supervisorCreated: False

**Воспроизведение:** experimentId: R07-E02; fixture: contract-probes.mjs: блок continuation; полный исполняемый листинг в Markdown-приложении; command: TMPDIR=/tmp/r07-authoring-MCi7LO/tmp node --import tsx /tmp/r07-authoring-MCi7LO/contract-probes.mjs "$PWD" /tmp/r07-authoring-MCi7LO; cwd: /Users/ramu/.local/state/dynamicwf-evaluation-20260920/integration-dev

**Контрдоказательства:** Неверный строковый checkpoint из 64 нулей отвергнут без нового run.; src/run-controller.ts:422-427 по-прежнему проверяет сохранённые checkpoint, planHash и workspaceDigest.; Корректная дедупликация работает; обход свежести или повтор внешнего действия не доказан.; Источник и преемник в собственном fixture paused; исполнители не запускались.

**Минимальная правка, риск, тест:** minimalChange: Проверять typeof обоих source-хешей до regex и не приводить их String; различать omitted reuse и null. Добавить differential cases parser/service/CLI/MCP.; risk: Отказ недокументированным клиентам, полагавшимся на coercion. Не менять canonical representation корректных запросов и историю ключей.; acceptance: [hash], вложенный массив и reuse:null отвергаются обеими поверхностями до записи; строковые хеши, omitted reuse и [] работают; прежний корректный idempotency key возвращает исходный ID.; implemented: False

### R07-B02 — Проигрыш SQLite CAS теряет RevisionConflictError и revision-поля
Источник: `research/2026-09-20-astra-max/r07-authoring-cli-mcp.json`; critic `c04`: complete.

**Код/evidence:** src/store.ts:42-49; src/authoring.ts:44-47; src/authoring.ts:60; src/cli.ts:30-31; src/mcp.ts:32; Ранний конфликт applyPatch типизирован, но ветвь changes!==1 в DraftStore.patch бросает обычный Error.; Оба serializer-а выдают expectedRevision/actualRevision только для RevisionConflictError.; CAS предотвращает потерю обновления: найден дефект диагностики, не атомарности записи.

**Триггер:** Два редактора читают revision 1, первый сохраняет 2 до UPDATE второго; второй проигрывает условный UPDATE.

**Ожидается:** Один победитель, один структурный RevisionConflictError с expectedRevision и actualRevision, без записи проигравшего пакета.

**Наблюдалось:** successes: 1; finalRevision: 2; loserExitCode: 1; loserError: name: Error; message: Revision conflict while saving workflow: race; revisionFieldsPresent: False; lostUpdate: False

**Воспроизведение:** experimentId: R07-E02; fixture: Два отдельных CLI-процесса; monkeypatch DraftStore.get добавляет только пост-read барьер, чтобы оба процесса видели revision 1. Реальный UPDATE и serialization не подменяются.; publishedIn: r07-authoring-cli-mcp.md, приложение R07-E02, ветка cas-worker

**Контрдоказательства:** При последовательном stale patch обе поверхности вернули одинаковый RevisionConflictError expected 1 / actual 2.; Итоговый draft содержит только одну из двух graph-записей.; tests/store.test.ts:9-34 проверяет последовательный stale editor; :50-75 — конкурентную инициализацию, не patch CAS.; operationIndex и rollback подтверждены skill-handoff tests.; MCP CAS race отдельно не запускался; потеря его revision-полей следует из общего store и inspected serializer.

**Минимальная правка, риск, тест:** minimalChange: После failed CAS получить текущую revision и выбросить RevisionConflictError(request.expectedRevision, actualRevision). Сохранить CAS, не повторять пакет автоматически.; risk: Изменение класса/текста ошибки для клиентов; при третьем писателе actualRevision является текущим наблюдением, не обязательно revision первого победителя.; acceptance: Барьерный fixture даёт одного победителя и один RevisionConflictError expected 1 / actual 2; ровно один пакет записан; CLI/MCP сохраняют поля.; implemented: False

### R07-B03 — Публичная draft schema содержит неоднозначные повторные идентификаторы
Источник: `research/2026-09-20-astra-max/r07-authoring-cli-mcp.json`; critic `c04`: complete.

**Код/evidence:** src/authoring.ts:31-39; src/graph.ts:73-75; src/service.ts:91-93; src/public-schema.ts:20-48; DraftSchema вкладывает NodeSchema и EdgeSchema с повторными cyclic Json/Expr definitions.; workflow.schema отдаёт сырой DraftSchema, тогда как PublicDraftPatchSchema уже portable.; JSON-сериализованная result.draft не компилируется установленным Ajv2020.

**Триггер:** JSON round-trip workflow.schema result, затем new Ajv2020(...).compile(result.draft).

**Ожидается:** Публичная схема черновика самостоятельно компилируется и может проверять в том числе незавершённый draft.

**Наблюдалось:** draft: reference "Json" resolves to more than one schema; workflow: compiled; expression: compiled; create: compiled; patch: compiled; portableDraftControl: После существующего portableInputSchema схема скомпилировалась и приняла пустой корректный draft

**Воспроизведение:** experimentId: R07-E02; fixture: contract-probes.mjs: schemaCompilation; actual WorkflowService result после JSON.parse(JSON.stringify(...)); publishedIn: r07-authoring-cli-mcp.md, приложение R07-E02

**Контрдоказательства:** Внутренний TypeBox authoring и обычные create/patch работают.; Публичные workflow, expression, create, patch компилируются в том же цикле.; Это не возвращение старого бага patch без id.; Доказана несовместимость с закреплённым Ajv, не со всеми schema processors. Если draft предназначался исключительно для чтения TypeBox-представления, область дефекта уже, но он публикуется как самостоятельная схема.

**Минимальная правка, риск, тест:** minimalChange: Публиковать отдельную переносимую копию DraftSchema через существующий portableInputSchema, не мутируя внутреннюю схему; либо собрать один cyclic bundle.; risk: Сохранность literals, имён свойств и $ref; нельзя заменять строки/ключи глобально.; acceptance: Все пять опубликованных схем компилируются pinned Ajv после JSON round-trip; draft принимает пустой черновик и отвергает лишние поля/malformed nodes; literal regressions проходят.; implemented: False

### R07-B04 — Начатый prepare открывает незакрываемые повторным close соединения после закрытия сервиса
Источник: `research/2026-09-20-astra-max/r07-authoring-cli-mcp.json`; critic `c04`: complete.

**Код/evidence:** src/service.ts:48-69; src/service.ts:114-120; src/prepared-plans.ts:28-40; src/mcp.ts:37; src/cli.ts:21-34; closed проверяется только на входе dispatch.; prepare сначала ожидает executionWorkspace, затем вызывает lazy store getters без closed guard.; close выставляет closed и повторно становится no-op, даже если позднее появились соединения.

**Триггер:** Свежий service с существующим валидным draft на диске; pending=dispatch(workflow.prepare); немедленный close; await pending; повторный close.

**Ожидается:** После close сервис не оставляет новые открытые соединения. Это не требование run.cancel или отката уже совершённых действий.

**Наблюдалось:** prepareReturnedAfterClose: True; draftConnectionQueryableAfterSecondClose: True; planConnectionQueryableAfterSecondClose: True; futureDispatchRejected: True; normalAwaitThenCloseClosesConnection: True

**Воспроизведение:** experimentId: R07-E02; fixture: contract-probes.mjs: closeRace. Без таймеров и подмены функций. TypeScript-private fields читаются только fixture-ом для запросов и ручного cleanup.; publishedIn: r07-authoring-cli-mcp.md, приложение R07-E02

**Контрдоказательства:** Нормальный await dispatch; close действительно закрывает соединение.; CLI следует этому нормальному порядку и не объявляется сломанным данным race.; Реальный disconnect MCP в этом окне не воспроизведён; распространение через server.onclose — inference.; Доказаны открытые соединения, не production RSS growth, постоянная блокировка или исчерпание дескрипторов. GC/exit могут освободить ресурсы.

**Минимальная правка, риск, тест:** minimalChange: Общий closed guard в lazy getters, включая использование существующих объектов. Альтернатива требует явного drain-протокола уже начатых dispatch. Не добавлять автоматическую отмену runs.; risk: Нужно определить controlled closed error для начатого prepare. Нельзя обещать rollback завершившихся до close эффектов.; acceptance: Immediate-close не оставляет открытых draft/plan connections; повторный close не пропускает ресурсы; нормальный close, отказ будущим dispatch и независимость уже созданного supervisor сохраняются.; implemented: False

### R09-B01 — Ответ сохранён на паузе, но узел всё ещё «Ждёт ответа»
Источник: `research/2026-09-20-astra-max/r09-waits-gates-ux.json`; critic `c05`: complete.

**Код/evidence:** citation: src/run-store.ts:573-577; fact: Транзакция успешно фиксирует validated response, status=resolved и wait.resolved.; citation: src/run-runtime.ts:163-167; fact: waiting:false записывается только после await gate(signal); на паузе gate не пропускает.; citation: src/run-runtime.ts:82-90; fact: Gate проверяет операторское desired; paused не получает допуск.; citation: src/observation.ts:37-39; fact: activationState называет running await с metadata.waiting=true состоянием waiting.; citation: src/observation.ts:68-68; fact: waitingKeys строится из activationState без durable WaitRecord.; citation: src/graph-view/model.ts:54-57; fact: Узел графа также получает waiting из metadata, не по статусу сохранённого wait.; citation: src/graph-view/model.ts:79-83; fact: Статус активации в snapshot, используемый инспектором, берётся из activationState.; citation: src/monitor.ts:105-107; fact: Watch повторяет причину/ID вопроса по metadata.waiting.; citation: src/graph-view/app.js:466-469; fact: Wait summary учитывает только durable open и скрывается после resolved.; citation: src/graph-view/app.js:1133-1137; fact: Раздел «Сейчас» пересоздаётся и пропускает resolved-карточку.; citation: src/graph-view/app.js:1178-1198; fact: Подсказка о паузе существует только в открытой карточке; общего подтверждения сохранённого ответа нет.

**Триггер:** Дождаться открытого await при живом supervisor → поставить паузу до status=paused → сохранить валидный JSON → оставаться на паузе без resume. Это разрешённый пользовательский путь, без ручной правки БД.

**Ожидается:** Отличать вопрос без ответа от сохранённого ответа, задержанного операторской паузой. Показывать read-only квитанцию/значение и точную идентичность, не писать «Ждёт ответа», не запускать работу и не объявлять незавершённый await succeeded.

**Наблюдалось:** status: paused; desired: paused; durableWaitStatus: resolved; response: allow: False; activeKeysCount: 0; waitingKeysCount: 1; graphNodeStatus: waiting; inspectorLabel: Ждёт ответа; waitCardsCount: 0; waitSummaryHidden: True; resumeVisible: True; nowText: Новых задач пока нет. Ожидание следующего шага.; monitorStillShowsQuestionAndWaitId: True; finishBeforeResume: False; afterResume: status: succeeded; taskOutcome: rejected; waitingKeysCount: 0

**Воспроизведение:** experimentIds: E04; E05; commands: node --import "$DEV/node_modules/tsx/dist/loader.mjs" "$P/paused.mjs" "$DEV" "$P"; node "$P/browser.mjs" "$REPO" "$P"; fixtures: Полные побайтные paused.mjs и browser.mjs в приложении Markdown; P должен быть новым /tmp/r09-reproduce.*, DEV/REPO — исходники e15bc40 с существующими зависимостями.; safety: Только собственная временная БД/supervisor без модели; браузер рисует сохранённый snapshot и перехватывает resolve в mock fetch, не отправляя mutations в живую панель. При продолжении команды не повторены.

**Контрдоказательства:** citation: tests/await-outcome.test.ts:112-124; statement: Прошедший тест защищает сохранность паузы и отсутствие finish до resume, но не проверяет waitingKeys, подпись узла или подтверждение ответа.; citation: tests/graph-view-observation.test.ts:286-303; statement: Тест stale snapshots уже утверждает исчезновение формы после resolved. Это защищает актуальность снимка, но не правдивость оставшейся подписи узла или квитанцию.; experimentId: E04; statement: Точная повторная доставка дала только одно wait.resolved, конфликтующая отклонена, после resume использован именно allow:false. Потери ответа или снятия паузы нет.; citation: src/graph-view/model.ts:33-35; statement: Полный snapshot и run.waits содержат resolved response; отсутствие обычной карточки не означает утрату журнала.

**Минимальная правка, риск, тест:** implemented: False; minimalChange: Сопоставлять проекцию/представление с durable WaitRecord по точному ID/key, показывать «Ответ сохранён · на паузе» и read-only значение, исключать resolved из вопросов, требующих ответа. Не объявлять такую активацию работающей или succeeded.; avoid: Не переносить механически waiting:false перед gate: metadata участвует в activeWork/учёте паузы.; risk: Расхождение watch/browser, смешение одинаковых вопросов map по nodeId вместо key, ложное завершение/допуск; нужна совместимость старых записей.; acceptanceCriteria: Реальный pause→resolve(true/false) остаётся paused с 0 active work и отображает точную квитанцию/ответ, не предлагает повторно отвечать и не пишет «Ждёт ответа».; Соседний unresolved await остаётся вопросом с собственной идентичностью.; Resume потребляет сохранённый ответ один раз; watch/snapshot/browser согласованы.; Отмена и continuation не переоткрывают resolved wait; idempotency и fence сохраняются.

**Границы:** Длительный случай доказан для ручной паузы; частота/длительность промежутка без паузы не измерялась.; Браузерная часть — настоящий HTML/DOM, но подставной транспорт; это не end-to-end live provider.

### R09-B02 — Семантический опрос выбрасывает фокус с действия await
Источник: `research/2026-09-20-astra-max/r09-waits-gates-ux.json`; critic `c05`: complete.

**Код/evidence:** citation: src/graph-view/app.js:1459-1468; fact: Значимое изменение JSON signature вызывает renderPanel; heartbeat/time observation исключены.; citation: src/graph-view/app.js:1131-1133; fact: renderNow удаляет карточки целиком через replaceChildren.; citation: src/graph-view/app.js:490-507; fact: Восстановление focus/selection/scroll связано только с dataset.waitId активного поля.; citation: src/graph-view/app.js:1157-1160; fact: dataset.waitId и адресуемый id назначены textarea.; citation: src/graph-view/app.js:1162-1175; fact: Submit не имеет соответствующего маркера фокуса; его native DOM заменяется.; citation: src/graph-view/app.js:1144-1146; fact: Details сохраняет open по wait ID, но summary не получает идентичность для восстановления focus.

**Триггер:** В «Сейчас» ввести JSON, перейти Tab на «Сохранить ответ»; до Space приходит значимый снимок того же run. Для summary — установить фокус на «Данные и формат ответа» перед таким обновлением. Heartbeat сам по себе недостаточен.

**Ожидается:** Если тот же wait открыт и control доступен, сохранить фокус точного submit/summary; Space должен выполнить выбранное действие без повторного Tab-наведения.

**Наблюдалось:** browser: Chrome/153.0.8010.52; beforeSemantic: tag: BUTTON; text: Сохранить ответ; heartbeatOnlyFocus: BUTTON; afterSemanticFocus: BODY; mockPostsAfterSpaceWithLostFocus: 0; mockPostsAfterRefocusTabSpace: 1; summaryAfterSemantic: focusTag: BODY; detailsOpen: True; textareaControl: focusTag: TEXTAREA; text: {"allow":false}; selection: 2; 7; direction: backward; detailsOpen: True; trustedSubmitKeySequence: Tab; Space; Tab; Space; summaryFocusMethod: Native summary.focus(); Tab/Space на summary отдельно не проверялись

**Воспроизведение:** experimentId: E05; command: node "$P/browser.mjs" "$REPO" "$P"; fixture: Полный browser.mjs в приложении Markdown; snapshots создаёт paused.mjs. Реальные index.html/CSS/модули базы; отключён только автоматический startup/polling, вызван production refreshSnapshot.; semanticChange: Для детерминированной перерисовки в fixture увеличен usage.totalTokens. Модель/соседний live agent не вызывались.; safety: Свой Chrome profile и static loopback fixture server; resolve перехвачен внутри страницы. Текущая операция fixture не исполняла.

**Контрдоказательства:** experimentId: E05; statement: Heartbeat-only update сохранил BUTTON: дефект не на каждом polling.; citation: tests/graph-view-observation.test.ts:120-132; statement: Зелёный тест уже защищает текст, focus, directional selection и scroll textarea. Native положительный контроль текста/selection/disclosure также прошёл.; citation: tests/graph-view-observation.test.ts:31-84; statement: Fake DOM replaceChildren не моделирует native потерю activeElement при удалении focused button; успех такого suite не опровергает контрпример Chrome.; experimentId: E05; statement: После повторного наведения focus→Tab→Space mock resolve сработал ровно один раз. Кнопка не недоступна вообще; ошибочная отправка или потеря текста не доказаны.

**Минимальная правка, риск, тест:** implemented: False; minimalChange: Сохранять control identity (run visit + waitId + submit/summary) и возвращать focus только существующему доступному control либо не пересоздавать неизменившийся keyed DOM.; avoid: Не возвращать фокус старому wait после смены run/visit, resolve, cancellation или continuation fence.; risk: Focus stealing у другой карточки, возвращение на исчезнувшее действие, нарушение textarea caret/scroll и двойная отправка.; acceptanceCriteria: Native Chrome: Tab/Space submit и summary переживают semantic update и перестановку соседей; Space на submit — ровно один разрешённый resolve, Space на summary — переключение соответствующего details без POST.; Heartbeat остаётся no-op для DOM.; Смена run/visit и закрытие wait не возвращают старый focus/control.; Положительные проверки текста, backward selection, scroll и disclosure остаются зелёными.

**Границы:** Применимость к обновлению соседней ветви выведена из общей signature-перерисовки; частота события в live задачах не измерялась.; CDP создавал trusted Tab/Space для submit; физическая клавиатура/AT/IME не использовались. Summary проверен через native focus(), без отдельного клавиатурного действия.; Ранние диагностические Enter-варианты не дали корректного положительного контроля; дефект Enter не заявляется.

### R10-B01 — Старый runs откатывает новый список после control follow-up
Источник: `research/2026-09-20-astra-max/r10-async-dashboard.json`; critic `c05`: complete.

**Код/evidence:** path: src/graph-view/app.js; startLine: 1485; endLine: 1495; path: src/graph-view/app.js; startLine: 1508; endLine: 1511; path: src/graph-view/app.js; startLine: 1531; endLine: 1531; path: src/graph-view/app.js; startLine: 1643; endLine: 1643

**Триггер:** Незавершённый polling refreshRuns; затем pause POST, актуальный snapshot и control refreshRuns заканчиваются раньше исходного GET.

**Ожидается:** После нового списка более ранний запрос не заменяет status/usage/lineage и не перекрывает успешное обновление старой ошибкой связи.

**Наблюдалось:** before: list: paused; detail: paused; afterOldGet: list: waiting; detail: paused; sidebarLabel: Ждёт ответа; afterFreshGet: list: paused; afterOlderErrorFollowingNewListAndSnapshot: notice: OLDER_LIST_FAILURE; connection: Нет связи; controlPosts: 1

**Причина:** У refreshRuns нет собственного поколения чтения. Внешний isCurrent различает посещения для control, но оба чтения одного посещения проходят. listSignature — только сравнение данных, не порядок.

**Воспроизведение:** node "$R10_TMP/browser.mjs" "$PWD" "$R10_TMP/list.js"

**Контрдоказательства:** Snapshot сохранил paused: исправление 1451–1455 работает.; 21 observation regression прошёл; 532–613 проверяют уход с посещения и актуальный unscoped refresh, а не два reordered списка одного посещения.; Сам poll последовательный; нужен другой источник чтения (control follow-up).; Следующий успешный список восстанавливает UI; потеря серверной команды не наблюдалась.

**Минимальная правка, риск, тест:** minimalChange: Собственное поколение list request, объединённое с имеющимся isCurrent; guard до reload 401, после JSON и в catch.; risk: Не подавить глобальный sidebar refresh после навигации, initial selection и актуальный 401; не заменить visit guard одним run ID.; acceptance: Новый list success → старые success/body decode/error/401 не меняют принятую проекцию/feedback.; Текущий success/401 и A→B→A/control tests работают.; implemented: False; additionalTestsNotExecuted: Body-decoding и 401 варианты именно нового list-order guard.

**Границы:** Реальная частота доставки в таком порядке не измерена.; Не утверждается откат SQLite или изменение разрешений команд.

### R10-B02 — Polling инвалидирует медленную загрузку всей задачи до её применения
Источник: `research/2026-09-20-astra-max/r10-async-dashboard.json`; critic `c05`: complete.

**Код/evidence:** path: src/graph-view/app.js; startLine: 294; endLine: 306; path: src/graph-view/app.js; startLine: 1470; endLine: 1474; path: src/graph-view/app.js; startLine: 1632; endLine: 1648; path: src/graph-view/app.js; startLine: 1322; endLine: 1339; path: src/graph-view/task-scope.js; startLine: 116; endLine: 122

**Триггер:** Task mode; snapshot/list быстрые, task-usage 1600 мс при примерно секундном polling. Каждый refresh начинает новую загрузку и увеличивает taskFetch.

**Ожидается:** Успешная загрузка того же task/visit завершается при продолжающемся polling; loading/stale task data обозначены, сумма run не выдается за task total.

**Наблюдалось:** slow: latencyMs: 1600; observationMs: 4400; taskUsageCalls: 5; taskCalls: 0; pollingSnapshotCalls: 4; runListCalls: 1; taskUsage: None; selectedTask: True; displayedTotal: 0; expectedTaskTotal: 30; afterStoppingOnlyFixturePoll: taskCalls: 1; displayedTotal: 30; fastControl: latencyMs: 20; observationMs: 4400; taskUsageCalls: 5; taskCalls: 5; displayedTotal: 30

**Причина:** void loadTaskScope на каждом snapshot запускает следующий seq до завершения предыдущего; проверка seq на 299 отбрасывает успешный ответ. Task total применяется только после всех запросов. Пока taskUsage null, renderer выбирает state.run.usage при кнопке «Вся задача».

**Воспроизведение:** node "$R10_TMP/browser.mjs" "$PWD" "$R10_TMP/task.js"

**Контрдоказательства:** При 20 мс тот же polling применяет task total 30.; Последний медленный in-flight запрос завершается после остановки только timer, без изменения API.; 7 task-scope tests успешно проверяют identity и producer navigation; они не моделируют периодическую инвалидацию медленного ответа.

**Минимальная правка, риск, тест:** minimalChange: Переиспользовать незаконченный task Promise в текущем task/visit; не начинать эквивалентный load каждым poll. Сохранять generation при настоящей смене scope/visit. Обозначать task loading/stale и не маркировать run totals как task totals.; risk: Не перенести данные старого посещения через A→B→A и не заморозить новые totals после первого успеха.; acceptance: При API 1600 мс и продолжающемся production poll task total появляется.; Рост total затем появляется без смены вкладки; нет очереди взаимно инвалидирующих запросов.; Смена task/visit во время каждого await безопасна; подпись суммы соответствует scope.; implemented: False; additionalTestsNotExecuted: Рост total после предлагаемого исправления.; Смена task/visit на каждой стадии изменённого загрузчика.

**Границы:** Latency искусственная, распределение задержек пользовательской панели неизвестно.; Порог зависит от длительности snapshot/list, не универсально равен 1000 мс.; Это не лимит графа, не провайдерская квота и не предложение скрытых retries.

### R10-B03 — Старое чтение recovery history скрывает известную сохранённую запись
Источник: `research/2026-09-20-astra-max/r10-async-dashboard.json`; critic `c05`: complete.

**Код/evidence:** path: src/graph-view/app.js; startLine: 848; endLine: 860; path: src/graph-view/app.js; startLine: 744; endLine: 748; path: src/graph-view/app.js; startLine: 674; endLine: 676

**Триггер:** Инспекция уже загружена. GET reconciliations начат до POST reconcile, POST receipt доставлен первым, затем старый GET [] завершает чтение.

**Ожидается:** Более ранний GET не стирает подтверждённую запись и saved flag; история не заявляет отсутствие решений одновременно с receipt той же формы.

**Наблюдалось:** afterPost: historyRecords: 1; saved: True; draftReceipt: True; afterOldGet: historyRecords: 0; saved: False; draftReceipt: True; claimsNoRecords: True; claimsSaved: True; afterExplicitRefresh: historyRecords: 1; reconcilePosts: 1; historyGets: 2

**Причина:** History GET и POST независимо и безусловно заменяют reconciliationRecords под одним run/key; cached захвачен до await. Время GET ставится при доставке. Inspection также пишет эти кэши, но отдельная её гонка не воспроизводилась.

**Воспроизведение:** node "$R10_TMP/browser.mjs" "$PWD" "$R10_TMP/recovery.js"

**Контрдоказательства:** draft.request/decisionId/receipt сохраняются; автоматического второго POST нет. Это не регрессия visit ownership позднего receipt.; Тесты receipt 221–283 прошли.; Явный свежий GET восстанавливает историю.; Прочитанный сервер проверяет identity решения, checkpoint/attempt/workspace и explicit supersedes; повреждение БД или обход guard не показаны.

**Минимальная правка, риск, тест:** minimalChange: Поколение reconciliation cache по run/key с инвалидацией чтений, начатых до успешного POST; согласовать отдельный history loader и inspection writer. Свежему GET разрешить уточнять application/superseded status.; risk: Вечный merge по decisionId заморозит статус применения; общая блокировка ухудшит независимые формы.; acceptance: GET-before-POST → receipt → старый GET не убирает запись.; GET-after-POST обновляет application/superseded.; То же при old error, inspection writer и независимых ключах.; implemented: False; additionalTestsNotExecuted: Late-error и inspection-writer перестановки.; Изменение application/superseded в следующем свежем GET.

**Границы:** Только браузерное отображение/кэш: fake receipt не доказывает реальную запись журнала.; Другие кэши не объявляются сломанными.

### r11-B01 — Выбор узла и семантическая перерисовка теряют клавиатурный фокус
Источник: `research/2026-09-20-astra-max/r11-graph-scale.json`; critic `c06`: complete.

**Код/evidence:** src/graph-view/app.js:1068-1072; src/graph-view/app.js:510-514; src/graph-view/app.js:967-969; src/graph-view/app.js:490-506; src/graph-view/app.js:1465-1468

**Триггер:** Цепочка 10 узлов. Фокус на fit, настоящий Tab на n0, Enter. Отдельно: фокус n1 и renderPanel после изменения соседа.

**Ожидается:** Фокус остаётся на текущем графовом button; следующий Tab идёт к следующему узлу. Обновление того же run/graph/node не сбрасывает фокус.

**Наблюдалось:** before: g role=button, n0; afterEnter: BODY, state.node=n0; nextTab: n0 повторно, aria-pressed=true; afterSemanticRedraw: BODY

**Причина:** selectNode вызывает renderPanel, renderGraph удаляет все SVG children. Восстановление фокуса реализовано для await/recovery fields, но не для графового узла.

**Воспроизведение:** fixture: browser.mjs; command: node /tmp/r11-graph-scale-sf39ZV/browser.mjs; cwd: actualCwd; resultFields: keyboardBefore; keyboardAfterEnter; keyboardNextTab; keyboardAfterUpdate

**Контрдоказательства:** Выбор и aria-pressed сохраняются: это не повторное открытие ARIA-state дефекта.; graph-node-accessibility прошёл, но его trusted Space тест не проверяет activeElement после активации (tests/graph-node-accessibility.test.ts:290-309).; Сохранение focus/caret/scroll редактора await работает и защищено отдельной регрессией.

**Минимальная правка, риск, тест:** minimalChange: Сохранять и восстанавливать идентичность фокусируемого SVG-узла внутри текущего посещения run/graph либо не заменять SVG-узлы при изменении выбора.; risk: Фокус по одному node ID может ошибочно переноситься в другой graph/run или отнимать фокус у пользователя.; acceptance: Trusted Tab -> Enter -> Tab проходит n0 -> n1; semantic refresh сохраняет focus; смена run/graph его не переносит; await/control/trace проверки остаются зелёными.; implemented: False

### r11-B02 — Tab-навигация достигает полностью невидимого узла без перемещения камеры
Источник: `research/2026-09-20-astra-max/r11-graph-scale.json`; critic `c06`: complete.

**Код/evidence:** src/graph-view/app.js:1023-1029; src/graph-view/app.js:1067-1090; src/graph-view/app.js:1581-1596; src/graph-view/style.css:450-453

**Триггер:** Цепочка 20 узлов, исходный масштаб 0.9. После фокуса fit отправлены 11 Tab без Enter.

**Ожидается:** Сфокусированный graph button и его рамка видны в области SVG при сохранении читаемого масштаба.

**Наблюдалось:** focusedNode: n10; focusedRectY: 2105.6; 2199.2; svgRectY: 284; 904; viewBox: -352 0 1080 688.8888888888889; documentScrollY: 31

**Причина:** Узлы имеют tabindex=0, но нет раскрытия узла в камере при focus. Прокрутка документа не раскрывает клиппированную область SVG.

**Воспроизведение:** fixture: browser.mjs; command: node /tmp/r11-graph-scale-sf39ZV/browser.mjs; cwd: actualCwd; resultFields: offscreenTab

**Контрдоказательства:** Есть focus-visible стиль, полное aria-label и клавиатурная активация.; Fit, mouse pan и центрирование источника из trace дают обходные пути (app.js:1308-1312).; Не утверждается полный keyboard trap или невозможность чтения screen reader.

**Минимальная правка, риск, тест:** minimalChange: При focus сдвигать камеру только если box узла вне viewport, не меняя масштаб; отдельные pan/search shortcuts не обязательны для исправления.; risk: Без проверки видимости камера будет прыгать на каждом Tab и перезаписывать пользовательскую позицию.; acceptance: Tab по цепочкам 20/250 всегда показывает сфокусированную карточку; polling не перемещает камеру; mouse pan и trace navigation сохраняются.; implemented: False

### r11-B03 — После fit большого графа кнопка уменьшения масштаба приближает граф
Источник: `research/2026-09-20-astra-max/r11-graph-scale.json`; critic `c06`: complete.

**Код/evidence:** src/graph-view/app.js:904-925; src/graph-view/app.js:1562-1564; src/graph-view/app.js:1604-1608

**Триггер:** 250 узлов в последовательной цепочке; fit, затем кнопка zoom-out.

**Ожидается:** zoom-out не уменьшает world-space ширину камеры и не увеличивает видимый размер карточек.

**Наблюдалось:** layout: 376; 49084; cameraBefore: 76951.04516129031; 49084; cameraAfter: 30000; 19135.802469135804; fullyVisibleBefore: 250; fullyVisibleAfter: 97; apparentMagnification: 2.565

**Причина:** fit не ограничивает ширину; zoom обрезает даже уже больший fit константой 30000 и тем самым меняет направление масштабирования.

**Воспроизведение:** fixture: browser.mjs; command: node /tmp/r11-graph-scale-sf39ZV/browser.mjs; cwd: actualCwd; resultFields: zoom; zoomSmall

**Контрдоказательства:** На цепочке 10 fit width 3204.4645 корректно увеличивается zoom-out до 4005.5806.; Повторный fit возвращает все карточки; нет потери данных.; Колесо использует ту же функцию по коду, но конкретный дефект воспроизведён кнопкой, не live wheel устройством.

**Минимальная правка, риск, тест:** minimalChange: Согласовать границы zoom с geometry/current fit, сохраняя монотонное направление; не заменять 30000 другим произвольным пределом и не ограничивать workflow.; risk: Нужны проверки конечности чисел, центра и aspect ratio на очень большой геометрии.; acceptance: Zoom-out никогда не уменьшает ширину, zoom-in никогда не увеличивает её на chain 10/250/1000 и wide fanout; fit остаётся доступным.; implemented: False

### r11-B04 — Усечение ID по символам допускает текст в область соседней карточки
Источник: `research/2026-09-20-astra-max/r11-graph-scale.json`; critic `c06`: complete.

**Код/evidence:** src/graph.ts:38; src/graph-view/layout.js:56-66; src/graph-view/app.js:892; src/graph-view/app.js:1044; src/graph-view/style.css:460-463

**Триггер:** Fanout с четырьмя соседями, первый ID = W, повторённая 30 раз. Валидность полноценного workflow проверена parseWorkflow.

**Ожидается:** Видимый ID/ellipsis остаётся внутри своей карточки; полное имя отдельно доступно через title/ARIA.

**Наблюдалось:** textBBoxX: 16; textBBoxWidth: 348.0903015136719; cardWidth: 230; gap: 48; overlapIntoNextCardSvgUnits: 86.0903015136719; textScreenRight: 551.5312652587891; nextCardScreenLeft: 474.0500183105469; overlapCssPx: 77.4812469482422

**Причина:** shorten по длине оставляет 30 широких glyphs нетронутыми, тогда как nodeWidth зависит только от числа портов и текст не ограничен внутренней областью.

**Воспроизведение:** fixture: browser.mjs; command: node /tmp/r11-graph-scale-sf39ZV/browser.mjs; cwd: actualCwd; resultFields: text

**Контрдоказательства:** Full title/aria-label остаются верными, HTML не исполняется.; Accessibility test использует узкие i и проверяет строковое усечение, а не glyph width (tests/graph-node-accessibility.test.ts:90-109).; Карточки и маршруты не перекрываются; это отдельная коллизия содержимого. Соседний node-box может закрывать вышедшие за границу буквы.

**Минимальная правка, риск, тест:** minimalChange: Ограничить область текста внутренним box и подбирать ellipsis по ширине, сохранив полный title/ARIA. Не менять topology от live status/usage.; risk: Разные и поздно загруженные шрифты меняют метрики; измерения требуют кэширования.; acceptance: W/i, длинные допустимые ID, переведённые заголовки и token строки не рисуются за внутреннюю границу карточки в реальном браузере; доступные имена полные.; implemented: False

### R12-B01 — Успешный SSE без provider usage превращается в полный нулевой отчёт
Источник: `research/2026-09-20-astra-max/r12-usage-lineage.json`; critic `c06`: complete.

**Код/evidence:** Закреплённый SDK 0.85.1 принимает finish_reason=tool_calls без блока usage и оставляет исходные нули usage/cost.; hasProviderReportedUsage возвращает true для успешного stopReason без отдельного признака наличия usage.; RunStore и graphSnapshot затем сохраняют и показывают полный 0; результат задания {answer:42} успешен.; Перенесено из собственного сохранённого Markdown, причина перепроверена на sourceRevision и заново воспроизведена R12-C02.

**Триггер:** openai-completions, корректный submit_result, finish_reason=tool_calls и [DONE]; во всех HTTP/SSE chunks и choices отсутствует usage. Транспорт полностью подставной, SDK parser настоящий.

**Ожидается:** Успех задания независим от полноты учёта: отсутствие provider usage остаётся неизвестностью/partial. Явный provider zero сохраняется как известный ноль.

**Наблюдалось:** mode: missing; providerUsageSent: False; calls: 1; reportCount: 1; settled: True; totalTokens: 0; partial: False; costReported: 1; tokenSummary: Токены: 0 · отчётов: 1/1; graphTotal: 0; graphPartial: False; mode: zero; providerUsageSent: True; calls: 1; reportCount: 1; settled: True; totalTokens: 0; partial: False; costReported: 1; tokenSummary: Токены: 0 · отчётов: 1/1; graphTotal: 0; graphPartial: False; mode: positive; providerUsageSent: True; calls: 1; reportCount: 1; settled: True; totalTokens: 13; partial: False; costReported: 1; tokenSummary: Токены: 13 · отчётов: 1/1; graphTotal: 13; graphPartial: False

**Причина:** ref: node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:171-184,378-387,494-504; statement: SDK создаёт нулевой placeholder; завершение требует finish_reason, но не usage.; ref: src/pi-worker.ts:100-105,274-281,341-344; statement: Успешный stopReason считается достаточным для report; complete проверяет reports/turns, а не исходное наличие provider usage.; ref: src/run-store.ts:898-915,929-959; statement: Хранилище принимает уже нормализованные данные, утраченный provenance восстановить не может.

**Воспроизведение:** fixture: missing-usage.mts; fixtureSha256: 87d5555696e99c982641cef8a1dd3d64ca44885c6475789638f6cc7cff1cf4e9; source: research/2026-09-20-astra-max/r12-usage-lineage.md; command: (cd /tmp/r12-cont.IkejEZ/source && node --import tsx /tmp/r12-cont.IkejEZ/missing-usage.mts); setup: Команда в приложении Markdown экспортирует точную sourceRevision в новый /tmp/r12-repro.*, подключает существующий node_modules и извлекает полный fixture. Не запускать в старом tmp; новый каталог обязателен.; experiments: R12-E06; R12-C02; markdownMarker: r12-fixture:missing-usage.mts

**Контрдоказательства:** R12-E04: tests/wave5-c08.test.ts:98-152 защищает error/abort placeholders, известные положительные токены и настоящий zero. Это другой stopReason, не успешный missing-usage поток.; R12-E01/R12-E05: при корректном отсутствующем входе UI/агрегатор не заменяют его нулём.; В R12-C02 explicit-zero даёт 0, positive даёт 13; проблема не арифметика сумм и не поломка успешного результата.

**Минимальная правка, риск, тест:** minimalChange: Сохранить отдельный per-response признак наличия provider usage на границе SDK и передать его в worker accounting. При доказанном отсутствии выпускать usage.unavailable и incomplete, не меняя result success. Если публичный SDK event теряет признак, нужен узкий upstream/версионированный adapter contract; UI-only изменение недостаточно.; risk: Средний: различия API, совместимость SDK; отбрасывание всех нулей сломает реальные zero reports. Не использовать HTTP 200 или приватные transcript для угадывания расхода.; acceptance: Native-parser fixture missing -> reported=0 и partial=true; explicit-zero -> полный 0; positive -> полный 13.; Цепочка positive+missing сохраняет известный subtotal с partial=true.; Error/abort regressions зелёные, успешность результата и полнота usage независимы.; implemented: False; acceptanceExecuted: False

**Границы:** Не доказана встречаемость такого SSE у live OpenAI/xAI/Codex.; Не измерен billing; costReported=1 означает принятую оценку SDK, не списание.; Не исполнена вся матрица provider adapters.

### R12-B02 — Старый usage report получает номер текущей попытки в браузерной подписи
Источник: `research/2026-09-20-astra-max/r12-usage-lineage.json`; critic `c06`: complete.

**Код/evidence:** Перенесено и заново воспроизведено R12-C02.

**Триггер:** У одной agent activation попытка 1 failed с 8 токенами; попытка 2 succeeded с 12. После второй попытки раскрыты отчёты вкладки Токены.

**Ожидается:** Строка report.attempt=1 подписана только попыткой 1; общий scope/node/visit не переносит номер текущей попытки в старый report.

**Наблюдалось:** headers: work · проход 1 · попытка 2 · r12-run · попытка 1 · ответ 1; work · проход 1 · попытка 2 · r12-run · попытка 2 · ответ 1; archiveTotal: 8; currentTotal: 12; activationTotal: 20

**Причина:** ref: src/monitor.ts:38-50; statement: activationPath включает текущий a.attempt.; ref: src/graph-view/model.ts:78-90; statement: Snapshot сохраняет current path.; ref: src/graph-view/app.js:1381-1387; statement: Report ищет активацию по key/run, берёт current path и дописывает собственный report.attempt. Код общий для run/task views.

**Воспроизведение:** fixture: attempt-label.mts; fixtureSha256: 63e5f4e392d9d03daf2b53a7e8fe9993a30aa2df3fe208f8bea77ebc52eb47c0; source: research/2026-09-20-astra-max/r12-usage-lineage.md; command: (cd /tmp/r12-cont.IkejEZ/source && node --import tsx /tmp/r12-cont.IkejEZ/attempt-label.mts); setup: Извлечение полного fixture и новый экспорт sourceRevision — приложение Markdown. Реальный RunStore, graphSnapshot и renderTokens; авто-network startup отключён, DOM минимальный.; experiments: R12-E07; R12-C02; markdownMarker: r12-fixture:attempt-label.mts

**Контрдоказательства:** Ledger, run.attempts и usageReports содержат правильные попытки и суммы 8/12/20.; R12-E02: graph-view-task-scope проверяет producer run/key navigation; неправильная подпись не доказывает порчу identity или двойной счёт.; Task mode использует тот же код по инспекции; самостоятельный DOM reproducer в r12 исполнил run mode, не отдельный браузерный task mode.

**Минимальная правка, риск, тест:** minimalChange: Разделить путь активации без attempt и подпись текущей попытки; для usage report номер брать только из report.attempt. Накопительную сумму явно назвать суммой попыток.; risk: Низкий: presentation-only; не потерять scope/visit и producer links.; acceptance: Первый report содержит только attempt 1, второй только attempt 2.; Run/task producer navigation остаётся корректной; суммы 8/12/20 и API не меняются.; implemented: False; acceptanceExecuted: False

**Границы:** Минимальный offline DOM, не ручная проверка Chrome.; Не воспроизводился новый live retry; две записи попыток созданы только в собственной SQLite fixture.

### R13-B01 — Bedrock transport сохраняет скрытые HTTP-повторы при maxRetries:0
Источник: `research/2026-09-20-astra-max/r13-security-provider-cancel.json`; critic `c07`: **отсутствует; только producer evidence**.

**Код/evidence:** src/pi-worker.ts:164; src/pi-worker.ts:223-236; src/model-runtime.ts:34-38; package-lock.json:104-106,983-993; node_modules/@earendil-works/pi-ai/dist/api/bedrock-converse-stream.js:47-120,126,155-156; node_modules/@earendil-works/pi-ai/dist/api/simple-options.js:30; node_modules/@aws-sdk/client-bedrock-runtime/dist-cjs/runtimeConfig.js:60

**Триггер:** Один executePiWorker, bedrock-converse-stream, без graph retryPolicy; dummy endpoint возвращает 503, AWS_MAX_ATTEMPTS отсутствует

**Ожидается:** Один HTTP-запрос и provider failure; новая попытка только по явной политике графа

**Наблюдалось:** 3 HTTP-запроса при одном assistant turn. Контроли 400, AWS_MAX_ATTEMPTS=1 и cancel-after-first дали по одному запросу. Два успешных воспроизведения

**Причина:** Dynamicwf передаёт maxRetries:0, но закреплённый Bedrock adapter не переводит его в AWS maxAttempts. BedrockRuntimeClient получает собственные настройки повторов из SDK/среды. Это не повтор session.prompt, не output repair и не повтор локального инструмента

**Воспроизведение:** fixture: bedrock-retry.mjs; embeddedIn: r13-security-provider-cancel.md, приложение A; sha256: 2c218f89d5accbae7fa562cd570b3b7c78ee64e5918da8a4a9dddb05d6f1c213; command: cd "$DWF_DEV" && env -i PATH="$PATH" HOME="$P/home" TMPDIR="$P/tmp" node --import tsx "$P/bedrock-retry.mjs"; fixtureBoundary: InMemory credential/model stores, modelsPath:null, allowModelNetwork:false; AWS dummy auth, HTTP1; сервер только 127.0.0.1. Настоящие worker/session/Bedrock SDK, без внешнего провайдера

**Контрдоказательства:** E01/E04: Codex/OpenAI/xAI отправляют по одному HTTP-запросу на проверенных ошибках; старые исправления не переоткрываются; E02: explicit graph retry работает отдельно; write перед invalid output не повторяется; E05: cancel после первого запроса останавливает SDK retry; 400 не повторяется; Локальный alias provider использует настоящий bedrock-converse-stream, но не проверяет auth/account live amazon-bedrock

**Минимальная правка, риск, тест:** minimalChange: На закреплённой Bedrock-границе преобразовать явный maxRetries:0 в AWS maxAttempts:1; в общем случае attempts=retries+1. Проверяемый точечный SDK patch или поддержанный upstream fix; добавить offline route regression и до исправления сузить документационное обещание; risk: Изменение SDK требует проверки версии/байтов и сохранения прочих маршрутов. Не менять пользовательский AWS_MAX_ATTEMPTS глобально и не добавлять скрытые лимиты графа; acceptance: 503/429/transport failure: одна отправка на worker turn без graph policy; Явный retry графа создаёт отдельные учтённые попытки; Cancel прекращает последующие отправки; Codex SSE и native xAI single-request проверки сохраняются; implemented: False

### R15-001 — Assertions stdout/stderr по exit до drain создают ложный fail и ложный pass
Источник: `research/2026-09-20-astra-max/r15-testing-fault-injection.json`; critic `c08`: complete.

**Код/evidence:** path: tests/pi-worker.test.ts; startLine: 362; endLine: 370; path: tests/pi-worker.test.ts; startLine: 373; endLine: 382; path: src/process-client.ts; startLine: 54; endLine: 65; path: src/pi-worker-process.ts; startLine: 9; endLine: 19; path: src/pi-worker-process.ts; startLine: 32; endLine: 42; Incomplete-stdin test ждёт child.exit и сразу требует ready/error из накопленного stdout.; Closed-output-pipe test ждёт child.exit и сразу проверяет отсутствие forbidden diagnostic в stderr.; Production settled уже ждёт exit и оба drained pipe; child.close отдельно недостаточен.; Финальные временные fixtures воспроизвели failure на строке 369 и скрытие diagnostic на строке 382.

**Триггер:** Reader fixture удерживает stdout после ready либо stderr до 50 мс после exit. В stderr-вариантах child fixture дополнительно пишет синтетический forbidden marker перед выходом.

**Ожидается:** Корректная отмена с code 130 и двумя NDJSON кадрами проходит; запрещённая строка stderr проваливает oracle при любом порядке чтения.

**Наблюдалось:** mode: stdout-late; testExit: 1; testPass: 0; testFail: 1; detail: На exit виден только ready; после drain контроль видит ready,error и code 130.; mode: stderr-immediate; testExit: 1; testPass: 0; testFail: 1; detail: Forbidden synthetic marker корректно обнаружен.; mode: stderr-late; testExit: 0; testPass: 1; testFail: 0; detail: Та же запрещённая строка пропущена. Контроль markerAtExit=false, markerAfterDrain=true, code 130.

**Причина:** Тест смешивает барьер смерти процесса и барьер полноты наблюдения pipes. Внесённая перестановка выявляет ошибку оракула без изменения исходников.

**Воспроизведение:** experimentIds: E07; E08; E09; fixtureNames: r15-pipe-order.cjs; r15-pipe-control.mjs; commandsLocation: experiments E08/E09; точный код — reproductionFixtures; shell extraction — приложение Markdown; safety: Новый offline child без request в stdin; модель не допускается; NODE_OPTIONS задаётся только в командах fixture.

**Контрдоказательства:** Baseline disconnect прошёл 1/1.; Штатные IPC/process-client tests E02 прошли.; Drain-aware контроль получает полный terminal error; новый продуктовый дефект отмены/потери вывода не доказан.; Forbidden stderr — намеренно синтетическая строка, не наблюдённый реальный uncaught EPIPE.; Исторический 10-секундный timeout не воспроизведён: эта инъекция даёт assertion failure, другой симптом.; Первичный pause-only probe прошёл: без удержания resume он не обеспечивал требуемое окно.

**Минимальная правка, риск, тест:** minimumChange: Небольшой test-only settlement helper: exit/error плюс end/close каждого наблюдаемого pipe, listeners до действия, assertions после drain. Cleanup/reap только собственного child. Не ждать только child.close.; risks: Ожидание только end зависает на destroy; Ожидание только child.close возвращает документированную IPC-границу; Нельзя потерять spawn error или последний chunk; acceptance: stdout-late проходит с code 130 и ready,error; stderr-immediate и stderr-late с marker проваливаются; Без marker EPIPE regression проходит; Exit без child.close не зависает; Нет оставшихся fixture children; implemented: False

### R16-B01 — Hardlink в выходном каталоге instantiate.mjs изменяет исходный рецепт
Источник: `research/2026-09-20-astra-max/r16-packaging-onboarding.json`; critic `c08`: complete.

**Код/evidence:** skills/dynamic-workflows/recipes/implementation-review/instantiate.mjs:24-27; skills/dynamic-workflows/recipes/implementation-review/instantiate.mjs:50-57; skills/dynamic-workflows/recipes/implementation-review/README.md:37-48

**Триггер:** Source и output — разные реальные каталоги на одной файловой системе. Существующий create/patch/input/validate.json в output является hardlink на соответствующий файл source; файлы доступны на запись.

**Ожидается:** До записи отвергнуть alias либо создать независимые выходные файлы; source recipe должен остаться побайтно неизменным.

**Наблюдалось:** Helper завершился с exit 0; source/patch.json изменил SHA256 и ID стал r16_changed. Hardlinked JSON перезаписываются через тот же inode. В comparative fixture nlink=2.

**Причина:** realpath проверяет имена каталогов, а lstat preflight отвергает только isSymbolicLink. writeFileSync на существующем файле сохраняет inode и изменяет все его hardlinks. Это противоречит собственной цели guard в комментарии строки 50.

**Воспроизведение:** experimentIds: E05; E06; shellSetup: RECIPE="$PWD/skills/dynamic-workflows/recipes/implementation-review"; T=$(mktemp -d /tmp/r16-repro.XXXXXX); command: node --input-type=module - "$RECIPE" "$T" <<'JS'
<содержимое script ниже>
JS
rm -rf "$T"; script: import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const [recipe, tmp] = process.argv.slice(2);
const source = path.join(tmp, 'source'), out = path.join(tmp, 'output');
fs.cpSync(path.join(recipe, 'S'), source, { recursive: true });
fs.mkdirSync(out);
for (const name of ['create', 'patch', 'input', 'validate'])
  fs.linkSync(path.join(source, name + '.json'), path.join(out, name + '.json'));
const parameters = JSON.parse(fs.readFileSync(path.join(recipe, 'parameters.example.json')));
parameters.id = 'r16_changed';
const params = path.join(tmp, 'parameters.json');
fs.writeFileSync(params, JSON.stringify(parameters));
const hash = () => createHash('sha256').update(fs.readFileSync(path.join(source, 'patch.json'))).digest('hex');
const before = hash();
const child = spawnSync(process.execPath, [path.join(recipe, 'instantiate.mjs'), '--recipe', source, '--parameters', params, '--out', out], { encoding: 'utf8' });
const observed = { exit: child.status, sourceChanged: hash() !== before, sourceId: JSON.parse(fs.readFileSync(path.join(source, 'patch.json'))).id };
console.log(JSON.stringify(observed));
assert.deepEqual(observed, { exit: 0, sourceChanged: true, sourceId: 'r16_changed' });; requires: Node; hardlinks на одной файловой системе; checkout sourceRevision; writes: Только копия рецепта в новом /tmp/r16-repro.*; не установленный skill и не исходники checkout.

**Контрдоказательства:** Новый output: exit 0, source не изменён.; Output JSON как symlinks: exit 1, source не изменён.; tests/implementation-recipes.test.ts:164-187 уже защищает canonical directory aliases и нормальную отдельную привязку.; Не установлено повреждение при обычном cp, новом output или reflink с отдельными inode. Конкурентная подмена не нужна для воспроизведения и не исследовалась.

**Минимальная правка, риск, тест:** implemented: False; minimalChange: В существующем preflight всех пяти имён отклонять обычные output-файлы с nlink > 1 до любой записи. Поддержку hardlinked output через temp+rename рассматривать отдельно как более широкое изменение.; risk: Отказ существующим hardlinked output, даже если второй link находится не в source.; acceptance: Hardlink fixture получает явную ошибку до записи любого output; все source JSON побайтно сохранены.; Новый и обычный output продолжают работать; symlink отказы и существующие S/P/C tests проходят.

## Что требуется для завершения

Внешнему управляющему: сохранить существующие effects, разрешить clean-workspace предпосылку без утраты primary reports, получить новые успешные r14 и c02/c07 с точными bindings. Затем повторить integrity gate всех 24 пар и агрегацию; не переносить approve на изменённую пару. Агрегатор не коммитил, не чистил дерево и не запускал новые операции.

Источники: AGENTS, PROJECT_INFO architecture/development/known-issues, профильные primary источники, git log/diff и 21 проверенная пара; команды и границы новых проверок — summary JSON experiments A01/A02.
