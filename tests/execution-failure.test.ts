import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { executionFailure, ExecutionFailure, failureRecord, parseExecutionFailure } from "../src/execution-failure.js";
import { runCheckProcess, runPiProcess } from "../src/process-client.js";
import type { PiWorkerRequest } from "../src/execution-types.js";
import { RunController } from "../src/run-controller.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { WorkflowService } from "../src/service.js";
import { startGraphServer } from "../src/graph-view/server.js";

const flow={schemaVersion:1,id:"failure",name:"Structured failure",revision:1,entryGraph:"main",graphs:{main:{entry:"work",nodes:[{id:"work",kind:"check",command:"/nonexistent/dynamicwf-command",args:[]},{id:"done",kind:"end",value:{op:"literal",value:true}}],edges:[{from:"work",to:"done"}]}}};
test("failure protocol is closed, rejects accessors and does not infer typed facts from plain errors",()=>{
  const failure=executionFailure("output","output","unknown","Invalid result").failure;
  assert.deepEqual(parseExecutionFailure(JSON.parse(JSON.stringify(failure))),failure);
  for(const value of [{...failure,version:2},{...failure,code:"rate_limit"},{...failure,effects:"safe-to-retry"},{...failure,extra:true},{...failure,message:""}])assert.equal(parseExecutionFailure(value),undefined);
  let inspected=false;assert.equal(parseExecutionFailure({...failure,get message(){inspected=true;return "bad";}}),undefined);assert.equal(inspected,false);
  const fallback={code:"unknown" as const,phase:"execution" as const,effects:"unknown" as const,message:"Unknown cause"};
  assert.deepEqual(failureRecord({message:"submit_result invalid",failure},fallback),{version:1,...fallback});
});
test("command admission and process loss carry different effect certainty; nonzero exits remain graph data",async()=>{
  await assert.rejects(runCheckProcess("/nonexistent/dynamicwf-command",[],process.cwd()),(error:unknown)=>{assert.ok(error instanceof ExecutionFailure);assert.equal(error.failure.code,"process");assert.equal(error.failure.effects,"not-started");return true;});
  await assert.rejects(runCheckProcess(process.execPath,["-e","process.kill(process.pid,'SIGKILL')"],process.cwd()),(error:unknown)=>{assert.ok(error instanceof ExecutionFailure);assert.equal(error.failure.code,"process");assert.equal(error.failure.effects,"unknown");return true;});
  assert.deepEqual(await runCheckProcess(process.execPath,["-e","process.exitCode=7"],process.cwd()),{exitCode:7,stdout:"",stderr:""});
});
test("malformed worker stdout is a protocol failure without raw diagnostic leakage",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"dynamicwf-protocol-failure-")),preload=join(directory,"preload.cjs"),previous=process.env.NODE_OPTIONS;
  const secret="PRIVATE_HEADER_MUST_NOT_LEAK";
  await writeFile(preload,`process.stdout.write(${JSON.stringify(secret+'\n')});setTimeout(()=>process.exit(7),100);`);
  try {process.env.NODE_OPTIONS=`--require=${preload}`;await assert.rejects(runPiProcess({version:999,cwd:directory} as unknown as PiWorkerRequest),(error:unknown)=>{
    assert.ok(error instanceof ExecutionFailure);assert.equal(error.failure.code,"protocol");assert.equal(error.failure.effects,"unknown");assert.doesNotMatch(error.message,new RegExp(secret));return true;
  });}finally{if(previous===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=previous;await rm(directory,{recursive:true,force:true});}
});
test("a command process error after admission cannot be reported as not-started",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"dynamicwf-postspawn-failure-")),preload=join(directory,"preload.cjs"),previous=process.env.NODE_OPTIONS;
  await writeFile(preload,`if(process.argv[1]?.endsWith('check-worker-process.ts')) {
    const cp=require('node:child_process'),original=cp.spawn;
    cp.spawn=function(...args){const child=original(...args);child.once('spawn',()=>setImmediate(()=>{const e=Error('injected post-admission failure');e.code='EPOSTSPAWN';child.emit('error',e);child.kill('SIGKILL');}));return child;};
    require('node:module').syncBuiltinESMExports();
  }`);
  try {process.env.NODE_OPTIONS=`--require=${preload}`;await assert.rejects(runCheckProcess(process.execPath,["-e","setTimeout(()=>{},500)"],directory),(error:unknown)=>{
    assert.ok(error instanceof ExecutionFailure);assert.equal(error.failure.code,"process");assert.equal(error.failure.phase,"execution");assert.equal(error.failure.effects,"unknown");return true;
  });}finally{if(previous===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=previous;await rm(directory,{recursive:true,force:true});}
});
test("runtime, journal, public API and browser preserve typed causes without claiming a whole run was read-only",{timeout:20_000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),"dynamicwf-failure-run-")),filename=join(directory,"state.sqlite"),c=new RunController(filename),s=new WorkflowService(filename);let id:string|undefined;
  try {
    id=(await c.start(flow,null,directory)).id;
    const deadline=Date.now()+15000;while(c.observe(id).run.status!=="failed"){if(Date.now()>deadline)throw Error("Failed run timeout");await sleep(40);}
    const run=c.store.get(id),activation=c.store.listActivations(id).find(a=>a.kind==="check")!;
    assert.equal(run.failure!.code,"process");assert.equal(run.failure!.effects,"unknown");
    const failure=parseExecutionFailure(activation.metadata.failure)!;assert.equal(failure.code,"process");assert.equal(failure.effects,"not-started");
    assert.deepEqual((await s.dispatch("run.status",{id}) as any).failure,run.failure);
    const server=await startGraphServer(filename,id);
    try {const snapshot=await(await fetch(server.url+"snapshot")).json() as any;assert.deepEqual(snapshot.failure,run.failure);assert.deepEqual(snapshot.graphs[0].nodes[0].activations[0].failure,failure);}finally{await server.close();}
    assert.equal(c.store.events(id).some(e=>e.type==="activation.failed"&&JSON.stringify(e.payload).includes('"not-started"')),true);
  }finally{if(id)await c.control(id,"cancel");s.close();c.close();await rm(directory,{recursive:true,force:true});}
});
test("failure and state roll back together; replay clears current failure but retains it in the archived attempt",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"dynamicwf-failure-store-")),filename=join(directory,"state.sqlite"),c=new RunController(filename),db=new DatabaseSync(filename);
  try {
    const plan=await prepareExecutionPlan(flow,{cwd:directory,availableModels:[]});c.store.create({id:"run-record",plan,input:null,cwd:directory});const {token}=c.store.reserveLaunch("run-record");
    const context={graphId:"main",nodeId:"done",scope:["graph","main"],visit:0},a=c.store.beginActivation("run-record",token,context,{kind:"end",sideEffect:false});
    const failure=executionFailure("expression","execution","read-only","Missing input").failure;
    db.exec("CREATE TRIGGER reject_failure BEFORE INSERT ON workflow_run_events WHEN NEW.type='activation.failed' BEGIN SELECT RAISE(ABORT,'failure event rejected'); END");
    assert.throws(()=>c.store.failActivation("run-record",token,a.key,"Missing input",failure),/event rejected/);assert.equal(c.store.getActivation("run-record",a.key)!.metadata.failure,undefined);
    db.exec("DROP TRIGGER reject_failure");c.store.failActivation("run-record",token,a.key,"Missing input",failure);
    c.store.beginActivation("run-record",token,context,{kind:"end",sideEffect:false});c.store.completeActivation("run-record",token,a.key,null);
    const page=c.store.attempts("run-record",a.key);assert.equal(page.current.metadata.failure,undefined);assert.deepEqual(page.records[0]!.metadata.failure,failure);
  }finally{db.close();c.close();await rm(directory,{recursive:true,force:true});}
});
