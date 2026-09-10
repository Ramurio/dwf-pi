import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, InMemoryModelsStore, createAssistantMessageEventStream, type Api, type AssistantMessage } from "@earendil-works/pi-ai";
import { executePiWorker } from "../src/pi-worker.js";
import type { PiWorkerOptions } from "../src/pi-worker.js";
import type { PiWorkerRequest } from "../src/execution-types.js";
import { ExecutionFailure, parseExecutionFailure } from "../src/execution-failure.js";
import { parseProviderResponse, retryAfterMs } from "../src/provider-response.js";
import { Effect, Exit } from "effect";
import { RunStore } from "../src/run-store.js";
import { JournalRuntime, describeFailureCause } from "../src/run-runtime.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { WorkflowService } from "../src/service.js";
import { startGraphServer } from "../src/graph-view/server.js";
import { renderDashboard } from "../src/monitor.js";
import { renderRun } from "../src/terminal.js";

const secret="PRIVATE_PROVIDER_BODY_HEADER_TOKEN";
const token=`dummy.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'offline-account'}})).toString('base64url')}.dummy`;
async function fixture(api:Api,work:(request:PiWorkerRequest,runtime:ModelRuntime)=>Promise<void>) {
  const directory=await mkdtemp(join(tmpdir(),'dynamicwf-http-'));
  try {
    const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
    runtime.registerProvider('offline-http',{api,baseUrl:'https://offline.invalid/v1',apiKey:token,models:[{id:'offline-model',name:'Offline',reasoning:false,input:['text'],contextWindow:10000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
    const request:PiWorkerRequest={version:1,cwd:directory,resourceDirectory:join(directory,'resources'),sessionDirectory:join(directory,'sessions'),task:'Return answer 42',input:null,config:{model:{provider:'offline-http',id:'offline-model'},thinking:'off',tools:[],systemPrompt:'Use submit_result.',skills:[],session:'fresh',permission:'read-only',outputSchema:{type:'object',properties:{answer:{type:'integer'}},required:['answer'],additionalProperties:false}}};
    await work(request,runtime);
  } finally { await rm(directory,{recursive:true,force:true}); }
}
async function failed(request:PiWorkerRequest,options:PiWorkerOptions) {
  let result:ExecutionFailure|undefined;
  await assert.rejects(executePiWorker(request,options),(error:unknown)=>{assert.ok(error instanceof ExecutionFailure);result=error;return true;});
  assert.equal(result!.failure.code,'provider');return result!.failure;
}

test('HTTP facts are closed numeric data; Retry-After accepts valid seconds/date without leaking arbitrary headers',()=>{
  const now=Date.parse('Thu, 10 Sep 2026 12:00:00 GMT');
  assert.equal(retryAfterMs('12',now),12000);assert.equal(retryAfterMs('0',now),0);
  assert.equal(retryAfterMs('Thu, 10 Sep 2026 12:00:07 GMT',now),7000);
  assert.equal(retryAfterMs('Thu, 10 Sep 2026 11:00:00 GMT',now),0);
  for(const value of ['-1','1.2','Infinity','999999999999999999999','Thu, 99 Sep 2026 12:00:00 GMT','Fri, 10 Sep 2026 12:00:07 GMT',secret])assert.equal(retryAfterMs(value,now),undefined);
  for(const value of [{status:99},{status:600},{status:429.5},{status:429,headers:secret},{status:429,retryAfterMs:-1},{status:429,retryAfterMs:undefined},{status:429,[Symbol('private')]:secret}])assert.equal(parseProviderResponse(value),undefined);
  let touched=false;assert.equal(parseProviderResponse({get status(){touched=true;return 429;}}),undefined);assert.equal(touched,false);
  const cause={version:1,code:'provider',phase:'execution',effects:'read-only',message:'Provider failed',providerResponse:{status:429,retryAfterMs:12000}};
  assert.deepEqual(parseExecutionFailure(cause),cause);
  assert.equal(parseExecutionFailure({...cause,code:'output'}),undefined);
  assert.equal(parseExecutionFailure({...cause,providerResponse:{status:429,authorization:secret}}),undefined);
  const error=new ExecutionFailure(cause as any);assert.ok(Object.isFrozen(error.failure.providerResponse));
});

test('actual native Codex HTTP errors retain status and delay with one HTTP attempt and no WebSocket fallback',{timeout:15000},async()=>{
  for(const status of [200,401,403,429,503]) await fixture('openai-codex-responses',async(request,runtime)=>{
    let requests=0;const events:unknown[]=[];
    const result=await failed(request,{modelRuntime:runtime,onEvent:event=>events.push(event),providerFetch:async()=>{
      requests++;return new Response(JSON.stringify({error:{message:secret}}),{status,headers:{'retry-after':'7','x-private':secret,'set-cookie':secret}});
    }});
    assert.equal(requests,1);assert.deepEqual(result.providerResponse,{status,retryAfterMs:7000});
    assert.equal(result.effects,'read-only');assert.doesNotMatch(JSON.stringify({result,events}),new RegExp(secret));
  });
});

test('actual OpenAI SDK rejection before onResponse still preserves the HTTP error',{timeout:10000},async()=>fixture('openai-responses',async(request,runtime)=>{
  let calls=0;const result=await failed(request,{modelRuntime:runtime,providerFetch:async()=>{calls++;return new Response(JSON.stringify({error:{message:secret,type:'server_error'}}),{status:503,headers:{'retry-after':'2'}});}});
  assert.equal(calls,1);assert.deepEqual(result.providerResponse,{status:503,retryAfterMs:2000});assert.doesNotMatch(JSON.stringify(result),new RegExp(secret));
}));

test('a completed HTTP response is not carried over to a later transport failure',{timeout:10000},async()=>fixture('openai-completions',async(request,runtime)=>{
  let calls=0;
  runtime.registerProvider('offline-http',{api:'openai-completions',baseUrl:'https://offline.invalid/v1',apiKey:token,models:[{id:'offline-model',name:'Offline',reasoning:false,input:['text'],contextWindow:10000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],streamSimple(model,_context,options){
    const stream=createAssistantMessageEventStream();void (async()=>{
      const first=++calls===1;
      assert.equal(options?.maxRetries,0);
      if(first)await options?.onResponse?.({status:200,headers:{'retry-after':'99'}},model);
      const message:AssistantMessage={role:'assistant',api:'openai-completions',provider:model.provider,model:model.id,timestamp:Date.now(),content:first?[{type:'toolCall',id:'bad',name:'missing_tool',arguments:{}}]:[],stopReason:first?'toolUse':'error',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      if(first)stream.push({type:'done',reason:'toolUse',message});else stream.push({type:'error',reason:'error',error:message});
    })();return stream;
  }});
  const result=await failed(request,{modelRuntime:runtime});assert.equal(calls,2);assert.equal(result.providerResponse,undefined);
}));

test('actual SDK HTTP failure survives runtime checkpoint, service, browser and terminal projection',async()=>fixture('openai-codex-responses',async(request,modelRuntime)=>{
  const filename=join(request.cwd,'state.sqlite'),store=new RunStore(filename);
  try {
    const plan=await prepareExecutionPlan({schemaVersion:1,id:'http_failure',name:'HTTP failure',revision:1,entryGraph:'main',graphs:{main:{entry:'work',nodes:[{id:'work',kind:'agent',role:'general',task:{op:'literal',value:request.task},config:{tools:[],permission:'read-only'}},{id:'done',kind:'end',value:{op:'literal',value:null}}],edges:[{from:'work',to:'done'}]}}},{cwd:request.cwd,availableModels:[{provider:'offline-http',id:'offline-model',thinkingLevels:['off']}]});
    store.create({id:'run-http',plan,input:null,cwd:request.cwd});const launch=store.reserveLaunch('run-http'),runtime=new JournalRuntime(store,launch.run,launch.token,request.cwd);
    const exit=await Effect.runPromiseExit(runtime.step({graphId:'main',nodeId:'work',scope:['graph','main'],visit:0},()=>Effect.tryPromise({try:async()=>{
      await executePiWorker(request,{modelRuntime,providerFetch:async()=>new Response(JSON.stringify({error:{message:secret}}),{status:429,headers:{'retry-after':'9'}})});return null;
    },catch:error=>error as Error})));
    assert.ok(Exit.isFailure(exit));const failure=describeFailureCause(exit.cause);
    store.finish('run-http',launch.token,{status:'failed',error:failure.message,failure:{...failure,effects:'unknown'}});
    const activation=store.listActivations('run-http')[0]!;
    assert.deepEqual((activation.metadata.failure as any).providerResponse,{status:429,retryAfterMs:9000});
    const service=new WorkflowService(filename),viewer=await startGraphServer(filename,'run-http');
    try {
      const inspected=await service.dispatch('run.inspect',{id:'run-http'}) as any;
      assert.match(JSON.stringify(inspected),/"providerResponse":\{"status":429,"retryAfterMs":9000\}/);
      assert.doesNotMatch(JSON.stringify(inspected),new RegExp(secret));
      const snapshot=await (await fetch(viewer.url+'snapshot')).json() as any;
      assert.deepEqual(snapshot.failure.providerResponse,{status:429,retryAfterMs:9000});
      assert.deepEqual(snapshot.graphs[0].nodes[0].activations[0].failure.providerResponse,{status:429,retryAfterMs:9000});
      assert.match(renderDashboard(store.get('run-http'),[activation],{width:220,height:30}),/HTTP 429.*Retry-After 9000 ms/);
      assert.match(renderRun(store.get('run-http'),[activation]),/HTTP 429.*Retry-After 9000 ms/);
    } finally { service.close();await viewer.close(); }
  } finally { store.close(); }
}));
