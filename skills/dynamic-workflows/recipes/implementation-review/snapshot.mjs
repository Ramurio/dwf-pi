/** Snapshot the actual Git artifact without changing the worktree's existing index. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const repo=fs.realpathSync(process.cwd());
for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES','GIT_CONFIG','GIT_CONFIG_COUNT','GIT_CONFIG_PARAMETERS']){
 if(Object.hasOwn(process.env,key))throw Error('Unsupported inherited Git environment override: '+key);
}
function git(args,env=process.env){
 const result=spawnSync('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args],{cwd:repo,env,encoding:'utf8',maxBuffer:Infinity});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error(result.stderr||'Git snapshot command failed');
 return result.stdout.trim();
}
if(fs.realpathSync(git(['rev-parse','--show-toplevel']))!==repo)throw Error('Snapshot requires the allocated Git worktree root');
git(['rev-parse','HEAD']);
const indexPath=git(['rev-parse','--path-format=absolute','--git-path','index']);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dynamicwf-artifact-index-'));
let tree;
try{
 const env={...process.env,GIT_INDEX_FILE:path.join(directory,'index')};
 // A missing real index deliberately remains missing: git add starts from an
 // empty index, exactly as GitWorkspaces.commit does. Never seed it from HEAD.
 try{fs.copyFileSync(indexPath,env.GIT_INDEX_FILE)}catch(error){if(error.code!=='ENOENT')throw error}
 git(['add','--all','--','.'],env);
 tree=git(['write-tree'],env);
}finally{fs.rmSync(directory,{recursive:true,force:true})}
if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(tree))throw Error('Unexpected Git tree identity');
process.stdout.write('git-tree:'+tree);
