import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { Effect, Exit, Cause, FiberId } from "effect";
import { RunController } from "../src/run-controller.js";
import { JournalRuntime } from "../src/run-runtime.js";
import { prepareExecutionPlan, verifyExecutionPlan } from "../src/execution-plan.js";
import { executionFailure } from "../src/execution-failure.js";
import { retryProgress, retryRemaining, RetryNotReady, type RetryPolicy } from "../src/retry-policy.js";
import { WorkflowService } from "../src/service.js";
import { startGraphServer } from "../src/graph-view/server.js";
import { compileWorkflow } from "../src/compiler.js";
import { mcpToolDefinitions } from "../src/mcp-tools.js";
import type { WorkflowDefinition } from "../src/graph.js";

const context={graphId:'main',nodeId:'work',scope:['graph','main'],visit:0};
function flow(command:string,policy?:RetryPolicy):WorkflowDefinition {
  return {schemaVersion:1,id:'retry',name:'Explicit safe retry',revision:1,entryGraph:'main',graphs:{main:{entry:'work',nodes:[
    {id:'work',kind:'check',command,args:[],...(policy?{retryPolicy:policy}:{})},
    {id:'done',kind:'finish',decision:'accepted',reason:{op:'literal',value:'Command completed'},evidence:{op:'literal',value:[]},value:{op:'ref',path:['nodes','work']}},
  ],edges:[{from:'work',to:'done'}]}}};
}
async function fixture(work:(c:RunController,directory:string,filename:string)=>Promise<void>) {
  const directory=await mkdtemp(join(tmpdir(),'dynamicwf-retry-')),filename=join(directory,'state.sqlite'),c=new RunController(filename);
  try{await work(c,directory,filename);}finally{for(const run of c.store.listRuns())await c.control(run.id,'cancel');c.close();await rm(directory,{recursive:true,force:true});}
}
async function until<T>(read:()=>T,ready:(value:T)=>boolean) {
  const deadline=Date.now()+25_000;
  for(;;){const value=read();if(ready(value))return value;if(Date.now()>deadline)throw Error(`Timed out: ${JSON.stringify(value)}`);await sleep(30);}
}
const status=(c:RunController,id:string,state:string)=>until(()=>c.observe(id).run,r=>r.status===state);
const pending=(c:RunController,id:string)=>until(()=>c.store.listActivations(id).find(a=>a.kind==='check'&&a.metadata.retry),a=>!!a);

test('a pre-admission command failure retries after its frozen delay and archives the decision with the failed attempt',{timeout:35_000},async()=>fixture(async(c,directory,filename)=>{
  const command=join(directory,'available-later'),run=await c.start(flow(command,{codes:['process'],delayMs:1200,maxAttempts:2}),null,directory);
  const failed=(await pending(c,run.id))!,decision=c.store.retries(run.id,failed.key).records[0]!;
  assert.equal(failed.attempt,1);assert.equal(decision.failure.effects,'not-started');assert.equal(decision.failure.phase,'setup');
  assert.deepEqual(c.snapshot(run.id).presentation.retryingKeys,[failed.key]);assert.deepEqual(c.snapshot(run.id).presentation.activeKeys,[]);
  await writeFile(command,"#!/bin/sh\nprintf x >> marker\n",{mode:0o700});
  const done=await status(c,run.id,'succeeded');assert.equal(done.taskOutcome?.decision,'accepted');assert.equal(await readFile(join(directory,'marker'),'utf8'),'x');
  const attempts=c.store.attempts(run.id,failed.key);assert.equal(attempts.current.attempt,2);assert.equal(attempts.current.metadata.retry,undefined);
  assert.equal((attempts.records[0]!.metadata.retry as any).status,'admitted');assert.equal((attempts.records[0]!.metadata.failure as any).effects,'not-started');
  assert.ok(attempts.current.startedAt>=decision.dueAt!);assert.deepEqual(c.store.retries(run.id,failed.key).records,[decision]);
  const service=new WorkflowService(filename),viewer=await startGraphServer(filename,run.id);
  try{const page=await service.dispatch('run.retries',{id:run.id,key:failed.key}) as any;assert.deepEqual(page.records,[decision]);assert.equal(page.current,null);
    assert.equal(mcpToolDefinitions.find(t=>t.serviceTool==='run.retries')!.annotations?.readOnlyHint,true);
    const browser=await(await fetch(viewer.url+`retries?key=${encodeURIComponent(failed.key)}`)).json();assert.deepEqual(browser,page);
  }finally{service.close();await viewer.close();}
}));

test('retry survives SIGKILL during backoff and pause prevents admission after the deadline',{timeout:40_000},async()=>fixture(async(c,directory)=>{
  const command=join(directory,'resume-later'),run=await c.start(flow(command,{codes:['process'],delayMs:1800,maxAttempts:2}),null,directory);
  const failed=(await pending(c,run.id))!,decision=c.store.retries(run.id,failed.key).records[0]!;
  await c.control(run.id,'pause');await status(c,run.id,'paused');
  process.kill(c.store.get(run.id).supervisorPid!,'SIGKILL');await status(c,run.id,'interrupted');
  await writeFile(command,"#!/bin/sh\nprintf x >> marker\n",{mode:0o700});
  await sleep(Math.max(0,decision.dueAt!-Date.now())+50);
  assert.equal(c.store.getActivation(run.id,failed.key)!.attempt,1);assert.deepEqual(c.store.retries(run.id,failed.key).records,[decision]);
  await c.control(run.id,'resume');await status(c,run.id,'succeeded');
  assert.equal(await readFile(join(directory,'marker'),'utf8'),'x');assert.equal(c.store.getActivation(run.id,failed.key)!.attempt,2);
  assert.equal(c.store.events(run.id).filter(e=>e.type==='retry.admitted').length,1);
}));

test('cancellation abandons pending retry; maxAttempts and absent policy do not admit extra attempts',{timeout:45_000},async()=>fixture(async(c,directory)=>{
  const command=join(directory,'missing');
  const run=await c.start(flow(command,{codes:['process'],delayMs:60000}),null,directory),failed=(await pending(c,run.id))!;
  await c.control(run.id,'cancel');await status(c,run.id,'cancelled');
  assert.equal(c.store.getActivation(run.id,failed.key)!.attempt,1);assert.equal((c.store.getActivation(run.id,failed.key)!.metadata.retry as any).status,'abandoned');
  assert.equal(c.store.scheduledRetry(run.id,failed.key),undefined);assert.equal(c.store.events(run.id).filter(e=>e.type==='retry.admitted').length,0);
  for(const policy of [undefined,{codes:['process'],delayMs:0,maxAttempts:2} as RetryPolicy]) {
    const other=await c.start(flow(command,policy),null,directory);await status(c,other.id,'failed');
    const record=c.store.listActivations(other.id).find(a=>a.kind==='check')!;assert.equal(record.attempt,policy?2:1);assert.equal(c.store.retries(other.id,record.key).records.length,policy?1:0);
  }
}));

test('failure, retry decision and admission are atomic; authorization cannot be reused after a new attempt starts',async()=>fixture(async(c,directory,filename)=>{
  const plan=await prepareExecutionPlan(flow('/missing',{codes:['process'],delayMs:0,maxAttempts:3}),{cwd:directory,availableModels:[]});
  c.store.create({id:'run-atomic',plan,input:null,cwd:directory});const launch=c.store.reserveLaunch('run-atomic');
  const a=c.store.beginActivation('run-atomic',launch.token,context,{kind:'check',sideEffect:true}),failure=executionFailure('process','setup','not-started','Not admitted').failure,db=new DatabaseSync(filename);
  try{
    db.exec("CREATE TRIGGER reject_retry BEFORE INSERT ON workflow_run_events WHEN NEW.type='retry.scheduled' BEGIN SELECT RAISE(ABORT,'retry event rejected'); END");
    assert.throws(()=>c.store.failActivation('run-atomic',launch.token,a.key,'Not admitted',failure,{retryEligible:true}),/event rejected/);
    assert.equal(c.store.getActivation('run-atomic',a.key)!.status,'running');assert.equal(c.store.retries('run-atomic',a.key).records.length,0);db.exec('DROP TRIGGER reject_retry');
    c.store.failActivation('run-atomic',launch.token,a.key,'Not admitted',failure,{retryEligible:true});
    db.exec("CREATE TRIGGER reject_admit BEFORE INSERT ON workflow_run_events WHEN NEW.type='retry.admitted' BEGIN SELECT RAISE(ABORT,'admission event rejected'); END");
    assert.throws(()=>c.store.beginActivation('run-atomic',launch.token,context,{kind:'check',sideEffect:true}),/admission event rejected/);
    assert.equal(c.store.attempts('run-atomic',a.key).records.length,0);assert.equal(c.store.getActivation('run-atomic',a.key)!.attempt,1);db.exec('DROP TRIGGER reject_admit');
    assert.throws(()=>c.store.beginActivation('run-atomic','stale',context,{kind:'check',sideEffect:true}),/Stale/);
    c.store.beginActivation('run-atomic',launch.token,context,{kind:'check',sideEffect:true});
    c.store.markInterrupted('run-atomic',launch.token,'Simulated loss after admission');
    const second=c.store.reserveLaunch('run-atomic');
    assert.throws(()=>c.store.beginActivation('run-atomic',second.token,context,{kind:'check',sideEffect:true}),/Uncertain side effect/);
    assert.equal(c.store.getActivation('run-atomic',a.key)!.attempt,2);assert.equal(c.store.retries('run-atomic',a.key).records.length,1);
  }finally{db.close();}
}));

test('safe retries are explicit, but unknown writes, mixed interruption, cleanup failures and excluded codes cannot repeat',async()=>fixture(async(c,directory)=>{
  for(const [index,error] of [executionFailure('output','output','unknown','Writer may have written'),executionFailure('process','cleanup','unknown','Cleanup not confirmed'),executionFailure('provider','execution','read-only','Excluded provider')].entries()) {
    const plan=await prepareExecutionPlan(flow('/unused',{codes:['output','process'],delayMs:0}),{cwd:directory,availableModels:[]}),id=`run-denied-${index}`;
    c.store.create({id,plan,input:null,cwd:directory});const launch=c.store.reserveLaunch(id),runtime=new JournalRuntime(c.store,launch.run,launch.token,directory);let calls=0;
    const result=await Effect.runPromiseExit(runtime.step(context,()=>{calls++;return Effect.fail(error);}));assert.ok(Exit.isFailure(result));assert.equal(calls,1);
    assert.equal(c.store.retries(id,c.store.listActivations(id)[0]!.key).records.length,0);
  }
  const plan=await prepareExecutionPlan(flow('/unused',{codes:['provider'],delayMs:0}),{cwd:directory,availableModels:[]});c.store.create({id:'run-mixed',plan,input:null,cwd:directory});const launch=c.store.reserveLaunch('run-mixed'),runtime=new JournalRuntime(c.store,launch.run,launch.token,directory);let calls=0;
  const mixed=await Effect.runPromiseExit(runtime.step(context,()=>{calls++;return Effect.failCause(Cause.parallel(Cause.fail(executionFailure('provider','execution','read-only','known')),Cause.interrupt(FiberId.none)));}));
  assert.ok(Exit.isFailure(mixed));assert.equal(calls,1);assert.equal(c.store.retries('run-mixed',c.store.listActivations('run-mixed')[0]!.key).records.length,0);
}));

test('retry policy is closed and versioned; very long delay is preserved without a timer overflow',async()=>fixture(async(c,directory)=>{
  const graph=flow('/missing',{codes:['process'],delayMs:Number.MAX_SAFE_INTEGER});
  for(const version of ['dynamicwf-effect-v1','dynamicwf-effect-v2','dynamicwf-effect-v3','dynamicwf-effect-v4','dynamicwf-effect-v5'] as const)assert.throws(()=>compileWorkflow(graph,version),/requires compiler v6/);
  for(const policy of [{codes:['cancelled'],delayMs:0},{codes:[],delayMs:0},{codes:['process'],delayMs:-1},{codes:['process'],delayMs:0,maxAttempts:0},{codes:['process'],delayMs:0,allowUnknownEffects:true}])await assert.rejects(prepareExecutionPlan(flow('/missing',policy as any),{cwd:directory,availableModels:[]}));
  const plan=await prepareExecutionPlan(graph,{cwd:directory,availableModels:[]});c.store.create({id:'run-long',plan,input:null,cwd:directory});const launch=c.store.reserveLaunch('run-long'),a=c.store.beginActivation('run-long',launch.token,context,{kind:'check',sideEffect:true});
  c.store.failActivation('run-long',launch.token,a.key,'Not admitted',executionFailure('process','setup','not-started','Not admitted').failure,{retryEligible:true});
  const decision=c.store.retry('run-long',a.key,1)!;assert.equal(decision.dueAt,null);assert.equal(decision.delayMs,Number.MAX_SAFE_INTEGER);
  assert.equal(retryRemaining(retryProgress(decision,'scheduled'),decision.at+1000),Number.MAX_SAFE_INTEGER-1000);
  assert.throws(()=>c.store.beginActivation('run-long',launch.token,context,{kind:'check',sideEffect:true}),RetryNotReady);
  const legacy=verifyExecutionPlan(JSON.parse(await readFile(new URL('./fixtures/legacy-v5-plan.json',import.meta.url),'utf8')));assert.equal(legacy.hash,'5f57c250e7d97a2c57608234bd2cbc36947a0e7c844a7e80a6eae250f6097efc');
  const legacyRun=await c.startPrepared(legacy,null,directory),legacyDone=await status(c,legacyRun.id,'succeeded');
  assert.deepEqual(legacyDone.output,{good:{status:'succeeded',value:1},bad:{status:'succeeded',value:null}});
}));

test('collect waits for retry exhaustion while a sibling await remains independent',{timeout:35_000},async()=>fixture(async(c,directory)=>{
  const workflow=flow(join(directory,'missing'),{codes:['process'],delayMs:1200,maxAttempts:2});
  workflow.graphs.work=workflow.graphs.main!;
  // A finish belongs only to the entry graph; the branch returns its check output.
  workflow.graphs.work.nodes[1]={id:'done',kind:'end',value:{op:'ref',path:['nodes','work']}};
  workflow.graphs.answer={entry:'wait',nodes:[{id:'wait',kind:'await',reason:{op:'literal',value:'Independent evidence'},input:{op:'literal',value:null},responseSchema:{type:'object'}},{id:'done',kind:'end',value:{op:'ref',path:['nodes','wait']}}],edges:[{from:'wait',to:'done'}]};
  workflow.graphs.main={entry:'fan',nodes:[{id:'fan',kind:'parallel',failurePolicy:'collect',children:[{id:'work',graphId:'work',input:{op:'literal',value:null}},{id:'answer',graphId:'answer',input:{op:'literal',value:null}}]},{id:'done',kind:'end',value:{op:'ref',path:['nodes','fan']}}],edges:[{from:'fan',to:'done'}]};
  const run=await c.start(workflow,null,directory),failed=(await pending(c,run.id))!;
  await until(()=>c.store.waits(run.id),records=>records.length===1);
  const parent=c.store.listActivations(run.id).find(a=>a.kind==='parallel')!;
  assert.equal(c.store.collections(run.id,parent.key).summary.total,0);
  assert.equal(c.observe(run.id).run.status,'running');
  await status(c,run.id,'waiting');
  const page=c.store.collections(run.id,parent.key);assert.equal(page.summary.failed,1);assert.equal(page.summary.total,1);
  assert.equal(c.store.getActivation(run.id,failed.key)!.attempt,2);
  await c.resolve(run.id,c.store.waits(run.id)[0]!.id,{});const done=await status(c,run.id,'succeeded');
  assert.equal((done.output as any).work.status,'failed');assert.equal((done.output as any).answer.status,'succeeded');
  assert.equal(c.store.collections(run.id,parent.key).summary.total,2);
}));

test('every member of a composite failure must match the selected retry codes',async()=>fixture(async(c,directory)=>{
  const plan=await prepareExecutionPlan(flow('/unused',{codes:['provider'],delayMs:0,maxAttempts:2}),{cwd:directory,availableModels:[]});
  c.store.create({id:'run-mixed-codes',plan,input:null,cwd:directory});const launch=c.store.reserveLaunch('run-mixed-codes'),runtime=new JournalRuntime(c.store,launch.run,launch.token,directory);let calls=0;
  const result=await Effect.runPromiseExit(runtime.step(context,()=>{calls++;return Effect.failCause(Cause.parallel(Cause.fail(executionFailure('provider','execution','read-only','Selected')),Cause.fail(executionFailure('output','output','read-only','Not selected'))));}));
  assert.ok(Exit.isFailure(result));assert.equal(calls,1);assert.equal(c.store.retries('run-mixed-codes',c.store.listActivations('run-mixed-codes')[0]!.key).records.length,0);
}));
