import { readFileSync, realpathSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, lstatSync, openSync, closeSync, fsyncSync, fchmodSync, renameSync, unlinkSync } from "node:fs";
import { resolve, sep, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const definitions = [
  { id: "bash-signal", label: "O07", packageName: "pi-coding-agent", file: "pi-coding-agent-0.85.1-bash-signal", candidates: ["@earendil-works/pi-coding-agent"] },
  { id: "provider-contracts", label: "SDK provider contracts", packageName: "local pi-ai", file: "pi-ai-0.85.1-provider-contracts", candidates: ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai"] },
];
const hash = content => createHash("sha256").update(content).digest("hex");
const repair = "Run npm run sdk:apply for known original/patched files; otherwise reinstall pinned dependencies with npm ci.";
const entry = path => { try { return lstatSync(path); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; } };

// Проверка ничего не записывает и не импортирует SDK/учётные данные.
function inspect(cwd, selected) {
  const modules = resolve(cwd, "node_modules");
  return definitions.filter(def => selected.includes(def.id)).flatMap(def => {
    const spec = JSON.parse(readFileSync(new URL(`../patches/${def.file}.json`, import.meta.url), "utf8"));
    const roots = [...new Set(def.candidates.filter(name => entry(resolve(modules, name))).map(name => realpathSync(resolve(modules, name))))];
    if (!roots.length) throw Error(`Missing project-local ${def.packageName}`);
    return roots.map(root => {
      if (!root.startsWith(modules + sep)) throw Error("SDK must be inside cwd/node_modules (no external symlinks)");
      const manifest = realpathSync(resolve(root, "package.json"));
      if (!manifest.startsWith(root + sep)) throw Error("External SDK manifest");
      if (JSON.parse(readFileSync(manifest, "utf8")).version !== spec.version) throw Error(`Expected ${def.packageName} ${spec.version}`);
      const files = Object.entries(spec.files).map(([file, hashes]) => {
        const path = resolve(root, file), info = lstatSync(path);
        if (!info.isFile() || info.nlink !== 1 || realpathSync(path) !== path) throw Error(`SDK file must be regular, unaliased and project-local: ${file}`);
        const before = readFileSync(path), state = hashes.indexOf(hash(before));
        if (state < 0) throw Error(`Unknown upstream contents: ${file}`);
        return { file, path, hashes, before, state, mode: info.mode & 0o777 };
      });
      return { ...def, root, version: spec.version, files };
    });
  });
}

function atomicReplace(path, content, mode) {
  const temporary = resolve(dirname(path), `.${basename(path)}.dynamicwf-${randomUUID()}.tmp`);
  let fd;
  try {
    fd = openSync(temporary, "wx", mode);
    writeFileSync(fd, content); fchmodSync(fd, mode); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export function manageSdkPatches({ cwd = process.cwd(), selected = definitions.map(def => def.id), check = false } = {}) {
  cwd = realpathSync(cwd);
  if (check) return applySdkPatches(cwd, selected, true);
  if (realpathSync(resolve(cwd, "node_modules")) !== resolve(cwd, "node_modules")) throw Error("SDK must be inside cwd/node_modules (no external symlinks)");
  const directory = resolve(cwd, "node_modules/.dynamicwf-sdk-patches");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (realpathSync(directory) !== directory || !lstatSync(directory).isDirectory()) throw Error("SDK installation lock must be project-local");
  const filename = resolve(directory, "lock.sqlite");
  for (const path of [filename, filename + "-journal", filename + "-wal", filename + "-shm"]) {
    const info = entry(path);
    if (info) {
      if (!info.isFile() || info.nlink !== 1 || realpathSync(path) !== path) throw Error("Unsafe SDK installation lock");
    }
  }
  // Блокировка освобождается SQLite/ОС даже при SIGKILL. Второй установщик
  // получает явный отказ; его успех нельзя отменить откатом первого.
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
  const lock = new DatabaseSync(filename);
  let owned = false;
  try {
    try { lock.exec("BEGIN IMMEDIATE"); owned = true; }
    catch (error) {
      if (error.errcode === 5 || error.errcode === 6) throw new Error("SDK installation is busy; wait for the other installer and retry", { cause: error });
      throw error;
    }
    return applySdkPatches(cwd, selected, false);
  } finally { try { if (owned) lock.exec("ROLLBACK"); } finally { lock.close(); } }
}

function applySdkPatches(cwd, selected, check) {
  const targets = inspect(cwd, selected);
  if (check) {
    const missing = targets.flatMap(target => target.files.filter(file => file.state !== 1).map(file => `${target.id}: ${file.path}`));
    if (missing.length) throw Error(`SDK patches are incomplete: ${missing.join(", ")}. ${repair}`);
    return { ok: true, patches: targets.map(target => ({ id: target.id, version: target.version, root: target.root, files: target.files.length })) };
  }
  if (targets.every(target => target.files.every(file => file.state === 1))) return { ok: true, changed: 0, targets };
  const staging = mkdtempSync(resolve(cwd, ".sdk-patch-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  env.GIT_CEILING_DIRECTORIES = cwd;
  const writes = [], committed = [];
  try {
    for (const [index, target] of targets.entries()) {
      if (target.files.every(file => file.state === 1)) continue;
      const stage = resolve(staging, String(index));
      for (const file of target.files) { mkdirSync(dirname(resolve(stage, file.file)), { recursive: true }); writeFileSync(resolve(stage, file.file), file.before); }
      const patch = readFileSync(new URL(`../patches/${target.file}.patch`, import.meta.url));
      // После обрыва каждый файл целиком исходный или исправленный. Временную
      // копию приводим к исходной версии, затем проверяем весь патч как обычно.
      const patched = target.files.filter(file => file.state === 1);
      if (patched.length) execFileSync("git", ["apply", "-R", ...patched.map(file => `--include=${file.file}`), "-"], { cwd: stage, env, input: patch });
      for (const file of target.files) if (hash(readFileSync(resolve(stage, file.file))) !== file.hashes[0]) throw Error(`Original hash mismatch: ${file.file}`);
      execFileSync("git", ["apply", "--check", "-"], { cwd: stage, env, input: patch });
      execFileSync("git", ["apply", "-"], { cwd: stage, env, input: patch });
      for (const file of target.files) {
        const content = readFileSync(resolve(stage, file.file));
        if (hash(content) !== file.hashes[1]) throw Error(`Post-patch hash mismatch: ${file.file}`);
        if (file.state === 0) writes.push({ ...file, content });
      }
    }
    // Все пакеты и результаты проверены до первой записи. Файлы публикуются
    // заменой целиком; при обычной ошибке возвращаем собственные записи назад.
    for (const file of writes) {
      if (realpathSync(file.path) !== file.path || !readFileSync(file.path).equals(file.before)) throw Error(`SDK changed during installation: ${file.path}`);
      atomicReplace(file.path, file.content, file.mode); committed.push(file);
    }
    manageSdkPatches({ cwd, selected, check: true });
    return { ok: true, changed: writes.length, targets };
  } catch (error) {
    const failures = [error];
    for (const file of committed.reverse()) {
      try {
        if (realpathSync(file.path) !== file.path || !readFileSync(file.path).equals(file.content)) throw Error(`Cannot roll back changed SDK file: ${file.path}`);
        atomicReplace(file.path, file.before, file.mode);
      } catch (rollback) { failures.push(rollback); }
    }
    if (failures.length > 1) throw new AggregateError(failures, failures.map(failure => failure.message).join("; "));
    throw error;
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

export function runSdkPatchCli(selected) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== "--check") || args.length > 1) throw Error("Usage: sdk-patches.mjs [--check]");
    const result = manageSdkPatches({ ...(selected ? { selected } : {}), check: args.includes("--check") });
    if (args.includes("--check")) console.log(JSON.stringify(result));
    else for (const label of new Set(result.targets.map(target => target.label))) console.log(`${label}: ${result.changed ? "applied" : "already applied"}`);
  } catch (error) { console.error(`SDK patch refused: ${error.message}. ${repair}`); process.exitCode = 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runSdkPatchCli();
