/** Disposable structured-failure browser fixture. No model calls or user journal writes. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { RunController } from "../src/run-controller.js";
import { startGraphServer } from "../src/graph-view/server.js";
const directory=await mkdtemp(join(tmpdir(),"dynamicwf-ui-failure-")),filename=join(directory,"state.sqlite"),controller=new RunController(filename);
const run=await controller.start({schemaVersion:1,id:"ui-failure",name:"UI QA · причина сбоя и состояние действий",revision:1,entryGraph:"main",graphs:{main:{entry:"check",nodes:[
  {id:"check",kind:"check",command:"/nonexistent/dynamicwf-qa-command",args:[]},
  {id:"done",kind:"end",value:{op:"literal",value:null}},
],edges:[{from:"check",to:"done"}]}}},null,directory);
const viewer=await startGraphServer(filename,run.id);
process.stdout.write(JSON.stringify({url:viewer.url,directory,runId:run.id,pid:process.pid})+"\n");
let closing=false;
async function close(){if(closing)return;closing=true;await controller.control(run.id,"cancel");
  for(;;){const state=controller.observe(run.id);if(["succeeded","failed","cancelled"].includes(state.run.status)&&!state.workersAlive)break;await sleep(50);}
  await viewer.close();controller.close();await rm(directory,{recursive:true,force:true});}
process.on("SIGINT",()=>{void close();});process.on("SIGTERM",()=>{void close();});
