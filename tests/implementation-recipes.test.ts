import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { applyPatch, createDraft } from "../src/authoring.js";
import { compileWorkflow } from "../src/compiler.js";
import { chooseEdge } from "../src/expressions.js";

const recipes = fileURLToPath(new URL("../skills/dynamic-workflows/recipes/implementation-review/", import.meta.url));
const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const snapshot = fs.readFileSync(path.join(recipes, "snapshot.mjs"), "utf8");
const verification = "const SNAPSHOT_SOURCE = " + JSON.stringify(snapshot) + ";\n" + fs.readFileSync(path.join(recipes, "verify-command.mjs"), "utf8");
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
function run(cwd: string, command: string, args: string[], env = cleanEnv) {
  return spawnSync(command, args, { cwd, env, encoding: "utf8", maxBuffer: Infinity });
}
function git(cwd: string, args: string[]) {
  const result = run(cwd, "git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args]);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function temporary(t: { after(fn: () => void): void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dwf-recipe-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function repository(dir: string) {
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.name", "Recipe test"]);
  git(dir, ["config", "user.email", "test@localhost"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  for (const file of ["tracked.txt", "deleted.txt", "staged.txt"]) fs.writeFileSync(path.join(dir, file), "base\n");
  fs.writeFileSync(path.join(dir, ".gitignore"), "ignored*\n");
  git(dir, ["add", "."]); git(dir, ["commit", "-qm", "base"]);
}
function author(directory: string) {
  const patch = read(path.join(directory, "patch.json"));
  const result = applyPatch(createDraft(read(path.join(directory, "create.json"))), { expectedRevision: patch.expectedRevision, operations: patch.operations });
  assert.equal(result.validation.valid, true, JSON.stringify(result.validation));
  compileWorkflow(result.workflow);
  return result.workflow;
}

for (const variant of ["S", "P", "C"]) test(`recipe ${variant}: official authoring, embedded sources and revision-bound routing`, () => {
  const directory = path.join(recipes, variant), workflow = author(directory);
  const input = read(path.join(directory, "input.json")), main = workflow.graphs.main!, pipeline = workflow.graphs.pipeline!;
  const check = pipeline.nodes.find(n => n.id === "check")!;
  const snap = pipeline.nodes.find(n => n.id === "snapshot")!;
  assert.equal(check.kind, "check"); assert.equal(snap.kind, "check");
  if (check.kind !== "check" || snap.kind !== "check") throw Error("Expected checks");
  assert.deepEqual(check.args, ["--input-type=module", "-e", verification, JSON.stringify({ command: input.checkCommand, args: input.checkArgs })]);
  assert.deepEqual(snap.args, ["--input-type=module", "-e", snapshot]);
  for (const node of pipeline.nodes) if (node.kind === "check" && node.id !== "check") {
    assert.deepEqual(node.args, ["--input-type=module", "-e", snapshot]);
  }
  const candidateNode = main.nodes.find(n => n.id === "candidate")!;
  assert.equal(candidateNode.kind, "worktree");
  assert(!JSON.stringify(workflow).includes('"kind":"integrate"'));
  const agents = Object.values(workflow.graphs).flatMap(g => g.nodes).filter(n => n.kind === "agent");
  assert.equal(agents.length, variant === "S" ? 3 : 4);
  for (const agent of agents) {
    assert.equal(agent.config?.thinking, agent.role === "planner" ? "xhigh" : agent.role === "implementer" ? "medium" : "high");
    assert.equal(agent.config?.session, agent.role === "implementer" ? "continue-node" : "fresh");
    assert(agent.config?.systemPrompt && agent.config?.outputSchema);
  }
  const route = (node: string, nodes: any, supplied = input) => chooseEdge(node, main.edges, { input: supplied, nodes });
  assert.equal(route("inputBinding", {}), "candidate");
  for (const wrong of [{}, { ...input, checkCommand: "unexpected" }, { ...input, checkArgs: [] }, { ...input, checkArgs: [...input.checkArgs, "extra"] }]) {
    assert.equal(route("inputBinding", {}, wrong), "invalidBinding");
  }
  const approval = { decision: "approve", artifactRevision: "git-tree:" + "a".repeat(40), acceptanceCriteriaRevision: input.acceptanceCriteriaRevision };
  const candidate = { result: { status: "accepted", checks: { exitCode: 0 }, artifactRevision: approval.artifactRevision, review: variant === "C" ? { correctness: { ...approval }, contract: { ...approval } } : { ...approval } } };
  assert.equal(route("candidate", { candidate }), "accepted");
  assert.equal(route("candidate", { candidate: { result: { status: "blocked" } } }), "inconclusive");
  const failed = structuredClone(candidate); failed.result.checks.exitCode = 7;
  assert.equal(route("candidate", { candidate: failed }), "inconclusive");
  for (const perspective of variant === "C" ? ["correctness", "contract"] : [null]) {
    for (const [key, value] of [["decision", "request_changes"], ["decision", "inconclusive"], ["artifactRevision", "stale"], ["acceptanceCriteriaRevision", "stale"]]) {
      const denied: any = structuredClone(candidate);
      const review = perspective ? denied.result.review[perspective] : denied.result.review;
      review[key!] = value;
      assert.equal(route("candidate", { candidate: denied }), "inconclusive");
    }
  }
  assert.equal(chooseEdge("check", pipeline.edges, { input, nodes: { check: { exitCode: 7 } } }), "implement");
  const reviewId = variant === "C" ? "reviews" : "review";
  const denied = variant === "C" ? { correctness: { decision: "approve" }, contract: { decision: "inconclusive" } } : { decision: "request_changes" };
  assert.equal(chooseEdge(reviewId, pipeline.edges, { input, nodes: { [reviewId]: denied } }), "implement");
  assert.equal(chooseEdge("implement", pipeline.edges, { input, nodes: { implement: { status: "blocked" } } }), "blocked");
});

for (const linked of [false, true]) test(`snapshot matches actual staging with original index preserved (${linked ? "linked worktree" : "checkout"})`, t => {
  const root = temporary(t); repository(root);
  const cwd = linked ? path.join(root, "linked") : root;
  if (linked) git(root, ["worktree", "add", "-qb", "candidate", cwd]);
  const index = git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
  const compare = () => {
    const before = fs.existsSync(index) ? fs.readFileSync(index) : null;
    const result = run(cwd, process.execPath, [path.join(recipes, "snapshot.mjs")]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.existsSync(index) ? fs.readFileSync(index) : null, before);
    git(cwd, ["add", "--all", "--", "."]);
    assert.equal(result.stdout, "git-tree:" + git(cwd, ["write-tree"]));
    return result.stdout;
  };
  assert.equal(compare(), "git-tree:" + git(cwd, ["rev-parse", "HEAD^{tree}"]));
  fs.writeFileSync(path.join(cwd, "staged.txt"), "staged\n"); git(cwd, ["add", "staged.txt"]);
  fs.writeFileSync(path.join(cwd, "staged.txt"), "unstaged after staged\n");
  fs.writeFileSync(path.join(cwd, "tracked.txt"), "unstaged\n");
  fs.writeFileSync(path.join(cwd, "untracked.txt"), "untracked\n");
  fs.rmSync(path.join(cwd, "deleted.txt"));
  fs.writeFileSync(path.join(cwd, "ignored-forced.txt"), "included\n"); git(cwd, ["add", "--force", "ignored-forced.txt"]);
  fs.writeFileSync(path.join(cwd, "ignored-untracked.txt"), "excluded\n");
  compare();
  assert.match(git(cwd, ["ls-files"]), /ignored-forced/);
  assert(!git(cwd, ["ls-files"]).includes("ignored-untracked"));
  // Missing index has the same semantics as the runtime's git add, not read-tree HEAD.
  fs.rmSync(index); compare();
  assert(!git(cwd, ["ls-files"]).includes("ignored-forced"));
});

test("snapshot rejects nested cwd and inherited Git environment overrides", t => {
  const root = temporary(t); repository(root);
  fs.mkdirSync(path.join(root, "nested"));
  assert.notEqual(run(path.join(root, "nested"), process.execPath, [path.join(recipes, "snapshot.mjs")]).status, 0);
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG", "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS"]) {
    const result = run(root, process.execPath, [path.join(recipes, "snapshot.mjs")], { ...cleanEnv, [key]: "invalid" });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Unsupported inherited Git/);
  }
});

test("verification preserves large output, literal argv, actual exits, start evidence and artifact stability", t => {
  const root = temporary(t); repository(root);
  const verify = (command: string, args: string[]) => {
    const result = run(root, process.execPath, ["--input-type=module", "-e", verification, JSON.stringify({ command, args })]);
    const report = JSON.parse(result.stdout);
    assert.equal(result.status, report.exitCode);
    return report;
  };
  for (const code of [0, 7]) {
    const report = verify(process.execPath, ["-e", `process.stdout.write('a'.repeat(2*1024*1024));process.stderr.write('b'.repeat(2*1024*1024));process.exitCode=${code}`]);
    assert.equal(report.stdout.length, 2 * 1024 * 1024); assert.equal(report.stderr.length, 2 * 1024 * 1024);
    assert.equal(report.commandExecuted, true); assert.equal(report.commandExitCode, code);
    assert.equal(report.artifactStable, true); assert.equal(report.exitCode, code === 0 ? 0 : 1);
  }
  for (const code of [0, 7]) {
    const report = verify(process.execPath, ["-e", `console.log('banner\\n{"exitCode":${code === 0 ? 999 : 0}}\\nTAP version 13');process.exitCode=${code}`]);
    assert.equal(report.commandExitCode, code); assert.equal(report.exitCode, code === 0 ? 0 : 1);
  }
  const literal = "$(touch injected) `touch injected2` ;";
  assert.equal(verify(process.execPath, ["-e", "process.stdout.write(process.argv[1])", literal]).stdout, literal);
  assert(!fs.existsSync(path.join(root, "injected")));
  const absent = verify(path.join(root, "nonexistent-command"), []);
  assert.equal(absent.commandExecuted, false); assert.equal(absent.exitCode, 1);
  const killed = verify(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"]);
  assert.equal(killed.commandExecuted, true); assert.equal(killed.signal, "SIGTERM"); assert.equal(killed.exitCode, 1);
  const mutated = verify(process.execPath, ["-e", "require('node:fs').writeFileSync('tracked.txt','changed')"]);
  assert.equal(mutated.commandExitCode, 0); assert.equal(mutated.artifactStable, false); assert.equal(mutated.exitCode, 1);
});

test("instantiate rejects canonical source aliases before writing and binds distinct output", t => {
  const root = temporary(t), source = path.join(root, "recipe");
  fs.cpSync(path.join(recipes, "P"), source, { recursive: true });
  const before = fs.readFileSync(path.join(source, "patch.json"));
  const params = read(path.join(recipes, "parameters.example.json")); params.id = "rebound"; params.checkArgs = ["-e", "process.exitCode=0"];
  const parameters = path.join(root, "parameters.json"); fs.writeFileSync(parameters, JSON.stringify(params));
  const instantiate = (out: string) => run(root, process.execPath, [path.join(recipes, "instantiate.mjs"), "--recipe", source, "--parameters", parameters, "--out", out]);
  const alias = path.join(root, "alias"); fs.symlinkSync(source, alias, "dir");
  const parentAlias = path.join(root, "parent-alias"); fs.symlinkSync(root, parentAlias, "dir");
  for (const out of [source, alias, path.join(parentAlias, "recipe"), path.join(alias, "new-output")]) {
    assert.notEqual(instantiate(out).status, 0);
    assert.deepEqual(fs.readFileSync(path.join(source, "patch.json")), before);
    assert(!fs.existsSync(path.join(source, "new-output")));
  }
  const out = path.join(parentAlias, "new", "output");
  const result = instantiate(out); assert.equal(result.status, 0, result.stderr);
  const workflow = author(out), input = read(path.join(out, "input.json"));
  const check = workflow.graphs.pipeline!.nodes.find(n => n.id === "check")!;
  assert.equal(check.kind, "check"); if (check.kind !== "check") throw Error("Expected check");
  assert.deepEqual(JSON.parse(check.args![3]!), { command: params.checkCommand, args: params.checkArgs });
  assert.equal(chooseEdge("inputBinding", workflow.graphs.main!.edges, { input, nodes: {} }), "candidate");
  assert.equal(chooseEdge("inputBinding", workflow.graphs.main!.edges, { input: { ...input, checkArgs: ["other"] }, nodes: {} }), "invalidBinding");
  assert.deepEqual(fs.readFileSync(path.join(source, "patch.json")), before);
});

test("instantiate rejects hardlinked output before changing any source or output", t => {
  const root = temporary(t), source = path.join(root, "recipe"), out = path.join(root, "output");
  fs.cpSync(path.join(recipes, "S"), source, { recursive: true }); fs.mkdirSync(out);
  const names = ["create", "patch", "input", "validate"];
  for (const name of names) fs.linkSync(path.join(source, `${name}.json`), path.join(out, `${name}.json`));
  const before = names.map(name => fs.readFileSync(path.join(source, `${name}.json`)));
  const params = read(path.join(recipes, "parameters.example.json")); params.id = "hardlinkAlias";
  const parameters = path.join(root, "parameters.json"); fs.writeFileSync(parameters, JSON.stringify(params));
  const result = run(root, process.execPath, [path.join(recipes, "instantiate.mjs"), "--recipe", source, "--parameters", parameters, "--out", out]);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /hardlinks/);
  for (const [i, name] of names.entries()) assert.deepEqual(fs.readFileSync(path.join(source, `${name}.json`)), before[i]);
  assert.equal(fs.existsSync(path.join(out, "instantiation.json")), false);
});
