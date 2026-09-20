import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RunStore } from '../src/run-store.js';
import { WorkflowService } from '../src/service.js';
import type { ExecutionPlan } from '../src/execution-types.js';

for(const scope of ['run','task'] as const) test(`${scope} usage summary and page share one SQLite snapshot`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dwf-usage-snapshot-')),filename=join(dir,'store.sqlite');
  const writer=new RunStore(filename),service=new WorkflowService(filename);
  const original=RunStore.prototype.listActivations;
  try {
    const plan={version:1,hash:'fixture',agents:{},workflow:{entryGraph:'main',graphs:{main:{entry:'agent',nodes:[{id:'agent',kind:'agent'}],edges:[]}}}} as unknown as ExecutionPlan;
    writer.create({id:'run',plan,input:null,cwd:dir});
    const {token}=writer.reserveLaunch('run');
    const activation=writer.beginActivation('run',token,{graphId:'main',nodeId:'agent',scope:['graph','main'],visit:0},{kind:'agent',sideEffect:false});
    const task=writer.membership('run')!.taskId;let injected=false;
    RunStore.prototype.listActivations=function(id){
      const rows=original.call(this,id);
      if(!injected){injected=true;writer.recordUsage('run',token,activation.key,'1',{input:10,output:3,totalTokens:13},'stop');}
      return rows;
    };
    const first=await service.dispatch(`${scope}.usage`,{id:scope==='run'?'run':task}) as {summary:{totalTokens:number};reports:{usage:{totalTokens:number}}[]};
    assert.equal(injected,true);
    assert.equal(first.summary.totalTokens,0);
    assert.equal(first.reports.length,0,'new report must not leak into an older summary snapshot');
    const second=await service.dispatch(`${scope}.usage`,{id:scope==='run'?'run':task}) as typeof first;
    assert.equal(second.summary.totalTokens,13);assert.equal(second.reports.length,1);
  }finally{RunStore.prototype.listActivations=original;service.close();writer.close();await rm(dir,{recursive:true,force:true})}
});
