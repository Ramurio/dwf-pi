# c04: независимое ревью r07/r08

Дата: 2026-09-20. Source/artifactRevision: `e15bc407da8753fd6b683c0aa4a68634e3c458a7`.
Acceptance: `dwf-astra-research-evidence-v1`.
reviewedMaterialDigest: `sha256:8677d575b6cd304044dd0181ceaa960e041155ea9fba63880c1ea3d64a5f839d`.

**complete / approve** — достоверность проверенных утверждений, не разрешение внедрять идеи.
Обе supplied collect оболочки succeeded, оба результата complete. До чтения сверены все четыре SHA256; совпадения полные. HEAD критика — supplied study commit. Версии report JSON отдельно:

- r07: `sha256:4ea71d4ada5ee4bf3b4ae7c063a816ab1ae56878e39749f96bcb76ba3b983474`; snapshot `e0dfac01836f02fb2182a01d173f5987746841a7`. MD SHA256 `9eae292cbfc22378efd1aa5a8646943d31a7db85caa8057888ba13264442e2d3`.

- r08: `sha256:ffec7efcf77bb7ab2481096f03069f754759de6509886e19dc6c773668de5af5`; snapshot `e21957fd8094f917e4d13e40bec67ab50417a3c5`. MD SHA256 `7245c39a24e2c1d28ede088593ae4c38076e45db9da541e9f1c56ea99f6f6e74`.

## Coverage и независимая проверка
authoring CAS, CLI/MCP continuation validation, public draft schema, service lifetime, role defaults/custom prompts, frozen skill delivery/manual-only, eval corpus structural contracts. Прочитаны AGENTS, architecture/development/known-issues, service/authoring и git log; затем причинные участки кода, tests/store, lineage и skill-delivery.

## Каждая находка

### R07-B01 — confirmed (bug)
`src/lineage.ts:244-259`; `src/mcp-tools.ts:37-40`. Повторный offline fixture: MCP отвергает [hash], CLI создаёт paused successor; правильная повторная доставка возвращает тот же ID. reuse:null принят CLI, отвергнут MCP.

Контрдоказательство/граница: Неверная строка hash отвергнута; обход свежести и повтор внешних эффектов не установлены.

### R07-B02 — confirmed (bug)
`src/store.ts:42-49`; `src/cli.ts:30-31`; `tests/store.test.ts:9-34`. Барьер двух отдельных CLI: ровно один успех, revision=2, проигравший Error без revision-полей. Последовательный stale patch возвращает RevisionConflictError.

Контрдоказательство/граница: CAS работает; это диагностика, не потеря обновления. Естественная частота гонки не измерена.

### R07-B03 — confirmed (bug)
`src/service.ts:91-93`; `src/authoring.ts:31-39`; `src/public-schema.ts:20-48`. Ajv после JSON round-trip: только draft даёт reference Json resolves to more than one schema. portableInputSchema исправляет компиляцию и принимает незавершённый draft.

Контрдоказательство/граница: Не дефект patch/id; не доказана несовместимость со всеми валидаторами.

### R07-B04 — confirmed (bug)
`src/service.ts:48-69`; `src/service.ts:114-120`. Immediate close перед await prepare, затем повторный close: обе SQLite connection доступны; future dispatch отвергнут; normal await/close закрывает connection.

Контрдоказательство/граница: Не доказан транспортный MCP disconnect или production leak; CLI normal ordering корректен.

### R07-I01 — confirmed (idea)
`src/mcp.ts:19-34`; `src/cli.ts:24-34`. Негативные запросы дают разные name/message, но одинаково отвергаются; stale revision сохраняет одинаковые поля.

Контрдоказательство/граница: Это идея унификации, не доказанный контракт побайтового равенства.

### R08-F01 — confirmed (already-fixed)
`src/catalog.ts:31-35,59-75,93-95`; `src/pi-worker.ts:164-173`; `tests/skill-delivery.test.ts:17-65`. Новый scripted SDK probe подтвердил видимость и чтение frozen skill и reference всеми шестью ролями; исходные файлы удалены fixture-ом.

Контрдоказательство/граница: Исторические 129 тестов не перезапускались. Scripted выбор read не предсказывает поведение модели.

### R08-F02 — confirmed (unknown)
`src/pi-worker.ts:312`; `node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js:275-278`. Парный probe: visible-not-read видим, hidden невидим, оба submit успешны; SDK явно фильтрует disableModelInvocation.

Контрдоказательство/граница: Подтверждена граница и корректность unknown, а не баг. Требуется продуктовый контракт manual-only.

### R08-F03 — confirmed (idea)
`src/catalog.ts:67-75`; `src/output-schema.ts:26-46`. Шесть schemas: 24 golden pass, 72 malformed reject, 48 планов, 3 fixture checks. Schema-valid ложный total=999 принят, как и должно быть без semantic oracle.

Контрдоказательство/граница: Не совет менять универсальный каталог; oracle и corpus не являются доказательством live качества.

### R08-F04 — confirmed (unknown)
`src/catalog.ts:58-75,85-95`; `src/pi-worker.ts:169,312`; `PROJECT_INFO/development.md:151-171`. Custom prompt заменяет роль, mandatory protocol остаётся; visible skill не обязательно читается. Документированный prompt eval не охватывает эти шесть ролей со skills.

Контрдоказательство/граница: Качество/injection устойчивость остаются unknown; scripted transport не модельный eval.

## Выполненные эксперименты

### C04-E01
Команда: `python3: SHA256 четырёх supplied report paths; git rev-parse HEAD`.

Исход: Обе collect succeeded, result complete; все четыре SHA совпали; HEAD совпал с sourceRevision.

Границы: Хеш связывает материал, не доказывает его истинность.

### C04-E02
Команда: `TMPDIR=/private/tmp/c04-review-Sef9DX/tmp node --import /private/tmp/c04-review-Sef9DX/node_modules/tsx/dist/loader.mjs /private/tmp/c04-review-Sef9DX/probe.mjs /private/tmp/c04-review-Sef9DX /private/tmp/c04-review-Sef9DX`.

Исход: Все assertions R07 fixture прошли; B01–B04 и I01 воспроизведены.

Границы: Копия src и package.json из текущего worktree; зависимости существующего dev через symlink. Два первых запуска через /tmp завершились MCP ConnectionClosed; canonical /private/tmp устранил различие путей entrypoint. Это не новая находка. Изменён только stderr handler для диагностики в собственной копии fixture. Только собственные БД/процессы, без supervisor.

### C04-E03
Команда: `node --import /private/tmp/c04-review-Sef9DX/node_modules/tsx/dist/loader.mjs /private/tmp/c04-review-Sef9DX/roles.mjs /private/tmp/c04-review-Sef9DX`.

Исход: 10 scripted cases прошли: шесть ролей читают skill/reference; visible-not-read, hidden, custom, invalid подтверждены.

Границы: Исходник из offlineProbes.rolesAndSkills, заменён только /tmp prefix на c04. Нет live provider.

### C04-E04
Команда: `node --import /private/tmp/c04-review-Sef9DX/node_modules/tsx/dist/loader.mjs /private/tmp/c04-review-Sef9DX/corpus.mjs <supplied r08 reportJson> /private/tmp/c04-review-Sef9DX`.

Исход: 6 schemas, 24 golden, 72 negative, 48 plans, 3 checks; semanticMismatchAccepted=1, modelCalls=0.

Границы: Исходник из offlineProbes.corpusContracts, только prefix c04. Это structural eval, не независимая оценка всех семантических golden ответов.

## Already-fixed / refutations
- Skill delivery не переоткрыт; runtime visibility не равна качеству применения.
- B03 не дублирует исправленный public patch id; B02 не опровергает атомарность CAS.
- Post-study: 86f5e07 early parallel-isolation и 3d8ba65 reviewer-binding docs отделены от study; повторная реализация не рекомендуется. Эти post-study изменения не тестировались здесь.
- Ownership UI/control/await и wait disclosure не входят в новые findings.

## Unknowns
- Live provider, качество prompts и injection не проверялись.
- Исторические 181/129 tests не повторялись; проверены ключевые самостоятельные fixtures, не весь test suite.
- MCP disconnect lifetime race и естественная частота CAS не измерены.

## Рекомендация
Отчёты можно агрегировать без содержательной правки. Для будущих исправлений использовать узкие acceptance criteria авторов; идеи не внедрять автоматически. Риск: Нельзя переносить approve на иной digest или считать его разрешением изменения runtime. Критерий: Сохранить source/material binding, unknowns, counterevidence и разделение study/post-study.

Историческая коллекция max не переименована: новые модельные операции continuation — low по заданию; исторические исследования не объявляются low. Собственных model/provider вызовов нет. Источники и точные input bindings сохранены в JSON; сырые логи не публикуются.
