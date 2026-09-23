import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, writeFileSync, readFileSync, rmSync, statSync, chmodSync, linkSync, symlinkSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const sdk = new URL("../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js", import.meta.url).href;
const load = `const {FileAuthStorageBackend}=await import(${JSON.stringify(sdk)});`;
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "dwf-sdk-auth-creation-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, path: join(directory, "fixture.json") };
}
function child(t: TestContext, code: string) {
  const process_ = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  process_.stderr.on("data", chunk => { stderr += chunk; });
  const done = new Promise<void>((resolve, reject) => {
    process_.once("error", reject);
    process_.once("close", (code, signal) => code === 0 ? resolve() : reject(new Error(`Child ${code}/${signal}: ${stderr}`)));
  });
  // Обработчик ставится сразу: ранний отказ не становится unhandled rejection.
  void done.catch(() => {});
  t.after(async () => {
    if (process_.exitCode === null && process_.signalCode === null) process_.kill("SIGKILL");
    await done.catch(() => {});
  });
  return done;
}
async function waitFile(path: string) {
  const deadline = Date.now() + 15000;
  while (!existsSync(path)) {
    assert.ok(Date.now() < deadline, `Нет барьера ${path}`);
    await delay(10);
  }
}
for (const first of ["withLock", "withLockAsync"]) for (const second of ["withLock", "withLockAsync"]) {
  test(`SDK creation preserves both writers (${first} then ${second})`, { timeout: 25000 }, async t => {
    const { directory, path } = fixture(t), ready = join(directory, "ready"), gate = join(directory, "gate");
    // Процесс A останавливается сразу после наблюдения отсутствующего файла.
    // В старом SDK блокировки ещё нет: B завершает запись, затем A её стирает.
    // В исправленном SDK A уже владеет lock: B ждёт освобождения и видит запись A.
    const a = child(t, `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
      const exists=fs.existsSync;
      fs.existsSync=function(path){const found=exists(path);if(path===${JSON.stringify(path)}&&!found){
        fs.writeFileSync(${JSON.stringify(ready)},'ready');const deadline=Date.now()+15000;
        while(!exists(${JSON.stringify(gate)})){if(Date.now()>deadline)throw Error('gate timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}
      }return found;};syncBuiltinESMExports();${load}
      await new FileAuthStorageBackend(${JSON.stringify(path)}).${first}(current=>({result:null,next:JSON.stringify({...JSON.parse(current),a:'FIXTURE-A'})}));`);
    await waitFile(ready);
    const locked = existsSync(path + ".lock"), busy = join(directory, "busy");
    // Барьер именно EEXIST от mkdir(lock), а не только старта процесса B.
    const contention = `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
      const sync=fs.mkdirSync,async=fs.mkdir;
      const observed=(path,error)=>{if(path===${JSON.stringify(path + ".lock")}&&error?.code==='EEXIST')fs.writeFileSync(${JSON.stringify(busy)},'busy');};
      fs.mkdirSync=function(path,...args){try{return sync(path,...args);}catch(error){observed(path,error);throw error;}};
      fs.mkdir=function(path,...args){const callback=args.pop();return async(path,...args,(error,...values)=>{observed(path,error);callback(error,...values);});};syncBuiltinESMExports();`;
    const b = child(t, `${contention}${load}await new FileAuthStorageBackend(${JSON.stringify(path)}).${second}(current=>({result:null,next:JSON.stringify({...JSON.parse(current),b:'FIXTURE-B'})}));`);
    if (locked) await waitFile(busy); else await b;
    writeFileSync(gate, "go");
    await Promise.all([a, b]);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { a: "FIXTURE-A", b: "FIXTURE-B" });
    assert.equal(locked, true, "Первое создание должно происходить под общей SDK-блокировкой");
    assert.equal(existsSync(path + ".lock"), false);
  });
}
for (const method of ["withLock", "withLockAsync"]) {
  test(`SDK creation failure releases lock (${method})`, async t => {
    const { path } = fixture(t);
    await child(t, `import fs from 'node:fs';import assert from 'node:assert/strict';import {syncBuiltinESMExports} from 'node:module';
      const write=fs.writeFileSync;let injected=false;
      fs.writeFileSync=function(path,...args){if(path===${JSON.stringify(path)}&&!injected){injected=true;assert.equal(fs.existsSync(path+'.lock'),true);throw Error('fixture creation failure');}return write(path,...args);};syncBuiltinESMExports();${load}
      const backend=new FileAuthStorageBackend(${JSON.stringify(path)});let called=false;
      await assert.rejects(async()=>await backend.${method}(()=>{called=true;return {result:null};}),/fixture creation failure/);
      assert.equal(called,false);assert.equal(fs.existsSync(${JSON.stringify(path + ".lock")}),false);
      await backend.${method}(()=>({result:null,next:'{"recovered":true}'}));`);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { recovered: true });
  });
  test(`SDK preserves inode, modes and link semantics (${method})`, { skip: process.platform === "win32" }, async t => {
    const { directory, path } = fixture(t), hard = join(directory, "hard"), sym = join(directory, "sym");
    writeFileSync(path, "{}", { mode: 0o600 }); chmodSync(path, 0o640); linkSync(path, hard); symlinkSync(path, sym);
    const inode = statSync(path).ino;
    await child(t, `${load}await new FileAuthStorageBackend(${JSON.stringify(sym)}).${method}(()=>({result:null,next:'{"fixture":true}'}));`);
    assert.equal(statSync(path).ino, inode); assert.equal(statSync(hard).ino, inode);
    assert.equal(statSync(path).mode & 0o777, 0o640); assert.equal(lstatSync(sym).isSymbolicLink(), true);
    assert.deepEqual(JSON.parse(readFileSync(hard, "utf8")), { fixture: true });
    const missing = join(directory, "new.json");
    await child(t, `${load}await new FileAuthStorageBackend(${JSON.stringify(missing)}).${method}(()=>({result:null}));`);
    assert.equal(statSync(missing).mode & 0o777, 0o600); assert.equal(readFileSync(missing, "utf8"), "{}");
  });
}
test("aborted async lock wait does not create auth file outside the owner lock", async t => {
  const { path } = fixture(t);
  await child(t, `import assert from 'node:assert/strict';import fs from 'node:fs';${load}
    const backend=new FileAuthStorageBackend(${JSON.stringify(path)});backend.ensureParentDir();
    const release=backend.acquireLockSyncWithRetry(${JSON.stringify(path)});
    try{const controller=new AbortController();const pending=backend.withLockAsync(()=>{throw Error('callback must not run');},{signal:controller.signal});
      controller.abort();await assert.rejects(pending);assert.equal(fs.existsSync(${JSON.stringify(path)}),false);
    }finally{release();}`);
});
test("SDK existing-file write preserves Darwin ACL", { skip: process.platform !== "darwin" }, async t => {
  const { path } = fixture(t); writeFileSync(path, "{}", { mode: 0o600 });
  const acl = spawnSync("chmod", ["+a", "everyone allow read", path], { encoding: "utf8" });
  assert.equal(acl.status, 0, acl.stderr);
  const inspect = () => {
    const result = spawnSync("ls", ["-le", path], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); return result.stdout.split("\n").slice(1).join("\n");
  };
  const before = inspect(); assert.match(before, /everyone allow read/);
  await child(t, `${load}const backend=new FileAuthStorageBackend(${JSON.stringify(path)});backend.withLock(()=>({result:null,next:'{"first":true}'}));await backend.withLockAsync(()=>({result:null,next:'{"second":true}'}));`);
  assert.equal(inspect(), before);
});

test("sync contender does not steal async lock before its first heartbeat", async t => {
  const { path } = fixture(t);
  await child(t, `import assert from 'node:assert/strict';import fs from 'node:fs';import {spawnSync} from 'node:child_process';${load}
    const backend=new FileAuthStorageBackend(${JSON.stringify(path)});backend.ensureParentDir();
    const release=await backend.acquireLockAsync(undefined,()=>{});
    try{
      // Детерминированная граница 10s < age < 15s: прежний sync stale=10s,
      // async stale=30s/update=15s. Меняется только mtime временного lock.
      const age=new Date(Date.now()-12000);fs.utimesSync(${JSON.stringify(path + ".lock")},age,age);
      const contender=spawnSync(process.execPath,['--input-type=module','-e',${JSON.stringify(`${load}
        try{new FileAuthStorageBackend(${JSON.stringify(path)}).withLock(()=>({result:null,next:'{"stolen":true}'}));}
        catch(error){if(error.code!=='ELOCKED')throw error;process.stdout.write('ELOCKED');}`)}],{encoding:'utf8'});
      assert.equal(contender.status,0,contender.stderr);assert.equal(contender.stdout,'ELOCKED');
      assert.equal(fs.existsSync(${JSON.stringify(path)}),false);
    }finally{await release();}`);
});
for (const phase of ["before-create", "during-callback"]) test(`compromised async lock prevents subsequent write (${phase})`, async t => {
  const { path } = fixture(t);
  await child(t, `import assert from 'node:assert/strict';import fs from 'node:fs';${load}
    const backend=new FileAuthStorageBackend(${JSON.stringify(path)});let releaseCalls=0,compromise;
    backend.acquireLockAsync=async(_signal,onCompromised)=>{compromise=onCompromised;
      if(${JSON.stringify(phase)}==='before-create')onCompromised(Error('fixture lock compromised'));
      return async()=>{releaseCalls++;};};
    let callbackCalls=0;
    await assert.rejects(backend.withLockAsync(async()=>{callbackCalls++;await Promise.resolve();compromise(Error('fixture lock compromised'));return {result:null,next:'{"mustNotWrite":true}'};}),/fixture lock compromised/);
    assert.equal(releaseCalls,1);assert.equal(callbackCalls,${phase === "before-create" ? 0 : 1});
    if(${JSON.stringify(phase)}==='before-create')assert.equal(fs.existsSync(${JSON.stringify(path)}),false);
    else assert.equal(fs.readFileSync(${JSON.stringify(path)},'utf8'),'{}');`);
});
