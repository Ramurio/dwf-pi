/** Actual retry admission and attempt history in a disposable journal; no inference. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { RunController } from "../src/run-controller.js";
import { startGraphServer } from "../src/graph-view/server.js";
const directory=await mkdtemp(join(tmpdir(),"dynamicwf-ui-retry-")),filename=join(directory,"state.sqlite"),controller=new RunController(filename);
const command=join(directory,"available-later");
const run=await controller.start({schemaVersion:1,id:"ui-retry",name:"UI QA · повтор после ошибки запуска",revision:1,entryGraph:"main",graphs:{
  main:{entry:"command",nodes:[{id:"command",kind:"check",command,args:[],retryPolicy:{codes:["process"],delayMs:5000,maxAttempts:2}},
    {id:"done",kind:"finish",decision:"accepted",reason:{op:"literal",value:"Повтор допущен после подтверждённой ошибки до запуска команды"},evidence:{op:"literal",value:[]},value:{op:"ref",path:["nodes","command"]}}],edges:[{from:"command",to:"done"}]},
}},null,directory);
for(;;){if(controller.store.listActivations(run.id).some(a=>a.metadata.retry))break;await sleep(30);}
await controller.control(run.id,"pause");
for(;;){if(controller.observe(run.id).run.status==="paused")break;await sleep(30);}
await writeFile(command,"#!/bin/sh\nprintf x >> marker\n",{mode:0o700});
const viewer=await startGraphServer(filename,run.id);
process.stdout.write(JSON.stringify({url:viewer.url,directory,runId:run.id,pid:process.pid})+"\n");
let closing=false;
async function close(){if(closing)return;closing=true;await controller.control(run.id,"cancel");
  for(;;){const observed=controller.observe(run.id);if(["succeeded","failed","cancelled"].includes(observed.run.status)&&!observed.workersAlive)break;await sleep(50);}
  await viewer.close();controller.close();await rm(directory,{recursive:true,force:true});}
process.on("SIGINT",()=>{void close();});process.on("SIGTERM",()=>{void close();});
