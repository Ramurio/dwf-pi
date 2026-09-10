import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect, Exit } from "effect";
import { parseOperation } from "../src/operation-record.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { RunStore } from "../src/run-store.js";
import { JournalRuntime } from "../src/run-runtime.js";
import { executionFailure } from "../src/execution-failure.js";
import type { Node } from "../src/graph.js";
import { graphSnapshot } from "../src/graph-view/model.js";

const context={graphId:'main',nodeId:'work',scope:['graph','main'],visit:0};
async function fixture(node:(directory:string,filename:string)=>Node,work:(f:{store:RunStore;runtime:JournalRuntime;directory:string;filename:string;token:string;node:Node})=>Promise<void>){
  const directory=await mkdtemp(join(tmpdir(),'dynamicwf-operation-')),filename=join(directory,'state.sqlite'),store=new RunStore(filename);
  try{const operation=node(directory,filename),plan=await prepareExecutionPlan({schemaVersion:1,id:'operation',name:'Operation capture',revision:1,entryGraph:'main',graphs:{main:{entry:'work',nodes:[operation,{id:'done',kind:'end',value:{op:'literal',value:null}}],edges:[{from:'work',to:'done'}]}}},{cwd:directory,availableModels:[{provider:'offline',id:'fixture',thinkingLevels:['off']}]});
    store.create({id:'run-operation',plan,input:null,cwd:directory});const launch=store.reserveLaunch('run-operation');await work({store,runtime:new JournalRuntime(store,launch.run,launch.token,directory),directory,filename,token:launch.token,node:operation});
  }finally{store.close();await rm(directory,{recursive:true,force:true});}
}

test('operation records are closed JSON data and distinguish intended merge from observed completion',()=>{
  const operation={kind:'agent',cwd:'/workspace',task:'Review',input:{artifactRevision:'abc'},sessionDirectory:'/sessions',resourceDirectory:'/resources'};
  assert.deepEqual(parseOperation(operation),operation);assert.equal(parseOperation({...operation,credentials:'not allowed'}),undefined);
  let touched=false;assert.equal(parseOperation({...operation,get input(){touched=true;return {};}}),undefined);assert.equal(touched,false);
  const base={kind:'integrate',target:'/workspace',sources:[],progress:{phase:'merging',branch:'main',originalHead:'a'.repeat(40),merged:[],current:{sourceHead:'b'.repeat(40),before:'a'.repeat(40)}}};
  assert.deepEqual(parseOperation(base),base);
  assert.equal(parseOperation({...base,progress:{...base.progress,phase:'complete'}}),undefined);
  assert.equal(parseOperation({...base,progress:{phase:'complete',branch:'main',originalHead:'a'.repeat(40),merged:[],head:'not-a-commit'}}),undefined);
  assert.ok(parseOperation({kind:'worktree',source:'/workspace',childScope:['child'],childResult:null}));
});

test('check intent is committed before the child runs; rejected intent prevents the external write',{timeout:15000},async()=>{
  for(const reject of [false,true])await fixture((directory,filename)=>({id:'work',kind:'check',command:process.execPath,args:['-e',`const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(${JSON.stringify(filename)},{readOnly:true});const record=db.prepare("SELECT metadata FROM workflow_activations WHERE kind='check'").get();const operation=JSON.parse(record.metadata).operation;if(operation.kind!=='check'||require('node:fs').realpathSync(operation.cwd)!==process.cwd()||operation.command!==process.execPath)throw Error('Intent not persisted');require('node:fs').writeFileSync('marker','written');db.close();`]}),async({store,runtime,directory,filename,node})=>{
    assert.equal(node.kind,'check');if(node.kind!=='check')return;
    const db=new DatabaseSync(filename);
    try{if(reject)db.exec("CREATE TRIGGER deny_operation BEFORE UPDATE OF metadata ON workflow_activations WHEN json_extract(NEW.metadata,'$.operation') IS NOT NULL BEGIN SELECT RAISE(ABORT,'reject operation'); END");
      const result=await Effect.runPromiseExit(runtime.step(context,()=>runtime.check(context,node)));
      if(reject){assert.ok(Exit.isFailure(result));await assert.rejects(readFile(join(directory,'marker')),/ENOENT/);}
      else{assert.ok(Exit.isSuccess(result));assert.equal((result.value as any).exitCode,0,(result.value as any).stderr);assert.equal(await readFile(join(directory,'marker'),'utf8'),'written');assert.equal(parseOperation(store.listActivations('run-operation')[0]!.metadata.operation)?.kind,'check');}
    }finally{db.close();}
  });
});

test('agent intent binds the actual IPC request before worker admission without loading a model',{timeout:15000},async()=>fixture(()=>({id:'work',kind:'agent',role:'general',task:{op:'literal',value:'Review exact evidence'},config:{permission:'read-only',tools:[]}}),async({store,runtime,directory,filename,node})=>{
  if(node.kind!=='agent')throw Error('Expected agent');
  const preload=join(directory,'observe.cjs'),previous=process.env.NODE_OPTIONS;
  await writeFile(preload,`if(process.argv[1]?.endsWith('/pi-worker-process.ts')){let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{const request=JSON.parse(input);const db=new(require('node:sqlite').DatabaseSync)(${JSON.stringify(filename)},{readOnly:true});const operation=JSON.parse(db.prepare("SELECT metadata FROM workflow_activations WHERE kind='agent'").get().metadata).operation;require('node:assert/strict').deepEqual(operation,{kind:'agent',cwd:request.cwd,task:request.task,input:request.input,sessionDirectory:request.sessionDirectory,resourceDirectory:request.resourceDirectory});require('node:fs').writeFileSync(${JSON.stringify(join(directory,'matched'))},'yes');const failure={version:1,code:'provider',phase:'execution',effects:'read-only',message:'Offline fixture'};process.stdout.write(JSON.stringify({type:'error',error:failure.message,failure})+'\\n',()=>process.exit(1));});}`);
  try{process.env.NODE_OPTIONS=`--require=${preload}`;const result=await Effect.runPromiseExit(runtime.step(context,()=>runtime.agent(context,node,'Review exact evidence',{artifactRevision:'digest-1',acceptanceCriteriaRevision:'criteria-2'})));assert.ok(Exit.isFailure(result));
    assert.equal(await readFile(join(directory,'matched'),'utf8'),'yes');const operation=parseOperation(store.listActivations('run-operation')[0]!.metadata.operation);assert.equal(operation?.kind,'agent');if(operation?.kind==='agent')assert.deepEqual(operation.input,{artifactRevision:'digest-1',acceptanceCriteriaRevision:'criteria-2'});
    assert.doesNotMatch(JSON.stringify(graphSnapshot(store.get('run-operation'),store.listActivations('run-operation'))),/Review exact evidence|digest-1|criteria-2|resourceDirectory|sessionDirectory/);
  }finally{if(previous===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=previous;}
}));

test('a new attempt archives operation/session provenance and starts without stale worker identity',async()=>fixture(()=>({id:'work',kind:'agent',role:'general',task:{op:'literal',value:'Task'},retryPolicy:{codes:['provider'],delayMs:0,maxAttempts:2},config:{permission:'read-only',tools:[]}}),async({store,token,directory})=>{
  const record=store.beginActivation('run-operation',token,context,{kind:'agent',sideEffect:true}),operation={kind:'agent',cwd:directory,task:'Old task',input:null,sessionDirectory:join(directory,'sessions'),resourceDirectory:join(directory,'resources')};
  store.setActivationMetadata('run-operation',token,record.key,{operation,sessionFile:'old-session',workerToken:'old-token',workerKind:'pi',workerPid:null,cwd:directory,model:{provider:'offline',id:'fixture'},thinking:'off'});
  store.failActivation('run-operation',token,record.key,'Failed',executionFailure('provider','execution','read-only','Failed').failure,{retryEligible:true});
  const current=store.beginActivation('run-operation',token,context,{kind:'agent',sideEffect:true}),archived=store.attempts('run-operation',record.key).records[0]!;
  assert.deepEqual(archived.metadata.operation,operation);assert.equal(archived.metadata.sessionFile,'old-session');
  for(const field of ['operation','sessionFile','workerToken','workerKind','workerPid','cwd','model','thinking'])assert.equal(current.metadata[field],undefined);
}));
