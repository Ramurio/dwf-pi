# Ландшафт динамических workflow и выводы для dynamicwf-pi

Дата проверки: 2026-09-08. Это исследование документации и исходников, не сравнительный нагрузочный тест. Ссылки ведут на первичные источники. Статусы API и тарифные ограничения относятся к просмотренным страницам; перед фиксацией зависимостей нужны конкретные версии и отдельные интеграционные проверки. Claude Code исследуется в отдельном документе.

## Что именно считать динамикой

Для этого проекта полезно различать четыре свойства. Это наша классификация, а не общепринятый рейтинг продуктов:

1. **Условное исполнение:** граф известен заранее, результат узла выбирает следующую стрелку; возможен цикл implement → review → implement.
2. **Динамическая кратность:** число экземпляров блока определяется результатом предыдущего узла; например, исследовать каждый найденный пакет параллельно и собрать результаты.
3. **Динамический план:** планировщик выдаёт структурированный подграф; runtime валидирует и запускает его как дочернюю область исполнения.
4. **Изменение живого графа:** пользователь или агент меняет ещё не выполненную часть конкретного run, сохраняя объяснимую историю ревизий.

Обычный `if`, LLM, выбирающая собеседника, JSON-редактор графа и durable replay решают разные части задачи. Ни один из просмотренных продуктов сам по себе не доказывает наличие всей комбинации «любой harness → skill → инструменты блоков → машинная компиляция TS+Effect → pi workers».

## Сравнительная матрица: граф и авторинг

Здесь «код» означает, что разработчик пишет управляющую программу. Наш агент должен вместо этого заполнять декларативный документ; использовать такой движок можно через собственный компилятор.

| Система | Динамика, циклы и fan-out | Декларативный авторинг | Что полезно заимствовать |
| --- | --- | --- | --- |
| **LangGraph** | Условные рёбра, циклический граф; `Send` создаёт задания с разными входами, `Command` совмещает обновление состояния и переход. Это runtime routing внутри доступных узлов, не универсальное безопасное редактирование произвольного живого графа. | `StateGraph`, узлы-функции и рёбра; `.compile()` проверяет структуру и подключает runtime. | Явные state/input/output schemas, отдельная семантика reducer при параллельных записях. [Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api) |
| **Temporal** | Workflow-код управляет последовательностью и дочерними workflow; программы могут ждать, ветвиться и повторять работу. | Code-first; graphical IR надо строить поверх SDK. | Разделение устойчивой оркестрации и внешних Activities, самостоятельная идентичность workflow/run. [TypeScript guide](https://docs.temporal.io/develop/typescript), [Workflow Execution](https://docs.temporal.io/workflow-execution) |
| **Inngest** | Обычная программа создаёт последовательные/параллельные steps и определяет последующие действия из сохранённых результатов. | Code-first functions/endpoints и именованные steps. | Небольшая понятная API-поверхность `run`, `sleep`, `waitForEvent`, `invoke`. [Steps](https://www.inngest.com/docs/learn/inngest-steps), [Execution model](https://www.inngest.com/docs/learn/how-functions-are-executed) |
| **Hatchet** | Статические DAG и durable tasks; последние выбирают и порождают дочернюю работу во время исполнения, включая agentic loops. | Код объявления задач; runtime прямо рассматривается как основа для drag-and-drop DAG builders. | Динамический workflow как durable controller, который ждёт и запускает детей. [Durable execution](https://docs.hatchet.run/v1/durable-execution), [Child spawning](https://docs.hatchet.run/v1/child-spawning) |
| **n8n** | Визуальные соединения и условные ветви; большинство узлов уже обрабатывает набор items, особые циклы строятся отдельной обратной связью. | Настоящий node/edge authoring, workflow экспортируется в JSON. | Блоки с параметрами, маппинг входов, переносимые схемы. Не путать визуальные ветви с доказанной конкурентностью. [Looping](https://docs.n8n.io/build/flow-logic/loop.md), [Export/import](https://docs.n8n.io/build/manage-workflows/export-and-import.md) |
| **Mastra** | `.then`, `.branch`, `.parallel`, `.dountil`, `.dowhile`, `.foreach`; порядок массива результатов foreach соответствует входу. | TypeScript fluent builder, типизированные steps; не готовый универсальный JSON-язык workflow. | Компактные структурные блоки и явная передача данных между ними. [Control flow](https://mastra.ai/docs/workflows/control-flow) |
| **AutoGen GraphFlow** | Направленный граф агентов поддерживает последовательность, параллельные ветви, условия и циклы с выходом. | Python `DiGraphBuilder`; документация помечает GraphFlow experimental. | Разделение execution graph и message graph: рёбра исполнения сами по себе не ограничивают получателей сообщений. [GraphFlow](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/graph-flow.html) |
| **CrewAI Flows** | `start/listen/router`, ветвления и циклы поверх событий/состояния, композиция с Crews. | Python decorators; роли агентов — отдельный уровень от control flow. | Разделение Flow и Crew: фиксированная структура с автономными участками внутри. [Flows](https://docs.crewai.com/en/concepts/flows) |
| **Effect workflow** | Workflow реализуется Effect-программой; Activity, durable clock, durable deferred и компенсации дают строительные элементы. | TypeScript+Effect code-first; graph compiler, node registry и authoring tools требуется добавить. | Типизированные ошибки и сервисы, явно именованные устойчивые операции, единый runtime для нашего TS-стека. [v3 workflow README](https://raw.githubusercontent.com/Effect-TS/effect/v3/packages/workflow/README.md) |

## Сравнительная матрица: восстановление, внешние эффекты, gates, версии

| Система | Replay/resume и граница внешних эффектов | Human gates | Presets / versioning |
| --- | --- | --- | --- |
| **LangGraph** | Checkpointer сохраняет состояние потока; in-memory вариант теряет его после рестарта. Interrupt перезапускает node, поэтому действия до него должны быть идемпотентны. | `interrupt` отдаёт payload, `Command(resume)` продолжает конкретный thread. | Граф и state имеют ограничения миграции; переносимый пользовательский каталог пресетов надо добавить. [Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence), [Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts), [Graph migrations](https://docs.langchain.com/oss/javascript/langgraph/graph-api#graph-migrations) |
| **Temporal** | History/replay восстанавливает управляющую программу; Activities — внешние операции с собственной retry-семантикой. Сохранённая история не превращает произвольный внешний API в exactly-once. | Signals/Updates меняют состояние; Queries читают его. Прикладной approval можно построить как сообщение и условие продолжения. | Worker Versioning и patch markers обеспечивают совместимость долгоживущих executions при смене кода. Это другая задача, чем пользовательские presets. [Activity execution](https://docs.temporal.io/activity-execution), [Message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing), [Versioning](https://docs.temporal.io/develop/typescript/workflows/versioning) |
| **Inngest** | Результаты steps сохраняются, completed steps memoize; побочные эффекты должны находиться внутри steps, не между ними. | Ожидание event/signal с корреляцией и timeout; продуктовый approval-протокол строится поверх. | Стабильные step IDs важны для исполнения; полная семантика миграции живых run и immutable presets здесь не проверена. [Steps](https://www.inngest.com/docs/learn/inngest-steps), [Execution model](https://www.inngest.com/docs/learn/how-functions-are-executed) |
| **Hatchet** | Durable controller должен быть детерминированным относительно event history; внешние API/DB/random нужно вынести в child tasks. Completed durable operations восстанавливаются по журналу. | Durable event waits освобождают worker slot и применимы к approvals. | Статический DAG и динамическое порождение детей различаются. Универсальная миграция произвольно изменённого живого графа по просмотренным источникам не установлена. [Durable tasks](https://docs.hatchet.run/v1/durable-tasks) |
| **n8n** | Wait при достаточно долгом ожидании выгружает execution data в DB и позже продолжает; для временного ожидания менее 65 секунд данные остаются в процессе; интерфейс позволяет retry с исходным либо текущим workflow. Это не доказательство транзакционной replay-защиты всех интеграций. | Wait по времени, webhook или форме; узлы send-and-wait для простых согласований. | JSON import/export и workflow history; доступная глубина истории зависит от плана. [Wait](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait), [Executions](https://docs.n8n.io/workflows/executions/all-executions/), [History](https://docs.n8n.io/build/manage-workflows/view-change-history.md) |
| **Mastra** | Suspend/resume и сохраняемые snapshots позволяют продолжить приостановленный run. Устойчивость при внезапном crash в любой инструкции и exactly-once эффектов этим не доказаны. | У step есть suspend/resume payload schemas; продолжается определённый run/step. | Snapshot execution state не равен версии исходной схемы; каталог immutable presets — задача нашего слоя. [Suspend/resume](https://mastra.ai/docs/workflows/suspend-and-resume), [Snapshots](https://mastra.ai/en/reference/workflows/snapshots) |
| **AutoGen** | `save_state/load_state` агентов и teams сериализуют состояние; это не общий durable log внешних tool effects. У кастомных агентов ответственность за state implementation своя. | В рамках этой проверки полноценный durable approval-протокол GraphFlow не подтверждён. | Сохранённое состояние диалога отличается от reusable workflow definition и версии runtime. [Managing state](https://microsoft.github.io/autogen/dev/user-guide/agentchat-user-guide/tutorial/state.html) |
| **CrewAI** | Есть `@persist` состояния Flow и отдельно checkpoints execution state с пропуском completed tasks. Автоматическая запись checkpoint best-effort: ошибка логируется, выполнение продолжается. | Human Feedback in Flows даёт отдельный слой приостановки/обратной связи. | Есть restore/fork с lineage; это не автоматическая миграция изменённого кода и не гарантия сохранности каждого внешнего эффекта. [Flows](https://docs.crewai.com/en/concepts/flows), [Checkpointing](https://docs.crewai.com/v1.15.20/en/concepts/checkpointing), [Human feedback](https://docs.crewai.com/v1.15.20/en/learn/human-feedback-in-flows) |
| **Effect workflow** | Конкретный engine определяет persistence. `WorkflowEngine.layerMemory` использует Maps; такой вариант не переживает рестарт. README показывает cluster engine с PostgreSQL. Activity содержит именование, retry и idempotency-key API. | `DurableDeferred` позволяет ожидать внешний результат по token; разрешения и актуальность approval реализуются выше. | `effect` v3 и v4 имеют различную организацию пакетов; main содержит v4 beta, в v4 workflow находится среди unstable exports. Нужны pin и adapter boundary. [Engine source](https://raw.githubusercontent.com/Effect-TS/effect/v3/packages/workflow/src/WorkflowEngine.ts), [Activity source](https://raw.githubusercontent.com/Effect-TS/effect/v3/packages/workflow/src/Activity.ts), [Repository](https://github.com/Effect-TS/effect), [v4 package](https://github.com/Effect-TS/effect/blob/main/packages/effect/package.json) |

## Существенные различия, которые легко пропустить

**LangGraph:** полезен как образец явного состояния и маршрутизации, но даже его input/private schema не является границей секретности для всех streaming modes. Не следует называть поле private и считать, что оно исчезнет из событий. Для нашей системы фильтрация событий и передачи контекста должна быть явной. [Graph API, multiple schemas](https://docs.langchain.com/oss/javascript/langgraph/graph-api#multiple-schemas)

**Hatchet и Temporal:** позволяют выразить сложный flow обычным кодом, но устойчивость требует дисциплины между воспроизводимой управляющей частью и недетерминированной работой. Для нашего block editor это преимущество: компилятор может применять эту дисциплину автоматически, вместо того чтобы надеяться, что LLM правильно напишет все `await`, IDs и retries. Это наш вывод из описанных моделей. [Hatchet determinism](https://docs.hatchet.run/v1/durable-tasks#determinism-in-durable-tasks), [Temporal versioning](https://docs.temporal.io/develop/typescript/workflows/versioning)

**Inngest:** concurrency может ограничивать активные steps, а не число незавершённых workflow. Спящие и ожидающие runs не занимают тот же execution capacity. Для pi разумно отдельно ограничить активные модельные запросы, процессы workers и общее число живых runs. Последнее — рекомендация для нашего runtime. [Concurrency](https://www.inngest.com/docs/guides/concurrency)

**AutoGen:** execution edge и «кто что видит» — разные отношения; по умолчанию GraphFlow рассылает сообщения всем участникам. Для coding workers глобальный chat broadcast может принести лишний контекст и смешать независимый review с рассуждениями implementer. В нашей схеме требуются отдельные input bindings/context policies. [Message filtering](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/graph-flow.html#message-filtering)

**CrewAI:** актуальные docs описывают больше, чем сохранение одного state dict: полноценные execution checkpoints и fork. Но best-effort запись не должна молча становиться нашим durability contract. Для scheduler сначала persist завершения, затем разрешение downstream work; отказ записи должен быть наблюдаемой ошибкой. Первые два утверждения — источник, последнее — наше проектное решение. [Checkpointing](https://docs.crewai.com/v1.15.20/en/concepts/checkpointing)

**Effect:** README формулирует сильное обещание однократности Activities, но исходник также содержит retry-on-interrupt. Формулировка README не доказывает атомарность между нашей DB и внешним изменением файла/API. Кроме того, `layerMemory` действительно хранит activity results по execution ID, activity name и attempt в памяти. Для повторяющихся узлов один постоянный activity name может ошибочно переиспользовать результат предыдущей итерации; compiler должен выдавать стабильный ID каждой активации, включающий путь loop/map/subflow. [README](https://raw.githubusercontent.com/Effect-TS/effect/v3/packages/workflow/README.md), [Activity](https://raw.githubusercontent.com/Effect-TS/effect/v3/packages/workflow/src/Activity.ts), [Engine](https://raw.githubusercontent.com/Effect-TS/effect/v3/packages/workflow/src/WorkflowEngine.ts)

## Предложение для dynamicwf-pi

Далее — проектные выводы автора исследования, а не утверждения, что перечисленные продукты уже реализуют наш контракт.

### 1. Собственный декларативный IR — главная ценность проекта

Source of truth должен быть сериализуемым графом: node IDs, kind, config, input/output contracts, named ports, edges, conditions, limits и references на presets. Агент получает операции `create`, `add_node`, `connect`, `set_config`, `validate`, `compile`, `run`, `inspect`, `revise`, `save_preset`. Ему не требуется писать scheduler, цикл или генерировать TS руками.

`compile` должен создавать воспроизводимый TS+Effect artifact и manifest: hash IR, версия компилятора, версии primitive definitions и runtime ABI, hashes prompt/skill bundles. Альтернатива для обсуждения, не принятая архитектура: генерация файла `runGraph(JSON)` с закреплённым runtime является упаковкой исполняемого плана. Это слабее полноценной машинной генерации управляющего TS+Effect-кода и не доказывает её выполнение. Для заявленной цели проверять нужно именно сгенерированные структурные операторы, dataflow, схемы и стабильные IDs; агент не пишет их вручную.

Условия — ограниченный expression AST (`eq`, `and`, `exists`, `contains`, сравнения, ссылки на outputs), а не строка с `eval`. Data mappings — именованные ссылки с optional/default, array projection и структурным сбором. Это позволяет диагностировать ошибки до обращения к модели.

### 2. Разделить роли и структурные примитивы

`reviewer`, `planner`, `oracle`, `researcher`, `implementer`, `orchestrator` — настраиваемые профили одного agent primitive: модели, thinking, prompt, tools, skills, output schema, context и permissions. Название роли само по себе не определяет routing или права.

Структурные блоки — `sequence`, `branch`, `map`, `join`, `loop`, `subflow`, `human_gate`, `delay`, `transform`, `artifact`, `validate`. Они исполняются детерминированно без LLM. Review loop — композиция agent + validator + branch/loop; approve — строгое поле результата, а не поиск слова APPROVED в тексте.

Полезные contracts: review возвращает `verdict`, `findings`, `evidence`, `artifactRevision`; planner возвращает ограниченный task/graph plan; oracle — ответ, обоснование и явно неизвестное. Отдельный schema failure не должен приниматься за отрицательный review.

### 3. Pi — исполнитель агентских активаций, Effect — контроллер

Рекомендуемая исходная граница: один workflow/run — объект scheduler; каждая независимая agent activation — отдельная pi session с явным контекстом и ссылками на артефакты. Повторный вызов implementer может продолжать логическую сессию по настройке, reviewer по умолчанию получает самостоятельный контекст. Process pool — оптимизация, а не тождество node = OS process.

Это отделяет workflow state от диалога модели. Cancel workflow должен отменять workers и их дочерние команды; timeout наблюдения за worker не должен превращаться в повторный запуск. Несколько writers общего репозитория требуют worktrees либо явной сериализации/merge-блока.

### 4. Честная durable-семантика

У каждой активации нужны `runId`, `nodeId`, `activationPath`, `attemptId`, idempotency key, зафиксированные input/output и worker/session handle. Состояния включают `scheduled`, `running`, `waiting`, `succeeded`, `failed`, `cancelled`, `uncertain`. Последнее необходимо, если внешний эффект мог произойти, но подтверждение потеряно.

Нельзя обещать exactly-once для произвольного `bash` или редактирования working tree. Нужны классы эффектов: чистый, идемпотентный, проверяемый по внешнему receipt, неповторяемый без reconciliation. Для первых классов доступны автоматические retries; для последнего restart должен сначала проверить внешнее состояние. Completed outputs повторно не спрашиваются у LLM при resume.

Durable resume необходимо испытывать реальным убийством процесса до/после внешнего эффекта и до/после записи результата; отдельно — отмена, stale worker result, одновременное продолжение, повреждённый журнал. Happy-path mock недостаточен для этой гарантии.

### 5. Динамический план без неуправляемого саморедактирования

Сначала поддержать обычные циклы и runtime map; затем node `plan_subflow`, который отдаёт GraphPatch в заданной области. Runtime проверяет лимиты, доступные primitives, schema compatibility и permissions перед атомарной регистрацией дочерней ревизии. Применение patch само является событием исполнения.

Изменения живого run допустимы на safe points: будущая часть заменяется новой ревизией, завершённые активации неизменяемы, старые worker results не могут попадать в новую revision. Каждый loop имеет max iterations / budget / deadline и явный exhausted outcome. В бесконечном review loop проблема обычно не в отсутствии ещё одной итерации, а в отсутствии выхода при неразрешимом конфликте требований.

### 6. Skill, CLI и MCP должны быть одним продуктовым контрактом

Skill учит discovery → выбор primitive/preset → graph authoring → validation → execution → inspection → repair/revision → preset save. CLI с машинным JSON-вводом/выводом — общий denominator для harness с shell. MCP — тонкий transport adapter к тем же операциям, не второй scheduler. Для harness без shell/MCP skill в одиночку не создаёт доступ к runtime; это условие интеграции нужно документировать.

В skill должны быть короткий маршрут начала работы и ссылки на динамически доступные schemas/examples. Tool errors обязаны выдавать node/path, нарушенное правило и допустимые исправления; агент не должен читать весь runtime source, чтобы соединить два блока.

### 7. Preset — определение, run — доказательство

При `save_preset(fromRun)` сохранять resolved graph, параметры, pinned role/prompt/skill definitions и ссылку на успешный run как provenance. Не копировать автоматически секреты, абсолютные paths, историю модели и конкретные результаты как defaults. Нужны portable input parameters, immutable revision и отдельный alias вроде `latest`.

Существующий run закреплён за revision; обновление alias не меняет его. Для forks и replay нужен parent run/checkpoint и причина. «Успешно завершился» и «проверен человеком/тестами» — разные поля качества пресета.

### 8. Визуализация читает тот же журнал

Терминальная схема должна показывать все активные блоки, loop iteration, fan-out progress, waiting gate, elapsed time и ошибку; простой маркер «текущий узел» недостаточен при параллельности. Команды `inspect --json`, `watch` и статический Mermaid/DOT export используют один graph/run snapshot. Длинные payloads и секреты в схему не выводятся.

## Что ещё проверить до выбора конкретного runtime backend

- Какая точно версия pi и какие возможности session persistence, cancellation, structured output и tool interception доступны в её SDK; этот документ не проверяет pi.
- Effect v3 workflow + выбранный persistent engine: сценарии рестарта, loops с одинаковыми node names, child interruption, retention и миграция. Core Effect сам по себе persistence не обеспечивает.
- Устраивает ли локальный SQLite/single-host режим либо нужен распределённый scheduler. Добавление Temporal/Hatchet только ради familiar name увеличивает операционную поверхность; отказ от них означает собственную ответственность за durable protocol.
- Требуется ли редактировать живую топологию с первой версии, или достаточно генерировать graph перед run и расширять его через subflows.
- Условия по shared workspace, бюджету, человеческим gates и portability presets: это продуктовые решения пользователя, не то, что можно вывести из документации конкурентов.

Практический shortlist для проектирования: LangGraph — state/graph contracts; n8n — блоки и portable definitions; Temporal/Hatchet/Inngest — устойчивые границы исполнения; AutoGen — отдельный context graph; Mastra — компактная структурная композиция; CrewAI — role/flow separation и lineage; Effect — целевой типизированный runtime. Это выбор идей, не предложение подключить девять фреймворков как зависимости.

## Проверенные metadata pins для Effect spike

На 2026-09-08 команды `npm view effect version`, `npm view @effect/workflow version peerDependencies --json` и `npm view @effect/cluster version peerDependencies --json` вернули следующий согласованный по объявленным peer ranges набор:

| Пакет | Exact candidate pin | Основание |
| --- | --- | --- |
| `effect` | `3.22.1` | Текущая stable registry version и peer workflow/cluster |
| `@effect/workflow` | `0.19.1` | Registry version |
| `@effect/cluster` | `0.60.2` | Registry version; требует workflow `^0.19.1` |
| `@effect/experimental` | `0.61.1` | Нижняя граница peer workflow |
| `@effect/platform` | `0.97.1` | Нижняя граница peer workflow/cluster |
| `@effect/rpc` | `0.76.2` | Нижняя граница peer workflow/cluster |
| `@effect/sql` | `0.52.1` | Нижняя граница peer cluster |

Это кандидаты для отдельного spike, не доказанная интеграционная совместимость. Установка и crash/replay тесты в рамках исследования не выполнялись. `platform-node` и конкретный SQL driver следует выбрать по их registry peers перед установкой. Metadata можно повторно проверить в [effect registry](https://registry.npmjs.org/effect/latest), [workflow registry](https://registry.npmjs.org/@effect%2fworkflow/latest), [cluster registry](https://registry.npmjs.org/@effect%2fcluster/latest); ссылки `latest` изменяемы, exact pins выше фиксируют результат этой проверки.
