/** Disposable exact-plan browser fixture. No model calls or user journal writes. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { WorkflowService } from "../src/service.js";
import { RunController } from "../src/run-controller.js";
import { startGraphServer } from "../src/graph-view/server.js";
import type { PreparedExecution } from "../src/execution-types.js";

const directory=await mkdtemp(join(tmpdir(),"dynamicwf-ui-prepared-")),filename=join(directory,"state.sqlite");
const service=new WorkflowService(filename,{cwd:directory,availableModels:[]}),controller=new RunController(filename);
const node={id:"done",kind:"finish",decision:"accepted",reason:{op:"literal",value:"Исполнен подготовленный snapshot ревизии 2."},evidence:{op:"literal",value:[]},value:{op:"literal",value:"original"}};
await service.dispatch("workflow.create",{id:"ui-prepared",name:"UI QA · точный запуск подготовленного плана"});
await service.dispatch("workflow.patch",{id:"ui-prepared",expectedRevision:1,operations:[{op:"addNode",graphId:"main",node}]});
const p=await service.dispatch("workflow.prepare",{id:"ui-prepared"}) as PreparedExecution;
await service.dispatch("workflow.patch",{id:"ui-prepared",expectedRevision:2,operations:[{op:"replaceNode",graphId:"main",node:{...node,decision:"rejected",reason:{op:"literal",value:"Это новый draft. Он не должен исполняться."}}}]});
const request={preparedId:p.preparedId,idempotencyKey:"browser-fixture",input:null};
const run=await service.dispatch("run.start",request) as {id:string};
assert.equal((await service.dispatch("run.start",request) as {id:string}).id,run.id);
const viewer=await startGraphServer(filename,run.id);
process.stdout.write(JSON.stringify({url:viewer.url,directory,runId:run.id,preparedId:p.preparedId,planHash:p.planHash,pid:process.pid})+"\n");
let closing=false;
async function close() {
  if(closing)return;closing=true;
  await controller.control(run.id,"cancel");
  for(;;) {const state=controller.observe(run.id);if(["succeeded","failed","cancelled"].includes(state.run.status)&&!state.workersAlive)break;await sleep(50);}
  await viewer.close();service.close();controller.close();await rm(directory,{recursive:true,force:true});
}
process.on("SIGINT",()=>{void close();});process.on("SIGTERM",()=>{void close();});
