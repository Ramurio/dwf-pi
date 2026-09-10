/** Actual detached collect/await run in a disposable journal, without inference. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { RunController } from "../src/run-controller.js";
import { startGraphServer } from "../src/graph-view/server.js";
const directory=await mkdtemp(join(tmpdir(),"dynamicwf-ui-collect-")),filename=join(directory,"state.sqlite"),controller=new RunController(filename);
const run=await controller.start({schemaVersion:1,id:"ui-collect",name:"UI QA · сбор результатов с ошибками",revision:1,entryGraph:"main",graphs:{
  main:{entry:"council",nodes:[{id:"council",kind:"parallel",failurePolicy:"collect",children:[{id:"failed",graphId:"failed",input:{op:"literal",value:{}}},{id:"review",graphId:"review",input:{op:"literal",value:null}},{id:"waiting",graphId:"waiting",input:{op:"literal",value:null}}]},
    {id:"done",kind:"finish",decision:"inconclusive",reason:{op:"literal",value:"Одна ветка завершилась технической ошибкой."},evidence:{op:"literal",value:[]},value:{op:"ref",path:["nodes","council"]}}],edges:[{from:"council",to:"done"}]},
  failed:{entry:"missing",nodes:[{id:"missing",kind:"end",value:{op:"ref",path:["input","requiredEvidence"]}}],edges:[]},
  review:{entry:"verdict",nodes:[{id:"verdict",kind:"end",value:{op:"literal",value:{decision:"request_changes",summary:"Есть замечания к результату"}}}],edges:[]},
  waiting:{entry:"answer",nodes:[{id:"answer",kind:"await",reason:{op:"literal",value:"Завершить проверку оставшейся ветки"},input:{op:"literal",value:null},responseSchema:{type:"object"}},
    {id:"done",kind:"end",value:{op:"literal",value:{decision:"approve"}}}],edges:[{from:"answer",to:"done"}]},
}},null,directory);
const viewer=await startGraphServer(filename,run.id);
process.stdout.write(JSON.stringify({url:viewer.url,directory,runId:run.id,pid:process.pid})+"\n");
let closing=false;
async function close(){if(closing)return;closing=true;await controller.control(run.id,"cancel");
  for(;;){const observed=controller.observe(run.id);if(["succeeded","failed","cancelled"].includes(observed.run.status)&&!observed.workersAlive)break;await sleep(50);}
  await viewer.close();controller.close();await rm(directory,{recursive:true,force:true});}
process.on("SIGINT",()=>{void close();});process.on("SIGTERM",()=>{void close();});
