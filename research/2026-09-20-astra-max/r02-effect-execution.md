# r02 — Effect execution и распространение ошибок

## Metadata и вывод

- **ID:** r02. **Дата:** 2026-09-20.
- **Study sourceRevision:** `e15bc407da8753fd6b683c0aa4a68634e3c458a7` (HEAD фактического worktree).
- **Publication revision:** `3d8ba65ee84402c0e3b0587f70095b7847824a9f`; не подменяет исследуемую ревизию.
- **Тип работы:** исследование, без изменения runtime, исходников или тестов.
- **Итог:** 3 воспроизведённых bug и 1 already-fixed в основном списке findings. Главная проблема — не сам `collect`, а потеря информации до его границы. Терминальные ограждения журнала сохраняются, но не предотвращают все последующие действия графа.
- **Среда новых проверок:** Node v26.8.1, Effect 3.22.1, tsx 4.20.6; локальные SQLite и check-процессы, без моделей/сети. Полный `npm test` не запускался.

## Continuation provenance

Предыдущая операция `run-babf9b25-b8f5-45ad-b79c-2b2e5d31d2f0` завершилась `failed` (переданное описание: provider, HTTP 200, assistant turn terminated). Это **не** результат исследования и не доказательство причины ошибки Effect.

Проверены только собственные старые материалы r02. В прежнем worktree оба назначенных md/json действительно отсутствуют: их SHA256 вычислить нельзя. Этот пакет создаётся впервые, а не объявляет старую частичную работу успешным отчётом.

Прочитан `continuation-v1/retained/r02-actions.json` (SHA256 `fbdc7354aa53d7714ccd2a2ca4a6910ea157de77c2012e798acb4a23f71a75a7`). Он содержит команды, **не** полные ответы инструментов. Дополнительно сохранились и прочитаны собственные `/tmp`-исходники probes, 31 структурированный результат и четыре тестовых лога. Хеши ниже рассчитаны при текущем приёме материалов; это контроль идентичности прочитанных файлов, не задним числом созданная аттестация старого прогона.

**Перенесено:** матрица direct/generated Cause, наблюдения вложенного fail-fast, собственного потомка check, cleanup-checkpoint и interruption; сводки четырёх узких тестовых запусков (234 pass, 0 fail суммарно).

**Перепроверено:** текущие file:line; семантика закреплённого Effect; структура всех 31 записей; расхождение прямого `collect` и generated пути; потеря исходного ENOENT; выполнение следующего writer и отказ финального success; потеря cleanup-диагностики при interruption.

**Добавлено:** typed `interrupted` как второй член Cause; реальная ошибка SQLite в release-финализаторе `step`; контрольный ENOENT без ошибки очистки; факт достижения cleanup перед его потерей при interruption; сопоставление с publication revision; самостоятельный воспроизводитель в приложении.

Старые команды не запускались повторно и старые fixtures не изменялись. В истории правок старого probe есть неуспешная гипотеза о сохранении второй cleanup-ошибки во вложенном fail-fast; итоговый retained result её **не подтверждает**. Для выводов использован последний прочитанный исходник и фактические строки результата, а не намерение ранней команды.

## Coverage и контракт

Прочитаны AGENTS, architecture/development/known-issues, профильные graph-contract, run-journal, outcomes-and-waits, retry-and-failures и git log. Рассмотрены:

1. `src/runtime-contract.ts:15-25`: runtime возвращает `Effect<Json, Error>`, а не просто Promise или JSON.
2. `src/compiler.ts:104-131`: каждый узел проходит через `runtime.step`; `map`/`parallel` используют `Effect.forEach`, `collect` оборачивает вызов дочернего графа; без concurrency нет скрытого предела. Сам компилятор не превращает дефекты в JSON.
3. `src/run-runtime.ts:35-40,56-79,173-214`: Promise↔Effect, полный Cause в `collect`, acquire/use/release и обработчик отказа допуска/повтора.
4. `src/run-runtime.ts:218-285,348-356`: cleanup процессов; `src/process-client.ts:145-187` и `src/check-worker-process.ts` — реальные offline check.
5. `src/run-store.ts:431-474,681-701,739-749,854-872`: терминальные ограждения, atomic admission, причины/повторы, транзакции коллекций.
6. `src/run-runtime.ts:82-116,327-333`, `src/run-store.ts:372-397`, `src/supervisor.ts:29-64`: пауза, drain листьев, commit admission и финальный gate.

Документированный контракт особенно строг: смешанные причины с interruption/control/recovery/cleanup нельзя собирать как branch data (`PROJECT_INFO/outcomes-and-waits.md:157-171`); каждая причина участвует в разрешении retry (`PROJECT_INFO/retry-and-failures.md:137-154`). Именно с этим сопоставлены наблюдения.

### Разделение ревизий

Текущий dev уже не целиком равен study source. Проверка полного предполагаемого byte-equality остановилась на `src/compiler.ts`; последующее пофайловое сравнение установило различия также в execution-plan/workspaces и соответствующем тесте. Поэтому повторное утверждение «весь dev — e15» было бы неверным.

При этом `run-runtime`, `run-store`, `runtime-contract`, `process-client`, `process-groups`, `check-worker-process`, `generated-module`, `execution-failure`, `supervisor`, package/lock и основные исследованные тесты совпадают по байтам. Diff compiler меняет ранний parse/frozen validation, но не `emitNode`/`Effect.forEach`.

Новый probe исполнялся на `git archive e15bc40` в `/tmp/r02-cont-effect-20260920-BPVfZM/source`; все **67** файлов src/package/lock сверены с текущим study worktree. Только `node_modules` подключён ссылкой из разрешённого dev. В dev ничего не записано.

## Findings

### R02-B01 — bug: `step.catchAll` сокращает составной Cause перед `collect`

**Место:** `src/run-runtime.ts:205-214`, особенно `return Effect.fail(error)` на строке 213. Потребитель с необходимыми защитами — `src/run-runtime.ts:69-76`; фактический generated путь — `src/compiler.ts:109-125`.

**Триггер:** дочерний `step` завершается `Cause.parallel` или `Cause.sequential`, где первая причина обычная, а вторая — cleanup, typed cancelled/interrupted/uncertain-effect либо Effect interrupt. Автоматический retry для такой смеси не разрешён.

**Ожидание:** после записи активации вернуть исходный Cause; внешний `collect` должен отказать, а не сохранить оболочку failed. Изменение failure→branch data допустимо только после рассмотрения всех членов причины.

**Наблюдение:** прямой `runtime.collect(() => Effect.failCause(cause))` отклоняет опасные смеси. Тот же эффект на границе `runtime.check` внутри настоящего generated графа возвращает **Effect Success** с `item.status=failed`, содержащим только `r02-primary`. В новых случаях cleanup, typed-interrupted, interrupt записана одна коллекция; для defect — Failure и ноль коллекций. Старый probe воспроизвёл то же для обеих форм композиции и typed cancelled/uncertain-effect. Листовая `metadata.failureCauses` при двух typed errors сохраняет обе причины, но это не восстанавливает уже потерянный Cause для родителя.

**Причина:** в Effect 3.22.1 `catchAll` вызывает `matchEffect`; тот без defect передаёт обработчику только `head(Cause.failures(cause))` (`node_modules/effect/src/internal/core.ts:577-590,901-913`). После `Effect.fail(error)` остаток дерева, в том числе interrupt, исчезает. Проверка retry в release (`run-runtime.ts:196-202`) ещё видит полный Cause и корректно отказывает; ошибка возникает **после** неё. Это не ошибка `Cause.isInterrupted` и не необходимость ослаблять collect.

**Более естественная композиция:** retained `nested-real-foreach-failfast` содержит внешний collect и внутренний generated parallel fail-fast. До обработчика родительского step наблюдался `isInterrupted=true`, после него — false; внешний collect завершился успехом с failed-оболочкой. Здесь исходные leaf effects подставлены, но `Effect.forEach` настоящий. Вторая планируемая typed cleanup в этом сценарии не дошла до журнала; данный результат доказывает потерю interrupt, **не** сохранение/потерю именно второй cleanup-причины.

**Контрдоказательства и граница:** одиночные control/cleanup ошибки direct collect отвергаются; дефекты не превращаются в успех; реальные pause/cancel и retry имеют отдельные ограждения. Это не доказательство, что обычный пользовательский `run.cancel` завершится успешно: сигнал AbortController и desired=cancelled остаются отдельными препятствиями. Матрица использует разрешённую инъекцию Effect на runtime boundary, а не live provider.

**Воспроизведение:** E05 (retained матрица), E06 cases `generated-cleanup`, `generated-typed-interrupted`, `generated-interrupt`, `generated-defect`; полная команда/fixture — приложение A.

**Минимальная рекомендация:** Cause-aware обработчик вокруг acquire/use/release; сохранять `Effect.failCause(originalCause)` во всех путях без разрешённого нового допуска. Отказ паузы должен по-прежнему перепроверяться только до `executedAttempt`; решение retry остаётся журнальным, а не выводится заново из первого Error.

**Риск:** наивный `catchAllCause` может перехватить defect/interrupt и случайно допустить работу. Нельзя откатывать исправление admission race. Сохранение Cause затронет также interruption внутренних fail-fast siblings, не только пользовательскую отмену: это требует проверки совместимости вложенного fan-out, а не молчаливого удаления управляющей причины.

**Приёмка:** generated `map` и `parallel`, обе формы Cause, обычный Error + каждый запрещённый член: Failure, отсутствие collection.settled и следующего writer, исходные причины сохранены. Обычная собранная ошибка, replay, explicit safe retry и pause/resume regression должны продолжать работать. Эти расширенные регрессии **предложены**, не внедрены.

### R02-B02 — bug: ошибка `clearPid` замещает исходный отказ; нетипизированный cleanup может пропустить следующий writer

**Место:** `src/run-runtime.ts:279-285` (`check`), аналогичный `finally` у agent на строке 270; `clearPid` на строках 348-356. Общий Git callback подключён на строке 302, JS-finally в `src/workspaces.ts:287-294`.

**Триггер:** основная операция уже отклонилась, затем `clearPid` бросает другую ошибку: обнаружена живая группа либо не удалась транзакция checkpoint `workerLaunch=settled`.

**Ожидание:** сохранить первоначальный отказ и отдельно ошибку очистки; cleanup/неподтверждённый checkpoint не должен стать обычными branch data и разрешить следующие узлы.

**Наблюдение 1 (первопричина):** без инъекции cleanup отсутствие команды даёт `process/setup/not-started`, `ENOENT`, group=empty. С SQLite `BEFORE INSERT` trigger, отклоняющим только cleanup event ребёнка, остаётся лишь `unknown/execution/unknown: r02-cleanup-checkpoint`; ENOENT отсутствует. `finally` в JS замещает уже отклонённый результат.

**Наблюдение 2 (допуск после cleanup):** generated collect принимает эту нетипизированную ошибку как обычную. Следующий настоящий check создаёт `after-cleanup=executed`, а прежний workerGroupState остаётся pending. E06 завершился Effect Success; последующий прямой `RunStore.finish(succeeded)` ожидаемо отказал: группа не подтверждена пустой. Значит, **терминальный success защищён, но последующие эффекты графа уже произошли**. Не следует описывать это как записанный успешный run.

**Независимое retained наблюдение:** check породил собственного живого потомка и сам завершился SIGKILL. Возвращена только `uncertain-effect/cleanup/unknown` о живой группе, исходный `Check terminated by SIGKILL` утрачен. Этот сценарий не перезапускался в continuation; прочитанный старый fixture ограничивал жизнь своего потомка и завершал/проверял только его. Здесь типизированный cleanup распространяется правильно, но первоначальная диагностика потеряна.

**Причина:** сырые исключения `groupMembers`/SQLite не получают cleanup-классификацию в clearPid; processEffect превращает их в Error-канал, `describeFailureCause` даёт fallback phase=execution (`run-runtime.ts:26-39`). Защита collect смотрит на код/фазу, а не на контекст вызова (`:74`). Поэтому одна и та же граница очистки ведёт себя по-разному для специально созданного uncertain-effect и обычного исключения хранилища.

**Контрдоказательства:** pending-группа не стирается; повтор этой же активации запрещён (`run-store.ts:466`); финальный success запрещён (`:435`); supervisor при recorded PID/pending оставляет ownership для recovery (`supervisor.ts:55-60`). SQL trigger моделирует локальный отказ checkpoint, не доказывает его частоту на реальном диске. Agent/Git имеют такой же шаблон по коду, но отдельные live-agent/Git fault runs не проводились.

**Воспроизведение:** E05 cases actual-check-cleanup-checkpoint / actual-check-error-with-live-descendant / actual-check-cleanup-next-writer; E06 ordinary-missing-check и cleanup-checkpoint-followed-by-writer. Приложение A воспроизводит существенный дефект на реальном check без модели.

**Минимальная рекомендация:** отделить исход операции от обязательного завершения, скомпоновать причины, не использовать замещающий JS-finally как единственный канал ошибки. В самой cleanup-границе нормализовать инфраструктурные исключения как cleanup/unknown, не выдумывая not-started. Учесть тот же callback в Git. Исправлять вместе с R02-B01: просто вернуть два typed Error недостаточно, пока step сокращает Cause.

**Риск:** нельзя скрывать неопределённую группу, очищать PID при отказе checkpoint или превращать запись в безопасно повторяемую операцию. Простого `AggregateError` недостаточно, если дальше он снова классифицируется как обычный unknown/execution.

**Приёмка:** для исходного ENOENT/SIGKILL и последующего cleanup fault доступны обе причины; collector не пишет failed-оболочку и следующий writer не стартует; pending/ownership сохраняются до подтверждения. При успешной очистке прежний ENOENT остаётся обычной собираемой ошибкой. Расширение на agent/Git — предложенная, не выполненная проверка.

### R02-B03 — bug: interruption ждёт cleanup Promise, но теряет его ошибку

**Место:** `src/run-runtime.ts:35-40`, особенно `promise.then(() => undefined, () => undefined)` на строке 39; журналирование оставшегося Exit — строки 191-202.

**Триггер:** прервать Effect работающего check после marker started; при выполнении `clearPid` отклонить запись settled посредством SQLite trigger.

**Ожидание:** сохранить interruption как управляющую причину, дождаться процесса и донести отдельный cleanup failure в Cause/диагностику попытки. Обычный ProcessCancelled не должен становиться ложной cleanup-ошибкой, но реальный отказ очистки не должен исчезать.

**Наблюдение:** E06 подтвердил достижение `setActivationMetadata(workerLaunch=settled)` и завершение ожидаемого Promise. Exit — Failure/interrupted=true, но списки failures/defects пусты; marker `r02-cleanup-after-interrupt` отсутствует в ошибке активации. Metadata сообщает cancelled/execution/unknown вместо конкретного cleanup fault; group остаётся pending. Retained E05 показывает тот же результат.

**Причина:** возвращённый из `Effect.async` canceler превращает и fulfilled, и rejected Promise в успех. После начала interruption обычный resume уже не доставляет поздний reject в исходную операцию. Это сознательно обеспечивает ожидание, но без дополнительного пути ошибки теряется диагностика очистки.

**Контрдоказательства:** ожидание cleanup действительно есть — существующий `tests/run-runtime.test.ts:79-100` проверяет отсутствие преждевременного завершения и drain процесса; новый тест не утверждает, что процесс остался жив. pending-группа и supervisor fence не позволяют на основании этого Exit объявить внешние эффекты остановленными. Отмена не превратилась в Success и новая попытка не была разрешена.

**Воспроизведение:** E06 `interrupt-and-cleanup-checkpoint`, приложение A; E05 `actual-interruption-cleanup-checkpoint`.

**Минимальная рекомендация:** сохранить await/drain, но передавать настоящий cleanup outcome отдельно от ожидаемого отказа операции при отмене; скомпоновать его с interruption либо надёжно зафиксировать cleanup-диагностику до выхода. Это не предложение `return Effect.promise(() => promise)` без разбора: обычная отмена сама отклоняет Promise.

**Риск:** ложный cleanup defect для штатной отмены; изменение порядка drain; запись старым owner. Ни подавление всех ошибок, ни немедленный выход вместо ожидания неприемлемы.

**Приёмка:** после abort + injected cleanup fault interruption сохраняется вместе с cleanup marker, нет collection/повтора/следующего writer; штатный abort без cleanup fault остаётся обычной отменой и всё ещё ждёт полного drain. Добавить раздельные тесты для основного отказа, cleanup fault и их сочетания. Сейчас проверено именно сочетание abort + отказ cleanup checkpoint.

### R02-AF01 — already-fixed (study source): pause/resume admission race

**История:** `6ee370a648e0e0f26430cbf1d5970297d2911f9e`, уже входит в e15. `RunNotAcceptingWork` типизирован (`src/run-store.ts:28-33`), admission проверяет состояние транзакционно (`:459-462`), runtime повторяет допуск только до `executedAttempt` при том же owner и без cancel (`src/run-runtime.ts:205-212`).

Retained E01: tests/pause-resume-admission — resume после refusal допускает ровно одну работу/попытку; cancel и owner-loss не создают активацию; похожий текст и даже typed отказ из уже запущенной работы не дают admission retry. E04: drain активного check, nested parallel/map и гонка перед worktree commit прошли. Пауза не является cancellation работающего листа; structural parent может оставаться running. Повторное внедрение этого исправления не рекомендуется. R02-B01 относится к сохранению Cause в том же обработчике, а не к отмене данной защиты.

## Already-fixed после study source и опровержения

**Post-study, отдельно от findings:**

- `86f5e07`: ранняя parallel writer isolation validation уже добавлена в graph/compiler; не предлагать снова.
- `3d8ba65`: уточнена документация reviewer artifact/criteria binding. Сам binding уже виден в study `src/run-runtime.ts:359-372`; это не новый пробел Effect.
- Skill delivery, scoped UI/control/await и wait disclosure/caret/scroll не переоткрывались: это вне данной роли, а исходная ревизия уже содержит названные исправления.

**Опровергнутые обобщения:**

1. «collect вообще не проверяет смешанные причины» — неверно. Проверяет, и direct fixture проходит; проблема R02-B01 выше по стеку. Существующий `tests/collection.test.ts:117-143` в опасных mixed cases вызывает collect напрямую, минуя generated step.
2. «любая ошибка финализатора Effect теряется» — неверно. Новый E06 SQL fault в `activation.failed` внутри release возвращает Failure с `r02-primary` и `r02-release-write`; коллекции нет, failed checkpoint откатился (leaf running). `acquireUseRelease` в Effect последовательно комбинирует use/release Cause (`internal/core.ts:410-426`). В присутствии defect `catchAll` делает electFailures: typed primary становится defect, но текст/причина остаётся. Это отличается от JS-finally и Promise-canceler.
3. «mixed causes обходят retry policy» — не подтверждено. Решение принимается до сокращения Cause: `run-runtime.ts:196-202`, `run-store.ts:686-701`. E02/E03 проверяют разрешённые/запрещённые причины, наибольшую серверную задержку и отказ всей смеси при одном запрещённом статусе. Новых retries или лимитов не требуется.
4. «Effect Success из probe доказывает persisted succeeded run» — неверно; R02-B02 отдельно проверяет отказ `RunStore.finish`. Supervisor не запускался в новых probes.

## Experiments: что действительно выполнено

Все старые строки ниже — **перенесённые результаты прочитанных логов**, не повторно запущенные здесь проверки. Исторические команды исполнялись из разрешённого dev; журнал действий содержит тогдашнюю сверку с study worktree. Новая операция не может заново удостоверить старый dev HEAD по одному списку команд, поэтому для главных findings использована новая точная архивная копия e15.

| ID | Команда / fixture | Наблюдение | Граница |
|---|---|---|---|
| E01 | `node --import tsx --test --test-concurrency=1 tests/run-runtime.test.ts tests/pause-resume-admission.test.ts tests/compiler.test.ts tests/collection.test.ts` | retained 26 pass, 0 fail | Offline интеграция, не live provider; прямые collect-тесты не покрывают R02-B01 |
| E02 | `node --import tsx --test --test-concurrency=1 tests/retry-policy-contract.test.ts tests/process-groups.test.ts` | retained 201 pass, 0 fail | Политика/группы, не гарантия всех отказов ОС |
| E03 | `node --import tsx --test --test-concurrency=1 --test-name-pattern='composite\|excluded status\|safe retries\|every member' tests/provider-retry.test.ts tests/retry-policy.test.ts` | retained 4 pass, 0 fail | Выбраны только offline cause/retry случаи |
| E04 | `node --import tsx --test --test-concurrency=1 --test-name-pattern='pause drains an active check\|nested parallel and dynamic map drain\|a pause injected after the gate' tests/run-controller.test.ts tests/workspaces.test.ts` | retained 3 pass, 0 fail | Только собственные offline процессы/Git fixtures прежней операции |
| E05 | `node --import tsx /tmp/r02-effect-20260920-CaZdw5/probe.mts` (исторически, не перезапускать этот путь) | прочитаны 31 JSON records; матрица независимо проверена Python assertions | Последняя версия fixture, не все промежуточные команды успешны; raw-foreach имеет исходник, но отдельный вывод не сохранён |
| E06 | `node --import /Users/ramu/.local/state/dynamicwf-evaluation-20260920/integration-dev/node_modules/tsx/dist/loader.mjs /tmp/r02-cont-effect-20260920-BPVfZM/verify.mts` | **новый запуск, exit 0**, 8 cases, все assertions прошли | Архив e15, реальный SQLite/check, инъекция Cause только в четырёх matrix cases и release-тесте; без supervisor/provider |
| E07 | `git diff e15bc407da8753fd6b683c0aa4a68634e3c458a7 3d8ba65ee84402c0e3b0587f70095b7847824a9f -- src/compiler.ts ...`; пофайловое byte comparison | **новая проверка** разделила study/publication; 67 архивных файлов совпали со study | Не полный тест публикационной ревизии |

Fixture E06 находится под новым r02-префиксом; каждый case создаёт собственную БД/каталог, закрывает store и удаляет только свой case. Работающий в interruption-case check отменяется собственным AbortController и ожидается в finally. Никакие реальные run, пользовательские процессы, SSH, pi/subagents или провайдеры не управлялись. Никаких установок пакетов, полного npm test, web-запросов или git commit/push/checkout/reset не было.

### Контроль идентичности входных evidence

| Материал | SHA256 |
|---|---|
| retained `probe.mts` | `33106f16d3f2824ad7d700651ef82f4c6b7bbcf4301c08c796873b21d9d13dd2` |
| retained `result.jsonl` | `2a76b1058b072451cc7c0b156280a10e8f3a3cf8e283c1b72cda2c307db6d0f3` |
| retained `raw-foreach.mts` (только fixture) | `8084c45a1d6f13941691e63efc8144b683334d63e980f86bce42462320aacf79` |
| E01 log | `51f8f4a56bf13090de0c875320ed39137b3869d1a354b53e47ccc41ce206e698` |
| E02 log | `e85d41a4de26a64d0afa0ba6d28a7ffbb99e3cf31f81e754e667d6df4429e448` |
| E03 log | `0a1deb87ac50fb2721e9eca297965701450a1991e11f8609435dbbdcc5e16d5e` |
| E04 log | `4fd88225893b52b92daa26fbae2ee9f6e4836b45c7aa382efb770dfefb8e2b25` |
| E06 `verify.mts` | `1f7c80f94aec31c0372c0de9af675187786b0f5e885c27e7305d2b41fadbb22b` |
| E06 `result.jsonl` | `6d50372c8fdfeec79e9b1f886674483aa748699be776861d527b8241ac0b5309` |

Сырые логи не публикуются. Итоговые SHA256 **двух отчётов** вычисляются после их окончательной записи и передаются в structured result; JSON не содержит самоссылочного хеша.

## Источники и unresolved questions

**Источники (все локальные, inspected 2026-09-20):**

- S01: `AGENTS.md`; `PROJECT_INFO/architecture.md`, `development.md`, `known-issues.md`; git log study и delta к publication.
- S02: `PROJECT_INFO/graph-contract.md` (компиляция); `src/compiler.ts:63-133`, `src/runtime-contract.ts:15-25`.
- S03: `PROJECT_INFO/outcomes-and-waits.md:157-183`; `tests/collection.test.ts:117-143`.
- S04: `src/run-runtime.ts:26-79,173-214,218-285,299-356`.
- S05: `src/run-store.ts:28-33,372-397,431-474,673-701,739-766,854-872`; `PROJECT_INFO/run-journal.md`.
- S06: `src/supervisor.ts:29-64`; `src/process-client.ts:145-187`; `src/check-worker-process.ts`.
- S07: `src/workspaces.ts:287-303`; `tests/workspaces.test.ts:275`.
- S08: `PROJECT_INFO/retry-and-failures.md:61-66,131-154`; `tests/provider-retry.test.ts:70-88`, `tests/retry-policy.test.ts:101,147`.
- S09: `tests/run-runtime.test.ts:79-100`, `tests/pause-resume-admission.test.ts:29-113`, `tests/run-controller.test.ts:269,354`.
- S10: локальная закреплённая зависимость Effect 3.22.1: `node_modules/effect/src/internal/core.ts:410-426,577-590,901-913`; версия подтверждена package-lock.
- S11: собственные retained actions/probe/results/logs, хеши выше и пути в JSON.
- S12: новый archive-based E06, исходник в приложении, хеши выше.

**Unknowns / границы выводов:**

- U01: частота и конкретные пути появления опасной составной Cause в live provider не проверялись. Доказан контракт Effect/runtime и nested generated forEach с подставными leaf effects; нельзя выводить качество/доступность/квоты модели.
- U02: отдельные fault runs для agent и Git cleanup не выполнялись. Сходство JS-finally видно в коде; перенос результата check на каждый их сценарий остаётся предположением.
- U03: отказ диска/SQLite на реальной машине не провоцировался. Trigger детерминированно моделирует отказ одной транзакции; последствия после supervisor recovery полностью здесь не измерены.
- U04: новые проверки не являются прогоном всей publication revision, всех поддерживаемых Node/ОС или полной race-моделью. Процессные флейки из known-issues не объявлены исправленными.

## Приложение A — воспроизводимая новая fixture

Команда ниже предназначена для **нового** временного каталога. Она не запускает старый probe и не пишет в dev. В `DEPS` указывается уже существующий node_modules разрешённой установки; пакеты не устанавливаются. Выполнять из worktree с данным отчётом и доступным Git-объектом study revision.

```sh
DEPS=/Users/ramu/.local/state/dynamicwf-evaluation-20260920/integration-dev/node_modules
R02_TMP=$(mktemp -d /tmp/r02-reproduce-20260920-XXXXXX)
mkdir "$R02_TMP/source"
git archive e15bc407da8753fd6b683c0aa4a68634e3c458a7 src package.json package-lock.json | tar -x -C "$R02_TMP/source"
ln -s "$DEPS" "$R02_TMP/source/node_modules"
python3 - research/2026-09-20-astra-max/r02-effect-execution.md "$R02_TMP/verify.mts" <<'PY'
from pathlib import Path
import sys
text=Path(sys.argv[1]).read_text()
code=text.split('```typescript r02-offline-probe\n',1)[1].split('\n```',1)[0]+'\n'
Path(sys.argv[2]).write_text(code)
PY
node --import "$DEPS/tsx/dist/loader.mjs" "$R02_TMP/verify.mts"
```

Ниже — **тот же** исходник E06. Assertions закрепляют наблюдаемое поведение исследуемой ревизии, включая дефекты; после исправления такой reproducer должен перестать проходить, а не стать регрессией, требующей сохранить bug. Временные startup deadlines относятся только к собственному fixture, не к политике runtime.

```typescript r02-offline-probe
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const root = join(dirname(fileURLToPath(import.meta.url)), 'source');
const imp = p => import(pathToFileURL(join(root,p)).href);
const { Effect, Cause, Exit, FiberId } = await imp('node_modules/effect/dist/esm/index.js');
const { JournalRuntime } = await imp('src/run-runtime.ts');
const { RunStore, activationKey } = await imp('src/run-store.ts');
const { prepareExecutionPlan } = await imp('src/execution-plan.ts');
const { loadGeneratedModule } = await imp('src/generated-module.ts');
const { executionFailure } = await imp('src/execution-failure.ts');
const lit=value=>({op:'literal',value});
const primary=executionFailure('process','setup','not-started','r02-primary');
const cleanup=executionFailure('process','cleanup','unknown','r02-cleanup');
function graph(after=false) {
  return {schemaVersion:1,id:'r02_verify',name:'Offline continuation verification',revision:1,entryGraph:'main',graphs:{
    main:{entry:'fan',nodes:[{id:'fan',kind:'parallel',failurePolicy:'collect',children:[{id:'item',graphId:'child',input:lit(null)}]},
      ...(after?[{id:'after',kind:'check',command:process.execPath,args:['-e',"require('node:fs').writeFileSync('after-cleanup','executed')"]}]:[]),
      {id:'done',kind:'end',value:{op:'ref',path:['nodes','fan']}}],edges:after?[{from:'fan',to:'after'},{from:'after',to:'done'}]:[{from:'fan',to:'done'}]},
    child:{entry:'work',nodes:[{id:'work',kind:'check',command:'./r02-intentionally-absent',args:[]},{id:'done',kind:'end',value:lit(null)}],edges:[{from:'work',to:'done'}]}
  }};
}
const parent={graphId:'main',nodeId:'fan',scope:['graph','main'],visit:0};
const child={graphId:'child',nodeId:'work',scope:['graph','main','node','fan','visit','0','parallel','item','graph','child'],visit:0};
async function fixture(work,w=graph()) {
  const dir=await mkdtemp(join(dirname(root),'case-'));
  const file=join(dir,'state.sqlite'),store=new RunStore(file);
  try {
    const plan=await prepareExecutionPlan(w,{cwd:dir,availableModels:[]});
    store.create({id:'r02-run',plan,input:null,cwd:dir});
    const {run,token}=store.reserveLaunch('r02-run');
    const runtime=new JournalRuntime(store,run,token,dir);
    const program=await loadGeneratedModule(plan,dir);
    await work({dir,file,store,runtime,token,plan,program});
  } finally {store.close();await rm(dir,{recursive:true,force:true});}
}
const details=e=>Exit.isSuccess(e)?{exit:e._tag}:{exit:e._tag,failures:[...Cause.failures(e.cause)].map(x=>x.message),defects:[...Cause.defects(e.cause)].map(x=>x.message||String(x)),interrupted:Cause.isInterrupted(e.cause)};
for (const [name,second] of [
  ['cleanup',Cause.fail(cleanup)],
  ['typed-interrupted',Cause.fail(executionFailure('interrupted','execution','unknown','r02-typed-interrupted'))],
  ['interrupt',Cause.interrupt(FiberId.none)],
  ['defect',Cause.die(new Error('r02-defect'))],
]) await fixture(async f=>{
  const cause=Cause.sequential(Cause.fail(primary),second);
  f.runtime.check=()=>Effect.failCause(cause); // only the offline fixture's worker boundary is injected
  const exit=await Effect.runPromiseExit(f.program.run(f.runtime,null));
  const a=f.store.getActivation('r02-run',activationKey(child));
  assert.equal(Exit.isSuccess(exit),name!=='defect');
  console.log(JSON.stringify({case:'generated-'+name,...details(exit),savedCauses:a.metadata.failureCauses?.map(c=>c.message),collectionCount:f.store.collections('r02-run',activationKey(parent)).summary.total}));
});
// Missing coverage: a real failure of the acquireUseRelease journal finalizer.
await fixture(async f=>{
  const db=new DatabaseSync(f.file);
  try {
    db.exec(`CREATE TRIGGER r02_release BEFORE INSERT ON workflow_run_events WHEN NEW.type='activation.failed' BEGIN SELECT RAISE(ABORT,'r02-release-write'); END`);
    f.runtime.check=()=>Effect.fail(primary);
    const exit=await Effect.runPromiseExit(f.program.run(f.runtime,null));
    assert.ok(Exit.isFailure(exit)&&Cause.isDie(exit.cause));
    const pretty=Cause.pretty(exit.cause);
    assert.ok(pretty.includes('r02-primary')&&pretty.includes('r02-release-write'));
    assert.equal(f.store.collections('r02-run',activationKey(parent)).summary.total,0);
    console.log(JSON.stringify({case:'journal-release-defect',...details(exit),collectionCount:0,leafStatus:f.store.getActivation('r02-run',activationKey(child)).status}));
  } finally {db.close();}
});
await fixture(async f=>{
  const exit=await Effect.runPromiseExit(f.program.run(f.runtime,null));
  assert.ok(Exit.isSuccess(exit));
  const a=f.store.getActivation('r02-run',activationKey(child));
  assert.equal(a.metadata.failure.code,'process');assert.equal(a.metadata.failure.effects,'not-started');assert.match(a.error,/ENOENT/);
  console.log(JSON.stringify({case:'ordinary-missing-check',...details(exit),failure:a.metadata.failure,group:a.metadata.workerGroupState}));
});
await fixture(async f=>{
  const db=new DatabaseSync(f.file);
  try {
    db.exec(`CREATE TRIGGER r02_cleanup BEFORE INSERT ON workflow_run_events WHEN NEW.type='activation.metadata' AND json_extract(NEW.payload,'$.metadata.workerLaunch')='settled' AND instr(json_extract(NEW.payload,'$.key'),'"child"')>0 BEGIN SELECT RAISE(ABORT,'r02-cleanup-checkpoint'); END`);
    const exit=await Effect.runPromiseExit(f.program.run(f.runtime,null));
    const a=f.store.getActivation('r02-run',activationKey(child));
    assert.ok(Exit.isSuccess(exit));assert.equal(a.metadata.failure.phase,'execution');assert.equal(a.metadata.failure.code,'unknown');assert.doesNotMatch(a.error,/ENOENT/);
    assert.equal(await readFile(join(f.dir,'after-cleanup'),'utf8'),'executed');
    assert.equal(a.metadata.workerGroupState,'pending');
    assert.throws(()=>f.store.finish('r02-run',f.token,{status:'succeeded',output:exit.value}),/verified empty/);
    console.log(JSON.stringify({case:'cleanup-checkpoint-followed-by-writer',...details(exit),failure:a.metadata.failure,primaryRetained:false,afterWriter:true,group:a.metadata.workerGroupState,terminalSuccessBlocked:true}));
  } finally {db.close();}
},graph(true));
await fixture(async f=>{
  const db=new DatabaseSync(f.file),controller=new AbortController();let running;let observedCleanup=false;
  const real=f.store.setActivationMetadata.bind(f.store);
  f.store.setActivationMetadata=(...args)=>{if(args[3].workerLaunch==='settled')observedCleanup=true;return real(...args);};
  try {
    db.exec(`CREATE TRIGGER r02_cleanup BEFORE INSERT ON workflow_run_events WHEN NEW.type='activation.metadata' AND json_extract(NEW.payload,'$.metadata.workerLaunch')='settled' BEGIN SELECT RAISE(ABORT,'r02-cleanup-after-interrupt'); END`);
    const node=f.plan.workflow.graphs.child.nodes[0];
    running=Effect.runPromiseExit(f.runtime.step(child,()=>f.runtime.check(child,node)),{signal:controller.signal});
    const until=Date.now()+10000;
    for(;;){try{await readFile(join(f.dir,'started'));break}catch{if(Date.now()>until)throw Error('Own fixture did not start');await new Promise(r=>setTimeout(r,10));}}
    controller.abort();const exit=await running;
    const a=f.store.getActivation('r02-run',activationKey(child));
    assert.ok(Exit.isFailure(exit)&&Cause.isInterrupted(exit.cause));assert.ok(observedCleanup);assert.equal(a.metadata.workerGroupState,'pending');
    assert.doesNotMatch(a.error,/r02-cleanup-after-interrupt/);assert.equal([...Cause.failures(exit.cause)].length,0);assert.equal([...Cause.defects(exit.cause)].length,0);
    console.log(JSON.stringify({case:'interrupt-and-cleanup-checkpoint',...details(exit),observedCleanup,group:a.metadata.workerGroupState,cleanupDiagnosticRetained:false}));
  } finally {controller.abort();if(running)await running;db.close();}
},(()=>{const w=graph();Object.assign(w.graphs.child.nodes[0],{command:process.execPath,args:['-e',"require('node:fs').writeFileSync('started','yes');setInterval(()=>{},1000)"]});return w;})());
```
