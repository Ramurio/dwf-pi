# r12 — Наблюдаемость usage и lineage

## Metadata

- **ID:** r12. **Тема:** Наблюдаемость usage и lineage.
- **Дата исследования и продолжения:** 2026-09-20 (UTC). Продолжение сверено после 13:05 UTC.
- **Source revision:** `e15bc407da8753fd6b683c0aa4a68634e3c458a7` — независимо проверена в новом worktree. Первоначальные проверки относились к тому же базису. **Publication revision:** `3d8ba65ee84402c0e3b0587f70095b7847824a9f`; это не подмена исследуемого исходника.
- **Фактический cwd:** `/Users/ramu/.dynamicwf/runs/run-9dbb044c-664f-4dd8-96c0-57192dc4ed89/worktrees/3b11a6a47c97b1cc15eb29d7130232de1f7942cba4e5984c44d1c7558b61c9c9`.
- **Среда проверок:** Node `v26.8.1`, закреплённый pi SDK `0.85.1`. В worktree нет `node_modules`. Первоначальные tests/fixtures исполнялись из разрешённого dev на исходной ревизии; сейчас dev находится на publication revision. Для независимой перепроверки использован новый `/tmp/r12-cont.IkejEZ/source`: экспорт `src`, `package.json`, lockfile из **e15bc40**, побайтно сверенные 67 файлов, со ссылкой на существующие зависимости dev. Ничего не устанавливалось, исходники worktree/dev не менялись.
- **Метод:** чтение текущего кода и документов, профильные offline tests, собственные временные SQLite/SDK/DOM fixtures. Без реальных провайдеров, пользовательских run/БД/credentials, установки пакетов, веб-исследования и чтения чужих исследовательских отчётов.

## Краткий вывод

**Два воспроизведённых дефекта, не дефекты биллинга:**

1. **R12-B01:** успешный OpenAI-compatible SSE-ответ **без блока usage** превращается в «полный нулевой отчёт». Проверено через настоящий закреплённый SDK, подставной HTTP-транспорт, RunStore и проекции. Это другой случай, чем уже исправленные нулевые placeholders при error/abort.
2. **R12-B02:** после второй попытки браузер подписывает отчёт первой одновременно «попытка 2» и «попытка 1»: к сохранённому номеру отчёта добавляется путь **текущей** активации.

Основной журнал работает существенно лучше этих двух пограничных представлений: отдельный учёт попыток, накопительные суммы, sticky-неполнота legacy, исключение `reuse`/контейнеров, происхождение через несколько продолжений, сохранённые routing decisions и типизированные ошибки подтверждены профильными тестами. В первоначальном исследовании выполнено **196/196 выбранных тестов**, без failures/skips в этих запусках, плюс две собственные fixtures. В продолжении прочитаны и сверены сохранённые логи этих tests, **tests повторно не запускались**; обе fixtures независимо выполнены в новых временных каталогах на экспорте e15bc40. Это не полный `npm test` и не проверка live-провайдера.

## Continuation provenance: что перенесено и что проверено заново

- Источник: собственная операция r12 в `run-babf9b25-b8f5-45ad-b79c-2b2e5d31d2f0`; она закончилась **failed**, не успешной сдачей. Сохранённая ошибка: `provider/execution`, `effects:unknown`, `dispatch:http-observed`, HTTP 200, «Pi assistant turn failed: terminated». Эти данные не объясняют первопричину и не разрешают повторять прежнего writer.
- До переноса проверен старый Markdown: **44 103 bytes**, SHA256 `e6ed845eb74a15cdefd2980a034197f812ffa5cc4a9d848fc3168643dcf9bab6`, точно совпадает с retainedEvidence. **Старого JSON нет**; он создаётся впервые здесь. Старый worktree и старые `/tmp` только читались.
- Файл `retained/r12-actions.json` из `preservedActionEvidence` прочитан: 33 собственных команды, SHA256 `92abb273100b78ba634daca1a3e9b7953bc257494ff348707d204eca035b42d5`. Это история команд, **не их stdout и не свидетельство успешного завершения каждой команды**. Поэтому результаты tests сверены дополнительно по сохранившимся собственным логам, а два reproducer выполнены заново.
- Перенесены: ID и классификация R12-B01/B02, I01, AF01/AF02, U01–U03; команды/исходы E01–E07; полные fixtures в приложении. Обе fixtures побайтно совпали с собственными старыми `/tmp/r12-usage-lineage.g0edSf/*.mts`.
- Перепроверены: обязательные документы и профильная история, причины B01/B02 и приведённые текущие file:line, ledger/attempt/ancestor/trace/operation/ошибочные исходы; закреплённый SDK parser. Новая проверка **R12-C02** воспроизвела B01 во всех трёх вариантах и B02 с суммами 8/12/20. Assertions прошли, оба процесса завершились с кодом 0.
- Добавлены: этот provenance, машинный JSON, manifest сохранённых результатов, независимые R12-C01–C03, безопасная команда воспроизведения именно **sourceRevision**, отдельный post-study контекст. Новых продуктовых bug-гипотез не добавлено; ни провайдеры, ни пользовательские процессы/run не вызывались.

### R12-C01 — проверка сохранённого evidence (read-only)

Выполнены `sha256sum` старого Markdown и actions; Python сравнил fixtures, прочитал пять собственных логов и проверил их итоговые счётчики. Сумма: 129 + 44 + 13 + 9 + 1 = **196**; `fail`, `cancelled`, `skipped` = 0. Логи не переносятся в Git.

| Старый лог в `/tmp/r12-usage-lineage.g0edSf` | SHA256 | Tests/pass |
|---|---|---:|
| `tests-core.log` | `038a52bbbdb52128b307fde95bc95741218a055a1c39af65967fe7bf0bdec761` | 129 |
| `tests-lineage.log` | `410ba7ddb0e4dced7affba28f55c1c8cb96da34291ba407c8162e549df97de65` | 44 |
| `tests-sdk-accounting.log` | `00b28ec6297219ac5a97e57f2d2ea492e05e93c730f616c41cc6c66559144751` | 13 |
| `tests-transport.log` | `22151cbef72a2bdaa4e6a00ad846bcf5200c2ee4f073dbbd6dc3ed0e4d4c53d1` | 9 |
| `tests-ui-accounting.log` | `d9a598ceaf1a3fcaffe9609d87b53c44d3975702b74ab71d5d41b8add7acfbba` | 1 |

Команда повторной проверки только этих собственных файлов: `sha256sum /tmp/r12-usage-lineage.g0edSf/tests-{core,lineage,sdk-accounting,transport,ui-accounting}.log`; хвост каждого прочитан через `tail -12`. Наличие старого лога не означает исполнения теста в новой операции.

### R12-C02 — независимое воспроизведение в новом временном окружении

Из приложения извлечены fixtures; `git archive e15bc407da8753fd6b683c0aa4a68634e3c458a7 src package.json package-lock.json` экспортирован в новый `/tmp/r12-cont.IkejEZ/source`, `node_modules` ссылается на существующий dev. После побайтовой сверки экспорта выполнено последовательно:

```sh
(cd /tmp/r12-cont.IkejEZ/source && node --import tsx /tmp/r12-cont.IkejEZ/missing-usage.mts)
(cd /tmp/r12-cont.IkejEZ/source && node --import tsx /tmp/r12-cont.IkejEZ/attempt-label.mts)
```

Результаты совпали с таблицей B01 и строками B02. SHA256 fixtures: `missing-usage.mts` — `87d5555696e99c982641cef8a1dd3d64ca44885c6475789638f6cc7cff1cf4e9`; `attempt-label.mts` — `63e5f4e392d9d03daf2b53a7e8fe9993a30aa2df3fe208f8bea77ebc52eb47c0`. Граница: mock HTTP, настоящий SDK parser/SQLite/проекции, минимальный DOM без браузерного network startup. Финансовых измерений нет. Проверено, что `R12_DEV` в среде новой операции не задан: fixture действительно выбирала `cwd` экспортированного базиса.

### R12-C03 — source/publication и ссылки

Выполнены `git rev-parse HEAD`, чтение текущих `nl -ba` диапазонов и `git -C "$DEV" log/show/diff` с явными путями исходников/документов. Diff e15bc40→3d8ba65 пуст для `src/pi-worker.ts`, `usage.ts`, `run-store.ts`, `lineage.ts`, `run-controller.ts`, `monitor.ts`, `graph-view/app.js`, `graph-view/model.ts`, `operation-record.ts`, `observation.ts`, `service.ts`. Это подтверждает отсутствие исправления конкретных причин B01/B02 в этом диапазоне, **не** выполнение всей новой версии и **не** чтение соседних отчётов. Изменения authoring/reviewer docs вынесены ниже отдельно. Финальная сверка ссылок обнаружила в старом тексте выход диапазона `run-journal.md:179–239` за конец файла (233 строки); здесь он исправлен на `179–233`. Уточнена ссылка на monitor history: `77–84` включает сам вызов usage. Это правка ссылок исследования, не новый bug Dynamicwf.

## Coverage: что именно исследовано

| Область | Прочитано и проверено | Граница |
|---|---|---|
| Источник usage | `src/pi-worker.ts:100–105,219–280,311–352`; SDK `dist/api/openai-completions.js:171–184,378–387,494–504` | Настоящий SDK с HTTP/stream fixtures; фактический расход аккаунта неизвестен |
| Журнал и attempts | `src/run-store.ts:459–499,595–615,889–989`; `src/service.ts:178–204,352–359` | Настоящая временная SQLite, транзакции, архив, API/HTTP в tests |
| Накопление/legacy/task | `src/usage.ts:55–129`; `src/run-store.ts:928–989`; `tests/legacy-usage.test.ts`, `tests/task-usage.test.ts` | Не считать одновременно отчёты, архив и накопительный subtotal |
| Operation metadata | `src/operation-record.ts:11–31`; `src/run-runtime.ts:235–258,277–284`; `src/run-store.ts:478–524` | Намерение/прогресс не доказывают внешние эффекты |
| Continuation/ancestor provenance | `src/lineage.ts:279–381`; `src/run-controller.ts:166–191,356–465`; `src/run-store.ts:997–1130` | Проверены fixture-цепочки, digest/schema/producer и запрет graft; не проверялся живой рабочий каталог пользователя |
| Trace и смысл исходов | `src/run-store.ts:617–661`; `src/observation.ts:49–76`; `tests/routing-trace.test.ts` | Решение ребра не доказывает старт цели; `succeeded` не означает `accepted` |
| Браузер/monitor | `src/graph-view/model.ts:78–102`; `src/graph-view/app.js:190–234,1098–1122,1319–1446`; `src/monitor.ts:38–80,197–233` | Исполнены проекции/DOM fixture, не ручная браузерная проверка всей панели |
| Actionable errors | `src/pi-worker.ts:291–308,354–357`; `src/graph-view/app.js:759–769`; `src/terminal.ts:58–65`; `tests/provider-response.test.ts` | Подтверждены тип/HTTP/Retry-After и отсутствие сырого приватного тела; не угадываются квоты/причины из текста |

Сначала прочитаны `AGENTS.md`, `PROJECT_INFO/architecture.md`, `development.md`, `known-issues.md`, затем `observation.md`, `run-journal.md`, `retry-and-failures.md`, skill references `continuation.md`/`usage.md`; проверены `git log -12 --oneline` и профильная история. В частности, HEAD уже содержит исправления skill delivery и scoped dashboard effects, а также `fea2136`/`e15bc40` о раскрытии/позиции редактора await. Эти темы здесь не переоткрываются и не выдаются за отдельно перепроверенные live-сценарии.

### Единицы учёта и доказательства

- **Ответ:** `(runId, activationKey, attempt, reportId)`. Число `responses` — число числовых отчётов SDK, а не число агентов. `reported` в сводке — число agent-активаций с subtotal; подпись «отчётов 1/1» в monitor не означает один сетевой запрос.
- **Попытка:** `run.attempts.accounting` берётся только из ledger точной попытки; `current` не является неизменным архивом. `visit` — отдельное посещение, не retry.
- **Активация:** `metadata.usage` — накопительная сумма по попыткам этой активации, включая доказанную legacy-базу. Её нельзя приписывать только последней попытке.
- **Запуск:** техническое исполнение одного frozen plan. Task outcome в его presentation — результат этого запуска. Ошибка маршрутизации может оставить исходный узел `succeeded`, но запуск `failed`.
- **Задача lineage:** набор явно связанных запусков, а не дополнительный исполнитель. `task.usage` суммирует их agent-активации; `reuse` возвращает сохранённый результат и сохраняет оригинального производителя, не добавляя usage. Причины/evidence автора continuation — attestations; digest/checkpoint/identities — проверяемые машиной факты (`src/service.ts:284–305`).
- **Стоимость:** `cost` — оценка SDK. Число 0 в агрегатном поле без `costReported` не есть доказанный нулевой расход. `subscriptionInvoice:false`, `unknownCostIsZero:false` заданы явно (`src/usage.ts:121–124`). Счёт/списание подписки не измерялись.

## Findings

### R12-B01 — bug — Успех без provider usage становится полным нулём

**Важность:** средняя, высокая для достоверности измерений. Не утверждается денежный ущерб или частота в production.

**Триггер.** Native `openai-completions` в закреплённом SDK получает успешный SSE: корректный `submit_result`, `finish_reason:"tool_calls"`, `[DONE]`, но **ни в одном chunk/choice нет usage**. Такой поток принимает настоящий SDK. Сеть подменена только через разрешённый test seam `providerFetch`; сама SDK-сессия/парсер/события не подменены.

**Ожидание.** Успешность результата не доказывает известный расход. Без usage должен оставаться неизвестный/неполный учёт; нельзя выпускать доказанный нулевой числовой отчёт. При явно переданном provider zero нужно, наоборот, сохранить известный ноль.

**Наблюдение.** Три варианта одной fixture:

| Данные в HTTP fixture | Запросов | Отчётов в ledger | `usage.settled.complete` | `totalTokens` | `partial` |
|---|---:|---:|---|---:|---|
| usage полностью отсутствует | 1 | 1 | true | 0 | false |
| usage явно `{prompt_tokens:0,completion_tokens:0,total_tokens:0}` | 1 | 1 | true | 0 | false |
| usage явно 10 + 3 = 13 | 1 | 1 | true | 13 | false |

У отсутствующего usage также `costReported=1`. `tokenSummary` печатает **«Токены: 0 · отчётов: 1/1»**; `graphSnapshot.usage` содержит `totalTokens:0, partial:false`. Результат `{answer:42}` успешен во всех трёх случаях.

**Причина на исследуемой ревизии:**

1. SDK инициализирует `output.usage` нулями до чтения SSE: `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:171–184`. Заменяет его только при `chunk.usage`/`choice.usage` (`378–387`), а завершение по `finish_reason` не требует usage (`494–504`). Это локально осмотренный код установленной зависимости **0.85.1**, закреплённой в `package.json`/lockfile, не веб-источник.
2. **`src/pi-worker.ts:100–105`**: `hasProviderReportedUsage` немедленно возвращает true для stopReason, отличного от `error`/`aborted`. В нашем случае это `toolUse`.
3. **`src/pi-worker.ts:274–281`** нормализует этот SDK placeholder в обычный `usage.report`. **`342–344`** объявляет учёт полным по числу reports/turns и stopReason, без признака получения provider usage.
4. `src/run-store.ts:898–915,929–959` корректно сохраняет поступивший отчёт. `src/usage.ts:83–97` уже не может отличить placeholder от настоящего zero. Следовательно, причина **до** проекций, а не повтор старого UI-багa «отсутствующий record рисовался нулём».

**Воспроизведение:** fixture `missing-usage.mts` в приложении; после экспорта sourceRevision в новый `$PROBE/source`: `(cd "$PROBE/source" && R12_DEV="$PROBE/source" node --import tsx "$PROBE/missing-usage.mts")`. Полная команда извлечения/запуска ниже делает путь воспроизводимым без изменения репозитория. Assertions фиксируют текущее ошибочное поведение и контрольные positive/zero варианты.

**Контрдоказательства и границы:**

- `tests/wave5-c08.test.ts:98–151` уже защищает zero placeholders при error/abort и сохраняет известные положительные токены/настоящий zero. Набор выполнен и прошёл. Наш успешный поток не попадает в эту защиту.
- `tests/usage-contract.test.ts`, `tests/monitor.test.ts`, browser test о missing/zero/partial прошли: когда вход уже правильно помечен отсутствующим, агрегатор/интерфейс неизвестность сохраняют.
- Не доказано, что конкретный live OpenAI/xAI/Codex сегодня присылает такой поток. Доказана обработка **реальным поддерживаемым transport parser** воспроизводимого успешного ответа без telemetry. Native xAI в этой fixture не исполнялся.

**Минимальное рекомендуемое изменение (не внедрено).** На границе SDK сохранить отдельный признак наличия provider usage для каждого ответа и передать его в worker accounting; при доказанном отсутствии выпускать `usage.unavailable`, оставляя результат задания независимым. Если текущий публичный SDK event теряет этот признак, сначала нужен узкий совместимый upstream/версионированный adapter-contract; одного изменения UI недостаточно. **Не отбрасывать все zero**: это сломает контрольный настоящий ноль. Не перечитывать приватные transcript/logs для «восстановления» расхода.

**Риск:** средний — семантика различается по API; нельзя получить полноту из наличия HTTP 200, defaults SDK или арифметики токенов.

**Приёмка:** те же три native-parser fixtures дают missing → `reported=0, partial=true`, explicit-zero → полный 0, positive → полный 13; при цепочке positive + missing сохраняется известный subtotal с `partial=true`. Error/abort regressions остаются зелёными; result success и usage completeness не склеиваются. Матрица остальных реально поддержанных transports — отдельная проверка, не обещанный результат этого исследования.

### R12-B02 — bug — Отчёт старой попытки подписан номером текущей

**Важность:** низкая; ложная атрибуция в представлении, не порча ledger.

**Триггер.** У одной agent-активации попытка 1 завершилась ошибкой с 8 токенами; попытка 2 завершилась успешно с 12. Открыть числовые отчёты на вкладке «Токены» после второй попытки.

**Ожидание:** строка report attempt=1 имеет ровно один номер попытки — 1. Путь scope/node/visit общий, но текущая попытка активации не должна подменять происхождение старого отчёта.

**Наблюдение настоящего `renderTokens` в offline DOM fixture:**

```text
work · проход 1 · попытка 2 · r12-run · попытка 1 · ответ 1
work · проход 1 · попытка 2 · r12-run · попытка 2 · ответ 1
```

**Причина:** `src/monitor.ts:38–50` добавляет текущий `a.attempt` в `activationPath`; `src/graph-view/model.ts:82–86` помещает путь в snapshot. **`src/graph-view/app.js:1383–1387`** находит активацию только по run/key, использует её current path и затем дописывает сохранённый `report.attempt`. Поэтому архивные отчёты наследуют чужую попытку. Та же конструкция используется и для run-, и для task-scope ledger.

**Воспроизведение:** `attempt-label.mts` в приложении; после подготовки нового экспорта: `(cd "$PROBE/source" && R12_DEV="$PROBE/source" node --import tsx "$PROBE/attempt-label.mts")`. Настоящие RunStore/graphSnapshot и production browser functions; выключен только автоматический network startup. DOM — минимальная fixture по образцу существующего `graph-view-observation.test.ts`, не headless Chrome.

**Контрдоказательства:** архивная сумма = 8, текущая = 12, накопительная = 20. `run.attempts`/`usageReports` содержат правильные attempt IDs. `reportOrigin` и task-scope tests правильно открывают producer run/key, не одноимённый узел continuation. Исправлять идентичности или повторно суммировать ledger не требуется.

Смежное наблюдение, **не отдельный доказанный арифметический баг**: monitor history показывает `✓ 20 ток. work · проход 1 · попытка 2`, хотя 20 — накопление двух попыток. `src/monitor.ts:77–84,225–228` использует activation subtotal, не attempt accounting. Раздел называется «По агентам и проходам», поэтому накопление допустимо, но подпись «сумма попыток» сделала бы смысл явным.

**Минимальное изменение (не внедрено):** отделить путь активации без attempt от подписи current attempt; в строке report брать попытку только из отчёта. Для накопительной суммы явно подписывать её основу. Не удалять attempt из всей панели и не переписывать историю.

**Риск:** низкий — изменение представления; следить за scope/visit и ссылками на producer.

**Приёмка:** fixture печатает для первого отчёта только attempt 1 и для второго только attempt 2; run/task режимы сохраняют producer navigation; суммы 8/12/20 и API не меняются.

### R12-I01 — idea — Указывать источник `observedEffort`

**Факт кода:** `src/pi-worker.ts:238–243` для native xAI наблюдает отправленное `reasoning.effort`. В `278–280` одно поле `observedEffort` выбирает `message.providerThinkingLevel`, иначе `lastObservation.sentReasoning`, иначе `unknown`. `src/run-store.ts:905–915,967–972` сохраняет только строку, а `src/graph-view/app.js:1387` показывает одинаковое `reasoning …`.

Это не подтверждение того, какой объём рассуждений реально выполнил провайдер. Осмотренный `tests/repair-core.test.ts:115–129` проверяет payload `xhigh` и такой же отчёт; этот набор здесь **не запускался** и сам по себе не мог бы доказать server-side effort. Уже есть хорошее различие configured thinking / sentReasoning в диагностике (`src/request-observation.ts`, `app.js:767–768`), но в usage строке источник теряется.

**Предложение:** добавить необязательный provenance discriminator для effort: `sdk-message` / `request-payload` / `unknown`; UI пишет «отправлено» либо «сообщено SDK», не «реально выполнено». Старые записи без происхождения остаются без такой гарантии. Не менять выбор модели/уровня и не добавлять budgets/retries.

**Риск:** низкий/средний — совместимость формата event/отчёта, особенно старых записей. **Приёмка:** два одинаковых текста effort с разными источниками различимы в report/API/UI; requested-only настройка не выдаётся за наблюдение; тесты используют подставной транспорт и не называются live-доказательством.

### R12-AF01 — already-fixed — Ledger, legacy и различение partial/zero после корректного входа

Подтверждено кодом и выполненными regressions:

- Idempotent duplicate report не добавляет токены; конфликтующий ID отвергается. Запись, aggregate и event откатываются вместе (`run-store.ts:898–915`, профильные `run-store` tests).
- Каждая attempt имеет свой ledger; activation subtotal копить допустимо, **прибавлять archive ещё раз нельзя** (`595–615`, `929–959`, `attempt-history` tests).
- Legacy-baseline выбирается из последнего пригодного immutable pre-ledger archive, не складывается из всех исторических subtotal. Пересечение/неизвестное происхождение не создаёт вымышленную полноту: `usageLegacyIncomplete` sticky, сохраняется после accept (`928–959`, `tests/legacy-usage.test.ts`).
- `partialFields` независимы; reasoning не прибавляется второй раз; `reuse`, `check`, worktree/parallel/map/subworkflow не учитываются как agent повторно (`usage.ts:55–124`, `usage-contract`).
- Missing/invalid report в monitor и браузере не заменяется zero, настоящий отчёт 0 сохраняется (`monitor` tests; выбранный `graph-view-observation` test).

**Вывод:** R12-B01 не отменяет эти исправления: они получают уже потерявший provenance вход. Нового изменения перечисленных механизмов не рекомендуется; сохранить перечисленные acceptance regressions.

### R12-AF02 — already-fixed — Ancestor provenance, trace и причины остановки не выводятся из цвета/успеха

- Цепочка reuse сохраняет оригинального producer через промежуточный reuse; `sourceSchemaDigest` не подменяется producer schema (`lineage.ts:308–381`, `run-controller.ts:166–191`). `continuePrepared` ограничивает источники множеством предков (`442–451`). Выполнены `lineage`, `continuation`, `graph-view-task-scope`: проверены цепочки, graft/cycle/stale rejection, точная redelivery, сохранение исходного сбоя, producer navigation.
- Operation metadata архивируется перед новой попыткой; старые session/worker/model/operation observations очищаются, а контрольные точки восстановления сохраняются (`run-store.ts:475–499`). `parseOperation` прямо отделяет intent/progress от proof (`operation-record.ts:24`). Наличие намерения не разрешает retry неопределённого writer.
- `run.trace` хранит собственные решения с attempt/scope/visit; source может succeed, а route fail. При восстановлении успешное действие не повторяется. Старый v2 возвращает unsupported, не выдуманные переходы (`run-store.ts:617–661`, все `routing-trace` tests).
- `succeeded`/accepted различаются в `projectRun`; ошибку провайдера нельзя превратить в approve. Типизированные failure + доступные HTTP/Retry-After переживают runtime→API→браузер→terminal; сырое приватное тело не публикуется. Выполнен `provider-response`; HTTP 200 сам по себе не доказательство успешного задания.

**Рекомендация:** сохранить эти инварианты и существующие regressions. R12-B02 — дефект подписи, не отмена правильной identity/provenance в журнале.

## Post-study already-fixed — отдельно от findings базиса

- **R12-PS-AF01 / already-fixed, publication context:** `86f5e0756e67fa7a18e925d77b7d2728db2f0627` переносит parallel writer isolation в раннюю `validateWorkflow`; прочитан diff `src/graph.ts` (импорт и вызов `parallelWriterIsolationIssues`) и перечень профильных regressions. Не предлагается внедрять повторно. Новые authoring tests в r12 не запускались.
- **R12-PS-AF02 / already-fixed, publication context:** `3d8ba65ee84402c0e3b0587f70095b7847824a9f` документирует верхнеуровневый `input.artifactRevision` для reviewer с соответствующей required output schema и точное копирование версии рецензируемого артефакта, не версии нового отчёта. Прочитан diff `skills/dynamic-workflows/SKILL.md` и `references/authoring.md`. Это исправление документации после study-source, не новый runtime bug и не новая реализация binding.

Эти два пункта — контекст публикации, не дополнительные findings на e15bc40. В JSON `findings` содержит **8** записей базиса (2 bug, 1 idea, 2 already-fixed/refutation, 3 unknown); post-study записи отдельны. Сохранение уже исправленных skill delivery, scoped dashboard/control/await и wait disclosure/caret/scroll также не требует повторного внедрения.

## Experiments — реально выполнено в исходной операции

E01–E07 ниже — исторические действия, восстановленные из собственной ветви; в продолжении реально выполнены C01–C03 выше. Все команды tests выполнялись из `/Users/ramu/.local/state/dynamicwf-evaluation-20260920/integration-dev` с `TMPDIR=/tmp/r12-usage-lineage.g0edSf`, `--test-concurrency=1`. Логи остались только во временном каталоге и не включены в отчёты. Старые пути — provenance, не разрешение повторно писать туда: для повторения нужен новый `/tmp/r12-*`.

| ID | Команда (для E01–E05 после `node --import tsx --test --test-concurrency=1`) | Исход |
|---|---|---|
| R12-E01 | `tests/usage-boundary.test.ts tests/usage-contract.test.ts tests/usage-pages.test.ts tests/monitor.test.ts tests/legacy-usage.test.ts tests/lineage.test.ts` | 129/129, 0 skipped; 2.67 s. Legacy test импортирует дополнительную accept-regression |
| R12-E02 | `tests/attempt-history.test.ts tests/task-usage.test.ts tests/continuation.test.ts tests/graph-view-task-scope.test.ts tests/routing-trace.test.ts` | 44/44, 0 skipped; 124.03 s. Только собственные fixture-процессы/БД/Git; включая crash/recovery, не live run |
| R12-E03 | `--test-name-pattern='usage\|accounting\|response\|continued\|repair preserves\|cancelling an active repair\|unknown final\|SDK provider failure' tests/pi-worker.test.ts tests/run-store.test.ts` | 13 выбранных tests / 13 pass; 1.63 s. Невыбранные cases не считаются выполненными |
| R12-E04 | `tests/wave5-c08.test.ts tests/provider-response.test.ts` | 9/9, 0 skipped; 4.51 s. Native SDK с fixture HTTP/SSE, не аккаунты |
| R12-E05 | `--test-name-pattern='run navigation distinguishes' tests/graph-view-observation.test.ts` | 1/1; 0.50 s. Только missing/zero/partial navigation case |
| R12-E06 | `node --import tsx /tmp/r12-usage-lineage.g0edSf/missing-usage.mts` | R12-B01 + explicit-zero/positive controls; 3 SDK fixture вызова, каждый ровно 1 HTTP fixture request |
| R12-E07 | `node --import tsx /tmp/r12-usage-lineage.g0edSf/attempt-label.mts` | R12-B02; реальные 8/12/20 в RunStore и противоречивая подпись production renderer |

По сохранённому Markdown, при первой попытке E06 импорт SDK через CommonJS `require.resolve` остановился на `ERR_PACKAGE_PATH_NOT_EXPORTED` **до работы fixture**. Temporary script исправлен на import опубликованного `dist/index.js`; затем E06 выполнен успешно. Эта первая ошибка в продолжении не повторялась; это scaffolding исследования, не Dynamicwf finding. Никаких изменений `node_modules` не делалось.

Не выполнялись ни первоначально, ни в продолжении: полный `npm test`, typecheck (исходники не менялись), live probes, модельные CLI/subagents, ручная проверка Chrome, финансовая сверка, доступ к живому журналу. Внешних публичных источников через web/curl не использовано.

## Unknowns и предложенные проверки

- **R12-U01 / unknown:** встречаемость успешного missing-usage SSE у реальных провайдеров. E06 доказывает обработку поддержанным native parser, но не распространённость, квоты, стоимость или серверную политику. Следующая безопасная проверка — расширить offline corpus transport-вариантами; live-проверки требуют отдельного задания.
- **R12-U02 / unknown:** степень несогласованности summary/page при конкурентной записи. `service.ts:185,302–305` читает агрегат и reports отдельными операциями; `run-store.ts:663–665` также читает активации несколькими SELECT. В отличие от `attempts(..., "read")` (`596–608`) общей read transaction здесь нет. Возможность временно смешанного снимка следует из кода, **гонка не воспроизводилась и bug не заявлен**. Предложенный тест: две fixture SQLite connections, controlled interleaving между чтением records и report page; затем решить, нужен ли единый read snapshot/as-of cursor. Не путать сумму одной страницы с total всего ledger даже в согласованном снимке.
- **R12-U03 / unknown:** сообщения `providerThinkingLevel` разных API и точность SDK pricing. Исследован код сохранения, не все provider adapters/ценовые каталоги и не реальные invoices. `costReported>0` означает наличие оценки, не измерение списания подписки.

Для предложенных проверок U01–U03 продуктовых изменений пока не рекомендуется. Минимальное дополнение — изолированные transport/двухсоединительные SQLite fixtures и явные отметки provenance. Риск низкий при работе только со своей `/tmp` БД/подставным transport. Критерии: U01 — missing/zero различаются по доказанному входу; U02 — воспроизведён смешанный снимок либо чётко указан неохваченный interleaving, прежде чем предлагать общую read transaction; U03 — проверен источник effort/pricing, без утверждения о billing. Эти проверки **предложены, не исполнены** здесь.

## Источники и сравнение evidence

1. **Исходная база и инструкции:** `AGENTS.md`; `PROJECT_INFO/architecture.md`, `development.md`, `known-issues.md`; вывод `git rev-parse HEAD` в обоих деревьях; общая и профильная история Git. Это исходные данные, не разрешение изменять исследовательское задание.
2. **Контракты:** `PROJECT_INFO/observation.md:388–451`; `PROJECT_INFO/run-journal.md:179–233`; `PROJECT_INFO/retry-and-failures.md`; `skills/dynamic-workflows/references/usage.md`, `continuation.md`. Утверждение «неизвестное не ноль» конфликтует с E06 именно на SDK-normalization boundary, а не с арифметикой summarizer.
3. **Учёт:** `src/pi-worker.ts:100–105,219–280,311–352`; `src/run-runtime.ts:235–269`; `src/usage.ts:55–129`; `src/run-store.ts:595–615,889–989`; `src/service.ts:178–204,295–305,352–359`.
4. **Происхождение/смысл:** `src/lineage.ts:279–381,423–434`; `src/run-controller.ts:166–191,356–465`; `src/operation-record.ts:11–31`; `src/run-store.ts:459–524,617–661,997–1130`; `src/observation.ts:49–76`.
5. **Представления:** `src/graph-view/model.ts:78–102`; `app.js:190–234,759–769,1098–1122,1319–1446`; `task-scope.js`; `src/monitor.ts:38–80,197–233`; `src/terminal.ts:58–72`. E07 сравнивает реальный renderer с реальным ledger, не скриншот старого main.
6. **Локально установленная зависимость:** `@earendil-works/pi-ai@0.85.1/dist/api/openai-completions.js:171–184,378–387,494–504,1180–1205`, `openai-responses-shared.js:439–459`; package exports `pi-ai`/`pi-coding-agent`. SDK source только читался; текущая ревизия закрепляет версию, но сама зависимость не является файлом Git worktree.
7. **Исполняемые контрдоказательства первоначальной операции, логи перепроверены C01:** файлы tests в E01–E05; особо `tests/attempt-history.test.ts:61–75`, `tests/wave5-c08.test.ts:98–151`, `tests/usage-contract.test.ts`, `tests/continuation.test.ts:322–450`. `tests/repair-core.test.ts:115–129` только осмотрен для I01, не включён в число выполненных проверок.

## Приложение: самостоятельное offline-воспроизведение

Ниже полные fixtures, без сырых сессий/логов. Они создают и удаляют только `/tmp/r12-*`. `assert` закрепляет **наблюдаемое текущее поведение**, а не критерий исправления. Для повторения из исследовательского worktree **на точном базисе**, даже если разрешённый dev уже обновлён. Используется новый каталог, старые workspace/tmp не изменяются; `node_modules` только подключается, установки нет:

```sh
set -e
REPORT="$PWD/research/2026-09-20-astra-max/r12-usage-lineage.md"
DEV=/Users/ramu/.local/state/dynamicwf-evaluation-20260920/integration-dev
SOURCE=e15bc407da8753fd6b683c0aa4a68634e3c458a7
PROBE=$(mktemp -d /tmp/r12-repro.XXXXXX)
mkdir "$PROBE/source"
git archive "$SOURCE" src package.json package-lock.json | tar -x -C "$PROBE/source"
ln -s "$DEV/node_modules" "$PROBE/source/node_modules"
python3 - "$REPORT" "$PROBE" <<'PYFIX'
import pathlib, re, sys
text = pathlib.Path(sys.argv[1]).read_text()
fixtures = re.findall(r'<!-- r12-fixture:([^ ]+) -->\n```typescript\n(.*?)\n```', text, re.S)
assert len(fixtures) == 2
for name, body in fixtures:
    pathlib.Path(sys.argv[2], name).write_text(body + '\n')
PYFIX
(cd "$PROBE/source" && R12_DEV="$PROBE/source" node --import tsx "$PROBE/missing-usage.mts")
(cd "$PROBE/source" && R12_DEV="$PROBE/source" node --import tsx "$PROBE/attempt-label.mts")
```

<!-- r12-fixture:missing-usage.mts -->
```typescript
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dev = process.env.R12_DEV ?? process.cwd();
const req = createRequire(join(dev, 'package.json'));
const load = (name: string) => import(pathToFileURL(join(dev, 'node_modules', name, 'dist/index.js')).href);
const src = (name: string) => import(pathToFileURL(join(dev, 'src', name)).href);
const { ModelRuntime } = await load('@earendil-works/pi-coding-agent');
const { InMemoryCredentialStore, InMemoryModelsStore } = await load('@earendil-works/pi-ai');
const { executePiWorker } = await src('pi-worker.ts');
const { prepareExecutionPlan } = await src('execution-plan.ts');
const { RunStore } = await src('run-store.ts');
const { summarizeUsage, tokenSummary } = await src('usage.ts');
const { graphSnapshot } = await src('graph-view/model.ts');
const outputSchema = { type:'object', properties:{ answer:{type:'integer'} }, required:['answer'], additionalProperties:false };
const workflow = { schemaVersion:1, id:'r12-fixture',name:'R12 fixture',revision:1,entryGraph:'main',graphs:{main:{entry:'work',nodes:[
  {id:'work',kind:'agent',role:'general',task:{op:'literal',value:'fixture'},config:{tools:[],permission:'read-only',outputSchema}},
  {id:'done',kind:'end',value:{op:'literal',value:null}}
],edges:[{from:'work',to:'done'}]}}};
for (const mode of ['missing','zero','positive'] as const) {
  const directory = await mkdtemp('/tmp/r12-sdk-usage-');
  const store = new RunStore(join(directory, 'state.sqlite'));
  try {
    const runtime = await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
    runtime.registerProvider('r12-offline',{api:'openai-completions',baseUrl:'https://offline.invalid/v1',apiKey:'fixture-placeholder',models:[{id:'r12-model',name:'R12',reasoning:false,input:['text'],contextWindow:10000,maxTokens:1000,cost:{input:1,output:1,cacheRead:1,cacheWrite:1}}]});
    const plan = await prepareExecutionPlan(workflow,{cwd:directory,availableModels:[{provider:'r12-offline',id:'r12-model',thinkingLevels:['off']}]});
    store.create({id:'r12-run',plan,cwd:directory,input:null});
    const {token} = store.reserveLaunch('r12-run');
    const activation = store.beginActivation('r12-run',token,{graphId:'main',nodeId:'work',scope:['graph','main'],visit:0},{kind:'agent',sideEffect:false});
    store.startUsage('r12-run',token,activation.key);
    const events: any[] = []; let calls = 0;
    const request = {version:1,cwd:directory,resourceDirectory:join(directory,'resources'),sessionDirectory:join(directory,'sessions'),task:'Return answer 42 via submit_result',input:null,config:plan.agents.main.work};
    const result = await executePiWorker(request,{
      modelRuntime:runtime,
      onEvent(event: any) { events.push(event); if(event.type==='usage.report')store.recordUsage('r12-run',token,activation.key,event.reportId,event.usage,event.stopReason,event.observedEffort); if(event.type==='usage.settled')store.settleUsage('r12-run',token,activation.key,event.complete); },
      providerFetch:async()=>{
        calls++;
        const base={id:'chatcmpl-r12',object:'chat.completion.chunk',created:1,model:'r12-model'};
        const chunks:any[]=[
          {...base,choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'r12-submit',type:'function',function:{name:'submit_result',arguments:'{"answer":42}'}}]},finish_reason:null}]},
          {...base,choices:[{index:0,delta:{},finish_reason:'tool_calls'}]},
        ];
        if(mode!=='missing')chunks.push({...base,choices:[],usage:{prompt_tokens:mode==='zero'?0:10,completion_tokens:mode==='zero'?0:3,total_tokens:mode==='zero'?0:13}});
        return new Response(chunks.map(x=>`data: ${JSON.stringify(x)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
      }
    });
    assert.equal(calls,1); assert.deepEqual(result.output,{answer:42});
    store.completeActivation('r12-run',token,activation.key,result.output);
    store.finish('r12-run',token,{status:'succeeded',output:result.output});
    const records=store.listActivations('r12-run'),summary=summarizeUsage(records);
    const snap=graphSnapshot(store.get('r12-run'),records);
    const observed={mode,providerUsageSent:mode!=='missing',calls,reportCount:store.usageReports('r12-run').reports.length,settled:events.find(e=>e.type==='usage.settled').complete,totalTokens:summary.totalTokens,partial:summary.partial,costReported:summary.costReported,tokenSummary:tokenSummary(records),graphTotal:snap.usage.totalTokens,graphPartial:snap.usage.partial};
    console.log(JSON.stringify(observed));
    assert.equal(summary.totalTokens,mode==='positive'?13:0);
    assert.equal(summary.partial,false);
  } finally {store.close();await rm(directory,{recursive:true,force:true});}
}
```

<!-- r12-fixture:attempt-label.mts -->
```typescript
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
const dev=process.env.R12_DEV ?? process.cwd();
const src=(p:string)=>import(pathToFileURL(join(dev,'src',p)).href);
const {RunStore}=await src('run-store.ts');
const {prepareExecutionPlan}=await src('execution-plan.ts');
const {graphSnapshot}=await src('graph-view/model.ts');
const {monitorBody}=await src('monitor.ts');
const pages=await src('graph-view/usage-pages.js');
const taskScope=await src('graph-view/task-scope.js');
const {layoutGraph}=await src('graph-view/layout.js');
class Element {
  id=''; children:any[]=[]; dataset={}; attributes:any={}; className=''; value=''; ownText='';
  constructor(public tagName='div'){}
  set textContent(v:any){this.ownText=String(v);this.children=[]}
  get textContent():string{return this.ownText+this.children.map(c=>c.textContent).join('')}
  append(...nodes:any[]){this.children.push(...nodes)}
  replaceChildren(...nodes:any[]){this.ownText='';this.children=nodes}
  setAttribute(k:string,v:any){this.attributes[k]=String(v);if(k==='class')this.className=String(v)}
  getAttribute(k:string){return k==='class'?this.className:this.attributes[k]}
  addEventListener(){} getBoundingClientRect(){return {width:900,height:600}} showModal(){} close(){}
}
const directory=await mkdtemp('/tmp/r12-attempt-label-'),store=new RunStore(join(directory,'state.sqlite'));
try {
  const plan=await prepareExecutionPlan({schemaVersion:1,id:'r12-flow',name:'R12 fixture',revision:1,entryGraph:'main',graphs:{main:{entry:'work',nodes:[{id:'work',kind:'agent',role:'general',task:{op:'literal',value:'fixture'},config:{tools:[],permission:'read-only'}},{id:'done',kind:'end',value:{op:'literal',value:null}}],edges:[{from:'work',to:'done'}]}}},{cwd:directory,availableModels:[{provider:'r12-offline',id:'r12-model',thinkingLevels:['off']}]});
  store.create({id:'r12-run',plan,cwd:directory,input:null});
  const {token}=store.reserveLaunch('r12-run');
  const context={graphId:'main',nodeId:'work',scope:['graph','main'],visit:0};
  const first=store.beginActivation('r12-run',token,context,{kind:'agent',sideEffect:false});
  store.startUsage('r12-run',token,first.key);store.recordUsage('r12-run',token,first.key,'1',{input:5,output:3,totalTokens:8},'error');store.settleUsage('r12-run',token,first.key,false);store.failActivation('r12-run',token,first.key,'fixture failed');
  store.beginActivation('r12-run',token,context,{kind:'agent',sideEffect:false});
  store.startUsage('r12-run',token,first.key);store.recordUsage('r12-run',token,first.key,'1',{input:10,output:2,totalTokens:12},'stop');store.settleUsage('r12-run',token,first.key,true);store.completeActivation('r12-run',token,first.key,{});store.finish('r12-run',token,{status:'succeeded',output:{}});
  const run=store.get('r12-run'),records=store.listActivations('r12-run'),base=graphSnapshot(run,records),reports=store.usageReports('r12-run').reports,attempts=store.attempts('r12-run',first.key);
  assert.equal(attempts.records[0].accounting.usage.totalTokens,8);assert.equal(attempts.current.accounting.usage.totalTokens,12);assert.equal(base.usage.totalTokens,20);
  const elements=new Map<string,Element>(),descendants=(node:any):any[]=>node.children.flatMap((c:any)=>[c,...descendants(c)]);
  const document={body:new Element('body'),activeElement:null,getElementById(id:string){if(!elements.has(id))elements.set(id,new Element());return elements.get(id)},createElement:(t:string)=>new Element(t),createElementNS:(_n:string,t:string)=>new Element(t),querySelectorAll:()=>[]};
  const source=readFileSync(join(dev,'src/graph-view/app.js'),'utf8'),boundary='await refreshRuns();\nlet tick = 0;';assert.equal(source.split(boundary).length,2);
  const app=source.split(boundary)[0]!.replace(/^import[\s\S]*?from "[^"\n]+";\n/gm,'');
  const headers=runInNewContext(app+`\nstate.id=base.id;state.run=base;state.graph=base.entryGraph;state.tab='tokens'; const p=usagePages.get(base.id);p.reports=reports;p.opened=true;renderTokens(); descendants($('content-panel')).filter(n=>n.className==='detail-run').map(n=>n.children[0].textContent);`,{...pages,...taskScope,layoutGraph,document,base,reports,descendants,window:{addEventListener(){}},ResizeObserver:class{observe(){}},fetch(){throw Error('Unexpected network')}});
  assert.match(headers[0],/попытка 2.*попытка 1/);
  console.log(JSON.stringify({archiveTotal:8,currentTotal:12,activationTotal:20,headers,monitorHistory:monitorBody(run,records,{view:'history'})}));
} finally {store.close();await rm(directory,{recursive:true,force:true});}
```
