/** Portable verification command; SNAPSHOT_SOURCE is injected before this body. */
import {spawnSync as runChild} from 'node:child_process';
const configured=JSON.parse(process.argv[1]);
if(typeof configured.command!=='string'||!configured.command||!Array.isArray(configured.args)||configured.args.some(v=>typeof v!=='string'))throw Error('Invalid frozen verification command');
const report={command:configured.command,args:configured.args,cwd:process.cwd(),executedAt:new Date().toISOString(),commandExecuted:false,commandExitCode:null,signal:null,stdout:'',stderr:'',snapshotBefore:null,snapshotAfter:null,artifactStable:false,exitCode:1};
function snapshot(){
 const result=runChild(process.execPath,['--input-type=module','-e',SNAPSHOT_SOURCE],{cwd:process.cwd(),encoding:'utf8',maxBuffer:Infinity});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error(result.stderr||'Artifact snapshot failed');
 if(!/^git-tree:(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(result.stdout))throw Error('Invalid artifact identity');
 return result.stdout;
}
try{
 report.snapshotBefore=snapshot();
 const result=runChild(configured.command,configured.args,{cwd:process.cwd(),encoding:'utf8',maxBuffer:Infinity,shell:false});
 report.commandExecuted=typeof result.pid==='number'&&result.pid>0;report.commandExitCode=result.status;report.signal=result.signal;report.stdout=result.stdout??'';report.stderr=result.stderr??'';
 if(result.error)throw result.error;
 report.snapshotAfter=snapshot();report.artifactStable=report.snapshotBefore===report.snapshotAfter;
 if(result.status===0&&result.signal===null&&report.artifactStable)report.exitCode=0;
}catch(error){report.error=error instanceof Error?error.message:String(error)}
process.stdout.write(JSON.stringify(report,null,2)+'\n');
process.exitCode=report.exitCode;
