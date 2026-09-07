# Pi как исполнитель динамического workflow

Проверено 8 сентября 2026 года. Это исследование и архитектурные рекомендации, а не описание уже реализованного движка. Сетевые источники — официальный репозиторий; API дополнительно сверены с установленным пакетом.

## Версия и фактическая среда

- `pi --version`: `0.85.0`.
- `/opt/homebrew/bin/pi` — symlink на `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`, не пользовательский wrapper.
- `node --version`: `v26.8.1`; пакет требует Node `>=22.19.0`.
- Старый `badlogic/pi-mono` перенаправляет в `earendil-works/pi`; пакет сейчас называется `@earendil-works/pi-coding-agent`.
- В проекте на момент проверки не было package.json или реализации. Глобальные auth-файлы не читались; inference не запускался.

Версия, ESM exports и требования подтверждаются [package.json тега v0.85.0](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/package.json). Интеграцию следует закрепить на явной версии и lockfile; примеры из старых статей с `@mariozechner` и прежним auth API нельзя переносить автоматически.

## Где проходит граница движка

Pi предоставляет coding harness, SDK, JSON event stream и RPC; встроенного полного workflow scheduler или системы субагентов он не обещает. Официальная философия оставляет subagents расширениям и внешним интеграциям. [README](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md)

**Рекомендация:** управляющая программа на TypeScript + Effect владеет графом, активациями, переходами, таймерами и checkpoint. Pi исполняет только агентные блоки. Обычные `branch`, `join`, `loop`, `map`, `gate`, преобразование данных и проверка схемы не требуют LLM. «Оркестратор» как агентный примитив может предложить граф или его изменение, но не становится неявным источником истины о выполнении.

Внешний harness получает переносимый skill и CLI/API нашего движка. Поэтому Claude Code, Codex и другой harness не должны импортировать Pi SDK: это внутренняя зависимость backend. MCP можно добавить как удобный транспорт, но наличие MCP не должно быть условием работы.

## Instance, session, role, activation

`createAgentSession()` создает одну `AgentSession`, содержащую сообщения, модель, инструменты, compaction и события. Для замены активной сессии предусмотрен отдельный `AgentSessionRuntime`: после new/switch/fork меняется объект session, подписки и extension bindings надо восстановить. `prompt()` во время streaming требует явно выбрать `steer` или `followUp`, иначе вызов отвергается. [SDK](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/docs/sdk.md)

| Единица | Предлагаемая семантика |
| --- | --- |
| Workflow run | Один запуск графа, собственный журнал и бюджет; не одна общая Pi conversation |
| Primitive/role | Версионированный шаблон конфигурации, не живой процесс |
| Node | Конфигурация блока в графе |
| Activation | Конкретное исполнение node, включая номер итерации и retry attempt |
| Pi session | По умолчанию новая на activation; явный режим `continue-node` для сохранения контекста одного блока в цикле |
| Worker | Процесс, в котором живет Pi SDK; может обслуживать разные последовательные активации при корректной очистке |

Разделение session и process позволяет сначала получить простую изоляцию процессов, затем оптимизировать пул без изменения графа. Общая session на весь workflow смешает роли, инструменты, историю и независимые параллельные ветки. Одна вечная session на роль тоже смешает разные node и run. Ревьюеру полезен свежий контекст плюс явно переданный артефакт; исполнителю в repair-loop может быть полезен `continue-node`. Параллельные активации никогда не должны одновременно владеть одной session или ее файлом.

Официальный [пример subagent](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/examples/extensions/subagent/index.ts) запускает отдельный Pi process на invocation, поддерживает single/parallel/chain, изолирует context window; ограничения примера — 8 parallel tasks и 4 concurrent workers. Это хорошее подтверждение схемы интеграции, но числа являются политикой примера, а не пределом Pi.

## Concurrency, завершение и отмена

Уровень параллелизма graph nodes и уровень tool calls внутри Pi различаются. В agent-core инструменты по умолчанию выполняются параллельно; batch становится последовательным при `toolExecution: "sequential"` или наличии инструмента с `executionMode: "sequential"`. Custom tool получает AbortSignal. Это подтверждено установленным `pi-agent-core/dist/agent-loop.js` и [agent-core types](https://github.com/earendil-works/pi/blob/v0.85.0/packages/agent/src/types.ts).

RPC возвращает принятие prompt до завершения работы. `agent_end` означает конец низкоуровневого прохода, после которого возможен retry; финальный marker всей session-level работы — `agent_settled`. `abort` ждет idle, но не удаляет queued messages: для полного stop сначала `clear_queue`, затем `abort`. Протокол — LF-delimited JSONL с request IDs; документация отдельно предупреждает о несовместимости generic line readers с U+2028/U+2029. [RPC](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/docs/rpc.md)

**Следствия для движка:**

1. Не выпускать выходной токен графа на первом `agent_end` или принятом RPC command.
2. Отмена Effect fiber должна закрывать очереди, вызывать Pi abort, отписывать listeners и освобождать session; custom tools обязаны соблюдать сигнал.
3. In-process отмена кооперативна. Для жесткого дедлайна нужен отдельный worker с последующим завершением процесса; это причина держать process boundary даже при использовании SDK.
4. Ограничивать одновременно работающие nodes, tool calls, model/provider requests и записи в workspace независимо.
5. Для subprocess teardown проверять фактический exit/close, а не только факт отправки сигнала. Отдельно учитывать дочерние процессы shell.

## Структурированный результат блока

`--mode json` сериализует события, а не заставляет модель вернуть бизнес-объект по заданной схеме. Streaming updates содержат дельты, `message_end` — итоговое сообщение. [JSON mode](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/docs/json.md)

В `CreateAgentSessionOptions` 0.85.0 нет параметра `outputSchema`. Зато есть allowlist `tools`, denylist `excludeTools`, `customTools`, model и thinking; инструменты имеют schema параметров. Это проверено в установленном `dist/core/sdk.d.ts` и [SDK source](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/src/core/sdk.ts). Это не утверждение об отсутствии structured output во всех API всех провайдеров.

**Предлагаемый контракт:** каждый агентный node получает машинно построенный инструмент `submit_result`, параметры которого соответствуют output schema. Backend независимо валидирует результат, сохраняет один принятый объект и отмечает node выполненным только после завершения Pi run. Для reviewer объект включает строгий verdict (`approve`, `request_changes`, `blocked`), findings и ссылки на проверенные артефакты. Свободный текст не должен сам переключать ребра графа. Невалидный результат, отсутствие submission, повторные submissions и ошибка после submission требуют определенной политики, а не эвристики по последней строке.

Для прекращения лишних модельных ходов после submission в agent-core есть `shouldStopAfterTurn`; доступ проверен в установленном `agent.d.ts`. Адаптер должен протестировать совместимость этого hook с Pi session retries/compaction, прежде чем считать его production-контрактом. [Agent implementation](https://github.com/earendil-works/pi/blob/v0.85.0/packages/agent/src/agent.ts)

## Persistence и восстановление

Pi хранит conversation как JSONL tree с `id`, `parentId`, активным leaf, compaction и extension entries. `SessionManager` умеет create/open/inMemory/fork; это состояние диалога, а не транзакция между изменением файлов и переходом workflow. [Sessions](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/docs/sessions.md), [Session format](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/docs/session-format.md)

Движку нужен собственный durable журнал: revision графа, activation IDs, attempt IDs, input/output artifact references, session path, worker ownership, статусы, budgets и checkpoint переходов. Resume должен сначала выяснять, жив ли worker; наличие session JSONL не доказывает, что процесс работает. После crash нельзя обещать exactly-once выполнение shell или внешних действий: нужны идемпотентность, reconciliation и явное состояние uncertain для незавершенных побочных эффектов. Preset сохраняет спецификацию графа и версии defaults, а не случайные credentials, workspace paths и весь transcript прошлого запуска.

## Модели, prompts, skills, auth

Актуальный auth/model слой — `ModelRuntime`: позволяет найти модель, получить доступные модели и использовать runtime key override, credential store, environment или custom resolver. Thinking включает `off/minimal/low/medium/high/xhigh/max`, но применяемый уровень ограничивается возможностями модели. Prompt и resources задаются через ResourceLoader. [SDK: model/auth/resources](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/docs/sdk.md)

Рекомендация: primitive задает требуемые способности и разумный thinking default, а installation profile сопоставляет им доступные provider/model IDs. Перед run фиксировать разрешенные model IDs, итоговый thinking, prompt digest и skill versions; не делать тихий fallback на другую модель. Секреты остаются в credential layer и не входят в graph/preset/log. Пользовательский system prompt стоит трактовать как изменение role instructions внутри обязательного runtime-контракта output/permissions, с явным режимом полного override при необходимости.

Pi реализует Agent Skills standard, поддерживает `~/.agents/skills`, свои каталоги и явно добавленные skill paths. Обычно в контекст попадают description, а SKILL.md загружается моделью по необходимости; документация признает, что модель может его не открыть. [Skills](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/docs/skills.md)

Значит, переносимый внешний skill — инструкция проектировщику графа. Обязательные runtime instructions узла нельзя оставлять только в discoverable skill description. Их надо явно включить в разрешенный контекст. Tool availability и обязательность skill — разные поля.

## Permissions и загрузка ресурсов

Pi работает с правами запускающего пользователя и не содержит встроенного sandbox. Project trust контролирует загрузку settings/resources/extensions, но не ограничивает действия tools; context files могут загружаться даже без project trust. В headless режиме ask без сохраненного решения пропускает защищенные project resources. `--approve` — доверие ресурсам проекта, а не универсальный permission mode. [Security](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/docs/security.md)

Extensions умеют блокировать `tool_call`; при параллельном batch preflight идет последовательно, но обработчик не обязан видеть результаты соседних tools. Это пригодно для policy hooks, но не заменяет OS isolation. [Extensions](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/docs/extensions.md)

Поэтому permissions должны различать tool allowlist, workspace write policy, network policy, extension loading и external actions. Выдача `bash` уже позволяет обойти запрет только на `write`. Для настоящего ограничения файлов/сети требуются container/VM/OS policy. Официальные варианты — весь Pi в container либо host Pi с перенаправлением tools в изолированную среду; во втором случае прочие extensions остаются на host. [Containerization](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/docs/containerization.md)

Для детерминированной конфигурации backend нужен собственный ResourceLoader либо явно отключенное автоподхватывание посторонних extensions/skills/prompts/context. Глобальные пользовательские настройки не должны незаметно расширять права reviewer. Пример defaults: researcher/reviewer/oracle — разрешенные read tools и submission; implementer — workspace edit и необходимые shell tools; orchestrator — graph tools и inspection. Это проектное предложение; конкретную степень изоляции и возможность shell следует согласовать с пользователем.

## Что проверить первым в реализации

- Настоящий inference через 0.85.0: fresh session, заданная модель/thinking, custom submit_result, events и сохраненный transcript.
- Две параллельные activation без общей conversation, с независимой отменой.
- Abort при queued followup и tool execution; retry после промежуточного agent_end не должен завершать node раньше времени.
- Repair loop с fresh reviewer и continued implementer; schema-invalid result не выпускает переход.
- Restart scheduler после crash worker; отсутствие повторного исполнения уже подтвержденного node.
- Полное совпадение разрешенных tools/resources с graph config, включая исключение случайных глобальных extensions.

Эти проверки пока не выполнены: исследование ограничивалось официальными документами, исходниками и локальной read-only сверкой установленного API.
