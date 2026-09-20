import { readFileSync, realpathSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, sep, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const spec = JSON.parse(readFileSync(new URL("../patches/pi-ai-0.85.1-provider-contracts.json", import.meta.url), "utf8"));
const hash = content => createHash("sha256").update(content).digest("hex");
try {
  const cwd = realpathSync(process.cwd()), modules = resolve(cwd, "node_modules");
  const candidates = ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai"];
  const roots = candidates.filter(name => existsSync(resolve(modules, name))).map(name => realpathSync(resolve(modules, name)));
  if (!roots.length) throw Error("Missing project-local pi-ai");
  const targets = [...new Set(roots)].map(root => {
    if (!root.startsWith(modules + sep)) throw Error("SDK must be inside cwd/node_modules (no external symlinks)");
    const manifest = realpathSync(resolve(root, "package.json"));
    if (!manifest.startsWith(root + sep) || JSON.parse(readFileSync(manifest, "utf8")).version !== spec.version) throw Error("Expected local pi-ai " + spec.version);
    const states = Object.entries(spec.files).map(([file, hashes]) => {
      const path = realpathSync(resolve(root, file));
      if (!path.startsWith(root + sep)) throw Error(`External SDK file: ${file}`);
      const state = hashes.indexOf(hash(readFileSync(path)));
      if (state < 0) throw Error(`Unknown upstream contents: ${file}`);
      return state;
    });
    if (!states.every(state => state === states[0])) throw Error("Mixed provider patch state; reinstall dependencies");
    return { root, patched: states[0] === 1 };
  });
  const patch = readFileSync(new URL("../patches/pi-ai-0.85.1-provider-contracts.patch", import.meta.url));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  env.GIT_CEILING_DIRECTORIES = cwd;
  const staging = mkdtempSync(resolve(cwd, ".provider-patch-"));
  try {
    const writes = [];
    for (const [index, target] of targets.entries()) {
      if (target.patched) continue;
      const stage = resolve(staging, String(index));
      for (const file of Object.keys(spec.files)) {
        mkdirSync(dirname(resolve(stage, file)), { recursive: true });
        writeFileSync(resolve(stage, file), readFileSync(resolve(target.root, file)));
      }
      execFileSync("git", ["apply", "--check", "-"], { cwd: stage, env, input: patch });
      execFileSync("git", ["apply", "-"], { cwd: stage, env, input: patch });
      for (const [file, hashes] of Object.entries(spec.files)) {
        const content = readFileSync(resolve(stage, file));
        if (hash(content) !== hashes[1]) throw Error(`Post-patch hash mismatch: ${file}`);
        writes.push({ path: resolve(target.root, file), content, expected: hashes[1] });
      }
    }
    // Проверены все экземпляры SDK до первой записи установленного файла.
    for (const item of writes) writeFileSync(item.path, item.content);
    for (const item of writes) if (hash(readFileSync(item.path)) !== item.expected) throw Error("Installed provider patch mismatch");
    console.log(`SDK provider contracts: ${writes.length ? "applied" : "already applied"} (${targets.length} SDK copies)`);
  } finally { rmSync(staging, { recursive: true, force: true }); }
} catch (error) { console.error(`SDK provider patch refused: ${error.message}`); process.exitCode = 1; }
