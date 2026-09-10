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
| Восстановление | Типы ошибок, безопасные policies retry/collect, исправление формата, reconciliation | История attempts, typed failures, output repair, collect, safe retry и HTTP observations реализованы; фильтр HTTP-статусов/применение Retry-After в политике и reconciliation остаются, см. attempt-history.md, execution-failures.md, output-repair.md, collection-policy.md, retry-policy.md и provider-responses.md |
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

Следующие части восстановления: HTTP-фильтры/Retry-After в retry policy и reconciliation. Остальные строки
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
