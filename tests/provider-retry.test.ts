import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect, Cause, Exit } from "effect";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { RunStore } from "../src/run-store.js";
import { JournalRuntime } from "../src/run-runtime.js";
import { ExecutionFailure } from "../src/execution-failure.js";
import { permitsRetry, retryDelay, RetryNotReady, type RetryPolicy } from "../src/retry-policy.js";
import { executePiWorker } from "../src/pi-worker.js";
import { compileWorkflow } from "../src/compiler.js";
import type { WorkflowDefinition } from "../src/graph.js";
import { graphSnapshot } from "../src/graph-view/model.js";
import { monitorBody } from "../src/monitor.js";

const context={graphId:'main',nodeId:'worker',scope:['graph','main'],visit:0};
const error=(status?:number,delay?:number)=>new ExecutionFailure({version:1,code:'provider',phase:'execution',effects:'read-only',message:'Provider failure',...(status===undefined?{}:{providerResponse:{status,...(delay===undefined?{}:{retryAfterMs:delay})}})});
const policy:RetryPolicy={codes:['provider'],delayMs:50,provider:{statuses:[429,503],retryAfter:'honor'}};
function flow(policy:RetryPolicy):WorkflowDefinition{return {schemaVersion:1,id:'provider_retry',name:'Provider retry',revision:1,entryGraph:'main',graphs:{main:{entry:'worker',nodes:[{id:'worker',kind:'agent',role:'general',task:{op:'literal',value:'Offline task'},retryPolicy:policy,config:{tools:[],permission:'read-only'}},{id:'done',kind:'end',value:{op:'literal',value:null}}],edges:[{from:'worker',to:'done'}]}}};}
async function fixture(policy:RetryPolicy,work:(f:{store:RunStore;runtime:JournalRuntime;directory:string;filename:string;token:string})=>Promise<void>){
  const directory=await mkdtemp(join(tmpdir(),'dynamicwf-provider-retry-')),filename=join(directory,'state.sqlite'),store=new RunStore(filename);
  try{const plan=await prepareExecutionPlan(flow(policy),{cwd:directory,availableModels:[{provider:'offline-provider',id:'fixture',thinkingLevels:['off']}]});store.create({id:'run-policy',plan,input:null,cwd:directory});const launch=store.reserveLaunch('run-policy');
    await work({store,runtime:new JournalRuntime(store,launch.run,launch.token,directory),directory,filename,token:launch.token});
  }finally{store.close();await rm(directory,{recursive:true,force:true});}
}

test('status filtering requires observed HTTP facts and preserves explicitly selected non-provider failures',async()=>{
  assert.equal(permitsRetry(policy,1,error(429).failure),true);assert.equal(permitsRetry(policy,1,error(401).failure),false);assert.equal(permitsRetry(policy,1,error().failure),false);
  assert.equal(permitsRetry({...policy,codes:['provider','resource']},1,{version:1,code:'resource',phase:'setup',effects:'not-started',message:'Missing resource'}),true);
  assert.equal(permitsRetry(policy,1,{...error(429).failure,effects:'unknown'}),false);
  assert.equal(permitsRetry({...policy,maxAttempts:1},1,error(429).failure),false);
  assert.equal(retryDelay(policy,[error(429,10).failure]),50);assert.equal(retryDelay(policy,[error(429,900).failure,error(503,1200).failure]),1200);
  assert.equal(retryDelay({...policy,provider:{retryAfter:'ignore'}},[error(429,900).failure]),50);
  assert.equal(retryDelay({...policy,provider:undefined} as any,[error(429,900).failure]),50);
  for(const provider of [{statuses:[]},{statuses:[99]},{statuses:[600]},{statuses:[429,429]},{statuses:[429.1]},{retryAfter:'automatic'},{statuses:[429],allowUnknown:true}])await assert.rejects(prepareExecutionPlan(flow({...policy,provider} as any),{cwd:process.cwd(),availableModels:[]}));
  await assert.rejects(prepareExecutionPlan(flow({...policy,codes:['process']}),{cwd:process.cwd(),availableModels:[]}),/Provider retry options require/);
  assert.throws(()=>compileWorkflow(flow(policy),'dynamicwf-effect-v6'),/require compiler v7/);
});

test('native SDK retries selected statuses once per attempt, honors the server floor, and stops on 401',{timeout:15000},async()=>fixture(policy,async({store,runtime,directory,token})=>{
  const modelRuntime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
  modelRuntime.registerProvider('offline-provider',{api:'openai-responses',baseUrl:'https://offline.invalid/v1',apiKey:'OFFLINE',models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:10000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
  const requests:number[]=[],unavailableAttempts:number[]=[];
  const result=await Effect.runPromiseExit(runtime.step(context,()=>Effect.tryPromise({try:async signal=>{
    const activation=store.listActivations('run-policy')[0]!;store.startUsage('run-policy',token,activation.key);
    await executePiWorker({version:1,config:store.get('run-policy').plan.agents.main!.worker!,task:'Offline task',input:null,cwd:directory,resourceDirectory:join(directory,`resources-${activation.attempt}`),sessionDirectory:join(directory,'sessions')},{modelRuntime,signal,providerFetch:async()=>{
      requests.push(Date.now());const status=[429,503,401][requests.length-1]??500;
      return new Response(JSON.stringify({error:{message:'PRIVATE_RESPONSE'}}),{status,headers:requests.length===1?{'retry-after':'1'}:{}});
    },onEvent(event){if(event.type==='usage.report')store.recordUsage('run-policy',token,activation.key,String(event.reportId),event.usage,String(event.stopReason));else if(event.type==='usage.unavailable')unavailableAttempts.push(activation.attempt);else if(event.type==='usage.settled')store.settleUsage('run-policy',token,activation.key,event.complete===true);}});return null;
  },catch:error=>error as Error})));
  assert.ok(Exit.isFailure(result));assert.equal(requests.length,3);
  const activation=store.listActivations('run-policy')[0]!,decisions=store.retries('run-policy',activation.key).records,attempts=store.attempts('run-policy',activation.key);
  assert.deepEqual(decisions.map(d=>[d.failure.providerResponse?.status,d.delayMs]),[[429,1000],[503,50]]);
  assert.ok(requests[1]!>=decisions[0]!.dueAt!);assert.ok(requests[2]!>=decisions[1]!.dueAt!);
  assert.equal((activation.metadata.failure as any).providerResponse.status,401);assert.equal(activation.attempt,3);
  assert.deepEqual(attempts.records.map(a=>(a.metadata.failure as any).providerResponse.status),[429,503]);
  // HTTP error bodies supply no usage: SDK zero placeholders are not token reports.
  assert.equal(store.usageReports('run-policy').reports.length,0);
  assert.deepEqual(unavailableAttempts,[1,2,3]);
  assert.ok(attempts.records.every(a=>a.accounting.complete===false));
  assert.equal(attempts.current.accounting.complete,false);
  assert.doesNotMatch(JSON.stringify(decisions),/PRIVATE_RESPONSE/);
}));

test('composite causes retain all supporting facts and use the greatest server delay',{timeout:10000},async()=>fixture(policy,async({store,runtime})=>{
  let calls=0;const first=error(429,300),second=error(503,800);
  const result=await Effect.runPromiseExit(runtime.step(context,()=>++calls===1?Effect.failCause(Cause.parallel(Cause.fail(first),Cause.fail(second))):Effect.succeed(null)));
  assert.ok(Exit.isSuccess(result));assert.equal(calls,2);
  const activation=store.listActivations('run-policy')[0]!,record=store.retries('run-policy',activation.key).records[0]!;
  assert.equal(record.delayMs,800);assert.deepEqual(record.causes,[first.failure,second.failure]);assert.ok(activation.startedAt>=record.dueAt!);
  assert.equal(activation.metadata.failureCauses,undefined);
  assert.deepEqual(store.attempts('run-policy',activation.key).records[0]!.metadata.failureCauses,[first.failure,second.failure]);
  assert.deepEqual((store.events('run-policy').find(e=>e.type==='retry.scheduled')!.payload as any).causes,record.causes);
}));

test('one excluded status in a composite cause denies the whole automatic retry',async()=>fixture(policy,async({store,runtime})=>{
  let calls=0;const result=await Effect.runPromiseExit(runtime.step(context,()=>{calls++;return Effect.failCause(Cause.parallel(Cause.fail(error(429)),Cause.fail(error(401))));}));
  assert.ok(Exit.isFailure(result));assert.equal(calls,1);assert.equal(store.retries('run-policy',store.listActivations('run-policy')[0]!.key).records.length,0);
  assert.deepEqual((store.listActivations('run-policy')[0]!.metadata.failureCauses as any[]).map(cause=>cause.providerResponse.status),[429,401]);
  const records=store.listActivations('run-policy'),run=store.get('run-policy');
  assert.deepEqual(graphSnapshot(run,records).graphs[0]!.nodes[0]!.activations[0]!.failureCauses!.map(cause=>cause.providerResponse?.status),[429,401]);
  assert.match(monitorBody(run,records,{view:'history'}).join('\n'),/HTTP 429.*HTTP 401/);
}));

test('cause persistence rolls back atomically; reopening and replacing ownership retain the chosen server delay',async()=>fixture({...policy,delayMs:1},async({store,filename,token})=>{
  const activation=store.beginActivation('run-policy',token,context,{kind:'agent',sideEffect:true}),causes=[error(429,60000).failure,error(503,90000).failure],db=new DatabaseSync(filename);
  try {
    db.exec("CREATE TRIGGER deny_causes BEFORE INSERT ON workflow_retry_causes BEGIN SELECT RAISE(ABORT,'reject causes'); END");
    assert.throws(()=>store.failActivation('run-policy',token,activation.key,'Failed',causes[0],{retryEligible:true,retryCauses:causes}),/reject causes/);
    assert.equal(store.getActivation('run-policy',activation.key)!.status,'running');assert.equal(store.retries('run-policy',activation.key).records.length,0);db.exec('DROP TRIGGER deny_causes');
    store.failActivation('run-policy',token,activation.key,'Failed',causes[0],{retryEligible:true,retryCauses:causes});
    const before=store.retries('run-policy',activation.key).records[0]!;assert.equal(before.delayMs,90000);
    store.markInterrupted('run-policy',token,'Simulated supervisor loss');
    const reopened=new RunStore(filename);
    try{const replacement=reopened.reserveLaunch('run-policy');assert.deepEqual(reopened.scheduledRetry('run-policy',activation.key),before);assert.throws(()=>reopened.beginActivation('run-policy',replacement.token,context,{kind:'agent',sideEffect:true}),RetryNotReady);
      assert.throws(()=>reopened.beginActivation('run-policy',token,context,{kind:'agent',sideEffect:true}),/Stale/);
      reopened.requestControl('run-policy','cancel');reopened.finish('run-policy',replacement.token,{status:'cancelled'});assert.equal(reopened.scheduledRetry('run-policy',activation.key),undefined);
    }finally{reopened.close();}
  }finally{db.close();}
}));
