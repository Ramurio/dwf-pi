# Внешний индекс доказательств Astra

Это документация, не runtime enum и не инструкция исполнять исторические исследования.
Охват: все 13 finding IDs из назначенного набора packets. Baseline пакетов:
`3b8ad7e64db13a706d3ce4eca7ecf1d43104804a` (SDK 0.85.1, где явно указано).
Источники ниже — оценки packets, а не повторно проверенные в R10 сырые probes.
Имена файлов регрессии для остальных задач — места проверки/кандидаты, **не заявление об исправлении или прохождении**.
Только R10 и перечисленные в его отчёте тесты выполнены этим проходом.

Категории различаются: воспроизведение фиксирует конкретный fixture; source-supported — сценарий по коду без replay;
уже исправленное поведение не переоткрывается; гипотеза требует новых наблюдений.
Failed provider envelopes не являются мнениями reviewer, голосами или доказательством качества модели.
Никаких живых LLM, SSH или платных fallback в этом проходе не использовалось.

## A09 — Двойная валидация меняет результат модели

- Категория baseline: `reproduced`.
- Источник: packet `A09.json`; `/Users/ramu/.dynamicwf/campaigns/grok-20260918/parent-review-24-batch2-20260919`; probe `probes-results.json`.
- Source: `src/output-schema.ts:29`, `src/pi-worker.ts:175`, `node_modules/@earendil-works/pi-ai/dist/utils/validation.js:280`, `node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js:387`.
- Регрессионный файл: tests/pi-worker.test.ts.
- Установленный факт и границы baseline: Конкретный дефект воспроизведён на штатной цепочке валидаторов: {answer:null} разрешён schema с type:string, nullable:true и сохраняется после createOutputValidator, но следующий validateToolArguments SDK превращает null в пустую строку. В worker prepareArguments использует первый валидатор, а execute сохраняет уже переданные SDK аргументы. Полный executePiWorker с моделью не запускался; изменение данных на этой границе доказано. Ранняя проверка неизвестных keywords уже исправлена и отдельно проверена.
- Непроверенная граница / дальнейшая проверка (не выполненная здесь): Перенести nullable fixture в полный worker-тест с искусственным transport и обеспечить сохранение исходного валидного JSON через SDK. Не принимать решение о запрете nullable или отключении валидации без проверки совместимости. Ограничение огромных диагностик — отдельная низкоприоритетная задача.

## B04 — Гонка pause → resume

- Категория baseline: `reproduced`.
- Источник: packet `B04.json`; `/Users/ramu/.dynamicwf/campaigns/grok-20260918/parent-review-24-20260919`; probe `probes-results.json`.
- Source: `src/run-runtime.ts:173`, `src/run-runtime.ts:203`, `src/run-store.ts:448`.
- Регрессионный файл: tests/run-runtime.test.ts.
- Установленный факт и границы baseline: Подтверждается узкий дефект: admission отклоняет шаг во время паузы, но к обработке ошибки run уже resumed. Обработчик видит running и пробрасывает ошибку вместо ожидания/повторного допуска. Воспроизведено детерминированной подстановкой на границе beginActivation: работа не вызвана, desired=running, шаг падает. Это доказывает допустимый порядок событий, но не частоту гонки в реальном запуске.
- Непроверенная граница / дальнейшая проверка (не выполненная здесь): Отдельно различить отказ допуска из-за паузы и настоящую ошибку. Повторять допуск с проверкой отмены/владельца; не делать общий retry по тексту ошибки. Закрепить воспроизведение регрессионным тестом.

## D03 — Usage после reconcile и legacy-журналов

- Категория baseline: `partly_addressed`.
- Источник: packet `D03.json`; `/Users/ramu/.dynamicwf/campaigns/grok-20260918/parent-review-48-batch3-20260919`; probe `dwf-probes-results.json`.
- Source: `src/run-store.ts:808`, `src/run-store.ts:910`, `src/usage.ts:48`, `tests/task-usage.test.ts:1`.
- Регрессионный файл: tests/task-usage.test.ts.
- Установленный факт и границы baseline: Сохранение полноты usage при reconcile accept уже исправлено. Дополнительно воспроизвёл край миграции: после старого metadata subtotal=100 новая ledger-попытка с 20 даёт cumulative total=20. Прежние 100 не включены, но earlierAttempts=1 и partial=true честно указывают неполноту. Это недоучёт legacy totals, не двойное списание и не silently complete. Текущие all-ledger task tests проходят.
- Непроверенная граница / дальнейшая проверка (не выполненная здесь): Описать/решить миграцию legacy subtotal без двойного счёта. Не пересчитывать заново уже корректный reconcile фикс и не объявлять все исторические totals полными.

## E01 — Первый запуск по скиллу

- Категория baseline: `partly_addressed`.
- Источник: packet `E01.json`; `/Users/ramu/.dynamicwf/campaigns/grok-20260918/parent-review-48-batch4-20260919`; probe `probes-results.json`.
- Source: `src/service.ts:91`, `src/cli.ts:29`, `src/mcp.ts:32`, `src/mcp-tools.ts:28`.
- Регрессионный файл: tests/service.test.ts.
- Установленный факт и границы baseline: Утверждение об утрате operationIndex/expectedRevision уже устарело: оба транспорта возвращают поля. Оставшийся разрыв воспроизведён: workflow.schema.patch — внутренняя DraftPatchSchema без id, тогда как публичный workflow.patch требует id. Есть отдельный исторический skill-retest с 4/4 firstAttempt на четырёх чистых no-model fixtures, но requests исполнял доверенный replayer; это не статистика безошибочного полного запуска агентом. Его изменённую копию skill нельзя автоматически приравнять к текущей установленной.
- Непроверенная граница / дальнейшая проверка (не выполненная здесь): Выдать публичную схему patch с id; проверять скилл новым агентом на реальном tool handoff, сохраняя все конверты и первый пользовательский статус.

## E09 — Повреждённая ревизия preset ломает список

- Категория baseline: `reproduced`.
- Источник: packet `E09.json`; `/Users/ramu/.dynamicwf/campaigns/grok-20260918/parent-review-48-batch3-20260919`; probe `dwf-probes-results.json`.
- Source: `src/presets.ts:61`, `src/presets.ts:85`, `src/execution-plan.ts:150`.
- Регрессионный файл: tests/presets.test.ts.
- Установленный факт и границы baseline: Воспроизведено: один неверный JSON старой ревизии ломает versions/list, хотя прямое чтение корректного hash успешно. Через service предварительный versions gate может блокировать и явный выбор. Name-level project shadowing — отдельное намеренное правило; worker skills — frozen paths, а не harness discovery.
- Непроверенная граница / дальнейшая проверка (не выполненная здесь): Показывать повреждённые ревизии как отдельную диагностику и позволять явное чтение проверенной версии; не молча принимать повреждённый latest. Уточнить scope/revision ошибки.

## F08 — Перекрытие маршрутов рёбер

- Категория baseline: `reproduced`.
- Источник: packet `F08.json`; `/Users/ramu/.dynamicwf/campaigns/grok-20260918/parent-review-48-batch4-20260919`; probe `probes-results.json`.
- Source: `src/graph-view/layout.js:74`, `src/graph-view/layout.js:98`, `docs/diagram-design-review.md:66`.
- Регрессионный файл: tests/graph-view.test.ts.
- Установленный факт и границы baseline: Отдельные порты уже есть; старое описание diagram-design-review об общем порте устарело. Actual layoutGraph на скрещённом 2×2 даёт коллинеарное пересечение полилиний длиной 28 при x=433 в моей фикстуре. Это уточняет исторические координаты, а не опровергает корень. Скруглённый SVG и визуальная различимость требуют browser QA. diagram-design — набор редакторских правил, не готовый layout engine.
- Непроверенная граница / дальнейшая проверка (не выполненная здесь): Добавить fixture на сегментные совпадения и отдельно на маски подписей; развести дорожки либо показать пересечение. Не менять всю библиотеку раскладки без сравнительных fixtures.

## H05 — Копирование активной SQLite с WAL

- Категория baseline: `reproduced`.
- Источник: packet `H05.json`; `/Users/ramu/.dynamicwf/campaigns/grok-20260918/parent-review-48-batch4-20260919`; probe `probes-results.json`.
- Source: `src/sqlite.ts:10`, `src/run-controller.ts:89`, `src/run-store.ts:1`.
- Регрессионный файл: tests/sqlite.test.ts.
- Установленный факт и границы baseline: Продуктовой процедуры backup/restore нет. На actual openWorkflowDatabase создал WAL-fixture: после checkpoint записал строку. Копия только .sqlite потеряла эту строку (0), node:sqlite backup сохранил (1), integrity_check=ok. Это доказательство риска naive copy; recovery активных процессов и перенос sessions/cwd этим не проверены.
- Непроверенная граница / дальнейшая проверка (не выполненная здесь): Документировать online backup API и read-only проверку копии; restore только в отдельном окружении с учётом внешних файлов/процессов. Не открывать живую копию через управляющий UI как простой просмотр.

## L02 — Потеря результата OAuth refresh при отмене

- Категория baseline: `reproduced`.
- Источник: packet `L02.json`; `/Users/ramu/.dynamicwf/campaigns/grok-20260918/parent-review-24-20260919`; probe `oauth-probe-results.json`.
- Source: `/Users/ramu/Projects/ai-related/all-pi/dynamicwf-pi/node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js:134`.
- Регрессионный файл: не назначен в R10 (отдельная SDK regression).
- Установленный факт и границы baseline: На actual SDK 0.85.1 и временном auth file воспроизведено: fake refresh возвращает новую пару credentials и отменяет вызывающий запрос; SDK отклоняет вызов и оставляет старый refresh token на диске. Это окно между завершённым refresh и сохранением, а не доказательство поломки lock в обычном сценарии. Использованы вымышленные credentials без сети. Реальная ротация токенов xAI и pinned remote SDK 0.85.0 отдельно не проверялись.
- Непроверенная граница / дальнейшая проверка (не выполненная здесь): Изолированный upstream/adapter fix: отмена запроса не должна терять уже успешно обновлённые credentials при корректном владении lock. Перед переносом проверить pinned SDK и конкурирующие процессы. Не возвращать старый OAuth-плагин как обходной путь.

## N07 — Два pending разрешения на повтор

- Категория baseline: `reproduced`.
- Источник: packet `N07.json`; `/Users/ramu/.dynamicwf/campaigns/grok-20260918/parent-review-48-batch4-20260919`; probe `recovery-results.json`.
- Source: `src/run-store.ts:789`, `src/run-store.ts:694`, `src/run-runtime.ts:155`.
- Регрессионный файл: tests/recovery-inspection.test.ts.
- Установленный факт и границы baseline: В отдельном RunController fixture записал safe setup failure с auto retry, прервал фиктивного supervisor и через настоящий recovery/reconcile разрешил ручной retry. После этого одновременно существуют scheduled auto retry и pending manual reconciliation. Attempt остался 1; запусков процессов не было. Подтверждается путаница авторизаций/статуса, не двойное выполнение. Связки dynamicwf↔remote-pi сейчас нет.
- Непроверенная граница / дальнейшая проверка (не выполненная здесь): Явно помечать прежнее auto retry superseded/abandoned при reconciliation и сохранять историю. Проверить accept/retry/отмену и ровно один допуск; не добавлять второй orchestrator.

## O07 — Сигнал завершения bash теряется в установленном pi

- Категория baseline: `confirmed_issue`.
- Источник: packet `O07.json`; `/Users/ramu/.dynamicwf/campaigns/grok-20260918/parent-review-36-batch5-20260919`; probe `bash-signal-results.json`.
- Source: `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.js:263`, `node_modules/@earendil-works/pi-coding-agent/dist/utils/child-process.js:1`, `src/check-worker-process.ts:33`, `../remote-pi/lib/pi-runtime.mjs:1`.
- Регрессионный файл: tests/pi-worker.test.ts (кандидат; отдельная SDK regression).
- Установленный факт и границы baseline: Вызвал настоящие createBashTool из pi 0.85.1 и remote pin 0.85.0 с безопасным kill -TERM $$ в отдельном shell. Оба вернули обычный text result без ошибки: waitForChildProcess теряет сигнал, bash допускает exitCode=null. Контрольный check-worker dynamicwf правильно вернул process/execution/unknown и exit 1. Это дефект SDK shell-инструмента; не доказательство поломки check или живого Grok. Unreleased upstream и установленная версия — разные источники.
- Непроверенная граница / дальнейшая проверка (не выполненная здесь): Отдельный короткий фикс/проверенное обновление SDK: сохранить signal, отличить null от exit 0, regression на signal/timeout/cancel/ordinary exit. Не обновлять вслепую весь стек.

## Q10 — Выбранный transition может относиться к другой ветке

- Категория baseline: `source_supported_issue`.
- Источник: packet `Q10.json`; `/Users/ramu/.dynamicwf/campaigns/grok-20260918/parent-review-36-batch5-20260919`; probe `не указан`.
- Source: `src/graph-view/app.js:571`, `src/graph-view/app.js:969`, `src/graph-view/app.js:1485`, `src/expressions.ts:110`.
- Регрессионный файл: tests/graph-view.test.ts.
- Установленный факт и границы baseline: В renderInspector selected transition сравнивается по graphId и nodeId, без scope. Scope dropdown меняет scope, сохраняя transition; selectNode очищает его, поэтому не вся навигация уязвима. SVG highlight уже проверяет scope. Получается source-supported сценарий: выбрать trace ветки A, поменять scope на B — inspector может оставить переход A. Браузерный replay не выполнен. Исторические operands не сохранены и не должны выдумываться из последних outputs.
- Непроверенная граница / дальнейшая проверка (не выполненная здесь): Точечная одинаковая проверка scope в inspector/highlight или сброс transition при смене scope; браузерная regression именно trace→scope.

## R04 — Контекст: реальная граница read и недоказанная потеря внимания

- Категория baseline: `partial_evidence`.
- Источник: packet `R04.json`; `/Users/ramu/.dynamicwf/campaigns/grok-20260918/parent-review-36-batch5-20260919`; probe `contracts-results.json`.
- Source: `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/truncate.js:10`, `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/read.js:1`, `src/pi-worker.ts:162`.
- Регрессионный файл: tests/pi-worker.test.ts (кандидат для read boundary).
- Установленный факт и границы baseline: На настоящем SDK read однострочный JSON 60033 bytes вернул только уведомление о превышении 50KB, ноль содержимого и совет использовать bash. У read-only исследователей bash запрещён. Это воспроизведённый способ получить недоступный материал, не молчаливая обрезка и не доказанный lost-in-the-middle. Compaction воркера отключена; влияние большого полного input на качество не измерено.
- Непроверенная граница / дальнейшая проверка (не выполненная здесь): Для campaign packets форматировать JSON с переносами и сохранять raw findings; для общего продукта продумать безопасное чтение длинной строки частями. Не открывать bash всем read-only воркерам ради обхода.

## R10 — Карта уверенности и legacy inconclusive

- Категория baseline: `confirmed_issue`.
- Источник: packet `R10.json`; `/Users/ramu/.dynamicwf/campaigns/grok-20260918/parent-review-36-batch5-20260919`; probe `contracts-results.json`.
- Source: `src/task-outcome.ts:16`, `examples/council.patch.json:1`, `src/service.ts:22`, `tests/await-outcome.test.ts:1`.
- Регрессионный файл: tests/council.test.ts, tests/council-outcome.test.ts, tests/await-outcome.test.ts.
- Установленный факт и границы baseline: Сквозной offline service→prepare→start→supervisor fixture подтвердил: end с {accepted:false,decision:inconclusive} сохраняет output.inconclusive, но taskOutcome становится rejected по legacy контракту. Это не порча данных и не ложное approve; пример council может показывать двусмысленный общий итог. Самих LLM reviewer в fixture не было. Утверждения старого отчёта об отсутствии reconcile и прежних одинаковых edge paths уже устарели.
- Непроверенная граница / дальнейшая проверка (не выполненная здесь): Для новых примеров использовать явный finish inconclusive; не менять смысл старых frozen end. Карта доказательств должна быть внешним audit-index, а не ещё одним outcome enum runtime.
- Выполнено сейчас: 162 scripted комбинации council, mismatch revisions и dissent; реальные no-model service→prepare→start→supervisor fixtures для legacy и explicit inconclusive; отказ preset.save. Все 16 тестов трёх назначенных файлов и TypeScript прошли. Качество настоящих LLM reviewers не измерялось.

## No-change и исторические утверждения

`src/task-outcome.ts` — **no-change**: `legacyOutcome` продолжает трактовать `accepted:false` как
`rejected/source:legacy`, не переписывая output с `decision:inconclusive`.
Новый council использует отдельные root finish; runtime outcome enum не расширяется.
Исторические frozen plans и runner — **no-change**. Тест legacy v1 проверил сохранение source/hash и выполнение.
Отсутствие reconcile и одинаковые edge ports — устаревшие утверждения baseline, не текущие дефекты.
Reconcile usage и сохранение operationIndex/expectedRevision отмечены пакетами как уже исправленные;
их повторная проверка не заявляется результатом R10. Lost-in-the-middle, частота pause race,
двойное исполнение N07 и качество живого Grok остаются недоказанными гипотезами.

### Проверяемый лог R10 после ревью

Полный повторный прогон трёх обязательных файлов (16/16, включая frozen v1)
и TypeScript сохранён в [docs/fixes/R10.md](fixes/R10.md#повторная-проверка-после-reviewfeedback)
вместе с SHA-256 проверенных исходников и fixture. Это отдельное доказательство,
не сокращённый fixed check на двух testFiles. Для каждого scripted council запуска
теперь независимо проверяется ровно один root finish: возврат к legacy end не может
обойти проверки decision/reason.
