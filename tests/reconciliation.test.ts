import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { RunController } from "../src/run-controller.js";
import { WorkflowService } from "../src/service.js";
import { parseReconciliationRequest } from "../src/reconciliation.js";
import type { ReconciliationRequest } from "../src/reconciliation.js";
import type { Json, WorkflowDefinition } from "../src/graph.js";
import { GitWorkspaces } from "../src/workspaces.js";
import { startGraphServer } from "../src/graph-view/server.js";
import { request as httpRequest } from "node:http";

const context = { graphId: "main", nodeId: "work", scope: ["graph", "main"], visit: 0 };
const flow = (command: string, args: string[] = []): WorkflowDefinition => ({ schemaVersion: 1, id: "reconcile", name: "Reconciliation fixture", revision: 1, entryGraph: "main", graphs: { main: { entry: "work", nodes: [
  { id: "work", kind: "check", command, args }, { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "work"] } },
], edges: [{ from: "work", to: "done" }] } } });
async function fixture(work: (controller: RunController, directory: string, filename: string) => Promise<void>) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "dynamicwf-reconcile-"))), filename = join(directory, "state.sqlite"), controller = new RunController(filename);
  try { await work(controller, directory, filename); }
  finally {
    for (const run of controller.store.listRuns()) {
      await controller.control(run.id, "cancel");
      const deadline = Date.now() + 15_000;
      for (;;) { const observed = controller.observe(run.id); if (!observed.supervisorAlive && !observed.workersAlive && !observed.unresolvedGroups.length) break; if (Date.now() > deadline) throw new Error("Fixture processes did not drain"); await sleep(25); }
    }
    controller.close(); await rm(directory, { recursive: true, force: true });
  }
}
async function seed(controller: RunController, directory: string, workflow = flow("unused"), id = "run-reconcile") {
  const plan = await prepareExecutionPlan(workflow, { cwd: directory, availableModels: [{ provider: "offline", id: "fixture", thinkingLevels: ["off"] }] });
  controller.store.create({ id, plan, cwd: directory, input: null }); const { token } = controller.store.reserveLaunch(id);
  const kind = workflow.graphs.main!.nodes[0]!.kind;
  const a = controller.store.beginActivation(id, token, context, { kind, sideEffect: true });
  return { id, token, a };
}
function fail(controller: RunController, id: string, token: string, key: string) {
  controller.store.failActivation(id, token, key, "Fixture uncertain operation");
  controller.store.finish(id, token, { status: "failed", error: "Fixture uncertain operation" });
}
async function request(controller: RunController, id: string, key: string, action: "accept" | "retry", output?: Json): Promise<ReconciliationRequest> {
  const inspected = await controller.recovery(id, key); assert.deepEqual(inspected.blockers, []); assert.ok(inspected.workspace);
  return { id, key, attempt: inspected.attempt, checkpoint: inspected.checkpoint, workspaceDigest: inspected.workspace.digest,
    decisionId: "decision-1", action, actor: "fixture-agent", reason: "Inspected local result and settled the operation", evidence: [{ inspected: true }], ...(action === "accept" ? { output: output! } : {}) };
}
async function stopped(controller: RunController, id: string) {
  const deadline = Date.now() + 15_000;
  for (;;) { const run = controller.observe(id).run; if (["failed", "succeeded"].includes(run.status)) return run; if (Date.now() > deadline) throw new Error(`Run did not finish: ${run.status}`); await sleep(25); }
}

test("accept preserves the failed attempt, recorded spend and pause; exact redelivery survives completion", async () => fixture(async (controller, directory, filename) => {
  const workflow = flow("unused"); workflow.graphs.main!.nodes[0] = { id: "work", kind: "agent", role: "general", task: { op: "literal", value: "Never invoke a model" }, config: { outputSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false } } };
  const { id, token, a } = await seed(controller, directory, workflow);
  controller.store.setActivationMetadata(id, token, a.key, { operation: { kind: "agent", cwd: directory, task: "Never invoke a model", input: null, sessionDirectory: directory, resourceDirectory: directory } });
  controller.store.startUsage(id, token, a.key); controller.store.recordUsage(id, token, a.key, "1", { input: 7, output: 3, totalTokens: 10 }, "error"); controller.store.settleUsage(id, token, a.key, true);
  controller.store.requestControl(id, "pause"); fail(controller, id, token, a.key);
  const r = await request(controller, id, a.key, "accept", { answer: "Already produced" }), service = new WorkflowService(filename);
  try {
    const receipt = await service.dispatch("run.reconcile", r); assert.equal(controller.store.get(id).status, "paused"); assert.equal(controller.store.get(id).ownerToken, null);
    const attempts = controller.store.attempts(id, a.key); assert.equal(attempts.records[0]!.status, "failed"); assert.equal(attempts.records[0]!.accounting.usage!.totalTokens, 10);
    assert.equal(attempts.current.attempt, 2); assert.equal(attempts.current.accounting.recorded, false); assert.equal(attempts.current.metadata.operation, undefined);
    assert.equal((attempts.current.metadata.usage as { totalTokens: number }).totalTokens, 10);
    const before = controller.store.events(id).length; assert.deepEqual(await controller.reconcile(r), receipt); assert.equal(controller.store.events(id).length, before);
    await assert.rejects(controller.reconcile({ ...r, reason: "different" }), /Conflicting/);
    await controller.control(id, "resume"); assert.equal((await stopped(controller, id)).status, "succeeded");
    assert.deepEqual(await controller.reconcile(r), receipt); assert.deepEqual(controller.store.get(id).output, { answer: "Already produced" });
    assert.equal(controller.store.usageReports(id).reports.length, 1);
  } finally { service.close(); }
}));

test("freshness, output validation and journal rollback precede any accepted checkpoint", async () => fixture(async (controller, directory, filename) => {
  const { id, token, a } = await seed(controller, directory);
  controller.store.setActivationMetadata(id, token, a.key, { operation: { kind: "check", cwd: directory, command: "unused", args: [] } }); fail(controller,id,token,a.key);
  const valid = { exitCode: 0, stdout: "verified", stderr: "" }, r = await request(controller,id,a.key,"accept",valid);
  await assert.rejects(controller.reconcile({ ...r, output: { exitCode: "zero" } }));
  await writeFile(join(directory,"artifact"),"changed"); await assert.rejects(controller.reconcile(r), /workspace changed/);
  const fresh = await request(controller,id,a.key,"accept",valid);
  const db = new DatabaseSync(filename);
  try {
    db.exec("CREATE TRIGGER reject_application BEFORE INSERT ON workflow_reconciliation_applications BEGIN SELECT RAISE(ABORT,'application rejected'); END");
    await assert.rejects(controller.reconcile(fresh), /application rejected/);
    assert.equal(controller.store.getActivation(id,a.key)!.attempt,1); assert.equal(controller.store.reconciliations(id).length,0); assert.equal(controller.store.attempts(id,a.key).archived,0);
    db.exec("DROP TRIGGER reject_application");
  } finally { db.close(); }
  await controller.reconcile({ ...await request(controller,id,a.key,"retry"), decisionId: "retry-changed-checkpoint" }); await assert.rejects(controller.reconcile(fresh), /checkpoint or workspace changed/);
  assert.throws(() => parseReconciliationRequest({ ...fresh, action:"retry" }), /action or evidence/);
}));

test("retry rechecks files, requires explicit supersession and admits exactly one real invocation", async () => fixture(async (controller, directory) => {
  const args = ["-e", "require('node:fs').appendFileSync('invocations','once\\n')"], { id, token, a } = await seed(controller,directory,flow(process.execPath,args));
  controller.store.setActivationMetadata(id,token,a.key,{ operation:{kind:"check",cwd:directory,command:process.execPath,args} }); fail(controller,id,token,a.key);
  const r = await request(controller,id,a.key,"retry"); await controller.reconcile(r);
  await writeFile(join(directory,"artifact"),"changed after decision");
  await controller.control(id,"resume"); const rejected = await stopped(controller,id); assert.equal(rejected.status,"failed"); assert.match(rejected.error!,/Workspace changed/);
  assert.equal(controller.store.getActivation(id,a.key)!.attempt,1); assert.equal(controller.store.reconciliation(id,r.decisionId)!.application,null);
  const fresh = {...await request(controller,id,a.key,"retry"),decisionId:"decision-2"};
  await assert.rejects(controller.reconcile(fresh),/explicit supersedes/);
  const next = {...fresh,supersedes:r.decisionId}; await controller.reconcile(next);
  assert.equal(controller.store.reconciliation(id,r.decisionId)!.supersededBy,next.decisionId);
  await controller.control(id,"resume"); const completed = await stopped(controller,id); assert.equal(completed.status,"succeeded",completed.error);
  assert.equal(await readFile(join(directory,"invocations"),"utf8"),"once\n");
  assert.equal(controller.store.reconciliation(id,next.decisionId)!.application!.attempt,2);
  await controller.reconcile(next); assert.equal(await readFile(join(directory,"invocations"),"utf8"),"once\n");
  assert.equal(controller.store.attempts(id,a.key).archived,1);
}));

test("retry admission and its receipt roll back together, and consumed authorization cannot repeat an uncertain effect", async () => fixture(async (controller,directory,filename) => {
  const {id,token,a}=await seed(controller,directory);controller.store.setActivationMetadata(id,token,a.key,{operation:{kind:"check",cwd:directory,command:"unused",args:[]}});fail(controller,id,token,a.key);
  const r=await request(controller,id,a.key,"retry");await controller.reconcile(r);const owner=controller.store.reserveLaunch(id).token;
  assert.throws(()=>controller.store.beginActivation(id,owner,context,{kind:"check",sideEffect:true}),/fresh admission/);
  const db=new DatabaseSync(filename);try {
    db.exec("CREATE TRIGGER reject_started BEFORE INSERT ON workflow_run_events WHEN NEW.type='activation.started' BEGIN SELECT RAISE(ABORT,'start rejected'); END");
    assert.throws(()=>controller.store.beginActivation(id,owner,context,{kind:"check",sideEffect:true,reconciliation:r.decisionId}),/start rejected/);
    assert.equal(controller.store.reconciliation(id,r.decisionId)!.application,null);assert.equal(controller.store.attempts(id,a.key).archived,0);db.exec("DROP TRIGGER reject_started");
  }finally{db.close();}
  controller.store.beginActivation(id,owner,context,{kind:"check",sideEffect:true,reconciliation:r.decisionId});controller.store.failActivation(id,owner,a.key,"Second uncertain failure");
  assert.throws(()=>controller.store.beginActivation(id,owner,context,{kind:"check",sideEffect:true,reconciliation:r.decisionId}),/no longer pending/);
  assert.throws(()=>controller.store.beginActivation(id,owner,context,{kind:"check",sideEffect:true}),/explicit retry authorization/);
  controller.store.finish(id,owner,{status:"failed",error:"fixture"});
}));

test("worktree acceptance proves current head and completed child output without creating a commit", async () => fixture(async (controller,directory) => {
  const repo=join(directory,"repo");await mkdir(repo);
  const git=(...args:string[])=>execFileSync("git",["-C",repo,"-c","user.name=Fixture","-c","user.email=fixture@localhost","-c","core.hooksPath=/dev/null",...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  git("init","-b","main");await writeFile(join(repo,"base"),"base");git("add",".");git("commit","-m","base");
  const workflow=flow("unused");workflow.graphs.main!.nodes[0]={id:"work",kind:"worktree",graphId:"child",input:{op:"literal",value:null}};workflow.graphs.child={entry:"done",nodes:[{id:"done",kind:"end",value:{op:"literal",value:null}}],edges:[]};
  const {id,token,a}=await seed(controller,repo,workflow);const manager=new GitWorkspaces(id,controller.directory(id));const allocation=await manager.allocate(repo,a.key,undefined);
  await writeFile(join(allocation.path,"result"),"completed");const workspace=await manager.commit(allocation);
  controller.store.setActivationMetadata(id,token,a.key,{workspace:{...workspace},workspacePhase:"committing",operation:{kind:"worktree",source:repo,childScope:["fixture-child"],childResult:{verified:true}}});fail(controller,id,token,a.key);
  const r=await request(controller,id,a.key,"accept",{workspace:{...workspace},result:{verified:true}});
  await assert.rejects(controller.reconcile({...r,output:{workspace:{...workspace},result:{verified:false}}}),/completed child checkpoint/);
  await controller.reconcile(r);assert.deepEqual(controller.store.getActivation(id,a.key)!.output,r.output);
  assert.equal(git("rev-parse",workspace.branch),workspace.head);assert.notEqual(git("rev-parse","HEAD"),workspace.head);
}));

test("review acceptance binds the recorded artifact and criteria; CLI and browser expose the immutable receipt", async () => fixture(async (controller,directory,filename) => {
  const workflow=flow("unused");workflow.graphs.main!.nodes[0]={id:"work",kind:"agent",role:"reviewer",task:{op:"literal",value:"Offline review"},config:{outputSchema:{type:"object",required:["artifactRevision","acceptanceCriteriaRevision","decision"],additionalProperties:false,properties:{artifactRevision:{type:"string"},acceptanceCriteriaRevision:{type:"string"},decision:{enum:["approve","request_changes"]}}}}};
  const {id,token,a}=await seed(controller,directory,workflow), input={artifactRevision:"artifact-A",acceptanceCriteriaRevision:"criteria-1"};
  controller.store.setActivationMetadata(id,token,a.key,{operation:{kind:"agent",cwd:directory,task:"Offline review",input,sessionDirectory:directory,resourceDirectory:directory}});fail(controller,id,token,a.key);
  const r=await request(controller,id,a.key,"accept",{...input,decision:"approve"});
  for(const changed of [{artifactRevision:"artifact-B"},{acceptanceCriteriaRevision:"criteria-2"}]) await assert.rejects(controller.reconcile({...r,output:{...input,decision:"approve",...changed}}),/artifact\/criteria revision/);
  const cli=execFileSync(process.execPath,["--import",import.meta.resolve("tsx"),join(process.cwd(),"src/cli.ts"),"run.reconcile","--store",filename],{input:JSON.stringify(r),encoding:"utf8",stdio:["pipe","pipe","pipe"]});
  assert.equal(JSON.parse(cli).result.application.attempt,2);
  const server=await startGraphServer(filename,id);try{
    const records=await (await fetch(`${server.url}reconciliations?id=${encodeURIComponent(id)}&key=${encodeURIComponent(a.key)}`)).json();
    assert.deepEqual(records,controller.store.reconciliations(id,a.key));
  }finally{await server.close();}
}));

test("browser decisions require the local control origin, reject stale files and preserve one-use identity", async () => fixture(async (controller,directory,filename) => {
  const {id,token,a}=await seed(controller,directory);controller.store.setActivationMetadata(id,token,a.key,{operation:{kind:"check",cwd:directory,command:"unused",args:[]}});fail(controller,id,token,a.key);
  const server=await startGraphServer(filename,id);try {
    const r=await request(controller,id,a.key,"retry"),headers={Origin:new URL(server.url).origin,"Content-Type":"application/json","X-Dynamicwf-View":"1"};
    const send=(value:unknown, supplied:Record<string,string>=headers)=>fetch(`${server.url}reconcile`,{method:"POST",headers:supplied,body:JSON.stringify(value)});
    for(const wrong of [{...headers,Origin:"https://foreign.invalid"},{...headers,"X-Dynamicwf-View":"0"},{...headers,"Content-Type":"text/plain"}]) assert.equal((await send(r,wrong)).status,403);
    assert.equal(controller.store.reconciliations(id).length,0);
    await writeFile(join(directory,"artifact"),"changed after inspection");assert.equal((await send(r)).status,400);
    assert.equal(controller.store.getActivation(id,a.key)!.attempt,1);
    const fresh={...await request(controller,id,a.key,"retry"),reason:"Повтор после проверки файлов"};
    const bytes=Buffer.from(JSON.stringify(fresh)),split=bytes.indexOf(Buffer.from("Повтор"))+1;
    const malformed=Buffer.from(bytes);malformed[split-1]=0xff;
    assert.equal((await fetch(`${server.url}reconcile`,{method:"POST",headers,body:malformed})).status,400);assert.equal(controller.store.reconciliations(id).length,0);
    const saved=await new Promise<{status:number;body:string}>((resolve,reject)=>{
      const req=httpRequest(`${server.url}reconcile`,{method:"POST",headers},response=>{
        const chunks:Buffer[]=[];response.on("data",chunk=>chunks.push(chunk));response.on("end",()=>resolve({status:response.statusCode!,body:Buffer.concat(chunks).toString("utf8")}));response.on("error",reject);
      });req.on("error",reject);req.write(bytes.subarray(0,split));setTimeout(()=>req.end(bytes.subarray(split)),10);
    });assert.equal(saved.status,200);const receipt=JSON.parse(saved.body);assert.equal(receipt.request.reason,fresh.reason);
    assert.equal(controller.store.get(id).ownerToken,null);assert.equal(controller.store.get(id).status,"interrupted");
    const events=controller.store.events(id).length,again=await send(fresh);assert.deepEqual(await again.json(),receipt);assert.equal(controller.store.events(id).length,events);
    assert.equal((await send({...fresh,reason:"conflicting delivery"})).status,400);
    assert.equal(controller.store.reconciliations(id).length,1);
  }finally{await server.close();}
}));

test("integration acceptance verifies every source ancestor and recorded original head; partial integration can retry", {timeout:30_000}, async () => fixture(async (controller,directory) => {
  const repo=join(directory,"repo");await mkdir(repo);
  const git=(...args:string[])=>execFileSync("git",["-C",repo,"-c","user.name=Fixture","-c","user.email=fixture@localhost","-c","core.hooksPath=/dev/null",...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  git("init","-b","main");await writeFile(join(repo,"base"),"base");git("add",".");git("commit","-m","base");const base=git("rev-parse","HEAD");
  const workflow=flow("unused");workflow.graphs.main!.nodes[0]={id:"work",kind:"worktree",graphId:"child",input:{op:"literal",value:null}};
  workflow.graphs.main!.nodes.splice(1,0,{id:"merge",kind:"integrate",sources:{op:"ref",path:["nodes","work"]}});
  workflow.graphs.main!.edges=[{from:"work",to:"merge"},{from:"merge",to:"done"}];
  workflow.graphs.child={entry:"done",nodes:[{id:"done",kind:"end",value:{op:"literal",value:null}}],edges:[]};
  // Runtime integration uses an array; the seeded checkpoint supplies the actual evaluated input.
  workflow.graphs.main!.nodes[1]={id:"merge",kind:"integrate",sources:{op:"array",items:[{op:"ref",path:["nodes","work"]}]}};
  const {id,token,a}=await seed(controller,repo,workflow),manager=new GitWorkspaces(id,controller.directory(id));
  const allocation=await manager.allocate(repo,a.key,undefined);await writeFile(join(allocation.path,"result"),"completed");const workspace=await manager.commit(allocation);
  controller.store.completeActivation(id,token,a.key,{result:null,workspace:{...workspace}});
  const merge=controller.store.beginActivation(id,token,{...context,nodeId:"merge"},{kind:"integrate",sideEffect:true});
  const sources=[{...workspace}],progress={phase:"merging",branch:"main",originalHead:base,merged:[],current:{sourceHead:workspace.head,before:base}};
  controller.store.setActivationMetadata(id,token,merge.key,{operation:{kind:"integrate",target:repo,sources,progress}});fail(controller,id,token,merge.key);
  const guessed=await request(controller,id,merge.key,"accept",{workspace:{path:repo,branch:"main",base,head:base},merged:[workspace.head]});
  await assert.rejects(controller.reconcile(guessed),/merge-base failed/);
  const retry=await request(controller,id,merge.key,"retry");await controller.reconcile(retry);
  git("merge","--no-ff","--no-edit",workspace.head);
  const finalHead=git("rev-parse","HEAD"), accepted={...await request(controller,id,merge.key,"accept",{workspace:{path:repo,branch:"main",base,head:finalHead},merged:[workspace.head]}),decisionId:"accepted-merge",supersedes:retry.decisionId};
  await controller.reconcile(accepted);assert.equal(git("rev-parse","HEAD"),finalHead);
  assert.equal(controller.store.reconciliation(id,retry.decisionId)!.supersededBy,accepted.decisionId);
}));

for (const mode of ["clean-B", "dirty-A", "missing", "contradiction"] as const) test(`guarded worktree recovery ${mode} preserves approved A`, async () => fixture(async (controller, directory) => {
  const repo = join(directory, "repo"); await mkdir(repo);
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(repo, "init", "-b", "main"); await writeFile(join(repo, "base"), "base"); git(repo, "add", "."); git(repo, "commit", "-m", "base");
  const workflow = flow("unused");
  workflow.graphs.main!.nodes[0] = { id: "work", kind: "worktree", graphId: "child", input: { op: "literal", value: null }, expectedTreeFromResult: ["approved"] };
  // Running this child on retry would produce an invalid approval; the journal must be reused.
  workflow.graphs.child = { entry: "done", nodes: [{ id: "done", kind: "end", value: { op: "literal", value: "must not run" } }], edges: [] };
  const { id, token, a } = await seed(controller, repo, workflow), manager = new GitWorkspaces(id, controller.directory(id));
  const allocation = await manager.allocate(repo, a.key, undefined);
  await writeFile(join(allocation.path, "base"), "A"); git(allocation.path, "add", ".");
  const expectedTree = git(allocation.path, "write-tree"), childResult = { approved: `git-tree:${expectedTree}` };
  if (mode === "clean-B") {
    await writeFile(join(allocation.path, "base"), "B"); await manager.commit(allocation);
  }
  controller.store.setActivationMetadata(id, token, a.key, { workspace: { ...allocation }, workspacePhase: "committing", operation: { kind: "worktree", source: repo, childScope: [...context.scope, "node", "work", "visit", "0", "worktree", "graph", "child"], childResult, ...(mode === "missing" ? {} : { expectedTree: mode === "contradiction" ? null : expectedTree }) } });
  fail(controller, id, token, a.key);
  const inspection = await controller.recovery(id, a.key);
  if (mode !== "dirty-A") {
    assert(inspection.blockers.some(b => b.code === "worktree-constraint"));
    for (const action of ["accept", "retry"] as const) await assert.rejects(controller.reconcile({ id, key: a.key, attempt: 1, checkpoint: inspection.checkpoint, workspaceDigest: "a".repeat(64), decisionId: "denied", action, actor: "test", reason: "test", evidence: [true], ...(action === "accept" ? { output: null } : {}) }), /blocked/);
  } else {
    assert.deepEqual(inspection.blockers, []);
    const r = await request(controller, id, a.key, "retry"); await controller.reconcile(r);
    await controller.control(id, "resume"); const completed = await stopped(controller, id);
    assert.equal(completed.status, "succeeded", completed.error);
    const parent = controller.store.getActivation(id, a.key)!;
    assert.equal((parent.metadata.operation as any).expectedTree, expectedTree);
    assert.deepEqual((parent.output as any).result, childResult);
    assert.equal(git(allocation.path, "rev-parse", "HEAD^{tree}"), expectedTree);
    assert.equal(controller.store.listActivations(id).filter(a => a.context.graphId === "child").length, 0);
  }
}));
