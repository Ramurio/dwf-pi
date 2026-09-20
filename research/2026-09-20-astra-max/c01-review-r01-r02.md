# c01 — независимое ревью r01/r02

- **criticId:** `c01`
- **topic:** `Независимое ревью r01/r02`
- **date:** `2026-09-20`
- **sourceRevision:** `e15bc407da8753fd6b683c0aa4a68634e3c458a7`
- **artifactRevision:** `e15bc407da8753fd6b683c0aa4a68634e3c458a7`
- **acceptanceCriteriaRevision:** `dwf-astra-research-evidence-v1`
- **publicationRevision:** `3d8ba65ee84402c0e3b0587f70095b7847824a9f`
- **reviewedMaterialDigest:** `sha256:eef2b627b6561fb4569a431774164962c46452fa6992615a1d26a6a75c4be434`
- **Решение:** approve; status complete. Блокеров нет.

## Входы и привязка

Обе collect оболочки succeeded, result complete. До чтения сверены четыре файла. HEAD действительно e15bc40.

### r01
- workspace: `/Users/ramu/.dynamicwf/runs/run-9dbb044c-664f-4dd8-96c0-57192dc4ed89/worktrees/bdbc8f9f0e0714e5fc160a485f0845516735ec68dd17f8e91bedca170edb4d10`
- base: `e15bc407da8753fd6b683c0aa4a68634e3c458a7`; snapshot head: `5b1ac700fad9e6855624b98233d8b4be1e740194`
- reviewedArtifactRevision: `sha256:bcd5065cd25107d07a6356aa18603eac1c13397ff2f45970603ed6dfaa24facf`
- MD SHA256: `d8de0f86cd4df6662fbc83c33b4830828ac7eced5fb563c14ab592188b5cbb38`
- JSON SHA256: `bcd5065cd25107d07a6356aa18603eac1c13397ff2f45970603ed6dfaa24facf`
### r02
- workspace: `/Users/ramu/.dynamicwf/runs/run-9dbb044c-664f-4dd8-96c0-57192dc4ed89/worktrees/1ba689599a7d25b37d97e1074c9b9456e535b7f0e51c0cc292f2e5064653b9b6`
- base: `e15bc407da8753fd6b683c0aa4a68634e3c458a7`; snapshot head: `9523c9137dbc6e3099789df684e452ca0d680fcf`
- reviewedArtifactRevision: `sha256:0669f868796e50e1478bf5024539b95fc000c08beaf1a3ead958a145dd2c2a43`
- MD SHA256: `fa11dc63ae552d8189f457df0d320e48f77d5e8a54521d29922e10338165c2fa`
- JSON SHA256: `0669f868796e50e1478bf5024539b95fc000c08beaf1a3ead958a145dd2c2a43`

Digest вычислен от полного researchResults (включая summaries/paths/workspace/status), Python json.dumps(sort_keys=True,separators=(",",":"),ensure_ascii=False), UTF-8; это не хеш отчёта критика.

## Coverage
- Прочитаны AGENTS, architecture/development/known-issues, профильные graph/collect/retry контракты, git log; независимо просмотрены compiler/evaluator/graph/public schema/runtime и ключевые тесты.
- Все 11 основных findings получили assessment; 6 bug воспроизведены. Отдельные retained live-descendant/nested fail-fast сценарии не повторялись.

## Assessment каждого finding

### r01-B01 — confirmed (bug)
**Канонизация object.fields меняет exists/fallback на routing error**

Код: `src/compiler.ts:17-23,68,121; src/expressions.ts:54-58; src/run-runtime.ts:126-134`.

Новый r01-0.ts: original AST → no/fallback, generated → boolean error; старт succeeded в обоих, terminal no только в direct. r01-3.ts подтвердил одинаковый hash перестановок и boolean controls. Это порядок исключений AST, не дефект приоритета router.

### r01-B02 — confirmed (bug)
**Прямая graph JSON-граница выполняет inherited code и принимает нестабильный snapshot**

Код: `src/graph.ts:77-103,243-246; src/authoring.ts:154-156; src/output-schema.ts:13-15`.

r01-1.ts: getter 3 вызова, parsed length=1 без own 0, повторная validation false, generated []; entries=3. Четыре обычных hole controls отклонены, authoring/output отказали без getter. Применимость только к прямому JS API; не удалённая JSON-инъекция.

### r01-B03 — confirmed (bug)
**workflow.schema.draft содержит конфликтующие named definitions**

Код: `src/service.ts:91-93; src/authoring.ts:30-39; src/public-schema.ts:20-48`.

r01-2.ts: Ajv отверг duplicate Json; portable копия приняла draft и отвергла extra; public patch компилируется. r01-7.ts подтвердил strict:false не исправляет draft. Не смешивать внутренний TypeBox и публичный переносимый документ.

### r01-U01 — unknown (unknown)
**Сохранение знака -0 не определено контрактом**

Код: `src/expressions.ts:36-37,50; src/compiler.ts:18; PROJECT_INFO/execution-plan.md:171-174`.

r01-5.ts подтвердил signed-zero divergence, но eq=true и wire=0. Транспортная нормализация документирована; необходимость bit-level direct/compiler parity не доказана. Bug не повышать.

### r01-AF01 — confirmed (already-fixed)
**Компенсированные дырки authoring/output отклоняются**

Код: `src/authoring.ts:154-156; src/output-schema.ts:13-15; tests/json-array-boundary.test.ts:22-45`.

Новый профильный suite и exotic control прошли; уже исправленные границы не переоткрывать.

### r01-AF02 — confirmed (already-fixed)
**Literal-preserving conversion и публичный patch/id работают**

Код: `src/public-schema.ts:38-41; src/authoring.ts:30-33; tests/public-patch-schema.test.ts:8-33`.

Новые public-schema-literals/public-patch-schema suites прошли. B03 относится отдельно к raw DraftSchema.

### r01-AF03 — confirmed (already-fixed)
**Общий router сохраняет порядок, fallback и short-circuit**

Код: `src/expressions.ts:85-134; tests/routing-equivalence.test.ts:61-154`.

Новый routing-equivalence прошёл; r01-4.ts: 16 уникальных активаций, replay fan/done, lazy controls. Нет основания переписывать общий router.

### R02-B01 — confirmed (bug)
**step.catchAll сокращает составной Cause перед collect**

Код: `src/run-runtime.ts:69-76,196-214; src/compiler.ts:109-125`.

Новый verify.mts: cleanup/typed-interrupted/interrupt после step → Success и collection=1, defect → Failure/collection=0. Direct collect в новом collection suite отвергает mixed причины. Ошибка до collect; retry решение использует полный Cause до catchAll. Новая матрица sequential/parallel-generated, не полное повторение retained parallel-Cause матрицы.

### R02-B02 — confirmed (bug)
**clearPid в finally замещает исходный отказ; untyped cleanup пропускает следующий writer**

Код: `src/run-runtime.ts:279-285,348-356; src/run-store.ts:435`.

Новый verify.mts: обычный ENOENT process/setup/not-started, group empty; SQL cleanup fault → unknown/execution, ENOENT исчез, следующий check записал marker, group pending. finish(succeeded) отказал. Реальный offline процесс/SQLite, не доказательство частоты дисковых отказов и не успешный persisted run.

### R02-B03 — confirmed (bug)
**Interruption ждёт cleanup Promise, но подавляет ошибку очистки**

Код: `src/run-runtime.ts:35-40,191-202`.

Новый abort-case достиг settled callback, вернул Failure/interrupted с пустыми failures/defects; cleanup marker потерян и group pending. Доказана потеря диагностики, не живой процесс после Exit и не успешная отмена.

### R02-AF01 — confirmed (already-fixed)
**Pause/resume admission race уже исправлена в study source**

Код: `src/run-runtime.ts:205-212; src/run-store.ts:459-462; tests/pause-resume-admission.test.ts:29-113`.

Новый admission suite подтвердил resume, cancel, owner loss и отсутствие повторного допуска уже начатой работы. При Cause-aware исправлении guards необходимо сохранить.

## Реально выполненные проверки

### c01-E01
Команда/метод: `sha256sum <collect reportMd/reportJson> для r01 и r02; git rev-parse HEAD`

Исход: Оба collect succeeded/result complete; все четыре SHA совпали до чтения; HEAD=e15bc40. Граница: Не удостоверяет исторические команды producer.

### c01-E02
Команда/метод: `P=$(mktemp -d /tmp/c01-review-XXXXXX); mkdir "$P/source"; git archive HEAD src tests package.json package-lock.json | tar -x -C "$P/source"; ln -s <разрешённый dev>/node_modules "$P/source/node_modules"; извлечение просмотренных TS blocks r01 в r01-0..7.ts; cd "$P/source"; for f in r01-*.ts; do node --import tsx "$f"; done`

Исход: Все 8 fixtures exit=0; подтверждены три bug, signed zero и counterexamples. Граница: Точная копия study; модели/сеть не используются; generated files только в новом /tmp.

### c01-E03
Команда/метод: `Извлечение просмотренного блока typescript r02-offline-probe в "$P/verify.mts"; cd "$P/source"; node --import ./node_modules/tsx/dist/loader.mjs "$P/verify.mts"`

Исход: exit=0, все 8 cases прошли, включая реальный check writer и abort cleanup. Граница: SQLite trigger — искусственный отказ; runtime.check подставлен только в Cause/release cases. Нет supervisor/live provider.

### c01-E04
Команда/метод: `node --import tsx --test --test-concurrency=1 tests/pause-resume-admission.test.ts tests/json-array-boundary.test.ts tests/public-schema-literals.test.ts tests/public-patch-schema.test.ts tests/routing-equivalence.test.ts tests/collection.test.ts`

Исход: 108 pass, 0 fail/cancelled/skipped. Граница: Не полный npm test; исторические 143/234 не объявлены повторно выполненными.

Fixtures извлечены из проверенных Markdown после просмотра, а не из старых /tmp. Порядок r01-0..7: journal parity, exotic array, schema service, parity, scopes, zero, boundaries, public. Для повторения использовать новый c01 /tmp и те же блоки входных файлов; не старый путь. Assertions воспроизводят дефекты, а не требуют сохранить их после исправления.

## Контрдоказательства, дубли, already-fixed
- Direct collect корректен: tests/collection.test.ts:117-143 и новый suite.
- Effect release defect не исчезает: verify.mts сохранил primary и release-write, collection=0.
- Terminal success при pending группе защищён: src/run-store.ts:435 и новый fixture.
- r01-B01 и R02-B01 не дубли: сериализация AST против сокращения Cause. R02-B02/B03 имеют общий cleanup, но разные каналы потери: JS finally против async canceler.
- 86f5e07 ранняя isolation и 3d8ba65 reviewer documentation — post-study already-fixed, не новые рекомендации; просмотрены git show --stat, publication behavioral tests не запускались.

## Unknowns
- r01-U01: bit-level signed-zero контракт direct/compiler не определён; транспорт определён.
- R02-U01..U04 остаются unknown: live occurrence, agent/Git cleanup, реальный диск/recovery, все ОС/Node/publication.
- Исторические totals и retained дополнительные сценарии не аттестованы этим критиком; новые проверки подтверждают ключевые выводы независимо.

## Рекомендация и приёмка

Изменения проверенных отчётов не требуются. Минимальные рекомендации авторов сохраняются как предложения, не реализация. Для runtime сначала Cause-aware preservation с сохранением admission guards, затем отдельный cleanup outcome; риск — случайный retry/допуск при interrupt и ложный cleanup defect штатной отмены. Для compiler/schema — единый порядок evaluator/serializer, строгие собственные индексы/prototypes и portable DraftSchema; риск совместимости source/hash и прямого API. Приёмка — предложенные авторами negative/control регрессии, включая запрет следующего writer, сохранение полного Cause, direct/generated parity и portable schema. Эти изменения и расширенные acceptance suites здесь не выполнены.

## Источники
- AGENTS.md
- PROJECT_INFO/architecture.md
- PROJECT_INFO/development.md
- PROJECT_INFO/known-issues.md
- PROJECT_INFO/graph-contract.md:165-184
- PROJECT_INFO/outcomes-and-waits.md:157-183
- PROJECT_INFO/retry-and-failures.md:131-154
- PROJECT_INFO/execution-plan.md:171-174
- src/compiler.ts:17-23,68,121; src/expressions.ts:54-58; src/run-runtime.ts:126-134
- src/graph.ts:77-103,243-246; src/authoring.ts:154-156; src/output-schema.ts:13-15
- src/service.ts:91-93; src/authoring.ts:30-39; src/public-schema.ts:20-48
- src/expressions.ts:36-37,50; src/compiler.ts:18; PROJECT_INFO/execution-plan.md:171-174
- src/authoring.ts:154-156; src/output-schema.ts:13-15; tests/json-array-boundary.test.ts:22-45
- src/public-schema.ts:38-41; src/authoring.ts:30-33; tests/public-patch-schema.test.ts:8-33
- src/expressions.ts:85-134; tests/routing-equivalence.test.ts:61-154
- src/run-runtime.ts:69-76,196-214; src/compiler.ts:109-125
- src/run-runtime.ts:279-285,348-356; src/run-store.ts:435
- src/run-runtime.ts:35-40,191-202
- src/run-runtime.ts:205-212; src/run-store.ts:459-462; tests/pause-resume-admission.test.ts:29-113

Существенных искажений проверенных выводов не найдено. Approve относится к evidence-достоверности этих файлов и digest, не к внедрению предложений.

Историческая коллекция сохраняет имя astra-max; исторические исследования max не переименованы. Новые модельные вызовы из tools не выполнялись; текущий continuation использует назначенный low. Исходники и чужие отчёты не изменены.
