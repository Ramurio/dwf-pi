import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { RunStore } from "../src/run-store.js";
import { RunController } from "../src/run-controller.js";
import { WorkflowService } from "../src/service.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { startGraphServer } from "../src/graph-view/server.js";
import { summarizeUsage } from "../src/usage.js";
// @ts-expect-error Browser module is checked separately with checkJs.
import { AttemptPages } from "../src/graph-view/usage-pages.js";

const flow={schemaVersion:1,id:"history",name:"Attempt history",revision:1,entryGraph:"main",graphs:{main:{entry:"done",nodes:[{id:"done",kind:"end",value:{op:"literal",value:null}}],edges:[]}}};
const context={graphId:"main",nodeId:"done",scope:["graph","main"],visit:0};
async function fixture(work:(store:RunStore,filename:string,directory:string)=>Promise<void>) {
  const directory=await mkdtemp(join(tmpdir(),"dynamicwf-attempts-")),filename=join(directory,"state.sqlite"),store=new RunStore(filename);
  try {const plan=await prepareExecutionPlan(flow,{cwd:directory,availableModels:[]});store.create({id:"run-history",plan,input:null,cwd:directory});await work(store,filename,directory);}
  finally {store.close();await rm(directory,{recursive:true,force:true});}
}
test("replacement archives complete original records atomically; current observation is separate from immutable pages",async()=>fixture(async(store,filename)=>{
  const {token}=store.reserveLaunch("run-history");
  const first=store.beginActivation("run-history",token,context,{kind:"end",sideEffect:false});
  store.setActivationMetadata("run-history",token,first.key,{note:"first",workerToken:"private-worker-fence"});
  store.failActivation("run-history",token,first.key,"original failure");
  const original=store.getActivation("run-history",first.key)!;
  const db=new DatabaseSync(filename);
  try {
    db.exec("CREATE TRIGGER reject_attempt BEFORE INSERT ON workflow_run_events WHEN NEW.type='activation.started' BEGIN SELECT RAISE(ABORT,'injected attempt failure'); END");
    assert.throws(()=>store.beginActivation("run-history",token,context,{kind:"end",sideEffect:false}),/injected attempt failure/);
    assert.equal(store.attempts("run-history",first.key).archived,0);assert.deepEqual(store.getActivation("run-history",first.key),original);
    db.exec("DROP TRIGGER reject_attempt");
  } finally {db.close();}
  store.beginActivation("run-history",token,context,{kind:"end",sideEffect:false});
  store.setActivationMetadata("run-history",token,first.key,{note:"second"});
  store.failActivation("run-history",token,first.key,"second failure");
  store.beginActivation("run-history",token,context,{kind:"end",sideEffect:false});
  const page=store.attempts("run-history",first.key,0,1);
  const {accounting:_,...archived}=page.records[0]!;assert.deepEqual(archived,original);
  assert.equal(page.current.attempt,3);assert.equal(page.hasMore,true);assert.equal(page.missingArchived,0);
  store.completeActivation("run-history",token,first.key,{result:42});
  const next=store.attempts("run-history",first.key,page.nextAfter,1);
  assert.equal(next.records[0]!.error,"second failure");assert.equal(next.current.status,"succeeded");assert.deepEqual(next.current.output,{result:42});
  assert.deepEqual(store.attempts("run-history",first.key,0,1).records,page.records);
  const end=store.attempts("run-history",first.key,next.nextAfter,1);assert.equal(end.records.length,0);assert.equal(end.nextAfter,2);assert.equal(end.hasMore,false);
  const before=store.events("run-history"),service=new WorkflowService(filename),server=await startGraphServer(filename,"run-history");
  try {
    const result=await service.dispatch("run.attempts",{id:"run-history",key:first.key,limit:1}) as any;
    assert.equal(result.records[0].metadata.note,"first");assert.doesNotMatch(JSON.stringify(result),/ownerToken|workerToken|private-worker-fence/);
    const browser=await(await fetch(`${server.url}attempts?key=${encodeURIComponent(first.key)}`)).json() as any;
    assert.equal(browser.records.length,2);assert.equal(browser.current.attempt,3);assert.doesNotMatch(JSON.stringify(browser),/ownerToken|workerToken/);
    assert.deepEqual(store.events("run-history"),before);
    await assert.rejects(service.dispatch("run.attempts",{id:"run-history",key:first.key,limit:0}),/cursor or limit/);
    await assert.rejects(service.dispatch("run.attempts",{id:"run-history",key:"unknown"}),/not found/);
  } finally {await server.close();service.close();}
}));

test("each attempt has its own SDK accounting while activation totals retain all reports",async()=>fixture(async(store,filename)=>{
  const {token}=store.reserveLaunch("run-history");
  const first=store.beginActivation("run-history",token,context,{kind:"agent",sideEffect:false});
  store.startUsage("run-history",token,first.key);store.recordUsage("run-history",token,first.key,"1",{input:5,output:3,totalTokens:8},"error");
  store.settleUsage("run-history",token,first.key,false);store.failActivation("run-history",token,first.key,"transport stopped");
  store.beginActivation("run-history",token,context,{kind:"agent",sideEffect:false});
  store.startUsage("run-history",token,first.key);store.recordUsage("run-history",token,first.key,"1",{input:10,output:2,totalTokens:12},"stop");
  store.settleUsage("run-history",token,first.key,true);store.completeActivation("run-history",token,first.key,{result:"done"});
  const page=store.attempts("run-history",first.key);
  assert.equal(page.records[0]!.accounting.usage!.totalTokens,8);assert.equal(page.records[0]!.accounting.complete,false);
  assert.equal(page.current.accounting.usage!.totalTokens,12);assert.equal(page.current.accounting.complete,true);
  assert.equal(summarizeUsage(store.listActivations("run-history")).totalTokens,20);
  const service=new WorkflowService(filename);
  try {const result=await service.dispatch("run.attempts",{id:"run-history",key:first.key}) as any;assert.equal(result.current.metadata.usage,undefined);assert.equal(result.current.accounting.usage.totalTokens,12);}finally{service.close();}
}));

test("legacy missing attempts stay explicitly unknown and immutable archives separate scope and visit identities",async()=>fixture(async(store,filename)=>{
  const {token}=store.reserveLaunch("run-history");
  const a=store.beginActivation("run-history",token,context,{kind:"end",sideEffect:false});store.failActivation("run-history",token,a.key,"legacy");
  const db=new DatabaseSync(filename);try{db.prepare("UPDATE workflow_activations SET attempt=4 WHERE run_id=? AND activation_key=?").run("run-history",a.key);}finally{db.close();}
  assert.equal(store.attempts("run-history",a.key).missingArchived,3);
  store.beginActivation("run-history",token,context,{kind:"end",sideEffect:false});
  const page=store.attempts("run-history",a.key);assert.equal(page.records[0]!.attempt,4);assert.equal(page.missingArchived,3);assert.equal(page.current.accounting.usage,null);
  for(const other of [{...context,visit:1},{...context,scope:["graph","main","map","1"]}]) {
    const record=store.beginActivation("run-history",token,other,{kind:"end",sideEffect:false});assert.equal(store.attempts("run-history",record.key).totalAttempts,1);assert.equal(store.attempts("run-history",record.key).records.length,0);
  }
}));

test("attempt browser paging never caches the current attempt as an immutable historical row",async()=>{
  const pages=new AttemptPages(),id=JSON.stringify(["run","key"]);
  await pages.loadAttempts(id,async()=>({records:[],current:{attempt:1,status:"running"},nextAfter:0,hasMore:false,missingArchived:0}));
  assert.equal(pages.get(id).reports.length,0);
  await pages.loadAttempts(id,async(_id:string,cursor:number)=>{assert.equal(cursor,0);return{records:[{attempt:1,status:"interrupted"}],current:{attempt:2,status:"running"},nextAfter:1,hasMore:false,missingArchived:0};});
  await pages.loadAttempts(id,async()=>{throw Error("connection lost");});assert.equal(pages.get(id).reports.length,1);assert.equal(pages.snapshots.get(id).current.status,"running");
  pages.get("another-key");
  await pages.loadAttempts(id,async(_id:string,cursor:number)=>{assert.equal(cursor,1);return{records:[],current:{attempt:2,status:"succeeded"},nextAfter:1,hasMore:false,missingArchived:0};});
  assert.equal(pages.get(id).reports.length,1);assert.equal(pages.snapshots.get(id).current.status,"succeeded");assert.equal(pages.get("another-key").reports.length,0);
});

test("real supervisor recovery preserves interrupted wait details without repeating a completed check",{timeout:25_000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),"dynamicwf-attempt-recovery-")),c=new RunController(join(directory,"state.sqlite"));let id:string|undefined;
  async function wait(status:string){const deadline=Date.now()+15_000;for(;;){const r=c.observe(id!).run;if(r.status===status)return r;if(r.status==="failed")throw Error(r.error);if(Date.now()>deadline)throw Error(`Waiting for ${status}: ${r.status}`);await sleep(40);}}
  try {
    id=(await c.start({...flow,graphs:{main:{entry:"write",nodes:[
      {id:"write",kind:"check",command:process.execPath,args:["-e","require('node:fs').appendFileSync('effects','once')"]},
      {id:"answer",kind:"await",reason:{op:"literal",value:"Original reason"},input:{op:"literal",value:{target:42}},responseSchema:{type:"object"}},
      ...flow.graphs.main.nodes],edges:[{from:"write",to:"answer"},{from:"answer",to:"done"}]} }},null,directory)).id;
    const waiting=await wait("waiting"),request=c.store.waits(id)[0]!;process.kill(waiting.supervisorPid!,"SIGKILL");await wait("interrupted");
    const interrupted=c.store.getActivation(id,request.key)!;
    await c.resolve(id,request.id,{answer:true});await wait("succeeded");
    const page=c.store.attempts(id,request.key),{accounting:_,...old}=page.records[0]!;
    assert.deepEqual(old,interrupted);assert.equal(old.metadata.waitReason,"Original reason");assert.equal(page.current.attempt,2);assert.equal(page.current.status,"succeeded");assert.equal(page.missingArchived,0);
    assert.equal(await readFile(join(directory,"effects"),"utf8"),"once");
    const check=c.store.listActivations(id).find(a=>a.kind==="check")!;assert.equal(c.store.attempts(id,check.key).totalAttempts,1);
  }finally{if(id){await c.control(id,"cancel");const deadline=Date.now()+8_000;while(!["succeeded","failed","cancelled"].includes(c.observe(id).run.status)){if(Date.now()>deadline)throw Error("Cleanup timeout");await sleep(40);}}c.close();await rm(directory,{recursive:true,force:true});}
});
