# Graph contract v1

Статический граф задаёт порядок работы, циклы и вложенные графы. Runtime выбирает
переходы и создаёт динамические экземпляры map, не меняя саму схему. Ни один узел
не содержит JavaScript, TypeScript или `eval`. Реализация контракта:
[`src/graph.ts`](../src/graph.ts); роли: [`src/catalog.ts`](../src/catalog.ts).

## Внешняя форма

```ts
WorkflowDefinition = {
  schemaVersion: 1;
  id: string;
  name: string;
  revision: number; // положительное целое
  entryGraph: string;
  graphs: Record<string, Graph>;
}
Graph = { entry: string; nodes: Node[]; edges: Edge[] }
Edge = { from: string; to: string; when?: Expr }
```

Workflow, graph, node и parallel-child IDs имеют форму
`^[A-Za-z][A-Za-z0-9_-]*$`. Node IDs локальны графу, child IDs — узлу parallel.
Повторно использовать один дочерний graph в нескольких местах допустимо.
`revision` меняется при сохранении изменённой схемы; runtime закрепляет конкретный
snapshot до запуска. `parseWorkflow` валидирует, клонирует и рекурсивно замораживает
результат, поэтому дальнейшие правки исходного draft не меняют принятую схему.
Прямой `validateWorkflow` возвращает `{valid, issues}` и не меняет объект.

Узлы имеют обязательные `id`, `kind` и следующие поля:

| kind | Поля | Значение результата |
| --- | --- | --- |
| agent | `role`, `task: Expr`, `input?: Expr`, `config?: AgentConfig` | Результат pi worker, при outputSchema — проверенный JSON |
| transform | `value: Expr` | Вычисленное значение |
| branch | `input?: Expr` | Вычисленный input, либо текущий input графа |
| map | `graphId`, `items: Expr`, `concurrency?: positive integer` | Массив результатов дочернего графа в порядке исходных items |
| parallel | `children: {id, graphId, input: Expr}[]`, `concurrency?: positive integer` | Объект с результатами по child ID |
| subworkflow | `graphId`, `input: Expr` | Результат дочернего графа |
| worktree | `graphId`, `input: Expr`, `base?: string` | `{result,workspace:{path,branch,base,head}}`; дочерний граф в отдельной Git-ветке |
| integrate | `sources: Expr` | Явное слияние завершённых worktree-результатов этого run; фактический head и merged commits |
| check | `command: string`, `args: string[]`, `cwd?: string` | Результат процесса; точную выходную форму закрепляет runtime |
| end | `value: Expr` | Результат текущего графа |

`map.items` во время исполнения должен дать JSON-массив. Каждый элемент становится
`input` отдельного child instance. `subworkflow.input` и `parallel.children[].input`
тоже передают JSON напрямую. Parent nodes не видны внутри child: нужный контекст
передаётся явным input. Отсутствующий concurrency означает отсутствие заданного
пользователем ограничения, а не скрытый фиксированный cap.

`check.command` — имя executable или путь, `args` — argv. Runtime не соединяет их
в shell string. Например `{command:"node",args:["--version"]}`. Явный запуск
`bash` с `-c` остаётся запуском shell, который пользователь указал сам: ограничения
доступа такого процесса обязан применять executor. NUL в argv/cwd запрещён.

## Переходы и завершение

После узла runtime проверяет его условные edges **в порядке массива**. Выбирается
первое условие со значением true. Если ни одно не подошло, используется единственный
безусловный fallback независимо от его позиции в массиве. Если подходящего edge
нет, runtime должен сообщить routing error; это не неявный успех. Условия должны
давать boolean, без JavaScript truthiness.

Один исходящий edge — обычная последовательность. Несколько условных — выбор пути.
Fan-out задаётся узлами map/parallel, а не несколькими безусловными edges. Возврат
к ранее посещённому узлу — цикл, разрешён без maxIterations по умолчанию. End не
имеет исходящих edges. Рекурсивные ссылки на child graph запрещены, включая
взаимную рекурсию через map/parallel/subworkflow.

Валидатор проверяет существование входов/ссылок, уникальность IDs, достижимость
всех узлов из entry, наличие структурного пути от каждого узла до end и
достижимость каждого graph из entryGraph. Он **не вычисляет условия**: статический
путь к end не доказывает, что конкретный запуск завершится. Цикл review→repair
может продолжаться до approve; остановка/pause относится к runtime.

## Expression AST

```ts
{ op: 'literal', value: Json }
{ op: 'ref', path: string[] }
{ op: 'object', fields: Record<string, Expr> }
{ op: 'array', items: Expr[] }
{ op: 'get', value: Expr, path: string[] }
{ op: 'select', when: Expr, then: Expr, otherwise: Expr }
{ op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte', left: Expr, right: Expr }
{ op: 'all' | 'any', items: Expr[] }
{ op: 'not' | 'exists', value: Expr }
```

Корни ref: `input` и `nodes`. `['nodes','review','decision']` читает поле decision
**последнего завершённого посещения** review в текущем экземпляре графа. Ссылка на
несуществующий node ID отвергается. Ссылка на существующий, но ещё не завершённый
узел разрешена в схеме — например, для guarded loop bindings через exists.
`select` вычисляет только выбранную ветвь; `when` обязан быть boolean. Это позволяет
передавать worker исходное задание в первом посещении, затем результат последнего
review: `select(exists(nodes.review), nodes.review, input)` в форме AST выше.
Поведение отсутствующего значения, типовые ошибки сравнения и strict boolean
закрепляет evaluator; отсутствие нельзя молча заменять null. Путь — сегменты,
поэтому точка внутри имени JSON-поля не является разделителем. Произвольный код,
вызовы функций, доступ к process/env и дополнительные AST-поля запрещены.

## Роли и настройки worker

Встроены `general`, `researcher`, `planner`, `implementer`, `reviewer`, `verifier`,
`synthesizer`, `arbiter`, `orchestrator`. Oracle не реализован. Незнакомая роль
отвергается; registry расширений будет отдельным контрактом.

`AgentConfig` — частичные overrides над role defaults:

- `model?: {provider, id}` — без секретов и неподтверждённого default model.
- `thinking?: off | minimal | low | medium | high | xhigh | max`.
- `systemPrompt?: string` — полная замена role prompt, если явно задан.
- `tools?: string[]` — замена списка; разрешён встроенный набор pi
  `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`.
- `skills?: string[]` — явные skill references; их наличие проверяет backend.
- `session?: fresh | continue-node`.
- `permission?: read-only | workspace-write | unrestricted`.
- `outputSchema?: object` — JSON Schema результата.

Reviewer получает свежую сессию, read-only инструменты, thinking high и строгий
outputSchema с `decision: approve | request_changes | inconclusive`, `summary`, `findings` и
обязательный `artifactRevision` проверенной версии результата. Опциональный
`acceptanceCriteriaRevision` связывает вывод с версией критериев. Версии нельзя
выдумывать; backend передаёт их в review input. Результат отправляется через
назначенный result tool.
Finding содержит severity и message, опционально file/line/evidence/suggestion.
Policy council строится поверх этих результатов, а не вшита в каталог.
Implementer продолжает node session и имеет workspace-write. Verifier получает
bash и workspace-write, поскольку проверки могут писать временные артефакты.
Остальные роли по умолчанию получают read-only инструменты и свежую сессию.
Все prompts требуют подтверждать фактические действия и отделять внешние данные
от управляющих инструкций.

Конфигурация с effective permission read-only и bash/edit/write отвергается с
учётом defaults. Workers работают отдельными процессами; permission profiles
задают tools и инструкции, а не OS sandbox или запрет shell path escape.
Worktrees координируют параллельные записи и интеграцию; sandbox не заявляется.
Совместимость model/thinking проверяется по установленному каталогу pi перед
запуском. В графе нет скрытых лимитов стоимости, времени, циклов или fan-out.

## Границы проверки

TypeBox authoring публикует `WorkflowSchema`, `ExprSchema`, `AgentConfigSchema`.
Все структурные объекты закрыты для неизвестных полей. Литералы и outputSchema
содержат только JSON: отклоняются undefined, NaN/Infinity, BigInt, функции,
циклические объекты, sparse arrays, getters и нестандартные прототипы.
`outputSchema` здесь проверяется как JSON-объект; поддерживаемые JSON Schema
keywords и ссылки проверяет execution-plan до запуска worker. Успешная graph
validation сама по себе не означает поддержку произвольного outputSchema исполнителем.

Проверки: `node --import tsx --test tests/graph.test.ts` и `npm run typecheck`.
Тесты покрывают реальный repair loop, вложенный fan-out, отрицательные случаи
связности и рекурсии, строгий JSON/AST/config, immutable snapshot и reviewer schema.
