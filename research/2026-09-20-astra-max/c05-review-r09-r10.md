# c05 — независимое ревью r09/r10

Дата: 2026-09-20. Study/source/artifactRevision: `e15bc407da8753fd6b683c0aa4a68634e3c458a7`. Acceptance: `dwf-astra-research-evidence-v1`.

ReviewedMaterialDigest: `sha256:c4afd282534c46b4d87184a7d000c38bd01a2bcddbc628f0373dbf2da10c28d5`.

**complete / approve**: существенных искажений не установлено. Это приёмка доказательности конкретных материалов, не разрешение реализовать все идеи.

## Входы и binding

Обе collect оболочки succeeded, оба result complete, blockers пусты. Перед чтением вычислены и сверены четыре SHA256:

- r09: `r09-waits-gates-ux.md` — `1027aa819b121a5063a497dda404d2b536b8952e40db06f29b6d337f788927cf`; JSON — `97210cb550365236cad5cba94909d6cb646406d7700605c461df673ffef0e8ea`; reviewedArtifactRevision `sha256:97210cb550365236cad5cba94909d6cb646406d7700605c461df673ffef0e8ea`; snapshot head `1b6a5235816cc7de83839804322d6c15ac9c69c3`, base `e15bc407da8753fd6b683c0aa4a68634e3c458a7`. Файлы прочитаны из workspace collect, не из собственного отсутствующего пути.
- r10: `r10-async-dashboard.md` — `f25c98d1f295c3e76b7fb8540a1db5dc8ba0e34b22e738be8dc83bc98e15f755`; JSON — `11854ecda269ce5f7664557926f8d03c0de1f98681018939386e5cd20a6a4d61`; reviewedArtifactRevision `sha256:11854ecda269ce5f7664557926f8d03c0de1f98681018939386e5cd20a6a4d61`; snapshot head `96458af7f37a800a3e5bae38d343a053219d4caf`, base `e15bc407da8753fd6b683c0aa4a68634e3c458a7`. Файлы прочитаны из workspace collect, не из собственного отсутствующего пути.

Канонизация digest: UTF-8 json.dumps(researchResults,sort_keys=True,separators=(",",":"),ensure_ascii=False). Полный объект входных оболочек сохранён в JSON producerIntegrity.

## Coverage и независимые оценки

### R09-B01 — bug / confirmed

`src/run-runtime.ts:163–167; src/observation.ts:37–39,68; src/graph-view/app.js:1133–1137`. Новый paused.mjs: resolved allow:false, paused, waitingKeys=1, activeKeys=0, узел waiting; monitor сохраняет вопрос. Один event при повторе, конфликт отклонён; resume завершает rejected. Это неверная проекция, не потеря ответа.

### R09-B02 — bug / confirmed

`src/graph-view/app.js:490–507,1133,1144–1175,1459–1468`. Независимый native focus.js подтвердил BUTTON→BODY и SUMMARY→BODY после semantic refresh. Полный авторский CDP browser.mjs завершился timeout Runtime.evaluate; trusted Tab/Space в этом ревью не подтверждены заново. Суть дефекта фокуса подтверждена без CDP; textarea positive control прошёл.

### R09-I01 — idea / confirmed

`src/graph-view/app.js:398–417,656–657`. Recovery находится в инспекторе; навигационный shortcut допустим как идея, польза не измерена. Не требовать resume у succeeded+rejected.

### R09-AF01 — already-fixed / confirmed

`src/graph-view/app.js:1448–1482,1514–1540; tests/graph-view-observation.test.ts:135–368`. 29 профильных регрессий прошли; native current-fixes: поздний await не читает новое посещение, cancel не отправлен.

### R09-AF02 — already-fixed / confirmed

`src/graph-view/app.js:483–507,1138–1161`. Native current-fixes сохранил backward selection, scrollTop 300, disclosure и draft после Back. Это не фокус submit.

### R09-AF03 — already-fixed / confirmed

`src/run-store.ts:562–579; src/run-controller.ts:305–310`. Транзакционный fence/cancel guard прочитан; paused fixture повторно проверил идемпотентность и отказ конфликтующего ответа. Полный continuation suite здесь не запускался.

### R09-U01 — unknown / unknown

`src/graph-view/app.js:1133,1157; tests/graph-view-observation.test.ts:31–84`. IME/AT не проверены. Fake DOM не моделирует native blur; из этого нельзя вывести сбой IME.

### R10-B01 — bug / confirmed

`src/graph-view/app.js:1485–1511,1531,1643`. Native list: новый paused затем старый waiting при detail paused; старый error установил Нет связи. POST один. Последовательность poll сама не создаёт гонку: нужен control follow-up.

### R10-B02 — bug / confirmed

`src/graph-view/app.js:294–306,1470–1474,1632–1648`. Native task: 1600ms, 5 usage/0 task, total 0; остановка только fixture timer даёт 30. Fast 20ms: 5 usage/5 task, total 30. Порог зависит от полного poll, не универсальный лимит.

### R10-B03 — bug / confirmed

`src/graph-view/app.js:744–748,848–860`. Native recovery: GET-before-POST удалил 1→0 cached records и saved, receipt остался; fresh GET восстановил 1. Один POST. Это не повреждение SQLite.

### R10-AF01 — already-fixed / confirmed

`src/graph-view/app.js:165–182,1448–1483`. Snapshot generation защищён; regression suite прошёл. Runs имеет другой writer и не наследует snapshotRequest.

### R10-AF02 — already-fixed / confirmed

`src/graph-view/app.js:270–293,1514–1576`. Native Back/cancel/late-await прошёл без лишнего snapshot/POST.

### R10-AF03 — already-fixed / confirmed

`src/graph-view/app.js:483–509,1144–1147`. Native сохранение textarea/disclosure подтверждено; дублирует R09-AF02, не новый bug.

### R10-AF04 — already-fixed / confirmed

`src/graph-view/usage-pages.js:8–35; tests/usage-pages.test.ts:6–31; src/graph-view/app.js:744–750`. Usage regression прошла; receipt сохраняется даже в B03. Visit ownership и same-key ordering — разные свойства.

### R10-U01 — unknown / unknown

`src/graph-view/app.js:1632–1648`. Live latency/частота не измерялись.

### R10-U02 — unknown / unknown

`src/graph-view/app.js:744–748,848–860`. Матрица inspection writer/application/superseded не воспроизведена; не расширять B03 автоматически.

### R10-U03 — unknown / unknown

`src/graph-view/app.js:1448–1511`. Safari/Firefox/multitab/hidden-tab не проверены.

## Реально выполненные эксперименты

- **C05-E01**: `sha256 обоих файлов каждого producer до чтения; git rev-parse HEAD; git log -5 --oneline`. Все четыре SHA совпали; HEAD study совпал. Обе collect succeeded и result complete. Граница: Не переносит verdict на другие snapshots.
- **C05-E02**: `for c in list task task-fast recovery current-fixes; do node /tmp/c05-replay-1i6sx5in/browser.mjs "$PWD" /tmp/c05-replay-1i6sx5in/$c.js; done`. 5/5 native Chrome fixtures прошли. Runner/common/cases извлечены из hash-verified r10 JSON, изменён только префикс временного профиля. Граница: Подставной fetch; не live API/provider.
- **C05-E03**: `git archive HEAD src tests package.json package-lock.json | tar -x -C "$P/source"; node --import "$P/source/node_modules/tsx/dist/loader.mjs" "$P/paused.mjs" "$P/source" "$P"`. P=/tmp/c05-r09.m4CKB4; paused.mjs из MD прошёл. Зависимости подключены symlink к существующим dev node_modules. Граница: Только собственная БД/supervisor, без модели; исходники из study archive, не publication dev.
- **C05-E04**: `node "$P/browser.mjs" "$PWD" "$P"`. Авторский R09 browser fixture: CDP observation deadline Runtime.evaluate. Причина не установлена. Граница: Не считается багом Dynamicwf или refutation исторического успеха.
- **C05-E05**: `node /tmp/c05-replay-1i6sx5in/browser.mjs "$PWD" /tmp/c05-replay-1i6sx5in/focus.js`. Независимый scenario: initialize(base); focus submit; refreshSnapshot с usage.totalTokens=5; activeElement===body. Затем focus summary, сброс signature и refreshSnapshot: снова body. Обе assertions прошли. Граница: Не повторяет trusted Tab/Space; проверяет native удаление фокуса.
- **C05-E06**: `cd /tmp/c05-r09.m4CKB4/source; node --import tsx --test --test-concurrency=1 tests/graph-view-observation.test.ts tests/graph-view-task-scope.test.ts tests/usage-pages.test.ts`. 29 pass, 0 fail, 0 skip. Граница: Не повторены исторические 83/33 полностью; полный npm test не запускался.

## Контрдоказательства, дубли, рекомендации

Пять bug имеют разные причины: resolved-vs-activation проекция; потеря native control focus; list request order; starvation task loader; recovery same-key GET/POST. Общая перерисовка не делает их дублями. AF01/AF02 r09 и AF01–AF04 r10 частично дублируются и не должны считаться новыми находками. Идея навигации не доказанный bug.

Ownership/disclosure/textarea fixes подтверждены на study. Post-study authoring parallel-isolation b86f5e07 и reviewer-binding docs 3d8ba65 по supplied input уже исправлены; не предлагаются повторно. Не оценивались как новые study bugs.

Минимальная рекомендация: сохранить отчёты; изменения продукта только отдельной задачей с точными acceptanceCriteria авторов. Риски: перенос waiting:false перед gate нарушает учёт допуска; общий generation вместо visit guards возвращает старое посещение; вечный merge recovery замораживает application status. Предложенные проверки изменений не выполнялись.

## Unknowns и provenance

Полный R09 CDP replay не завершился; причина неизвестна, trusted Tab/Space исторический результат не выдаётся за новый. Независимое native воспроизведение доказало центральную потерю focus. Live provider/API, физическая клавиатура, IME/AT и частота на реальных базах не проверялись. Mock не доказывает запись live recovery.

Историческая коллекция сохраняет имя astra-max: по supplied input 13 исторических исследований max, будущие pi low; это не переименование прежних запусков. Модельные процессы из узла не запускались. Publication `3d8ba65ee84402c0e3b0587f70095b7847824a9f` не подменяет study.

Источники: AGENTS.md, PROJECT_INFO/architecture.md, PROJECT_INFO/development.md, PROJECT_INFO/known-issues.md, PROJECT_INFO/observation.md, PROJECT_INFO/outcomes-and-waits.md, git log -5 --oneline. Код/тесты указаны у каждой оценки. Исходники и producer reports не изменялись.
