# r13 — Безопасность bridge/model/provider и отмена

## Metadata

- ID: `r13`; дата исследования: **2026-09-20** (UTC).
- Source revision: `e15bc407da8753fd6b683c0aa4a68634e3c458a7`.
- Фактический cwd **новой операции**: `/Users/ramu/.dynamicwf/runs/run-9dbb044c-664f-4dd8-96c0-57192dc4ed89/worktrees/0f47b6cc04ca6586af79878fc6baffeb8f730bc1e699065bb43d5e7a2c47d827`. Исторический cwd указан в continuation provenance ниже.
- Исследование, **не реализация**. Изменяются только два назначенных отчёта. Чужие отчёты не читались; commit/push, установка пакетов, реальные run и провайдеры не использовались.
- Среда **исторически выполненных E00–E07**: macOS, Node `v26.8.1`, pi-ai/pi-coding-agent `0.85.1`, AWS Bedrock SDK `3.1048.0`. В worktree нет `node_modules`; узкие offline-проверки запускались из разрешённого dev с существующими зависимостями. В момент исходного исследования, по сохранённому отчёту, HEAD dev совпал; побайтовое сравнение **185 tracked-файлов** `src`, `tests`, `package*`, `patches`, `scripts` показало **0 различий** с worktree.
- Источники: локальный код, закреплённые SDK, профильная документация и `git log`. Веб не использовался; пользовательские credentials и секретные env/auth-файлы не открывались. Все используемые credential stores — dummy/in-memory либо собственные временные fixture-файлы.

## Краткий итог

**Один подтверждённый bug:** `maxRetries:0` не отключает внутренние HTTP-повторы маршрута `bedrock-converse-stream`. В реальном SDK, но на локальном dummy HTTP endpoint, один вызов worker/один ход ассистента послал **3 запроса при 503** без политики повторов графа. Контроли 400, `AWS_MAX_ATTEMPTS=1` и отмена после первого запроса дали по одному запросу. Это не опровержение уже исправленных путей Codex/OpenAI/xAI.

Дополнительно: одна идея осторожнее формулировать исход credential persistence; один unknown о принудительном завершении во время refresh; четыре группы подтверждённых защит/исправлений. Всего `findings=7`: `bug=1`, `idea=1`, `unknown=1`, `already-fixed=4`. В исходной операции выполнена **141 проверка существующих целевых тестов, 141 passed**, плюс собственные dummy fixtures. Полный `npm test` не запускался. В новой операции эти тесты/fixtures **не перезапускались**: проверены сохранённые итоги, код и целостность; восстановлены отсутствующие приложения.

## Continuation provenance — восстановление пакета, не повтор исследования

- Источник: `sourceRunId=run-babf9b25-b8f5-45ad-b79c-2b2e5d31d2f0`; прежний workspace: `/Users/ramu/.dynamicwf/runs/run-babf9b25-b8f5-45ad-b79c-2b2e5d31d2f0/worktrees/0f47b6cc04ca6586af79878fc6baffeb8f730bc1e699065bb43d5e7a2c47d827`.
- По `retainedEvidence` старая операция завершилась **failed**: `provider`, HTTP `429`, `phase=execution`, `effects=unknown`, `dispatch=http-observed`. Это факт сбоя обслуживавшего графа, **не** Bedrock fixture и не доказательство квоты, причины ограничения или права повторить внешнее действие. Старого успешного `submit_result` не заявляем.
- Сначала прочитаны собственные старые файлы и сохранённые команды. Хеши сверены с входным manifest: Markdown **33833 bytes**, SHA256 `7887553ed2b5e20af1fffd72ce4799775300065fb8f1486fdb765b088701fbb5`; JSON **32300 bytes**, SHA256 `09826573b8f7d2fa856dfb4e6fcb3480262dcba3b21d44fa2b896d0756cbd8f5`. JSON синтаксически валиден, но пакет был **частичным**: Markdown заканчивался `FIXTURE_APPENDICES`, приложений A–C не было; ссылки и утверждение JSON о встроенных fixtures были преждевременными.
- Список `r13-actions.json` содержит **29 команд**, SHA256 `31d56e7b545b61f424b032e6f413b3155c747b9696072833ca0601fbeb1e4279`. Это история команд, а не сохранённые tool results с exit codes. Для результатов дополнительно прочитаны только собственные сохранённые логи в `/tmp/r13-security-provider-Q20Xv5`: сводки 86/86, 28/28, 23/23, 4/4; E05 в двух логах — 3/1/1/1 запросов; E06 — два успешных cleanup-сценария; E07 — изменённая dummy credential при противоположной публичной диагностике. Маркеров проваленных assertions в этих логах не найдено. Сырые логи не включены; их хеши и очищенные сводки есть в JSON.
- **Перенесено:** семь прежних findings R13-B01/I01/U01/A01–A04, исторические E00–E07 и их ограничения. **Перепроверено:** file:line ключевых причин, SHA256 четырёх fixtures, версии/байты Bedrock adapter и SDK bash; 185 tracked файлов `src/tests/package*/patches/scripts` старого и нового worktree идентичны. Исследуемый HEAD нового cwd остаётся `e15bc407…`, без изменений исходников.
- **Добавлено:** точные ранее исполнявшиеся scripts в приложения A–C, инструкции воспроизведения с новым `/tmp/r13-repro-*`, этот provenance, отдельный post-study контекст, исправление неоднозначной фразы о выборе модели. Новых поведенческих findings нет. Синтаксис четырёх **новых копий** в `/tmp/r13-continuation-fmwkefga` проверен `node --check`; exit 0 у всех. Это не повтор выполнения scripts, импорта SDK, transport или отмены процессов.
- Текущий разрешённый dev при чтении имеет HEAD `3d8ba65ee84402c0e3b0587f70095b7847824a9f`, **не** исторический HEAD E00. Provider/credential/process код, lockfile и проверенные байты зависимостей не изменились; изменение `execution-plan.ts` относится к отдельному post-study исправлению ниже. Утверждение старого отчёта «dev совпал» относится исключительно к исходной операции.
- В новой операции не запускались tests/probes с исполнением задания, реальные run, модели, авторизация или установка. Прежние workspace и `/tmp` прочитаны, но не изменены; соседние отчёты не читались. Состояние новых отчётов — завершённый пакет после восстановления, а не переименование старого failed в success.

### Post-study already-fixed — отдельно от выводов на study-source

По локально прочитанным `git show` (не по соседним отчётам):

1. `86f5e0756e67fa7a18e925d77b7d2728db2f0627`: ранняя parallel-writer isolation уже перенесена в authoring/validate (`src/graph.ts`, `src/parallel-isolation.ts`, frozen permissions при верификации плана). Это **already-fixed после study-source**; повторное внедрение не предлагается. Новые регрессии этого коммита здесь не запускались.
2. `3d8ba65ee84402c0e3b0587f70095b7847824a9f`: документирована верхнеуровневая reviewer binding к входной `artifactRevision` (`skills/dynamic-workflows/SKILL.md`, `skills/dynamic-workflows/references/authoring.md`). Это **already-fixed после study-source**, не новое исправление provider/cancel.

Эти два контекстных исправления не входят в `findingCount=7` на `e15bc407…` и не устраняют R13-B01. Их учёт не меняет исследуемую базу и не означает исполнения тестов публикационной ревизии.

## Coverage и границы доверия

| Граница | Что проверено | Что это не доказывает |
|---|---|---|
| Граф → frozen config → SDK | Явные model/thinking, tools, permissions, schema; отказ removed `xai-auth`; отсутствие автозагрузки AGENTS/extensions; фиксированные skills | Не защита от владельца ОС, изменения SDK или вредоносного локального процесса |
| SDK → transport | `maxRetries:0`, SSE Codex, native xAI, числовые HTTP-факты; отдельно настоящий Bedrock transport к loopback | Не права/квоты аккаунта и не качество live-модели; остальные API не проверены исчерпывающе |
| SDK → credentials | Обёртка исходного lock, pre-abort, abort в lock wait, successful/failed refresh, межпроцессная сериализация | Не серверная ротация и не crash-/power-loss durability |
| Worker → supervisor IPC | Курированные события, закрытая failure schema, отсутствие сырого stderr, единственный terminal result, первая ошибка не заменяется | IPC — доверенный локальный исполнитель, не криптографическое доказательство происхождения сообщения |
| Отмена → session → child | Очистка очередей, abort/idle/dispose; настоящий pi child + активный SDK bash при cancel и потере IPC-родителя | Не гарантированный откат эффекта, не остановка всех произвольно daemonized процессов |

`read-only` означает запрет `bash/write/edit`, а не confinement чтения. `workspace-write` и `unrestricted` не ограничивают пути/сеть на уровне ОС (`src/catalog.ts:85-95`, `src/pi-worker.ts:108-116`, `PROJECT_INFO/service.md:163-166`). Это явно документированная граница, **не новая уязвимость**. `config.systemPrompt` может явно заменить роль; недоверенные вход/результаты инструментов сами по себе не меняют frozen allowlist. Скрытых approvals/бюджетов как рекомендаций здесь нет.

## Findings

### R13-B01 — bug — Bedrock сохраняет скрытые повторы HTTP

**Приоритет:** высокий для инварианта «одна transport-попытка», применимость ограничена API `bedrock-converse-stream`. Уверенность высокая в offline-воспроизведении; частота реальных отказов не исследовалась.

**Место на данной ревизии:** `src/pi-worker.ts:164` и **`src/pi-worker.ts:223-236`**. Код отключает retry сессии и передаёт общий `maxRetries:0`, но считает этого достаточным для всех API, кроме специально обработанного Codex. `src/model-runtime.ts:34-38` не ограничивает каталог только этими проверенными маршрутами. Версии закреплены в `package-lock.json:104-106,983-993`.

**Причина в установленной зависимости:** `node_modules/@earendil-works/pi-ai/dist/api/bedrock-converse-stream.js:47-120,126,155-156` создаёт `BedrockRuntimeClient(config)` без `config.maxAttempts` и без использования `options.maxRetries`. Промежуточный `api/simple-options.js:30` поле сохраняет: оно не теряется в Dynamicwf, а не применяется Bedrock adapter. AWS SDK `dist-cjs/runtimeConfig.js:60` выбирает собственные maxAttempts из конфигурации/среды. Проверенный SHA256 Bedrock-файла: `13d6fec97d08f4303714aca50f3113ba0263706e961fc220ccb1cc023c520e6b`.

**Триггер:** один `executePiWorker`, API `bedrock-converse-stream`, нет graph retry policy, dummy endpoint возвращает 503. `AWS_MAX_ATTEMPTS` не задан. В fixture только `submit_result`, то есть повтор не вызван инструментами или output repair.

**Ожидание:** один запрос, затем ошибка `provider`; новую попытку вправе разрешить только явная политика графа. Это прямо заявлено в `PROJECT_INFO/retry-and-failures.md` (раздел HTTP) и `PROJECT_INFO/run-journal.md:135-137`.

**Наблюдение (E05, подтверждено двумя успешными запусками):**

| Сценарий | HTTP requests | Assistant turns | Исход |
|---|---:|---:|---|
| 503, штатный AWS default | **3** | **1** | `provider`, HTTP 503 |
| 400, контроль non-retryable | 1 | 1 | `provider`, HTTP 400 |
| 503, только fixture env `AWS_MAX_ATTEMPTS=1` | 1 | 1 | `provider`, HTTP 503 |
| Abort после первого запроса | 1 | 1 | `cancelled` |

**Воспроизведение:** приложение A содержит точный самодостаточный fixture и команду. Подмена только endpoint/auth на dummy; retry-механизм AWS, сессия и worker настоящие. Сервер слушает исключительно `127.0.0.1`; `env -i`, пустой временный HOME, `InMemoryCredentialStore`, `modelsPath:null`, `allowModelNetwork:false` исключают чтение рабочего аккаунта и внешний вызов. SDK Bedrock не использует `providerFetch` этого worker, поэтому нужен локальный сервер, а не обещание перехватить произвольный fetch.

**Влияние:** фактическое число HTTP-отправок отличается от числа попыток/ходов графа; возможна повторная отправка запроса после неопределённого transport-исхода. Fixture доказывает повтор, **не** списание денег, реальную обработку модели или повторное выполнение локального write. Текстовые/числовые ошибки не позволяют вывести эти последствия. Отмена в проверенном retry-сценарии работает.

**Контрдоказательства:** E01/E04 подтверждают одну HTTP-попытку на Codex/OpenAI/xAI, E02 — корректные явные retries графа и запрет повтора пишущего задания после write. Поэтому нельзя снова объявлять сломанным отключение retry на всех провайдерах. Это новый непокрытый маршрут за тем же общим контрактом, а не регрессия исправленного Codex WebSocket fallback.

**Минимальное изменение (не выполнено):** на закреплённой границе Bedrock преобразовать явный `options.maxRetries:0` в AWS `maxAttempts:1` (в общем случае attempts = retries + 1), не полагаться на ambient AWS config. Возможен точечный версионированный SDK patch по существующей проверяемой схеме установки; не требуется менять scheduler или добавлять лимиты графа. Расширить offline compatibility test на данный API и уточнить документацию до исправления.

**Риск:** изменение затрагивает зависимость и её API; patch должен проверять точную версию/байты, как уже делает bash-signal installer. Глобально устанавливать `AWS_MAX_ATTEMPTS` в пользовательской среде не предлагается.

**Приёмка:** 503/429 и transport failure дают одну отправку на один worker turn без graph policy; explicit graph retry создаёт отдельные учтённые попытки; cancel останавливает последующие отправки. Codex SSE и native xAI single-request контроли остаются зелёными. Сеть провайдера для этой проверки не нужна.

### R13-I01 — idea — не утверждать неизменность credentials по любому ModelsError

**Факт кода:** `src/pi-worker.ts:155-160` для любого `ModelsError` с кодом `oauth/auth` сообщает `Stored credentials were not replaced.` Обёртка не получает отдельного подтверждения такого исхода. Закреплённый SDK сначала может сохранить refreshed credential и только затем вызвать `oauth.toAuth`: `pi-ai/dist/auth/resolve.js:77-113`.

**Dummy-контрпример E07:** настоящий `AuthStorage` + `createWorkflowModelRuntime`, fake refresh возвращает новую dummy credential, затем fake `toAuth` бросает исключение. Получено: `refreshes=1`, `fetches=0`, credential действительно изменена, публичная ошибка всё равно утверждает обратное. Произвольная строка fake-ошибки в публичную failure не попала. Точный fixture — приложение C.

**Почему idea, а не второй production bug:** отказ `toAuth` намеренно внедрён через разрешённую тестовую DI. У inspected native xAI и Codex `toAuth` просто возвращает access token; достижимость такого отказа на обычном native-маршруте не установлена. Ошибка persistence после успешной записи тоже здесь не воспроизводилась. Нельзя выдавать данный fault injection за наблюдавшийся сбой реального OAuth.

**Минимальное изменение:** убрать безусловное последнее предложение либо выдавать утверждение о неизменности только при наблюдённом исходе store. Сохранить нейтральное `not-dispatched` относительно модельного запроса и редактирование чувствительных ошибок. Риск мал: меняется публичная диагностика/её тесты, не credential ownership. Приёмка: E07 не утверждает «не заменены», а existing successful/failed/aborted-refresh tests сохраняют текущие результаты. Никакого автоматического повторного refresh или замены credentials не добавлять.

### R13-U01 — unknown — credential persistence при forced kill не доказана graceful-abort тестами

**Известно:** `preserveCredentialPersistence` защищает завершившуюся mutation от caller abort, но не от остановки процесса (`src/credential-persistence.ts:12-25`). SDK auth resolution использует внешний abort race (`pi-ai/dist/auth/resolve.js:26-28`); существующий тест прямо дожидается фонового сохранения после отклонения внешнего Promise (`tests/oauth-refresh-abort.test.ts:36-50`). Worker cleanup дожидается session, если она уже создана (`src/pi-worker.ts:358-366`); родитель имеет 2-секундную TERM→KILL cleanup escalation (`src/process-client.ts:29-49`). Это **cleanup deadline после cancel**, не скрытый runtime budget задания.

**Не установлено:** существует ли на данном стеке практически достижимое окно, когда уже завершённая ротация теряется именно при обычном cancel через настоящий worker child; отдельно не проверены SIGKILL во время записи, filesystem error/power loss. Потеря токенов в этих условиях в данном исследовании **не воспроизведена**. E01 подтверждает исправление cooperative abort, E06 — корректное завершение активного bash; ни одна из них не заменяет crash-consistency проверку credentials.

**Следующая проверка, не выполнена:** только dummy provider/store и собственный child, явные barriers вокруг окончания refresh и завершения persistence; отдельно cooperative cancel и принудительное убийство fixture. Сравнить запись под исходной блокировкой, отсутствие успешного результата отменённому caller и отсутствие второго refresh. Сначала определить реально достижимое окно, а не добавлять retry/увеличивать deadline. Минимальное изменение сейчас — такой regression test/описание границы. Риск теста: искусственная асинхронная задержка store может не соответствовать синхронной записи закреплённого файлового backend; это нужно явно отделить. Критерий принятия гипотезы в bug — фактическая потеря завершённой mutation на реалистичном child lifecycle, а не только проигранный Promise race.

### R13-A01 — already-fixed — successful refresh переживает caller abort, failed refresh не стирает credential

`src/credential-persistence.ts:9-25` оставляет начавшуюся mutation под **исходной** блокировкой; в ожидании lock отмена ещё распространяется. После сохранения caller всё равно получает abort. `src/model-runtime.ts:16-18` применяет обёртку и к переданному store, и к локальному SDK store. `src/sdk-auth-storage.ts:11-23` проверяет точную версию/API private entry point.

E01 выполнила все шесть `oauth-refresh-abort` случаев: file/in-memory successful refresh + abort; failed refresh с/без abort; pre-abort/lock wait/ошибка mutation; две собственные дочерние Node с единственной ротацией под lock. В последнем случае одна ротация, оба читателя видят свежую dummy credential. SDK `auth/resolve.js:20-24,40-54` также не делает скрытый env fallback после ошибки сохранённого credential. Старую потерю результата refresh при cooperative cancel **не переоткрывать**. Граница — R13-U01, не гарантии live token rotation.

### R13-A02 — already-fixed — reviewed OpenAI/Codex/xAI: HTTP observation и запрет скрытых retries действуют

`src/pi-worker.ts:223-262` создаёт наблюдение на каждый assistant request, ставит `maxRetries:0`, принудительно использует SSE для Codex, не подменяет global fetch. Публично остаются только `status`/валидный `Retry-After`; body, cookie, произвольные headers не переносятся (`src/provider-response.ts`, `src/provider-failure-message.ts`). E01 проверила Codex 200/401/403/429/503 по одному HTTP-вызову, OpenAI 503, отсутствие старого статуса после нового transport failure. E04 проверила native xAI 429 и `xhigh` в реальном сформированном request body при dummy transport. `sentReasoning` не подставляется из requested вместо наблюдения (`src/pi-worker.ts:239-243,275-281`).

E02 показала explicit policy 429→503→401 с тремя отдельно допущенными попытками, без SDK-внутреннего умножения OpenAI-запросов; отдельный test исполнил write перед invalid output и не повторил задание. Отсутствие policy, неизвестные эффекты и cancel не разрешают graph retry (`src/retry-policy.ts:17-24`). Контрграница — **R13-B01**, поэтому обобщение этих успешных тестов на все API неверно.

### R13-A03 — already-fixed — model/thinking/tools и доставка skills проверяются до inference

`src/execution-plan.ts:43-54` отвергает **недоступную явно выбранную** модель и неподдерживаемый явный thinking, без подмены запрошенного выбора. Это не требование всегда задать модель в черновике: при отсутствии `config.model`/`defaultModel` подготовка выбирает предпочтительную модель каталога либо первую (`:44-48`), затем замораживает конкретный ID. Только неявный role thinking default адаптируется до freeze. `src/pi-worker.ts:145-148,207-218` сверяет фактические model/thinking/tools после создания SDK session. Старый adapter не мигрирует молча: `src/model-runtime.ts:14-15`, `src/pi-worker.ts:147-148`.

`src/pi-worker.ts:164-173` отключает extensions/project context/templates и загружает только frozen skills. Непустые skills требуют read/bash до обращения к runtime/auth (`src/pi-worker.ts:114-115`, `src/catalog.ts:31-35`): актуальное исправление `2d9f9d2`, а не старый main. E01/E02 выполнили проверки clamped thinking, недоступной модели, read-only+bash, frozen prompt и отсутствия автоматически найденного AGENTS/SYSTEM, traversal/symlink, чтения frozen skill после удаления источника. E04 проверила сужение image capabilities и отказ до dispatch. Это не доказывает качество следования skill моделью и не ограничивает ОС-права разрешённого bash.

### R13-A04 — already-fixed — cancel/IPC/output repair закрывают проверенные гонки

`src/pi-worker.ts:126-136,358-366`: закрыть допуск, clearQueue, abort, waitForIdle, dispose; ошибка cleanup имеет `effects:unknown`, а не безопасный retry. `src/pi-worker-process.ts:9-18,29-42`: SIGTERM/SIGINT/disconnect/EPIPE приводят к отмене, поздний result не публикуется. `src/process-client.ts:54-64` ждёт exit и drained pipes, а не только close; `:102-130` не передаёт сырой SDK stderr, хранит первую ошибку, запрещает сообщения после result.

E01 проверила cancel очередей/repair и неполный stdin; E03 — реальные IPC frames, дубли/post-result, malformed JSON, getter/закрытую failure schema и отсутствие секретоподобных dummy строк. E06 дополнительно использовала **настоящие `runPiProcess` и `pi-worker-process.ts`** с dummy model runtime через preload и активным SDK bash: после parent cancel и после SIGKILL только собственного IPC-parent fixture перестала наблюдать живыми оба записанных PID — worker и активный bash (`ps`; zombie не считается живым). Здесь SIGKILL применён к fixture-родителю, **не** к worker; это не доказательство очистки потомков при SIGKILL самого SDK.

`submit-only` оставляет один submit tool после settlement исходной фазы (`src/pi-worker.ts:317-330`); E01 проверила запрет всех семи исходных tools и отсутствие повторной записи. Текущий bash-signal patch установлен: SHA256 `dist/core/tools/bash.js` = `626ad6cd341a436ce6c2e8d0f6769c72574bfefdf25e0f31a36a9be12f4802a1`, совпадает с `scripts/apply-sdk-bash-signal.mjs:14-17`; E02 выполнила bash-signal-worker. Нестабильность полного набора из known-issues не объявляется исправленной на основании этого узкого успешного прогона.

## Experiments — исторически выполнено, а не предложено

Это команды **исходной операции**, не инструкция повторно использовать старые каталоги. Все логи оставлены во временном каталоге `/tmp/r13-security-provider-Q20Xv5`; сырые логи не включены в отчёты. Для исторических команд ниже `DWF_DEV` — разрешённый dev на тогдашней исходной ревизии, `P=/tmp/r13-security-provider-Q20Xv5`. `HOME="$P/home"`, `TMPDIR="$P/tmp"` принадлежат fixture. E01 использовала эти HOME/TMPDIR; E02–E07 дополнительно запускались с `env -i PATH="$PATH"` и только явно указанными fixture variables.

| ID | Команда из dev (после указанной изоляции env) | Исход и граница |
|---|---|---|
| E00 | `pwd; git rev-parse HEAD; git log -18 --oneline`; targeted `git log -- src/...`; Python byte comparison tracked files | HEAD совпал; 185 файлов равны. Docs прочитаны до исследования кода. Установленный пользовательский runtime не управлялся |
| E01 | `node --import tsx --test --test-concurrency=1 tests/oauth-refresh-abort.test.ts tests/pi-worker.test.ts tests/provider-response.test.ts tests/native-xai.test.ts tests/process-client.test.ts` | **86/86**, fail/skip/cancel=0; около 25.0 s. Dummy auth/models, временные процессы/БД, только local HTTP для UI-projection fixture |
| E02 | `node --import tsx --test --test-concurrency=1 tests/provider-retry.test.ts tests/retry-worker.test.ts tests/bash-signal-worker.test.ts tests/execution-plan.test.ts` | **28/28**, fail/skip/cancel=0; около 11.9 s. Включает настоящую локальную запись и её неповторение |
| E03 | `node --import tsx --test --test-concurrency=1 --test-name-pattern='malformed worker stdout\|worker IPC\|failure protocol is closed' tests/execution-failure.test.ts` | **23/23** включая 19 IPC subtests, fail/skip/cancel=0; около 3.1 s. Не полный failure suite |
| E04 | `node --import tsx --test --test-concurrency=1 --test-name-pattern='PNG and JPEG\|malformed and unsupported\|incompatible restored\|frozen image requirements' tests/repair-core.test.ts` | **4/4**, fail/skip/cancel=0; около 5.7 s. xAI request serialization/vision/capability drift на dummy fetch, не live provider |
| E05 | `node --import tsx "$P/bedrock-retry.mjs"` (приложение A) | 4 сценария; 3/1/1/1 HTTP requests; по одному assistant turn. Два успешных запуска. Первоначальный bootstrap через CommonJS `require.resolve` отклонён ESM-only exports (`ERR_PACKAGE_PATH_NOT_EXPORTED`); исправлен только временный fixture на абсолютные SDK ESM imports, затем проверки прошли |
| E06 | `R13_SOURCE="$DWF_DEV" NODE_OPTIONS="--import=$P/cancel-preload.mjs" node --import tsx "$P/worker-cancel.mjs"` (приложение B) | Оба сценария подтвердили `workerGone` и `activeBashGone`; меняется только runtime DI fixture, lifecycle production-код настоящий; нет вызова модели/реального run |
| E07 | `node --import tsx "$P/auth-outcome.mjs"` (приложение C) | 1 refresh, 0 fetch; dummy credential changed, public says unchanged. Только fault injection `toAuth`, не найденный native OAuth crash |

141 — сумма тестов E01–E04, не число уникальных контрактов и не live calls. Фикстуры имеют собственные assertions и очистку только своих файлов/процессов; E05 проверяет счётчики и rejected outcome, а конкретные `code/status` дополнительно взяты из сохранённых итоговых записей. E06 проверяет отсутствие живых процессов по двум записанным fixture PID (worker и активный bash), не снимок всех потомков ОС и не точную одновременность их завершения. Их технические таймауты ожидания не являются рекомендацией лимитировать workflow.

## Проверки новой операции — без повторного исполнения E00–E07

| ID | Выполненная команда / анализ | Результат и граница |
|---|---|---|
| C00 | `shasum -a 256` двух старых отчётов; `json.loads`; чтение `r13-actions.json`; Python SHA256 | Оба хеша и размеры совпали с retainedEvidence; 29 сохранённых команд. Обнаружен частичный пакет без приложений, не прежний успешный выход |
| C01 | `git rev-parse HEAD`; `git log -18 --oneline`; `nl -ba` / чтение указанных исходников, tests и документов; Python byte comparison старого/нового worktree; `git diff e15bc407… 3d8ba65… --` профильные пути; `git show` двух post-study commits | 185/185 tracked файлов совпали между worktrees; key provider/auth/cancel citations актуальны на study-source; dependency versions/SHA256 совпали; публикационный dev отдельно идентифицирован |
| C02 | Python: только regex summaries и разрешённые JSON-поля из собственных восьми логов; SHA256 четырёх `.mjs` и логов | 141/141 исторических тестов, E05–E07 согласуются с отчётами; fixture hashes совпали. Это revalidation сохранённых результатов, не новые прогоны |
| C03 | Python создаёт новые копии `.mjs` в `/tmp/r13-continuation-*`; `env -i PATH=… HOME=… TMPDIR=… node --check <new-copy>` для каждой | 4/4 syntax exit 0; код не исполнялся, SDK не импортировался |
| C04 | Python validation окончательных md/json: ID/classification/count, ссылки file:line, извлечение кодовых блоков и их SHA256; `git status --short`; финальные `shasum -a 256` | Проверки ID/count, диапазонов file:line, четырёх встроенных fixtures и перечня источников прошли; изменены только два отчёта. Окончательные хеши возвращаются через `submit_result`, не подменяются хешами старых файлов |

Новых regression test executions: **0**; новых HTTP / model / auth / cancel probes: **0**. Результаты на live provider, forced-kill persistence и полнота provider matrix остаются unknown.

## Already-fixed / refutations и нерешённые вопросы

- **Не переоткрывать:** graceful refresh preservation (A01), Codex SSE/no retry и sanitization (A02), frozen skill delivery/model/tool checks (A03), session cancel/IPC/repair и bash signal (A04).
- **Отдельно опровергнутая гипотеза:** в SDK GitHub Copilot найден `maxRetries:2` у enable-policy, но чтение `pi-ai/dist/auth/oauth/github-copilot.js:274-279,289-366` показало: этот путь вызывается интерактивным login, не worker refresh; refresh задаёт нулевой retry для catalog fetch. Поэтому это **не заявлено** скрытым retry Dynamicwf worker.
- UI ownership/control/await/disclosure fixes подтверждены как актуальная история (`e15bc40`, `fea2136`, `d72df5d`, `b04ef8d`, `1ee48ff`, `10d5cc6`) и known-issues; UI вне данной роли и заново не расследовался.
- **Unknown:** forced-kill persistence (U01); полный набор API кроме проверенных; реальный серверный OAuth rotation outcome; live sent reasoning/доступ аккаунта; поведение произвольных detached/daemonized descendants после SIGKILL worker. Произвольные daemonize/враждебные локальные процессы не моделировались.
- Успешные узкие процессные проверки не устанавливают причину известной нестабильности полного `npm test` под нагрузкой. На Node 22.19 эти проверки здесь не повторялись.

## Источники

S01–S12 / пункты 1–11 относятся к исходной ревизии и историческому исследованию; ключевые ссылки перепроверены в C01. `node_modules` — просмотренные зависимости разрешённого dev, не Git-файлы worktree; SHA256 двух ключевых файлов повторно совпали при continuation. Post-study источники отделены ниже. Дата доступа ко всем: 2026-09-20. Первичных внешних URL нет: сеть для исследования не требовалась.

1. `AGENTS.md`; `PROJECT_INFO/architecture.md`; `PROJECT_INFO/development.md`; `PROJECT_INFO/known-issues.md` — обязательные инварианты, закреплённый SDK patch, ограничения процессных tests.
2. `PROJECT_INFO/models-and-setup.md`; `PROJECT_INFO/retry-and-failures.md`; профильные разделы `PROJECT_INFO/run-journal.md:133-177`, `PROJECT_INFO/service.md:147-166`, `PROJECT_INFO/workspaces.md:121-135` — auth/catalog/model, HTTP/no hidden retry, permissions и cancel.
3. `src/pi-worker.ts:108-173,179-218,223-281,311-366`; `src/pi-worker-process.ts:6-43`; `src/process-client.ts:20-64,70-143`; `src/process-groups.ts` — основная исследованная граница.
4. `src/credential-persistence.ts:1-29`; `src/sdk-auth-storage.ts:11-23`; `src/model-runtime.ts:12-38`; `src/catalog.ts:31-35,58-95`; `src/execution-plan.ts:33-80,109-149`; `src/execution-types.ts:11-65`; `src/retry-policy.ts:17-28`.
5. `src/request-observation.ts`; `src/provider-response.ts`; `src/provider-failure-message.ts`; `src/check-worker-process.ts`; участки `src/run-controller.ts:26-86,230-247`, `src/run-runtime.ts:343-357` — разрешения, диагностика и границы наблюдения групп.
6. `tests/oauth-refresh-abort.test.ts`; `tests/pi-worker.test.ts`; `tests/process-client.test.ts`; `tests/provider-response.test.ts`; `tests/provider-retry.test.ts`; `tests/retry-worker.test.ts`; `tests/native-xai.test.ts`; `tests/repair-core.test.ts:83-329`; `tests/execution-failure.test.ts:17-110`; `tests/execution-plan.test.ts`; `tests/bash-signal-worker.test.ts` — исполнявшиеся профильные сценарии.
7. `package.json`; `package-lock.json:104-123,983-999`; `patches/pi-coding-agent-0.85.1-bash-signal.patch`; `scripts/apply-sdk-bash-signal.mjs:5-35` — версии и проверяемые байты.
8. `node_modules/@earendil-works/pi-ai/dist/api/bedrock-converse-stream.js:47-156`; `api/simple-options.js:17-34`; `node_modules/@aws-sdk/client-bedrock-runtime/dist-cjs/runtimeConfig.js:60` — корень R13-B01.
9. `node_modules/@earendil-works/pi-ai/dist/auth/resolve.js:20-129`; `node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js:76-155,234-257,369-410`; `core/model-runtime.js:73-108,339-353`; `core/tools/bash.js:35-115`; `utils/shell.js:165-211` — auth/cancel/lifecycle.
10. SDK `auth/oauth/xai.js:169-189`, `auth/oauth/openai-codex.js:445-450`, `auth/oauth/github-copilot.js:274-390`, `providers/github-copilot.js` — native outcomes и refutation login-vs-worker retries.
11. `git log -18 --oneline`; targeted history `src/pi-worker.ts`, `src/credential-persistence.ts`, `src/model-runtime.ts`, `src/process-client.ts`: в частности `61fdb9a` (HTTP facts/retries), `20b9758` (reservation), `deabd6d` (credential preservation), `2d9f9d2` (skills). Выводы о текущем поведении сделаны по текущему коду/проверкам, не по commit subject.

12. Собственные retained md/json и `r13-actions.json` — хеши, частичный исход и происхождение описаны в continuation provenance; команды сами по себе не доказывают успех.
13. Собственные сохранённые E01–E07 fixture/log artifacts — SHA256 и очищенные сводки в JSON, без сырых логов. Дата read-only revalidation: 2026-09-20.
14. `git show 86f5e0756e67fa7a18e925d77b7d2728db2f0627` (выбранные source/docs) и `git show 3d8ba65ee84402c0e3b0587f70095b7847824a9f -- skills/dynamic-workflows/SKILL.md skills/dynamic-workflows/references/authoring.md` — **только post-study**; соседние исследовательские файлы не открывались.

## Приложения — точные сохранённые offline fixtures

Код ниже прочитан из собственных сохранённых файлов, а не восстановлен по догадке. Четыре блока содержат точные байты финальных исторических scripts; SHA256 сверены с прежним JSON. Код не является рекомендацией запускать старый workspace, читать реальные credentials или вызывать внешнего провайдера.

Для **нового** воспроизведения, отдельно от проверок этой операции:

1. `DWF_DEV` должен указывать на локальную исследуемую копию исходной ревизии с уже имеющимися закреплёнными зависимостями (либо предварительно подтверждёнными идентичными профильными файлами). Не устанавливать пакеты и не менять исходники.
2. Создать новый каталог и сохранить в него четыре нижних блока под указанными именами, сохранив финальный LF; сравнить SHA256. Никогда не читать старый `active-path` и не переиспользовать исторический `/tmp/r13-security-provider-Q20Xv5` для записи.

```sh
P=$(mktemp -d /tmp/r13-repro-XXXXXX)
mkdir "$P/home" "$P/tmp"
# Сохранить четыре блока ниже в "$P/<имя>.mjs"; DWF_DEV задан явно.
cd "$DWF_DEV"
env -i PATH="$PATH" HOME="$P/home" TMPDIR="$P/tmp" node --import tsx "$P/bedrock-retry.mjs"
env -i PATH="$PATH" HOME="$P/home" TMPDIR="$P/tmp" R13_SOURCE="$DWF_DEV" NODE_OPTIONS="--import=$P/cancel-preload.mjs" node --import tsx "$P/worker-cancel.mjs"
env -i PATH="$PATH" HOME="$P/home" TMPDIR="$P/tmp" node --import tsx "$P/auth-outcome.mjs"
```

Это **документированные команды воспроизведения, не вновь выполненные команды**. E05 использует только loopback и dummy AWS auth; E06 переопределяет runtime исключительно внутри собственного child; E07 использует созданный самой fixture dummy store. Технические ожидания E06 нужны только fixture. Не переиспользовать её PID/каталоги после завершения; не превращать её cleanup helper в средство управления пользовательскими процессами.


### Приложение A — E05 / Bedrock retry

Одно выполнение worker на сценарий; никакой повторяющей логики в самом fixture нет. 503-default намеренно утверждает текущее дефектное число 3: после исправления этот assertion должен измениться на 1 в новой regression-проверке.

#### `bedrock-retry.mjs`

SHA256: `2c218f89d5accbae7fa562cd570b3b7c78ee64e5918da8a4a9dddb05d6f1c213`.

```javascript
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
const root = process.cwd();
const { ModelRuntime } = await import(pathToFileURL(join(root,'node_modules/@earendil-works/pi-coding-agent/dist/index.js')));
const { InMemoryCredentialStore, InMemoryModelsStore } = await import(pathToFileURL(join(root,'node_modules/@earendil-works/pi-ai/dist/index.js')));
const { executePiWorker } = await import(pathToFileURL(join(root, 'src/pi-worker.ts')));
process.env.AWS_BEDROCK_FORCE_HTTP1 = '1';
process.env.AWS_BEDROCK_SKIP_AUTH = '1';
for (const mode of ['503-default', '400-control', '503-maxAttempts1', 'cancel-after-first']) {
  const directory = await mkdtemp(join(process.env.TMPDIR, 'r13-bedrock-'));
  if (mode === '503-maxAttempts1') process.env.AWS_MAX_ATTEMPTS = '1'; else delete process.env.AWS_MAX_ATTEMPTS;
  const controller = new AbortController();
  let requests = 0, streamStarts = 0;
  const server = createServer((incoming, response) => {
    ++requests; incoming.resume();
    response.writeHead(mode === '400-control' ? 400 : 503, {'content-type': 'application/json', 'x-amzn-errortype': mode === '400-control' ? 'ValidationException' : 'ServiceUnavailableException'});
    response.end(JSON.stringify({message: 'r13 dummy error'}));
    if (mode === 'cancel-after-first') controller.abort();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const runtime = await ModelRuntime.create({credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false});
    runtime.registerProvider('r13-local', {api: 'bedrock-converse-stream', baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'r13-dummy', models: [{id: 'r13-model', name: 'r13-model', reasoning: false, input: ['text'], contextWindow: 10000, maxTokens: 1000, cost: {input:0,output:0,cacheRead:0,cacheWrite:0}}]});
    const request = {version:1, cwd:directory, resourceDirectory:join(directory,'resources'), sessionDirectory:join(directory,'sessions'),task:'Dummy offline task',input:null,config:{model:{provider:'r13-local',id:'r13-model'},thinking:'off',tools:[],skills:[],permission:'read-only',session:'fresh',systemPrompt:'Use submit_result.',outputSchema:{type:'object'}}};
    let failure;
    await assert.rejects(executePiWorker(request,{modelRuntime:runtime,signal:controller.signal,onEvent(e){if(e.type==='turn_start')streamStarts++;}}), e => {failure=e.failure; return true;});
    console.log(JSON.stringify({mode,requests,assistantTurns:streamStarts,code:failure.code,effects:failure.effects,providerResponse:failure.providerResponse}));
    assert.equal(requests, mode === '503-default' ? 3 : 1);
    assert.equal(streamStarts, 1);
  } finally {
    server.closeAllConnections(); await new Promise(r=>server.close(r)); await rm(directory,{recursive:true,force:true});
  }
}
```

### Приложение B — E06 / реальный worker child и активный SDK bash

Сначала preload, затем driver. Оба процесса и все PID принадлежат fixture; результаты ограничены cooperative lifecycle и потерей IPC-parent, а не SIGKILL самого worker.

#### `cancel-preload.mjs`

SHA256: `e6d5f3e8bf682cbae96833eaf0f34ad35d4a4916151a51dfe86194760443d041`.

```javascript
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
if (process.argv[1]?.endsWith('pi-worker-process.ts')) {
  const root = process.env.R13_SOURCE;
  const { ModelRuntime } = await import(pathToFileURL(join(root,'node_modules/@earendil-works/pi-coding-agent/dist/index.js')));
  const { InMemoryCredentialStore, InMemoryModelsStore, createAssistantMessageEventStream } = await import(pathToFileURL(join(root,'node_modules/@earendil-works/pi-ai/dist/index.js')));
  const runtime = await ModelRuntime.create({ credentials:new InMemoryCredentialStore(), modelsStore:new InMemoryModelsStore(), modelsPath:null, refreshOnCreate:false, allowModelNetwork:false });
  let calls=0;
  runtime.registerProvider('r13-fixture',{api:'openai-completions',baseUrl:'https://offline.invalid',apiKey:'r13-dummy',models:[{id:'model',name:'model',reasoning:false,input:['text'],contextWindow:10000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],streamSimple(model){
    const stream=createAssistantMessageEventStream();
    const result={role:'assistant',provider:model.provider,model:model.id,api:model.api,timestamp:1,stopReason:'toolUse',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},content:++calls===1?[{type:'toolCall',id:'bash',name:'bash',arguments:{command:'printf "%s" "$$" > r13-bash.pid; while :; do sleep 1; done'}}]:[{type:'toolCall',id:'done',name:'submit_result',arguments:{answer:42}}]};
    queueMicrotask(()=>{stream.push({type:'start',partial:result});stream.push({type:'done',reason:'toolUse',message:result});});return stream;
  }});
  ModelRuntime.create=async()=>runtime;
}
```
#### `worker-cancel.mjs`

SHA256: `414714d3b2596c3f3a50f73c6ee264acd14a347e1407782c457c2e5be316faef`.

```javascript
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
const root=process.env.R13_SOURCE;
const { runPiProcess }=await import(pathToFileURL(join(root,'src/process-client.ts')));
const request = directory=>({version:1,cwd:directory,resourceDirectory:join(directory,'resources'),sessionDirectory:join(directory,'sessions'),task:'fixture',input:null,config:{model:{provider:'r13-fixture',id:'model'},thinking:'off',tools:['bash'],skills:[],permission:'workspace-write',session:'fresh',systemPrompt:'fixture',outputSchema:{type:'object'}}});
const live=pid=>{try{return !execFileSync('ps',['-p',String(pid),'-o','stat='],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim().startsWith('Z');}catch{return false;}};
const kill=pid=>{try{process.kill(pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}};
async function until(fn){for(let i=0;i<400;i++){const result=await fn();if(result)return result;await sleep(25);}throw Error('fixture wait timed out');}
if(process.argv[2]==='parent') {
  await runPiProcess(request(process.argv[3]),{onStarted:pid=>process.send({pid})});
  throw Error('fixture unexpectedly completed');
} else {
  for(const mode of ['cancel','disconnect']) {
    const directory=await mkdtemp(join(process.env.TMPDIR,'r13-worker-cancel-'));
    let worker,bash,parent,settled;const controller=new AbortController();
    try{
      if(mode==='cancel')settled=runPiProcess(request(directory),{signal:controller.signal,onStarted:pid=>worker=pid}).then(v=>({v}),e=>({failure:e.failure}));
      else {
        parent=spawn(process.execPath,['--import',join(root,'node_modules/tsx/dist/loader.mjs'),process.argv[1],'parent',directory],{cwd:root,env:process.env,stdio:['ignore','ignore','ignore','ipc']});
        parent.on('message',m=>worker=m.pid);
      }
      bash=await until(async()=>{try{return Number(await readFile(join(directory,'r13-bash.pid'),'utf8'))||false;}catch{return false;}});
      assert.ok(worker && live(worker) && live(bash));
      if(mode==='cancel') {
        controller.abort();const result=await settled;assert.equal(result.failure.code,'cancelled');assert.equal(result.failure.effects,'unknown');
      } else { const exit=once(parent,'exit');parent.kill('SIGKILL');await exit; }
      await until(()=>!live(worker)&&!live(bash));
      console.log(JSON.stringify({mode,workerGone:true,activeBashGone:true}));
    }finally{
      controller.abort();if(parent?.exitCode===null&&parent?.signalCode===null)parent.kill('SIGKILL');
      if(worker&&live(worker))kill(worker);if(bash&&live(bash))kill(bash);await settled;await rm(directory,{recursive:true,force:true});
    }
  }
}
```

### Приложение C — E07 / диагностика после успешной credential mutation

Fault injection `toAuth`; синтетические строки `R13_DUMMY_*` не являются credentials аккаунта. Это основание idea R13-I01, не доказательство достижимости штатного native OAuth сбоя.

#### `auth-outcome.mjs`

SHA256: `8c8d84186d43eb7c47f31b14161c0e89670cb21cbce78336165aa3604b54e92e`.

```javascript
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp,rm } from 'node:fs/promises';
const root=process.cwd();
const { InMemoryModelsStore }=await import(pathToFileURL(join(root,'node_modules/@earendil-works/pi-ai/dist/index.js')));
const { loadSdkAuthStorage }=await import(pathToFileURL(join(root,'src/sdk-auth-storage.ts')));
const { createWorkflowModelRuntime }=await import(pathToFileURL(join(root,'src/model-runtime.ts')));
const { executePiWorker }=await import(pathToFileURL(join(root,'src/pi-worker.ts')));
const directory=await mkdtemp(join(process.env.TMPDIR,'r13-auth-outcome-'));
try {
  const store=(await loadSdkAuthStorage()).create(join(directory,'fixture-credentials.json'));
  const old={type:'oauth',access:'R13_DUMMY_OLD',refresh:'R13_DUMMY_REFRESH',expires:0};
  const fresh={...old,access:'R13_DUMMY_NEW',expires:Date.now()+3600000};
  await store.modify('xai',async()=>old);
  const runtime=await createWorkflowModelRuntime({credentials:store,modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:true});
  let refreshes=0,fetches=0;
  runtime.registerNativeProvider({...runtime.getProvider('xai'),auth:{oauth:{name:'dummy',login:async()=>old,refresh:async()=>{refreshes++;return fresh;},toAuth:async()=>{throw Error('R13_DUMMY_DERIVATION_FAILURE');}}}});
  const request={version:1,cwd:directory,resourceDirectory:join(directory,'resources'),sessionDirectory:join(directory,'sessions'),task:'fixture',input:null,config:{model:{provider:'xai',id:'grok-4.6'},thinking:'xhigh',tools:[],skills:[],permission:'read-only',session:'fresh',systemPrompt:'fixture',outputSchema:{type:'object'}}};
  let failure;
  await assert.rejects(executePiWorker(request,{modelRuntime:runtime,providerFetch:async()=>{fetches++;throw Error('network forbidden');}}),e=>{failure=e.failure;return true;});
  assert.equal((await store.read('xai')).access,fresh.access);
  assert.equal(refreshes,1);assert.equal(fetches,0);assert.match(failure.message,/Stored credentials were not replaced/);
  assert.doesNotMatch(JSON.stringify(failure),/R13_DUMMY/);
  console.log(JSON.stringify({refreshes,fetches,credentialChanged:true,publicSaysUnchanged:true,code:failure.code,phase:failure.phase,effects:failure.effects}));
}finally{await rm(directory,{recursive:true,force:true});}
```
