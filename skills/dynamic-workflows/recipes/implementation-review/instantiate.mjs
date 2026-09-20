/** Bind a copied portable recipe to new task/check parameters; no execution or network. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const options={},args=process.argv.slice(2);
assert.equal(args.length%2,0,'Expected --option value pairs');
for(let i=0;i<args.length;i+=2)options[args[i]]=args[i+1];
for(const key of ['--recipe','--parameters','--out'])assert(options[key],'Missing '+key);
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
// Resolve every existing ancestor, so a new directory below an alias cannot
// write inside the source. Fail closed on dangling symlinks and access errors.
function canonicalOutput(target){
 try{return fs.realpathSync(target)}catch(error){
  if(error.code!=='ENOENT')throw error;
  try{fs.lstatSync(target);throw Error('Dangling output symlink: '+target)}catch(statError){if(statError.code!=='ENOENT')throw statError}
  const parent=path.dirname(target);
  if(parent===target)throw error;
  return path.join(canonicalOutput(parent),path.basename(target));
 }
}
const source=fs.realpathSync(options['--recipe']),out=canonicalOutput(path.resolve(options['--out'])),params=read(options['--parameters']);
const relative=path.relative(source,out);
assert(relative&&(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)),
 'Write to a separate output directory outside the source recipe.');
assert(/^[A-Za-z][A-Za-z0-9_-]*$/.test(params.id));
assert(typeof params.task==='string'&&params.task.trim());
assert(Array.isArray(params.acceptanceCriteria)&&params.acceptanceCriteria.length&&params.acceptanceCriteria.every(x=>typeof x==='string'&&x.trim()));
assert(typeof params.checkCommand==='string'&&params.checkCommand&&!params.checkCommand.includes('\0'));
assert(Array.isArray(params.checkArgs)&&params.checkArgs.every(x=>typeof x==='string'&&!x.includes('\0')));
const patch=read(path.join(source,'patch.json')),create=read(path.join(source,'create.json'));
const oldPatchHash=hash(fs.readFileSync(path.join(source,'patch.json')));
create.id=params.id;create.name=params.name??create.name;patch.id=params.id;patch.expectedRevision=1;
let checkCount=0,bindingCount=0;
for(const op of patch.operations){
 if(op.op==='addNode'&&op.node.kind==='check'&&op.node.id==='check'){assert.equal(op.node.command,'node');assert.deepEqual(op.node.args.slice(0,2),['--input-type=module','-e']);assert(op.node.args[2].includes('Portable verification command'));op.node.args[3]=JSON.stringify({command:params.checkCommand,args:params.checkArgs});checkCount++}
}
function bind(value){
 if(Array.isArray(value)){for(const v of value)bind(v);return}
 if(value===null||typeof value!=='object')return;
 if(value.op==='eq'&&value.left?.op==='ref'&&value.left.path?.length===2&&value.left.path[0]==='input'&&['checkCommand','checkArgs'].includes(value.left.path[1])){
  value.right={op:'literal',value:params[value.left.path[1]]};bindingCount++;
 }
 for(const v of Object.values(value))bind(v);
}
bind(patch);assert.equal(checkCount,1,'Expected one portable pipeline verification command');assert.equal(bindingCount,4,'Expected paired root command binding guards');
const input={task:params.task,acceptanceCriteria:params.acceptanceCriteria,checkCommand:params.checkCommand,checkArgs:params.checkArgs,acceptanceCriteriaRevision:'sha256:'+hash(canonical({task:params.task,acceptanceCriteria:params.acceptanceCriteria})),projectPolicy:params.projectPolicy??'Изменяйте только относящиеся к задаче файлы, сохраняйте публичный контракт и сообщайте о недостатке доказательств.',contextFiles:params.contextFiles??[]};
// Existing output file aliases must not redirect writes back into the recipe.
for(const name of ['create','patch','input','validate','instantiation']){
 const file=path.join(out,name+'.json');
 try{const info=fs.lstatSync(file);assert(!info.isSymbolicLink(),'Output file must not be a symlink: '+file);assert(info.nlink===1,'Output file must not have hardlinks: '+file)}catch(error){if(error.code!=='ENOENT')throw error}
}
fs.mkdirSync(out,{recursive:true});
for(const [name,data] of Object.entries({create,patch,input,validate:{id:params.id}}))fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(data,null,2)+'\n');
fs.writeFileSync(path.join(out,'instantiation.json'),JSON.stringify({status:'instantiated-unexecuted',sourceRecipePatchSha256:oldPatchHash,checkCommand:params.checkCommand,checkArgs:params.checkArgs,criteriaRevision:input.acceptanceCriteriaRevision,standaloneAcceptedRunId:null},null,2)+'\n');
console.log(JSON.stringify({out,status:'instantiated-unexecuted',id:params.id}));
