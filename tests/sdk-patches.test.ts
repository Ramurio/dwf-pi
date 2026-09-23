import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, lstatSync, symlinkSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const installation = fileURLToPath(new URL("../", import.meta.url));
const script = join(installation, "scripts/sdk-patches.mjs");
const specs = [
  ["@earendil-works/pi-coding-agent", "pi-coding-agent-0.85.1-auth-creation"],
  ["@earendil-works/pi-coding-agent", "pi-coding-agent-0.85.1-bash-signal"],
  ["@earendil-works/pi-ai", "pi-ai-0.85.1-provider-contracts"],
  ["@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai", "pi-ai-0.85.1-provider-contracts"],
] as const;
function fixture(t: TestContext) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "dwf-sdk-recovery-")));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const files: { path: string; original: string; patched: string }[] = [];
  for (const [name, specName] of specs) {
    const root = join(cwd, "node_modules", name);
    const spec = JSON.parse(readFileSync(join(installation, "patches", specName + ".json"), "utf8")) as { version: string; files: Record<string, [string, string]> };
    mkdirSync(root, { recursive: true }); writeFileSync(join(root, "package.json"), JSON.stringify({ version: spec.version }));
    for (const [file, hashes] of Object.entries(spec.files)) {
      const path = join(root, file); mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, readFileSync(join(installation, "node_modules", name, file)));
      files.push({ path, original: hashes[0], patched: hashes[1] });
    }
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
    execFileSync("git", ["apply", "-R", "-"], { cwd: root, env: { ...env, GIT_CEILING_DIRECTORIES: cwd }, input: readFileSync(join(installation, "patches", specName + ".patch")) });
  }
  const hashes = () => files.map(file => createHash("sha256").update(readFileSync(file.path)).digest("hex"));
  const invoke = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
  return { cwd, files, hashes, invoke };
}

test("SDK check is read-only and the unified installer validates all packages before changing any", t => {
  const f = fixture(t), before = f.hashes(), entries = readdirSync(f.cwd);
  const missing = f.invoke("--check");
  assert.notEqual(missing.status, 0); assert.match(missing.stderr, /incomplete/);
  assert.deepEqual(f.hashes(), before); assert.deepEqual(readdirSync(f.cwd), entries);
  const last = f.files.at(-1)!, bytes = readFileSync(last.path); writeFileSync(last.path, "unknown upstream");
  assert.match(f.invoke().stderr, /Unknown upstream/);
  assert.deepEqual(f.hashes().slice(0, -1), before.slice(0, -1));
  writeFileSync(last.path, bytes);
  assert.equal(f.invoke().status, 0); assert.deepEqual(f.hashes(), f.files.map(file => file.patched));
  const after = f.hashes(); assert.equal(JSON.parse(f.invoke("--check").stdout).patches.length, specs.length);
  assert.deepEqual(f.hashes(), after); assert.match(f.invoke().stdout, /already applied/);
});

test("SDK publish failure rolls back earlier files across package boundaries", t => {
  const f = fixture(t), before = f.hashes();
  const preload = join(f.cwd, "fail.cjs"), publishedFile = join(f.cwd, "published.json");
  const providerPrefix = join(f.cwd, "node_modules/@earendil-works/pi-ai") + "/";
  const failAt = f.files.filter(file => file.path.startsWith(providerPrefix))[1]!.path;
  writeFileSync(preload, `const fs=require('node:fs');const rename=fs.renameSync;const published=[];
fs.renameSync=function(from,to){if(to===${JSON.stringify(failAt)}){fs.writeFileSync(${JSON.stringify(publishedFile)},JSON.stringify(published));throw Error('injected publish failure');}
const result=rename(from,to);published.push(to);return result;};
require('node:module').syncBuiltinESMExports();`);
  const result = spawnSync(process.execPath, ["--require", preload, script], { cwd: f.cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /injected publish failure/);
  const published = JSON.parse(readFileSync(publishedFile, "utf8")) as string[];
  assert.ok(published.some(path => path.startsWith(join(f.cwd, "node_modules/@earendil-works/pi-coding-agent") + "/")));
  assert.ok(published.some(path => path.startsWith(providerPrefix)));
  assert.deepEqual(f.hashes(), before);
  assert.equal(f.invoke().status, 0); assert.deepEqual(f.hashes(), f.files.map(file => file.patched));
});

test("SIGKILL after an atomic SDK file replacement leaves a detectable mixture that the next apply repairs", { skip: process.platform === "win32" }, t => {
  const f = fixture(t), preload = join(f.cwd, "kill.cjs");
  writeFileSync(preload, `const fs=require('node:fs');const rename=fs.renameSync;let count=0;
fs.renameSync=function(...args){const result=rename(...args);if(++count===6)process.kill(process.pid,'SIGKILL');return result};
require('node:module').syncBuiltinESMExports();`);
  const killed = spawnSync(process.execPath, ["--require", preload, script], { cwd: f.cwd, encoding: "utf8" });
  assert.equal(killed.signal, "SIGKILL");
  const interrupted = f.hashes();
  assert.ok(interrupted.some((hash, i) => hash === f.files[i]!.original));
  assert.ok(interrupted.some((hash, i) => hash === f.files[i]!.patched));
  interrupted.forEach((hash, i) => assert.ok([f.files[i]!.original, f.files[i]!.patched].includes(hash)));
  assert.notEqual(f.invoke("--check").status, 0); assert.deepEqual(f.hashes(), interrupted);
  assert.equal(f.invoke().status, 0); assert.deepEqual(f.hashes(), f.files.map(file => file.patched));
  assert.equal(f.invoke("--check").status, 0);
  f.files.forEach(file => assert.equal(lstatSync(file.path).nlink, 1));
});

test("concurrent apply cannot report success while another installer may roll back", t => {
  const f = fixture(t), preload = join(f.cwd, "race.cjs"), resultFile = join(f.cwd, "second.json");
  writeFileSync(preload, `const fs=require('node:fs');const rename=fs.renameSync;let once=false;
fs.renameSync=function(...args){const result=rename(...args);if(!once){once=true;
const child=require('node:child_process').spawnSync(process.execPath,[${JSON.stringify(script)}],{cwd:process.cwd(),encoding:'utf8'});
fs.writeFileSync(${JSON.stringify(resultFile)},JSON.stringify({status:child.status,stderr:child.stderr}));}return result};
require('node:module').syncBuiltinESMExports();`);
  const first = spawnSync(process.execPath, ["--require", preload, script], { cwd: f.cwd, encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  const second = JSON.parse(readFileSync(resultFile, "utf8"));
  assert.notEqual(second.status, 0); assert.match(second.stderr, /installation is busy/);
  assert.deepEqual(f.hashes(), f.files.map(file => file.patched));
  assert.equal(f.invoke().status, 0);
});

test("atomic SDK replacement preserves file permissions even with a restrictive umask", t => {
  const f = fixture(t), before = f.files.map(file => lstatSync(file.path).mode & 0o777);
  const preload = join(f.cwd, "umask.cjs"); writeFileSync(preload, "process.umask(0o077);");
  const result = spawnSync(process.execPath, ["--require", preload, script], { cwd: f.cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.files.map(file => lstatSync(file.path).mode & 0o777), before);
});

for (const suffix of ["", "-journal", "-wal", "-shm"]) test(`SDK lock rejects dangling symlinks before SQLite opens them (${suffix || "database"})`, t => {
  const f = fixture(t), before = f.hashes();
  const directory = join(f.cwd, "node_modules/.dynamicwf-sdk-patches"), external = join(f.cwd, "outside-lock");
  mkdirSync(directory); symlinkSync(external, join(directory, "lock.sqlite" + suffix));
  const result = f.invoke(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Unsafe SDK installation lock/);
  assert.equal(existsSync(external), false); assert.deepEqual(f.hashes(), before);
});
