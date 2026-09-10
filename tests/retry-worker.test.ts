import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect, Exit } from "effect";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, InMemoryModelsStore, createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { RunStore } from "../src/run-store.js";
import { JournalRuntime } from "../src/run-runtime.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { executePiWorker } from "../src/pi-worker.js";
import { summarizeUsage } from "../src/usage.js";

const provider="dynamicwf-retry-offline",modelId="scripted",context={graphId:'main',nodeId:'work',scope:['graph','main'],visit:0};
function response(content:AssistantMessage['content'],stopReason:AssistantMessage['stopReason']):AssistantMessage {
  return {role:'assistant',api:'openai-completions',provider,model:modelId,timestamp:Date.now(),content,stopReason,
    usage:{input:2,output:3,cacheRead:0,cacheWrite:0,totalTokens:5,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
}
const submit=(answer:unknown)=>response([{type:'toolCall',id:'result',name:'submit_result',arguments:{answer}}],'toolUse');
async function fixture(writer:boolean,reply:(call:number)=>AssistantMessage,work:(f:{store:RunStore;run:()=>Promise<Exit.Exit<any,Error>>;calls:()=>number;directory:string})=>Promise<void>) {
  const directory=await mkdtemp(join(tmpdir(),'dynamicwf-retry-sdk-')),store=new RunStore(join(directory,'state.sqlite'));
  try{
    const modelRuntime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});let calls=0;
    modelRuntime.registerProvider(provider,{api:'openai-completions',baseUrl:'https://offline.invalid',apiKey:'OFFLINE_FIXTURE',models:[{id:modelId,name:modelId,reasoning:false,input:['text'],contextWindow:10000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],streamSimple(){
      const stream=createAssistantMessageEventStream(),message=reply(++calls);
      if(message.stopReason==='error'||message.stopReason==='aborted')stream.push({type:'error',reason:message.stopReason,error:message});
      else if(message.stopReason!=='pending'){stream.push({type:'start',partial:message});stream.push({type:'done',reason:message.stopReason,message});}return stream;
    }});
    const plan=await prepareExecutionPlan({schemaVersion:1,id:'sdk_retry',name:'SDK retry fixture',revision:1,entryGraph:'main',graphs:{main:{entry:'work',nodes:[
      {id:'work',kind:'agent',role:'general',retryPolicy:{codes:['provider','output'],delayMs:0},task:{op:'literal',value:'Offline task'},config:{permission:writer?'workspace-write':'read-only',tools:writer?['write']:[],outputSchema:{type:'object',properties:{answer:{type:'integer'}},required:['answer'],additionalProperties:false}}},
      {id:'done',kind:'end',value:{op:'ref',path:['nodes','work']}},
    ],edges:[{from:'work',to:'done'}]}}},{cwd:directory,availableModels:[{provider,id:modelId,thinkingLevels:['off']}]});
    store.create({id:'run-sdk',plan,input:null,cwd:directory});const launch=store.reserveLaunch('run-sdk'),runtime=new JournalRuntime(store,launch.run,launch.token,directory);
    const run=()=>Effect.runPromiseExit(runtime.step(context,()=>Effect.tryPromise({try:async signal=>{
      const activation=store.listActivations('run-sdk')[0]!;store.startUsage('run-sdk',launch.token,activation.key);
      const result=await executePiWorker({version:1,config:plan.agents.main!.work!,task:'Offline task',input:null,cwd:directory,sessionDirectory:join(directory,'sessions'),resourceDirectory:join(directory,`resources-${activation.attempt}`)}, {signal,modelRuntime,onEvent(event){
        if(event.type==='usage.report')store.recordUsage('run-sdk',launch.token,activation.key,String(event.reportId),event.usage,String(event.stopReason));
        else if(event.type==='usage.settled')store.settleUsage('run-sdk',launch.token,activation.key,event.complete===true);
        else if(event.type==='session.started')store.setActivationMetadata('run-sdk',launch.token,activation.key,{sessionFile:String(event.sessionFile)});
      }});return result.output;
    },catch:error=>error as Error})));
    await work({store,run,calls:()=>calls,directory});
  }finally{store.close();await rm(directory,{recursive:true,force:true});}
}

test('explicit unbounded retry uses six actual SDK invocations and preserves each failed response and attempt accounting',async()=>fixture(false,call=>call<=5?response([],'error'):submit(42),async f=>{
  const result=await f.run();assert.ok(Exit.isSuccess(result));assert.deepEqual(result.value,{answer:42});assert.equal(f.calls(),6);
  const activation=f.store.listActivations('run-sdk')[0]!,page=f.store.attempts('run-sdk',activation.key);
  assert.equal(page.current.attempt,6);assert.equal(page.records.length,5);assert.equal(f.store.retries('run-sdk',activation.key).records.length,5);
  assert.equal(page.current.accounting.usage!.totalTokens,5);assert.equal(page.current.accounting.complete,true);
  assert.ok(page.records.every(r=>r.accounting.usage!.totalTokens===5&&r.accounting.complete===false&&(r.metadata.retry as any).status==='admitted'));
  const reports=f.store.usageReports('run-sdk').reports;assert.deepEqual(reports.map(r=>[r.attempt,r.reportId]),[[1,'1'],[2,'1'],[3,'1'],[4,'1'],[5,'1'],[6,'1']]);
  assert.equal(summarizeUsage(f.store.listActivations('run-sdk')).totalTokens,30);
}));

test('a real SDK write followed by invalid output is never retried by the matching output policy',async()=>fixture(true,call=>call===1?response([{type:'toolCall',id:'write',name:'write',arguments:{path:'artifact.txt',content:'already written'}}],'toolUse'):submit('invalid'),async f=>{
  assert.ok(Exit.isFailure(await f.run()));assert.equal(f.calls(),2);assert.equal(await readFile(join(f.directory,'artifact.txt'),'utf8'),'already written');
  const activation=f.store.listActivations('run-sdk')[0]!;assert.equal(activation.attempt,1);assert.equal((activation.metadata.failure as any).effects,'unknown');
  assert.equal(f.store.retries('run-sdk',activation.key).records.length,0);assert.equal(summarizeUsage(f.store.listActivations('run-sdk')).totalTokens,10);
}));
