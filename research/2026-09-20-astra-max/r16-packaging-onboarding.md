# r16 — Установка, packaging и onboarding

## Metadata

- **ID:** r16
- **Тема:** Установка, packaging и onboarding
- **Source revision:** `e15bc407da8753fd6b683c0aa4a68634e3c458a7`
- **Дата:** 2026-09-20; контрольная метка исходного исследования — 11:09 UTC, продолжения — 13:08 UTC.
- **Рабочее дерево:** новый фактический cwd узла; HEAD повторно проверен и равен sourceRevision. Пакет записан только в назначенные `research/2026-09-20-astra-max/r16-packaging-onboarding.{md,json}`. Старый worktree и его fixtures только читались; пути и хеши происхождения ниже.
- **Среда исходных E00–E08:** Darwin arm64, Node 26.8.1, npm 11.19.0, Git 2.50.1. Тогда в worktree не было `node_modules`; тесты использовали существующие зависимости разрешённого integration-dev с тем же HEAD. Это историческая метка, не утверждение о HEAD dev после продолжения.
- **Метод:** исходные чтение кода, offline tests, файловые/Git/SDK fixtures и `npm pack --dry-run` перенесены из сохранённого исследования. В продолжении — независимое чтение кода, проверка хешей/ссылок, сводок старых логов и состояния собственных fixtures; **новых запусков тестов, npm, установщика, helper или моделей нет**. Веб не использовался. Отчёты других исследователей не читались.

## Continuation provenance — восстановление полного пакета

Источник: собственная операция `run-babf9b25-b8f5-45ad-b79c-2b2e5d31d2f0`; новая операция: `run-9dbb044c-664f-4dd8-96c0-57192dc4ed89`.
Старая операция имеет статус **failed** (по retainedEvidence: provider/HTTP 429, effects=unknown),
а не успешный выход. В её JSON уже было `metadata.status=complete`, но это лишь текст файла,
не свидетельство принятого `submit_result`. На момент продолжения **оба файла полны**:
есть metadata, coverage, пять findings, E00–E08, refutations, sources и unknowns.
Их байты и SHA256 совпали с входным retainedEvidence до переноса:

| Сохранённый файл | Байты | SHA256 |
| --- | ---: | --- |
| `r16-packaging-onboarding.md` | 35612 | `712acf6ba4e8ab767df405b521454974fdeeb39d6dc50c0f3a53ea8f171fde96` |
| `r16-packaging-onboarding.json` | 39150 | `694e4fb85f56d4195b531ba8e7e16022ec9e15ad38be06ffb2e3d00cf7caabab` |

- Старый cwd (только чтение): `/Users/ramu/.dynamicwf/runs/run-babf9b25-b8f5-45ad-b79c-2b2e5d31d2f0/worktrees/945bd8a5705082c2160ee88810e3b2b413c4321de606d2c2540db0a5697b02cb`.
- Новый cwd (единственное место записи отчётов): `/Users/ramu/.dynamicwf/runs/run-9dbb044c-664f-4dd8-96c0-57192dc4ed89/worktrees/945bd8a5705082c2160ee88810e3b2b413c4321de606d2c2540db0a5697b02cb`.
- Прочитан `continuation-v1/retained/r16-actions.json` из переданного retainedEvidence;
  SHA256 `935ce0af0f79cb5ab166e771d1bee31c62636219ec7db9eb8c932d3f8fbfbdc4`.
  Это **21 запись команд без stdout/exit status**, не самодостаточный лог успеха.
- **Перенесены:** все пять исходных findings с теми же ID, результаты E00–E08,
  границы clean install/live provider и отклонение E02 с размещением двух временных fixtures.
- **Перепроверены:** JSON/согласованность классификаций и суммы 106; все 57 уникальных
  диапазонов ссылок; 37 исходных файлов из списка S01–S09 побайтно совпадают со старым
  worktree и Git-объектами sourceRevision. Заново прочитаны ключевые code/contract/test места.
  Сохранённые логи действительно содержат 85/85, 11/11 и 10/10 без fail/skip;
  pack manifest — 258 файлов, 13 выбранных assets, mode 0755, без lockfile.
- **Усилено чтением старых fixtures, не повторным исполнением:** у hardlink-варианта E05
  source/output имеют один inode, `nlink=2`, source ID `r16_rebound`, а receipt хранит
  прежний source-хеш. Свежий output и symlink-вариант оставили source неизменным.
  Скрипт E04 совпал с записанной командой; оставшиеся SDK-копии имеют ожидаемые состояния.
  Чтение послесостояния не доказывает exit codes заново: результаты девяти E04 cases
  и минимального E06 остаются результатами исходной операции.
- **Добавлены:** явное происхождение, read-only проверки C00–C03 и отдельный контекст
  двух post-study исправлений. Новых findings/реализации нет. Полные tests не повторялись
  ради формального success; старые команды не исполнялись, старые fixtures не менялись.

Текущий `complete` относится к проверенному и заново оформленному пакету двух файлов,
не меняет failed-статус исходной операции и не является live-проверкой провайдера.

## Итог

Сохранён вывод исходного исследования: **один воспроизведённый bug узкого сценария**: `instantiate.mjs` может изменить исходный рецепт через заранее созданные hardlinks в отдельном выходном каталоге. Обычный новый каталог и символьные ссылки проверены как контрпримеры: первый работает безопасно, вторые отвергаются.

Основной путь установки из checkout, переносимость skill, CLI/MCP handoff и исправление SDK хорошо поддержаны текущим кодом и проверками: **106/106 выбранных тестов прошли в исходной операции** (сводки логов перечитаны), дополнительно там прошли девять проверок установщика на копиях SDK. В продолжении исполняемые проверки не повторялись. Это **не** доказательство чистого `npm ci`, минимальной Node 22.19.0, Linux или live provider. Есть одна идея улучшения диагностики и одна область `unknown` вокруг полноты воспроизводимого clean install. Итого пять записей findings: 1 bug, 1 idea, 1 unknown, 2 already-fixed.

## Coverage и действительный контракт установки

| Область | Проверено | Граница вывода |
| --- | --- | --- |
| Источник установки | README:10–24, `package.json:2–9`, setup и pack manifest | Продукт установлен как сохраняемый checkout с `node_modules`, а не отдельный собранный binary. `private:true`, версия 0.0.0; публичная npm-публикация не обещана. |
| Зависимости | Совпадение dependencies/devDependencies package и lock; 361 package entry; engines всех записей с заявленным Node допускают 22.19.0 | Проверка engines — метаданные, не исполнение на минимальной версии. У пяти вложенных записей нет integrity: R16-U01. |
| Production imports | `tsx` и TypeScript — обычные зависимости (`package.json:26–40`); bin регистрирует tsx; generated-module импортирует TypeScript (`src/generated-module.ts:5,15–30`) | Предположение «для production можно убрать TypeScript» опровергнуто. Реальный `npm ci --omit=dev` не выполнялся. |
| Setup | Проверки выбранных bin/skill каталогов, пробелов в путях, повторной установки, конфликтов и `--replace` | Реальные пользовательские ссылки и настройки не менялись. Сохранение двух ссылок не является транзакцией при произвольной I/O-ошибке; такую гарантию не заявляю. |
| CLI/MCP | Запуск из другого cwd, единичные JSON-ответы, большой UTF-8 stdin до EOF, stdio MCP без transport-wrapper, отключение клиента, идемпотентный start | Использовались временные БД и offline графы. Это не проверка пользовательского MCP-приложения или модели. |
| Skill distribution | Ссылки, физическая копия, локальные Markdown-ссылки, JSON-рецепты, snapshot после удаления оригинала, реальное SDK-чтение через read/bash | Обнаружение skill конкретным внешним приложением не проверено. Установочная ссылка и `config.skills` имеют разные документированные требования. |
| Примеры | research-trio: authoring/prepare, четыре явных модели, отрицательные исходы и 54 комбинации finish; S/P/C: авторинг, embedded helpers, revision-bound routing, Git fixtures | Ответы моделей подставные. Семантика приёмки проверена, качество реальной реализации/ревью не измерялось. |
| SDK patch | Четыре SHA256 установленного SDK соответствуют разрешённому patched-состоянию; реальные bash-сигналы; восстановление pristine на копии; отказы на mixed/unknown/version/symlink/fake git | Pristine получен обратным применением сохранённого patch, а не загрузкой нового registry tarball. Аварийное завершение посреди четырёх записей не тестировалось. |
| Packaging | `npm pack --dry-run --ignore-scripts --json`: 258 файлов, 2 734 061 байт распакованного содержимого; все 13 выбранных runtime/patch/skill assets присутствуют, bin mode 0755 | Tarball не создавался, установка из него не выполнялась. В manifest нет package-lock.json: pack не следует приравнивать к документированному checkout + npm ci. |

## Findings

### R16-B01 — bug: hardlink в output обходит защиту исходного рецепта

**Приоритет:** низкий; подтверждённое изменение данных, но нужен нетипичный заранее подготовленный output. **Уверенность:** высокая для указанного сценария.

**Код этой ревизии:**

- `skills/dynamic-workflows/recipes/implementation-review/instantiate.mjs:24–27` проверяет, что canonical output находится вне source.
- Там же `:50–54` прямо задаётся цель «Existing output file aliases must not redirect writes back into the recipe», но проверяется только `isSymbolicLink()`.
- Там же `:56–57` `writeFileSync` перезаписывает существующие файлы на месте; hardlink сохраняет тот же inode.
- `skills/dynamic-workflows/recipes/implementation-review/README.md:37–48` представляет команду как создание привязанного рецепта в отдельном каталоге.

**Триггер:** source и output — разные реальные каталоги на одной файловой системе; хотя бы один из `create.json`, `patch.json`, `input.json`, `validate.json` в output является жёсткой ссылкой на соответствующий файл source. Например, пользователь подготовил копию посредством hardlink-based copying. Требуются права записи в эти файлы.

**Ожидание:** helper либо отвергает такой alias до любых записей, либо создаёт независимые выходные файлы. Исходный поставляемый рецепт остаётся прежним.

**Наблюдение исходных E05/E06:** helper завершается с кодом 0; SHA256 `source/patch.json` меняется, его ID становится `r16_changed`. Обновление других hardlinked JSON тоже проходит через исходные inode. Поэтому отдельное имя каталога не означает отдельный артефакт; последующие пользователи того же source получают уже привязанный к чужой задаче рецепт. `sourceRecipePatchSha256` фиксирует старые байты source, которые команда сама затем меняет.

**Воспроизведение без зависимостей и моделей**, из корня этой ревизии; изменяется только копия в `/tmp` (выполнено в исходной операции, E06; в продолжении не повторялось):

```sh
RECIPE="$PWD/skills/dynamic-workflows/recipes/implementation-review"
T=$(mktemp -d /tmp/r16-repro.XXXXXX)
node --input-type=module - "$RECIPE" "$T" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const [recipe, tmp] = process.argv.slice(2);
const source = path.join(tmp, 'source'), out = path.join(tmp, 'output');
fs.cpSync(path.join(recipe, 'S'), source, { recursive: true });
fs.mkdirSync(out);
for (const name of ['create', 'patch', 'input', 'validate'])
  fs.linkSync(path.join(source, name + '.json'), path.join(out, name + '.json'));
const parameters = JSON.parse(fs.readFileSync(path.join(recipe, 'parameters.example.json')));
parameters.id = 'r16_changed';
const params = path.join(tmp, 'parameters.json');
fs.writeFileSync(params, JSON.stringify(parameters));
const hash = () => createHash('sha256').update(fs.readFileSync(path.join(source, 'patch.json'))).digest('hex');
const before = hash();
const child = spawnSync(process.execPath, [path.join(recipe, 'instantiate.mjs'),
  '--recipe', source, '--parameters', params, '--out', out], { encoding: 'utf8' });
const observed = { exit: child.status, sourceChanged: hash() !== before,
  sourceId: JSON.parse(fs.readFileSync(path.join(source, 'patch.json'))).id };
console.log(JSON.stringify(observed));
assert.deepEqual(observed, { exit: 0, sourceChanged: true, sourceId: 'r16_changed' });
JS
rm -rf "$T"
```

**Контрдоказательства и пределы:** E05 сравнил три варианта одной fixture: новый output → exit 0/source неизменён; symlink-файлы → exit 1/source неизменён; hardlinks → exit 0/source изменён, `nlink=2`. `tests/implementation-recipes.test.ts:164–187` уже защищает canonical directory symlinks и нормальную независимую привязку. Не утверждаю повреждение при обычном `cp`, свежем output, reflink с независимыми inode или по факту любого запуска рецепта. Конкурентная подмена файлов здесь не нужна и не исследовалась.

**Минимальное изменение, не внедрено:** в существующем preflight всех пяти output-имён отвергать обычные файлы с `nlink > 1` до первой записи. Если сохранение поддержки hardlinked output принципиально нужно, отдельно рассмотреть запись новых inode через временные файлы и rename; это более широкое изменение.

**Риск изменения:** отказ ранее допускавшимся hardlinked output, даже если второй link не ведёт в source. **Приёмка:** hardlink-fixture получает явную ошибку до записи любого output, все исходные JSON побайтно неизменны; свежий/обычный output, symlink-отказы и существующие S/P/C tests продолжают проходить. Это защита helper, не изменение runtime или оркестрации.

### R16-I01 — idea: сделать состояние SDK patch видимым в диагностике

**Факты:** `scripts/setup.ts:30–34` проверяет executable, SKILL.md и только наличие manifest tsx. `src/doctor.ts:59–90` проверяет Node/POSIX/cwd/store/Git/models, но не SHA256 SDK patch. Bin (`bin/dynamicwf.mjs:13–18`) тоже не делает такой проверки. Следовательно, успех setup/doctor сам по себе не является подтверждением patch-состояния.

**Почему это не bug:** обычный путь `npm ci` содержит postinstall (`package.json:24`, `package-lock.json:10`); обход scripts и ручное применение явно документированы (`PROJECT_INFO/development.md:44–58`). На исследованной установке все четыре patched-хеша корректны, signal-тесты проходят. Непропатченный live runtime не запускался; нет доказательства дефекта стандартной установки.

**Минимальная рекомендация:** отдельная read-only проверка `sdk-bash-signal` в doctor, использующая те же version/hash constants, с состояниями patched/pristine/mixed/unknown. Печатать способ ручного исправления, не применять patch автоматически и не объявлять чистые графы недоступными только из-за bash SDK.

**Риск:** дублирование хешей может рассинхронизироваться; лучше общий side-effect-free checker. Диагностика не должна читать credentials или менять `node_modules`. **Приёмка:** fixtures всех состояний возвращают правдивую отдельную проверку, неизменные файлы и отсутствие сетевых запросов; postinstall сохраняет текущие fail-closed гарантии. Это предложение, не выполненная модификация.

### R16-U01 — unknown: полнота clean install за пределами существующего node_modules

**Наблюдаемые факты:**

1. Root manifests согласованы, прямые версии точные, у всех 361 package entry есть конкретная version и registry URL. Объявленные Node engines не противоречат минимуму 22.19.0.
2. В `package-lock.json:1480–1550` отсутствуют поля integrity у пяти вложенных `@earendil-works` пакетов SDK: `chord`, `pi-agent-core`, `pi-ai`, `pi-telemetry`, `pi-tui` — все 0.85.1. Эти записи также не отмечены `inBundle` или `link`. Прочитанный установленный manifest coding-agent не объявляет bundledDependencies. Отсутствие integrity — установленный факт; его происхождение и фактический путь установки не установлены.
3. `scripts/sdk-clean-import.mjs:17–25` создаёт новый manifest с тремя SDK dependencies и вызывает `npm install --omit=dev`, без project lockfile и без Dynamicwf postinstall. Это осмысленный probe импорта SDK, но не проверка всей зафиксированной установки Dynamicwf. Документация `PROJECT_INFO/development.md:74–76` тоже называет его проверкой SDK, а не полной установки.

**Неизвестно:** проходят ли fresh `npm ci`/`npm ci --omit=dev` на Node 22.19.0 и Linux с пустым cache, откуда возникли пять неполных integrity-записей, что именно npm проверит для них в новом окружении. Я не делаю из отсутствия поля вывод о компрометации, фактической подмене или уже сломанном npm ci. Успешные tests на Node 26.8.1 с готовыми зависимостями этого вопроса не решают.

**Следующий минимальный шаг, не выполнялся:** отдельная воспроизводимая проверка checkout этой ревизии + её lockfile на минимальной Node, в чистом изолированном окружении, с обычным postinstall; затем source-based production install без dev-зависимостей и offline CLI/check smoke. Происхождение отсутствующих integrity проверить по достоверным пакетным метаданным, не выдумывать хеши и не обновлять версии ради заполнения полей.

**Риск:** широкая регенерация lock может незаметно изменить транзитивные версии; install scripts требуют отдельного контроля среды. **Приёмка:** неизменные выбранные версии, обоснованная полнота integrity либо документированное исключение, четыре ожидаемых patch-хеша, работающий bin из чужого cwd и исполнение чистого графа без devDependencies. Дополнительно проверять Node 22.19.0 на поддерживаемых ОС; это предложенные проверки, не результат этого исследования.

## Already-fixed и опровергнутые гипотезы на study-source

### R16-F01 — already-fixed: сигнал bash не считается успехом, patch применяется fail-closed

Текущий patch добавляет отдельный signal result, отвергает неизвестный null exit и сохраняет текст до сигнала (`patches/pi-coding-agent-0.85.1-bash-signal.patch`). Установщик проверяет точную версию и все четыре входных хеша, использует независимый staging без наследования Git routing, проверяет все выходные хеши до записи (`scripts/apply-sdk-bash-signal.mjs:23–71`). Это уже реализовано; переоткрывать исходную потерю сигнала как bug данной ревизии нельзя.

E02: 11/11 tests, включая реальный SIGTERM, ordinary exit, timeout/cancel, drain output, worker tool error и installer guards. E04: девять дополнительных fixture-cases — pristine при ложных inherited Git paths, повторный запуск, mixed, unknown contents, неверная версия, внешний manifest, внешний SDK file, внешний SDK root, git, который ложно возвращает успех без применения. Все отказы сохранили байты установленной **fixture**; чтение реального dev SDK до/после подтвердило неизменность четырёх файлов.

Граница: это не транзакция четырёх файлов при падении ОС посреди записи; такой fault-injection не выполнялся. Нельзя удалять patch по одному лишь наличию более новой SDK. Рекомендация — сохранить текущие guards и содержательные регрессии; риск ослабления — возвращение ложного успеха bash. Приёмка при будущем обновлении — та же проверка на чистом upstream плюс осознанное удаление patch-цепочки, а не обход SHA256.

### R16-F02 — already-fixed: выбранный skill доставляется и читается SDK

`src/catalog.ts:31–35` требует read или bash для непустых skills; `src/pi-worker.ts:112–115` отказывает до допуска ресурсов/SDK; `:165–173` загружает ровно frozen skill paths, `:206–209` передаёт доступные инструменты в session. E01 включает весь `skill-delivery`; E03 дополнительно выполнил десять тестов snapshot/ресурсов: SDK реально прочитал зафиксированный SKILL.md через read и bash после удаления исходника, с declared name и directory fallback. Это не только проверка существования файла на диске.

Не смешивать две задачи: установщик делает ссылку для внешнего приложения, а `config.skills` намеренно не принимает symlink в корне. Требование физической копии явно есть в `PROJECT_INFO/models-and-setup.md:26–30` и проверяется `tests/execution-plan.test.ts:179–196`. Это не новый дефект distribution. Техническая доставка не доказывает следование инструкциям реальной моделью. Рекомендация — сохранить проверки и это различие в документации; приёмка — сохранение обоих разрешённых читателей без скрытого добавления инструментов.

### Другие refutations

- **«Bin зависит от текущего каталога или оставляет дополнительный транспортный процесс».** Опровергнуто кодом `bin/dynamicwf.mjs:8–18` и `tests/setup.test.ts:109–133,171–211`: tsconfig/entry разрешаются от установленного файла, cwd не меняется, MCP исполняется в том же Node и завершается при отключении своего клиента.
- **«CLI не дочитывает большой JSON/теряет UTF-8».** `src/cli.ts:18–22` читает stream до EOF; `tests/cli.test.ts:40–73` прошёл с задержкой и разбиением многобайтового ввода. Это не обещание бесконечного размера stdin.
- **«Копия skill требует PROJECT_INFO или src».** Копирование всего дерева, локальные ссылки и recipe JSON проверены `tests/setup.test.ts:213–240`. Вспомогательные S/P/C команды встроены в JSON и побайтно сверяются с поддерживаемыми файлами (`tests/implementation-recipes.test.ts:47–61`).
- **«Старт по skill требует дождаться завершения/создаёт дубликат после повторной доставки».** Offline CLI/MCP handoff прошёл: create/patch/validate/prepare/start/status и повторный start дали один ID; cleanup касался только fixture (`tests/skill-handoff.test.ts:12–98`). Это не разрешает повторять неидемпотентные внешние эффекты.
- Уже исправленные dashboard ownership/control/await/disclosure прочитаны в актуальных документах и git log, но не включались в это профильное исследование и не переоткрываются. Успешный последовательный handoff не закрывает описанный в known-issues вопрос нестабильности полного набора.

## Experiments E00–E08: выполнены в исходной операции, не заново

Для исторических E01–E03: cwd — разрешённый integration-dev, на тот момент той же ревизии; чистое окружение `env -i PATH="$PATH" HOME="$T/home" TMPDIR="$T/tmp"`, где T создан через `mktemp -d /tmp/r16-….XXXXXX`. HOME тестовый, каталог моделей подставной, реальные provider/model команды не запускались. Полный npm test и npm install/ci не выполнялись.

| ID | Выполненная команда/проверка | Исход | Граница |
| --- | --- | --- | --- |
| E00 | `git rev-parse HEAD`, `git log -18`; профильный `git log -- package.json package-lock.json scripts bin README.md skills`; Node-скрипты чтения package/lock и сравнения engines через уже установленный SDK-local semver | Нужный HEAD; root dependency maps равны; 361 version/URL, 356 integrity, 0 несовместимых заявленных engines | Первая попытка resolve semver от корня dev дала MODULE_NOT_FOUND; исправленный анализ разрешал его от SDK. Это ошибка вспомогательной проверки, не дефект приложения. |
| E01 | `node --import tsx --test --test-concurrency=1 tests/setup.test.ts tests/cli.test.ts tests/skill-handoff.test.ts tests/doctor.test.ts tests/skill-delivery.test.ts tests/implementation-recipes.test.ts tests/research-trio.test.ts` | 85 pass, 0 fail/skip; 84.786 с | Один последовательный профильный запуск, реальные локальные процессы/БД/Git, подставные модели. |
| E02 | `node --import tsx --test --test-concurrency=1 --test-name-pattern='^(?!installer reproducibility)' tests/bash-signal.test.ts tests/bash-signal-worker.test.ts` | Фактически 11 pass, 0 fail/skip; 3.659 с, включая оба installer test | Фильтр не исключил installer tests в этом запуске; см. операционное отклонение ниже. Не выдаю это за девять выбранных signal-only tests. |
| E03 | `node --import tsx --test --test-concurrency=1 --test-name-pattern='(frozen resources|inaccessible frozen skills|frozen skill from|skills snapshot|physical copy of the shipped skill|skills reject symlink)' tests/pi-worker.test.ts tests/execution-plan.test.ts` | 10 pass, 0 fail/skip; 3.524 с | Только перечисленные проверки, не весь pi-worker или execution-plan. |
| E04 | `node /tmp/r16-sdk-guard.VUyo5U/probe.mjs "$CWD" "$DEV" /tmp/r16-sdk-guard.VUyo5U` | 9 ожидаемых исходов, byte-equality guards и неизменность dev SDK подтверждены | Собственный временный probe: копирует четыре SDK файла; git apply -R восстанавливает pristine; вызывает реальный установщик только над копиями. Это не fresh install. |
| E05 | `node --input-type=module - "$PWD" "$T"` с fixture в `/tmp/r16-hardlink-fixture.*` | Новая директория безопасна; symlink отвергнут; hardlink изменил source | Исполнен реальный instantiate helper этой ревизии, только над копией S. |
| E06 | Полная команда в R16-B01 | exit 0, sourceChanged=true, sourceId=r16_changed | Повторное минимальное воспроизведение без dependencies; временная копия удалена. |
| E07 | `env -i PATH="$PATH" HOME="$T/home" npm_config_cache="$T/cache" npm pack --dry-run --ignore-scripts --json` в worktree | 258 entries; все 13 выбранных обязательных assets найдены, executable mode 0755; node_modules не включён | До записи исследовательских отчётов. Не tarball-install, не сетевой npm probe; cache только в `/tmp/r16-pack-manifest.*`. |
| E08 | `git diff --check`, status рабочего дерева; `git -C "$DEV" diff --exit-code -- scripts bin src tests package.json package-lock.json PROJECT_INFO README.md skills`; поиск `.o07-*` на верхнем уровне dev | До записи отчётов worktree чист; отслеживаемые профильные файлы dev не изменены; остатков `.o07-*` нет | Не сравнение всего пользовательского состояния и не управление установленным runtime. |

**Операционное отклонение E02:** отрицательный name-pattern не предотвратил выполнение двух штатных installer fixtures. Они временно создали `.o07-install-*` в cwd dev (`tests/bash-signal.test.ts:48–50`), хотя для этого исследования временные воспроизводители следовало держать под `/tmp/r16-*`. Их `finally` удалил каталоги; последующая проверка не обнаружила остатков, отслеживаемые файлы dev не менялись. Это не скрыто и не считается соблюдением требуемого размещения временных файлов. Дополнительные проверки установщика после этого выполнялись только собственным E04 под `/tmp/r16-*`. Глобальный SDK, реальные ссылки установки, настройки и пользовательские run не изменялись.

Сырые TAP/npm логи в отчёт и Git не включены. Они не используются как замена перечисленным результатам и исходникам тестов.

## Post-study already-fixed — отдельно от findings на e15bc407

Целевая ревизия публикации из входа — `3d8ba65ee84402c0e3b0587f70095b7847824a9f`. Прочитаны её Git-объекты,
не выполнен checkout и не запускались её tests. Это не подмена sourceRevision.

- `86f5e0756e67fa7a18e925d77b7d2728db2f0627`: ранняя проверка изоляции параллельных
  писателей уже добавлена в `validateWorkflow` и общий `src/parallel-isolation.ts`;
  документированы worktree внутри ветви и пример parallel-reports. Источники:
  `git show 86f5e07 -- src/graph.ts src/parallel-isolation.ts PROJECT_INFO/graph-contract.md PROJECT_INFO/known-issues.md`.
  Это **post-study already-fixed**, не новое предложение внедрения и не повторно выполненная регрессия.
- `3d8ba65ee84402c0e3b0587f70095b7847824a9f`: документация reviewer binding уже дополнена;
  на этой ревизии `skills/dynamic-workflows/SKILL.md`, строки 110–114, и
  `skills/dynamic-workflows/references/authoring.md`, строки 128–156, явно требуют
  верхнеуровневую входную artifactRevision и отличают её от нового отчёта критика.
  Это **post-study already-fixed документации**, не новая функция из данного исследования.

`git diff --exit-code` между source/publication для package/lock/scripts/bin,
`src/doctor.ts`, `src/catalog.ts`, `src/pi-worker.ts`, implementation-review helper
и его README пуст. Поэтому R16-B01/I01/U01 не объявлены исправленными этими двумя
коммитами; при этом исходные 258 pack entries и результаты E01–E03 относятся только
к e15bc407, не ко всему расширенному skill на publicationRevision. Эти две пометки
не добавляют findings: в основном исследовании по-прежнему пять записей.

## Experiments C00–C03: проверки продолжения (только чтение)

| ID | Реально выполненная команда/анализ | Результат | Граница |
| --- | --- | --- | --- |
| C00 | `pwd; git rev-parse HEAD; git status --short; shasum -a 256` двух старых файлов; чтение обоих файлов и `r16-actions.json` | Новый cwd, HEAD=e15bc407; оба старых SHA256 совпали; полные разделы и 21 запись команд | Метаданные complete старого файла не означают успешный исход старой операции |
| C01 | Python3: JSON parse/counts; regex диапазонов file:line; побайтное сравнение 37 исходников со старым cwd и `git show e15bc407:<path>`; `nl -ba` ключевых источников | 5 устойчивых ID, сумма 106, 57 валидных диапазонов, 37 совпавших файлов; механизмы находок подтверждены чтением | Проверка диапазона сама по себе не доказывает смысл; ключевые причины/контрпримеры прочитаны отдельно |
| C02 | Python3: чтение только сводок трёх сохранённых test logs, pack JSON, `stat`/хешей E05 и SDK-копий E04; сравнение `probe.mjs` с телом команды retainedActions | Свидетельства 106 pass; pack metadata совпала; source hardlink изменён, контрпримеры сохранны; guard script/состояния совпали | Ни одной старой команды не запускали; состояние файла — не повторное измерение exit code; исходный dev SDK заново не исполнялся |
| C03 | `git log e15bc407..3d8ba65; git show 86f5e07; git show 3d8ba65; git diff --exit-code e15bc407 3d8ba65 -- <указанный выше профильный scope>`; Python3 чтение package/lock | Два post-study коммита отделены; профильный diff пуст; root maps совпадают, 361 version/URL, 356 integrity | Engines compatibility из E00 перенесена, semver заново не запускался; никаких clean install или post-study tests |

Сохранённые локальные evidence-файлы только читались, не копировались в Git.
Их контрольные суммы для цепочки происхождения:

| Файл | SHA256 |
| --- | --- |
| `/tmp/r16-offline-tests.AqcHhf/results.tap` | `afd2e7e317d0bab99c175c02ad78220c468fe406868b6e97f47ea2dce72b3e77` |
| `/tmp/r16-sdk-tests.KN0IFE/signal.tap` | `389309cbad86aa9d1de58887e4102d18ad2c56f40458d84560e394372b1bd84e` |
| `/tmp/r16-sdk-tests.KN0IFE/skill.tap` | `fcbd0dbbbd2766478617052196dcaf2e8e777942534c592a780652ebfbd98634` |
| `/tmp/r16-pack-manifest.HDz7oH/pack.json` | `a57e61bdff66d30f1342b0a8dba77d47b2cb624e0f53f103e3239b8615e5e614` |
| `/tmp/r16-sdk-guard.VUyo5U/probe.mjs` | `169beabdd8efdd6cc61d060e01067a25d2b8ed72dda7449b8d8d0bc7a8b5dc60` |

E05 послесостояние: `/tmp/r16-hardlink-fixture.stjd5b`; исходный S/patch SHA256
`420dfa269e3bdc9ae72104d912d246005d54bb1d44cf098609e09161d54ed9b5`,
source после hardlink-варианта — `c2a47e0e9c899cc27c90fdcbae1ea4df614d3d3be6537f6928dc938081d40d27`.
`r16_rebound` — ID сравнительного E05, `r16_changed` выше — отдельного E06; это разные fixtures,
не противоречащие результаты одного запуска.

## Unknowns и только предложенные проверки

- R16-U01: свежая установка, минимальная Node, production-only dependency tree и Linux не проверены. Указанные команды install — дальнейшая программа проверки, а не выполненные действия.
- Фактическое обнаружение переносимого skill конкретным внешним агентным приложением не проверено; документация корректно не обещает универсальной autodiscovery.
- Качество применения skill/рецептов и права реальных аккаунтов не измерялись. Успешный SDK mock не превращён в утверждение о live provider.
- Нет fault-injection падения ОС/ENOSPC в середине записи patch или установки двух ссылок; нет утверждения о полной файловой транзакционности.
- Причина известных intermittent failures полного npm test не исследовалась. Зелёный профильный запуск её не опровергает.

## Инспектированные источники

Все file:line в findings и источниках 1–10 относятся к указанной sourceRevision. Чтение существующих SDK manifests/четырёх patch-файлов в dev — историческое E00/E04. Post-study ссылки выше явно помечены своей ревизией, а evidence продолжения — собственные сохранённые файлы, не источники других исследователей.

1. `AGENTS.md`; `PROJECT_INFO/architecture.md`; `PROJECT_INFO/development.md:8–76`; `PROJECT_INFO/known-issues.md` — инварианты и границы доказательств.
2. `README.md:8–51`; `PROJECT_INFO/README.md`; `PROJECT_INFO/models-and-setup.md:7–54,100–145`; `PROJECT_INFO/service.md` — контракт установки, cwd, CLI/MCP и диагностики.
3. `package.json:1–46`; `package-lock.json:1–32,1480–1550`; `tsconfig.json`; `.gitignore`; mode bin из `git ls-files -s` — packaging/dependency metadata.
4. `scripts/setup.ts:12–56`; `bin/dynamicwf.mjs:1–24`; `src/cli.ts:7–33`; `src/doctor.ts:59–90`; `src/generated-module.ts:1–39` — исполнение из исходников и диагностика.
5. `scripts/apply-sdk-bash-signal.mjs:1–77`; `patches/pi-coding-agent-0.85.1-bash-signal.patch`; `scripts/sdk-clean-import.mjs:1–58` — patch chain и отдельный clean SDK probe.
6. `skills/dynamic-workflows/SKILL.md`; `skills/dynamic-workflows/recipes/research-trio/README.md`; `skills/dynamic-workflows/recipes/implementation-review/README.md`; `skills/dynamic-workflows/recipes/implementation-review/instantiate.mjs:13–58` — переносимость и воспроизведённый helper defect.
7. `tests/setup.test.ts:109–240`; `tests/cli.test.ts:9–73`; `tests/skill-handoff.test.ts:12–98`; `tests/doctor.test.ts` — выполненные onboarding regressions.
8. `tests/bash-signal.test.ts:14–87`; `tests/bash-signal-worker.test.ts:44–63`; `tests/skill-delivery.test.ts`; `tests/pi-worker.test.ts:265–300,385–415`; `tests/execution-plan.test.ts:126–196`; `src/catalog.ts:31–35`; `src/pi-worker.ts:112–115,165–173,206–209` — исполненные/инспектированные guards и исправленная доставка skill.
9. `tests/implementation-recipes.test.ts:47–187`; `tests/research-trio.test.ts:165–447` — проверка поставляемых рецептов без моделей.
10. `git log` текущей базы; профильные изменения `d06da9fb9c74448099a436059c76a94e251831a1` (patch installer), `2d9f9d2` (skill reader requirement), `fea2136`/`e15bc40` (актуальная граница UI disclosure). История использована для ориентации, не вместо кода текущего HEAD.

11. Собственные старые md/json, retained `r16-actions.json` и локальные evidence-файлы с хешами выше — происхождение результатов; не новые вызовы приложения.
12. `git show 86f5e07`, `git show 3d8ba65`, scoped diff source/publication — отдельно прочитанные post-study исправления.
