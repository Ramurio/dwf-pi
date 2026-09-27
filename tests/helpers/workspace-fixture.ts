import { RunStore } from '../../src/run-store.js';
import { RunController } from '../../src/run-controller.js';
import { prepareExecutionPlan } from '../../src/execution-plan.js';
import { preparedExecutionId } from '../../src/execution-types.js';
import { recoveryCheckpoint } from '../../src/recovery-inspection.js';
import type { WorkflowDefinition, Node, Json } from '../../src/graph.js';

/** Synthetic journal only. No model calls, user directories or user databases. */
export async function seedWorkspace(filename: string, directory: string) {
  const store = new RunStore(filename);
  const literal = (value: Json) => ({ op: 'literal' as const, value });
  const agent = (id: string, role: 'implementer' | 'reviewer'): Node => ({ id, label: role === 'implementer' ? 'Подготовить исправление' : 'Проверить версию результата', kind: 'agent', role, config: { permission: 'read-only', tools: ['read'], thinking: 'off' }, task: literal('Synthetic UI fixture. Never dispatched.') });
  const flow: WorkflowDefinition = { schemaVersion: 1, id: 'workspace-fixture', name: 'Проверка интерфейса · параллельные ветки и цикл ревью', revision: 1, entryGraph: 'main', graphs: {
    main: { entry: 'council', nodes: [{ id: 'council', label: 'Проверить две независимые ветки', kind: 'parallel', children: [{ id: 'correctness', graphId: 'review-loop', input: literal(null) }, { id: 'security', graphId: 'review-loop', input: literal(null) }] }, { id: 'result', kind: 'end', value: literal({ accepted: true }) }], edges: [{ from: 'council', to: 'result' }] },
    'review-loop': { entry: 'implement', nodes: [agent('implement', 'implementer'), agent('review', 'reviewer'), { id: 'done', kind: 'end', value: literal({ accepted: true }) }], edges: [{ from: 'implement', to: 'review' }, { from: 'review', to: 'implement', when: { op: 'eq', left: { op: 'ref', path: ['nodes', 'review', 'decision'] }, right: literal('request_changes') } }, { from: 'review', to: 'done' }] },
  } };
  const plan = await prepareExecutionPlan(flow, { cwd: directory, availableModels: [{ provider: 'fixture', id: 'recorded-only', thinkingLevels: ['off'] }], defaultModel: { provider: 'fixture', id: 'recorded-only' } });
  const id = 'qa-review-loop'; store.create({ id, plan, cwd: directory, input: null }); const { token } = store.reserveLaunch(id);
  function record(runId: string, owner: string, graphId: string, nodeId: string, scope: string[], visit: number, output: Json, kind = 'agent', retry = false) {
    const context = { graphId, nodeId, scope, visit };
    const a = store.beginActivation(runId, owner, context, { kind, sideEffect: false });
    if (retry) { store.failActivation(runId, owner, a.key, 'Первая попытка: ошибка формата'); store.beginActivation(runId, owner, context, { kind, sideEffect: false }); }
    store.completeActivation(runId, owner, a.key, output); return a.key;
  }
  const rootScope = ['graph', 'main'];
  const parent = store.beginActivation(id, token, { graphId: 'main', nodeId: 'council', scope: rootScope, visit: 0 }, { kind: 'parallel', sideEffect: false });
  for (const branch of ['correctness', 'security']) {
    const scope = [...rootScope, 'node', 'council', 'visit', '0', 'parallel', branch, 'graph', 'review-loop'];
    for (let visit = 0; visit < (branch === 'correctness' ? 2 : 1); visit++) {
      const key = record(id, token, 'review-loop', 'implement', scope, visit, { summary: visit ? 'Исправлен порядок сохранения данных' : 'Подготовлена реализация', artifactRevision: `tree-${branch}-${visit}` }, 'agent', branch === 'correctness' && visit === 1);
      store.recordTransition(id, token, key, { version: 1, error: null, from: 'implement', to: 'review', edgeIndex: 0, reason: 'fallback', evaluations: [{ edgeIndex: 0, to: 'review', result: 'fallback' }] });
      const changes = branch === 'correctness' && visit === 0;
      const review = record(id, token, 'review-loop', 'review', scope, visit, { decision: changes ? 'request_changes' : 'approve', summary: changes ? 'Нужны исправления: данные теряются при повторном открытии' : 'Замечания устранены', findings: changes ? ['Сохранение должно предшествовать завершению шага. Проверить повторное открытие.'] : [], artifactRevision: `tree-${branch}-${visit}` });
      store.recordTransition(id, token, review, { version: 1, error: null, from: 'review', to: changes ? 'implement' : 'done', edgeIndex: changes ? 1 : 2, reason: changes ? 'condition' : 'fallback', evaluations: [{ edgeIndex: 1, to: 'implement', result: changes ? 'true' : 'false' }, { edgeIndex: 2, to: 'done', result: changes ? 'not-evaluated' : 'fallback' }] });
    }
    record(id, token, 'review-loop', 'done', scope, 0, { accepted: true }, 'end');
  }
  store.completeActivation(id, token, parent.key, { summary: 'Две ветки завершены' });
  record(id, token, 'main', 'result', rootScope, 0, { accepted: true }, 'end');
  store.finish(id, token, { status: 'succeeded', output: { accepted: true, summary: 'Исправление проверено двумя ветками. Это синтетические данные для проверки интерфейса.' } });
  const longFlow: WorkflowDefinition = { ...flow, id: 'large-history', name: 'Длинное название: проверка сохранения выбранного прохода, фокуса и положения просмотра при большой истории и обновлениях журнала', entryGraph: 'main', graphs: { main: { entry: 'very-long-stage-name-verifying-selection-focus-and-view-state-preservation', nodes: [{ id: 'very-long-stage-name-verifying-selection-focus-and-view-state-preservation', kind: 'transform', value: literal(null) }, { id: 'done', kind: 'end', value: literal(null) }], edges: [{ from: 'very-long-stage-name-verifying-selection-focus-and-view-state-preservation', to: 'done' }] } } };
  const largePlan = await prepareExecutionPlan(longFlow, { cwd: directory, availableModels: [] });
  store.create({ id: 'qa-large-history', plan: largePlan, cwd: directory, input: null }); const largeToken = store.reserveLaunch('qa-large-history').token;
  for (let i=0; i<250; i++) record('qa-large-history', largeToken, 'main', longFlow.graphs.main!.entry, rootScope, i, { summary: `Результат прохода ${i+1}` }, 'transform');
  store.finish('qa-large-history', largeToken, { status: 'succeeded', output: { summary: 'Технически завершено; явная приёмка не записана.' } });
  store.create({ id: 'qa-failure', plan: largePlan, cwd: directory, input: null }); const failToken = store.reserveLaunch('qa-failure').token;
  const failed = store.beginActivation('qa-failure', failToken, { graphId: 'main', nodeId: longFlow.graphs.main!.entry, scope: rootScope, visit: 0 }, { kind: 'transform', sideEffect: false });
  store.failActivation('qa-failure', failToken, failed.key, 'Синтетическая ошибка входных данных');
  store.finish('qa-failure', failToken, { status: 'failed', error: 'Синтетическая ошибка входных данных' });
  const source = store.recoveryState('qa-failure'), preparedId = preparedExecutionId(largePlan.hash, directory);
  store.createContinuation({ id: 'qa-continuation', plan: largePlan, cwd: directory, paused: true, reused: [], start: { preparedId, idempotencyKey: 'qa-continue' }, request: { preparedId, idempotencyKey: 'qa-continue', source: { runId: source.run.id, planHash: source.run.plan.hash, checkpoint: recoveryCheckpoint(source.run, source.activations, source.collections, source.eventSeq) }, actor: 'UI fixture', reason: 'Исправленные входные данные в отдельном продолжении', evidence: [], reuse: [], dispositions: [], input: null, workspaceDigest: 'fixture' } });
  store.close();
  const waitFlow: WorkflowDefinition = { schemaVersion: 1, id: 'qa-wait', name: 'Ожидание ответа · изолированная проверка управления', revision: 1, entryGraph: 'main', graphs: { main: { entry: 'answer', nodes: [{ id: 'answer', kind: 'await', reason: literal('Какой вариант использовать?'), input: literal({ variants: ['A', 'B'] }), responseSchema: { type: 'object', properties: { choice: { type: 'string' } }, required: ['choice'], additionalProperties: false } }, { id: 'done', kind: 'end', value: literal({ accepted: true }) }], edges: [{ from: 'answer', to: 'done' }] } } };
  const controller = new RunController(filename);
  const wait = await controller.start(waitFlow, null, directory, { availableModels: [] }); controller.close();
  return { review: id, wait: wait.id, large: 'qa-large-history', failure: 'qa-failure', continuation: 'qa-continuation' };
}
