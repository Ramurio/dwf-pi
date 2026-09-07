# Authoring: блоки и связи как данные

[`src/authoring.ts`](../src/authoring.ts) даёт общий in-process API для будущих CLI
и MCP tools. Агент выбирает блоки, поля и связи. Циклы, scheduler и исполняемый код
оркестрации агент не пишет.

```ts
createDraft({ id: 'repair', name: 'Implement and review' })
// revision: 1, entryGraph: 'main', пустой main с entry: 'start'

applyPatch(draft, {
  expectedRevision: 1,
  operations: [
    { op: 'addNode', graphId: 'main', node: {
      id: 'implement', kind: 'agent', role: 'implementer',
      task: { op: 'ref', path: ['input', 'task'] }
    } },
    { op: 'addNode', graphId: 'main', node: {
      id: 'review', kind: 'agent', role: 'reviewer',
      task: { op: 'literal', value: 'Review the supplied artifact revision' },
      input: { op: 'ref', path: ['nodes', 'implement'] }
    } },
    { op: 'addNode', graphId: 'main', node: {
      id: 'done', kind: 'end', value: { op: 'ref', path: ['nodes', 'review'] }
    } },
    { op: 'connect', graphId: 'main', edge: { from: 'implement', to: 'review' } },
    { op: 'connect', graphId: 'main', edge: {
      from: 'review', to: 'done', when: {
        op: 'eq', left: { op: 'ref', path: ['nodes', 'review', 'decision'] },
        right: { op: 'literal', value: 'approve' }
      }
    } },
    { op: 'connect', graphId: 'main', edge: { from: 'review', to: 'implement' } }
  ]
})
// { workflow: { ... revision: 2 }, validation: { valid: true, issues: [] } }
```

Это иллюстрация data API, не отдельный способ запуска. В примере любой
не-approve возвращается к исполнителю. Другую политику для inconclusive можно
выразить отдельным conditional edge к исследованию/верификации.

## Операции

Все поля строго проверяются; неизвестные поля/операции отвергаются.

| op | Дополнительные поля | Поведение |
| --- | --- | --- |
| addGraph | `graphId` | Добавляет пустой граф с entry `start`; существующий ID — ошибка |
| removeGraph | `graphId` | Удаляет существующий graph; entryGraph удалять нельзя |
| addNode | `graphId`, `node` | Добавляет новый ID; первый node автоматически становится entry |
| replaceNode | `graphId`, `node` | Полностью заменяет существующий node с тем же ID, без merge config |
| removeNode | `graphId`, `nodeId` | Удаляет node и все связанные control edges |
| setEntry | `graphId`, `nodeId` | Назначает существующий node входом |
| connect | `graphId`, `edge` | Добавляет edge в конец массива; оба endpoint должны уже существовать |
| disconnect | `graphId`, `edgeIndex` | Удаляет edge по текущему индексу; отсутствующий индекс — ошибка |

Операции внутри batch выполняются последовательно на клоне. Можно добавить graph,
затем nodes, затем edges в одном batch. Индексы edges после удаления сдвигаются;
следующая операция использует уже изменённый порядок. `removeNode` не подменяет
entry автоматически: удаление входа отражается в validation, пока автор явно не
вызовет setEntry. Если удалены все nodes, следующий addNode снова установит entry.
Data refs к удалённому узлу и child refs к удалённому графу сохраняются и становятся
validation issues: данные не переназначаются на другой узел молча.

## Атомарность и revision

`applyPatch` требует точного `expectedRevision`; несовпадение вызывает
`RevisionConflictError` с expected/actual значениями. Успех увеличивает revision
один раз независимо от числа операций. Пустой batch отвергается. При ошибке любая
предыдущая операция batch отбрасывается; исходный draft не изменён. Успешные
workflow и validation рекурсивно заморожены, node/edge inputs скопированы.

Это атомарность чистой функции. При одновременных вызовах через разные процессы
storage должен делать compare-and-swap текущей revision в своей транзакции;
проверка revision внутри функции сама по себе не является storage lock.
Изменение запускаемого immutable snapshot не входит в authoring API.

## Незавершённый draft и готовность к компиляции

createDraft намеренно возвращает пока невалидный для исполнения workflow.
Структура каждого node/edge/config/Expr обязана быть корректной уже при patch,
включая JSON-only вход, известные роли/tools и согласованные effective permissions.
Можно ссылаться на будущие child graphs и ещё не завершённые data bindings;
отсутствие end, недостижимые узлы, двойной fallback и другие semantic issues
возвращаются в `validation`, не откатывая корректную data operation.

Чтобы запускать workflow, application service должен потребовать полноценную
успешную validation/compilation. Непустой список issues не превращается в runtime
warning. Unknown Expr op, неправильный ref root, getter, функция, NaN, цикл
объектов или malformed config отвергают сам patch.

Экспортируются `CreateDraftInput`, `DraftPatch` (alias `PatchRequest`),
`AuthoringOperation`, `PatchResult` и соответствующие TypeBox schemas.
`NodeSchema` и `EdgeSchema` дополнительно экспортированы из graph contract;
семантика исполняемых графов не изменена.

Проверки: `node --import tsx --test tests/authoring.test.ts`, `npm run typecheck`.
Тесты собирают review loop из operations, проверяют переход от незавершённого
черновика к compile-ready, stale revision, batch rollback, remove/replace/disconnect,
неизвестные targets, защиту entryGraph и строгий JSON boundary.
