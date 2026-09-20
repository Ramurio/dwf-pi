# r05 — Однократность, идемпотентность и continuation

## Metadata

- **ID:** r05.
- **Тема:** prepared-start, доставка против эффекта, retries/reconciliation, operation records, lineage/continuation, старые ожидания и предки.
- **sourceRevision:** `e15bc407da8753fd6b683c0aa4a68634e3c458a7`.
- **Дата исследования:** 2026-09-20, UTC.
- **Исходники и отчёты:** фактический worktree узла `/Users/ramu/.dynamicwf/runs/run-babf9b25-b8f5-45ad-b79c-2b2e5d31d2f0/worktrees/481943797181ce2546f5ae674f7e93e931b5ae2bc839512d37af8dbb2a996a3c`.
- В worktree нет `node_modules`. Проверки выполнены из разрешённого `/Users/ramu/.local/state/dynamicwf-evaluation-20260920/integration-dev` с существующими зависимостями. До и после проверок HEAD обеих копий совпал с sourceRevision; `git diff --quiet` прошёл в обеих. Node **v26.8.1**. Пакеты не устанавливались.
- Прочитаны AGENTS, архитектура, development, known-issues, профильные документы, skill и git log. Отчёты других исследователей не читались. Исходники, tests, документы проекта, установленный runtime не изменялись. Веб и живые провайдеры не использовались.

## Результат

**Два воспроизведённых bug**, оба на стыке идемпотентной доставки и continuation, а не доказательства повторной внешней записи:

1. **R05-B01:** точный повтор исходного `run.start` после создания continuation ошибочно отклоняется как попытка повторного запуска источника.
2. **R05-B02:** после фиксации continuation, но до резервирования supervisor, повтор `run.continue` возвращает навсегда ожидающий `queued` вместо завершения первоначального запуска. Явный `run.resume` восстанавливает работу.

Кроме них: две подтверждённые категории **already-fixed**, одна **unknown** о смешанных причинах отказа. Всего **5 findings**, из них **2 bug**. Профильные репозиторные проверки: **75/75**, без пропусков в выбранных запусках; это не полный `npm test`. Три собственных сценария повторены дважды с одинаковыми результатами. Отдельный helper-probe не доказывает достижимость проблемы обычным графом.

## Coverage: что именно проверялось

| Граница | Текущий механизм и установленный результат | Предел вывода |
|---|---|---|
| Подготовленный план | `PreparedPlanStore.save/get` сохраняет и проверяет хеш плана + канонический cwd; один план может иметь разные preparedId для разных каталогов. `src/prepared-plans.ts:23–52` | Содержимое каталога, inode и Git HEAD не заморожены. |
| Повтор доставки start | Уникальный ключ в `workflow_run_starts`, сравнение нормализованного input/operation/canonical request, BEGIN IMMEDIATE и атомарный `run.created`: `src/run-store.ts:145–148,240–290`. Четыре конкурентные CLI-доставки в тесте дали один run и одну запись файла | Один выбранный журнал; удаление журнала теряет дедупликацию. Без ключа новые запуски намеренно различны. После fence найден R05-B01. |
| Запуск процесса | `create → reserveLaunch → spawn → attachPid`; допуск владельца атомарен: `src/run-controller.ts:114–127,193–231`, `src/run-store.ts:319–332`. Повтор start закрывает только окно до reserve | Повтор доставки не должен возобновлять interrupted/paused/terminal. Для continuation окно до reserve не закрывается: R05-B02. |
| Намерение операции | Операция сохраняется перед IPC; reservation перед spawn, PID перед stdin: `src/run-runtime.ts:227–286`, `src/process-client.ts:68–98,144–165`. Отказ записи intent/reservation/PID в тестах предотвращал команду | `operation` — намерение, не квитанция внешнего сервиса. `workerLaunch=settled` не доказывает отсутствие удалённых эффектов. |
| Эффект до checkpoint | Собственный R05-E03: настоящий `check` записал файл, SQLite отклонил `activation.succeeded`; остались failed/unknown и одна запись. Неявная вторая попытка заблокирована; accept реального перехваченного результата + resume не повторили команду | Проверен локальный файл/дочерний процесс, не внешняя транзакционная система. |
| Автоматический retry | Политика явная; каждая причина должна быть допустимой и иметь safe effects. Решение связано с попыткой, сроком, политикой и прогрессом: `src/retry-policy.ts:17–27`, `src/run-store.ts:681–719`. После SIGKILL в backoff срок сохраняется; после admission повторное использование решения запрещено | Safe effects — классификация задания, не обещание отсутствия стоимости модели. Составные HTTP-причины в тестах синтетические, не live provider. |
| Reconciliation | Свежие checkpoint и workspace digest; запись решения/архив/применение транзакционны. Retry расходуется на одну новую попытку; accept создаёт восстановленную точку без нового worker: `src/run-store.ts:459–498,804–847`, `src/run-runtime.ts:92–101` | SQLite, файловая система и внешние сервисы не образуют одну транзакцию; evidence участника не сертификат всех эффектов. |
| Lineage/reuse | Один преемник ограждает источник; только source/его предки; точные key/attempt/output/schema и исходный producer сохраняются: `src/run-controller.ts:166–190,441–451`, `src/lineage.ts:279–287,316–357`, `src/run-store.ts:1082–1129` | Reuse возвращает снимок JSON без вызова модели. Это не повторное ревью текущих файлов и не разрешение повторить исходную запись. |
| Stale waits и запечатанные результаты | Новые ответы источнику после fence запрещены; одинаковая уже записанная доставка остаётся чтением. Завершённый родитель/собранный элемент закрывают восстановление дочерней ошибки, соседний элемент не закрывают: `src/run-store.ts:562–576`, `src/recovery-inspection.ts:13–34` | Проверены сервер/журнал и offline-тесты. Панель, caret/scroll/disclosure и skill delivery не переоткрывались по старой версии. |

## Findings

### R05-B01 — `bug`: fence continuation ломает точную повторную доставку исходного start

**Серьёзность:** medium, нарушение контракта ответа/восстановления клиента; не обнаружено дублирования эффекта. **Уверенность:** высокая.

**Триггер:** подготовленный `run.start` с ключом завершён; затем для этого run создан `run.continue`; клиент повторяет байт-в-байт исходный start. Это допустимый запоздавший повтор команды, не просьба возобновить источник.

**Ожидалось:** тот же исходный run ID, текущее состояние и lineage без reserve/spawn/новой работы. Это явное обещание `PROJECT_INFO/execution-plan.md:171–176` и раздела доставки в skill.

**Наблюдалось:** `Run was replaced by a continuation and cannot be relaunched`. Тот же запрос до continuation успешно возвращает исходный ID. После отказа источник остаётся `succeeded`, его события неизменны, всего два run (источник и преемник); команда преемника записала ровно одну строку.

**Причина на исследуемой ревизии:**

- `src/service.ts:128–130`: найденная доставка start безусловно вызывает `completeStart`.
- `src/run-controller.ts:124–127`: `completeStart` безусловно вызывает `launch(id, true)`.
- `src/run-controller.ts:193–201`: `continuationLaunchable=false` пропускает только проверку workspace, а не сам reserve; обработчик поглощает лишь ошибку `Run is not launchable:`.
- `src/run-store.ts:323–324`: fence проверяется раньше статуса и бросает другую ошибку, даже для уже завершённого источника.

**Воспроизведение:** первый сценарий fixture в приложении A; команда R05-E02 ниже. Выполнено дважды. Никаких подмен методов или SQL в этом сценарии: настоящий WorkflowService, SQLite, supervisor, локальная check-команда.

**Контрдоказательства и границы:** дедупликация записи run работает; повтор не создаёт третьего run и не возрождает источник. Запрет `run.resume` источника правилен и в probe тоже подтверждён. Для старого сохранённого ответа await аналогичное различие «повтор доставки / новая работа» уже реализовано правильно (R05-AF02). Это отдельная ошибка start, не повторное открытие исправленной проблемы waits.

**Минимальная рекомендация, не внедрена:** при завершении *первоначальной доставки* возвращать уже fenced run как наблюдение, не пытаться резервировать его. Не ослаблять fence в общем `reserveLaunch`/`resume`. Учесть fence, появившийся между предварительным чтением и reserve, а не только один early-return.

**Риск изменения:** случайное разрешение старому источнику исполняться; чрезмерно широкий catch может скрыть реальный отказ первого запуска.

**Приёмка:** повтор старого start после continuation из succeeded, paused и interrupted источника возвращает тот же ID/lineage без новых событий/резерваций; новый конфликтующий input/ключ той же identity всё ещё отклоняется; `resume` источника и новый ответ его открытому await остаются запрещены. Добавить конкурентный fence/start-repeat тест.

### R05-B02 — `bug`: потеря отправителя в create-before-reserve оставляет continuation без запуска

**Серьёзность:** medium, потеря продвижения работы; не нарушение дедупликации и не повтор внешнего эффекта. **Уверенность:** высокая для состояния и причины; вероятность аварийного окна не измерена.

**Триггер:** неприостановленный источник; `createContinuation` уже зафиксировал преемника `queued/running`, receipt, start-key и source fence; отправитель исчез/получил ошибку до `completeStart`/reserve. Затем новый клиент повторяет тот же `run.continue`.

**Ожидалось:** как для уже поддержанного prepared-start create-gap, точная повторная доставка завершает *первоначальный* запуск ownerless `queued/running`, перепроверив workspace. Не следует ни создавать новый run, ни автоматически resume interrupted/paused/terminal.

**Наблюдалось:** три повторные доставки через новый WorkflowService вернули один и тот же `queued`; owner=null, 0 активаций, 0 `run.reserved`, нет файла эффекта. Source уже fenced. События цели не меняются. Только отдельный явный `run.resume` запускает этот run и записывает одну строку.

**Причина:**

- `src/run-store.ts:1106–1129`: queued target, receipt и source fence фиксируются вместе до запуска процесса.
- `src/run-controller.ts:459–464`: reserve/spawn происходит отдельным следующим действием.
- `src/service.ts:278–279`: повтор возвращает snapshot без `completeStart`.
- `src/run-controller.ts:416–417,429–436,453–464`: прямой повтор и пути concurrent-race также возвращают найденную запись без завершения первоначального запуска.
- В отличие от этого, `src/service.ts:128–130` и `tests/prepared-start.test.ts:147–159` закрывают такое окно у start.

**Воспроизведение:** второй сценарий приложения A. Только внутри собственного процесса fixture метод `RunController.completeStart` временно бросает исключение при наличии receipt, точно после commit и до reserve; затем восстановлен. Сохранившееся состояние и повтор проверены через новый сервис/соединение. Выполнено дважды. Это детерминированная инъекция границы, **не заявленный настоящий SIGKILL клиента**; серверный код не изменялся.

**Конфликт evidence / контрдоказательства:** документ continuation (`skills/dynamic-workflows/references/continuation.md:20–22`) явно обещает same-run, но не формулирует отдельно восстановление create-gap. Узкое обещание same-run здесь соблюдено. Классификация bug относится к незавершённому намерению запуска: первая доставка должна запускать supervisor, повтор возвращает успешный ответ с невыполняющейся очередью, а фонового завершителя этого окна в исследованном пути нет. Если продукт намеренно требует здесь `resume`, это следует явно обозначить как исключение; нынешний start обрабатывает эквивалентное окно автоматически. Обычные concurrent continuation и повтор после успеха проходят существующие тесты и этот дефект не опровергают. Explicit resume — рабочий обход без нового ключа.

**Минимальная рекомендация, не внедрена:** единый безопасный финализатор первоначального старта также для найденной continuation, включая race-return пути. Допуск только unfenced `queued`, desired=running, owner=null; проверка исходного workspace/Git перед reserve; остальные состояния — только вернуть. Требуется одновременно сохранить поведение R05-B01, чтобы не запускать заменённую цель цепочки.

**Риск:** повтор доставки может ошибочно снять паузу/возобновить неопределённую попытку либо потребовать уже удалённый cwd у терминального run.

**Приёмка:** fault после commit до reserve + повтор из нового клиента даёт одну резервацию, одного преемника, один check-эффект; конкурентные повторы не размножают supervisor. Для paused/interrupted/terminal/fenced цели повтор не запускает работу; удалённый cwd завершённой цели не мешает чтению; изменение workspace до первой резервации остаётся отказом.

### R05-AF01 — `already-fixed`: ручное reconciliation замещает автоматический retry, а разрешение расходуется один раз

Тезис «после ручного accept/retry старый автоматический retry всё ещё допустит попытку» **опровергнут** на этой ревизии.

- `src/run-store.ts:804–825` атомарно записывает решение и `abandonScheduledRetries(id, "reconciled", key)` только выбранной активации; при accept архив получает уже abandoned-состояние.
- `src/run-store.ts:469–485` требует pending manual decision и расходует его в транзакции новой попытки; автоматический путь сверяет exact progress/policy/failure (`712–719`).
- Выполнены оба сценария `tests/retry-reconciliation.test.ts:12–78`, проверки rollback/one-use в `tests/reconciliation.test.ts:94–125` и `tests/retry-policy.test.ts:80–110`: точный повтор решения не создаёт событий, соседний retry не теряется, использованное разрешение не разрешает следующую uncertain-попытку.
- Собственный R05-E03 дополнительно показал: неизвестный результат настоящей записи не превращается в автоматически повторяемый check; accept наблюдённого выхода не добавляет исполнения.

**Рекомендация:** изменения семантики не нужны; сохранить эти регрессии при объединении launch-paths. **Риск:** убрать atomic abandonment или проверку sourceAttempt. **Приёмка:** те же тесты и отказ после потреблённого решения; не увеличивать лимиты/не добавлять скрытые retries.

### R05-AF02 — `already-fixed`: источник continuation не оживает от stale await; предки и использованные результаты защищены

Тезис «старый ответ await после continuation возобновит источник» **опровергнут**.

- `src/run-store.ts:567–576`: одинаковый уже записанный response возвращается первым, новый открытый wait проверяет fence до UPDATE/event.
- `src/run-controller.ts:305–310`: даже успешная повторная доставка сохранённого ответа не запускает fenced run.
- `tests/continuation.test.ts:226–271` прошёл все четыре сочетания paused/running intent × open/answered; отвергнутые запросы не изменили wait и события. История `3b8ad7e` объясняет наличие исправления, но основание вывода — текущий код и текущий прогон.
- `src/recovery-inspection.ts:13–34`, `tests/recovery-inspection.test.ts:90–101`: completed-parent и collected-item закрывают именно использованную область, не sibling. Событие wait.resolved меняет recovery checkpoint даже без изменения run.updatedAt (`tests/recovery-inspection.test.ts:60–88`).
- `src/run-controller.ts:441–451`, `src/lineage.ts:279–287,316–357`: чужой run не является предком, stale attempt/неподходящая схема отвергаются. Тесты continuation проверили цепочки reuse, сохранение original producer, различие sourceSchemaDigest/producerSchemaDigest и null-output без нового модельного вызова.

**Рекомендация:** сохранить разделение «доставить уже записанное» и «разрешить новую работу»; применить его и к R05-B01. **Риск:** общий fence, поставленный перед поиском уже записанного ответа, сломает безопасную дедупликацию. **Приёмка:** текущие четыре wait-сценария, точные parent/collect scopes и graft/reuse-regressions остаются зелёными. UI ownership/disclosure/caret/scroll здесь не оценивались как новые ошибки.

### R05-U01 — `unknown`: вторичная unknown-причина и gate `retain-effects`

**Факт кода:** `unknownWriterActivations` (`src/lineage.ts:396–403`) у failed-записи смотрит только `metadata.failure.effects`, не `metadata.failureCauses`. Между тем runtime и журнал поддерживают несколько причин (`src/run-runtime.ts:195–202`, `src/run-store.ts:685–690`), а автоматический retry требует безопасности всех (`694`, `718–719`).

**Узкая выполненная проверка:** искусственная failed sideEffect-запись с первой причиной read-only и второй unknown дала `continuationWriterBlockers(..., [])=[]`; перестановка unknown на первое место дала `writer-disposition-required`. Команда и полный helper fixture — приложение B. Это наблюдаемый порядок-зависимый результат helper, а не доказанный обход публичного `run.continue` настоящим графом.

**Что неизвестно:** не получен нормальный сгенерированный граф, который без инъекции составной Cause создаёт у одного agent/check такую смесь effects. У составного родителя runtime принудительно сохраняет unknown, а check/agent обычно имеют один processEffect; поэтому называть это подтверждённым пользовательским bug нельзя. Выполненные composite retry-тесты используют синтетические Effect Cause и подтверждают другой gate, не достижимость этой смеси в continuation.

**Предложено, не выполнено:** сначала воспроизвести смесь через штатное исполнение одного листа и проверить весь `continuationInspect → continue` без SQL-подмены. Если достижимость подтвердится, минимальная защита — учитывать все валидные причины консервативным any(unknown), сохранив legacy-поведение при отсутствии списка. Риск — лишние требования retain-effects для не относящейся к заданию ошибки. Приёмка: all-safe список не блокирует; любая unknown требует точное disposition; перестановка причин не меняет решение. Не добавлять автоматический retry или обязательное человеческое approval.

## Experiments — действительно выполнено

Рабочая директория команд — разрешённый dev с той же ревизией. `TMPDIR` направлялся в уникальные каталоги `/tmp/r05-idempotency-*`; fixture-процессы/БД/Git были собственными. В отчёт не включены сырые TAP/supervisor-логи.

| ID | Команда | Исход | Границы |
|---|---|---|---|
| R05-E01 | `TMPDIR="$R05_TMP" node --import tsx --test --test-concurrency=1 tests/prepared-start.test.ts tests/continuation.test.ts tests/lineage.test.ts tests/operation-record.test.ts tests/retry-reconciliation.test.ts tests/reconciliation.test.ts tests/retry-policy.test.ts` | exit 0; 65 passed, 0 failed/skipped; 179.396 s | Избранные наборы, не весь проект. Настоящие временные SQLite/процессы/check/Git; фиктивные agent/provider-ответы, без inference. |
| R05-E02 | `TMPDIR=/tmp/r05-idempotency-probe-bKHuz5 node --import tsx /tmp/r05-idempotency-probe-bKHuz5/probe.mjs` | Два прогона exit 0; R05-B01 и R05-B02 воспроизведены в обоих | Полный fixture в A. B02 — контролируемая инъекция исключения, не SIGKILL. |
| R05-E03 | Третья часть той же команды R05-E02 | Два прогона: одна реальная запись перед отказом checkpoint; implicit replay blocked; accept N+1 и resume оставили одну запись | SQL trigger только в fixture; фактический выход check перехвачен перед отказом, не выдуман из файла. |
| R05-E04 | `TMPDIR="$R05_TMP" node --import tsx --test --test-concurrency=1 tests/recovery-inspection.test.ts` | exit 0; 8 passed, 0 failed/skipped; 6.661 s | Хеши/ссылки/Git-admin, гонка checkpoint с pause/await, exact parent/collect scopes. Не crash-matrix всех Git-операций. |
| R05-E05 | `TMPDIR="$R05_TMP" node --import tsx --test --test-concurrency=1 --test-name-pattern='composite' tests/provider-retry.test.ts` | exit 0; 2 matched tests passed; 3.459 s | Синтетические причины 429/503 и 429/401; реального HTTP нет. Остальные тесты файла не запускались. |
| R05-E06 | `node --import tsx /tmp/r05-idempotency-probe-bKHuz5/mixed-causes.mjs` | exit 0; порядок причин меняет helper-result | Только сконструированные данные, см. R05-U01. |

Контрольные дедлайны внутри fixture ограничивают ожидание собственных тестовых процессов, **не являются предлагаемыми лимитами продукта**. В двух прогонах собственных сценариев очистка дождалась отсутствия своих supervisor/workers/groups. Публичные MCP-схемы проверены выбранными тестами; отдельный live MCP/provider-прогон не проводился.

## Already-fixed / refutations и границы гарантий

- **Не ошибка:** повтор точного сохранённого checkpoint возвращает output без work (`src/run-runtime.ts:180–188`, store `467`); это однократность потребления записи, не внешнего эффекта.
- **Не ошибка:** неизвестный результат нельзя повторять только потому, что worker умер; R05-E03 фактически показал состоявшийся эффект при незаписанном успехе.
- **Не ошибка:** retry/accept — отдельное именованное решение с evidence, а не общий reset. Прежняя ошибка/attempt/usage остаются. Однократность admission решения не ограничивает количество явно разрешённых будущих решений.
- **Не ошибка:** source fence создаётся вместе с continuation, в том числе paused target. Это намеренная защита от двух одновременно действующих версий задачи. R05-B01/B02 не предлагают её убрать.
- **Не ошибка:** `reuse` не добавляет invocation и не получает новый вердикт от модели; версии схем и artifactRevision не превращают произвольный JSON/evidence в доказательство действительности артефакта.
- **Не переоткрыты:** ранее исправленные skill delivery и ownership асинхронной панели/control/await, сохранение wait disclosure/caret/scroll. Основная роль этой работы — журнал и продолжения, не браузерный аудит.

## Unknowns и дальнейшие проверки

1. **R05-U01:** достижимость mixed-effects leaf Cause обычным графом — не установлена; не считать helper-probe эксплуатацией.
2. Не измерены частота create-gap R05-B02 и поведение при настоящем убийстве отправляющего CLI точно после commit; детерминированно воспроизведено само сохранённое состояние и его обработка новым клиентом.
3. Не проверены живые провайдеры, удалённые API с собственными idempotency keys, оторвавшиеся от процессной группы внешние процессы, power-loss диска/сети. Успех локального check не даёт exactly-once этим системам.
4. Проверка continuation workspace находится в controller перед launch/resume (`src/run-controller.ts:158–164,193–196,265–277`), не является блокировкой файлов на всё исполнение. Гонки внешнего редактора после последнего наблюдения не исключены. Это согласуется с оговоркой документации; новая атомарность FS+SQLite не доказана и не предложена.
5. Полный npm test, typecheck и вся Git crash-matrix не запускались: исходники не менялись, выбраны профильные проверки. Историческую нестабильность полного набора не объявляю исправленной успешным узким прогоном.

## Источники

Все ссылки ниже — файлы **исследуемой ревизии**, а не старый main. Первичные внешние веб-источники не потребовались.

- Инструкции/контракты: `AGENTS.md`; `PROJECT_INFO/architecture.md`; `PROJECT_INFO/development.md`; `PROJECT_INFO/known-issues.md`; `PROJECT_INFO/execution-plan.md` (delivery/launch-gaps); `PROJECT_INFO/run-journal.md`; `PROJECT_INFO/reconciliation.md`; `PROJECT_INFO/retry-and-failures.md`; `PROJECT_INFO/outcomes-and-waits.md`; `skills/dynamic-workflows/SKILL.md`; `skills/dynamic-workflows/references/continuation.md`.
- Первичный код: `src/prepared-plans.ts`; `src/service.ts:121–135,270–282`; `src/run-controller.ts:114–231,265–315,355–464`; `src/run-store.ts:145–148,240–290,319–332,459–578,673–719,804–847,1075–1130`; `src/run-runtime.ts:45–80,82–110,173–286`; `src/process-client.ts:68–98,144–185`; `src/operation-record.ts`; `src/reconciliation.ts`; `src/retry-policy.ts`; `src/lineage.ts`; `src/recovery-inspection.ts`.
- Исполняемые свидетельства: названные выше тестовые файлы; особенно `tests/prepared-start.test.ts:99–180`, `tests/continuation.test.ts:129–150,199–299,322–449,482–570,659–743`, `tests/reconciliation.test.ts:56–125`, `tests/retry-reconciliation.test.ts`, `tests/operation-record.test.ts:35–78`, `tests/recovery-inspection.test.ts:60–120`, `tests/provider-retry.test.ts:70–87`.
- История, прочитанная через `git log`/`git show --stat`: `41332fc` prepared-start; `8d7f696` safe retry; `2fce387` operation intent; `d93d95f` reconciliation; `f3a57f5` linked continuations; `3b8ad7e` stale-wait fence; текущие `37ff399`, `d72df5d`, `fea2136`, `e15bc40`. История использована для поиска и контрпроверки; выводы привязаны к текущим строкам и выполненным проверкам.

## Приложение A — полный offline fixture для R05-B01/B02 и границы unknown outcome

Сохранить код ниже как `/tmp/r05-idempotency-repro-<уникальный-суффикс>.mjs`. Запускать из корня **этой ревизии** с уже установленными зависимостями: `node --import tsx /tmp/r05-idempotency-repro-<уникальный-суффикс>.mjs`. Он создаёт/закрывает только свои временные БД, запускает локальные `check` и не содержит agent-узлов. Assertions фиксируют нынешнее поведение с дефектами, а не ожидаемый результат после исправления.

```js
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
const load = name => import(pathToFileURL(resolve('src', name + '.ts')).href);
const { WorkflowService } = await load('service');
const { RunController } = await load('run-controller');
const { RunStore } = await load('run-store');
const { JournalRuntime } = await load('run-runtime');
const { Effect, Exit } = await import(pathToFileURL(resolve('node_modules/effect/dist/esm/index.js')).href);
const done = { id:'done', kind:'end', value:{op:'literal', value:{ok:true}} };
const check = { id:'work', kind:'check', command:process.execPath,
  args:['-e', "require('node:fs').appendFileSync('effects', 'one\\n')"] };
async function fixture(work) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'r05-fixture-')));
  const filename = join(dir, 'journal.sqlite');
  const s = new WorkflowService(filename, { cwd:dir, availableModels:[] });
  const c = new RunController(filename);
  try { await work(s,c,dir,filename); }
  finally {
    for (const run of c.store.listRuns()) {
      await c.control(run.id, 'cancel');
      const until = Date.now()+15000;
      for (;;) {
        const o = c.observe(run.id);
        if (!o.supervisorAlive && !o.workersAlive && !o.unresolvedGroups.length && !o.run.ownerToken) break;
        if (Date.now()>until) throw Error('Fixture cleanup timeout');
        await sleep(25);
      }
    }
    s.close(); c.close(); await rm(dir,{recursive:true,force:true});
  }
}
async function plan(s,id,nodes=[done]) {
  await s.dispatch('workflow.create',{id,name:id});
  await s.dispatch('workflow.patch',{id,expectedRevision:1,operations:[
    ...nodes.map(node=>({op:'addNode',graphId:'main',node})),
    ...nodes.slice(1).map((node,i)=>({op:'connect',graphId:'main',edge:{from:nodes[i].id,to:node.id}})),
  ]});
  return s.dispatch('workflow.prepare',{id});
}
async function succeeded(c,id) {
  const until=Date.now()+20000;
  for (;;) {
    const r=c.observe(id).run;
    if (r.status==='succeeded') return r;
    if (r.status==='failed'||r.status==='cancelled'||Date.now()>until) throw Error(r.error||r.status);
    await sleep(25);
  }
}
async function continuation(s,source,p,key) {
  const i=await s.dispatch('run.continuation.inspect',{id:source});
  assert.deepEqual(i.blockers,[]);
  return {preparedId:p.preparedId,idempotencyKey:key,input:null,
    source:{runId:source,checkpoint:i.checkpoint,planHash:i.planHash},
    actor:'r05-offline',reason:'Isolated research fixture',evidence:['Owned temporary files inspected'],
    workspaceDigest:i.workspace.digest,reuse:[]};
}

await fixture(async (s,c,dir)=>{
  const p=await plan(s,'source'), q=await plan(s,'target',[check,done]);
  const request={preparedId:p.preparedId,idempotencyKey:'source-intent',input:null};
  const a=await s.dispatch('run.start',request); await succeeded(c,a.id);
  assert.equal((await s.dispatch('run.start',request)).id,a.id);
  const b=await s.dispatch('run.continue',await continuation(s,a.id,q,'next-intent'));
  await succeeded(c,b.id);
  const before=c.store.events(a.id);
  await assert.rejects(s.dispatch('run.start',request),/replaced by a continuation/);
  await assert.rejects(c.control(a.id,'resume'),/replaced by a continuation/);
  assert.deepEqual(c.store.events(a.id),before);
  assert.equal(c.store.listRuns().length,2);
  assert.equal(await readFile(join(dir,'effects'),'utf8'),'one\n');
  console.log(JSON.stringify({case:'R05-B01',beforeFence:'same-id',afterFence:'exact run.start rejected',sourceStatus:c.store.get(a.id).status,runCount:2,writes:1,sourceEventsUnchanged:true}));
});

await fixture(async (s,c,dir,filename)=>{
  const p=await plan(s,'source'), q=await plan(s,'target',[check,done]);
  const a=await s.dispatch('run.start',{preparedId:p.preparedId,idempotencyKey:'source',input:null});
  await succeeded(c,a.id);
  const request=await continuation(s,a.id,q,'gap-intent');
  const original=RunController.prototype.completeStart;
  let targetId;
  RunController.prototype.completeStart=async function(id) {
    if(this.store.receiptForTarget(id)) {targetId=id; throw Error('r05 fault: after createContinuation, before reserveLaunch');}
    return original.call(this,id);
  };
  try {await assert.rejects(s.dispatch('run.continue',request),/r05 fault/);}
  finally {RunController.prototype.completeStart=original;}
  const fresh=new WorkflowService(filename,{cwd:dir,availableModels:[]});
  try {
    const before=c.store.events(targetId);
    for(let n=0;n<3;n++) {
      const again=await fresh.dispatch('run.continue',request);
      assert.equal(again.id,targetId); assert.equal(again.status,'queued');
    }
    assert.deepEqual(c.store.events(targetId),before);
    assert.equal(c.store.get(targetId).ownerToken,null);
    assert.equal(c.store.listActivations(targetId).length,0);
    assert.equal(c.store.fence(a.id).successorRunId,targetId);
    await assert.rejects(readFile(join(dir,'effects')),/ENOENT/);
    await fresh.dispatch('run.resume',{id:targetId}); await succeeded(c,targetId);
    assert.equal(await readFile(join(dir,'effects'),'utf8'),'one\n');
    console.log(JSON.stringify({case:'R05-B02',redeliveries:3,statusBeforeResume:'queued',reservationsBeforeResume:0,activationsBeforeResume:0,sourceFenced:true,explicitResume:'succeeded',writesAfterResume:1}));
  } finally {fresh.close();}
});

await fixture(async (s,c,dir,filename)=>{
  const p=await plan(s,'checkpoint',[check,done]);
  const id='run-r05-uncertain';
  c.store.create({id,plan:p.plan,cwd:dir,input:null});
  const {token,run}=c.store.reserveLaunch(id);
  const runtime=new JournalRuntime(c.store,run,token,c.directory(id));
  const context={graphId:'main',nodeId:'work',scope:['graph','main'],visit:0};
  const db=new DatabaseSync(filename);
  const original=c.store.completeActivation.bind(c.store); let observedOutput;
  c.store.completeActivation=(id,token,key,output,metadata)=>{observedOutput=output;return original(id,token,key,output,metadata);};
  db.exec("CREATE TRIGGER r05_reject_success BEFORE INSERT ON workflow_run_events WHEN NEW.type='activation.succeeded' BEGIN SELECT RAISE(ABORT,'r05 checkpoint failure'); END");
  try {
    const exit=await Effect.runPromiseExit(runtime.step(context,()=>runtime.check(context,check)));
    assert.ok(Exit.isFailure(exit));
  } finally {db.exec('DROP TRIGGER r05_reject_success');db.close();c.store.completeActivation=original;}
  const a=c.store.listActivations(id)[0];
  assert.equal(a.status,'failed'); assert.equal(a.metadata.failure.effects,'unknown');
  assert.equal(await readFile(join(dir,'effects'),'utf8'),'one\n');
  const blocked=await Effect.runPromiseExit(runtime.step(context,()=>runtime.check(context,check)));
  assert.ok(Exit.isFailure(blocked)); assert.equal(c.store.getActivation(id,a.key).attempt,1);
  assert.equal(await readFile(join(dir,'effects'),'utf8'),'one\n');
  c.store.finish(id,token,{status:'failed',error:'r05 checkpoint failure after real command'});
  assert.deepEqual(observedOutput,{exitCode:0,stdout:'',stderr:''});
  const inspection=await c.recovery(id,a.key); assert.deepEqual(inspection.blockers,[]);
  const request={id,key:a.key,attempt:1,checkpoint:inspection.checkpoint,workspaceDigest:inspection.workspace.digest,
    decisionId:'r05-observed-accept',action:'accept',actor:'r05-offline',reason:'Captured real check output before intentional SQL rejection',
    evidence:['One append observed; actual check return captured in fixture'],output:observedOutput};
  await c.reconcile(request); await c.control(id,'resume'); await succeeded(c,id);
  const receipt=await c.reconcile(request); assert.equal(receipt.application.attempt,2);
  assert.equal(await readFile(join(dir,'effects'),'utf8'),'one\n');
  console.log(JSON.stringify({case:'R05-E03',realWriteBeforeLostCheckpoint:1,failedEffects:'unknown',implicitSecondAttempt:'blocked',acceptedAttempt:2,writesAfterResume:1}));
});
```

## Приложение B — узкий helper-probe, не end-to-end доказательство

Аналогично сохранить как `/tmp/r05-idempotency-mixed-<уникальный-суффикс>.mjs` и выполнить из корня проекта с `node --import tsx`.

```js
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const load = name => import(pathToFileURL(resolve('src', name + '.ts')).href);
const { unknownWriterActivations, continuationWriterBlockers } = await load('lineage');
const { executionFailure } = await load('execution-failure');
const safe = executionFailure('provider','execution','read-only','offline first cause').failure;
const unknown = executionFailure('process','execution','unknown','offline second cause').failure;
const row = {sideEffect:true,status:'failed',attempt:1,key:'fixture-key',metadata:{failure:safe,failureCauses:[safe,unknown],operation:{kind:'check',cwd:'/tmp',command:'unused',args:[]}}};
assert.deepEqual(unknownWriterActivations([row]),[]);
assert.deepEqual(continuationWriterBlockers([row],[]),[]);
assert.equal(continuationWriterBlockers([{...row,metadata:{...row.metadata,failure:unknown,failureCauses:[unknown,safe]}}],[])[0].code,'writer-disposition-required');
console.log(JSON.stringify({case:'R05-U01',boundary:'hand-built helper input only',readOnlyThenUnknown:'no disposition required',unknownThenReadOnly:'disposition required',builtinGraphReachability:'not established'}));
```
