import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { chooseEdge, explainEdge } from '../src/expressions.js';
import { RunController } from '../src/run-controller.js';
import { RunStore, activationKey } from '../src/run-store.js';
import { prepareExecutionPlan, verifyExecutionPlan } from '../src/execution-plan.js';
import { WorkflowService } from '../src/service.js';
import { startGraphServer } from '../src/graph-view/server.js';
import type { Edge, Expr, WorkflowDefinition } from '../src/graph.js';
const literal = (value: any): Expr => ({ op: 'literal', value });
const workflow: WorkflowDefinition = { schemaVersion: 1, id: 'trace', name: 'Routing trace', revision: 1, entryGraph: 'main', graphs: { main: { entry: 'work', nodes: [
  { id: 'work', kind: 'check', command: process.execPath, args: ['-e', "const fs=require('node:fs');let n=fs.existsSync('count')?Number(fs.readFileSync('count')):0;fs.writeFileSync('count',String(++n));process.stdout.write(String(n))"] },
  { id: 'route', kind: 'branch' },
  { id: 'answer', kind: 'await', reason: literal('Need evidence'), input: literal(null), responseSchema: { type: 'object' } },
  { id: 'done', kind: 'finish', decision: 'accepted', reason: literal('Completed'), evidence: literal([]), value: literal('ready') },
], edges: [
  { from: 'work', to: 'route' }, { from: 'route', to: 'answer' },
  { from: 'route', to: 'work', when: { op: 'eq', left: { op: 'ref', path: ['nodes','work','stdout'] }, right: literal('1') } },
  { from: 'route', to: 'answer', when: literal(false) }, { from: 'answer', to: 'done' },
] } } };
async function wait(c: RunController, id: string, status: string) {
  const deadline = Date.now() + 20_000;
  for (;;) { const run = c.observe(id).run; if (run.status === status) return run;
    if (run.status === 'failed' && status !== 'failed') throw new Error(run.error);
    if (Date.now() > deadline) throw new Error(`Timed out: ${run.status}`); await sleep(40); }
}
async function fixture(work: (c: RunController, directory: string, filename: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'dynamicwf-trace-')), filename = join(directory, 'state.sqlite'), c = new RunController(filename);
  try { await work(c, directory, filename); }
  finally { for (const run of c.store.listRuns()) { await c.control(run.id, 'cancel');
    const deadline = Date.now() + 10_000;
    while (!['failed','cancelled','succeeded'].includes(c.observe(run.id).run.status)) { if (Date.now() > deadline) throw new Error('Cleanup timeout'); await sleep(40); }
  } c.close(); await rm(directory, { recursive: true, force: true }); }
}

test('routing preserves global edge indexes, ordered short circuit, fallback and strict errors', () => {
  for (const first of [true, false]) for (const second of [true, false]) {
    const edges: Edge[] = [{ from:'unrelated',to:'x' }, { from:'a',to:'fallback' }, {from:'a',to:'first',when:literal(first)}, {from:'a',to:'second',when:literal(second)}];
    const scope = { input:null, nodes:{} }, trace = explainEdge('a', edges, scope);
    assert.equal(trace.to, chooseEdge('a', edges, scope));
    assert.equal(trace.edgeIndex, first ? 2 : second ? 3 : 1);
    assert.equal(trace.evaluations[2]!.result, first ? 'not-evaluated' : second ? 'true' : 'false');
  }
  const broken = explainEdge('a', [{from:'a',to:'b',when:literal('yes')}, {from:'a',to:'c'}], {input:null,nodes:{}});
  assert.equal(broken.reason,'error'); assert.equal(broken.to,null); assert.equal(broken.evaluations[0]!.result,'error');
  assert.equal(broken.evaluations[1]!.result,'not-evaluated'); assert.match(broken.error!, /boolean/);
  const none = explainEdge('a', [{from:'a',to:'b',when:literal(false)}], {input:null,nodes:{}});
  assert.equal(none.reason,'no-match'); assert.match(none.error!, /No matching/);
});

test('loop trace survives supervisor replacement without duplicate routes or repeated writes; API pages and graph counts agree', { timeout: 35_000 }, async () => fixture(async (c, directory, filename) => {
  const run = await c.start(workflow, null, directory), waiting = await wait(c, run.id, 'waiting');
  const before = c.store.transitions(run.id).records;
  assert.equal(before.length,4);
  const routes = before.filter(r => r.decision.from === 'route');
  assert.deepEqual(routes.map(r => [r.context.visit,r.decision.edgeIndex]), [[0,2],[1,1]]);
  assert.deepEqual(routes[0]!.decision.evaluations.map(e=>e.result), ['not-evaluated','true','not-evaluated']);
  process.kill(waiting.supervisorPid!,'SIGKILL'); await wait(c,run.id,'interrupted');
  await c.resolve(run.id,c.store.waits(run.id)[0]!.id,{}); await wait(c,run.id,'succeeded');
  assert.equal(await readFile(join(directory,'count'),'utf8'),'2');
  const after = c.store.transitions(run.id).records;
  assert.equal(after.length,5); assert.deepEqual(after.slice(0,4), before);
  assert.equal(c.store.events(run.id).filter(e=>e.type==='route.decided').length,5);
  const service = new WorkflowService(filename), server = await startGraphServer(filename,run.id);
  try {
    const page = await service.dispatch('run.trace',{id:run.id,limit:2}) as any;
    assert.equal(page.records.length,2); assert.equal(page.hasMore,true); assert.equal(page.summary.count,5);
    const next = await service.dispatch('run.trace',{id:run.id,after:page.nextAfter,limit:10}) as any;
    assert.deepEqual([...page.records,...next.records],after);
    assert.doesNotMatch(JSON.stringify(page), /ownerToken|workerToken/);
    const ui = await (await fetch(server.url+'snapshot')).json() as any;
    assert.equal(ui.trace.count,5); assert.equal(ui.graphs[0].edges[0].traversals[0].count,2);
    assert.equal(ui.graphs[0].edges[2].traversals[0].count,1);
    assert.deepEqual((await (await fetch(server.url+'trace')).json() as any).records,after);
    await assert.rejects(service.dispatch('run.trace',{id:run.id,limit:0}),/cursor\/limit/);
  } finally { await server.close(); service.close(); }
}));

test('routing error is persisted even though its source action succeeded', { timeout:20_000 }, async () => fixture(async(c,directory)=>{
  const flow = structuredClone(workflow); flow.graphs.main!.edges[0]!.when=literal('wrong type');
  const run = await c.start(flow,null,directory); await wait(c,run.id,'failed');
  const trace = c.store.transitions(run.id).records;
  assert.equal(trace.length,1); assert.equal(trace[0]!.decision.reason,'error');
  assert.equal(c.store.getActivation(run.id,trace[0]!.key)!.status,'succeeded');
  assert.equal(c.store.transitionSummary(run.id).failed,1);
}));

test('route event and record roll back together; stale owners and conflicting duplicate decisions are refused', async()=>{
  const directory=await mkdtemp(join(tmpdir(),'dynamicwf-route-atomic-')), filename=join(directory,'state.sqlite');
  const store=new RunStore(filename), injection=new DatabaseSync(filename);
  try {
    const plan=await prepareExecutionPlan(workflow,{cwd:directory,availableModels:[]});
    store.create({id:'run-trace',plan,input:null,cwd:directory}); const {token}=store.reserveLaunch('run-trace');
    const context={graphId:'main',nodeId:'work',scope:['graph','main'],visit:0}, key=activationKey(context);
    store.beginActivation('run-trace',token,context,{kind:'check',sideEffect:true}); store.completeActivation('run-trace',token,key,{exitCode:0});
    const decision=explainEdge('work',plan.workflow.graphs.main!.edges,{input:null,nodes:{}});
    injection.exec("CREATE TRIGGER route_fail BEFORE INSERT ON workflow_run_events WHEN NEW.type='route.decided' BEGIN SELECT RAISE(ABORT,'injected route failure'); END");
    assert.throws(()=>store.recordTransition('run-trace',token,key,decision),/injected route/);
    assert.equal(store.transition('run-trace',key),undefined); injection.exec('DROP TRIGGER route_fail');
    const recorded=store.recordTransition('run-trace',token,key,decision);
    assert.deepEqual(store.recordTransition('run-trace',token,key,decision),recorded);
    assert.throws(()=>store.recordTransition('run-trace','stale',key,decision),/Stale/);
    assert.throws(()=>store.recordTransition('run-trace',token,key,{...decision,to:'other'}),/Conflicting/);
    assert.equal(store.events('run-trace').filter(e=>e.type==='route.decided').length,1);
  } finally { injection.close(); store.close(); await rm(directory,{recursive:true,force:true}); }
});

test('golden v2 source/hash remain unchanged and run without fabricated historical traces', {timeout:20_000}, async()=>fixture(async(c,directory)=>{
  const saved=JSON.parse(await readFile(new URL('./fixtures/legacy-v2-plan.json',import.meta.url),'utf8'));
  const plan=verifyExecutionPlan(saved); assert.equal(plan.source,saved.source); assert.equal(plan.hash,saved.hash);
  const run=await c.startPrepared(plan,{legacy:true},directory); const result=await wait(c,run.id,'succeeded');
  assert.equal(result.taskOutcome?.decision,'accepted'); assert.deepEqual(result.output,{legacy:true});
  assert.equal(c.store.transitionSummary(run.id).supported,false); assert.equal(c.store.transitions(run.id).records.length,0);
}));

test('dynamic map instances retain separate route identities and edge counts per scope', {timeout:20_000}, async()=>fixture(async(c,directory)=>{
  const flow: WorkflowDefinition={schemaVersion:1,id:'map_trace',name:'Map trace',revision:1,entryGraph:'main',graphs:{
    main:{entry:'map',nodes:[{id:'map',kind:'map',graphId:'child',items:literal([true,false])},{id:'end',kind:'end',value:{op:'ref',path:['nodes','map']}}],edges:[{from:'map',to:'end'}]},
    child:{entry:'route',nodes:[{id:'route',kind:'branch'},{id:'yes',kind:'end',value:literal('yes')},{id:'no',kind:'end',value:literal('no')}],edges:[{from:'route',to:'no'},{from:'route',to:'yes',when:{op:'ref',path:['input']}}]},
  }};
  const run=await c.start(flow,null,directory); await wait(c,run.id,'succeeded');
  const children=c.store.transitions(run.id).records.filter(r=>r.context.graphId==='child');
  assert.equal(children.length,2); assert.notEqual(children[0]!.key,children[1]!.key);
  assert.deepEqual(children.map(r=>r.context.visit),[0,0]);
  assert.deepEqual(new Set(children.map(r=>r.decision.to)),new Set(['yes','no']));
  const summary=c.store.transitionSummary(run.id).edges.filter(e=>e.graphId==='child');
  assert.equal(new Set(summary.map(e=>e.scope)).size,2); assert.ok(summary.every(e=>e.count===1));
}));

test('recovery between a completed action and its routing checkpoint does not repeat the action', async()=>{
  const {JournalRuntime}=await import('../src/run-runtime.js');
  const {Effect}=await import('effect');
  const directory=await mkdtemp(join(tmpdir(),'dynamicwf-route-gap-')), store=new RunStore(join(directory,'state.sqlite'));
  try {
    const plan=await prepareExecutionPlan(workflow,{cwd:directory,availableModels:[]});
    store.create({id:'run-gap',plan,input:null,cwd:directory}); const first=store.reserveLaunch('run-gap');
    const context={graphId:'main',nodeId:'work',scope:['graph','main'],visit:0}, key=activationKey(context);
    store.beginActivation('run-gap',first.token,context,{kind:'check',sideEffect:true});
    store.completeActivation('run-gap',first.token,key,{stdout:'1',exitCode:0});
    store.markInterrupted('run-gap',first.token,'Simulated death after checkpoint; no external process exists');
    const next=store.reserveLaunch('run-gap'), runtime=new JournalRuntime(store,next.run,next.token,directory);
    let calls=0;
    const result=await Effect.runPromise(runtime.step(context,()=>{calls++;return Effect.succeed(null)}));
    assert.equal(calls,0); assert.deepEqual(result,{stdout:'1',exitCode:0});
    assert.equal(await Effect.runPromise(runtime.route(context,plan.workflow.graphs.main!.edges,{input:null,nodes:{work:result}})),'route');
    assert.equal(store.transitions('run-gap').records.length,1);
    assert.equal(store.getActivation('run-gap',key)!.attempt,1);
  } finally { store.close(); await rm(directory,{recursive:true,force:true}); }
});
