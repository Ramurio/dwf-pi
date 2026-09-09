import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { WorkflowService } from "../src/service.js";
import { RunController } from "../src/run-controller.js";
import { RunStore } from "../src/run-store.js";
import { PreparedPlanStore } from "../src/prepared-plans.js";
import type { PreparedExecution } from "../src/execution-types.js";
import type { Edge, Node } from "../src/graph.js";
import { mcpToolDefinitions } from "../src/mcp-tools.js";
import { createOutputValidator } from "../src/output-schema.js";

const done: Node = { id: "done", kind: "end", value: { op: "ref", path: ["input"] } };
const count: Node = { id: "write", kind: "check", command: process.execPath, args: ["-e", "require('node:fs').appendFileSync('effects','one\\n')"] };
const models = [{ provider: "test", id: "frozen", thinkingLevels: ["off"] as const }];
async function author(s: WorkflowService, nodes: Node[] = [done], edges?: Edge[]) {
  await s.dispatch("workflow.create", { id: "sample", name: "Prepared start" });
  await s.dispatch("workflow.patch", { id: "sample", expectedRevision: 1, operations: [
    ...nodes.map(node => ({ op: "addNode", graphId: "main", node })),
    ...(edges ?? nodes.slice(1).map((node, i) => ({ from: nodes[i]!.id, to: node.id }))).map(edge => ({ op: "connect", graphId: "main", edge })),
  ] });
}
async function wait(c: RunController, id: string, status: string) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const run = c.observe(id).run;
    if (run.status === status) return run;
    if (run.status === "failed" && status !== "failed") throw new Error(run.error);
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${status}: ${run.status}`);
    await sleep(40);
  }
}
async function fixture(work: (s: WorkflowService, c: RunController, directory: string, filename: string) => Promise<void>) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "dynamicwf-prepared-"))), filename = join(directory, "state.sqlite");
  const s = new WorkflowService(filename, { cwd: directory, availableModels: models }), c = new RunController(filename);
  try { await work(s, c, directory, filename); }
  finally {
    for (const run of c.store.listRuns()) {
      await c.control(run.id, "cancel");
      const deadline = Date.now() + 10_000;
      while (!['succeeded','failed','cancelled'].includes(c.observe(run.id).run.status)) {
        if (Date.now() > deadline) throw new Error("Prepared start fixture cleanup timeout"); await sleep(40);
      }
    }
    s.close(); c.close(); await rm(directory, { recursive: true, force: true });
  }
}
const prepare = (s: WorkflowService, cwd?: string) => s.dispatch("workflow.prepare", { id: "sample", ...(cwd ? { cwd } : {}) }) as Promise<PreparedExecution>;
const start = (s: WorkflowService, p: PreparedExecution, input: unknown = null, key = "intent-1") =>
  s.dispatch("run.start", { preparedId: p.preparedId, idempotencyKey: key, input }) as Promise<{ id: string; status: string; preparedId: string; planHash: string }>;

test("prepared handles survive clients, draft patches, removed skills and changed model defaults without inference", async () => fixture(async (s,c,directory,filename) => {
  await mkdir(join(directory,"skill"));
  await writeFile(join(directory,"skill","SKILL.md"), "---\ndescription: Frozen test skill\n---\nOriginal instructions");
  await author(s, [ { id: "choose", kind: "branch" },
    { id: "worker", kind: "agent", role: "general", task: { op: "literal", value: "Unused in this test" }, config: { skills: ["skill"] } }, done,
  ], [{ from:"choose",to:"worker",when:{op:"literal",value:false} },{from:"choose",to:"done"},{from:"worker",to:"done"}]);
  const prepared = await prepare(s);
  assert.deepEqual(await prepare(s), prepared);
  await s.dispatch("workflow.patch", { id:"sample", expectedRevision:2, operations:[{op:"replaceNode",graphId:"main",node:{...done,value:{op:"literal",value:"new draft"}}}] });
  await rm(join(directory,"skill"),{recursive:true});
  const other = new WorkflowService(filename,{cwd:directory,availableModels:[],defaultModel:{provider:"missing",id:"missing"}});
  try {
    await assert.rejects(prepare(other),/Model unavailable/);
    assert.deepEqual(await other.dispatch("workflow.prepared",{preparedId:prepared.preparedId}),prepared);
    const run = await start(other,prepared,{old:"snapshot"});
    const completed = await wait(c,run.id,"succeeded");
    assert.deepEqual(completed.output,{old:"snapshot"});
    assert.equal(completed.plan.workflow.revision,2);
    assert.deepEqual(completed.plan.agents.main!.worker!.model,{provider:"test",id:"frozen"});
    assert.equal(completed.plan.agents.main!.worker!.skills[0]!.hash,prepared.plan.agents.main!.worker!.skills[0]!.hash);
    assert.equal(run.planHash,prepared.planHash); assert.equal(run.preparedId,prepared.preparedId);
    assert.equal(c.store.listActivations(run.id).some(a=>a.kind==="agent"),false);
    assert.equal(c.store.listRuns().length,1);
  } finally { other.close(); }
}));

test("workspace is bound and canonicalized; snapshots deduplicate across workspaces", async () => fixture(async(s,c,directory,filename)=>{
  await author(s); await mkdir(join(directory,"other")); await symlink(directory,join(directory,"alias"));
  const a=await prepare(s), alias=await prepare(s,join(directory,"alias")), b=await prepare(s,join(directory,"other"));
  assert.equal(a.preparedId,alias.preparedId); assert.notEqual(a.preparedId,b.preparedId); assert.equal(a.planHash,b.planHash);
  const db=new DatabaseSync(filename);
  try { assert.equal(db.prepare("SELECT COUNT(*) AS n FROM workflow_plan_snapshots").get()!.n,1); } finally { db.close(); }
  const first=await start(s,a); await wait(c,first.id,"succeeded");
  await assert.rejects(start(s,b),/idempotency conflict/);
  for(const fields of [{cwd:a.cwd},{model:{provider:"test",id:"frozen"}},{id:"sample"}])
    await assert.rejects(s.dispatch("run.start",{preparedId:a.preparedId,...fields}),/cannot override/);
  await rename(join(directory,"other"),join(directory,"moved")); await symlink(directory,join(directory,"other"));
  await assert.rejects(start(s,b,null,"redirected"),/different directory/);
  assert.equal(c.store.listRuns().length,1);
}));

test("independent CLI deliveries start one run and perform one write; reordered object keys are the same input", {timeout:30_000}, async()=>fixture(async(s,c,directory,filename)=>{
  await author(s,[count,done]); const p=await prepare(s);
  const cli=fileURLToPath(new URL("../src/cli.ts",import.meta.url));
  async function deliver(input: unknown):Promise<string> {
    const child=spawn(process.execPath,["--import","tsx",cli,"run.start","--store",filename],{stdio:["pipe","pipe","pipe"]});
    let stdout="",stderr=""; child.stdout.on("data",chunk=>stdout+=chunk); child.stderr.on("data",chunk=>stderr+=chunk);
    child.stdin.end(JSON.stringify({preparedId:p.preparedId,idempotencyKey:"concurrent-delivery",input}));
    return new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",code=>{
      try { assert.equal(code,0,stderr+stdout);resolve(JSON.parse(stdout).result.id); } catch(error) {reject(error);}
    });});
  }
  const delivered=await Promise.allSettled([deliver({a:1,b:2}),deliver({b:2,a:1}),deliver({a:1,b:2}),deliver({b:2,a:1})]);
  const ids=delivered.map(r=>{if(r.status==="rejected")throw r.reason;return r.value;});
  assert.equal(new Set(ids).size,1); await wait(c,ids[0]!,"succeeded");
  assert.equal(await readFile(join(directory,"effects"),"utf8"),"one\n");
  assert.equal(c.store.listRuns().length,1);
  assert.equal(c.store.events(ids[0]!).filter(e=>e.type==="run.created").length,1);
  assert.equal(c.store.events(ids[0]!).filter(e=>e.type==="run.reserved").length,1);
}));

test("lost response retry survives a removed workspace and preserves completed output; conflicts do not create runs", async()=>fixture(async(s,c,directory)=>{
  await author(s); const workspace=join(directory,"workspace"); await mkdir(workspace); const p=await prepare(s,workspace);
  const run=await start(s,p,{a:[1,2]}); const finished=await wait(c,run.id,"succeeded"); const events=c.store.events(run.id);
  await rm(workspace,{recursive:true});
  const repeated=await start(s,p,{a:[1,2]}); assert.equal(repeated.id,run.id); assert.equal(repeated.status,"succeeded");
  assert.deepEqual(c.store.get(run.id),finished); assert.deepEqual(c.store.events(run.id),events);
  await assert.rejects(start(s,p,{a:[2,1]}),/idempotency conflict/);
  await assert.rejects(start(s,p,{a:[1,2]},"new-intent"),/ENOENT/);
  assert.deepEqual(await s.dispatch("workflow.prepared",{preparedId:p.preparedId}),p);
  assert.equal(c.store.listRuns().length,1);
}));

test("create and idempotency reservation are atomic with run.created; duplicate creation returns the original", async()=>fixture(async(s,c,directory,filename)=>{
  await author(s);const p=await prepare(s),start={preparedId:p.preparedId,idempotencyKey:"atomic"};
  const input={id:"run-atomic",plan:p.plan,input:null,cwd:directory,start}; const injection=new DatabaseSync(filename);
  try {
    injection.exec("CREATE TRIGGER reject_created BEFORE INSERT ON workflow_run_events WHEN NEW.type='run.created' BEGIN SELECT RAISE(ABORT,'injected event failure'); END");
    assert.throws(()=>c.store.create(input),/injected event failure/);
    assert.equal(c.store.listRuns().length,0); assert.equal(c.store.findStart(start,null),undefined);
    injection.exec("DROP TRIGGER reject_created");
    const first=c.store.create(input); const other=new RunStore(filename);
    try { assert.deepEqual(other.create({...input,id:"run-other"}),first); } finally {other.close();}
    assert.equal(c.store.events(first.id).length,1);
    assert.throws(()=>c.store.create({...input,id:"run-conflict",input:false}),/idempotency conflict/);
    assert.equal(c.store.listRuns().length,1);
  } finally {injection.close();}
}));

test("duplicate start finishes the create gap but never resumes paused, interrupted or terminal work", async()=>fixture(async(s,c,directory)=>{
  await author(s);const p=await prepare(s);
  const request=(key:string)=>({id:`run-${key}`,plan:p.plan,input:null,cwd:directory,start:{preparedId:p.preparedId,idempotencyKey:key}});
  c.store.create(request("gap")); const recovered=await start(s,p,null,"gap"); assert.equal(recovered.id,"run-gap"); await wait(c,recovered.id,"succeeded");
  for(const status of ["paused","interrupted","failed","cancelled"] as const) {
    const run=c.store.create(request(status));
    if(status==="paused"||status==="cancelled") c.store.requestControl(run.id,status==="paused"?"pause":"cancel");
    else {const {token}=c.store.reserveLaunch(run.id); if(status==="interrupted")c.store.markInterrupted(run.id,token,"Simulated missing launcher");else c.store.finish(run.id,token,{status:"failed",error:"Known failure"});}
    const before=c.store.get(run.id),events=c.store.events(run.id);
    assert.equal((await start(s,p,null,status)).id,run.id);
    assert.deepEqual(c.store.get(run.id),before); assert.deepEqual(c.store.events(run.id),events);
  }
}));

test("pending launch reservation is preserved; missing reserved process is observed without implicit restart", async()=>fixture(async(s,c,directory,filename)=>{
  await author(s); const p=await prepare(s);
  c.store.create({id:"run-reserved",plan:p.plan,input:null,cwd:directory,start:{preparedId:p.preparedId,idempotencyKey:"reserved"}});
  const {token}=c.store.reserveLaunch("run-reserved");
  const repeated=await start(s,p,null,"reserved"); assert.equal(repeated.id,"run-reserved");assert.equal(c.store.get(repeated.id).ownerToken,token);
  const injection=new DatabaseSync(filename);
  try {injection.prepare("UPDATE workflow_runs SET updated_at=? WHERE id=?").run(Date.now()-10_000,repeated.id);} finally {injection.close();}
  assert.equal((await start(s,p,null,"reserved")).status,"interrupted");
  assert.equal(c.store.listActivations(repeated.id).length,0); assert.equal(c.store.events(repeated.id).filter(e=>e.type==="run.reserved").length,1);
}));

test("delivery retry after SIGKILL preserves the interrupted run and completed effects", async()=>fixture(async(s,c,directory)=>{
  await author(s,[count,{id:"answer",kind:"await",reason:{op:"literal",value:"Need an answer"},input:{op:"literal",value:null},responseSchema:{type:"object"}},done]);
  const p=await prepare(s),run=await start(s,p),waiting=await wait(c,run.id,"waiting");
  process.kill(waiting.supervisorPid!,"SIGKILL"); await wait(c,run.id,"interrupted");
  const events=c.store.events(run.id),waits=c.store.waits(run.id);
  const repeated=await start(s,p);assert.equal(repeated.id,run.id);assert.equal(repeated.status,"interrupted");
  assert.deepEqual(c.store.waits(run.id),waits);assert.deepEqual(c.store.events(run.id),events);
  assert.equal(await readFile(join(directory,"effects"),"utf8"),"one\n");
}));

test("JSON equivalence uses persisted values, and distinct intentions or missing keys create new runs", async()=>fixture(async(s,c,directory)=>{
  await author(s);const p=await prepare(s);
  const value=Object.assign(Object.create(null),{n:-0,items:[false,""]});
  const request={id:"run-json",plan:p.plan,input:value,cwd:directory,start:{preparedId:p.preparedId,idempotencyKey:"json"}};
  c.store.create(request);
  assert.equal(c.store.findStart(request.start,value)!.id,"run-json");
  assert.equal(c.store.findStart(request.start,{items:[false,""],n:0})!.id,"run-json");
  const first=await start(s,p,null,"first"),second=await start(s,p,null,"second");assert.notEqual(first.id,second.id);
  const fresh=await s.dispatch("run.start",{preparedId:p.preparedId}) as {id:string};
  assert.notEqual(fresh.id,first.id); assert.notEqual(fresh.id,second.id);
  await Promise.all([wait(c,first.id,"succeeded"),wait(c,second.id,"succeeded"),wait(c,fresh.id,"succeeded")]);
}));

test("tampered snapshot, mapping and workspace are refused before launch", async()=>fixture(async(s,c,directory,filename)=>{
  await author(s);const p=await prepare(s);const injection=new DatabaseSync(filename);
  try {
    injection.prepare("UPDATE workflow_plan_snapshots SET plan=? WHERE hash=?").run(JSON.stringify({...p.plan,source:p.plan.source+"\n// altered"}),p.planHash);
    await assert.rejects(start(s,p),/compiled source/);
    injection.prepare("UPDATE workflow_plan_snapshots SET plan=? WHERE hash=?").run(JSON.stringify(p.plan),p.planHash);
    injection.prepare("UPDATE workflow_prepared_plans SET cwd=? WHERE id=?").run(join(directory,"other"),p.preparedId);
    await assert.rejects(start(s,p),/identity mismatch/);
    const plans=new PreparedPlanStore(filename);
    try {await assert.rejects(plans.save(p.plan,directory),/identity mismatch/);} finally {plans.close();}
    assert.equal(c.store.listRuns().length,0);
  } finally {injection.close();}
}));

test("strict service and MCP schemas agree on two exclusive start modes and read-only prepared inspection", async()=>fixture(async(s,c)=>{
  await author(s);const p=await prepare(s);
  const definition=mcpToolDefinitions.find(t=>t.serviceTool==="run.start")!, validate=createOutputValidator(definition.inputSchema);
  const valid={preparedId:p.preparedId,idempotencyKey:"one",input:null}; validate(valid); validate({id:"sample"});
  for(const request of [{},{id:"sample",idempotencyKey:"x"},{...valid,id:"sample"},{...valid,cwd:p.cwd},{...valid,model:{provider:"test",id:"frozen"}},
    {...valid,idempotencyKey:""},{...valid,idempotencyKey:"nul\0key"},{preparedId:"bad"},{...valid,unknown:true}]) {
    assert.throws(()=>validate(request)); await assert.rejects(s.dispatch("run.start",request));
  }
  assert.equal(mcpToolDefinitions.find(t=>t.serviceTool==="workflow.prepared")!.annotations.readOnlyHint,true);
  await assert.rejects(s.dispatch("workflow.prepared",{preparedId:`prepared-${"0".repeat(64)}`}),/not found/);
  assert.equal(c.store.listRuns().length,0);
}));
