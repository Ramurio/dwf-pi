# r04 — Журнал SQLite и восстановление

## Метаданные и результат

- **ID:** r04; **тема:** Журнал SQLite и восстановление.
- **Source revision:** `e15bc407da8753fd6b683c0aa4a68634e3c458a7`.
- **Дата исследования:** 2026-09-20, UTC.
- **Cwd исходного исследования (исторический):** `/Users/ramu/.dynamicwf/runs/run-babf9b25-b8f5-45ad-b79c-2b2e5d31d2f0/worktrees/2d13b5261cf4b4fedc32c057e7589adb0ff6d8ef6f52a2fb4d8c090ff85c71cc`.
- В старом и новом worktree нет `node_modules`. Исторические E01/E02 и пробы RunStore/SQLite E03–E06 выполнялись из разрешённого `integration-dev`, тогда равного sourceRevision, согласно сохранённому отчёту и командам; E07 импортировала код старого worktree, E08 читала публичные документы SQLite. При продолжении его HEAD уже `3d8ba65ee84402c0e3b0587f70095b7847824a9f`; новая E09 выполнена там с существующими зависимостями после сравнения кода. Четыре профильных модуля совпадают побайтно между этими коммитами; незакоммиченных изменений `src`, `tests`, package/lock не найдено. Оба итоговых отчёта записаны только в новый фактический cwd.
- **Среда проверок:** Darwin arm64, Node `v26.8.1`, встроенная SQLite `3.53.4`. Проверки на минимальной Node 22.19 не выполнялись.
- **Итог:** один воспроизведённый bug диагностического пути, одна idea, три already-fixed/refutation и два unknown. **47/47** профильных репозиторных тестов прошли в исходной операции, без skip; сохранённые логи прочитаны при продолжении. Исходные собственные пробы: SQLITE_FULL, два crash windows, WAL read snapshot, шесть добавочных миграций и удержание WAL читателем. При продолжении добавлена только E09: SQLITE_FULL с контрольным ABORT и повторным чтением PRAGMA; E04/E05 заново не исполнялись.

Главный дефект: после автоматического rollback SQLite `RunStore.transaction()` затирает исходный `SQLITE_FULL` вторичной ошибкой `cannot rollback - no transaction is active`. Потеря или частичная фиксация данных в этой пробе **не обнаружена**. Не подтверждены гипотезы о потерянном событии при успешно записанном checkpoint, захвате владельца по heartbeat, повторном применении recovery receipt или неполном согласованном WAL backup.

## Продолжение и происхождение доказательств

- **Новый фактический cwd:** `/Users/ramu/.dynamicwf/runs/run-9dbb044c-664f-4dd8-96c0-57192dc4ed89/worktrees/2d13b5261cf4b4fedc32c057e7589adb0ff6d8ef6f52a2fb4d8c090ff85c71cc`; HEAD подтверждён как `e15bc407da8753fd6b683c0aa4a68634e3c458a7`. Дата продолжения: **2026-09-20**.
- Источник переноса — **собственная** ветвь `run-babf9b25-b8f5-45ad-b79c-2b2e5d31d2f0`. Её операция имела статус `failed` (`provider`, `terminated`); это не успешная прежняя сдача результата и не установленная проблема журнала.
- Старый Markdown: **41419 байт**, SHA256 `b83ee138f0e39ac64a6b9939f613bc5650cc1c5348d04748f42b5e8dd2c63e5c` — пересчитан и совпал с retainedEvidence. Его исследовательский текст заполнен, но пакет был **неполным**: JSON отсутствовал; старых успешных итоговых хешей двух отчётов не было. JSON создан впервые здесь, Markdown перенесён с перечисленными уточнениями.
- `preservedActionEvidence`: `/Users/ramu/.local/state/pi-astra-research-20260920/dwf-orchestration/continuation-v1/retained/r04-actions.json`; SHA256 `e036f3f8477e220b83700c19888562a6ead8f813cbfba8ebca6ab6b1f805650f`. Он содержит **18 команд**, а не их stdout/exit codes. Сам по себе список команд не доказывает успех.
- **Перенесено:** все семь исходных ID B01/I01/A01–A03/U01–U02 и результаты E01–E08. Логи E01/E02 подтверждают 32 и 15 успешных тестов; их текущие SHA256 — `2e9948097632db4c5304f3a92659f99719a1016d63e71781ac794486d0127bb6` и `1b1d1a7a7edd4626aa7480ddf640b22fe945c8e82c25c8eb21e4046a567345d1`. Расширение `.tap` историческое: содержимое — Node spec reporter. Сырые логи в отчёты не включены.
- **Перепроверено чтением:** локальные обязательные документы, профильные исходники/вызывающие стороны и тесты по ссылкам, сохранённые собственные fixtures, ссылки на файлы/диапазоны строк, главы SQLite из сохранённых HTML. Для E04/E05/E07 отдельного stdout нет: результаты перенесены из хеш-проверенного Markdown, утверждения fixtures прочитаны, **новый запуск/новое независимое наблюдение их исхода не заявляется**.
- **Добавлено:** E09 — новая БД под `/tmp/r04-cont-journal-UKugTj`, подтверждение B01, контроль ABORT (1811), целостность после отказов, один успешный event после восстановления и конфигурация SQLite. C01 — проверка сохранённых файлов/ссылок; C02 — сравнение study/publication revisions. Полные тестовые наборы, прежние SIGKILL и внешние операции не повторялись. Старый worktree и fixtures не менялись.
- Базис отчёта остаётся **study-source e15bc407**. В **post-study** коммите `86f5e07` уже добавлена ранняя authoring parallel-isolation validation, а в `3d8ba65` — документация reviewer artifact binding. Это отдельный контекст, не новые находки r04 и не рекомендации повторно внедрить исправления. `run-store.ts`, `sqlite.ts`, `recovery-inspection.ts`, `recovery-files.ts`, релевантные тесты и callers `run-controller.ts`/`run-runtime.ts` между ревизиями не изменились. В `workspaces.ts` проверка isolation вынесена в отдельный модуль; изученная логика архивирования не менялась. B01 не исправлен этим publication delta.

Все формулировки «E01/E02 подтвердил», «E04 показал» ниже относятся к **исходной операции**; только E09/C01/C02 выполнены при продолжении. Новый веб-доступ не выполнялся: дата доступа S12/S13 относится к историческому curl, сохранённые страницы перечитаны offline. Новых модельных вызовов, управления live run и новых provider retries нет. Приоритет P2 — оценка исследователя, а не измеренная частота инцидентов.

## Coverage и метод

Покрытие исходной операции (перепроверка продолжения выделена выше): сначала прочитаны `AGENTS.md`, `PROJECT_INFO/architecture.md`, `development.md`, `known-issues.md`, затем профильные `run-journal.md`, `reconciliation.md` и история Git. Полностью исследованы `src/run-store.ts`, `sqlite.ts`, `recovery-inspection.ts`, `recovery-files.ts`; выборочно — их вызовы в `run-controller.ts`, `run-runtime.ts`, архивирование в `workspaces.ts`, `store.ts`, проверка версий плана и соответствующие тесты. История по профильным файлам включает `50a80cd` (освобождение SQLite setup locks), `067f128` (recovery inspection), `d93d95f` (one-use reconciliation), `6f67130` (allocation gaps), `37ff399` (supervisor identity между установками).

Разделены три разных гарантии:

1. **Транзакция БД:** строки состояния, архив и события либо фиксируются вместе, либо откатываются.
2. **Возобновление workflow после смерти процесса:** сохранённый успех не исполняется снова; неопределённое внешнее действие требует отдельного разрешения.
3. **Снимок/восстановление хранения:** SQLite backup включает committed WAL, но не сессии, skills, рабочие деревья и внешние эффекты.

Все БД и репозитории проверок временные. Собственные процессы получали SIGKILL только внутри fixture; реальные журналы, пользовательские процессы, SSH, credentials и провайдеры не затрагивались. Новые модельные вызовы не делались. Полный `npm test`, typecheck, live provider tests и полный `git-recovery-crash.test.ts` не запускались. Соседние исследовательские отчёты не читались. Исходники и тесты не изменялись.

## Находки

### r04-B01 — bug: вторичный ROLLBACK скрывает исходный отказ хранения

**Приоритет:** P2, диагностическая корректность; уверенность высокая.

**Локализация:** `src/run-store.ts:240-243`, особенно строка 243. Подтверждённый вызывающий путь: `completeActivation`, `src/run-store.ts:673-679`.

**Причина:** `catch (error)` безусловно исполняет `database.exec("ROLLBACK")`, а только затем должен перебросить `error`. SQLite вправе сама отменить всю транзакцию при `SQLITE_FULL`, `SQLITE_IOERR`, `SQLITE_INTERRUPT`, `SQLITE_NOMEM`. Если это произошло, второй ROLLBACK бросает исключение раньше `throw error`.

**Триггер:** увеличение записи activation за предел доступных SQLite страниц. Во временной БД предел установлен `PRAGMA max_page_count=page_count`; выход размером 256 KiB вызывает настоящий `SQLITE_FULL`, а не подставной JavaScript Error. Это исключительно инъекция отказа fixture, не предлагаемая квота продукта и не заполнение реального диска.

| Проверка | Ожидаемое | Наблюдаемое |
| --- | --- | --- |
| Прямой SQL UPDATE внутри BEGIN IMMEDIATE | Исходный отказ SQLite | `errcode=13`, `database or disk is full` |
| Тот же рост через completeActivation | Сохранить исходный отказ и его код | `errcode=1`, `cannot rollback - no transaction is active` |
| Состояние после отказа | Нет частичного успеха | Activation остаётся `running`, output отсутствует, события не изменились |
| После снятия ограничения fixture | Соединение можно использовать | Малый output сохранён; `integrity_check=ok` |

**Практический эффект:** диагностирующий код/оператор получает SQL logic error вместо причины хранения. Общий helper делает остальные транзакционные методы потенциально подверженными тому же пути; непосредственно воспроизведён именно `completeActivation`. Здесь не доказаны потеря данных, повтор внешнего действия или повреждение файла.

**Контрдоказательства и почему зелёные тесты не опровергают bug:** `tests/run-store.test.ts:380-402`, `tests/attempt-history.test.ts:24-35`, `tests/reconciliation.test.ts:76-91` используют `RAISE(ABORT, ...)`. ABORT оставляет транзакцию для явного rollback, поэтому существующий catch успешно перебрасывает исходную ошибку. Эти тесты действительно прошли. Автоматическая отмена всей транзакции — другая ветвь SQLite, подтверждённая исторической E03, новой E09 и первичным источником [S12]. В E09 обычный ABORT вернул исходные сообщение и errcode=1811; SQLITE_FULL вновь превратился из 13 в 1. Полная activation и события после обоих отказов равны исходным.

**Минимальная рекомендация, не реализация:** сохранить первичное исключение независимо от результата cleanup ROLLBACK; вторичную ошибку при необходимости присоединять отдельно, не заменяя `errcode`/причину. Не повторять запись автоматически. Не полагаться без проверки совместимости на новые свойства `DatabaseSync`, которых может не быть в минимально поддерживаемой Node.

**Риск изменения:** слишком широкое подавление rollback failure способно спрятать действительно неизвестное состояние соединения; cleanup-диагностика должна оставаться доступной. **Приёмка:** fixture ниже возвращает исходный `SQLITE_FULL` (13), строки/события неизменны, обычный ABORT по-прежнему сохраняет свою причину, после восстановления ресурса допустим следующий commit. Отдельно проверить поведение на минимальной Node; автоповтор application writes не появляется.

### r04-I01 — idea: явно зафиксировать границу совместимости схемы журнала

**Факты:** схема создаётся в одной setup-транзакции (`src/sqlite.ts:20-22`), после её commit конструктор RunStore отдельно запускает добавочные миграции (`src/run-store.ts:223-237`). Известные столбцы обнаруживаются через `table_info`; изменения сериализованы `BEGIN IMMEDIATE`. В исследованном коде нет отдельного реестра версии схемы БД или проверки совместимости с будущим писателем. Версия плана — другой контракт: `src/execution-plan.ts:89-95`, `src/compiler-versions.ts:1-38` проверяют известные compiler/runtime пары, но не SQL schema.

**Проверка E04:** удалены шесть добавочных столбцов из новой временной БД, после двух повторных открытий все восстановились, существующий input сохранился, FK/integrity checks прошли. Вспомогательные receipt/reuse таблицы в этой пробе пусты: это не тест полного исторического корпуса миграций.

**Вывод:** нынешняя добавочная миграция работоспособна; порча от обновления/понижения версии не воспроизведена. Нельзя из этой проверки вывести поддержку произвольного downgrade или неизвестного будущего формата. Конструктор не является read-only просмотрщиком, даже если вызывающий собирается только читать.

**Минимальная рекомендация:** явно описать поддержанные направления миграции и добавить заполненные legacy fixtures для существующих шести переходов. Перед первой несовместимой миграцией ввести именованную проверку версии/возможностей схемы, а не переписывать нынешние данные задним числом. Общую БД использует также DraftStore (`src/store.ts:6-16`), поэтому глобальный `user_version` нельзя менять изолированно от его контракта.

**Риск:** слишком строгая проверка отвергнет безвредные добавочные поля и старые журналы. **Приёмка:** сохранение заполненных starts/receipts/reuse/history, идемпотентное и конкурентное открытие поддержанных схем; явно неподдержанная будущая схема отвергается до изменения данных. Это предложение, а не диагноз уже случившейся несовместимости.

### r04-A01 — already-fixed / refutation: WAL и setup не требуют «исправления копированием файла»

`src/sqlite.ts:9-30` устанавливает короткий busy timeout до WAL, проверяет WAL для файловой БД, использует FULL/FK, создаёт схему в транзакции, закрывает неудавшееся соединение перед повтором только setup и после успеха задаёт 5000 ms. Автоматического повтора прикладных записей здесь нет. `:memory:` сознательно исключён из проверки WAL и не доказывает дисковую durability.

E01 подтвердил rollback неверного SQL схемы и открытие после конкурирующей exclusive-транзакции. `tests/sqlite-backup.test.ts:9-48` прошёл: при открытом writer копия одного `.sqlite` проходит integrity check, но теряет committed `post-checkpoint`; `node:sqlite.backup` через read-only source сохраняет обе строки. Прямые read-only копии отвергают запись.

В проекте уже есть корректная ручная процедура (`PROJECT_INFO/development.md:187-275`): не открывать источник через контроллер/инициализатор, не считать один integrity check проверкой полноты, не подменять live журнал backup-файлом. Это не отсутствующая функция восстановления, которую нужно срочно реализовать. Уточнение ссылки документа: сценарий **24** конкурентных CLI инициализаций расположен в `tests/store.test.ts:50-75`, а не в `sqlite.test.ts`; он прочитан, но отдельно не запускался. В E01 прошла конкурентная резервация восьмью процессами из `run-store.test.ts`.

E05 показал важную границу checkpoints: удержанный read snapshot оставляет `wal_checkpoint(PASSIVE)` с `log=24`, `checkpointed=0`, хотя `busy=0`. Читатель видит прежнюю строку; после COMMIT видит девять, TRUNCATE возвращает нулевой WAL. Это нормальная семантика SQLite, не потеря committed данных. Настроенные по умолчанию 1000 страниц autocheckpoint — порог попытки checkpoint, не верхний лимит WAL.

**Рекомендация:** новых изменений поведения не требуется; сохранить тест различия naive copy/backup и не держать read-транзакции во время долгого файлового сканирования. **Риск регрессии:** «упрощение» backup до copyFile либо добавление повтора application writes. **Приёмка:** текущие E01/E05 и проверка committed строк, не только integrity.

### r04-A02 — already-fixed / refutation: fencing и атомарные checkpoints действуют

`reserveLaunch` проверяет состояние и владельца в write transaction (`src/run-store.ts:319-331`); `owned` проверяет непустой актуальный token и активное состояние (`249-252`). `markInterrupted` очищает owner и переводит только running activations (`411-421`), сохраняя завершённые. Успех, история и событие пишутся в транзакциях (`459-500`, `673-679`, `431-458`).

E01 подтвердил одного победителя из восьми процессов, отказ десяти классов записей старого владельца, запрет неявного replay uncertain side effect, checkpoint с явным `null`, архивирование попытки и откат при отказе события. E04 добавил реальные SIGKILL двух собственных Node-писателей: смерть внутри event trigger **после UPDATE до COMMIT** оставляет activation running и старый список событий; смерть **после возврата completeActivation** сохраняет succeeded/output и ровно одно событие, в том числе после открытия БД заново.

`tests/attempt-history.test.ts:100-115` также реально убил fixture supervisor на await и восстановил его; предшествующий check оставил единственную строку `once`, попытка check осталась первой. Успешный тест не доказывает exactly-once произвольного внешнего API.

**Контракт доверия:** `markInterrupted` сам не проверяет ОС. Это явно обязанность вызывающего (`src/run-store.ts:410`, `PROJECT_INFO/run-journal.md:103-111`); контроллер проверяет процессы и группы (`src/run-controller.ts:229-263`). Подделать доказательство вызовом низкоуровневого API — не воспроизведение ошибки публичного восстановления. Историческое исправление `37ff399` уже хранит launch provenance; оно не переоткрывается как новый bug.

**Рекомендация:** сохранить нынешний fencing; добавочная regression для SQLite auto-rollback нужна по B01, а не замена модели владения. **Риск:** ошибочно трактовать heartbeat/таймаут или сам token как доказательство смерти. **Приёмка:** старые tokens не меняют журнал, успех/event/history остаются атомарны, неизвестные эффекты без разрешения не повторяются.

### r04-A03 — already-fixed / refutation: recovery связывает журнал, файлы и одноразовое решение

`recoveryState` читает run/activations/eventSeq/collections в одном `BEGIN` (`src/run-store.ts:773-779`). В E04 другая connection завершила activation между первым чтением run и чтением activations: текущий recovery snapshot сохранил старые activation **и** eventSeq, следующее чтение увидело новые. Это проверка принудительного interleaving, а не только двух последовательных чтений.

`recoveryCheckpoint` включает eventSeq (`src/recovery-inspection.ts:32-35`), поэтому ответ await меняет checkpoint даже без обновления run.updatedAt. Завершённые родители и collected items запечатывают точные дочерние scope, не соседей (`13-29`). Контроллер повторно сверяет процессное наблюдение и checkpoint после файлов (`src/run-controller.ts:282-297`); `recordReconciliation` вновь сверяет всю точку внутри write transaction (`src/run-store.ts:803-852`). Применение retry receipt, архив и новая попытка атомарны (`469-500`).

E01/E02 подтвердили stale wait/checkpoint, отказ изменившимся файлам, selected-only supersession автоматического retry, откат receipt+archive+admission, отсутствие второй попытки по использованному разрешению и точную идемпотентную доставку. Allocation-тесты сохранили архив регистрации до удаления, не затронули соседнюю регистрацию и отказали в пересоздании потерянного дерева после выполненного ребёнка (`tests/allocation-recovery.test.ts:29-120`; архивный путь `src/workspaces.ts:108-151`).

Файловый хеш включает имена, тип, mode, байты, цели ссылок; explicit roots канонизируются, вложенные symlink не разыменовываются, специальные файлы отмечаются, regular files открываются O_NOFOLLOW/O_NONBLOCK и сверяются до/после (`src/recovery-files.ts:19-60`). Исследованные тесты проверяют исключения journal/resources, включение явно выбранного дерева под исключённым run-directory, административные данные linked worktree и отказ сломанным Git pointers (`64-89`).

**Граница:** это обнаружение изменений, а не общая транзакция файлов и SQLite. Файл, уже прочитанный сканером, может измениться позже; внешние эффекты и цели вложенных symlink не входят в доказательство. Такая граница прямо описана в `PROJECT_INFO/reconciliation.md:94-164`. Допуск retry повторяет file digest (`src/run-runtime.ts:92-101`), но не блокирует произвольный редактор. Пустые blockers не являются разрешением действий.

**Рекомендация:** сохранить повторные проверки и одноразовую identity; не заменять весь checkpoint одним timestamp. **Риск:** ложная гарантия полного снимка FS или replay после просто успешной инспекции. **Приёмка:** текущие отрицательные сценарии E01/E02, неизменный архив, stale данные не допускают accept/retry.

### r04-U01 — unknown: machine/power-loss durability не измерена

Наблюдаемые настройки временной БД: WAL, synchronous=2/FULL, FK=1, busy_timeout=5000, wal_autocheckpoint=1000; на этой Darwin сборке `fullfsync=0`, `checkpoint_fullfsync=0`. Код не меняет последние два флага. SQLite документирует FULL в WAL как ACID и отдельно описывает F_FULLFSYNC на macOS [S13]. Нулевой fullfsync сам по себе **не доказывает потерю данных**; SIGKILL приложения не моделирует сбой ОС/питания/контроллера диска.

**Не установлено:** поведение конкретной файловой системы и накопителя при power loss, ENOSPC вне SQLite page limit, I/O faults во время COMMIT/backup; работа на иных SQLite/Node сборках и сетевых файловых системах.

**Рекомендация:** сначала отдельная согласованная fault-injection проверка на одноразовой среде, а не выключение пользовательской машины или бездоказательная смена PRAGMA. Минимальное документальное уточнение — явно отделять process-crash tests от power-loss доказательства. **Риск будущего изменения sync-политики:** latency и платформенная совместимость. **Приёмка исследования:** известные committed transaction IDs, образ диска до/после сбоя, integrity и полнота; лишь затем решать вопрос настройки.

### r04-U02 — unknown: имена файлов с некорректным UTF-8 на другой POSIX FS

Гипотеза из `src/recovery-files.ts:39-42`: readdir возвращает строки UTF-8, поэтому произвольные байтовые имена на FS, которая их допускает, могут потерять точную identity до join/lstat/hash. Проверка E07 пыталась создать имя `artifact-` + байт `ff` через Buffer, но текущая среда вернула **EILSEQ при writeFile**, до вызова observeRecoveryFiles. Bug текущего сканера **не воспроизведён**; никакая потеря байтов в реальном recovery не заявляется.

**Следующий проверочный шаг:** на отдельной поддерживаемой POSIX FS, принимающей такое имя, сравнить digest до/после изменения содержимого, отдельно создать два имени с одинаковым UTF-8 replacement представлением. Изменение кода пока не рекомендуется. При подтверждении минимально рассмотреть явный отказ от неотображаемых имён либо byte-safe identity; риск — совместимость отображения путей. Критерий: сканирование либо однозначно замечает изменение, либо явно отказывает, но не выдаёт прежний успешный digest.

## Выполненные эксперименты — исходная операция E01–E08

Для E01/E02 `TMPDIR` был `/tmp/r04-journal-UW87KA`; все порождённые тестовые БД/репозитории находились под ним. Локальные файлы с суффиксом `.tap` (фактически Node spec reporter) сохранены там только для анализа, не публикуются. Команды запускались последовательно, не полным npm test.

| ID | Выполненная команда / fixture | Исход | Границы |
| --- | --- | --- | --- |
| E01 | `TMPDIR=/tmp/r04-journal-UW87KA node --import tsx --test --test-concurrency=1 tests/sqlite.test.ts tests/sqlite-backup.test.ts tests/run-store.test.ts tests/recovery-inspection.test.ts tests/attempt-history.test.ts` | 32 pass, 0 fail/skip; около 18.37 s | Временные данные; включает настоящий fixture supervisor SIGKILL и локальные CLI/API; без модели |
| E02 | `TMPDIR=/tmp/r04-journal-UW87KA node --import tsx --test --test-concurrency=1 tests/reconciliation.test.ts tests/retry-reconciliation.test.ts tests/allocation-recovery.test.ts` | 15 pass, 0 fail/skip; около 52.38 s | Git/check реальные, временные; agent receipt восстановлен без модельного вызова |
| E03 | `node --import tsx --input-type=module < /tmp/r04-journal-UW87KA/sqlite-full.mjs` | Подтверждён B01; код 13 превращается в 1; rollback атомарен | Page-limit fault injection, не заполнение диска |
| E04 | `node --import tsx --input-type=module < /tmp/r04-journal-UW87KA/journal-boundaries.mjs` | Два SIGKILL окна, interleaved read snapshot и шесть миграций прошли | Только собственные Node-писатели; миграция синтетическая, не все исторические БД |
| E05 | `node --import tsx --input-type=module < /tmp/r04-journal-UW87KA/wal-reader.mjs` | Старый snapshot=1 строка, следующий=9; удержанный WAL 24/0, после release 0/0 | Контролируемый read transaction, не benchmark/нагрузочная оценка |
| E06 | `node --import tsx --input-type=module` с временной БД, `sqlite_version()` и PRAGMA journal_mode/synchronous/foreign_keys/busy_timeout/wal_autocheckpoint/fullfsync/checkpoint_fullfsync/user_version/application_id | SQLite 3.53.4; значения выше; последние version/id=0 | Конфигурация данного helper/сборки, не доказательство физической durability |
| E07 | `node /tmp/r04-journal-UW87KA/nonutf8.mjs` | Выход 1: EILSEQ на создании имени; гипотеза не проверена до конца | Ограничение данного окружения, не отказ функции восстановления |
| E08 | `curl -fsSL --max-time 25 https://www.sqlite.org/lang_transaction.html` и `https://www.sqlite.org/pragma.html` | Первичные SQLite документы прочитаны 2026-09-20 | Только публичные страницы; ограничение времени — параметр исследовательского HTTP-запроса, не runtime policy |

### Новые проверки продолжения (не прибавляются к историческим 47 тестам)

| ID | Фактически выполнено | Результат и граница |
| --- | --- | --- |
| C01 | `shasum -a 256` старого MD и preservedActionEvidence; Python SHA256/чтение девяти своих файлов; проверка существования и диапазонов 52 file:line ссылок старого MD | MD hash совпал, JSON отсутствовал; E01=32/32, E02=15/15, 0 fail/skip; ссылки в границах файлов. Fixtures E04/E05/E07 только прочитаны. |
| C02 | `git rev-parse HEAD`; `git log e15bc407..3d8ba65`; `git diff e15bc407 3d8ba65 -- <профильные src/tests>`; `git rev-parse <revision>:<file>` для четырёх основных модулей; проверка tracked diff dev | Study HEAD и publication HEAD различены; четыре модуля имеют одинаковые Git blobs, B01 остаётся. Изменения 86f5e07/3d8ba65 учтены отдельно, а не приписаны study revision. |
| E09 | Из разрешённого dev: `TMPDIR=/tmp/r04-cont-journal-UKugTj TSX_DISABLE_CACHE=1 node --import tsx --input-type=module < /tmp/r04-cont-journal-UKugTj/full-with-abort-control.mjs` | Exit 0. ABORT=1811 с исходным сообщением; direct FULL=13, RunStore FULL=1/cannot rollback; исходные activation/events неизменны; после снятия инъекции один success event; integrity=ok, FK violations=0. Только новая временная БД. |

E09 не запускает supervisor/worker или граф. Она использует воспроизводитель B01 ниже, добавляя **до** page limit TEMP event trigger `SELECT RAISE(ABORT,'r04 injected ABORT')`, проверку неизменности всей activation/events, удаление trigger и чтение PRAGMA; затем исходную FULL-пробу и FK check. SHA256 нового fixture: `bace31745a8625c9324f8a12fc4691081c73e8fac85cea919bcaaf20c80dba4c`. Число страниц до инъекции — 56; это параметр временной БД, не лимит продукта. Среда повторно дала Darwin arm64 / Node v26.8.1 / SQLite 3.53.4; WAL, synchronous=2, FK=1, busy=5000, autocheckpoint=1000, fullfsync/checkpoint_fullfsync/user_version/application_id=0.

Уточнены лишь неполные диапазоны S08/S09 (`retry-reconciliation:12-78`, `compiler-versions:1-38`); новые дефекты из этого не выводятся. Исходники, тесты, зависимости, документы проекта и чужие отчёты не редактировались.

### Воспроизводитель B01, переносимый в checkout с существующими зависимостями

Команда ниже воспроизводит ту же E03 из корня checkout. Работает только с новой временной БД. Ожидания `errcode=1` намеренно фиксируют **нынешний дефект**; после исправления регрессия должна ожидать 13.

```sh
node --import tsx --input-type=module <<'NODE'
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
NODE
```

### Устройство дополнительных fixtures для независимого повторения

E04 использует тот же минимальный plan и только RunStore, не запускает workflow. Для каждого crash window создаёт отдельную БД/activation, оставляет родительское соединение открытым и запускает дочерний Node с `--import tsx`. В первом ребёнок регистрирует SQLite функцию `r04_crash`, вызывающую `process.kill(process.pid, 'SIGKILL')`, и TEMP BEFORE INSERT trigger на `workflow_run_events WHEN NEW.type='activation.succeeded'`. Затем вызывает completeActivation. Во втором триггера нет: SIGKILL вызывается сразу после возврата completeActivation. Родитель проверяет именно сигнал SIGKILL, activation, события, integrity и повторное открытие. Это даёт точное окно, а не случайную задержку.

Для snapshot interleaving E04 на fixture переопределяет `first.get`: после настоящего первого SELECT другая connection выполняет completeActivation. Вызов `first.recoveryState()` должен вернуть старую activation и старый eventSeq; следующий — новую пару. Для migration fixture после закрытия store SQL `ALTER TABLE ... DROP COLUMN` удаляет `workflow_runs.supervisor_launch`, `workflow_run_starts.operation/canonical_request`, `workflow_continuation_receipts.workspace_digest/admitted`, `workflow_reused_outputs.producer_schema_digest`. Два новых RunStore должны восстановить шесть колонок и сохранить существующий input; `foreign_key_check=[]`, `integrity_check=['ok']`.

E05 создаёт `probe(id INTEGER PRIMARY KEY,payload TEXT)` через openWorkflowDatabase, задаёт `wal_autocheckpoint=1`, вставляет baseline и делает TRUNCATE. Отдельное read-only соединение начинает BEGIN и SELECT count. Writer вставляет восемь строк по 4096 байт. PASSIVE показывает незавершённый checkpoint, старый читатель по-прежнему видит одну строку. После COMMIT читателя новый SELECT видит девять, TRUNCATE — пустой WAL. Все настройки относятся только к этой fixture.

## Already-fixed/refutations и не выполненные проверки

- **Подтверждено:** A01–A03; не предлагаются повторное исправление WAL backup, замена token fencing, ослабление recovery blockers или автоматический replay.
- **Post-study, отдельно:** `86f5e07` — ранняя проверка parallel writer isolation при authoring; `3d8ba65` — пояснение reviewer binding. Не входят в семь study-source находок, не исследовались как новый дефект и не предлагаются заново.
- **Не переоткрываются:** skill delivery, ownership асинхронной панели/control/await, wait disclosure/caret/scroll. Они вне роли r04; свежие записи Git и known-issues учтены, старое поведение main не использовано как основание находок.
- **Не выполнено:** power-cut/OS crash, аппаратная durability, штатный restore резервной копии с внешними артефактами, испытание на Node 22.19/Linux, весь crash-matrix Git, нагрузочный рост WAL, populated migration matrix старых релизов. Успех 47 тестов не заменяет эти проверки.
- **Узкие открытые вопросы:** U01/U02; отказ конструктора посреди второго migration transaction и освобождение соединения требуют отдельной fault-injection проверки. По коду создание таблиц и миграция колонок — две транзакции; утверждения о единой атомарности всего конструктора здесь нет.

## Источники

Репозиторные ссылки S01–S10 относятся к указанной sourceRevision, не к установленному main. S16 — явно отдельный post-study контекст.

- **S01:** `AGENTS.md`; `PROJECT_INFO/architecture.md`; `PROJECT_INFO/development.md:1-40,78-91,187-275`; `PROJECT_INFO/known-issues.md:5-103` — инварианты, тестовая среда, WAL snapshot и границы известных исправлений.
- **S02:** `PROJECT_INFO/run-journal.md:9-119,180-224`; `PROJECT_INFO/reconciliation.md:16-258,282-310` — контракт журнала/владения/инспекции/решений и crash windows.
- **S03:** `src/sqlite.ts:1-33`; `src/store.ts:1-17` — setup, WAL/FULL/FK, retry scope, общая БД с DraftStore.
- **S04:** `src/run-store.ts:95-253,319-500,595-619,673-679,758-852,1084-1131` — схема, transaction, fencing, архивы, snapshot, reconciliation, continuation fence. Файл прочитан целиком в исходной операции; при продолжении перепроверены указанные диапазоны.
- **S05:** `src/recovery-inspection.ts:1-114`; `src/recovery-files.ts:1-89` — blockers/checkpoint/roots и файловые наблюдения. Оба файла прочитаны целиком.
- **S06:** `src/run-controller.ts:89-164,229-354`; `src/run-runtime.ts:82-109,173-214,275-285,348-357`; `src/workspaces.ts:108-151` — вызывающие стороны, двойная проверка, process-group cleanup, архив перед удалением регистрации.
- **S07:** `tests/sqlite.test.ts:11-49`; `tests/sqlite-backup.test.ts:9-48`; `tests/run-store.test.ts:22-439`; `tests/attempt-history.test.ts:24-115` — выполненные DB/fencing/history/crash регрессии.
- **S08:** `tests/recovery-inspection.test.ts:17-120`; `tests/reconciliation.test.ts:56-201`; `tests/retry-reconciliation.test.ts:12-78`; `tests/allocation-recovery.test.ts:29-120` — выполненные проверки инспекции/решений/архива. Reconciliation исходник читался выборочно, весь файл исполнялся.
- **S09:** `src/compiler-versions.ts:1-38`; `src/execution-plan.ts:88-95`; `tests/store.test.ts:50-75` — отдельная версия плана и расположение 24-client fixture; последняя не запускалась.
- **S10:** `git log -12 --oneline`; профильные `git log -- src/run-store.ts src/sqlite.ts src/recovery-inspection.ts src/recovery-files.ts tests/sqlite-backup.test.ts`; `git show --stat 37ff399` — история, не замена проверки текущего кода.
- **S11:** собственные E03–E07, команды и устройства fixtures выше; только временные данные, компактные наблюдения, без публикации сырых логов.
- **S12:** SQLite, [Transactions — Response To Errors Within A Transaction](https://www.sqlite.org/lang_transaction.html#response_to_errors_within_a_transaction), доступ **2026-09-20** через bash/curl. Автоматический rollback перечисленных ошибок; повторный ROLLBACK может закономерно завершиться ошибкой.
- **S13:** SQLite, [PRAGMA synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous), [fullfsync](https://www.sqlite.org/pragma.html#pragma_fullfsync), [wal_autocheckpoint](https://www.sqlite.org/pragma.html#pragma_wal_autocheckpoint), [wal_checkpoint](https://www.sqlite.org/pragma.html#pragma_wal_checkpoint), доступ **2026-09-20** через bash/curl. Использованы для различения гарантий настройки, checkpoint и физического сбоя.

- **S14:** собственный retained Markdown (SHA256 `b83ee138f0e39ac64a6b9939f613bc5650cc1c5348d04748f42b5e8dd2c63e5c`), preservedActionEvidence (SHA256 `e036f3f8477e220b83700c19888562a6ead8f813cbfba8ebca6ab6b1f805650f`), сохранённые логи/fixtures в `/tmp/r04-journal-UW87KA`; перечень хешей и уровней подтверждения — в парном JSON. Это evidence предыдущей неуспешной операции, не прежний successful result.
- **S15:** новая E09, fixture SHA256 `bace31745a8625c9324f8a12fc4691081c73e8fac85cea919bcaaf20c80dba4c`, наблюдаемый exit 0 и компактный результат; без сохранения реального журнала или сырых логов.
- **S16:** `git log e15bc407..3d8ba65`; `git diff` профильных файлов между этими коммитами; `git show 86f5e07` (stat) и `git show 3d8ba65 -- skills/dynamic-workflows/SKILL.md skills/dynamic-workflows/references/authoring.md` — только отдельный post-study контекст.
