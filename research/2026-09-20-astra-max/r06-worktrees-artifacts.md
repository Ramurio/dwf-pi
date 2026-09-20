## Финализация сохранённого пакета — 2026-09-20

Текущая операция `run-b46cf9ab-6e57-4c7a-83dc-e44802a4ab9c` переносит собственную полную пару из `run-9dbb044c-664f-4dd8-96c0-57192dc4ed89`, чей turn завершился ошибкой, а не успешным submit. Проверены входные SHA256: MD `f5679263d060aa84519616894da577a53347e707eb1db155caa2049f7125baf1`, JSON `f1beb1b8552bd14c483c5416cdc7990f4503857aac3c0876fbab7b97dd89dc3c`.

JSON валиден; 7 находок и их ID согласованы с MD, hash встроенного воспроизводителя совпал; все 27 repository source manifest hashes проверены через `git show` study revision. Повторно прочитаны обязательные документы, профильный workspaces-контракт, Git log и причинные guards. Retained actions прочитаны, но не исполнены. Никакие тесты/fixtures/providers/live run повторно не запускались. Новых выводов о поведении не добавлено.

**Ниже — неизменённое историческое тело MD.** Его «теперь», cwd, E00–E05 и отсутствие более ранних отчётов относятся к предыдущей операции, не к нынешней. Актуальный cwd и цепочка provenance — в JSON. Исходные 50 тестов/5 сценариев остаются историческими доказательствами, а не новым прогоном. Study `e15bc407…` и publication `3d8ba65…` не смешаны.

Имя коллекции `astra-max` историческое. Исторические max-исследования не переименованы; будущие pi-вызовы continuation настроены на `openai-codex/gpt-6-astra thinking=low`. Эта финализация не запускала pi. Пакет не объявляется целиком выполненным ни на low, ни на max.

---

# r06 — Worktree/integrate и ревизия артефакта

## Метаданные и вывод

- **ID:** `r06`; дата: **2026-09-20**. Исследование, не реализация.
- **Study source:** `e15bc407da8753fd6b683c0aa4a68634e3c458a7`.
- **Publication dev:** `3d8ba65ee84402c0e3b0587f70095b7847824a9f`; проверен только чтением Git/исходников. Не подменяет study source.
- Фактический cwd: `/Users/ramu/.dynamicwf/runs/run-9dbb044c-664f-4dd8-96c0-57192dc4ed89/worktrees/00926e26e13d4c9c311099d455a644d39595d6d0ff1732efa62ed4d82ad27267`.
- Результаты: этот Markdown и `research/2026-09-20-astra-max/r06-worktrees-artifacts.json`.
- `artifactRevision` этого исследования — `sha256:` + SHA256 окончательных байтов JSON, **не** Git HEAD исследуемого проекта. Оба файловых хеша передаются итоговым результатом; самоссылочный хеш в JSON не встраивается.

**Подтверждены два узких bug на study source:**

1. **r06-B01, high:** коллизия с файлом внутри игнорируемого вложенного Git-репозитория может пройти защиту `integrate` и перезаписать незакоммиченные байты.
2. **r06-B02, medium:** `assume-unchanged`/`skip-worktree` скрывают изменённые tracked-файлы от проверки `clean`, родительского коммита и снимка артефакта.

При этом владение источниками, сравнение фактического HEAD, одноразовый recovery, сохранение завершённых детей и основных crash-frontiers **уже защищены**. Частичная интеграция не обещает общего отката. Ранняя authoring-валидация и документация reviewer binding исправлены **после** study source; повторно внедрять их не предлагается.

Всего в `findings` JSON **7 записей: 2 bug, 4 already-fixed/refutation, 1 unknown**. Дополнительные вопросы о переносимости — границы доказательств, не новые заявленные баги.

## 1. Продолжение и происхождение доказательств

Предыдущая операция — `run-babf9b25-b8f5-45ad-b79c-2b2e5d31d2f0`, статус `failed`. Переданный runtime diagnostic: provider/HTTP 429, execution, effects unknown. Это только факт происхождения незавершённой операции: он не устанавливает причины ответа, квоты или разрешение повторить внешние действия.

Сначала проверены **оба своих старых пути** в старом workspace: `r06-worktrees-artifacts.md` и `.json` отсутствуют. Их SHA256 получить невозможно. Поэтому нынешние отчёты **созданы впервые**, а не объявлены переносом ранее успешного выхода.

`retained/r06-actions.json` содержит 16 команд, **не** полные tool responses. Последняя команда сохраняла архив именно `e15bc407…` в `/tmp/r06-frozen-baseline-LLFhzs`, запускала профильные тесты и свой воспроизводитель. Эти файлы действительно сохранились и прочитаны. Старые fixtures, Git-индексы и worktree не изменялись.

### Проверенные SHA256 сохранённых материалов

| Материал | SHA256 |
| --- | --- |
| `…/continuation-v1/retained/r06-actions.json` | `a17f22aeb13b5968812b86221a2ec57939765738dce4b0a18913d1f789e17111` |
| `/tmp/r06-frozen-baseline-LLFhzs/targeted.tap` | `c3ef8030fb8f72084968cb8fc477ccf2b174e705956f1cd65eb0b26f967fc935` |
| `/tmp/r06-frozen-baseline-LLFhzs/probes/reproduce.mts` | `be7918a89442d31553d4a02704bbfb97faefa0493b650e6c1a3cb1b387d7eded` |
| `/tmp/r06-frozen-baseline-LLFhzs/probes/result.txt` | `f5b0d16b622281f121151538d81e31007319a9edc8f5b5d0c0f880cdb1fc386a` |

Полный путь retained actions указан в JSON. Сырые логи в отчёты не перенесены. Скрипт воспроизведения включён в JSON побайтно, поскольку он необходим для независимой проверки, а не является логом.

**Перенесено:** 50/50 профильных offline-тестов и пять assert-backed сценариев двух дефектов. **Перепроверено теперь:** хеши, результаты assertions, ссылки на текущие исходники, соответствие сохранённого snapshot базовой ревизии. **Добавлено:** анализ post-study diff, формулировки причин/границ и критериев приёмки, эти два отчёта.

Для `src/`, `tests/`, `skills/dynamic-workflows/recipes/implementation-review/`, `package.json` и `package-lock.json` выполнено побайтное сравнение сохранённого snapshot и нового cwd с `git show e15bc407…:<path>`: **199 файлов, 0 отсутствующих, 0 различий**. Поэтому доказательства не опираются на случайно обновившийся dev. Ранние незамороженные логи тоже показывают 50/50, но первичным свидетельством выбран последний frozen-baseline.

**В этой continuation ни один runtime/test suite заново не запускался.** Сохранившегося пакета достаточно; повторять SIGKILL-процессы ради формального успеха не требовалось. Не было модельных вызовов, live run, SSH, доступа к credentials, установки пакетов, git commit/push/checkout/reset или чтения отчётов соседей.

## 2. Coverage и модель контракта

Сначала прочитаны `AGENTS.md`, `PROJECT_INFO/architecture.md`, `development.md`, `known-issues.md`, затем профильные документы и Git history. Основные изученные области:

| Область | Проверенный код/тесты | Что установлено |
| --- | --- | --- |
| Allocation/commit | `src/workspaces.ts:28-66,229-245,270-294` | root/canonical path, ветка и ancestry; staging только после успеха ребёнка; слабое место index flags |
| Dirty destinations/ignored collisions | `src/workspaces.ts:152-203,250-285`; `tests/workspaces.test.ts:313-372` | обычные dirty/ignored случаи защищены, directory entry `cache/` даёт контрпример |
| Реальная версия источника | `src/run-runtime.ts:337-345`; `src/workspaces.ts:157-175` | sources берутся из succeeded worktree текущего run; полная запись и текущий HEAD проверяются |
| Multi-branch/crash recovery | `tests/git-recovery-crash.test.ts:81-175`; `tests/fixtures/git-recovery-crash.ts:5-37` | реальные SIGKILL временного supervisor в восьми точках, ещё два explicit-retry сценария |
| Allocation gaps | `src/workspaces.ts:69-150`; `tests/allocation-recovery.test.ts:29-120` | архив собственной регистрации; запрет «восстановить» потерянные файлы из старых child checkpoints |
| Artifact/review/reuse | `src/run-runtime.ts:359-372`; `src/reconciliation.ts:32-46`; `src/lineage.ts:316-381` | точная привязка строк, provenance источника/producer/schema, но не автоматическое доказательство произвольной версии |
| Снимки S/P/C | `snapshot.mjs:16-30`; `verify-command.mjs:13-22`; `tests/implementation-recipes.test.ts:47-162` | Git tree стандартного staging; сохранение реального индекса; реальные check exits, не качество модели |

Worktree — отдельные рабочие файлы и индекс, но общая Git object database, **не** OS sandbox. Явный `check.cwd` может переопределять область (`src/run-runtime.ts:273-295`). Mutex хранится в одном `GitWorkspaces` (`src/workspaces.ts:296-303`), а не является межпроцессной блокировкой всех пользователей/запусков. Это документированные границы, не вновь найденная уязвимость.

## 3. r06-B01 — ignored nested repo может потерять незакоммиченные данные

**Классификация:** bug, high. **База:** `e15bc407…`. **Причинные строки:** `src/workspaces.ts:250-267`, вызов защиты и merge — `:176-179`.

### Триггер и ожидаемое поведение

Во внешнем repo `.gitignore` содержит `cache/`. В назначении `cache` — отдельный вложенный Git-репозиторий. Его `value.txt` после локального коммита изменён на `UNCOMMITTED USER DATA`. В собственном выделенном source worktree принудительно отслеживается `cache/value.txt` со значением `WORKER`.

Контракт прямо обещает защиту ignored local content, включая родительские пути (`PROJECT_INFO/workspaces.md:87-104`). Ожидается отказ **до merge**, без изменения HEAD назначения и локальных байтов. Правила ignore разрешают не копировать зависимости, но не разрешают молча перезаписывать их локальные данные при интеграции.

### Что наблюдалось в сохранённом воспроизводителе E02

| Fixture | Результат `ls-files --others --ignored … -z` | `integrate` | Локальные bytes | HEAD назначения |
| --- | --- | --- | --- | --- |
| `ignored-nested` | `cache/` одной записью | success | заменены на `WORKER` | изменился |
| `unignored-nested` | пустой ignored-list, зато обычный status грязный | отказ | сохранены | прежний |
| `ignored-regular` | `cache/value.txt` | отказ | сохранены | прежний |

В первом сценарии вложенная история всё ещё содержит `LOCAL COMMITTED BASE`, **не** незакоммиченные потерянные байты. Это реальная перезапись данных **fixture**, не заявление о потере пользовательских данных в live run.

### Причина

Git сворачивает игнорируемый вложенный repo в directory entry `cache/`. Код нормализует NFC/регистр, но сохраняет конечный `/`:

- `ignored = {'cache/'}`;
- `ignoredParents` получает `'cache'`;
- для tracked `cache/value.txt` точного совпадения нет;
- при подъёме к родителю проверяется `ignored.has('cache')`, а не `'cache/'`;
- `ignoredParents` проверяется только против **полного** tracked path, поэтому и эта ветка не спасает.

После этого Git merge с `--no-overwrite-ignore` в сохранённом локальном прогоне тоже не останавливает перезапись. Сам код уже признаёт, что одного этого флага недостаточно (`:251`); дефект — неполное сравнение собственного предохранителя, не отсутствие предохранителя вообще.

### Контрдоказательства и границы

- Обычный ignored-файл и case-variant защищены штатными тестами (`tests/workspaces.test.ts:313-334,357-372`) и сохранённым прогоном E01.
- Отрицательные контроли отличаются именно наличием ignore/вложенного `.git`; они сохранили данные и HEAD.
- Прямой probe использует настоящий `GitWorkspaces`, его allocations/commits и собственные `/tmp` репозитории. `owned` передан непосредственно из этих records. Не утверждается обход слоя журнала; production runtime формирует owned из succeeded activations (`src/run-runtime.ts:341-345`).
- Другие Git/ОС не испытывались. Ошибка префиксного сравнения видна по коду, но Git-перезапись установлена для конкретного сохранённого прогона. Сейчас наблюдались Node v26.8.1 и Apple Git 2.50.1; отдельной записи версий executable на момент исторического прогона в сохранённых первичных логах нет.

### Минимальная рекомендация, риск, приёмка

**Изменение:** канонизировать directory entries ignored так, чтобы конечный `/` не ломал проверку родительских префиксов; сохранить NUL-разбор, NFC/casefold и двусторонние file/directory collisions. Добавить fixture с игнорируемым вложенным repo. Не применять force/reset/удаление локальных файлов.

**Риск:** более консервативный отказ при намеренной замене ignored-каталогов; это безопаснее silent overwrite. Нельзя потерять текущую защиту имён с пробелами/переводами строк и case/Unicode-коллизий.

**Приёмка:** `ignored-nested` отказывает до первой мутации merge; HEAD и байты сохранены; два отрицательных контроля сохраняют нынешний отказ; непересекающийся source успешно сливается; directory/file, регистр и Unicode остаются защищены. Исправление **не внедрялось**.

## 4. r06-B02 — flags индекса дают ложное clean и неполный артефакт

**Классификация:** bug, medium. **База:** `e15bc407…`. **Причинные строки:** `src/workspaces.ts:28-38,42-54,161-173,282-285`; `snapshot.mjs:21-27`.

### Триггер

Для уже отслеживаемого файла задан один из флагов:

```sh
git update-index --assume-unchanged base.txt
# либо --skip-worktree
```

Затем файл изменён на диске. В воспроизводителе флаг **отдельно** задан в source и child worktree. Runtime не устанавливает эти flags сам; автоматическое наследование индекса новым worktree не предполагается.

Ожидается либо достоверная проверка чистоты/содержимого, либо явный отказ неподдерживаемому состоянию до side effects. Контракт запрещает молча отбросить незакоммиченные правки источника и требует чистый Git при завершении (`PROJECT_INFO/workspaces.md:24-26,52-56`).

### Наблюдение для каждого из двух флагов

1. `status --porcelain=v1 --untracked-files=all` пуст при `UNCOMMITTED SOURCE` на диске.
2. `allocate` принимает источник; child получает старый `base`, а не незакоммиченные bytes.
3. В child скрыто изменён `other.txt` на `UNCOMMITTED CHILD`.
4. `snapshot.mjs` возвращает прежний `git-tree:HEAD^{tree}`.
5. `commit` успешен, `output.head === allocation.base`; `git show HEAD:other.txt` содержит старое `other`, при этом рабочий файл остаётся изменённым.
6. После подготовки непересекающегося `new.txt` интеграция в скрыто грязный source также успешна; его dirty `base.txt` остаётся на диске и не представлен в HEAD.
7. После снятия флага новый `allocate` корректно отказывает `must be clean`.

Здесь доказана **потеря переноса правки в артефакт**, а не уничтожение самого скрытого tracked-файла. Сценарий перезаписи совпадающего tracked path при merge не проверялся.

### Причина и важное ограничение интерпретации

`clean` целиком доверяет status. `commit` вдобавок вызывает `add --all` лишь при непустом status. Snapshot копирует существующий индекс вместе со flags; обычный `add --all` также пропускает скрытую правку.

**Snapshot не выдаёт выдуманный hash:** он честно соответствует дереву стандартного staging. Это важное контрдоказательство против формулировки «криптографическая ошибка снимка». Ошибочен более сильный вывод: «status пуст, значит рабочие bytes чистые и все неигнорируемые правки попадут в артефакт». Ревьюер/проверка могут читать один файл с диска, а зафиксированный commit содержать другой.

Это особые opt-in состояния Git: `assume-unchanged` — обещание пользователя Git, `skip-worktree` применяется и для sparse checkout. Без flags обычные dirty tests проходят. Игнорируемые зависимости здесь не при чём: проверены **tracked** файлы без `.gitignore`.

Штатные `tests/implementation-recipes.test.ts:95-123` проверяют staged/unstaged/deleted/forced-ignored и missing index, но не flags. Сохранённый E01 не противоречит E02, а показывает неполноту этой матрицы.

Общий `clean` используется и в recovery inspections (`src/workspaces.ts:205-225`). Возможность такого же blind spot там — **вывод из общего кода**; отдельный recovery fixture с flags не выполнялся.

### Минимальная рекомендация, риск, приёмка

**Изменение:** определить поддержку index flags. Самый небольшой безопасный вариант — обнаруживать `assume-unchanged`/`skip-worktree` и явно отклонять неподдерживаемую семантику до allocation/integration/commit; snapshot должен давать согласованный отказ. Если требуется полноценный sparse checkout, проверять реально присутствующие bytes через временный индекс, не меняя пользовательский.

**Риск:** общий запрет flags ограничивает законный sparse checkout/оптимизации Git. Автоматическое снятие flags в реальном индексе может неожиданно включить в артефакт намеренно скрытые файлы; этого не рекомендуется делать. Точная поддержка требует учитывать absent sparse paths и clean/smudge filters.

**Приёмка:** оба скрыто изменённых файла больше не дают ложный success; при отказе реальный индекс, flags и bytes неизменны; нормальные snapshot/staging сценарии сохранены; поведение неизменённого flagged-файла и отсутствующего sparse path явно проверено. Regression для recovery через общий `clean` — отдельная **предложенная**, не выполненная проверка. Исправление **не внедрялось**.

## 5. Уже защищённые контракты и refutations

### r06-A01 — already-fixed на study source: revision binding и provenance

Неправильно переоткрывать замечание «ревью не связано с версией» в общем виде:

- Для `reviewer`, у которого `schema.required` включает `artifactRevision`, непустая верхнеуровневая `input.artifactRevision` требуется **до** worker; output обязан точно повторить её и переданную `acceptanceCriteriaRevision` (`src/run-runtime.ts:359-372`).
- `reconcile accept` повторяет эту проверку по **записанному** operation input, не по заявлению участника (`src/reconciliation.ts:32-46`).
- `reuse` проверяет source status/attempt/key/plan, digest/schema и original producer output; нельзя убрать обязательную artifact/criteria revision из target schema или переиспользовать verdict для иной явно указанной версии (`src/lineage.ts:316-381`).
- `integrate` проверяет `path/branch/base/head`, свой run, фактическую ветку, чистоту, repo и HEAD. Устаревший source отвергается (`src/workspaces.ts:157-175`; `tests/workspaces.test.ts:85-90`).

**Но граница важна:** сравнение строк не делает произвольный `input.artifactRevision` правдивым автоматически. Автор графа должен брать версию из фактического результата/снимка. `integrate` сам не требует и не создаёт approve: его допуск задаёт граф (`PROJECT_INFO/workspaces.md:95-96`). Сохранённые recipe routing tests проверяют отрицательные условия на подставленных verdicts, **не** качество live модели.

Рекомендация — сохранить эти guards и правильный источник revision, не добавлять повторную mandatory approval-подсистему. Риск регрессии — смешать commit ID, tree ID и hash нового отчёта критика. Приёмка: stale HEAD/artifact/criteria продолжают отвергаться, а merge не выдаётся за task acceptance.

### r06-A02 — already-fixed на study source: crash points и частичная интеграция

Сохранённый E01 содержит **10 положительных crash/retry тестов**, с реальным Git и SIGKILL только своих fixture-процессов. Preload действительно вызывает `process.kill(process.pid, 'SIGKILL')`, после конкретной Git-команды либо перед завершением activation (`tests/fixtures/git-recovery-crash.ts:8-37`). Это не симуляция успеха модели.

| Аварийная граница | Проверенное восстановление |
| --- | --- |
| После намерения allocation | retry создаёт дерево до единственного вызова ребёнка |
| После `worktree add` | retry подключает уже созданное дерево; ребёнок один раз |
| После `git add` | child checkpoint сохранён; retry коммитит без повторной записи ребёнка |
| После `git commit`, до complete metadata | accept принимает фактический head/child result без нового коммита |
| После worktree complete metadata | accept/retry требуют точный recorded head; новый commit и видимая dirty правка отвергаются |
| После первого merge | accept всех источников отказан; retry добавляет оставшийся merge |
| После второго merge, до final head metadata | accept доказывает ancestry обоих source heads |
| После integration complete metadata | accept/retry сохраняют exact head и child checkpoints; чужой commit отвергается |

Дополнительные explicit-retry тесты complete worktree/integration сохраняют commits и children. Обычный `resume` перед разрешением recovery отказывает неявному повтору (`tests/git-recovery-crash.test.ts:56-60`).

При конфликте второй ветви первая остаётся: abort ограничен текущим merge после сверки MERGE_HEAD, `before` и ветки (`src/workspaces.ts:180-193`). Это **не баг отсутствующего all-or-nothing**: отсутствие общей Git-транзакции прямо заявлено (`PROJECT_INFO/workspaces.md:98-104`) и проверено (`tests/workspaces.test.ts:169-192`).

После partial retry `base`/`originalHead` нового результата — HEAD начала **новой попытки**. Старое начало интеграции остаётся в архиве interrupted attempt (`tests/git-recovery-crash.test.ts:141-156`; `src/run-store.ts:475-486`). Это важное различие для lineage и отчётов: нельзя интерпретировать новый `base` как потерянный исходный базис.

Recovery allocation архивирует точную административную регистрацию с индексом до удаления, не делает общий prune/reset. Дерево после admitted children нельзя создать заново под старыми outputs (`tests/allocation-recovery.test.ts:29-120`). `accept` архивирует исходную попытку и ставит `metadata.reconciliation`, не изобретая invocation или расход (`src/run-store.ts:803-847`).

Рекомендация — сохранить политику explicit recovery и архив, не вводить скрытые retries/общий reset. Риск «упрощения» — стереть уже зафиксированную ветвь или чужие изменения. Приёмка — прежняя crash matrix с неизменными child counts/commit counts и отказом изменённому complete head. Общая проверка `clean` всё ещё имеет B02; matrix не доказывает всех состояний индекса.

### r06-A03 — post-study already-fixed: ранняя authoring isolation validation

`86f5e0756e67fa7a18e925d77b7d2728db2f0627` перенёс общую проверку в `src/parallel-isolation.ts:5-35` и подключил её к graph validation/compile, до каталога моделей. Прочитаны diff и assertions `tests/parallel-authoring.test.ts:48-60` этой ревизии. На базовой версии prepare/frozen-plan защита уже существовала; новее отказ стал ранним на этапе authoring.

Это **не** предложение сделать то же повторно. Post-study тесты не запускались. Минимальное действие — сохранить существующий контракт/тесты; риск — ложный backlog от смешения ревизий; приёмка — не переоткрывать уже исправленную раннюю проверку.

### r06-A04 — post-study already-fixed: документация reviewer binding

`3d8ba65ee84402c0e3b0587f70095b7847824a9f`, `skills/dynamic-workflows/references/authoring.md:128-156`, уже объясняет верхнеуровневую input revision, точное копирование, пример `ref` на `workspace.head`, распаковку collect/worktree и отдельное имя `reportRevision` для отчёта критика.

Это документационное уточнение, не новый runtime guard и **не** исправление B01/B02. Повторно вносить его не нужно. Риск — снова назвать hash отчёта критика версией рецензируемого входа; критерий — применять уже описанную форму данных.

В новом чтении подтверждено: реализация `GitWorkspaces` и `parseWorkspaceSources` между `e15bc407` и `3d8ba65` **побайтно одинакова**, если исключить imports/перенос authoring-policy. Snapshot тоже не менялся. Следовательно, post-study diff не содержит исправления причин B01/B02; отдельного запуска этих bugs на publication не заявляется.

## 6. Версии артефактов: что именно доказано

| Идентичность | Что она означает | Чего не означает |
| --- | --- | --- |
| `sourceRevision` | commit исследуемого Dynamicwf | версию нового отчёта r06 или замороженность живого cwd |
| `workspace.base/head` | реальные Git commits | все bytes файловой системы/ignored dependencies |
| `git-tree:<hash>` | результат staging-снимка, включая действующие ignore/filter/index semantics | commit ID или полный filesystem digest; см. B02 |
| `review.artifactRevision` | точно переданную рецензируемую версию | автоматическое вычисление версии runtime из произвольного input |
| `reconciliation`/`reuse` provenance | принятую попытку/исходного producer/source и schemas/digests | новый ответ исполнителя или новое чтение файлов |
| `r06 artifactRevision` | SHA256 окончательного JSON отчёта | автоматически одобренный/интегрированный Git commit |

Сравнение `HEAD` с `git-tree:<hash>` напрямую бессмысленно: сравнивать нужно соответствующие виды идентичности, например `HEAD^{tree}` с tree-компонентом. `succeeded` не означает `accepted`; наличие правдивого hash не означает качественного ревью.

## 7. r06-U01 — unknown: внешняя запись после snapshot

**Наблюдаемые факты:** snapshot предшествует review; после child result родитель делает commit (`src/run-runtime.ts:325-334`; `S/patch.json:1263-1284`). Runtime не сравнивает любой произвольный child `artifactRevision` с итоговым `HEAD^{tree}`. README прямо исключает изоляцию внешней записи между snapshot/review/commit (`implementation-review/README.md:95-106`).

**Гипотеза:** сторонняя запись в этом окне может сделать итоговый артефакт отличным от одобренного. Специальный end-to-end counterexample **не выполнялся**; это не заявляется новым bug сверх документированной границы. B01/B02 не подменяют доказательство такого race.

**Минимальный следующий шаг, только предложен:** детерминированная offline fixture на новом `/tmp/r06-*`: барьер после snapshot, одна внешняя запись, продолжение child/parent, сравнение snapshot и `HEAD^{tree}` плюс неизменённый контроль. Не изменять runtime до установления конкретного окна и не добавлять новые approvals/retries.

**Риск:** без барьера легко спутать внешнюю запись с гонкой внутри run, а разные виды hash — с drift. **Критерий приёмки исследования:** зафиксированы точный момент записи, оба содержательных digest и результат неизменённого контроля. Даже возможная дополнительная проверка не должна обещать OS isolation.

Другие unresolved вопросы: переносимость B01 на иные Git/FS; точная политика sparse checkout и фильтров для B02; качество live reviewer. Они не проверены и не выданы за новые находки.

## 8. Эксперименты: выполненное и предложенное

### Исторически выполнено, теперь инспектировано

**E01 — профильные offline tests**, из `/tmp/r06-frozen-baseline-LLFhzs/source`:

```sh
TMPDIR=/tmp/r06-frozen-baseline-LLFhzs/tmp node --import tsx --test --test-concurrency=1 \
  tests/workspaces.test.ts tests/git-recovery-crash.test.ts \
  tests/allocation-recovery.test.ts tests/lineage.test.ts \
  tests/reconciliation.test.ts tests/implementation-recipes.test.ts
```

Сохранённый результат: **50 tests, 50 pass, 0 fail, 0 skipped**, 160586.417583 ms. Разбивка: workspaces 12; crash 10; allocation 5; lineage 7; reconciliation 8; recipes 8. Это не полный `npm test`, не новое выполнение continuation и не гарантия стабильности процессных тестов под нагрузкой. `known-issues.md` отдельно описывает исторические timeouts полного набора; один удачный последовательный запуск их не опровергает.

**E02 — реальный Git counterexample**, оттуда же:

```sh
TMPDIR=/tmp/r06-frozen-baseline-LLFhzs/tmp node --import tsx \
  /tmp/r06-frozen-baseline-LLFhzs/probes/reproduce.mts \
  /tmp/r06-frozen-baseline-LLFhzs/source \
  /tmp/r06-frozen-baseline-LLFhzs/probes
```

Пять структурированных итогов соответствуют пройденным assert в инспектированном скрипте: три collision-сценария и два index-flag. Полные tool exit records в retained-actions отсутствуют; положительный вывод основывается на отдельно сохранившемся завершённом логе. Старые команды **не следует запускать повторно в этих каталогах**.

### Выполнено в новой операции

- **E00:** `pwd`, `git rev-parse HEAD`, проверки существования старых своих файлов; чтение/hash retained actions и своих указателей `/tmp/r06-*`. Оба старых отчёта отсутствуют.
- **E03:** `git ls-tree`/`git show` и Python `read_bytes()`-сравнение 199 файлов двух копий с исходной ревизией; чтение `nl -ba` причинных участков. Расхождений нет.
- **E04:** `shasum -a 256` материалов; Python-разбор пяти JSON строк результата, assert их контрпримеров/контролей и подсчёт 50 положительных строк тестов/нулевых fail/skip. Согласованность подтверждена.
- **E05:** `git log`, `git show 86f5e07`, `git show 3d8ba65`, scoped `git diff e15bc407 3d8ba65`, byte comparison класса/parser, read-only dev HEAD. Различены study-source и уже исправленное post-study.

Ни один из E00/E03/E04/E05 не создавал новую runtime invocation. Новый runtime-тест не требуется только ради переноса доказательств.

### Безопасное независимое воспроизведение — команда для нового запуска

Ниже **не выполнялось в continuation**. Команда использует новый `/tmp` архив study source, а не обновляющийся dev-код; зависимости только заимствуются, без установки. Исторический script извлекается из JSON этого пакета. Запускать из корня нового рабочего дерева:

```sh
CWD="$PWD"
DEPS=/Users/ramu/.local/state/dynamicwf-evaluation-20260920/integration-dev/node_modules
ROOT=$(mktemp -d /tmp/r06-reproduce-XXXXXX)
mkdir "$ROOT/source" "$ROOT/tmp" "$ROOT/fixtures"
git archive e15bc407da8753fd6b683c0aa4a68634e3c458a7 | tar -x -C "$ROOT/source"
ln -s "$DEPS" "$ROOT/source/node_modules"
python3 - "$CWD/research/2026-09-20-astra-max/r06-worktrees-artifacts.json" "$ROOT/reproduce.mts" <<'PY'
import hashlib, json, pathlib, sys
r = json.loads(pathlib.Path(sys.argv[1]).read_text())['reproduction']
b = r['script'].encode()
assert hashlib.sha256(b).hexdigest() == r['scriptSha256']
pathlib.Path(sys.argv[2]).write_bytes(b)
PY
(cd "$ROOT/source" && TMPDIR="$ROOT/tmp" node --import tsx \
  "$ROOT/reproduce.mts" "$ROOT/source" "$ROOT/fixtures")
```

Внутри script `git init`, `update-index`, записи и commits относятся исключительно к новым fixtures. Он не вызывает модели, не управляет пользовательскими run и не пишет в dev/старый worktree. На базовой ревизии ожидается подтверждение нынешних дефектов, а после исправления assertion об их проявлении закономерно перестанет проходить: регрессионные тесты должны использовать критерии приёмки, а не ожидать потерю данных.

## 9. Первичные источники и пределы выводов

Все `file:line` без префикса относятся к **e15bc407…**, проверенному в фактическом cwd. Post-study ссылки явно помечены commit ID.

- `AGENTS.md`; `PROJECT_INFO/architecture.md`; `PROJECT_INFO/development.md`; `PROJECT_INFO/known-issues.md` — ограничения работы, профильные тесты и известные границы.
- `PROJECT_INFO/workspaces.md:20-65,80-118,123-145` — чистота, ownership, partial merge и граница OS/process isolation.
- `PROJECT_INFO/reconciliation.md:211-229,284-313` — exact complete head и crash matrix; описание согласуется с проверенными tests, кроме отдельно установленного blind spot B02 общего clean.
- `PROJECT_INFO/graph-contract.md:145-151` — версия ревью передаётся во вход, политика совета не зашита в каталог.
- `src/workspaces.ts:28-315`; `src/run-runtime.ts:92-101,273-345,359-372`; `src/run-controller.ts:312-354` — исполнение и Git validation.
- `src/operation-record.ts:6-30`; `src/run-store.ts:459-486,803-847`; `src/reconciliation.ts:32-46`; `src/lineage.ts:316-381` — checkpoint/provenance и привязка восстановленного/переиспользованного результата.
- `tests/workspaces.test.ts:65-192,313-372`; `tests/git-recovery-crash.test.ts:36-175`; `tests/fixtures/git-recovery-crash.ts:5-37`; `tests/allocation-recovery.test.ts:29-120`; `tests/reconciliation.test.ts:127-153,180-203`; `tests/lineage.test.ts:72-90` — конкретные отрицательные и recovery assertions.
- `skills/dynamic-workflows/recipes/implementation-review/README.md:78-113`; `snapshot.mjs:16-30`; `verify-command.mjs:13-22`; `S/patch.json:874-983,1263-1311`; `tests/implementation-recipes.test.ts:47-162` — значение tree snapshot, границы принятия, реальные Git/check fixtures.
- Git history профильных файлов: `6f67130`, `d93d95f`, `067f128`, `2fce387` и последующие интеграции; post-study отдельно `86f5e075…` и `3d8ba65…`. Из истории не выводились невыполненные проверки.

В JSON приведён source manifest с SHA256 инспектированных файлов. Веб не использовался; ссылки на Git в документации не объявляются посещёнными публичными источниками. Проверки SDK/моделей/полного runtime вне названных fixtures не заявляются. Никаких исправлений, новых бюджетов, provider retries или обязательных approvals не внесено.
