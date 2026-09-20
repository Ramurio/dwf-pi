import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
const script = fileURLToPath(new URL("../scripts/apply-sdk-provider-contracts.mjs", import.meta.url));
const patch = readFileSync(new URL("../patches/pi-ai-0.85.1-provider-contracts.patch", import.meta.url));
const spec = JSON.parse(readFileSync(new URL("../patches/pi-ai-0.85.1-provider-contracts.json", import.meta.url), "utf8"));
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
function copy(root: string) {
  mkdirSync(root, { recursive: true }); writeFileSync(join(root, "package.json"), JSON.stringify({ version: spec.version }));
  for (const file of Object.keys(spec.files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), readFileSync(new URL(`../node_modules/@earendil-works/pi-ai/${file}`, import.meta.url)));
  }
}
function pristine(root: string) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  env.GIT_CEILING_DIRECTORIES = dirname(root);
  execFileSync("git", ["apply", "-R", "-"], { cwd: root, env, input: patch });
}
function states(root: string) { return Object.keys(spec.files).map(file => hash(readFileSync(join(root, file)))); }

test("provider installer validates every SDK copy before writes and is idempotent", t => {
  const cwd = mkdtempSync(join(tmpdir(), "dwf-sdk-patch-")); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const root = join(cwd, "node_modules/@earendil-works/pi-ai"), nested = join(cwd, "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai");
  copy(root); copy(nested); pristine(root); pristine(nested);
  const before = states(root), firstFile = Object.keys(spec.files)[0]!;
  const nestedBefore = readFileSync(join(nested, firstFile)); writeFileSync(join(nested, firstFile), "unknown");
  const invoke = () => spawnSync(process.execPath, [script], { cwd, encoding: "utf8" });
  const refused = invoke(); assert.notEqual(refused.status, 0); assert.match(refused.stderr, /Unknown upstream/); assert.deepEqual(states(root), before);
  writeFileSync(join(nested, firstFile), nestedBefore);
  assert.equal(invoke().status, 0);
  const expected = Object.values(spec.files).map((hashes: any) => hashes[1]);
  assert.deepEqual(states(root), expected); assert.deepEqual(states(nested), expected);
  assert.equal(invoke().status, 0); assert.deepEqual(states(root), expected);
  writeFileSync(join(root, "package.json"), '{"version":"different"}');
  assert.match(invoke().stderr, /Expected local pi-ai/);
});

test("provider installer refuses external SDK symlink", t => {
  const cwd = mkdtempSync(join(tmpdir(), "dwf-sdk-alias-")); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const external = join(cwd, "external"); copy(external); pristine(external); const before = states(external);
  mkdirSync(join(cwd, "node_modules/@earendil-works"), { recursive: true }); symlinkSync(external, join(cwd, "node_modules/@earendil-works/pi-ai"));
  const result = spawnSync(process.execPath, [script], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /no external symlinks/); assert.deepEqual(states(external), before);
});
