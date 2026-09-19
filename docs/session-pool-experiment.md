# Офлайн-эксперимент нескольких SDK-сессий

Позднее выполнен отдельный [эксперимент с настоящими xAI-запросами](campaign-harvest.md#эксперименты). Ниже сохранены методика и результаты именно офлайн-стенда.

Исполняемые источники: [`spikes/session-pool-benchmark.ts`](../spikes/session-pool-benchmark.ts), регрессия [`tests/campaign-sdk-pool.test.ts`](../tests/campaign-sdk-pool.test.ts).

Это **реальные** `createAgentSession` / `prompt` / `abort` / `dispose` из `@earendil-works/pi-coding-agent@0.85.1`. Транспорт модели заменён детерминированным `streamSimple` на экземпляре `ModelRuntime` и per-session `agent.streamFunction`. Сеть, credentials пользователя и live Grok не используются. Production runtime dynamicwf не меняется. Подпроцессы здесь только для этого бенчмарка, не планировщик и не запуск агентов/workflow.

## Запуск

```sh
node --import tsx spikes/session-pool-benchmark.ts
node --import tsx --test tests/campaign-sdk-pool.test.ts spikes/session-pool-benchmark.test.ts
```

CLI печатает один JSON: lifecycle-проверки, затем сравнение для N=1,4,8,16 в режимах `in-process` и `child-process`. Набор конечный: у fake stream нет живого inference, после ответа сессия останавливается (`shouldStopAfterTurn`). Таймаут child 60s — защита harness от зависшего процесса, не бюджет модели.

## Что сравнивается

| Режим | Единица | Runtime |
| --- | --- | --- |
| `in-process` | N сессий в одном Node | один `ModelRuntime` на размер N, отдельные cwd / SessionManager / ResourceLoader |
| `child-process` | N дочерних Node | у каждого процесса свой runtime и одна сессия |

Метрики времени **не** являются полным стартом процесса ОС и не Grok throughput:

- `constructionMs` — только вызов `createAgentSession` внутри сессии.
- `startupMs` — точный per-session **sessionSetup**: SettingsManager / ResourceLoader + `createAgentSession` + установка fake stream до `isIdle`. **Не** включает `ModelRuntime.create`. **Не** включает spawn / import / hello дочернего Node.
- `runtimeCreateMs` (только in-process) — отдельно `ModelRuntime.create`.
- `poolReadyMs` — **родительское** wall-clock до готовности пула: in-process = `ModelRuntime.create` + все сессии; child-process = spawn + import + hello + create runtime/session. Это не cold-start ОС.

Распределения (`min` / `max` / `mean` / `p50` / `p90`) для `constructionMs`/`startupMs` считаются по N сессиям данного размера, не по повторным прогонам машины. `poolReadyMs` — одно родительское измерение на (mode, N).

## RSS без двойного счёта

Сэмпл: `process.memoryUsage.rss()` родителя плюс сумма RSS **принадлежащих** children, которые сами сообщают свой RSS по IPC.

RSS родителя в Node **не включает** адресные пространства детей, поэтому `accountedRssBytes = parentRssBytes + sum(childRss)` не суммирует heap родителя дважды. `includesParentChildDoubleCount` всегда `false`. Для in-process children пусты, accounted = parent.

Ограничение ОС: RSS каждого процесса может включать shared mapping бинарника Node. Это не ошибка формулы parent+child.

Временные каталоги — `os.tmpdir()` через `mkdtemp`, без жёсткого `/tmp` и без HOME пользователя.

## Глобальное состояние SDK

Импорт coding-agent ставит `setDefaultStreamFn(streamSimple)` из `@earendil-works/pi-ai/compat`. Эксперимент **явно не вызывает** `setDefaultStreamFn`, `registerApiProvider`, `resetApiProviders` и не подменяет `globalThis.fetch`. Провайдер регистрируется только на локальном `ModelRuntime`.

После сценариев сверяются **только** identity `fetch`, `setDefaultStreamFn`, `compat.streamSimple` и имена `api` у `getApiProviders()`. Это не доказательство, что скрытое closure-состояние default stream не изменилось: оно **не наблюдается** и **не заявляется** изолированным.

## Lifecycle, который должен держаться в одном процессе

Успешный prompt — это assistant с `stopReason=stop` и ожидаемым echo. `prompt()` resolve, `isIdle` и наличие user message **не** считаются успехом модели.

| Сценарий | Ожидание |
| --- | --- |
| prompt / history / cwd | Разные `sessionId` и `sessionManager.getCwd()` (не `process.cwd()`); маркеры и echo не пересекаются; system prompt свой; каждый успешный prompt — `stopReason=stop` и свой echo |
| abort одного | Оба prompt входят в stream и остаются pending; abort A пока B ещё pending; затем release B; у B `stopReason=stop` и echo |
| error одного | У ошибочной сессии `stopReason=error`; negative control: этот turn не проходит проверку успеха; пир — `stopReason=stop` и echo |
| dispose одного | Пиру дают **второй** успешный scripted turn; повторный prompt — `stopReason=stop` и новый echo, не `Unexpected model call 2` |

Отсутствующие API дают throw `failing, not skipping`, не `test.skip`.

## Ограничение доказательства

**Fake injected inference is not Grok throughput.** Числа описывают конструкцию/старт `createAgentSession` и RSS при локальном скрипте, не tokens/s, не 429, не параллелизм xAI. In-process изоляция не доказывает изоляцию ОС; child-процессы доказывают отдельный RSS/адрес, но не качество модели. Compaction, retry, OAuth, filesystem tools и production worker IPC в этот эксперимент не входят.

## Контрольный прогон 19 сентября 2026

Node 26.8.1, SDK 0.85.1, macOS; настоящие SDK-сессии с подставными ответами. Итоговый код прошёл typecheck, 14 тестов и полный бенчмарк. Проверка успешного ответа требует точного echo, поэтому `s10` не считается ответом для `s1`.

| N | Один Node: RSS, MiB | Отдельные Node + родитель: сумма RSS, MiB | Один Node: poolReadyMs | Отдельные Node: poolReadyMs |
| --- | ---: | ---: | ---: | ---: |
| 1 | 314.2 | 626.0 | 1.19 | 657.39 |
| 4 | 314.5 | 1504.2 | 2.18 | 924.23 |
| 8 | 314.8 | 2735.2 | 2.74 | 1568.34 |
| 16 | 315.0 | 5107.8 | 4.04 | 3020.82 |

Это один прогон, не статистика повторных запусков. Родитель уже импортировал SDK; дочерние процессы импортируют его заново. Сумма RSS может учитывать общие отображения памяти в нескольких процессах и не равна уникальной занятой физической памяти. Из этих чисел нельзя вывести ускорение inference Grok или безопасный предел production-параллелизма.

Журнал итогового прогона: каталог кампании `wave4/integration-checks/dynamicwf-pi/sdk-final/`. Запасной родительский вариант не использован: перенесён Grok-кандидат с отдельно проверенной однострочной защитой точного echo.

## Инструменты и общий refresh: дополнительная проверка

`tests/session-pool-tools.test.ts` выполняет четыре конкурентных `executePiWorker` с одним `ModelRuntime`. У каждого отдельные cwd, файлы `input.txt`/`output.txt`, каталог ресурсов и сохранённая сессия. Скрипт модели выдаёт настоящие вызовы SDK `read`, `write`, `submit_result`. Проверяются содержимое файлов, отсутствие маркеров соседей в транскриптах, отдельные sessionFile, неизменный `process.cwd()` и расход каждого вызова.

В отдельном временном `auth.json` лежит просроченный вымышленный OAuth-токен. Барьер удерживает refresh, пока все четыре воркера не запросят авторизацию. Используется штатное файловое хранилище SDK; один подставной refresh обновляет токен, после чего все четыре воркера завершаются. Этот тест не использует credentials пользователя или сеть и не доказывает поведение серверной ротации xAI, нескольких процессов или отмены владельца refresh-lock.

## Условия перехода к production-пулу

| Проверка | Состояние | Что ещё требуется |
| --- | --- | --- |
| Раздельные input/history/cwd и реальные read/write | Проверено офлайн на четырёх воркерах; добавлены настоящие bash-команды | Разные наборы frozen tools/skills и произвольные деревья потомков; отдельные cwd не являются OS sandbox. |
| Общий runtime и обновление токена | Проверено с временным файлом и подставным OAuth | Отмена ожидающего/владельца lock; несколько процессов; реальная ротация xAI при доступной подписке. |
| Ошибка, abort, dispose одной сессии | Офлайн lifecycle, live отмена inference и отмена настоящей bash-команды проверены | Проверить сложные деревья потомков и потерю процесса во время отмены. |
| Гибель процесса, содержащего несколько сессий | Воспроизведено: detached bash переживает SIGKILL общего процесса | Нужен внешний учёт/контроль команд, связанный с activation/attempt; completed checkpoints сохранять, неподтверждённые эффекты считать неопределёнными. Интеграция с RunStore/reconcile пока не проверена. |
| Repair, compaction и повторное использование | Частичные сценарии | Проверить длинные ходы, очереди, отдельный учёт и очистку ресурсов после ошибки; отсутствие утечек между заданиями. |

Следующая реализация должна быть отдельным выбираемым режимом исполнения с прежним процессом на воркер в качестве рабочего варианта. Размер группы задаётся политикой запуска, а не выводится из единственного измерения RSS. Перед включением должны проходить прежние retry/recovery/usage-контракты; успешный эксперимент сам по себе не меняет backend существующих запусков.

## Отмена инструмента и авария общего процесса

`tests/session-pool-lifecycle.test.ts` и `tests/fixtures/session-pool-lifecycle.ts` проверяют реальные `executePiWorker` и SDK bash с подставным inference. Пользовательские процессы, credentials и сеть не затрагиваются. На Windows эти две POSIX-проверки пропускаются.

- При отмене одного из двух воркеров его уже запущенная команда завершается, соседняя остаётся живой и успешно заканчивает работу после разрешения тестового барьера. Отменённый воркер сообщает `cancelled` с `effects=unknown`: начальный файловый эффект уже произошёл. Повторного выполнения нет, учёт успешного соседа и отдельная история сохранены.
- В другом дочернем Node одновременно работают три сессии. Одна успевает передать результат родителю, две ждут внутри bash. После SIGKILL этого Node оба detached-процесса команд продолжают жить. Освобождение одного барьера приводит к записи файла **после гибели пула**, но результат сессии уже некому подтвердить. Родитель сохраняет ранее полученный результат; остальные не объявляются успешными. Все созданные тестом процессы прибраны.

Это подтверждённое ограничение простого объединения SDK-сессий в одном процессе, а не проверка готового production-пула: такого backend пока нет. Файл родителя — свидетельство полученного ответа, не подмена durable checkpoint в RunStore. Существующая recovery-регрессия отдельных воркеров проверяется отдельно. Нельзя считать гибель Node гарантией остановки команд или автоматически повторять их: эффект может ещё выполняться. Следующая задача — внешний надзор за командами и привязка всей группы к attempts, затем проверка восстановления через настоящий RunStore.
