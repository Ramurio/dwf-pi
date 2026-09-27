import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore, type RunEvent } from '../src/run-store.js';
import { collectExecutionOrder } from '../src/graph-view/execution-order.js';
import { startGraphServer } from '../src/graph-view/server.js';
import { seedWorkspace } from './helpers/workspace-fixture.js';
import { RunController } from '../src/run-controller.js';
// @ts-expect-error browser module
import { readLocation, locationFor, resolveLocation } from '../src/graph-view/navigation.js';
// @ts-expect-error browser module
import { taskGroups, executions, childExecutions, ancestry, transitionTarget, executionSequence, scopeLabel } from '../src/graph-view/execution-data.js';

const scope = (branch: string, visit = 0) => JSON.stringify(['graph', 'main', 'node', 'fan', 'visit', String(visit), 'parallel', branch, 'graph', 'child']);
const a = (key: string, branch: string, visit: number, attempt = 1) => ({ key, scope: scope(branch), visit, attempt, startedAt: 1 });
const run = { id: 'run / русский', entryGraph: 'main', graphs: [{ id: 'main', nodes: [{ id: 'fan', kind: 'parallel', children: [{ id: 'A', graphId: 'child' }], activations: [{ key: 'parent', scope: '["graph","main"]', visit: 1, attempt: 1 }] }] }, { id: 'child', nodes: [{ id: 'review', children: [], activations: [a('first?&#', 'A', 1, 3), a('second', 'A', 2), a('other', 'AB', 1)] }] }] };
test('URL roundtrip retains activation/attempt; stale graph hints cannot redirect a key', () => {
  const route = { id: run.id, tab: 'history', graph: 'wrong', node: 'wrong', scope: scope('AB'), key: 'first?&#', attempt: 2 };
  const url = locationFor('http://127.0.0.1:4380/?keep=value', route);
  assert.equal(url.searchParams.get('keep'), 'value');
  const restored = resolveLocation(run, readLocation(url.href));
  assert.deepEqual([restored.id, restored.graph, restored.node, restored.scope, restored.key, restored.attempt, restored.tab], [run.id, 'child', 'review', scope('A'), 'first?&#', 2, 'history']);
  const next = resolveLocation(run, { ...restored, key: 'second', attempt: null });
  assert.equal(next.attempt, 1);
  assert.equal(resolveLocation(run, restored).attempt, 2, 'polling never follows the latest attempt');
  assert.equal(readLocation('http://localhost/?run=legacy').tab, 'graph');
  assert.equal(resolveLocation(run, readLocation('http://localhost/?run=legacy')).graph, 'main');
  assert.match(resolveLocation(run, { key: 'missing' }).missing, /отсутствует/);
  assert.match(resolveLocation(run, { graph: 'main', node: 'missing' }).missing, /этап отсутствует/);
  assert.match(resolveLocation(run, { graph: 'child', scope: scope('missing') }).missing, /область выполнения отсутствует/);
  for (const invalid of ['-1', '0', 'NaN', '1.5', '9007199254740992']) assert.equal(readLocation(`http://localhost/?attempt=${invalid}`).attempt, null);
});
test('task grouping never guesses a relationship from names, directory or dates', () => {
  const records = ['root', 'continuation', 'old1', 'old2'].map((id, i) => ({ id, name: 'same', cwd: '/same', createdAt: i, ...(i < 2 ? { lineage: { taskId: 'task' } } : {}) }));
  assert.deepEqual(taskGroups(records).map((g: any) => g.runs.map((r: any) => r.id)), [['root', 'continuation'], ['old1'], ['old2']]);
});
test('branch ancestry compares full segments and the container visit', () => {
  const records = executions(run), parent = records.find((a: any) => a.key === 'parent');
  assert.deepEqual(childExecutions(records, parent, { id: 'A', graphId: 'child' }).map((a: any) => a.key), ['first?&#', 'second']);
  assert.deepEqual(childExecutions(records, { ...parent, visit: 2 }, { id: 'A', graphId: 'child' }), []);
  assert.deepEqual(ancestry(run, 'child', scope('A')).map((p: any) => p.label), ['Основной процесс', 'fan · проход 1', 'child']);
});
test('scope labels consume marker values even when valid IDs are named like markers', () => {
  const parts = ['graph','parallel','node','parallel','visit','0','parallel','visit',
    'graph','node','node','visit','visit','1','map','parallel','graph','child'];
  assert.equal(scopeLabel(JSON.stringify(parts)), 'parallel / проход 1 / Ветка visit / visit / проход 2 / Элемент parallel');
  assert.equal(scopeLabel(JSON.stringify(['graph','main','node','visit','visit','0','parallel','node','graph','child'])),
    'visit / проход 1 / Ветка node');
  assert.doesNotMatch(scopeLabel(JSON.stringify(parts)), /NaN|Ветка graph|Элемент graph/);
});
test('journal sequence connects a review decision to admission, never just equal timestamps', () => {
  const index = new Map();
  const events = [
    { seq: 10, type: 'activation.started', payload: { key: 'review', attempt: 1, secret: 'PRIVATE' } },
    { seq: 12, type: 'route.decided', payload: { key: 'review', prompt: 'PRIVATE' } },
    { seq: 15, type: 'activation.started', payload: { key: 'fix', attempt: 1 } },
    { seq: 18, type: 'activation.started', payload: { key: 'fix', attempt: 2 } },
  ].map(event => ({ ...event, runId: 'fixture', at: 1 })) as RunEvent[];
  collectExecutionOrder(events.slice(0,2), index); collectExecutionOrder(events.slice(2), index);
  assert.deepEqual(index.get('fix'), { firstStarted: 15, latestStarted: 18, attempt: 2, transition: null });
  assert.doesNotMatch(JSON.stringify([...index]), /PRIVATE|prompt|secret/);
  const records = [{ key: 'review', order: index.get('review') }, { key: 'old', graphId: 'child', node: { id: 'implement' }, scope: scope('A'), order: { firstStarted: 9 } }, { key: 'fix', graphId: 'child', node: { id: 'implement' }, scope: scope('A'), order: index.get('fix') }];
  const transition = { key: 'review', context: { graphId: 'child', scope: JSON.parse(scope('A')) }, decision: { to: 'implement' }, at: 1 };
  assert.equal(transitionTarget(transition, records).key, 'fix');
  assert.equal(transitionTarget(transition, records.filter(r => r.key !== 'fix')), null);
  assert.equal(transitionTarget(transition, records.map(r => ({ ...r, order: null, startedAt: 1 }))), null);
  assert.deepEqual(records.slice(1).reverse().sort(executionSequence).map(r => r.key), ['old', 'fix']);
});
test('workspace fixture exposes event ordering, archived attempts, real lineage and all browser modules', { timeout: 20000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dwf-workspace-')), filename = join(directory, 'state.sqlite');
  let controller: RunController | undefined, server: Awaited<ReturnType<typeof startGraphServer>> | undefined, waitId: string | undefined;
  try {
    const ids = await seedWorkspace(filename, directory); waitId = ids.wait;
    controller = new RunController(filename); server = await startGraphServer(filename, ids.review);
    const snapshot = await (await fetch(server.url+'snapshot?id='+ids.review)).json();
    const records = executions(snapshot), implementation = records.find((a: any) => a.node.id === 'implement' && a.visit === 2);
    assert.equal(implementation.attempt, 2); assert.ok(implementation.order.latestStarted > implementation.order.firstStarted);
    const trace = await (await fetch(server.url+'trace?id='+ids.review)).json();
    const feedback = trace.records.find((r: any) => r.decision.to === 'implement');
    assert.equal(transitionTarget(feedback, records).key, implementation.key);
    const attempts = await (await fetch(server.url+'attempts?id='+ids.review+'&key='+encodeURIComponent(implementation.key))).json();
    assert.equal(attempts.records[0].attempt, 1); assert.match(attempts.records[0].error, /ошибка формата/);
    const list = await (await fetch(server.url+'runs')).json();
    assert.equal(taskGroups(list.runs).find((g: any) => g.runs.some((r: any) => r.id === ids.failure)).runs.length, 2);
    for (const name of ['navigation.js', 'execution-data.js', 'view-state.js', 'workspace.js']) assert.equal((await fetch(server.url+name)).status, 200);
    const store = new RunStore(filename);
    try { assert.equal(store.listActivations(ids.large).length, 250); } finally { store.close(); }
  } finally {
    if (controller && waitId) { await controller.control(waitId, 'cancel'); controller.close(); }
    await server?.close(); await rm(directory, { recursive: true, force: true });
  }
});

test('explicit display labels are optional, frozen and safe for old plans', async () => {
  const { prepareExecutionPlan, verifyExecutionPlan } = await import('../src/execution-plan.js');
  const { applyPatch } = await import('../src/authoring.js');
  const workflow = { schemaVersion: 1 as const, id: 'display', name: 'Display', revision: 1, entryGraph: 'main', graphs: { main: { entry: 'done', nodes: [{ id: 'done', kind: 'end' as const, value: { op: 'literal' as const, value: null } }], edges: [] } } };
  const before = await prepareExecutionPlan(workflow, { cwd: process.cwd(), availableModels: [] });
  const label = 'Опубликовать результат <script>literal</script>';
  const patched = applyPatch(workflow, { expectedRevision: 1, operations: [{ op: 'replaceNode', graphId: 'main', node: { ...workflow.graphs.main.nodes[0]!, label } }] });
  const after = await prepareExecutionPlan(patched.workflow, { cwd: process.cwd(), availableModels: [] });
  assert.equal(before.workflow.graphs.main!.nodes[0]!.label, undefined);
  assert.equal(after.workflow.graphs.main!.nodes[0]!.label, label);
  assert.equal(verifyExecutionPlan(before).hash, before.hash); assert.equal(verifyExecutionPlan(after).hash, after.hash);
  assert.notEqual(before.hash, after.hash);
  assert.equal(before.runtimeVersion, after.runtimeVersion);
});
