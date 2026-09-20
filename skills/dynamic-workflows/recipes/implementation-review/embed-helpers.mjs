/** Refresh the inline helper bytes in the three self-contained authoring requests. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=path.dirname(fileURLToPath(import.meta.url));
const snapshot=fs.readFileSync(path.join(directory,'snapshot.mjs'),'utf8');
const verification='const SNAPSHOT_SOURCE = '+JSON.stringify(snapshot)+';\n'+fs.readFileSync(path.join(directory,'verify-command.mjs'),'utf8');
for(const variant of ['S','P','C']){
 const file=path.join(directory,variant,'patch.json');
 const patch=JSON.parse(fs.readFileSync(file,'utf8'));
 for(const operation of patch.operations){
  if(operation.op!=='addNode'||operation.node.kind!=='check')continue;
  const node=operation.node;
  if(['snapshot','initialSnapshot'].includes(node.id))node.args=['--input-type=module','-e',snapshot];
  if(node.id==='check')node.args[2]=verification;
 }
 fs.writeFileSync(file,JSON.stringify(patch,null,2)+'\n');
}
