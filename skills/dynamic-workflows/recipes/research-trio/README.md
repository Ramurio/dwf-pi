# Три независимых исследователя и общий итог

Переносимые запросы создания небольшого графа: три изолированных `researcher` в `parallel`
с `failurePolicy` `collect`, затем отдельный `synthesizer` и корневой `finish`. Скопируй JSON
в рабочий каталог и редактируй **копии**, не записывай пользовательские параметры,
ответы CLI или журнал обратно в skill.

В рецепте нет веб-инструментов. Исследователи читают локальные файлы относительно `cwd`
подготовки через `read`/`grep`/`find`/`ls`; это не изоляция ОС, разрешения инструментов не
запрещают доступ к иным путям, доступным аккаунту.

## Копирование из установленного skill

Работай из любого каталога. SKILL — фактическое дерево инструкций приложения (ссылка
установщика или копия), не examples/src репозитория:

```sh
SKILL="${DYNAMICWF_SKILL:-$HOME/.agents/skills/dynamic-workflows}"
RECIPE="$SKILL/recipes/research-trio"
STORE="${STORE:-$PWD/research-trio.sqlite}"
cp "$RECIPE/create.json" "$RECIPE/patch.json" "$RECIPE/input.json" .
```

Stdout CLI — `{ "ok": true, "result": ... }` либо `{ "ok": false, "error": ... }`.
Проверяй ok после каждой команды; для `patch` ещё `result.validation.valid`,
для `validate` — `result.valid`.

## Что заполнить

| Параметр | Точное место | Примечание |
| --- | --- | --- |
| ID черновика | create.json `id` и тот же `id` дальнейших запросов | Поставляется research-trio |
| Модель/`thinking` исследователя 1 | patch.json, граф researcher-1, узел `investigate`, `config` | Поля `model.provider`, `model.id`, `thinking` |
| Модель/`thinking` исследователя 2 | patch.json, граф researcher-2, узел `investigate`, `config` | Те же поля, могут отличаться |
| Модель/`thinking` исследователя 3 | patch.json, граф researcher-3, узел `investigate`, `config` | Те же поля, могут отличаться |
| Модель/`thinking` обобщающего агента | patch.json, граф `main`, узел `aggregate`, `config` | Те же поля, могут отличаться |
| Вопрос, критерии, источники, задания r1/r2/r3 и обобщение | input.json | Ветка получает общие `question`/`criteria`/`sources` и только своё `assignment` |
| Рабочий каталог | `workflow.prepare` `cwd` | Каталог с выбранными локальными источниками |
| Журнал | --store каждой команды | Абсолютный путь при смене `cwd` |

`thinking` high в поставляемом изменении — синтаксический пример, не гарантия поддержки
моделью. После `catalog.models`/describe замени `provider`, ID модели и `thinking` **во всех
четырёх `config`** актуальными значениями. ID примера не доказывает доступность.
Незаполненная/недоступная модель или `thinking` даёт ошибку подготовки, не запасной выбор.
Не добавляй в рецепт повторы/исправление формата, лимиты параллелизма/итераций/времени
или обязательные этапы согласования.

## Каталог → граф → подготовка

```sh
dynamicwf catalog.models --store "$STORE" <<'JSON'
{}
JSON

dynamicwf catalog.describe --store "$STORE" <<'JSON'
{"name":"researcher"}
JSON

dynamicwf catalog.describe --store "$STORE" <<'JSON'
{"name":"synthesizer"}
JSON
```

Измени четыре `config` и input.json, затем:

```sh
dynamicwf workflow.create --store "$STORE" < create.json > create-response.json
node -e 'const e=JSON.parse(require("node:fs").readFileSync("create-response.json","utf8")); if(!e.ok) throw new Error(e.error.message); process.stdout.write("revision "+e.result.revision+"\n");'

node -e 'const fs=require("node:fs"); const created=JSON.parse(fs.readFileSync("create-response.json","utf8")); if(!created.ok) throw new Error(created.error.message); const patch=JSON.parse(fs.readFileSync("patch.json","utf8")); patch.expectedRevision=created.result.revision; fs.writeFileSync("patch.live.json", JSON.stringify(patch));'
dynamicwf workflow.patch --store "$STORE" < patch.live.json > patch-response.json
node -e 'const e=JSON.parse(require("node:fs").readFileSync("patch-response.json","utf8")); if(!e.ok) throw new Error(e.error.message); if(!e.result.validation.valid) throw new Error(JSON.stringify(e.result.validation)); process.stdout.write("revision "+e.result.workflow.revision+"\n");'
```

Новый черновик обычно `revision` 1. Не отправляй patch.json с устаревшим `expectedRevision`.
Бери актуальную `result.revision`/`result.workflow.revision` либо `workflow.inspect` и
переноси изменения; конфликт требует инспекции, не принудительной отправки старого запроса.

```sh
dynamicwf workflow.validate --store "$STORE" <<'JSON'
{"id":"research-trio"}
JSON
```

Проверь ok и `result.valid`. Подготовь рабочий каталог с источниками (здесь текущий `cwd`):

```sh
node -e 'const fs=require("node:fs"); process.stdout.write(JSON.stringify({id:"research-trio",cwd:process.cwd()}));' | dynamicwf workflow.prepare --store "$STORE" > prepare-response.json
node -e 'const e=JSON.parse(require("node:fs").readFileSync("prepare-response.json","utf8")); if(!e.ok) throw new Error(e.error.message); process.stdout.write(e.result.preparedId+"\n"+e.result.planHash+"\n");'
```

Изучи `result.plan` в prepare-response.json: четыре явно выбранные конфигурации `model`/`thinking`
(модели могут совпадать), `session` `fresh`, `permission` `read-only`, только `read`/`grep`/`find`/`ls`.
`workflow.prepared {"preparedId":"..."}` перечитает эту запись из того же журнала.

## Запуск подготовленного плана

Заранее выбери устойчивый `idempotencyKey` и сохрани запрос только с `preparedId`/`input`/ключом.
Не используй сокращение с ID черновика, не добавляй `cwd`/`model` поверх `preparedId`.

```sh
node -e 'const fs=require("node:fs"); const prep=JSON.parse(fs.readFileSync("prepare-response.json","utf8")); if(!prep.ok) throw new Error(prep.error.message); const request={preparedId:prep.result.preparedId,idempotencyKey:"research-trio-attempt-1",input:JSON.parse(fs.readFileSync("input.json","utf8"))}; fs.writeFileSync("start-request.json", JSON.stringify(request));'
dynamicwf run.start --store "$STORE" < start-request.json > start-response.json
node -e 'const fs=require("node:fs"); const start=JSON.parse(fs.readFileSync("start-response.json","utf8")); if(!start.ok) throw new Error(start.error.message); const id=start.result.id; const store=process.argv[1]; const q=s=>"\x27"+String(s).replace(/\x27/g,"\x27\\\x27\x27")+"\x27"; process.stdout.write(id+"\n"); process.stdout.write("dynamicwf watch --run "+q(id)+" --store "+q(store)+"\n");' "$STORE"
```

Выдай настоящий `result.id` и команду watch с корректным экранированием **сразу**, до
ожидания завершения. Потерянный ответ повторяй тем же start-request.json. Новое намеренное
выполнение требует нового ключа и нового файла запроса.

```sh
node -e 'const fs=require("node:fs"); process.stdout.write(JSON.stringify({id:JSON.parse(fs.readFileSync("start-response.json","utf8")).result.id}));' | dynamicwf run.status --store "$STORE"
node -e 'const fs=require("node:fs"); process.stdout.write(JSON.stringify({id:JSON.parse(fs.readFileSync("start-response.json","utf8")).result.id}));' | dynamicwf run.inspect --store "$STORE"
```

`succeeded` означает техническое завершение. Читай `taskOutcome.decision`/`reason`/`evidence`.
`accepted` требует трёх оболочек `collect` со статусом `succeeded`, трёх отчётов `researcher`
со значением `complete` и `accepted` от `synthesizer`, проходящего условие `finish`.
Неудачная ветвь, `inconclusive` отчёт или обобщение ведут к `finish` `inconclusive`.
Если сам `synthesizer` падает, запуск остаётся `failed`, а собранные оболочки сохраняются
в журнале. Не сохраняй пресет автоматически.

## Форма результата

`main.research` — `parallel`/`collect` с `children` r1/r2/r3 на researcher-1/2/3. Каждый ребёнок —
независимый `researcher` с новой сессией, только чтением и `end`. `main.aggregate` — отдельный
`synthesizer`. Условное ребро ведёт к `finish` `accepted`, запасное — к `finish` `inconclusive`.
Выход `researcher`: `decision` `complete`/`inconclusive`, `summary`, `findings`, `evidence`, `uncertainties`.
Выход `synthesizer`: `decision` `accepted`/`inconclusive`, `summary`, `reason`, `evidence`, `disagreements`,
`uncertainties`. `value` завершения повторяет `decision`/`accepted` **выбранного `finish`**,
сохраняет исходные именованные отчёты и объект `synthesis`. Вердикт `synthesizer` — данные,
не обход условия. Общие инварианты — [SKILL](../../SKILL.md).
