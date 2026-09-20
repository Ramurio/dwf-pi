# c03 — независимое ревью r05/r06

Дата: 2026-09-20. Topic: идемпотентность, continuation, worktrees и артефакты.

Source/artifactRevision: `e15bc407da8753fd6b683c0aa4a68634e3c458a7`. Acceptance: `dwf-astra-research-evidence-v1`.
ReviewedMaterialDigest: `sha256:921a4aaf35af227dc8a22f4b843841a3c585547b69719c4153ae704a5202fd7a`.

## Вердикт

**approve**, status complete: существенных искажений не найдено. Все четыре bug воспроизведены; два unknown остаются unknown. Это одобрение достоверности evidence, не разрешение внедрить все рекомендации.

## Входы и покрытие

Обе collect оболочки succeeded, оба producer complete. До чтения проверены SHA256 обеих пар; совпадают с producer metadata. Пути, workspace base/head и полный материал привязки сохранены в JSON.

- r05: `sha256:0928d4949762410f343f935342eef81c65d503a8733402e393ce3dc7e12745b1`; snapshot `db64d318e98386aa79e6fade2ae7809a9b324cc5`; Markdown SHA256 `787eb8044acd5d0fa521e1c7ef5ec1afdba3161a3f80d1aabef428a67a0ef2e8`.

- r06: `sha256:3fb227b82815a8a1f7f6f9de883c7f1b551db7bc1a9439768771e55b65f5d632`; snapshot `ce08d9426f4057333c759764314a1147bee67a82`; Markdown SHA256 `388d61e4ee975bbf97b262a19c3d382828ffce5c0a8278fa216868963e8bdd09`.

Прочитаны обязательные документы, профильные контракты, код, тесты и Git history. Новые fixtures выполнялись в архиве study HEAD под уникальным /tmp/c03-review-* с существующими node_modules, без установки пакетов. Исторические max-исследования не переименованы: новое ревью не утверждает одинаковый режим всей коллекции.

## Индивидуальные оценки

### R05-B01 — confirmed (bug)

Новый probe: точный start до fence возвращает ID, после fence отклонён; событий источника не прибавилось, два run и одна запись. Это ошибка доставки, не обход fence.

Код: src/service.ts:128-130; src/run-controller.ts:193-201; src/run-store.ts:323-324.

### R05-B02 — confirmed (bug)

Новый probe с исключением после commit: три доставки оставляют queued без owner/активаций; explicit resume даёт одну запись. SIGKILL клиента не испытывался. Обещание same-ID соблюдено, дефект относится к продвижению первоначального старта.

Код: src/service.ts:278-279; src/run-controller.ts:416-464.

### R05-AF01 — confirmed (already-fixed)

retry-reconciliation и reconciliation прошли; SQL-trigger probe сохранил одну запись после explicit accept. Нет свидетельства exactly-once внешнего провайдера.

Код: src/run-store.ts:469-485,712-719,803-825.

### R05-AF02 — confirmed (already-fixed)

Новый continuation suite подтверждает четыре stale-wait комбинации и original producer. Повтор записанного ответа отличается от новой работы.

Код: src/run-store.ts:567-576; tests/continuation.test.ts:226-271,322-355.

### R05-U01 — unknown (unknown)

Новый synthetic probe подтвердил зависимость helper от первой причины. Достижимость mixed-effects leaf штатным графом не установлена; bug не повышать.

Код: src/lineage.ts:396-403; src/run-store.ts:718-719.

### r06-B01 — confirmed (bug)

Новый GitWorkspaces probe: cache/ скрытого вложенного repo не совпал с cache/value.txt; незакоммиченные bytes заменены WORKER. Обычный ignored каталог и unignored repo отвергнуты. Это не отсутствие всей collision-защиты.

Код: src/workspaces.ts:250-267,176-179.

### r06-B02 — confirmed (bug)

Оба index flags в новом probe скрыли source/child edits; commit и snapshot оставили старое дерево. Снятие flags восстановило отказ dirty. Hash корректен для индекса, не для всех bytes; перезапись скрытого tracked-файла не доказана.

Код: src/workspaces.ts:28-54,282-285; skills/dynamic-workflows/recipes/implementation-review/snapshot.mjs:21-27.

### r06-A01 — confirmed (already-fixed)

Код сверяет owned workspace и строки review revisions; новые lineage/reconciliation/workspaces tests проходят. Истинность произвольной строки input runtime сам не устанавливает.

Код: src/run-runtime.ts:337-345,359-372; src/workspaces.ts:157-175.

### r06-A02 — confirmed (already-fixed)

Новые crash/allocation suites прошли: сохранение frontier/child writes и запрет изменённого complete HEAD. Это не атомарный rollback всех merges и не проверка всех аварийных окон.

Код: src/workspaces.ts:69-150,180-227; tests/git-recovery-crash.test.ts:81-175.

### r06-A03 — confirmed (already-fixed)

Прочитан post-study код общего валидатора и его ранний вызов. Не баг текущего publication и не предлагаемое новое внедрение; post-study tests не запускались.

Код: 86f5e07:src/parallel-isolation.ts:5-35; 86f5e07:src/graph.ts:195-201.

### r06-A04 — confirmed (already-fixed)

Прочитан diff: верхнеуровневый input и точное копирование версии действительно описаны после study-source.

Код: 3d8ba65:skills/dynamic-workflows/references/authoring.md:128-156.

### r06-U01 — unknown (unknown)

commit идёт после child; сравнение произвольного child revision с tree отсутствует, locks локальны. Race-fixture не выполнялся, документированная внешняя запись не превращена в новый bug.

Код: src/run-runtime.ts:325-334,359-372; src/workspaces.ts:296-303.

## Реально выполненные проверки

- c03-E01: `python3 hashlib.sha256(read_bytes()) для обеих пар до чтения`. Все четыре SHA256 совпали с collect metadata; обе оболочки succeeded, оба result complete. Границы: Это целостность входов, не доказательство их выводов.

- c03-E02: `cd /tmp/c03-review-i6jcI2/source; TMPDIR=/tmp/c03-review-i6jcI2/tmp node --import tsx /tmp/c03-review-i6jcI2/probe05.mjs; node --import tsx /tmp/c03-review-i6jcI2/mixed.mjs`. Оба exit 0; B01/B02, checkpoint failure и synthetic mixed causes воспроизведены. Границы: Извлечённые и инспектированные fixtures из Markdown; только новый /tmp, локальные check/SQLite.

- c03-E03: `cd /tmp/c03-review-i6jcI2/source; TMPDIR=/tmp/c03-review-i6jcI2/tmp node --import tsx /tmp/c03-review-i6jcI2/probe06.mts /tmp/c03-review-i6jcI2/source /tmp/c03-review-i6jcI2/fixtures`. Exit 0, пять assert-backed сценариев воспроизведены. Границы: Настоящий GitWorkspaces, не live provider. Флаги index включены явно в каждом repo.

- c03-E04: `node --import tsx --test --test-concurrency=1 tests/retry-reconciliation.test.ts tests/lineage.test.ts tests/workspaces.test.ts tests/reconciliation.test.ts`. 29/29 passed, fail/skipped=0. Границы: Новая архивная копия study HEAD с существующими зависимостями dev; не полный npm test.

- c03-E05: `node --import tsx --test --test-concurrency=1 tests/continuation.test.ts tests/allocation-recovery.test.ts tests/git-recovery-crash.test.ts`. 38/38 passed, fail/skipped=0. Границы: Только свои fixture processes, Git и БД; устойчивость полного параллельного suite не доказана.

## Контрдоказательства и рекомендации

Study-source: R05-AF01/AF02, r06-A01/A02 подтверждены; не переоткрывать.

Post-study: r06-A03/A04 подтверждены чтением; не предлагать повторно.

B01 r05 и B02 r05 — разные ветки повторной доставки; B01 r06 и B02 r06 — разные причины Git false-clean/collision, не дубли.

Изменения отчётов не требуются. Минимальные исправления авторов разумно рассматривать отдельно: завершение исходной доставки без ослабления fence; нормализация directory entries; явный контракт index flags. Риски — ошибочный relaunch, ложный отказ sparse checkout и изменение пользовательского индекса. Приёмка: воспроизведённые сценарии должны стать безопасными, отрицательные контроли и текущие регрессии сохраняться. Ничего не внедрено.

## Unknowns и границы

- R05-U01: штатная достижимость mixed-effects leaf.
- r06-U01: конкурентная внешняя запись после snapshot.
- Другие Git/платформы и live provider не проверены.

Исторические 75/50 тестов авторов не выдаются за новые прогоны критика: здесь заново пройдено 67 профильных тестов. Полный npm test, post-study suite и live providers не запускались. Race fixture U01 остаётся предложенной проверкой.

## Источники

- Исходный HEAD e15bc407da8753fd6b683c0aa4a68634e3c458a7
- Входные пары и metadata researchResults
- PROJECT_INFO/workspaces.md:24-26,52-56,87-104
- PROJECT_INFO/execution-plan.md:171-195
- 3d8ba65:skills/dynamic-workflows/references/authoring.md:128-156
- 86f5e07:src/graph.ts:195-201
- 86f5e07:src/parallel-isolation.ts:5-35
- skills/dynamic-workflows/recipes/implementation-review/snapshot.mjs:21-27
- src/lineage.ts:396-403
- src/run-controller.ts:193-201
- src/run-controller.ts:416-464
- src/run-runtime.ts:325-334,359-372
- src/run-runtime.ts:337-345,359-372
- src/run-store.ts:323-324
- src/run-store.ts:469-485,712-719,803-825
- src/run-store.ts:567-576
- src/run-store.ts:718-719
- src/service.ts:128-130
- src/service.ts:278-279
- src/workspaces.ts:157-175
- src/workspaces.ts:250-267,176-179
- src/workspaces.ts:28-54,282-285
- src/workspaces.ts:296-303
- src/workspaces.ts:69-150,180-227
- tests/continuation.test.ts:226-271,322-355
- tests/git-recovery-crash.test.ts:81-175
