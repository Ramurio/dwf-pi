# c08 — независимое ревью r15/r16

Дата: 2026-09-20. Тема: testing/fault injection и packaging/onboarding.
Source/artifactRevision: `e15bc407da8753fd6b683c0aa4a68634e3c458a7`.
Acceptance: `dwf-astra-research-evidence-v1`.
reviewedMaterialDigest: `sha256:51d34cb96d11e51b2635051b95f421c9626a0bb3fa07b1fae43527dce0f08d7a`.

## Решение: approve, status complete

Обе collect-оболочки succeeded, оба result complete. До чтения сверены SHA256 всех четырёх файлов из supplied workspace paths — совпали. Недостающих входов нет. Одобряется evidence-достоверность, не внедрение всех рекомендаций.

## Привязка материалов

- r15: JSON `sha256:881177e63b9229ab15667a45b4f2782025b76b4340aea00faf6e98e632d70661`, Markdown `bfca53758219b10c41b99da7a1b07f45f6c82946cf2c99f1f6f2d4f68c8fbc6c`; snapshot `becb78d0e83fee54d50001771447d2cd091a2912`, base `e15bc407da8753fd6b683c0aa4a68634e3c458a7`. Пути и полная проверяемая оболочка сохранены в JSON inputVerification.

- r16: JSON `sha256:7ed9c5525994fb484d2d0a27a489d66d5720a3f2a81de28cbefa499361bbfe2f`, Markdown `fe6f117918f28f998debddb0f305546554c0a56d38823b7fed9773010fa59b7e`; snapshot `5e5e1833a4ae2cecd335ab73ab20edc259f012ec`, base `e15bc407da8753fd6b683c0aa4a68634e3c458a7`. Пути и полная проверяемая оболочка сохранены в JSON inputVerification.

## Coverage и оценки каждой находки

### R15-001 — confirmed (bug)
Независимый повтор трёх инъекций дал exit 1/1/0. Drain-контроль: code=130, stdout ready → ready,error; stderr marker false → true. Дефект только oracle теста, не production settlement и не объяснение исторического timeout.

Источник: `tests/pi-worker.test.ts:362-382; src/process-client.ts:54-65`.

### R15-002 — confirmed (idea)
Fake DOM не ограничивает scroll, focus задаётся вручную. Настоящий browser harness существует для другого сценария; отсутствие native await проверки не является доказанным UI bug.

Источник: `tests/graph-view-observation.test.ts:31-93,120-131; tests/graph-transition-scope.test.ts:114-135`.

### R15-003 — unknown (unknown)
Watchdog SIGKILL существует, close сохраняет только code. Причина исторического null/timeout не установлена и в этом ревью.

Источник: `tests/run-controller.test.ts:445-452; PROJECT_INFO/known-issues.md:69-97`.

### R15-004 — confirmed (already-fixed)
Guard reader и точность frozen loader подтверждены кодом; четыре SDK read/bash round trip повторно прошли.

Источник: `src/catalog.ts:31-35; src/pi-worker.ts:112-115,165-173,206-209; tests/pi-worker.test.ts:385-415`.

### R15-005 — confirmed (already-fixed)
Visit/request guards и восстановление disclosure/selection/scroll имеются. Целевые VM editor regressions прошли; native layout не проверялся.

Источник: `src/graph-view/app.js:484-507,1162-1173,1450-1482,1515-1579`.

### R16-B01 — confirmed (bug)
Повтор в новой /tmp/c08 fixture: exit 0, sourceChanged=true, sourceId=r16_changed. Контроли: fresh exit 0/source unchanged; symlink exit 1/source unchanged. Directory realpath и symlink guard не исключают общий inode hardlink; writeFileSync изменяет source.

Источник: `skills/dynamic-workflows/recipes/implementation-review/instantiate.mjs:24-27,50-57`.

### R16-I01 — confirmed (idea)
В setup/doctor нет patch hash check, но postinstall уже fail-closed. Предложение read-only диагностики обосновано как идея, не как неисправная стандартная установка.

Источник: `scripts/setup.ts:30-34; src/doctor.ts:59-90; scripts/apply-sdk-bash-signal.mjs:23-71`.

### R16-U01 — unknown (unknown)
Независимо подсчитаны 361 package entries и 356 integrity. SDK probe использует отдельный npm install, не project lock. Fresh install не запускался; отсутствие integrity не доказывает компрометацию или ошибку npm.

Источник: `package-lock.json:1480-1550; scripts/sdk-clean-import.mjs:17-25`.

### R16-F01 — confirmed (already-fixed)
Installer проверяет версию/realpath, все input/staged hashes до installed writes. Null exit regression повторно прошёл. Сохранённые r16 test logs/probe совпали по SHA; power-loss atomicity не доказана.

Источник: `scripts/apply-sdk-bash-signal.mjs:23-71; tests/bash-signal.test.ts:14-87`.

### R16-F02 — confirmed (already-fixed)
Та же доказанная доставка, что R15-004. Это дубль между тематическими отчётами, не дополнительный независимый продуктовый дефект; live качество применения skill не установлено.

Источник: `src/catalog.ts:31-35; src/pi-worker.ts:112-115,165-173; tests/pi-worker.test.ts:385-415`.

## Реально выполненные проверки

### C08-E01
Команда: `python3: SHA256 четырёх producer files до чтения; git log -5; чтение обязательных документов и профильного кода`.

Результат: Обе оболочки succeeded/result complete; четыре SHA совпали. HEAD соответствует study-source.. Границы: Snapshot heads взяты из supplied metadata, не заменяют sourceRevision.

### C08-E02
Команда: `node /tmp/c08-probes-j4e5b93x/hardlink.mjs "$PWD/skills/dynamic-workflows/recipes/implementation-review" /tmp/c08-probes-j4e5b93x; отдельные fresh/symlink controls`.

Результат: Hardlink 0/changed; fresh 0/unchanged; symlink 1/unchanged. Границы: Только новые копии рецепта; fixture script взят из проверенного R16-B01 и прочитан до запуска.

### C08-E03
Команда: `В разрешённом dev: R15_FAULT=$mode NODE_OPTIONS=--require=/tmp/c08-probes-j4e5b93x/r15-pipe-order.cjs node --import tsx --test --test-name-pattern="$pat" tests/pi-worker.test.ts; modes stdout-late/stderr-immediate/stderr-late; затем оба r15-pipe-control.mjs`.

Результат: Runner exit 1,1,0; оба drain-controls exit 0/code130 и полный поздний pipe. Границы: Fixture извлечена из reproductionFixtures JSON после чтения. Synthetic marker и искусственное удержание reader; не естественная частота и не provider call.

### C08-E04
Команда: `node --import tsx --test --test-concurrency=1 --test-name-pattern='frozen skill from|inaccessible frozen skills|snapshot updates keep|wait.*disclosure|unknown null exit' tests/pi-worker.test.ts tests/graph-view-observation.test.ts tests/bash-signal.test.ts`.

Результат: 9 pass, 0 fail, 0 skip. Границы: Существующие зависимости dev; installer tests не запускались. Семь ключевых code/test файлов побайтно сравнены с worktree: равны. Не полный suite и не native browser/live provider.

### C08-E05
Команда: `Python lock count; SHA256 retained r16 results.tap/signal.tap/skill.tap/pack.json/probe.mjs`.

Результат: 361/356; все пять сохранённых SHA совпали. Границы: Исторические 121/106 не объявляются новыми test runs; весь исторический пакет повторно не исполнялся.

## Минимальные рекомендации, не реализация

- R15-001: Только test settlement helper: exit/error и drain обоих pipes, listeners до действия. Риск: Ожидание лишь close или лишь end может зависнуть. Приёмка: stdout-late проходит; оба stderr marker случая проваливаются; без marker проходит; exit без close завершается.
- R16-B01: Preflight всех output файлов: отказ при nlink > 1 до записи. Риск: Отказ легальным hardlinked output вне source. Приёмка: Hardlink отвергнут без изменения source; fresh/обычный output работают, symlink отказ сохранён.

## Already-fixed / refutations

- Skill delivery и await UI не переоткрываются.
- R15-001 не доказывает production cancellation bug или причину исторических timeout.
- R15-004 и R16-F02 — один already-fixed механизм.
- Post-study 86f5e07 authoring isolation и 3d8ba65 reviewer binding относятся к публикации отдельно; повторная реализация не предлагается.

## Unknowns и источники

- Fresh install/minimum Node/Linux, естественная частота flakes, native DOM await и live provider остаются непроверенными.
- Исторические результаты рассматриваются как provenance evidence, не как новые исполнения c08.

Прочитаны AGENTS, architecture, development, known-issues, models-and-setup и git log; точные профильные file:line приведены у каждой оценки. Fresh install, native browser и полный suite только предлагаются, не выполнены. Сырые логи остаются в новой /tmp/c08 fixture. Исходники и producer reports не менялись.

Approve означает достоверность классификации/evidence, не обязательность внедрения идей. Историческое имя astra-max сохранено; режим исторических исследований не переименован, модельных вызовов c08 нет.
