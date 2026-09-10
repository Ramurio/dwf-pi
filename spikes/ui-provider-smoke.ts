/** Native SDK transport against an offline HTTP fixture, persisted through JournalRuntime. */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect, Exit } from "effect";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { RunStore } from "../src/run-store.js";
import { JournalRuntime, describeFailureCause } from "../src/run-runtime.js";
import { executePiWorker } from "../src/pi-worker.js";
import { startGraphServer } from "../src/graph-view/server.js";
const directory=await mkdtemp(join(tmpdir(),"dynamicwf-ui-provider-")),filename=join(directory,"state.sqlite"),store=new RunStore(filename),id="run-provider-qa";
const modelRuntime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
modelRuntime.registerProvider("offline-provider",{api:"openai-responses",baseUrl:"https://offline.invalid/v1",apiKey:"OFFLINE",models:[{id:"fixture",name:"Fixture",reasoning:false,input:["text"],contextWindow:10000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
const plan=await prepareExecutionPlan({schemaVersion:1,id:"provider_qa",name:"UI QA · HTTP-ошибка провайдера",revision:1,entryGraph:"main",graphs:{main:{entry:"worker",nodes:[{id:"worker",kind:"agent",role:"general",task:{op:"literal",value:"Offline HTTP fixture"},config:{tools:[],permission:"read-only"}},{id:"done",kind:"end",value:{op:"literal",value:null}}],edges:[{from:"worker",to:"done"}]}}},{cwd:directory,availableModels:[{provider:"offline-provider",id:"fixture",thinkingLevels:["off"]}]});
store.create({id,plan,input:null,cwd:directory});const launch=store.reserveLaunch(id),runtime=new JournalRuntime(store,launch.run,launch.token,directory);
const exit=await Effect.runPromiseExit(runtime.step({graphId:"main",nodeId:"worker",scope:["graph","main"],visit:0},()=>Effect.tryPromise({try:async()=>{
  const key=store.listActivations(id)[0]!.key;store.startUsage(id,launch.token,key);
  await executePiWorker({version:1,config:plan.agents.main!.worker!,task:"Offline HTTP fixture",input:null,cwd:directory,resourceDirectory:join(directory,"resources"),sessionDirectory:join(directory,"sessions")},{modelRuntime,
    providerFetch:async()=>new Response(JSON.stringify({error:{message:"Private fixture response body"}}),{status:429,headers:{"retry-after":"12"}}),
    onEvent(event){if(event.type==="usage.report")store.recordUsage(id,launch.token,key,String(event.reportId),event.usage,String(event.stopReason));else if(event.type==="usage.settled")store.settleUsage(id,launch.token,key,event.complete===true);},
  });return null;
},catch:error=>error as Error})));
if(!Exit.isFailure(exit))throw Error("Expected fixture failure");
const failure=describeFailureCause(exit.cause);store.finish(id,launch.token,{status:"failed",error:failure.message,failure:{...failure,effects:"unknown"}});
const viewer=await startGraphServer(filename,id);
process.stdout.write(JSON.stringify({url:viewer.url,directory,runId:id,pid:process.pid})+"\n");
let closing=false;async function close(){if(closing)return;closing=true;await viewer.close();store.close();await rm(directory,{recursive:true,force:true});}
process.on("SIGINT",()=>{void close();});process.on("SIGTERM",()=>{void close();});
