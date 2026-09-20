# c06 — независимое ревью r11/r12

Дата: 2026-09-20. Topic: graph scale / usage lineage.
sourceRevision и artifactRevision: `e15bc407da8753fd6b683c0aa4a68634e3c458a7`.
acceptanceCriteriaRevision: `dwf-astra-research-evidence-v1`.
reviewedMaterialDigest: `sha256:1adb5e9862e627363e5093163e7ac6c33e069ec09ec5187152a3385cd372ce19`.

## Вердикт
**complete / approve** — достоверность evidence, не разрешение внедрять идеи. Существенных искажений не обнаружено. Все шесть bug claims повторены offline.

## Входы и привязка
Обе оболочки сначала проверены: succeeded, result complete. До чтения содержимого сверены SHA256 обоих файлов каждого автора; все четыре совпали. Пути и workspace base/head/path сохранены полностью в JSON inputVerification.

- r11: reviewedArtifactRevision `sha256:2366e41b1b2e0cd9cc270c5b5274dbcebef6430b772218334f700e182121b9e9`; Markdown SHA `69671ef9c6c63d581c16309e9ce9e07687a12bdc1df9e5e8e708b2bedd68e525`; snapshot `03dd18f847939608515bfc273fc444687738a986`.

- r12: reviewedArtifactRevision `sha256:bc1100a21e570c3519bde5880114815aab54ef7a477a7c06b394eb9e21916511`; Markdown SHA `5749bb45314e45942a70e3593b04188e428ebf3b3be70eff06f8ff4f42d69ee3`; snapshot `1c3d386422b65de37165ee3001f529579660d167`.

## Coverage и finding-by-finding
Независимо прочитаны обязательные документы/история, camera/render/focus, worker accounting, ledger, summarizer и lineage; inspected accessibility test не проверяет activeElement после activation.

### r11-B01 — bug / confirmed
Chrome: Enter и semantic redraw переводят activeElement в BODY; сохранённый selection не равен focus. src/graph-view/app.js:484-514,967-969.

### r11-B02 — bug / confirmed
Chrome: n10 вне SVG viewport после 11 Tab; нет focus handler сдвига камеры. src/graph-view/app.js:1023-1029,1067-1090. Fit остаётся обходным путём, keyboard trap не заявлен.

### r11-B03 — bug / confirmed
Chrome: fit width 76951.045 → zoom-out 30000, видимых узлов 250 → 97; малая цепочка увеличивает width правильно. src/graph-view/app.js:904-925.

### r11-B04 — bug / confirmed
Chrome getBBox подтверждает выход широких W за карточку; ID не усечён при длине 30. src/graph-view/app.js:892,1044; layout.js:56-66. Это содержимое, не пересечение маршрутов.

### r11-I01 — idea / confirmed
Идея обоснована повторным layoutGraph и replaceChildren при renderGraph (app.js:948-969), историей без виртуализации. Timing локален; SLA/регрессия не доказаны. Кэшировать только geometry, не traversals.

### r11-U01 — unknown / unknown
unknown сохраняется: model.ts:50-57 выбирает последний конечный статус; контракт reducer смешанных исходов не определён. Не объявляем потерю данных.

### r11-AF01 — already-fixed / confirmed
70 профильных тестов включают graph-layout-overlap; geometry fixture: все collision assertions прошли на 10 графах. layout.js:13-135. Не гарантия всех топологий.

### r11-AF02 — already-fixed / confirmed
Chrome fixture подтверждает scope counts 3/2 и отсутствие старого attention; app.js:989-1002,1022-1032. Accessibility тест отдельно прочитан; все исторические 4 случая повторно не запускались.

### r11-AF03 — already-fixed / confirmed
graph-view-observation повторно зелёный; app.js:484-509 сохраняет wait disclosure/editor. Не переносить графовый focus bug на await.

### R12-B01 — bug / confirmed
Native SDK fixture: missing и explicit zero дают settled=true/partial=false/0; positive=13, каждый один запрос. pi-worker.ts:100-105,274-281 принимает успешный placeholder. Это до корректного UI missing-as-zero; live частота неизвестна.

### R12-B02 — bug / confirmed
Production renderTokens с RunStore повторно дал «попытка 2 … попытка 1» при корректных 8/12/20. monitor.ts:38-50; model.ts:82-86; app.js:1383-1387. Причина presentation-only, не порча ledger.

### R12-I01 — idea / confirmed
pi-worker.ts:278-280 действительно объединяет SDK message и sentReasoning. Provenance полезен как идея; фактические серверные рассуждения не доказаны.

### R12-AF01 — already-fixed / confirmed
usage-contract зелёный; run-store.ts:898-959 отделяет identity, transaction и sticky legacy; usage.ts:55-124 не удваивает структурные результаты. Полные исторические 196 тестов не повторены.

### R12-AF02 — already-fixed / confirmed
lineage tests зелёные; lineage.ts:279-381 разделяет source/producer schema и отвергает stale binding. Более широкие continuation/provider/trace исторические результаты не объявляются новым прогоном.

### R12-U01 — unknown / unknown
Оставлено unknown: pi-worker.ts:100-105 и native offline transport не доказывают частоту live missing usage.

### R12-U02 — unknown / unknown
Оставлено unknown: service.ts:178-185,295-305; последовательные чтения не доказывают пользовательскую гонку. Двухсоединительный interleaving не выполнялся.

### R12-U03 — unknown / unknown
Оставлено unknown: usage.ts:121-124 прямо отделяет estimate от invoice; pi-worker.ts:278-280 не подтверждает server-side effort.

## Реально выполненные эксперименты

- **C06-E01**: `sha256 всех четырёх файлов до чтения; git log -5 --oneline; git show --stat 86f5e07 3d8ba65`. Обе collect succeeded/complete; все SHA совпали; study HEAD точный. Границы: Snapshot head из collect; отдельная проверка чистоты producer worktrees не выполнялась.

- **C06-E02**: `node /tmp/c06-review/browser.mjs; node /tmp/c06-review/geometry.mjs`. Оба exit 0; B01–B04 воспроизведены в Chrome, geometry assertions прошли. Границы: Fixture извлечён из проверенного JSON после инспекции; изменён только tmp prefix. Production код из фактического cwd; synthetic snapshots, не live run.

- **C06-E03**: `git archive HEAD src tests package.json package-lock.json | tar -x -C /tmp/c06-review/source; подключён существующий node_modules; cd /tmp/c06-review/source; R12_DEV=$PWD node --import tsx ../missing-usage.mts; R12_DEV=$PWD node --import tsx ../attempt-label.mts`. Оба exit 0; missing/zero/positive=0/0/13 и ошибочная подпись при правильных 8/12/20. Границы: Fixtures извлечены из Markdown; заменён только /tmp prefix. Реальный SDK parser, подставной транспорт, собственные SQLite.

- **C06-E04**: `cd /tmp/c06-review/source; node --import tsx --test --test-concurrency=1 tests/graph-layout-overlap.test.ts tests/graph-view-observation.test.ts tests/usage-contract.test.ts tests/lineage.test.ts`. 70 passed, 0 failed/skipped. Границы: Не весь npm test; не повтор исторических 45/196 тестов.

## Контрдоказательства, already-fixed и unknowns
- Графовый focus не равен await editor focus; исправления ownership/disclosure сохранены.
- Missing provider usage не равен исправленному отображению отсутствующего ledger report.
- R12-B02 не означает двойной счёт или повреждение producer identity.
- Post-study 86f5e07 и 3d8ba65 не предлагаются повторно; отделены от e15bc40.
- Live provider частота и billing не проверялись.
- Другие браузеры, screen readers, concurrent usage snapshots не проверялись.
- Исторические counts авторов не сертифицируются как новый прогон критика.

## Рекомендация
Изменений материалов для принятия не требуется. Минимальные изменения, риски и acceptance авторов сохраняются как предложения; не внедрены. Browser geometry не является SLA, native mock не доказывает live provider. Между r11 и r12 нет дублирующего bug: focus/viewport/zoom/text отличаются от accounting provenance/report label.

## Источники и provenance
`AGENTS.md`, `PROJECT_INFO/architecture.md`, `PROJECT_INFO/development.md`, `PROJECT_INFO/known-issues.md`, `PROJECT_INFO/observation.md`, `PROJECT_INFO/run-journal.md`, `src/graph-view/app.js`, `src/graph-view/model.ts`, `src/graph-view/layout.js`, `src/pi-worker.ts`, `src/run-store.ts`, `src/usage.ts`, `src/lineage.ts`, `tests/graph-node-accessibility.test.ts`.
Исторические исследования max повторно использованы; новое ревью не переименовывает их режим. Новые вызовы модели заданы графом low; вручную модель не вызывалась.
