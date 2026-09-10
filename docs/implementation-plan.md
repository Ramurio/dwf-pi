# Реализация рекомендаций аудита

Начата 2026-09-10 по поручению «выполняй все это». Полный объём определяется
[аудитом](project-review-2026-09-10.md); эта таблица отслеживает выполнение, а не
заменяет его сокращённым MVP. Статус «готово» требует кода и соответствующей проверки.
Дополнен поручением «работай над этим и тем что мы определили прошлым goal»:
[применимые идеи diagram-design](diagram-design-review.md) входят в общий объём.

| Направление | Требуемый результат | Состояние / доказательство |
| --- | --- | --- |
| Результаты | Явные outcome, причина, доказательства; rejected не становится tested preset | Реализовано и проверено: root finish, отдельный outcome, legacy unclassified, запрет непринятых presets; evidence пока объявленные данные, их привязка к artifacts — отдельная строка |
| Ожидания | Узел ожидания, сохраняемая причина/схема ответа, разрешение через service/UI, recovery | Реализовано и проверено: await, run.waits/resolve, JSON-форма, idempotency, pause/resume, SIGKILL и worktree reattach; см. outcomes-and-waits.md |
| Наблюдение | Одна проекция outcome/liveness для CLI/MCP/watch/browser | Реализовано: controller.snapshot + projectRun, включая browser list и watch; проверка процессов отдельно от heartbeat, см. observation.md |
| Usage | Учёт каждого ответа, cache/reasoning, попытки, dedup, отмена/ошибки, раскрытие сумм | Backend/API/UI реализованы; 65 targeted tests и браузерный fixture, см. usage.md. Общая приёмка с будущим recovery остаётся обязательной |
| Восстановление | Типы ошибок, безопасные policies retry/collect, исправление формата, reconciliation | История attempts, typed failures, output repair, collect, safe retry, HTTP observations и provider retry policy реализованы; для reconciliation добавлены запись операций, workers/groups и публичная инспекция checkpoint/файлов. Добавлены immutable accept/retry, одноразовый допуск, Git-проверки и browser receipts; Начальные allocation gaps и browser форма решений реализованы; полная crash-матрица Git и malformed registrations остаются. См. attempt-history.md, execution-failures.md, output-repair.md, collection-policy.md, retry-policy.md, provider-responses.md и reconciliation.md |
| Артефакты | Snapshot/digest, версии критериев, применимость checks/reviews, diff | Не начато |
| Интеграция | Отдельный integration workspace, проверки объединения, контроль target head | Не начато |
| Authoring | Рецепты в обычный граф, агрегация коллекций, schemas и dataflow diagnostics | Не начато |
| Симуляция | Публичный запуск сценариев с заданными outputs, отрицательные пути до inference | Не начато |
| Старт | Адресуемый prepared plan, запуск именно его, idempotency повторной доставки | Реализовано: preparedId привязан к plan/cwd, keyed start атомарен, retry не снимает pause/terminal; 254/254 полного параллельного набора и native UI, см. prepared-start.md |
| Browser | Обзор результата, трасса/причины, timeline/checkpoint, council, artifacts/diff, usage | Outcome/await/usage и durable routing trace реализованы; timeline, council, artifacts/diff и общий обзор остаются |
| Presets | Формы запуска, явное сохранение, версии/diff, копирование в draft | Не начато |
| Browser navigation | Deep links, reload state, terminal handoff, project search, opt-in notifications | Не начато |
| Graph readability | Раздельные порты/рёбра, обход узлов, подписи, стабильный обзор с раскрытием scopes | Маршруты/порты/подписи реализованы, 10 browser API/layout tests и in-app QA; обзор с раскрытием групп ещё не начат |
| Run comparison | Согласованные trace/timeline, сравнение проходов и первое расхождение с версией критериев | Не начато |
| Journal | Компактные reads, content-addressed plans/resources, paging/events, streaming logs | Prepared snapshots адресуются по hash и разделяются между handles; run plans ещё inline, остальные пункты не начаты |
| Retention | Размеры и явная проверяемая очистка принадлежащих run данных | Не начато |
| Worker capabilities | Явные web/MCP tools, схемы/права/версии, фактический каталог | Не начато |
| Context | Frozen project instructions, project/global roles/prompts, политика длинных сессий | Не начато |
| Installation | Собранный versioned runtime, compatibility/migrations, doctor/upgrade/rollback | Не начато |
| Provider integration | Проверяемый Grok adapter fingerprint/compatibility без выдуманных model IDs | HTTP facts и отключение скрытых transport retries проверены на pinned Codex/OpenAI SDK и установленном Grok bridge; fingerprint и расширенная compatibility-проверка остаются |
| Maintainability | Общие типизированные contracts/projections, browser typecheck, meaningful CI | Не начато |
| Acceptance | Негативные сценарии, свежий skill forward test, проверка качества council на известных дефектах | Не начато |

Сохраняются: local first, pi backend, машинная генерация TS + Effect, самостоятельный
supervisor, неизменная активная топология, отсутствие произвольных лимитов и
обязательных согласований по умолчанию. Удалённая платформа, marketplace и изменение
активной топологии отложены в самом аудите и в этот объём не входят.

## Проверки, обязательные перед завершением всей работы

Approve; request_changes→repair; inconclusive→ожидание; failed tests; изменение
артефакта после review; ошибка одной ветки council; отмена после расхода; смерть
supervisor в worktree; повтор start; patch после prepare; конфликт и failed tests
при интеграции. Для каждого проверяются runtime, API, сохранённые данные и UI.

Наблюдавшиеся ранее два таймаута полного параллельного тестового набора также
требуют локализации. Последовательные 206/206 на исходном дереве не доказывают,
что причина исправлена.

## Завершённые изменения и текущая проверка

- `225b29e` — durable поответный usage, API/MCP, независимая полнота breakdown,
  сохранение страниц браузера при обновлении и смене вкладки/run.
- `0ed38c3` — отдельные порты и маршруты рёбер, корректное ранжирование при shortcuts
  и loops, маски подписей, геометрические проверки и in-app browser QA.
- После обоих изменений: typecheck и **218/218** полного последовательного набора
  за 95,7 секунды; `/tmp/dynamicwf-usage-routes-full-20260910.log`.
  Нестабильность обычного параллельного прогона этим не считается исправленной.

Следующая часть восстановления: reconciliation. Остальные строки
сохраняют полный обязательный объём; завершённые изменения не означают завершение
общего goal.

### Outcomes / await

Технический успех отделён от приёмки, root finish сохраняет решение/причину/evidence,
непринятый результат нельзя сохранить tested preset. Await содержит durable request,
строгую схему и ответ; CLI/MCP/UI используют один resolver. Восстановление после
SIGKILL сохраняет wait ID и завершённые записи, включая children-фазу worktree.
Ручная пауза и независимые ветки сохраняют свою семантику. Новые планы v2;
golden v1 fixture проверяет исходные байты/hash и запуск на новом runtime.

Полный последовательный набор после основной реализации: **228/228**, 122 секунды,
`/tmp/dynamicwf-await-full-20260910.log`; typecheck и skill validation прошли.
Затем добавлены проверки authoring новых узлов, независимой работающей ветки рядом
с await и отказа reattach при изменённых owner/path/repository/branch. Финальная
целевая проверка: **30/30**, 52,8 секунды, typecheck прошёл;
`/tmp/dynamicwf-await-final-targeted-20260910.log`.
Native browser QA: неверный тип, сохранение черновика при паузе, answer→pause→resume,
rejected с причиной и evidence; без моделей и пользовательского journal.

Certified artifact evidence, schema-driven формы вместо
JSON-поля, retry/reconciliation и нестабильность параллельного тестового запуска
не объявлены выполненными этим этапом.

### Общая проекция наблюдения

`projectRun` связывает outcome, активные/ждущие activation keys и отдельные факты
о процессах. Watch больше не оставляет устаревший running до обращения из другого
клиента. Service, browser list/snapshot и terminal используют controller.snapshot.
Clock-only polling не вызывает переотрисовку формы и новый append-only log.
Native QA подтвердил interrupted после SIGKILL, сохранение вводимого ответа и
продолжение того же run до rejected. Подробности и границы: observation.md.

Полный последовательный прогон выявил отдельную гонку инициализации SQLite:
**233/234**, `database is locked` у одного из 24 CLI, журнал
`/tmp/dynamicwf-observation-full-20260910.log`. Вынесена общая transactional schema
initialization с закрытием соединения после BUSY и ограниченным повтором только
инициализации. После исправления **17/17** store tests и **2/2** проверок реального
lock/rollback прошли. После всех изменений обычный параллельный `npm test` прошёл:
**236/236**, 57,6 секунды, без cancelled; typecheck также прошёл.
`/tmp/dynamicwf-observation-sqlite-parallel-20260910.log`.
Прежний incomplete-stdin timeout в этом прогоне не повторился; его отдельная
причина не локализована и не объявлена исправленной одним успешным прогоном.

### Трасса маршрутизации

Compiler/runtime v3 сохраняет фактически выбранное ребро, причину и результаты
проверок (`true`/`false`/not-evaluated/fallback/error) по activation/scope/visit.
Повторное восстановление использует существующее решение; gap между завершением
действия и записью перехода не повторяет действие. V1/v2 source/hash сохранены,
старые запуски явно сообщают отсутствие трассировки. CLI/MCP run.trace имеет cursor,
summary и страницы; браузер связывает запись с конкретным source/scope и ребром.

Проверены циклы, fan-out, ошибки маршрутизации, checkpoint gap, SIGKILL, dedup,
атомарность с событием, пагинация, API/графовые счётчики и v2 golden plan.
Native QA: empty trace→ответ→false/fallback→rejected, источник и условие на графе.
Полный обычный параллельный `npm test`: **243/243**, 61,7 секунды, без cancelled;
typecheck, browser JS syntax и skill validation прошли.
`/tmp/dynamicwf-trace-full-20260910.log`. Контракт: routing-trace.md.
Это основа будущих timeline/comparison, а не объявление их готовности.


### Подготовленные планы и доставка старта

`workflow.prepare` сохраняет `{preparedId,planHash,cwd,createdAt,plan}`; inspect
по `workflow.prepared` не читает изменившиеся draft/skills/catalog. Prepared start
исполняет точный snapshot в привязанном canonical cwd. Ключ start связывается с
run атомарно; четыре независимых CLI возвращают один ID и выполняют одну запись.
Повтор после потери ответа сохраняет результат даже без исходного workspace,
конфликты не создают runs. Create/reserve gaps, pause, interruption, failed/cancelled
и реальный SIGKILL не превращают доставку команды в повтор неопределённых действий.
Старый старт по draft ID остаётся явным неидемпотентным режимом.

Native UI: один run, snapshot ревизии 2 после изменения draft до 3, принятый прежний
результат, сохранённое раскрытие «План запуска», hash/preparedId и отсутствие ошибок
консоли. Fixtures очищены; пользовательский demo/journal не менялся, inference не было.
После реализации обычный параллельный `npm test`: **254/254**, 59,9 секунды, без
cancelled; typecheck, browser JS syntax и skill validation прошли.
`/tmp/dynamicwf-prepared-full-20260910.log`. Контракт: prepared-start.md.
Prepared snapshots не являются tested presets; retention, preset delivery, общая
нормализация run journal и восстановление эффектов не объявлены готовыми этим этапом.


### История попыток

Замена текущего checkpoint теперь атомарно архивирует прежнюю попытку с исходными
ошибкой, временем и metadata. `run.attempts` / `run_attempts` и browser inspector
показывают архив отдельно от текущего состояния; pagination не превращает текущую
попытку в неизменную старую строку. Usage выводится по точному run/key/attempt, без
повторного суммирования cumulative metadata. Старые пропуски явно отмечены.

Проверены rollback archive+replacement+event, cursor/current, identity scopes/visits,
раздельный usage 8+12=20, redaction, read-only API/browser, client refresh и настоящий
SIGKILL с сохранением await и без повторения завершённой записи. Native UI показал
попытку 1 interrupted с прежней ошибкой и попытку 2 succeeded с ответом; повтор
загрузки без дублей, консоль без ошибок. Временный run/server очищены.

После изменения обычный параллельный `npm test`: **259/259**, 59,1 секунды, без
cancelled; typecheck, browser syntax, строгий checkJs paging module и skill validation
прошли. `/tmp/dynamicwf-attempts-full-20260910.log`. Контракт: attempt-history.md.
Это завершает сохранение и просмотр attempts, но не typed failures, policies,
output repair и reconciliation. Общий goal остаётся в полном объёме.


### Структурированные причины сбоев

`ExecutionFailure` переносит code/phase/effects/message через pi/check IPC, Effect,
journal, CLI/MCP, browser и terminal monitor. Состояние task effects отделено от
причины ошибки; общий run и структурные родители не наследуют read-only гарантию
одного ребёнка. Ошибка output у писавшего worker остаётся с неизвестным исходом
действий. Nonzero check exit и reviewer verdict сохраняют семантику данных графа.
Убрана передача произвольного SDK текста по совпадению префикса; decoder проверяет
закрытые поля и не выводит сырой повреждённый stdout. Известные локальные ошибки
настройки Grok остаются диагностируемыми. SDK provider error без структурированного
статуса не превращается в выдуманную temporary/auth классификацию.

Проверены настоящий SDK write→invalid output, сохранение отчётов обоих ответов,
ошибка до и после admission, malformed stdout, prefix spoofing, atomic failure/event,
archive/current clearing, сохранение причины runtime→API→UI, терминальный краткий
вывод и отсутствие дублей log. Native UI показывает причину остановки отдельно
от not-started факта конкретной проверки; консоль без ошибок, fixtures очищены.

Финальный обычный параллельный `npm test`: **269/269**, 59,3 секунды, без cancelled;
typecheck, browser syntax, strict checkJs paging module и skill validation прошли.
`/tmp/dynamicwf-failures-monitor-final-20260910.log`. Контракт: execution-failures.md.
Не завершены: точные provider statuses, явные policies retry/collect, output repair
с закрытыми write tools и reconciliation. Никаких автоматических повторов этот
этап не вводит; общий goal сохраняет полный обязательный объём.

### Исправление формата в той же сессии

`agent.config.outputRepair` явно включает дополнительные submit-only раунды после
settlement исходной задачи. Все семь рабочих инструментов закрыты на уровне SDK
registry; даже явный повторный вызов write/bash/edit в ответе не выполняется.
Прежняя работа и transcript сохраняются. Схема не меняется, provider/setup ошибки
и semantic revision mismatch не превращаются в форматирование. Каждый раунд — один
assistant turn; maxRounds только явно заданный, без скрытого лимита по умолчанию.
Pause дренирует уже работающего worker; cancel прерывает и завершает очистку.

Прогресс с границами report IDs сохраняется вместе с metadata event и номером
попытки. История попыток архивирует прогресс; новые attempts его не наследуют.
Все known SDK reports учитываются один раз, включая отменённый раунд. В browser
node/attempt inspector и terminal виден номер раунда. Потерянный progress settlement
не выдаётся за активную работу или отсутствие уже сохранённых токенов.

Новые frozen plans v4 содержат явную политику, default disabled. Golden v3 agent
plan создан до смены compiler: исходные байты/hash проверены, программа исполняется
через текущий runtime contract. Старые v1–v3 не включают repair задним числом.

Обычный параллельный `npm test`: **282/282**, 68,0 секунды,
`/tmp/dynamicwf-output-repair-full-20260910.log`. После уточнения проверки null policy
и подписи незавершённого расхода: **68/68** targeted, 4,4 секунды,
`/tmp/dynamicwf-output-repair-final-targeted.log`. Typecheck, browser syntax,
skill validation и diff check прошли. Offline real SDK tests проверяют закрытие
всех tools, действительный файл до ошибки, повторные malformed rounds, заданный
предел, cancellation, provider failures, continuation и точные usage IDs.

Native browser QA: успешный второй раунд в единственной попытке; прерванный первый
раунд с неподтверждённым завершением; 150+30 сохранённых токенов в исходных отчётах.
Сумма сохраняется при отсутствии последнего progress event; консоль без ошибок.
Проверка использовала отдельный временный journal, без inference и без demo run.
Подробный контракт и границы: output-repair.md. Retry/collect, provider status и
reconciliation остаются обязательными; общий goal не завершён этим этапом.

### Durable collect для fan-out

`failurePolicy: "collect"` на map/parallel собирает независимые child results вместе
с типизированными ошибками. Default fail-fast сохранён. Обычный reviewer verdict
или check exit code остаётся успешным execution value; техническая ошибка не
превращается в vote. Map сохраняет порядок входа; вложенные envelopes не flatten.

Отдельные child checkpoints фиксируются вместе с summary и event. После смерти
supervisor сохранённый failed writer не исполняется заново; ожидающие ветки могут
продолжить тот же parent visit. Отсутствующий checkpoint после неопределённого
side effect по-прежнему блокирует повтор. Cancellation, defects, cleanup failure и
составные причины с interrupt/uncertain-effect не попадают в успешную коллекцию.
Ошибка сохранения collection checkpoint также не превращается в branch result.

API/CLI/MCP run.collections и browser paging показывают результаты и ошибки по
item ID, parent activation и исходной попытке. Parent inspector обновляет summary;
terminal history/log не скрывает ошибки из-за succeeded статуса контейнера.
Новые планы v5; golden v4 map+parallel с output repair произведён компилятором из
f933bd9, сохраняет точные source/hash и прежние unwrapped outputs.

Обычный полный параллельный набор: **289/289**, 66,1 секунды,
`/tmp/dynamicwf-collect-full-20260910.log`. После усиления обработки составных причин
и расширения golden fixture: **24/24** collection/monitor/MCP/paging, 10,6 секунды,
`/tmp/dynamicwf-collect-final-targeted.log`. Typecheck, strict browser paging checkJs,
browser syntax и skill validator прошли. Новый table/result/summary/event rollback,
stale ownership, duplicate/conflicting delivery и read-only paging проверены.

Native UI запускал настоящий detached runtime с failed/returned/awaiting ветками,
без inference: 2 результата до ответа, 3 после, раздельный request_changes и error,
итог inconclusive, сохранение страниц, консоль без ошибок. Временный стенд очищен.
Контракт: collection-policy.md. Retry policy, provider status, reconciliation и
остальные строки исходного плана остаются обязательными; общий goal не завершён.

Дополнительно проверен именно сгенерированный TS для вложенных collect map/parallel:
**7/7** compiler tests, 3,6 секунды; TypeScript diagnostics пусты и исполнение
возвращает ожидаемые вложенные envelopes. `/tmp/dynamicwf-collect-compiler-final.log`.

### Явная политика безопасного повтора

Node-level retryPolicy на agent/check выбирает коды ошибок, задержку и необязательное
общее число попыток. По умолчанию повтор выключен; отсутствие maxAttempts означает
неограниченные попытки. Все причины должны соответствовать выбранной политике и
подтверждённым not-started/read-only эффектам. Unknown writes, interrupt, cancellation,
cleanup и defects не повторяются. Форматный ремонт остаётся внутри отдельной попытки.

Решение сохраняется атомарно с ошибкой, допускает одну следующую попытку и не может
повторно примениться после её прерывания. Пауза блокирует допуск; смерть supervisor
во время задержки сохраняет исходный срок. Terminal outcome помечает ожидающие
повторы abandoned. Collect получает только окончательный результат после повторов,
соседний await сохраняет независимость. Известный расход не теряется между попытками.

CLI/MCP/browser run.retries отдаёт неизменяемые решения отдельно от live progress;
Now, graph, inspector и watch показывают запланированный повтор без ложного счётчика
активных workers. Watch сохраняет его видимость при подключении к длинной истории
и не дублирует сообщения при clock-only polling. Технический стек убран из краткой
строки задачи при наличии структурированной причины.

Новые планы v6; golden v5 с collect, произведённый на 6dcafc3, проверяет точные
source/hash и реальное detached исполнение на новом runtime. Полный параллельный
набор: **301/301**, 68,8 секунды, `/tmp/dynamicwf-retry-full-20260910.log`.
После расширения golden и MCP assertions: **28/28**, 16,3 секунды,
`/tmp/dynamicwf-retry-final-targeted.log`. Typecheck, strict paging checkJs, browser
syntax и skill validator прошли. Отдельно проверены rollback, stale ownership,
SIGKILL, pause/cancel, огромная задержка без overflow, составные причины и SDK usage
шести реальных offline invocations; worker с состоявшейся записью не повторён.

Native browser QA: настоящий paused run после ENOENT, история решения, resume,
успешная попытка 2 и архив ошибки попытки 1; marker записан ровно один раз.
Повторная проверка свежего сервера подтвердила краткую причину без стека; консоль
без ошибок. Оба стенда и вкладки очищены. Контракт: retry-policy.md.
Точные provider statuses, reconciliation и остальные строки остаются обязательными;
этот этап не завершает общий goal.

Финальная проверка общей проекции и browser API/layout: **14/14**, 1,9 секунды,
`/tmp/dynamicwf-retry-projection-final.log`; typecheck прошёл. Ожидающий повтор
одного экземпляра узла остаётся видимым, даже если другой экземпляр завершился позже.

### Наблюдаемые HTTP-ответы провайдера

Provider failure сохраняет доступные providerResponse.status и retryAfterMs,
полученные на границе запроса, без разбора текста ошибок. У каждого assistant
request отдельное наблюдение; предыдущий HTTP-ответ не переносится на последующую
сетевую ошибку. Headers/body/URL/auth в публичный record не копируются. IPC parser
проверяет закрытые числовые поля, старые записи без них сохраняют совместимость.

Обнаружен и исправлен пробел: session retry=false не отключал default HTTP retries
SDK. Теперь maxRetries=0 передаётся для каждого запроса; Codex использует SSE,
поскольку WebSocket continuation/fallback в pinned SDK повторяет запрос независимо
от этого параметра. В reviewed OpenAI/Codex/Grok API HTTP наблюдается также до SDK
callback, который в некоторых клиентах вызывается только после успеха. Остальные
API сохраняют только реально доступные callback facts. Глобальный fetch observer
не подменяет; существующая сериализация legacy Grok guard сохранена.

Native Codex/OpenAI transports проверены с 200/401/403/429/503 и одной HTTP-попыткой;
реальный установленный Grok 1.5.2 bridge сохраняет 429/Retry-After до sanitization.
Есть проверки HTTP-date/секунд, malformed headers, request-local scope,
runtime→checkpoint→service→browser/terminal и отдельного worker IPC процесса.
Browser показывает статус и задержку в run/node/attempt, с частичным usage;
native QA и консоль прошли, временный стенд и вкладка очищены.

Полный параллельный набор: **307/307**, 69,4 секунды,
`/tmp/dynamicwf-provider-full-20260910.log`. После добавления случая HTTP 200 и
усиления IPC проверки: **12/12**, 4,0 секунды,
`/tmp/dynamicwf-provider-protocol-final.log`. Typecheck, browser syntax и skill
validator прошли. Контракт и точные границы: provider-responses.md.

Текущая policy ещё выбирает семейство provider целиком: новый HTTP record сам
не разрешает повтор и не меняет frozen delay. Настраиваемый HTTP-фильтр, применение
Retry-After, reconciliation и остальные строки общего плана остаются обязательными.

### Provider retry policy и все причины отказа

Новые планы v7 поддерживают retryPolicy.provider.statuses и retryAfter honor/ignore.
HTTP-фильтр применяется только к выбранному provider code, требует наблюдаемый
статус и проверяет каждую причину; другие выбранные коды сохраняют свою семантику.
Honor сохраняет максимум configured delay и всех валидных серверных задержек,
без дополнительного лимита. Missing/invalid header оставляет configured delay.
Отсутствующие provider options сохраняют прежние правила. Старые компиляторы
явно отклоняют новый authoring, golden v6 из 61fdb9a сохраняет точные source/hash
и выполняет реальный detached retry с прежней задержкой.

Составные причины сохраняются атомарно вместе с retry decision в отдельной таблице;
допуск после открытия журнала повторно проверяет весь список и назначенную задержку.
Смерть/смена owner не назначает новый срок. Даже при отказе от повтора agent/check
checkpoint сохраняет failureCauses: исключённый второй статус виден за первым,
внешне подходящим под policy. История сохраняет список, новая попытка очищает его.
Browser policy/decision/attempt и terminal history показывают соответствующие факты.

Настоящий native SDK проверяет 429→503→401: две запланированные попытки, уважение
серверного минимума, остановка на 401, сохранённые ответы/usage и архивы ошибок.
Дополнительно проверены отсутствие HTTP-статуса, неизвестные effects, schema,
составные причины/максимум задержек, rollback записи причин, stale ownership,
повторное открытие store и cancel. Полный параллельный набор после всех изменений:
**314/314**, 70,8 секунды, `/tmp/dynamicwf-provider-policy-full-final-20260910.log`.
Typecheck, browser syntax, strict paging checkJs и skill validator прошли.

Native UI QA использует настоящий detached supervisor со scripted worker IPC faults:
429 назначает 5 секунд вместо базовых 100 мс, pause удерживает допуск, resume→401
останавливает дальнейшие повторы. Во втором записанном fixture показаны обе причины
отказа (429 и 401) в node/attempt; это проверка UI, реальные составные Effect causes
проверяются отдельно в тестах. Консоль без ошибок, оба стенда и вкладки очищены.
Контракт: retry-policy.md. Reconciliation и остальные строки остаются обязательными;
общий goal не завершён.

### Запись операций перед внешними действиями

Agent/check сохраняют фактический запрос до запуска worker. Worktree сохраняет
source/child scope и результат детей до допуска commit. Integrate записывает target,
sources, исходный HEAD, уже слитые source HEAD и намерение следующего merge; после
слияний — наблюдаемый итоговый HEAD. Ошибка записи намерения предотвращает следующее
внешнее действие. Промежуток между действием и его checkpoint остаётся неопределённым.

Закрытая JSON-схема проверяет вид записи относительно activation. Новая попытка
архивирует и очищает старую operation/session/worker/model provenance. Параметры
доступны через inspect/attempts и отдельное раскрытие браузера; обычный graph snapshot
не включает task/input и каталоги сессии/ресурсов. Старым запускам данные не выдумываются.

Проверены сохранение до настоящей команды/worker IPC, отказ журнала до записи файла
и merge, порядок нескольких слияний, частичный merge при конфликте, архивирование и
публичная проекция. Полный параллельный набор: **319/319**, 73,0 секунды,
`/tmp/dynamicwf-operation-full-20260910.log`. Typecheck и browser syntax прошли.
Native browser QA: реальный detached supervisor, scripted IPC 429→pause→401;
обе попытки показывают свои каталоги ресурсов, task/input раскрываются отдельно,
консоль без ошибок. Модели не вызывались, стенд и вкладка очищены.

Контракт и полный список оставшихся сценариев: reconciliation.md. Команд принятия
проверенного результата или разрешения повторной записи пока нет. Следующий этап
должен учитывать запуск процесса до записи PID, оставшиеся process groups,
проверку актуальности Git/checkpoint и неизменяемую историю решений. Этот этап
не завершает reconciliation или общий goal.

### Резервирование worker и допуск запроса после записи PID

Каждый managed worker сохраняет случайный идентификатор до spawn. Callback записи
PID должен завершиться до передачи execution request; отказ callback или отмена
не передаёт задачу. Каждый Git wrapper получает новый идентификатор. Metadata
workerLaunch различает reserved/started/settled; новая попытка архивирует и очищает
старое наблюдение. Эти этапы описывают wrapper, а не доказанное завершение всех effects.

Controller находит живые reservations без PID по script/token в списке процессов.
Они удерживают owner, блокируют повторный supervisor и доступны для явной отмены.
Один снимок списка используется для нескольких reservations в одном observe;
исторический PID чтение не выдумывает. Сопоставление token проверяет границы маркера.

Проверки используют реальные check/pi процессы без inference: блокировка родителя
в PID callback, отказ reservation/PID checkpoint, SIGKILL родителя до отправки
задания, поиск worker без PID, resume без дубликата и отмена по identity. Git
integration проверяет отдельные reservations каждой команды; attempts сохраняют
старую provenance. Оставшиеся process groups после смерти wrapper и полный протокол
accept/retry остаются обязательными, как и остальные строки общего плана.

Итоговый полный параллельный набор: **323/323**, 72,0 секунды,
`/tmp/dynamicwf-reservation-full-final-20260910.log`. Typecheck, diff check и skill
validator прошли. Отдельная проверка process admission/parent death: **12/12**,
4,9 секунды, `/tmp/dynamicwf-reservation-parent-gap.log`. Browser markup не менялся
этим этапом; общая liveness-проекция проверена на настоящих reserved workers.

### Проверка оставшихся process groups

PID checkpoint до передачи запроса сохраняет workerGroupPid/pending. Завершение
worker проверяет отсутствие активных членов группы; оставшийся процесс даёт
uncertain-effect/cleanup, не позволяя принять ответ или перезаписать группу следующей
Git-командой. Pending group также запрещает замену попытки, успешный run finish,
освобождение owner и восстановительный запуск. Новые попытки архивируют и очищают
прежнюю group provenance только после подтверждения пустой группы.

Controller после смерти wrapper показывает numeric PID/PPID/state в unresolvedGroups
с ownership=unverified. Номер группы мог быть переиспользован; кандидаты не получают
автоматический сигнал по одному этому номеру. После их исчезновения fenced update
по worker token/key/group фиксирует worker.group_empty, без повторных событий на poll.
Zombie не активен; наблюдавшийся macOS ?Es остаётся потенциально активным.
Нормально завершённые пустые группы больше не опрашиваются по старому номеру.

Одна liveness-проекция для CLI/MCP/browser показывает «Проверка процессов» и отдельно
считает кандидатов. Browser раскрывает PID и переход к задаче, сохраняет смысл
запрошенной отмены. Native QA использует настоящий detached check с оставшимся
фоновым процессом, проверяет отображение и отмену без сигнала непроверенной группе.
После явной остановки принадлежащего стенду потомка browser показал «Отменён»,
убрал список групп и подтвердил отсутствие процессов. Консоль без ошибок; оба
проверочных сервера, потомки, временные каталоги и вкладки очищены.

Проверены successful wrapper response с живым потомком, SIGKILL wrapper/supervisor,
запрет повторного owner и attempt, отказ stale observation, состояние API/browser,
отмена, освобождение после завершения, повторные polls и переиспользованный номер
группы с посторонним процессом. Итоговый полный параллельный набор: **327/327**,
75,4 секунды, `/tmp/dynamicwf-groups-full-final-20260910.log`. Typecheck, browser
syntax и skill validator прошли. Предыдущий полный набор до усиления случая reuse:
**326/326**, `/tmp/dynamicwf-groups-full-20260910.log`.

Контракт: reconciliation.md. Процессы, покинувшие группу, и неизвестная история
старых запусков не считаются автоматически проверенными. Полный протокол решений
accept/retry, включая Git/checkpoint актуальность и evidence, остаётся обязательным;
общий goal и остальные строки этого плана сохраняются.

### Публичная инспекция перед восстановлением

Добавлена run.recovery (CLI/MCP/browser). Она связывает точную попытку и frozen plan
с checkpoint всего текущего run: activations, collections и event sequence читаются
в одной транзакции. Последний event необходим, например, для ответа на await,
который не меняет activation или updatedAt запуска. Состояние проверяется повторно
после сканирования файлов; concurrent pause или другой переход инвалидирует снимок.

Инспекция объясняет live owner/workers/groups, structural/nonfailed/legacy записи,
завершённого предка и сохранённый item коллекции. При препятствиях дерево файлов
не сканируется. Неиспользованная неудачная попытка доступна для инспекции при
сохранённой операторской паузе. Контракт результата берётся из frozen agent либо
формы результата check/worktree/integrate; это ещё не проверка принятого результата.

Отдельный digest учитывает имена, байты, размеры, типы/режимы и вложенные symlinks
в названных workspace roots и Git administration/common directory. Потоковое чтение
проверяет обнаруживаемое изменение файлов; корни канонизируются, перекрытия читаются
один раз. Journal/WAL/SHM и run resources исключены, явно выбранные worktrees внутри
run directory включены. Подмена исключённого ресурса symlink не скрывает посторонние
артефакты. Broken Git pointers отвергаются; вложенные ссылки и special files не
открываются. Это content observation, не атомарный snapshot всех filesystem attributes
и не доказательство внешних effects. Точные ограничения записаны в reconciliation.md.

Browser по явной кнопке показывает blockers, roots/объём и checkpoint/контракт,
позволяет обновить снимок. Native QA: настоящий failed check без inference,
15→40 байт после изменения артефакта, новый workspace digest при прежнем checkpoint,
попытка осталась первой и запуск остался failed. Консоль без ошибок, сервер,
вкладка и временный каталог очищены. Старые snapshots в browser помечены временем;
чтение не разрешает повтор и не принимает output.

Протокол immutable accept/retry decisions, Git-specific восстановление,
проверка artifact/criteria bindings при применении и все остальные строки общего
плана остаются обязательными. Этот этап завершает инспекцию, а не reconciliation.

Итоговый полный параллельный набор после всех изменений: **335/335**, 75,2 секунды,
`/tmp/dynamicwf-recovery-inspection-complete-20260910.log`. Отдельно **21/21**
recovery/MCP/browser tests и **8/8** итоговых inspection cases, включая concurrent
pause, await event без изменения run timestamp, symlink exclusions и Git pointers.
Typecheck, browser syntax, diff check и skill validator прошли. Контракт описывает
границы content digest и необходимость повторной проверки перед будущим применением.

### Применение решений о восстановлении

Добавлены CLI/MCP `run.reconcile` и `run.reconciliations`: immutable decision с
actor/reason/evidence, точным checkpoint/attempt/workspaceDigest и отдельным фактом
применения. Повторная доставка возвращает тот же decision с актуальным receipt;
конфликт identity отвергается. Старый pending retry заменяется только явно через
supersedes; история решения не переписывается.

Accept архивирует исходную ошибку и создаёт succeeded checkpoint следующей попытки
без вызова worker и без выдуманного SDK ledger. Проверяются frozen output schema,
reviewer artifact/criteria bindings и текущие Git facts. Сохранённый расход остаётся
в исходной попытке и общей сумме. Retry потребляется атомарно с beginActivation;
runtime повторно вычисляет operation roots/Git directories и content digest перед
допуском. Изменение файлов блокирует новый вызов и оставляет решение pending.

Failed run можно подготовить к продолжению того же run; решение не запускает
supervisor и не снимает pause. Старая ошибка остаётся в events/attempt history.
Completed parent/collection и cancel сохраняют границы. Worktree acceptance сверяет
сохранённый child result и чистый owned HEAD; integration acceptance проверяет
original HEAD, ветку и ancestry каждого неизменённого owned source. Git status
использует --no-optional-locks, чтобы inspection не обновляла index.

В браузере по явному запросу доступны автор, причина, исходная/новая попытки,
supersession и evidence. Принятый checkpoint подписан отдельно от вызова модели.
Native QA: настоящий failed check и явно синтетический accepted output; показаны
обе попытки, решение и основания, затем тот же run завершён через «Продолжить»
без нового check. Browser console без ошибок. QA server, вкладка и каталог удалены.

Targeted protocol/setup/reconciliation: **16/16**, включая **7/7** сценариев
применения. Проверены сохранение токенов/паузы, повторная доставка после завершения,
output и reviewer bindings, stale workspace/checkpoint, transactional rollback,
одноразовый допуск, supersession, worktree и integration ancestry, CLI/browser reads.
Первый полный прогон выявил strictRequired в новой MCP oneOf schema; исправлено
объявлением output внутри соответствующей ветки, MCP negotiation проверен повторно.

Обязательные остатки reconciliation: восстановление missing partially allocated
worktree с сохранённой branch/registration, полная fault-injection матрица Git gaps
и browser форма применения решений. Сейчас эти missing paths/unsettled Git state
отвергаются до явного repair и новой инспекции. Полный объём остальных строк плана
сохраняется; этот этап не завершает общий goal.

Итоговый полный параллельный набор: **342/342**, 80,2 секунды,
`/tmp/dynamicwf-reconciliation-full-verified-20260910.log`. Typecheck, browser syntax,
skill validator и diff check прошли. Протокольный targeted log:
`/tmp/dynamicwf-reconciliation-protocol-20260910.log`.

### Allocation gaps и браузерное применение решений

Начальная фаза allocating восстанавливается из трёх состояний: только сохранённый
intent, оставшаяся ветка, точная регистрация отсутствующей папки. До разрешения
проверяются run/key/path/base, HEAD ветки, все регистрации этой ветки и отсутствие
дочерних activations. Moved/locked/advanced/foreign registrations отвергаются.
После допущенного child отсутствующая папка не создаётся под уже сохранёнными
child outputs: это могло бы скрыть потерю незакоммиченных результатов.

При повторе runtime заново проверяет состояние. Перед удалением единственной
missing registration копирует её admin directory, включая index, в принадлежащий
run архив, проверяет неизменность источника, выполняет sync файлов/директорий
архива и записывает путь/digest в журнал. Используется адресный `git worktree remove`
без force и добавление worktree на сохранённой ветке/base. Соседние регистрации
и существующие рабочие папки не удаляются; global prune/reset отсутствуют.
Отклонённый checkpoint до удаления предотвращает его; сбой после удаления оставляет
архив и ветку, с которыми новая инспекция/решение может продолжить восстановление.

Добавлена browser форма accept/retry после явной инспекции. Автор, причина,
основания и output проверяются тем же backend; прежнее pending решение заменяется
только отмеченным пользователем supersedes. Запрос/ID фиксируются перед отправкой,
повтор после ошибки связи использует те же данные. Новый checkpoint не подставляется
в отправленное решение автоматически. Ввод/выделение/фокус сохраняются при poll;
drafts адресуются по run/key/attempt и остаются в памяти страницы. POST требует
local origin, private URL, JSON и control header. Сохранение не снимает pause и
не запускает supervisor. Показаны сохранённое решение и отдельный шаг продолжения.

Проверки allocation **5/5**: все три начальных состояния, сохранение sibling
registration/index archive, locked/moved/advanced отказ, сбои до/после удаления,
настоящее продолжение того же run с единственным child и запрет восстановления
утраченной папки под уже checkpointed child. Browser/API + reconciliation **18/18**:
origin/header/body checks, stale workspace, duplicate/conflicting identity и прежние
сценарии принятия/повтора. Native QA: две настоящие ошибки запуска check; сохранение
текста и фокуса через poll, намеренно stale snapshot, повтор того же ID, новая
инспекция и synthetic accept без worker; затем явная замена retry и настоящий
`Real retry executed` в попытке 2. Старое решение показано как заменённое, новое
как применённое. Финальная browser console без ошибок. Оба сервера, вкладки и
временный каталог удалены; модели и пользовательский demo journal не использовались.

Первый полный прогон **345/347** завершился двумя timeout в прежних тестах запуска
harness/установленного executable. Их наборы отдельно прошли **14/14**. Полный набор
с четырьмя одновременно работающими test files прошёл **348/348**, 132,5 секунды:
`/tmp/dynamicwf-recovery-form-full-verified-20260910.log`. Эта команда теперь задаётся
`npm test`: ограничивается нагрузка тестовых процессов, все файлы/сценарии остаются,
runtime concurrency и таймауты assertions не менялись. Typecheck, browser syntax,
skill validator и diff check прошли.

Остаются обязательными полная crash-матрица allocation/commit/multi-source merge
и сохранение доказательств при malformed partial registrations. Изоляция интеграции,
versioned artifact proofs и остальные строки полного плана также остаются в работе.

Дополнительно исправлен общий HTTP JSON reader для control/await/reconcile: граница
сетевого фрагмента больше не повреждает многобайтовую букву. Лимит считается по
исходным bytes; invalid UTF-8 отвергается до записи. HTTP-тест разделяет русскую
букву между chunks, сверяет исходный текст/идемпотентную повторную доставку и
проверяет отказ malformed encoding без нового решения.

Финальный `npm test` после этого исправления: **348/348**, 136,5 секунды,
`/tmp/dynamicwf-recovery-form-final-20260910.log`. Typecheck, browser syntax и
diff check повторно прошли; skill validator прошёл для обновлённого skill.
