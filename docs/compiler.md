# Компиляция схемы в TypeScript + Effect

`compileWorkflow(unknown)` из `src/compiler.ts` вызывает `parseWorkflow`, получает независимую замороженную копию определения и возвращает `{ source, hash, workflow, compilerVersion }`. Невалидная схема отвергается до генерации. `hash` — SHA-256 UTF-8 исходника; ключи JSON объектов и порядок определения graph functions канонизированы, порядок массивов сохраняется. В частности порядок условных edges остаётся значимым. Это hash **исходника**, не frozen execution plan или окружения моделей.

Сгенерированный модуль импортирует `effect`, `dynamicwf-pi/expressions`, типы `dynamicwf-pi/graph` и `dynamicwf-pi/runtime-contract`. Его публичная функция:

```ts
run(runtime: WorkflowRuntime, input: Json): Effect.Effect<Json, Error>
```

Она вызывает сгенерированную функцию entry graph. Для каждого graph компилятор создаёт отдельную функцию с `Effect.gen`, локальными `nodes` и `visits`, program counter, `while` и `switch`. Это непосредственно сгенерированный управляющий код: runtime не получает JSON-граф для интерпретации. Выражения остаются data AST и выполняются ограниченным `evaluate`; выбор стрелки — `chooseEdge`. Текст task, prompt, command, literal и поля объектов сериализуются как JSON data, не становятся JavaScript-кодом. `JSON.parse` сохраняет собственный ключ `__proto__` как данные.

## Семантика блоков

- `agent`: вычисляет task, требует строку и передаёт в `runtime.agent` node definition и вычисленный input. Без input использует копию input текущего graph invocation. `null` можно задать явно через literal.
- `check`: делегирует command/args/cwd в `runtime.check`; компилятор сам не запускает shell или subprocess.
- `transform`: возвращает вычисленное value.
- `branch`: возвращает вычисленный input; без binding — копию input текущего graph. Затем выбирается edge.
- `end`: возвращает вычисленное value как результат graph invocation, без следующей стрелки.
- `finish`: вычисляет reason/evidence/value, сохраняет решение через `runtime.finish` и завершает invocation.
- `await`: вычисляет reason/input, вызывает `runtime.wait`; после сохраняемого ответа выбирает обычный edge.
- `reuse` (compiler v9): возвращает `runtime.reuse` без выражений и без вызова модели. Требует continuation receipt; v1–v8 отвергают этот kind.

Начиная с compiler v3 каждый нетерминальный блок выбирает следующий edge через
`runtime.route`: решение сохраняется до допуска следующего узла. Подробности —
[routing-trace.md](routing-trace.md). V1/v2 source сохраняет прежний chooseEdge.
- `subworkflow`: вызывает конкретную сгенерированную child graph function с её input.
- `map`: требует массив items и вызывает child function через `Effect.forEach`. Результат — массив в порядке входных items, независимо от порядка завершения.
- `parallel`: генерирует функции отдельных ветвей и `Effect.forEach`. Результат — объект, ключи которого равны child IDs; порядок включения соответствует порядку children.
- `worktree`: передаёт runtime callback конкретной child graph function; её scope и рабочую директорию определяет изолированный Git workspace.
- `integrate`: вычисляет sources и передаёт явную интеграцию зафиксированных Git результатов в runtime.

У `map` и `parallel` число `concurrency` передаётся в Effect явно. Если поле отсутствует, используется `"unbounded"` согласно пользовательскому решению об отсутствии скрытого ограничения параллелизма. Это не отменяет ограничений ОС или провайдера. У графовых циклов нет встроенного maxIterations; условие выхода задают edges, остановку обеспечивает Effect interruption/runtime. Повторный визит заменяет `nodes[nodeId]` последним завершённым результатом; остальные завершённые node values сохраняются в пределах этого graph invocation. Соседние/дочерние graph invocations имеют отдельные records.

Каждый блок, включая end/map/parallel/subworkflow/branch/transform, исполняется через `runtime.step(context, work)`. Внутри work находятся вычисление input и дочерние вызовы. `JournalRuntime` может не вызвать thunk и вернуть уже сохранённый результат; scheduler восстанавливает локальный control flow через checkpoints.

## Идентичность активаций

`RuntimeContext` содержит `graphId`, `nodeId`, `scope: readonly string[]`, `visit`. `visit` начинается с 0 отдельно для каждого node в каждом graph invocation. Root scope: `["graph", entryGraph]`. Child scope добавляет последовательность сегментов:

```text
node, parentNodeId, visit, parentVisit, map, itemIndex, graph, childGraphId
node, parentNodeId, visit, parentVisit, parallel, childId, graph, childGraphId
node, parentNodeId, visit, parentVisit, subworkflow, graph, childGraphId
node, parentNodeId, visit, parentVisit, worktree, graph, childGraphId
```

Журнал хранит tuple/JSON `[scope, graphId, nodeId, visit]`, не склеивает произвольные сегменты разделителем. Run ID добавляет внешний runtime: один и тот же compiled workflow имеет одинаковую структуру scope в разных запусках. Нельзя разделять local records или счётчики между параллельными child invocations.

## Проверка и текущие границы

`tests/compiler.test.ts` проверяет TypeScript diagnostics **сгенерированных** модулей с strict flags, транспилирует их через установленный TypeScript, записывает временные `.mjs`, импортирует и исполняет через Effect с mock runtime. Проверены review reject → backedge → approve, map+parallel+subworkflow, порядок результатов при разном времени завершения, фактическое перекрытие ветвей, уникальность scope/visit, step для всех structural nodes, branch/check, identity input defaults, deterministic hash, literal code-looking строки и prototype data keys, invalid graph и нестроковый task.

Компилятор остаётся чистым: defaults/модели разрешает `prepareExecutionPlan`,
исполнение обеспечивает `JournalRuntime` в detached supervisor. Frozen plan
связывает source/hash с версиями compiler/runtime, моделями и ресурсами.
`loadGeneratedModule` перенаправляет только compiler-owned imports на установленный
runtime и выполняет модуль из внешней runs directory. Произвольные данные графа
не становятся импортами. Pi workers проверяют structured output, capabilities
и settlement. Журнал не обещает exactly-once для внешних эффектов: неопределённый
результат после crash нельзя повторять автоматически. См. `docs/run-journal.md`.
