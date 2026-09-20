import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { prepareExecutionPlan } from '../src/execution-plan.js';
import { loadGeneratedModule } from '../src/generated-module.js';
import { RunStore } from '../src/run-store.js';
import { JournalRuntime } from '../src/run-runtime.js';
import { graphSnapshot } from '../src/graph-view/model.js';
import type { WorkflowDefinition } from '../src/graph.js';
const lit=(value:null)=>({op:'literal' as const,value}), ref=(...path:string[])=>({op:'ref' as const,path});
function definition(kind: 'end'|'check'='end',collect=false):WorkflowDefinition {
  return {schemaVersion:1,id:'probe',name:'r14 continuation',revision:1,entryGraph:'main',graphs:{
    main:{entry:'fan',nodes:[{id:'fan',kind:'map',graphId:'child',items:ref('input'),...(collect?{failurePolicy:'collect'}:{}),...(kind==='check'?{concurrency:1}:{})},{id:'done',kind:'end',value:lit(null)}],edges:[{from:'fan',to:'done'}]},
    child:{entry:'leaf',nodes:kind==='check'?[{id:'leaf',kind:'check',command:process.execPath,args:['--version']},{id:'done',kind:'end',value:lit(null)}]:[{id:'leaf',kind:'end',value:lit(null)}],edges:kind==='check'?[{from:'leaf',to:'done'}]:[]}
  }};
}
const ctx=(i:number)=>({graphId:'child',nodeId:'leaf',scope:['graph','main','node','fan','visit','0','map',String(i),'graph','child'],visit:0});
test("fan-out control and writer admission do not repeatedly decode root input or scan history",async()=>{
for (const collect of [false,true]) for(const n of [16,32]) {
  const dir=await mkdtemp('/tmp/r14-cont-input-'),store=new RunStore(join(dir,'db.sqlite'));
  try {
    const plan=await prepareExecutionPlan(definition('end',collect),{cwd:dir,availableModels:[]});
    const input=Array.from({length:n},(_,i)=>({i,pad:'x'.repeat(1024)})),text=JSON.stringify(input);
    store.create({id:'run',plan,input,cwd:dir});const {run,token}=store.reserveLaunch('run');
    const program=await loadGeneratedModule(plan,dir);
    let gets=0,inputParses=0;const originalGet=store.get.bind(store),parse=JSON.parse;
    store.get=(...args:Parameters<typeof originalGet>)=>{gets++;return originalGet(...args)};
    JSON.parse=function(...args:Parameters<typeof JSON.parse>){if(args[0]===text)inputParses++;return parse(...args)};
    try {assert.equal(await Effect.runPromise(program.run(new JournalRuntime(store,run,token,dir),input)),null)} finally {JSON.parse=parse;store.get=originalGet}
    assert.equal(inputParses,0);
  } finally {store.close();await rm(dir,{recursive:true,force:true})}
}
for(const kind of ['end','check'] as const) for(const n of [16,32]) {
  const dir=await mkdtemp('/tmp/r14-cont-admit-'),store=new RunStore(join(dir,'db.sqlite'));
  try {
    const plan=await prepareExecutionPlan(definition(kind),{cwd:dir,availableModels:[]});
    store.create({id:'run',plan,input:null,cwd:dir});const {token}=store.reserveLaunch('run');
    let reads=0,lists=0;const read=store.getActivation.bind(store),list=store.listActivations.bind(store);
    store.getActivation=(...args:Parameters<typeof read>)=>{reads++;return read(...args)};store.listActivations=(...args:Parameters<typeof list>)=>{lists++;return list(...args)};
    for(let i=0;i<n;i++){const a=store.beginActivation('run',token,ctx(i),{kind,sideEffect:kind==='check'});if(kind==='check'){assert.deepEqual(a.metadata.operation,{kind:'check',cwd:dir,command:process.execPath,args:['--version']})}store.completeActivation('run',token,a.key,null)}
    assert.ok(reads <= 4*n, `admission must remain linear: ${reads} reads for ${n} nodes`);assert.equal(lists,0);
  } finally {store.close();await rm(dir,{recursive:true,force:true})}
}
});

test("graph projection indexes real fan-out activations in one pass",async()=>{
// Настоящий исполняемый граф: четыре элемента, в каждом цепочка transform → end.
for(const width of [16,32]) {
  const dir=await mkdtemp('/tmp/r14-cont-ui-'),store=new RunStore(join(dir,'db.sqlite'));
  try {
    const workflow=definition();workflow.graphs.child={entry:'leaf0',nodes:Array.from({length:width},(_,i)=>({id:'leaf'+i,kind:i===width-1?'end':'transform',value:lit(null)})),edges:Array.from({length:width-1},(_,i)=>({from:'leaf'+i,to:'leaf'+(i+1)}))};
    const plan=await prepareExecutionPlan(workflow,{cwd:dir,availableModels:[]}),input=Array(4).fill(null);
    store.create({id:'run',plan,input,cwd:dir});const {run,token}=store.reserveLaunch('run'),program=await loadGeneratedModule(plan,dir);
    const output=await Effect.runPromise(program.run(new JournalRuntime(store,run,token,dir),input));store.finish('run',token,{status:'succeeded',output});
    const records=store.listActivations('run');let visits=0;
    const wrapped=new Proxy(records,{get(target,key,receiver){if(typeof key==='string'&&/^(0|[1-9]\d*)$/.test(key))visits++;return Reflect.get(target,key,receiver)}});
    const snapshot=graphSnapshot(store.get('run'),wrapped),nodes=width+2;
    assert.equal(records.length,4*width+2);assert.ok(visits <= 4 * records.length);
  } finally {store.close();await rm(dir,{recursive:true,force:true})}
}
});

test("workspace lookup chooses exact nearest ancestor across maps and repeated visits",async()=>{
  const dir=await mkdtemp('/tmp/dwf-scope-'),store=new RunStore(join(dir,'db.sqlite'));
  try {
    const plan=await prepareExecutionPlan(definition(),{cwd:dir,availableModels:[]});
    store.create({id:'run',plan,input:{large:'x'.repeat(2048)},cwd:dir});
    const {token}=store.reserveLaunch('run');
    const outer={graphId:'main',nodeId:'workspace',scope:['graph','main'],visit:12};
    const scope=[...outer.scope,'node',outer.nodeId,'visit','12','worktree','graph','middle'];
    const a=store.beginActivation('run',token,outer,{kind:'worktree',sideEffect:true});
    store.setActivationMetadata('run',token,a.key,{childScope:scope,workspace:{path:'/outer'}});
    const nested={graphId:'middle',nodeId:'inner',scope:[...scope,'node','fan','visit','3','map','9','graph','middle'],visit:2};
    const inner=[...nested.scope,'node',nested.nodeId,'visit','2','worktree','graph','leaf'];
    const b=store.beginActivation('run',token,nested,{kind:'worktree',sideEffect:true});
    store.setActivationMetadata('run',token,b.key,{childScope:inner,workspace:{path:'/inner'}});
    assert.equal(store.workspaceCwd('run',{graphId:'leaf',nodeId:'check',scope:inner,visit:0},dir),'/inner');
    assert.equal(store.workspaceCwd('run',{graphId:'middle',nodeId:'check',scope:nested.scope,visit:0},dir),'/outer');
    assert.equal(store.workspaceCwd('run',{graphId:'main',nodeId:'check',scope:outer.scope,visit:0},dir),dir);
    const otherVisit=[...scope];otherVisit[5]='13';
    assert.equal(store.workspaceCwd('run',{graphId:'middle',nodeId:'check',scope:otherVisit,visit:0},dir),dir);
    const second=new RunStore(join(dir,'db.sqlite'));
    try {second.requestControl('run','pause');assert.equal(store.controlState('run').desired,'paused');
      assert.throws(()=>store.beginActivation('run',token,{...outer,nodeId:'next'},{kind:'end',sideEffect:false}),/not accepting/i);
      assert.equal(store.get('run').input && (store.get('run').input as {large:string}).large.length,2048);
    }finally{second.close()}
  }finally{store.close();await rm(dir,{recursive:true,force:true})}
});
