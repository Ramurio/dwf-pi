# r03 — Идентичность и жизненный цикл процессов Dynamicwf

## Metadata и итог

- **ID:** r03. **Тема:** ownership, PID reuse, spawn/ready/disconnect/exit/close, stale workers и процессные гонки.
- **Дата:** 2026-09-20. Среда новых проверок: Darwin arm64, Node `v26.8.1`.
- **Study-source:** `e15bc407da8753fd6b683c0aa4a68634e3c458a7` — HEAD фактического cwd узла.
- **Publication revision:** `3d8ba65ee84402c0e3b0587f70095b7847824a9f` — отдельно проверенный HEAD разрешённого dev, **не** подмена исходной ревизии исследования.
- **Статус этого пакета:** complete; реализация не выполнялась. Записаны только два назначенных r03-отчёта в новом cwd.

**Подтверждены два bug:**

1. **R03-001:** на macOS `LC_ALL=C` у наблюдателя и Unicode-путь журнала приводят к ложной смерти живого supervisor: `observe` переводит workerless `await` в `interrupted` и снимает owner.
2. **R03-002:** независимое декодирование stdin chunks в обоих worker entrypoints повреждает UTF-8. Настоящий `check` успешно исполняет изменённый аргумент; у pi доказана порча разобранного request, без вызова модели.

Оба дефекта перепроверены **новыми собственными offline fixtures на точной study-source**. Три действующие защиты классифицированы как `already-fixed`; настоящее PID/PGID reuse и причина документированных flakes остаются `unknown`. Всего **7 находок: 2 bug, 3 already-fixed, 2 unknown, 0 idea**. Отдельные post-study изменения ниже не входят в этот счётчик.

## 1. Continuation provenance — что действительно сохранилось

Предыдущая операция `run-babf9b25-b8f5-45ad-b79c-2b2e5d31d2f0` имеет статус failed. Вход сообщает ошибку provider `Pi assistant turn failed: terminated`, effects unknown. **Это не доказательство процессной гонки Dynamicwf.**

В собственной старой ветви независимо проверено отсутствие **обоих** файлов `research/2026-09-20-astra-max/r03-process-lifecycle.{md,json}`. SHA256 отсутствующего файла вычислить нельзя; в JSON сохранены `exists:false`, `sha256:null`. Ранее успешного отчёта, который можно просто перенести, нет.

Прочитан только собственный retained evidence:

- `r03-actions.json`: 78 364 bytes, 17 записей, SHA256 `a5224f507de80cb3df3c4edeb8bf92e4b66a1f0742b1ed7441938b88c030cc3c`.
- Это **команды без tool outputs**. Последняя команда содержит частичный черновик отчёта и обрывается на `print(json`. Старый writer не исполнялся заново, а наличие черновика не выдано за успешную публикацию.
- Сохранились два собственных fixture-скрипта и два файла результатов тестов. Они прочитаны и хешированы **без записи в старые пути**. Байты скриптов совпали с heredoc в retained commands.

| Материал | SHA256 | Что перенесено |
|---|---|---|
| `/tmp/r03-baseline-I9DDKK/results.tap` | `a59bfbb4be328d34d752564374f920493f002997bbfbb63335c94a3bab63a0b7` | E01: 27 pass, 0 fail/cancel/skip, 74.315 s |
| `/tmp/r03-focused-8nckiV/results.tap` | `5d3caee8b404f03429863a74d42f5aad87b605814afa312e022a00beceb5cd51` | E02: 30 pass, 0 fail/cancel/skip, 8.828 s |
| `/tmp/r03-probes-QXUlUq/locale.mjs` | `8878ebb3f32314796129b6841a3cbdd89323006dede328dfd724d820c3460f90` | Полный fixture R03-001, приложение A |
| `/tmp/r03-probes-QXUlUq/utf8.mjs` | `a278a8d8a7e75201b37318c3a82bb04fb834f7f677f0c400ac728484d577c16a` | Полный fixture R03-002, приложение B |

**Перенесено:** устойчивые ID R03-001…007, исторические результаты 57 проверок, схемы fixtures. **Перепроверено:** источники и ссылки; байты профильных файлов старой ветви, нового cwd, dev и Git-базы; два дефекта в свежем `/tmp/r03-cont-v1-HvdYCw`; механизм locale отдельным OS-контролем. **Добавлено:** явное разделение ревизий, provenance, новые результаты и финальные файлы.

Исторические тесты **не перезапускались ради формального успеха**. Их shell exit code независимо не сохранился: черновик говорит 0, файлы результатов подтверждают pass/fail, но не сам код оболочки. Для старых E03–E06 есть команды/утверждения черновика, не полный исходный stdout. Поэтому недостающая прямая проверка двух дефектов выполнена в E08/E09, механизм `ps` — в E10.

В новом cwd нет `node_modules`. Для E08/E09 создана **новая временная копия `src` и `package.json` именно из cwd**; каждый скопированный исходник побайтно сверен с `git show HEAD:<path>`. Внутри копии — symlink на существующие зависимости разрешённого dev. Так более поздние изменения graph/compiler/execution-plan не попали в проверку study-source. Ничего не устанавливалось; установленный runtime и реальные run не затрагивались. Само содержимое всех установленных зависимостей заново не аудитировалось.

## 2. Coverage и фактическая модель жизненного цикла

Сначала прочитаны `AGENTS.md`, architecture/development/known-issues, профильные run-journal/reconciliation/execution-plan и git log. Затем исходники и тесты. Соседние исследовательские отчёты не читались; веб не использовался.

| Область | Покрытие | Граница |
|---|---|---|
| `run-controller`, `supervisor` | Полные файлы; профильные ownership API `run-store`; исторические E01/E02, свежий E08 | Проверена реальная workerless await-сессия, не живой пользовательский run |
| `process-client`, pi/check entrypoints | Полные файлы; admission/cleanup `run-runtime`, профильные `pi-worker`; E01/E02, E09 | Pi request намеренно невалидной версии, до auth/model |
| Groups/stale workers | Parser, observer, pending/group-token fences, полный `process-groups.test.ts` | Seeded чужая fixture-группа ≠ настоящий kernel PID reuse |
| Races/flakes | Прочитаны профильные тесты и известные ограничения; сохранённые результаты сверены | Полный npm test, Git recovery и CLI handoff в continuation не запускались |

Цепочка, установленная по коду:

1. `reserveLaunch` атомарно пишет owner token и launch provenance; `attachPid` отвергает другой PID к той же резервации (`src/run-store.ts:319-342`). Supervisor отсоединён от CLI; `RunController.close()` закрывает БД, не выполнение (`src/run-controller.ts:89-97,193-227`).
2. Supervisor прикрепляет PID **до** исполнения графа. Потеря owner на polling приводит к abort; heartbeat — не критерий смерти (`src/supervisor.ts:23-42`).
3. Runtime записывает `workerLaunch=reserved` и worker-token **до spawn**, затем синхронный `onStarted` сохраняет PID/pending group **до stdin.end** (`src/run-runtime.ts:240-242,281-285`; `src/process-client.ts:71-97,144-165`).
4. `ready` pi означает установленную bootstrap cancellation, **не** готовую модель/сессию. Parent не ждёт ready: допускающим барьером является spawn + синхронная запись PID. Child читает запрос до EOF (`src/pi-worker-process.ts:9-29`).
5. Terminal frame не равен settlement. Promise завершается после **exit и дренирования stdout/stderr**, не обязательно после `ChildProcess.close` (`src/process-client.ts:54-66,133-140`). Effect finalizer при отмене ждёт этот Promise (`src/run-runtime.ts:33-40`).
6. После settlement wrapper runtime проверяет группу. Непустая группа даёт `uncertain-effect/cleanup`; supervisor сохраняет ownership для дальнейшей сверки. Наблюдение пустой группы проверяет исходные token/group/key (`src/run-runtime.ts:348-356`; `src/supervisor.ts:54-64`; `src/run-store.ts:759-767`).

Это не обещание OS sandbox, атомарного «exactly once» внешних действий или обнаружения потомка, покинувшего группу. Последняя граница уже явно описана в `PROJECT_INFO/reconciliation.md#groups`.

## 3. Findings

### R03-001 — bug: locale наблюдателя снимает владельца живого запуска

**Серьёзность:** medium. **Уверенность:** высокая для проверенной macOS.

**File:line этой ревизии:**

- `src/run-controller.ts:29-34,66-67`: оба вызова `ps` наследуют locale вызывающего процесса.
- `src/run-controller.ts:43-63`: сравнение текстового argv с сохранёнными script/owner/run/store.
- `src/run-controller.ts:229-264`: несовпадение становится `supervisorAlive=false`; без workers/unresolved groups записывается `markInterrupted`.
- `src/supervisor.ts:31-37`: живой supervisor затем отменяет исполнение при потере owner.

**Триггер:** журнал в каталоге с Unicode (`журнал`), run дошёл до `await` без workers; наблюдатель меняет `LC_ALL` на `C`. PID, owner, run, script и store не подменялись.

**Ожидалось:** изменение locale представления `ps` не меняет идентичность OS-процесса, статус waiting и ownership.

**Наблюдалось в новом E08:**

| Путь журнала | Жив перед observe | UTF-8 observe | C observe | Статус после C | Owner | Interrupted events |
|---|---:|---:|---:|---|---|---:|
| ASCII | да | true | true | waiting | сохранён | 0 |
| Unicode | да | true | false | interrupted | снят | 1 |

Во втором случае supervisor сам завершился после fencing. В read-only проверке только новых fixture-БД после опыта ASCII-run был cancelled, Unicode-run interrupted, оба owner пусты и оба supervisor уже не исполнялись.

**Причина:** на проверенной macOS `ps` при C locale отображает Unicode argv через `M-` notation вместо исходной строки. E10 отдельно проверил только собственный child: exact Unicode argument отсутствует при C и присутствует при `en_US.UTF-8`. Сохранённый путь журнала остаётся Unicode; точное текстовое сопоставление разных представлений ошибочно трактуется как отсутствие процесса. Это не рассуждение по возрасту heartbeat.

**Воспроизведение:** E08, приложение A и подготовка раздела 5. Настоящие RunController/RunStore/supervisor/generated await; `availableModels:[]`, никаких agents/providers.

**Контрдоказательства и границы:**

- Исторический E01 прошёл существующий cross-installation сценарий с пробелами в пути, pre-attach и legacy launch; wrong owner/run/store/script отвергаются. Исправление `37ff399` действительно есть. Это **новый locale-trigger**, не переоткрытие старого отсутствия provenance.
- ASCII-путь при C работает; тот же Unicode-run до смены locale наблюдался живым. Причина не общий отказ SQLite/spawn.
- Живой распознанный worker либо непустая pending group препятствует освобождению owner. Два конкурирующих writer здесь не наблюдались; доказано ложное прерывание workerless await.
- Linux, другие `ps` и Node 22.19 не проверялись. Unicode script/pre-attach — предложенная приёмка, не уже выполненный сценарий E08.

**Минимальная рекомендация, не внедрена:** общий адаптер представления argv для обоих вызовов `ps`; на macOS передавать **только дочернему ps** проверенную UTF-8 locale. Невозможность получить достоверное представление должна оставаться ошибкой/unknown, не доказательством смерти. Не менять locale самой задачи и не ослаблять проверку identity.

**Риск:** locale и формат `ps` платформозависимы; `C.UTF-8` нельзя считать гарантированно доступной на macOS. **Приёмка:** C/UTF-8 observers распознают Unicode store **и script**, attached/pre-attach, без `run.interrupted`; неверные owner/run/store/script по-прежнему отвергаются; ошибка OS-чтения не очищает owner.

### R03-002 — bug: декодирование stdin chunks тихо меняет Unicode request

**Серьёзность:** medium. **Уверенность:** высокая. Это локальная граница передачи задания, не измеренная проблема live provider.

**File:line:** `src/pi-worker-process.ts:22-29` делает `chunk.toString()`, `src/check-worker-process.ts:22-29` — `String(chunk)` до сложения строк. Родитель пишет JSON через один `.end(...)` (`src/process-client.ts:90-94,159-163`). У stdout client уже есть `setEncoding("utf8")` (`:105,169-170`), у stdin entrypoints — нет.

**Триггер:** многобайтный UTF-8 символ внутри JSON-строки пересекает границу pipe chunks. Один вызов write/end не гарантирует одного chunk и не гарантирует границу символа.

**Ожидалось:** task/input/cwd/config и literal check args сохраняют переданные строки независимо от фрагментации ввода.

**Наблюдалось в новом E09:**

- Реальный check wrapper: передано `АБ`, разрез внутри первого символа, chunks 110/38 bytes; команда вывела **`��Б`**, exit 0.
- Реальный pi wrapper: chunks 56/5 bytes; наблюдающий preload вокруг настоящего `JSON.parse` зафиксировал `task="��Б"`. Затем `version=999` дал configuration и exit 1 **до model runtime/auth** (`src/pi-worker.ts:107-108,143`).
- Без preload и ручного split обычный `runCheckProcess` с 70 000 `А`: команда получила 70 002 символа, 4 U+FFFD, несовпадающий SHA, но exitCode=0.
- ASCII-префикс `x` сдвинул выравнивание: исходных/полученных символов 70 001, 0 замен, SHA совпал.

Старый черновик E05 указывал chunks 110/37 и 55/5: отличие длины нового временного пути меняет размеры JSON, **не** характер дефекта. Число замен большого аргумента и ASCII-контроль совпали.

**Причина:** независимый Buffer decoder заменяет оборванные части многобайтного символа; сложение строк не восстанавливает байты. U+FFFD внутри строки — допустимый JSON, поэтому синтаксическая проверка не замечает мутацию. Перенос испорченного task/input в prompt при валидной версии следует из `src/pi-worker.ts:312`; **live prompt здесь не отправлялся**.

**Воспроизведение:** E09, приложение B. Forced-split синхронизируется с фактическим чтением первого chunk, а не только задержкой. Отдельная большая проверка использует неизменённый process-client.

**Контрдоказательства:** literal args/no-shell тест E01 проходит — проблема не shell quoting. Контроль с `x` не повреждается — не любой Unicode-request ошибочен. NDJSON/error/post-result проверки E02 относятся к stdout framing, а не целостности stdin. Preload наблюдает данные и не подменяет способ их преобразования. Успешного mock-вызова модели здесь также нет.

**Минимальная рекомендация, не внедрена:** потоковый UTF-8 decoder в обоих entrypoints (`StringDecoder`/`setEncoding`) либо накопление bytes с одним декодированием после EOF; без новых лимитов запроса.

**Риск:** общий reader должен сохранить abort/destroy, EOF admission и setup/not-started при отказе до исполнения. **Приёмка:** разрез 2/3/4-байтных символов во всех внутренних позициях сохраняет строки; большой настоящий check даёт исходный SHA; incomplete stdin SIGTERM/disconnect и PID-before-send остаются корректными. Проверку task/input/cwd выполнять offline.

### R03-003 — already-fixed: launch provenance, CAS и stale owner

`src/run-controller.ts:52-63` использует сохранённые script/store и owner/run, а не путь наблюдающей установки. `src/run-store.ts:319-342` транзакционно резервирует и прикрепляет PID. Исторический E01 проверил cross-installation/legacy/pre-attach и mismatch; E02 — stale owner и concurrent reserve.

В `tests/run-store.test.ts:278-303` проверены поздние attach/heartbeat/begin/complete/fail/metadata/pause/interrupted/event/finish. Они отвергаются; uncertain side effect не воспроизводится неявно. Старое утверждение «другая копия сама прерывает живой await» к этой ревизии неприменимо; R03-001 имеет отдельный воспроизведённый trigger.

**Граница:** сопоставление текстовой командной строки и случайного маркера не является OS-защитой от произвольного локального spoofing; настоящий kernel PID reuse не выполнялся. Рекомендации заново внедрить provenance/CAS нет.

### R03-004 — already-fixed: admission и settlement не равны spawn/ready/close

По E01 подтверждены reservation-before-spawn, PID-checkpoint-before-stdin, отказ checkpoint без dispatch, смерть fixture-родителя внутри checkpoint, отмена до/после допуска, cleanup ordinary/TERM-resistant потомков. E02 подтвердил incomplete stdin SIGTERM/disconnect и закрытый output pipe без необработанного EPIPE.

`src/process-client.ts:54-66` ждёт exit+drained pipes; `:133-140` не принимает result при nonzero exit. 19 IPC-сценариев (`tests/execution-failure.test.ts:39-93`) проверяют единственный object result, post-result frames, первый error и незавершённый JSON. Это **реализованные защиты**, не рекомендация «слушать только close». Синхронность `onStarted` — явный внутренний контракт, которому JournalRuntime соответствует.

**Граница:** открытая потомком труба может отложить drained condition. Успех узких тестов не объясняет flakes полного набора. Готовая SDK-сессия не выводится из ready.

### R03-005 — already-fixed: pending/unverified groups и stale group-token fence

`src/run-runtime.ts:348-356` не очищает pending PID/group и не принимает успех при оставшихся членах. `src/run-store.ts:325,414,435,466,742` защищает новую резервацию, recovery, успешный finish, замену попытки/команды. `observeWorkerGroupEmpty` сверяет token/group/key (`:759-767`). Zombies исключаются; `?Es` считается потенциально активным (`src/process-groups.ts:20-23`).

В историческом E01 собственные потомки после успешного wrapper и SIGKILL wrapper/supervisor сохраняли owner и `unresolved-groups`. Пустая группа затем давала одно событие. В отдельном сценарии журналу подставляли PGID другой **собственной fixture-группы**: cancel её не сигналил. Это seeded reuse, не повторное выделение номера ядром.

Опровергнуты обобщения «result значит cleanup всех потомков» и «cancel доверяет любому сохранённому PGID». Покинувшие группу процессы и внешние сервисы находятся вне проверки, как уже говорит документация. Эксперимент общего SDK-пула с surviving detached bash здесь не повторялся и не выдан за новую гонку текущего scheduler.

### R03-006 — unknown: identity check → signal при настоящем PID/PGID reuse

Проверка `ps` в `src/run-controller.ts:74-86` отделена от `kill(-pid)` в `:270-274`. `src/process-client.ts:21-49` также посылает сигналы числовой группе при cancellation/escalation/dispose; birth identity/OS handle не хранится.

**Гипотеза:** если номер действительно переиспользован в этом промежутке, сигнал потенциально может попасть новой группе. **Почему не bug:** реального kernel reuse в таком окне, ошибочного сигнала и его частоты не наблюдалось. Текущие token/pending guards и зелёный seeded unrelated-group сценарий — существенные контрдоказательства широкому обвинению в неверном ownership.

**Предложено, не выполнено:** полностью изолированная ОС/namespace fixture, различающая birth identity до/после ps/exit/drain/escalation. Сначала доказать достижимое окно, не делать PID-reuse stress среди пользовательских процессов. Минимальный следующий шаг — fixture и тестовая наблюдаемость, не изменение production signals.

**Риск:** повторная argv-проверка лишь сужает TOCTOU; требование живого лидера для KILL может оставить TERM-resistant потомков. **Приёмка:** новый процесс однозначно отличим от старой группы, не получает сигнал; cleanup собственных потомков и запрет скрытого повторного запуска сохраняются.

### R03-007 — unknown: причина документированных macOS flakes

`PROJECT_INFO/known-issues.md`, раздел «Открытое наблюдение: нестабильные процессные тесты», перечисляет incomplete-stdin disconnect, concurrent resume, Git recovery и CLI handoff failures полного набора. Исторические E01/E02 проходят первые два профильных направления; сохранённые файлы это подтверждают. Это **не исправление** и не доказательство стабильности полного набора. Последние два набора, full npm test и Node 22.19 в этой операции не запускались.

**Предложено, не выполнено:** монотонные времена spawn/checkpoint/ready/EOF/disconnect/exit/pipe-end/close и код/сигнал только собственных fixtures; сравнение Node 22.19 и 26 при контролируемой нагрузке. Не записывать argv/env/prompts/raw SDK stderr. Минимальное изменение — тестовый tracer, не увеличение timeout и не новые budgets/retries/approvals.

**Риск:** tracer сам меняет timing. **Приёмка:** локализована первая отсутствующая фаза failing fixture, причина подтверждена контролем, а не корреляцией с нагрузкой или зелёным mock.

## 4. Already-fixed/refutations и post-study изменения

| Проверенная гипотеза | Итог |
|---|---|
| Другая установка сама ломает supervisor identity | Already-fixed R03-003; отдельная locale-граница R03-001 |
| Task отправляется до durable PID | Already-fixed R03-004; E01 опровергает |
| Settlement требует только ChildProcess.close | Already-fixed R03-004; код ждёт exit+drained pipes |
| Result означает пустую группу; cancel доверяет одному PGID | Already-fixed R03-005; E01 опровергает |
| Наблюдался неправильный сигнал при настоящем kernel reuse | Unknown R03-006; такого опыта не было |
| Установлена причина full-suite flakes | Unknown R03-007; зелёный узкий тест её не устанавливает |

**Отдельно от study-source:** просмотрен diff `e15bc407..3d8ba65` и соответствующие commits. В `86f5e07` уже введена ранняя authoring parallel-isolation validation, в `3d8ba65` уточнена документация reviewer artifactRevision binding. Оба — post-study already-fixed context, не новые предложения этой роли. Девять профильных process/ownership модулей, шесть тестовых файлов и package/lock побайтно совпадают между базой и текущим dev; graph/compiler/execution-plan/workspaces изменены. Эти изменения **не закрывают** найденные две ошибки process boundary.

Skill delivery, асинхронное ownership панели/control/await, сохранение wait disclosure/caret/scroll прочитаны как уже исправленные в документах текущей базы, не переоткрываются. UI/skills не были предметом новых проверок r03. Новых лимитов модели, provider retries или approvals не предлагается.

## 5. Experiments — выполненные, перенесённые и предложенные

### E01/E02 — исторически выполнены, файлы результатов перепроверены

Команды из retained evidence (не запускались заново):

```sh
# E01: ROOT был новым /tmp/r03-baseline-XXXXXX
cd /Users/ramu/.local/state/dynamicwf-evaluation-20260920/integration-dev
TMPDIR="$ROOT" node --import tsx --test --test-concurrency=1 \
  tests/process-client.test.ts tests/process-groups.test.ts tests/run-controller.test.ts

# E02: ROOT был новым /tmp/r03-focused-XXXXXX
TMPDIR="$ROOT" node --import tsx --test --test-concurrency=1 \
  --test-name-pattern='worker child|closed supervisor output pipe|worker IPC|legacy journals migrate launch provenance|launch CAS fences|pause drains leaves|control cancellation is monotonic|concurrent processes initialize journal' \
  tests/pi-worker.test.ts tests/execution-failure.test.ts tests/run-store.test.ts
```

E01 — 27 tests (12+4+11); E02 — 30 (11 top-level + 19 subtests). Отфильтрованные имена E02 не объявлены проверенными. Внутри concurrent-resume test создавались восемь собственных клиентов; последовательность файлов не означает отсутствия этого параллелизма. Никаких live моделей. Полные команды с перенаправлением и происхождение доступны в JSON. Полный npm test не выполнялся.

### E03–E06 — сохранённые команды/черновик, не новые результаты

E03 — OS locale probe; E04 — locale await fixture; E05 — UTF-8 fixture; E06 — проверка старой базы. В retained actions нет их tool outputs. Скрипты E04/E05 существуют и сверены; недостающие результаты не выдуманы, а независимо проверены E08/E09. Нынешний dev не объявляется старой ревизией: различие установлено E07.

### E07 — выполненная новая проверка provenance/ревизий

Выполнены `pwd`, `git rev-parse HEAD`, профильный git log/show/diff, Node/platform/date, SHA256 evidence/logs/fixtures, сравнение байтов base/old/dev. Проверено отсутствие старых отчётов. Новая копия source сверена с Git и использована только для собственных fixtures.

Для воспроизведения **на новой директории**, а не поверх исторических данных:

```sh
# STUDY — cwd с проверенной базой e15bc407; DEPS — разрешённый dev с готовыми зависимостями.
STUDY="$PWD"
DEPS=/Users/ramu/.local/state/dynamicwf-evaluation-20260920/integration-dev
ROOT=$(mktemp -d /tmp/r03-repro-XXXXXX)
mkdir "$ROOT/study-source"
cp -R "$STUDY/src" "$ROOT/study-source/src"
cp "$STUDY/package.json" "$ROOT/study-source/package.json"
ln -s "$DEPS/node_modules" "$ROOT/study-source/node_modules"
# Сохранить приложение A как "$ROOT/locale.mjs", приложение B как "$ROOT/utf8.mjs".
TMPDIR="$ROOT" node --import "$ROOT/study-source/node_modules/tsx/dist/loader.mjs" \
  "$ROOT/locale.mjs" "$ROOT/study-source" "$ROOT"
TMPDIR="$ROOT" node --import "$ROOT/study-source/node_modules/tsx/dist/loader.mjs" \
  "$ROOT/utf8.mjs" "$ROOT/study-source" "$ROOT"
```

Новая операция реально использовала `/tmp/r03-cont-v1-HvdYCw`. Исходники/tests/PROJECT_INFO/package/lock в репозиториях не изменялись. Копирование здесь — подготовка offline fixture, не установка/изменение runtime.

### E08 — выполненный свежий locale fixture

Фактическая команда:

```sh
TMPDIR=/tmp/r03-cont-v1-HvdYCw node --import /tmp/r03-cont-v1-HvdYCw/study-source/node_modules/tsx/dist/loader.mjs /tmp/r03-cont-v1-HvdYCw/locale.mjs /tmp/r03-cont-v1-HvdYCw/study-source /tmp/r03-cont-v1-HvdYCw
```

**Exit 0**, assertions подтверждают дефект, не его исправление. ASCII waiting сохранён; Unicode waiting ошибочно стал interrupted. После cleanup подтверждено отсутствие исполнения обоих собственных supervisor. SHA256 только файла краткого результата: `f6610a91a577f8fb8c26d38819a71cfbd21ad5e3b4989e52ec0b3cf94288171c`. Сырые журналы не публикуются.

### E09 — выполненный свежий UTF-8 fixture

```sh
TMPDIR=/tmp/r03-cont-v1-HvdYCw node --import /tmp/r03-cont-v1-HvdYCw/study-source/node_modules/tsx/dist/loader.mjs /tmp/r03-cont-v1-HvdYCw/utf8.mjs /tmp/r03-cont-v1-HvdYCw/study-source /tmp/r03-cont-v1-HvdYCw
```

**Exit 0** самого fixture. Check split exit 0 / повреждённая строка; pi split exit 1 / configuration / повреждённый parsed task; большой check 4 замены; x-control 0. SHA256 файла краткого результата: `c48ee45a418db2b8d4e144550500a8714e76b0f1067f8bef834120caff02e89b`. Forced-split wrapper exit получен через событие exit; обычный check ждал production settlement. Утверждений о модели/провайдере нет.

### E10 — выполненный OS-контроль причины R03-001

Создан один собственный Node child с `setInterval` и тестовым аргументом `/tmp/r03-cont-v1-HvdYCw/процесс`. Для **его PID** вызван `ps -p <pid> -o args=` под C и `en_US.UTF-8`; затем child завершён и дождались exit. Итог: C — exactUnicodeArgument=false, macMetaNotation=true; UTF-8 — true/false. Exit 0. Точная форма Node-команды сохранена в JSON; интеграционный runnable контрпример — приложение A.

### E11 — проверка итогового пакета

Проверены JSON parse, metadata, семь уникальных ID и счётчики, ссылки на experiments/источники, допустимые границы file:line, SHA256 сохранённых evidence, побайтное совпадение встроенных fixtures. `node --check` обоих fixtures прошёл. Tracked diff cwd и профильных файлов dev пуст; в cwd новые файлы — только два назначенных r03-отчёта. Это проверка пакета, не полный typecheck/test. После последней записи SHA256 обоих файлов передаются в итоговом tool result; хеш JSON не встраивается в себя.

**Не выполнялись:** реальный PID reuse, нагрузочный прогон, Node 22.19, полный npm test, model/provider calls, SSH, live run management, установка пакетов, git commit/push/checkout/reset. Предложенные acceptance tests и tracer не считаются выполненными.

## 6. Источники и unresolved questions

Репозиторные `file:line` в разделе 3 относятся только к **study-source**. Новые изменения перечислены отдельно в разделе 4. Полный индекс источников с назначением и хешами external evidence есть в JSON.

Основные инспектированные источники:

- `AGENTS.md`; `PROJECT_INFO/architecture.md`; `development.md`; `known-issues.md` — ограничения, архитектура, исправления и flaky boundary.
- `PROJECT_INFO/run-journal.md#ownership`, `#worker`; `reconciliation.md#processes`, `#groups`; `execution-plan.md#launch-gaps` — ownership/launch/IPC/EOF и границы восстановления.
- `src/run-controller.ts:28-87,193-279,282-310`; `src/supervisor.ts:9-72`; `src/process-client.ts:11-187`; `src/process-groups.ts:1-23`; `src/pi-worker-process.ts:6-43`; `src/check-worker-process.ts:4-56`.
- `src/run-runtime.ts:33-54,82-117,173-286,296-357`; `src/run-store.ts:319-342,349-419,431-481,739-767`; `src/pi-worker.ts:107-145,302-325,347-368`.
- Полные `tests/process-client.test.ts`, `process-groups.test.ts`, `run-controller.test.ts`, `execution-failure.test.ts`; профильные `pi-worker.test.ts:352-383`, `run-store.test.ts:22-47,251-379,414-439`.
- Git log текущей базы и профильных файлов; `git show --stat` для `37ff399eefe0ce430e8a413aec43f495996378a7`, `20b9758f9d70a01eeedb409183726b8408759ba7`, `095413ff8654ed5091cbb0e64be5a29e2f56319b`; post-study diff `86f5e07`, `3d8ba65`.
- Собственный retained command-only evidence, два сохранённых файла тестовых результатов и два fixture-скрипта — раздел 1.

**Неразрешённое:** реальная достижимость PID/PGID reuse между observation и signal; причина известных flakes и различия Node/platform/load; проявление locale bug на других POSIX; отсутствующие исторические stdout/exit codes. Live provider поведение не исследовано. Отсутствие этих доказательств не заменяется предположением.

Ни секреты, ни auth-файлы, ни пользовательские журналы не открывались. В Git публикуются отчёты и небольшой исходник воспроизводителей, **не сырые логи/БД**. Технические guards в fixtures нужны для ожидания/cleanup собственных процессов, не являются бюджетами исполнения Dynamicwf.

## Приложение A — точный fixture R03-001

Байты совпадают со старым сохранённым скриптом и новой выполненной копией; SHA256 `8878ebb3f32314796129b6841a3cbdd89323006dede328dfd724d820c3460f90`. Сохранить как `locale.mjs` **в новой** директории по разделу 5. Никогда не направлять его на живую/старую БД. Assertions намеренно описывают наличие текущей ошибки.

```js
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const repo=resolve(process.argv[2]),root=resolve(process.argv[3]);
const {RunController}=await import(pathToFileURL(join(repo,'src/run-controller.ts')).href);
const workflow={schemaVersion:1,id:'r03-locale',name:'r03 offline await',revision:1,entryGraph:'main',graphs:{main:{entry:'wait',nodes:[{id:'wait',kind:'await',reason:{op:'literal',value:'r03 offline fixture'},input:{op:'literal',value:null},responseSchema:{type:'object'}},{id:'done',kind:'end',value:{op:'literal',value:null}}],edges:[{from:'wait',to:'done'}]}}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f){for(let i=0;i<400;i++){if(await f())return;await sleep(25)}throw Error('r03 fixture guard expired')}
function alive(pid){try{return !execFileSync('ps',['-p',String(pid),'-o','stat='],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim().startsWith('Z')}catch{return false}}
const old=process.env.LC_ALL;
try{for(const name of ['ascii-journal','журнал']){
 process.env.LC_ALL='en_US.UTF-8';
 const directory=join(root,name);await mkdir(directory,{recursive:true});
 const controller=new RunController(join(directory,'state.sqlite'));
 let run;
 try{
  run=await controller.start(workflow,null,directory,{availableModels:[]});
  await until(()=>controller.store.get(run.id).status==='waiting');
  const good=controller.observe(run.id);assert.equal(good.supervisorAlive,true);
  assert.equal(good.workersAlive,0);
  process.env.LC_ALL='C';
  const liveBefore=alive(run.supervisorPid);
  const observed=controller.observe(run.id);
  const row={case:'locale-C-'+(name==='журнал'?'non-ascii':'ascii'),liveBefore,utf8Alive:good.supervisorAlive,cAlive:observed.supervisorAlive,status:observed.run.status,ownerRetained:observed.run.ownerToken===run.ownerToken,interruptedEvents:controller.store.events(run.id).filter(e=>e.type==='run.interrupted').length};
  assert.equal(observed.supervisorAlive,name!=='журнал');
  process.env.LC_ALL='en_US.UTF-8';
  if(name==='журнал') {assert.equal(observed.run.status,'interrupted');await until(()=>!alive(run.supervisorPid));row.selfStoppedAfterFence=true;}
  else{await controller.control(run.id,'cancel');await until(()=>controller.store.get(run.id).status==='cancelled');}
  console.log(JSON.stringify(row));
 }finally{if(run?.supervisorPid&&alive(run.supervisorPid)){process.kill(run.supervisorPid,'SIGKILL');await until(()=>!alive(run.supervisorPid))}controller.close()}
}}finally{if(old===undefined)delete process.env.LC_ALL;else process.env.LC_ALL=old}
```

## Приложение B — точный fixture R03-002

Байты совпадают со старым сохранённым скриптом и новой выполненной копией; SHA256 `a278a8d8a7e75201b37318c3a82bb04fb834f7f677f0c400ac728484d577c16a`. Сохранить как `utf8.mjs` в новой директории. Preload действует только на собственные split-wrapper, обычный большой runCheckProcess выполняется без него. Version 999 у pi исключает модельный вызов. После исправления assertions наличия дефекта следует инвертировать для регрессии.

```js
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,writeFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const repo=resolve(process.argv[2]), root=resolve(process.argv[3]);
const loader=pathToFileURL(join(repo,'node_modules/tsx/dist/loader.mjs')).href;
const {runCheckProcess}=await import(pathToFileURL(join(repo,'src/process-client.ts')).href);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f){for(let i=0;i<200;i++){if(await f())return;await sleep(25)}throw Error('r03 fixture guard expired')}
for(const kind of ['check','pi']){
 const base=join(root,kind), trace=base+'.chunks', parsed=base+'.parsed.json', preload=base+'.cjs';
 await writeFile(preload,`const fs=require('node:fs');const it=process.stdin[Symbol.asyncIterator].bind(process.stdin);process.stdin[Symbol.asyncIterator]=async function*(){for await(const chunk of { [Symbol.asyncIterator]:it }){fs.appendFileSync(${JSON.stringify(trace)},chunk.length+'\\n');yield chunk;}};const parse=JSON.parse;JSON.parse=function(text,...args){const value=parse(text,...args);if(value&&value.version===999&&value.task)fs.writeFileSync(${JSON.stringify(parsed)},JSON.stringify(value.task));return value;};`);
 const child=spawn(process.execPath,['--import',loader,join(repo,'src',kind+'-worker-process.ts'),'--worker-token','r03-utf8-'+kind],{cwd:root,detached:true,env:{...process.env,NODE_OPTIONS:'--require='+preload},stdio:['pipe','pipe','pipe','ipc']});
 let out=''; child.stdout.setEncoding('utf8').on('data',x=>out+=x);child.stderr.resume();child.stdin.on('error',()=>{});
 const exited=once(child,'exit');
 const req=kind==='check'?{command:process.execPath,args:['-e','process.stdout.write(process.argv[1])','АБ'],cwd:root}:{version:999,cwd:root,task:'АБ'};
 const bytes=Buffer.from(JSON.stringify(req)), cut=bytes.indexOf(Buffer.from('А'))+1;
 try{
  child.stdin.write(bytes.subarray(0,cut));
  await until(()=>readFile(trace,'utf8').then(Boolean,()=>false));
  child.stdin.end(bytes.subarray(cut));
  const [code,signal]=await exited;
  const actual=kind==='check'?JSON.parse(out).stdout:JSON.parse(await readFile(parsed,'utf8'));
  assert.equal(actual,'��Б');
  console.log(JSON.stringify({case:'split-utf8-'+kind,code,signal,expected:'АБ',actual,chunks:(await readFile(trace,'utf8')).trim().split('\n').map(Number),...(kind==='pi'?{terminal:JSON.parse(out.trim().split('\n').at(-1)).failure.code}:{})}));
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited.catch(()=>{})}}
}
const script="const s=process.argv[1];console.log(JSON.stringify({sha:require('node:crypto').createHash('sha256').update(s).digest('hex'),length:s.length,replacement:[...s].filter(c=>c==='\\ufffd').length}))";
for (const prefix of ['', 'x']) {
 const text=prefix+'А'.repeat(70000);
 const result=await runCheckProcess(process.execPath,['-e',script,text],root);
 const actual=JSON.parse(result.stdout),expected=createHash('sha256').update(text).digest('hex');
 console.log(JSON.stringify({case:'ordinary-runCheckProcess-'+prefix.length,exitCode:result.exitCode,equal:actual.sha===expected,expectedLength:text.length,actualLength:actual.length,replacements:actual.replacement}));
}
```
