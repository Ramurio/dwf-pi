/** Actual detached supervisor with scripted worker IPC faults; no model calls. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { RunController } from "../src/run-controller.js";
import type { RunRecord } from "../src/run-store.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { startGraphServer } from "../src/graph-view/server.js";
const directory=await mkdtemp(join(tmpdir(),"dynamicwf-ui-provider-retry-")),filename=join(directory,"state.sqlite"),controller=new RunController(filename),preload=join(directory,"faults.cjs"),next=join(directory,"next-status");
await writeFile(preload,`if(process.argv[1]?.endsWith('/pi-worker-process.ts')){process.stdin.resume();process.stdin.once('end',()=>{const status=require('node:fs').existsSync(${JSON.stringify(next)})?401:429;const failure={version:1,code:'provider',phase:'execution',effects:'read-only',message:'Scripted worker HTTP failure',providerResponse:{status,...(status===429?{retryAfterMs:5000}:{})}};process.stdout.write(JSON.stringify({type:'error',error:failure.message,failure})+'\\n',()=>process.exit(1));});}`);
const plan=await prepareExecutionPlan({schemaVersion:1,id:"provider_retry_qa",name:"UI QA · HTTP-фильтр и серверная задержка",revision:1,entryGraph:"main",graphs:{main:{entry:"worker",nodes:[{id:"worker",kind:"agent",role:"general",task:{op:"literal",value:"Scripted IPC fixture"},config:{permission:"read-only",tools:[]},retryPolicy:{codes:["provider"],delayMs:100,provider:{statuses:[429,503],retryAfter:"honor"}}},{id:"done",kind:"end",value:{op:"literal",value:null}}],edges:[{from:"worker",to:"done"}]}}},{cwd:directory,availableModels:[{provider:"offline",id:"fixture",thinkingLevels:["off"]}]});
const previous=process.env.NODE_OPTIONS;let run:RunRecord;
try{process.env.NODE_OPTIONS=`--require=${preload}`;run=await controller.startPrepared(plan,null,directory);}finally{if(previous===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=previous;}
for(;;){if(controller.store.listActivations(run.id).some(a=>a.metadata.retry))break;await sleep(30);}
await controller.control(run.id,"pause");for(;;){if(controller.observe(run.id).run.status==="paused")break;await sleep(30);}
await writeFile(next,"");
// A second recorded fixture exercises explanation of a declined composite retry.
const compositePlan=await prepareExecutionPlan({...plan.workflow,id:"composite_retry_qa",name:"UI QA · составная ошибка"},{cwd:directory,availableModels:[{provider:"offline",id:"fixture",thinkingLevels:["off"]}]});
const compositeId="run-composite-retry-qa";controller.store.create({id:compositeId,plan:compositePlan,input:null,cwd:directory});const compositeOwner=controller.store.reserveLaunch(compositeId),activation=controller.store.beginActivation(compositeId,compositeOwner.token,{graphId:"main",nodeId:"worker",scope:["graph","main"],visit:0},{kind:"agent",sideEffect:true});
const causes=[429,401].map(status=>({version:1 as const,code:"provider" as const,phase:"execution" as const,effects:"read-only" as const,message:"Scripted composite cause",providerResponse:{status}}));
controller.store.failActivation(compositeId,compositeOwner.token,activation.key,"Scripted composite failure",causes[0],{retryEligible:false,retryCauses:causes});controller.store.finish(compositeId,compositeOwner.token,{status:"failed",error:"Scripted composite failure",failure:{...causes[0]!,effects:"unknown"}});
const viewer=await startGraphServer(filename,run.id);process.stdout.write(JSON.stringify({url:viewer.url,directory,runId:run.id,pid:process.pid})+"\n");
let closing=false;async function close(){if(closing)return;closing=true;await controller.control(run.id,"cancel");for(;;){const observed=controller.observe(run.id);if(["succeeded","failed","cancelled"].includes(observed.run.status)&&!observed.workersAlive)break;await sleep(50);}await viewer.close();controller.close();await rm(directory,{recursive:true,force:true});}
process.on("SIGINT",()=>{void close();});process.on("SIGTERM",()=>{void close();});
