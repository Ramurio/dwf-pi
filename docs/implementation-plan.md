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
| Восстановление | Типы ошибок, безопасные policies retry/collect, исправление формата, reconciliation | История attempts и typed failure code/phase/effects доступны в journal/API/UI; provider status, policies, output repair и reconciliation остаются, см. attempt-history.md и execution-failures.md |
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
| Provider integration | Проверяемый Grok adapter fingerprint/compatibility без выдуманных model IDs | Не начато |
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

Следующий блок: типы ошибок и управляемое восстановление с сохранением попыток. Остальные строки
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
