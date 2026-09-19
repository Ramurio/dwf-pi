import { readFileSync, realpathSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, sep, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const expected = {
  "dist/utils/child-process.js": [
    "cfc7b3361e42b61ee75aecc2b436ff7462f7e4431b4b646da7166f3c5706c9b8",
    "f671e3dc0f487748594222cbb5691fe8d6f807f8a3e6646be66d3ac7ae2b3e3a"
  ],
  "dist/utils/child-process.d.ts": [
    "07d4c7fbe2fa57981b5d3a9feefd3dd56376cf370a086c03accb36df1a341b02",
    "202d976dfa515e17eb71458b99ca817a8ddeb94406c782fefc686b01883be226"
  ],
  "dist/core/tools/bash.js": [
    "5f5bc414757f2b4888c9300646d14518979cda638c68ba1836acca8835dd280a",
    "626ad6cd341a436ce6c2e8d0f6769c72574bfefdf25e0f31a36a9be12f4802a1"
  ],
  "dist/core/tools/bash.d.ts": [
    "7e7032a3ea31f4e63e55adb81b5d76dee9900ea4a0ff286b858cebe7d2d70d29",
    "1378d2015460607360ede9acdbee0506dfb7a23870fdfc330076cf2fee1394ac"
  ]
};
try {
  const cwd = realpathSync(process.cwd());
  const modules = resolve(cwd, "node_modules");
  const root = realpathSync(resolve(modules, "@earendil-works/pi-coding-agent"));
  if (!root.startsWith(modules + sep)) throw Error("SDK must be inside cwd/node_modules (no external symlinks)");
  const manifest = realpathSync(resolve(root, "package.json"));
  if (!manifest.startsWith(root + sep)) throw Error("External SDK manifest");
  if (JSON.parse(readFileSync(manifest, "utf8")).version !== "0.85.1") throw Error("Expected pi-coding-agent 0.85.1");
  const states = Object.entries(expected).map(([file, hashes]) => {
    const path = realpathSync(resolve(root, file));
    if (!path.startsWith(root + sep)) throw Error(`External SDK file: ${file}`);
    const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
    const state = hashes.indexOf(hash);
    if (state < 0) throw Error(`Unknown upstream contents: ${file}`);
    return state;
  });
  if (states.every(state => state === 1)) console.log("O07: already applied");
  else {
    if (!states.every(state => state === 0)) throw Error("Mixed patch state; reinstall dependencies");
    const patch = readFileSync(new URL("../patches/pi-coding-agent-0.85.1-bash-signal.patch", import.meta.url));
    // Apply in an isolated non-repository directory, never relative to an enclosing
    // checkout/worktree. Ignore inherited Git routing (GIT_DIR, GIT_WORK_TREE, etc.).
    const staging = mkdtempSync(resolve(cwd, ".o07-patch-"));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
    env.GIT_CEILING_DIRECTORIES = cwd;
    try {
      for (const file of Object.keys(expected)) {
        mkdirSync(dirname(resolve(staging, file)), { recursive: true });
        writeFileSync(resolve(staging, file), readFileSync(resolve(root, file)));
      }
      execFileSync("git", ["apply", "--check", "-"], { cwd: staging, env, input: patch });
      execFileSync("git", ["apply", "-"], { cwd: staging, env, input: patch });
      const verified = Object.entries(expected).map(([file, hashes]) => {
        const content = readFileSync(resolve(staging, file));
        if (createHash("sha256").update(content).digest("hex") !== hashes[1]) {
          throw Error(`Post-patch hash mismatch: ${file}`);
        }
        return [file, content];
      });
      // No installed file is changed unless all four staged results are exact.
      for (const [file, content] of verified) writeFileSync(resolve(root, file), content);
      for (const [file, hashes] of Object.entries(expected)) {
        if (createHash("sha256").update(readFileSync(resolve(root, file))).digest("hex") !== hashes[1]) {
          throw Error(`Installed hash mismatch: ${file}`);
        }
      }
      console.log("O07: applied project-local bash signal patch");
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
} catch (error) {
  console.error(`O07 patch refused: ${error.message}`);
  process.exitCode = 1;
}
