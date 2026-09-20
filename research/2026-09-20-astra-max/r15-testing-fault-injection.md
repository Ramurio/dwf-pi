# r15 — Тестирование и fault injection

## Продолжение: происхождение пакета и новые проверки

**Новая операция:** `run-9dbb044c-664f-4dd8-96c0-57192dc4ed89`; проверка пакета — 2026-09-20. **Study-source остаётся `e15bc407da8753fd6b683c0aa4a68634e3c458a7`.** Ревизия публикации — `3d8ba65ee84402c0e3b0587f70095b7847824a9f`, это другой срез.

Собственные два отчёта из `run-babf9b25-b8f5-45ad-b79c-2b2e5d31d2f0` прочитаны целиком. Старая операция по входному retainedEvidence имеет статус **failed** (`provider`, наблюдённый HTTP 429, effects `unknown`); наличие файлов не объявляет её успешной. Причина квот/прав аккаунта не исследовалась. Эта операция завершает доказательный пакет, а не повторяет старого исполнителя.

| Сохранённый файл | Байты | Перепроверенный SHA256 |
|---|---:|---|
| r15-testing-fault-injection.md | 33380 | `98af74e9d8251f61d03517392b45b2b4a1409976724ea919179fd71e70442768` |
| r15-testing-fault-injection.json | 42732 | `3ffcb8b70539889d19a8af82b4602b65af857fe452747905cc89d78d452401f4` |

Оба значения совпали с retainedEvidence. `r15-actions.json` — **19 записей команд, не их stdout/exit**; SHA256 `de4803b264088be1637d939847b9bdc4e50ad67b820744870ae3c186c874f996`. Полные пути, хеши сохранённых logs и отдельные перенесённые/перепроверенные/добавленные факты — в JSON `continuationProvenance`.

**Заново выполнено только чтение/анализ (C01–C04):**

- `pwd`, `git rev-parse HEAD`, `git status --short`, `shasum -a 256` собственных старых файлов; их JSON/counts/Markdown проверены. Новый cwd действительно на study-source.
- Read-only Python сверил **45 диапазонов file:line** и **39 файлов**: новый worktree = старый worktree = Git blobs study-source. Ключевые места всех пяти находок перечитаны; тексты рекомендаций и классификации не изменены. При финальной проверке Markdown исправлен один унаследованный диапазон источника: для `tests/run-controller.test.ts` старое 421–474 → корректное 421–470 (файл на study-source заканчивается строкой 470); это коррекция ссылки, не новая находка.
- Из собственных сохранившихся `/tmp/r15-testing-*` прочитаны **9 logs**, без исполнения и изменения fixtures. Шесть сводок подтверждают 121 pass; три финальные инъекции — fail/fail/pass, первые две с assertions на строках 369/382. Оба embedded fixture совпали с реальными файлами и heredoc в `actions[14]` (индекс с нуля).
- Прочитаны `git log source..publication`, адресные `git show` и `git diff`. Текущий dev действительно имеет HEAD `3d8ba65…`, профильный diff пуст. Семь проверенных process/harness/UI файлов между этими ревизиями не менялись. Это **не** новый прогон тестов publicationRevision.

**Перенесено, а не повторно исполнено:** все E01–E10 и среда исходных тестов. Результаты control E09 (`atExit`/`afterDrain`) и раннего pause-only E10 взяты из хеш-проверенного полного отчёта: отдельный console output не входит в command-only retainedActions. E09-команды и точный код сохранены; новому наблюдению их результат не приписывается. Shell exit codes в таблицах также перенесены; текущая проверка logs подтверждает runner outcomes/durations.

**Новых тестовых запусков — 0.** Старые команды не переигрывались; старые workspace/tmp, integration-dev и живые run не изменялись. Ни providers, ни установок, ни Git commit/checkout/reset. Ниже E01–E10 всегда означают **исторические выполненные проверки**, а не повтор в продолжении. Старая операция не выдаётся за ранее успешный structured output.

### Post-study already-fixed — отдельно от пяти находок

- `86f5e0756e67fa7a18e925d77b7d2728db2f0627`: ранняя проверка изоляции writers уже вызвана из validation (`src/graph.ts:198-200` на **этой post-study ревизии**), общий обход — `src/parallel-isolation.ts:5-30`. Diff профильных tests прочитан, tests не запускались. Повторно внедрять не предлагается.
- `3d8ba65ee84402c0e3b0587f70095b7847824a9f`: привязка reviewer к входному `artifactRevision` документирована (`skills/dynamic-workflows/SKILL.md:110-114`, `skills/dynamic-workflows/references/authoring.md:128-156` на **publicationRevision**). Это версия рецензируемого артефакта, не нового отчёта критика; исправление документации не переоткрывается.

Эти два факта не меняют пять study-source findings и не добавлены к их счётчику. R15-004/R15-005 ниже — исправления, уже существовавшие **на study-source**. Для r15 финальный `artifactRevision` по заданию — `sha256:` окончательного JSON.

## Метаданные и результат

- **ID:** r15. **Дата:** 2026-09-20. **Тема:** тестирование, аварийные окна, порядок событий и достоверность проверок.
- **Исходная ревизия:** `e15bc407da8753fd6b683c0aa4a68634e3c458a7`.
- В исходной операции E01–E10 исходники прочитаны в тогдашнем worktree; из-за отсутствия `node_modules` offline tests шли из разрешённого `integration-dev`. Его HEAD **тогда** совпал, профильный `git diff` был пуст до и после проверок. В продолжении отчёты с provenance записаны только в новый фактический cwd; текущее состояние dev отделено выше.
- Среда проверки: Darwin 25.5.0 arm64, Node **26.8.1**. Минимальная поддерживаемая Node 22.19 здесь **не проверена**.
- Прочитаны AGENTS, architecture/development/known-issues, профильные run-journal/reconciliation/retry-and-failures и текущая история Git. Чужие исследовательские отчёты не читались. Веб не использован.

**Итог:** доказан **один дефект тестового harness**, а не продукта: проверка stdout/stderr сразу по `exit` даёт как ложный отказ, так и ложный успех при допустимом позднем чтении pipe. Новых продуктовых багов выполненные проверки не доказали. Есть одна идея усиления browser coverage и одна неразрешённая причина исторических flakes; два уже исправленных направления подтверждены заново.

В обычных узких запусках Node runner сообщил **121 pass, 0 fail, 0 skipped** суммарно. Это число выполнений проверок, не процент покрытия. Инъекции учитываются отдельно: намеренные падения и один ложноположительный успех — существенная часть результата, а не «всё зелёное».

## Coverage: какие инварианты действительно проверены

| Инвариант | Доказательство, не только название теста | Выполнено и граница |
|---|---|---|
| Намерение → резервация → PID → отправка stdin | `tests/operation-record.test.ts:35-68`: дочерняя команда читает настоящую SQLite через другое соединение; SQL trigger запрещает запись намерения/резервации/PID, файл-маркер не должен появиться. `tests/process-client.test.ts` держит синхронный checkpoint и проверяет отсутствие payload; убивает только собственный fixture-parent. Код: `src/run-runtime.ts:235-242,278-284`, `src/process-client.ts:71-96`. | E02/E03 прошли. Есть проверка **отсутствия внешнего действия**, а не только возвращённой ошибки. Это не испытание power loss диска. |
| Владение, атомарность результата и события | `tests/run-store.test.ts:278-303,380-402,414-438`: старый owner отвергается; SQLite trigger ломает event insert, состояние и выход откатываются; 8 отдельных процессов получают ровно одну резервацию. Код `src/run-store.ts:673-680` сохраняет output/event внутри transaction. | E02 прошёл. Уровень store не доказывает живость ОС сам по себе — это прямо разделено в `PROJECT_INFO/run-journal.md`. |
| Пауза не повторяет уже допущенную работу | `tests/pause-resume-admission.test.ts:27-105` вводит паузу точно между gate и admission, затем resume/cancel/owner-loss; считает вызовы work, gate, admissions и архив. Строка ошибки сама по себе не запускает retry. Код `src/run-runtime.ts:174-214`. | E02 прошёл. Искусственно поставленное окно проверяет переходы детерминированно; это не статистическая проверка всех interleavings. |
| Один terminal result; первый failure не перезаписывается | `tests/execution-failure.test.ts:39-92`: 19 сценариев настоящего IPC с malformed/null/array/duplicate/post-result/error, разбиением кадров, nonzero exit. Проверяются typed code, первая причина, число callbacks и отсутствие сырого диагностического текста. | E02 прошёл. Preload завершает child до SDK/auth; содержимое результата отдельно валидирует worker. Это не live provider. |
| Неопределённый эффект не повторяется обычным resume | `tests/wave5-crash-supervisor.test.ts`: реальный fsync-маркер перед SIGKILL, успешный сосед остаётся `once`, неизвестный эффект не повторяется до явного решения, после разрешения ровно `once\nonce\n`. | E03 прошёл. Проверены journal attempts **и независимые байты файла**. Не обещает exactly-once для внешнего сервиса. |
| `collect` и worktree не дублируют завершённых детей | `tests/wave5-crash-collect.test.ts:100-216`: сохранённая ветвь переживает pause/SIGKILL/resume; проверяются файл, число Git-коммитов, head, неизменность collection record и число commit-admission events; отмена не коммитит parked sibling. | Оба сценария E03 прошли. Это реальные временные Git-репозитории, не подмена `succeeded` вручную. |
| Git frontier восстанавливается без скрытого replay | `tests/fixtures/git-recovery-crash.ts:14-38` убивает supervisor после настоящей Git-команды/в checkpoint. `tests/git-recovery-crash.test.ts:36-68,105-175` сначала проверяет отказ обычного resume, затем реальный Git и детей. | E04: **3 из 10** сценариев — staged worktree, first merge, retry записанного worktree completion. Остальные прочитаны, но не запущены этим исследованием. Полный crash matrix не объявляется пройденным. |
| Routing не проверяет сам себя | `tests/routing-equivalence.test.ts:8-82`: отдельный замороженный алгоритм выбора/trace, 781 последовательность длиной до 4, с посторонними рёбрами и без. `:85-152`: буквальные ожидаемые trace/error и getter-счётчики short circuit. | E05: 4 теста прошли. Общий `evaluate` — явно общая зависимость: это независимость routing oracle, **не** независимая спецификация всего expression evaluator. |
| Skill delivery | Запрет конфигурации без reader на нескольких границах и настоящий SDK read/bash после удаления исходного skill. | E05/E06; подробнее R15-004. Качество применения skill моделью не измерялось. |
| Асинхронное UI-владение и сохранение await editor | Выполняется текущий `app.js`, ответы Promise переставляются, считают POST/reload, проверяют исходные ключи receipt и черновиков. | E05: 21 VM replay прошёл. Native DOM/layout в этот набор не входит; R15-002/R15-005. |

Вывод по meaningful coverage: в исследованных критических наборах нет основания объявлять проверки тавтологией. Сильные оракулы — независимое соединение SQLite, отказ транзакции, внешние маркеры, Git ancestry/commit count, literal expected trace, счётчики callbacks/POST и негативные пары. Но правильный оракул бесполезен, если его читают **до завершения наблюдения**: это и воспроизводит R15-001.

## Находки

### R15-001 — `bug`, дефект тестов, средняя важность: `exit` ошибочно принят за завершение чтения pipes

**Факты текущей ревизии:**

- `tests/pi-worker.test.ts:362-370` ждёт только `child.exit`, сразу разбирает накопленный stdout и требует `['ready','error']`.
- `tests/pi-worker.test.ts:373-382` аналогично ждёт `exit`, затем утверждает отсутствие EPIPE/Unhandled error в накопленном stderr.
- При этом рабочий клиент **уже** различает смерть процесса и осушение каналов: `src/process-client.ts:54-65` ждёт `exit && outDone && errDone`. Комментарий отдельно запрещает полагаться только на `ChildProcess.close`, который может отсутствовать после IPC disconnect.
- Worker закрывает incomplete stdin по disconnect и пишет terminal error с `exitCode=130`: `src/pi-worker-process.ts:9-19,32-42`.

**Триггер:** задержать доставку stdout после `ready` либо stderr до 50 мс после `exit` **в наблюдателе fixture**. Подмена не меняет runtime-файлы. Для негативного stderr-oracle отдельно добавляется заведомо синтетическая строка `Unhandled 'error' event: R15_SYNTHETIC_EPIPE`; это не настоящая ошибка SDK.

**Ожидание:** корректная отмена с полным stdout должна пройти независимо от порядка `exit`/pipe drain; заведомо запрещённая строка stderr должна провалить проверку независимо от задержки чтения.

**Наблюдение (финальная self-contained fixture, E08/E09):**

| Режим | Exit запуска теста | Что доказано |
|---|---:|---|
| `stdout-late`, incomplete stdin/disconnect | **1**, assertion failure на `:369` | Тест видит только `ready` и ложно отвергает корректный worker. Контроль с ожиданием drain: `code=130`, при exit `['ready']`, после drain `['ready','error']`. |
| `stderr-immediate`, синтетическая ошибка без задержки | **1**, assertion failure на `:382` | Негативный oracle действительно умеет заметить внесённый дефект. |
| `stderr-late`, та же ошибка + позднее чтение | **0**, 1/1 pass | Ложноположительный результат: запрещённая строка отсутствует в буфере в момент assertion. Контроль после drain: `markerAtExit=false`, `markerAfterDrain=true`, code 130. |

Это воспроизведение **ошибки барьера теста**, не доказательство естественной частоты такого порядка в ОС. Первичная попытка с одним `pause()` без удержания автоматического `resume()` в этой среде прошла; она не обеспечивала нужное окно. Финальная fixture явно удерживает reader и затем освобождает его. Её код сохранён в парном JSON (`reproductionFixtures`), команды — в приложении ниже.

**Контрдоказательства и границы:** без инъекции incomplete-stdin/disconnect прошёл 1/1 (E07); штатные process-client/IPC тесты прошли (E02); drain-aware контроль получил правильный terminal error. **Не установлена** связь с историческим 10-секундным timeout из known-issues: здесь получен assertion failure примерно через несколько секунд, а не тот timeout. Не обнаружен новый продуктовый дефект отмены, не выполнен модельный запрос.

**Минимальное изменение (не внедрено):** общий небольшой test-only helper settlement: отдельно `exit/error` и `end/close` каждого наблюдаемого pipe; assertions — после всех необходимых сигналов. Listener/barrier установить до действия, способного завершить child. Для destroyed stdout EPIPE-теста ждать оставшийся stderr; на отказе fixture завершать и reap только созданный child. Не заменять всё простым ожиданием `child.close`.

**Риск изменения:** helper, ожидающий только `end`, может зависнуть при destroy; helper, ожидающий только `close` child, возвращает известную IPC-границу. Нельзя терять spawn errors или читать буферы до последнего chunk.

**Приёмка:** `stdout-late` проходит с code 130 и двумя кадрами; оба stderr-режима с marker проваливаются; контроль без marker проходит; сценарий exit без child.close завершается; fixture не оставляет дочерних процессов. Production timeouts/retries/права менять не требуется.

### R15-002 — `idea`: добавить native-browser oracle к уже исправленному await/editor

`tests/graph-view-observation.test.ts:31-93` использует самодельный Element: `selection*`, `scroll*`, `open` — обычные поля, focus вручную меняет `document.activeElement`; отсутствующий `getElementById` создаёт элемент. В тесте `:120-131` трём строкам текста присваивают scroll 70/25 — без layout/overflow и браузерного clamping. Это хороший тест **переноса состояния**, но не доказательство реального caret/scroll/focus в браузере.

Контрдоказательство «браузер вообще не проверяется»: `tests/graph-transition-scope.test.ts:114-189` уже имеет отдельный local Chrome replay с настоящим index.html, native events и приватным profile; его сценарий — переходы графа, а не wait editor. В этом исследовании Chrome не запускался.

**Минимальное изменение:** расширить существующий local-browser подход одним сценарием await: длинное действительно прокручиваемое поле, backward selection, открытый details, соседнее обновление, reorder ожиданий и уход/возврат между run visits. Существующий VM-набор сохранить для детерминированных перестановок Promise.

**Риск:** браузерный старт/окружение добавляет flakes; не привязывать ключевые действия к переводимым заголовкам. **Приёмка:** native `activeElement`, диапазон/направление, измеренные scroll offsets и details принадлежат тому же wait ID; поздний resolve не вызывает новый POST/reload; при отсутствии Chrome виден явный skip. Это усиление доказательства, **не переоткрытие исправленного UI-бага**.

### R15-003 — `unknown`: причина исторических process flakes остаётся неизвестной

`PROJECT_INFO/known-issues.md:69-97` фиксирует timeout disconnect, Git crash/recovery, `Concurrent resume exited null`, CLI handoff и успешный последовательный повтор. Текущий `tests/run-controller.test.ts:445-452` сам посылает SIGKILL через 15 с, а обработчик close печатает только code, без signal; `null` недостаточно для различения причины. Из этого **не следует**, что именно watchdog вызвал исторический сбой.

Наши узкие проверки прошли на той же версии Node, но полный suite, контролируемая нагрузка, Node 22.19 и исходные падающие прогоны **не воспроизведены**. R15-001 объясняет отдельный дефект oracle; подменять им причину всех flakes нельзя.

**Минимальный следующий шаг:** test-only timing trace с monotonic временем для spawn/ready/PID checkpoint/disconnect/exit/pipe-end/close, code+signal, отметкой срабатывания fixture watchdog и snapshot только собственных процессов. Повторить конкретный падающий сценарий на минимальной поддерживаемой Node и на 26.8.1 отдельно от полной нагрузки; сравнить события, а не только итог pass/fail.

**Риск:** сбор всей командной строки/окружения раскрывает лишние данные; синхронное подробное логирование меняет расписание. Сохранять только fixture IDs/PIDs/события/время и короткий безопасный итог. **Приёмка исследования:** отказ воспроизведён, известно последнее достигнутое состояние и источник завершения/зависания; после адресного исправления исходный сценарий и negative control различаются. Простое увеличение timeout или retry теста критерием не является.

### R15-004 — `already-fixed`: skill delivery — не только snapshot на диске

История `2d9f9d2`, текущие `src/catalog.ts:31-35,85-95`, `src/execution-plan.ts:121-126`, `src/pi-worker.ts:107-115` запрещают непустые skills без итогового read/bash до допуска. `tests/skill-delivery.test.ts` проверяет authoring/prepare/rehash/store/start, включая отсутствие model-discovery/workspace admission при ошибке. `tests/pi-worker.test.ts:283-304,385-415` проверяет отказ до resources/runtime и **чтение frozen bytes настоящим SDK read/bash после удаления source directory**, в обоих вариантах имени skill.

E05/E06 прошли. Старое утверждение «skill только развернули на диск, модель его даже не видит» к этой ревизии неприменимо. Из успеха scripted transport не следует, что live-модель качественно применит инструкцию. Рекомендация: сохранить обе стороны теста — запрет недоступного набора и реальный tool round trip; дополнительных изменений delivery не требуется. Риск — заменить round trip проверкой только файлов/списка инструментов; приёмка — обе стороны остаются исполняемыми.

### R15-005 — `already-fixed`: асинхронная панель/control/await и await disclosure/caret/scroll

История `d72df5d`, `b04ef8d`, `1ee48ff`, `fea2136`, текущий `src/graph-view/app.js:165-178,484-507,1162-1173,1450-1482,1515-1579`: есть request/visit guards, сохранение details по wait ID, focus+selectionDirection+scroll и привязка cancel target к посещению. E05 исполнил все 21 тест `graph-view-observation`: stale/current контрасты для snapshot/control/resolve/reconcile/401/body decoding, неизменность черновиков, POST count, receipt под исходным ключом и editor state.

Не переоткрываю исправленные гонки по старому main. Граница native DOM указана отдельно в R15-002. Раскрытие других блоков inspector намеренно остаётся ограничением (`PROJECT_INFO/known-issues.md:64-67`, HEAD `e15bc40`), не вновь найденным регрессом await. Минимальная рекомендация — сохранить current/stale контрасты и не расширять обещание тестов на все details. Риск — тестировать только stale и случайно запретить актуальные действия; приёмка — current 401/reply по-прежнему действует, stale не действует.

## Выполненные эксперименты

Ниже **исторические** команды E01–E10 после `cd "$DEV"`, где тогда `DEV=/Users/ramu/.local/state/dynamicwf-evaluation-20260920/integration-dev`. Этот каталог уже на publicationRevision; ниже он не считается checkout study-source для новых запусков. Для всех repo tests задан `TMPDIR` в уникальном `/tmp/r15-testing-*`; raw logs остались там, в отчёты не включены. Все реальные процессы/Git/БД — только offline fixtures.

| ID | Команда / действие | Итог | Граница |
|---|---|---|---|
| E01 | `pwd; git rev-parse HEAD; git status --short`, чтение документов/кода, `git log`, проверка HEAD и `git diff` fallback | Оба исходника на заданной ревизии, профильный diff пуст | Не аудит всего репозитория; исходники/тесты не менялись |
| E02 | `node --import tsx --test --test-concurrency=1 tests/process-client.test.ts tests/execution-failure.test.ts tests/run-store.test.ts tests/pause-resume-admission.test.ts` | 61/61, ~26.17 с | Реальные процессы/SQLite, синтетические IPC-ответы, не провайдер |
| E03 | `node --import tsx --test --test-concurrency=1 tests/operation-record.test.ts tests/wave5-crash-supervisor.test.ts tests/wave5-crash-collect.test.ts` | 8/8, ~26.20 с | Настоящие SIGKILL, marker и Git только в fixtures |
| E04 | `node --import tsx --test --test-name-pattern="$GIT_PATTERN" tests/git-recovery-crash.test.ts` | 3/3, ~31.53 с | Не весь Git crash matrix |
| E05 | `node --import tsx --test --test-concurrency=1 tests/skill-delivery.test.ts tests/graph-view-observation.test.ts tests/routing-equivalence.test.ts` | 42/42, ~1.42 с: 17 skill, 21 UI, 4 routing | UI — VM adapter; routing делит evaluate с production |
| E06 | `node --import tsx --test --test-name-pattern="$SKILL_PATTERN" tests/pi-worker.test.ts` | 6/6, ~0.90 с | SDK настоящий; ответы модели scripted/in-memory |
| E07 | `node --import tsx --test --test-name-pattern='worker child cancels incomplete stdin on disconnect' tests/pi-worker.test.ts` | 1/1, ~4.24 с | Одна baseline-проверка не доказывает отсутствие flakes |
| E08 | Три режима `r15-pipe-order.cjs`, exact commands ниже | stdout-late: 0/1 pass, exit 1; stderr-immediate: 0/1, exit 1; stderr-late: 1/1, exit 0 | Намеренная fault injection в наблюдателе; не естественная частота отказов |
| E09 | `r15-pipe-control.mjs` в stdout-late и stderr-late | Оба контроля exit 0: worker code 130; после drain получены соответственно error frame и synthetic marker | Устанавливает, что байты не потеряны worker; они проверялись слишком рано |
| E10 | Предварительные эквивалентные раздельные preloads и первичный pause-only probe | Раздельные сильные preloads дали те же pass/fail; один pause-only не воспроизвёл окно (pass) | Исследовательская настройка инъекции; финальные fixtures E08/E09 повторно проверены отдельно |

Точные значения двух pattern-переменных таблицы (без markdown-экранирования):

```bash
GIT_PATTERN='real worktree-staged|real merge-first|explicit retry of a recorded worktree'
SKILL_PATTERN='frozen skill from|inaccessible frozen skills'
```

Не выполнены: полный `npm test`, typecheck (исходники не менялись), live provider/model, native-browser QA, нагрузочная статистика, Node 22.19, power-loss/power-cut. Чтение `retry-worker`, `provider-retry`, `allocation-recovery`, `process-groups`, `dashboard` и browser fixture — статическая оценка, не заявление об их прохождении.

## Воспроизведение R15-001 без изменения репозитория

Парный JSON содержит **точные исполненные в исходной операции** fixture-файлы; это короткий код, не сырые логи. Из корня worktree с отчётами; это инструкция для отдельной offline проверки, **в продолжении не запускалась**. `DEV` нужно явно задать на существующий checkout study-source с установленными зависимостями; текущий publication dev автоматически не используется:

```bash
REPORT="$PWD/research/2026-09-20-astra-max/r15-testing-fault-injection.json"
: "${DEV:?Укажите существующий checkout study-source с node_modules}"
[ "$(git -C "$DEV" rev-parse HEAD)" = e15bc407da8753fd6b683c0aa4a68634e3c458a7 ] || exit 1
git -C "$DEV" diff --quiet HEAD -- src tests package.json package-lock.json || exit 1
[ -d "$DEV/node_modules" ] || exit 1
P=$(mktemp -d /tmp/r15-repro-XXXXXX)
python3 - "$REPORT" "$P" <<'PY'
import json, pathlib, sys
report = json.loads(pathlib.Path(sys.argv[1]).read_text())
for fixture in report['reproductionFixtures']:
    assert pathlib.Path(fixture['name']).name == fixture['name']
    (pathlib.Path(sys.argv[2]) / fixture['name']).write_text(fixture['content'])
PY
cd "$DEV"
git rev-parse HEAD  # точная база уже проверена до создания новых fixtures

# Намеренные exit 1 здесь — доказательство, а не ошибка команды воспроизведения.
for mode in stdout-late stderr-immediate stderr-late; do
  if [ "$mode" = stdout-late ]; then
    pat='worker child cancels incomplete stdin on disconnect'
  else
    pat='a closed supervisor output pipe'
  fi
  TMPDIR="$P" R15_FAULT="$mode" NODE_OPTIONS="--require=$P/r15-pipe-order.cjs" \
    node --import tsx --test --test-name-pattern="$pat" tests/pi-worker.test.ts \
    > "$P/$mode.log" 2>&1
  echo "$mode test-exit=$?"
done
# Ожидается 1, 1, 0: последний успех — ошибочный oracle.

R15_FAULT=stdout-late NODE_OPTIONS="--require=$P/r15-pipe-order.cjs" \
  node "$P/r15-pipe-control.mjs" "$DEV"
R15_FAULT=stderr-late NODE_OPTIONS="--require=$P/r15-pipe-order.cjs" \
  node "$P/r15-pipe-control.mjs" "$DEV" closed-output
```

Контроли должны сообщить `code:130`; первый — `atExit.types:['ready']`, `afterDrain.types:['ready','error']`; второй — `atExit.marker:false`, `afterDrain.marker:true`. Инъекция не отправляет request в stdin, не вызывает модель и не читает пользовательские данные. Никаких новых production timeouts/retries/approvals не предлагается; 50 мс — только доставка fixture pipe после события, 10 с в control — явная уборка собственного child при сбое эксперимента.

## Refutations и неразрешённые вопросы

- **«Все crash-тесты рисуют failed в БД».** Опровергнуто для E03/E04: SIGKILL в реальном процессе после эффекта, затем внешние marker/Git-oracles. В других unit fixtures искусственная контрольная точка уместна, но не равнозначна crash test.
- **«Количество тестов доказывает полноту».** Нет: 781 routing cases делят evaluator; 21 UI case использует адаптер; 3 Git cases не заменяют остальные 7. Репозиторий содержит 98 `tests/*.test.ts` и 3 `spikes/*.test.ts`; их число не оценка покрытия инвариантов.
- **«Успешный isolated run исправил flaky suite».** Нет; R15-003 остаётся unknown. Расписание нагрузки и источник исторических сигналов не измерены.
- **«Доказан продуктовый EPIPE/потеря terminal error».** Нет: stderr marker намеренно синтетический, drain-aware контроль получает полный stdout. Дефект относится к моменту assertions теста.
- **«Skill/UI проблемы из старого main всё ещё открыты».** Нет, R15-004/R15-005 проверены на заданном HEAD. Новая идея native-browser oracle не отменяет этих исправлений.
- Не установлены естественная частота R15-001, воспроизводимость на Node 22.19/Linux, переносимость на будущий SDK, качество суждений реальной модели. Это не blockers выполненного локального исследования.

## Инспектированные источники

Основные прямые ссылки — `file:line` выше и в JSON. Все study-source ссылки относятся к заданной ревизии; только отдельно помеченные post-study ссылки относятся к своим commit IDs.

1. `AGENTS.md`; `PROJECT_INFO/architecture.md`, `development.md`, `known-issues.md`, `run-journal.md`, `reconciliation.md`, `retry-and-failures.md`; `package.json`.
2. `src/process-client.ts`, `pi-worker-process.ts`, `check-worker-process.ts`, `run-runtime.ts`, выбранные методы `run-store.ts`; guards `catalog.ts`, `execution-plan.ts`, `pi-worker.ts`; выбранные функции `graph-view/app.js`.
3. Исполненные tests перечислены E02–E07; Git preload `tests/fixtures/git-recovery-crash.ts` также прочитан.
4. Для контрдоказательств/границ прочитаны `tests/graph-transition-scope.test.ts`, `dashboard.test.ts`, `sqlite.test.ts`, `allocation-recovery.test.ts`, `process-groups.test.ts`, `retry-worker.test.ts`, `provider-retry.test.ts`; участок concurrent resume `tests/run-controller.test.ts:421-470` и assertions retry-reconciliation.
5. Локальная история Git: HEAD `e15bc40`, изменения `fea2136`, `24f957f`, `d72df5d`, `b04ef8d`, `2d9f9d2`, `1ee48ff`, `10d5cc6`. История использована для проверки актуальности, не как замена коду/эксперименту.

6. Продолжение: собственные retained MD/JSON и `r15-actions.json`; девять старых offline logs и два fixture-файла — только read-only сверка. Полные provenance/hash summaries в JSON, сырые logs не публикуются.
7. Post-study источники отдельно: `86f5e07`, `3d8ba65`; только инспекция соответствующих Git-объектов, без переноса test-pass на новую базу.

Рекомендации не реализованы. В новой операции записаны только два назначенных отчёта в новый cwd. Старый workspace и integration-dev не менялись; коммитов/установок/изменений runtime не выполнялось.
