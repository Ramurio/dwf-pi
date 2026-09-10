import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { Effect, Exit, Cause, FiberId } from "effect";
import { RunController } from "../src/run-controller.js";
import { JournalRuntime } from "../src/run-runtime.js";
import { prepareExecutionPlan, verifyExecutionPlan } from "../src/execution-plan.js";
import { executionFailure } from "../src/execution-failure.js";
import { WorkflowService } from "../src/service.js";
import { startGraphServer } from "../src/graph-view/server.js";
import type { Expr, Graph, WorkflowDefinition } from "../src/graph.js";
import { loadGeneratedModule } from "../src/generated-module.js";
import { compileWorkflow } from "../src/compiler.js";
import { mcpToolDefinitions } from "../src/mcp-tools.js";
import { chooseEdge } from "../src/expressions.js";

const literal = (value: any): Expr => ({ op: "literal", value });
const ref = (...path: string[]): Expr => ({ op: "ref", path });
const end = (value: Expr): Graph => ({ entry: "done", nodes: [{ id: "done", kind: "end", value }], edges: [] });
function flow(policy: "collect" | "fail-fast" = "collect"): WorkflowDefinition {
  return { schemaVersion: 1, id: "collect", name: "Collect independent results", revision: 1, entryGraph: "main", graphs: {
    main: { entry: "council", nodes: [
      { id: "council", kind: "parallel", failurePolicy: policy, children: [
        { id: "broken", graphId: "broken", input: literal(null) }, { id: "good", graphId: "good", input: literal(null) }, { id: "pending", graphId: "pending", input: literal(null) },
      ] },
      { id: "done", kind: "finish", decision: "inconclusive", reason: literal("One branch failed"), evidence: literal([]), value: ref("nodes", "council") },
    ], edges: [{ from: "council", to: "done" }] },
    broken: { entry: "write", nodes: [
      { id: "write", kind: "check", command: process.execPath, args: ["-e", "const fs=require('node:fs');fs.appendFileSync('writes','x');process.kill(process.pid,'SIGKILL')"] },
      { id: "done", kind: "end", value: literal("unreachable") },
    ], edges: [{ from: "write", to: "done" }] },
    good: end(literal({ decision: "request_changes", findings: ["Known defect"] })),
    pending: { entry: "wait", nodes: [
      { id: "wait", kind: "await", reason: literal("Need evidence"), input: literal(null), responseSchema: { type: "object" } },
      { id: "done", kind: "end", value: literal({ decision: "approve" }) },
    ], edges: [{ from: "wait", to: "done" }] },
  } };
}
async function fixture(work: (controller: RunController, directory: string, filename: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-collect-")), filename = join(directory, "state.sqlite"), c = new RunController(filename);
  try { await work(c,directory,filename); }
  finally { for (const run of c.store.listRuns()) await c.control(run.id,"cancel"); c.close(); await rm(directory,{recursive:true,force:true}); }
}
async function until<T>(read: () => T, ready: (value: T) => boolean) {
  const deadline = Date.now()+25_000;
  for (;;) { const value=read();if(ready(value))return value;if(Date.now()>deadline)throw Error(`Timed out: ${JSON.stringify(value)}`);await sleep(30); }
}
const status = (c:RunController,id:string,value:string) => until(()=>c.observe(id).run,r=>r.status===value);

test("collect preserves failed and successful children across supervisor death without repeating a failed writer", {timeout:45_000}, async()=>fixture(async(c,directory,filename)=>{
  const run=await c.start(flow(),null,directory);
  await status(c,run.id,"waiting");
  const parent=c.store.listActivations(run.id).find(a=>a.kind==='parallel')!;
  await until(()=>c.store.collections(run.id,parent.key),page=>page.summary.total===2);
  const before=c.store.collections(run.id,parent.key);
  assert.equal(before.summary.failed,1);assert.equal(before.summary.succeeded,1);
  const failure=before.records.find(r=>r.itemId==='broken')!.result;
  assert.equal(failure.status,'failed');if(failure.status==='failed'){assert.equal(failure.failure.code,'process');assert.equal(failure.failure.effects,'unknown');}
  const vote=before.records.find(r=>r.itemId==='good')!.result;
  assert.deepEqual(vote,{status:'succeeded',value:{decision:'request_changes',findings:['Known defect']}});
  assert.equal(await readFile(join(directory,'writes'),'utf8'),'x');
  process.kill(c.store.get(run.id).supervisorPid!,'SIGKILL');await status(c,run.id,'interrupted');
  await c.resolve(run.id,c.store.waits(run.id)[0]!.id,{});
  const finished=await status(c,run.id,'succeeded');
  assert.equal(finished.taskOutcome?.decision,'inconclusive');
  assert.equal(await readFile(join(directory,'writes'),'utf8'),'x');
  const page=c.store.collections(run.id,parent.key);
  assert.deepEqual(page.records.slice(0,2),before.records);assert.equal(page.summary.total,3);
  assert.deepEqual(c.store.getActivation(run.id,parent.key)!.metadata.collectionSummary,page.summary);
  assert.equal(c.store.getActivation(run.id,parent.key)!.attempt,2);
  const result=finished.output as any;
  assert.deepEqual(result.broken,failure);assert.deepEqual(result.good,vote);assert.equal(result.pending.value.decision,'approve');
  const service=new WorkflowService(filename),viewer=await startGraphServer(filename,run.id);
  try {
    const first=await service.dispatch('run.collections',{id:run.id,key:parent.key,limit:1}) as any;
    const rest=await service.dispatch('run.collections',{id:run.id,key:parent.key,after:first.nextAfter}) as any;
    assert.deepEqual([...first.records,...rest.records],page.records);
    const tool=mcpToolDefinitions.find(t=>t.serviceTool==='run.collections')!;assert.equal(tool.annotations?.readOnlyHint,true);
    assert.doesNotMatch(JSON.stringify(first),/ownerToken|workerToken/);
    const browser=await(await fetch(viewer.url+`collections?key=${encodeURIComponent(parent.key)}`)).json() as any;
    assert.deepEqual(browser,page);
    const snapshot=await(await fetch(viewer.url+'snapshot')).json() as any;
    assert.equal(snapshot.graphs.find((g:any)=>g.id==='main').nodes.find((n:any)=>n.id==='council').failurePolicy,'collect');
  }finally{await viewer.close();service.close();}
}));

test("fail-fast retains ordinary failure semantics; cancelling collect does not produce a successful collection", {timeout:45_000}, async()=>fixture(async(c,directory)=>{
  const fast=await c.start(flow('fail-fast'),null,directory);await status(c,fast.id,'failed');
  const parent=c.store.listActivations(fast.id).find(a=>a.kind==='parallel')!;
  assert.equal(c.store.collections(fast.id,parent.key).enabled,false);assert.equal(c.store.collections(fast.id,parent.key).summary.total,0);
  const collected=await c.start(flow(),null,directory);await status(c,collected.id,'waiting');
  const key=c.store.listActivations(collected.id).find(a=>a.kind==='parallel')!.key;
  await until(()=>c.store.collections(collected.id,key),p=>p.summary.failed===1);
  await c.control(collected.id,'cancel');const cancelled=await status(c,collected.id,'cancelled');
  assert.equal(cancelled.output,undefined);assert.equal(c.store.collections(collected.id,key).summary.failed,1);
  assert.equal(c.store.collections(collected.id,key).records.some(r=>r.itemId==='pending'),false);
}));

test("dynamic map keeps input order under collect and a malformed items expression still fails the parent",{timeout:35_000},async()=>fixture(async(c,directory)=>{
  const graph:WorkflowDefinition={schemaVersion:1,id:'map_collect',name:'Map collection',revision:1,entryGraph:'main',graphs:{
    main:{entry:'map',nodes:[{id:'map',kind:'map',graphId:'child',failurePolicy:'collect',concurrency:1,items:literal([{value:'first'},null,{value:'last'}])},{id:'done',kind:'end',value:ref('nodes','map')}],edges:[{from:'map',to:'done'}]},
    child:end(ref('input','value')),
  }};
  const run=await c.start(graph,null,directory),done=await status(c,run.id,'succeeded'),result=done.output as any[];
  assert.deepEqual(result[0],{status:'succeeded',value:'first'});assert.equal(result[1].status,'failed');assert.equal(result[1].failure.code,'expression');assert.deepEqual(result[2],{status:'succeeded',value:'last'});
  const node=graph.graphs.main!.nodes[0]!;if(node.kind==='map')node.items=literal('not an array');
  const bad=await c.start(graph,null,directory);await status(c,bad.id,'failed');assert.equal(c.store.listActivations(bad.id).length,1);
}));

test("collect never converts cancellation, recovery uncertainty, cleanup failure, defects or collection journal errors to data",async()=>fixture(async(c,directory,filename)=>{
  const definition=flow(),plan=await prepareExecutionPlan(definition,{cwd:directory,availableModels:[]});
  c.store.create({id:'run-unit',plan,input:null,cwd:directory});const launch=c.store.reserveLaunch('run-unit');
  const context={graphId:'main',nodeId:'council',scope:['graph','main'],visit:0};
  const a=c.store.beginActivation('run-unit',launch.token,context,{kind:'parallel',sideEffect:false});
  const runtime=new JournalRuntime(c.store,launch.run,launch.token,directory);
  for(const error of [executionFailure('cancelled','execution','unknown','cancel'),executionFailure('uncertain-effect','recovery','unknown','uncertain'),executionFailure('process','cleanup','unknown','cleanup')]) {
    const exit=await Effect.runPromiseExit(runtime.collect(context,'broken',()=>Effect.fail(error)));
    assert.ok(Exit.isFailure(exit));assert.equal(c.store.collection('run-unit',a.key,'broken'),undefined);
  }
  const defect=await Effect.runPromiseExit(runtime.collect(context,'broken',()=>Effect.die(new Error('defect'))));
  assert.ok(Exit.isFailure(defect)&&Cause.isDie(defect.cause));
  for (const cause of [Cause.parallel(Cause.fail(new Error('ordinary')),Cause.interrupt(FiberId.none)),Cause.parallel(Cause.fail(new Error('ordinary')),Cause.fail(executionFailure('uncertain-effect','recovery','unknown','uncertain')))]) {
    const composite=await Effect.runPromiseExit(runtime.collect(context,'broken',()=>Effect.failCause(cause)));
    assert.ok(Exit.isFailure(composite));assert.equal(c.store.collection('run-unit',a.key,'broken'),undefined);
  }
  const child={graphId:'broken',nodeId:'write',scope:['graph','main','node','council','visit','0','parallel','broken','graph','broken'],visit:0};
  const unfinished=c.store.beginActivation('run-unit',launch.token,child,{kind:'check',sideEffect:true});c.store.failActivation('run-unit',launch.token,unfinished.key,'Lost before collection checkpoint');
  let retried=false;
  const gap=await Effect.runPromiseExit(runtime.collect(context,'broken',()=>runtime.step(child,()=>{retried=true;return Effect.succeed(null);})));assert.ok(Exit.isFailure(gap));assert.equal(retried,false);assert.equal(c.store.collection('run-unit',a.key,'broken'),undefined);
  const db=new DatabaseSync(filename);
  try {
    db.exec("CREATE TRIGGER reject_collect BEFORE INSERT ON workflow_run_events WHEN NEW.type='collection.settled' BEGIN SELECT RAISE(ABORT,'collection event rejected'); END");
    await assert.rejects(Effect.runPromise(runtime.collect(context,'good',()=>Effect.succeed(42))),/event rejected/);
    assert.equal(c.store.collection('run-unit',a.key,'good'),undefined);assert.equal(c.store.getActivation('run-unit',a.key)!.metadata.collectionSummary,undefined);db.exec('DROP TRIGGER reject_collect');
    assert.deepEqual(await Effect.runPromise(runtime.collect(context,'good',()=>Effect.succeed(42))),{status:'succeeded',value:42});
    assert.deepEqual(await Effect.runPromise(runtime.collect(context,'good',()=>Effect.die('must not repeat'))),{status:'succeeded',value:42});
    assert.throws(()=>c.store.recordCollection('run-unit','stale',a.key,'good',{status:'succeeded',value:42}),/Stale/);
    assert.throws(()=>c.store.recordCollection('run-unit',launch.token,a.key,'good',{status:'succeeded',value:43}),/different data/);
    assert.equal(c.store.events('run-unit').filter(e=>e.type==='collection.settled').length,1);
  }finally{db.close();}
}));

test("child-input errors are collected, nested results retain envelopes, and old compilers reject the new policy",{timeout:30_000},async()=>fixture(async(c,directory)=>{
  const graph:WorkflowDefinition={schemaVersion:1,id:'nested_collect',name:'Nested collection',revision:1,entryGraph:'main',graphs:{
    main:{entry:'fan',nodes:[{id:'fan',kind:'parallel',failurePolicy:'collect',children:[{id:'bad',graphId:'child',input:ref('input','missing')},{id:'nested',graphId:'nested',input:literal(null)}]},{id:'done',kind:'end',value:ref('nodes','fan')}],edges:[{from:'fan',to:'done'}]},
    nested:{entry:'map',nodes:[{id:'map',kind:'map',graphId:'child',failurePolicy:'collect',items:literal([{value:1},{}])},{id:'done',kind:'end',value:ref('nodes','map')}],edges:[{from:'map',to:'done'}]},
    child:end(ref('input','value')),
  }};
  for(const version of ['dynamicwf-effect-v1','dynamicwf-effect-v2','dynamicwf-effect-v3','dynamicwf-effect-v4'] as const)assert.throws(()=>compileWorkflow(graph,version),/requires compiler v5/);
  const invalid=structuredClone(graph);(invalid.graphs.main!.nodes[0] as any).failurePolicy='ignore';await assert.rejects(prepareExecutionPlan(invalid,{cwd:directory,availableModels:[]}));
  const run=await c.start(graph,{},directory),done=await status(c,run.id,'succeeded'),result=done.output as any;
  assert.equal(result.bad.status,'failed');assert.equal(result.bad.failure.code,'expression');
  assert.equal(result.nested.status,'succeeded');assert.deepEqual(result.nested.value[0],{status:'succeeded',value:1});assert.equal(result.nested.value[1].status,'failed');
  const groups=c.store.listActivations(run.id).filter(a=>a.kind==='map'||a.kind==='parallel');assert.equal(groups.length,2);assert.notEqual(groups[0]!.key,groups[1]!.key);
  for(const group of groups)assert.equal(c.store.collections(run.id,group.key).summary.total,2);
}));

test("v4 golden plan remains byte-identical with repair policy and runs without collection envelopes",async()=>fixture(async(c,directory)=>{
  const plan=verifyExecutionPlan(JSON.parse(await readFile(new URL('./fixtures/legacy-v4-plan.json',import.meta.url),'utf8')));
  assert.equal(plan.hash,'ac8d5a73e8c1d0b3ecec189f2f21316c4357dd22c4cb2621ab3631c784502026');
  const program=await loadGeneratedModule(plan,directory);
  const runtime={step:(_c:any,work:any)=>work(),agent:()=>Effect.succeed('legacy'),route:(context:any,edges:any,scope:any)=>Effect.try(()=>chooseEdge(context.nodeId,edges,scope)),collect:()=>Effect.die('legacy plan must not collect')} as any;
  assert.deepEqual(await Effect.runPromise(program.run(runtime,null)),['legacy','legacy']);
}));
