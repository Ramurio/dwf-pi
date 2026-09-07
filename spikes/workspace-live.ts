/** Opt-in live Git+pi integration probe. Runs only in a disposable Git repository, never this project's Git tree. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { WorkflowService } from "../src/service.js";
import { RunController } from "../src/run-controller.js";
import type { Expr, Graph, Json, Node } from "../src/graph.js";

const { values } = parseArgs({ options: { provider: { type: "string" }, model: { type: "string" }, output: { type: "string" } } });
if (!values.provider || !values.model) throw new Error("Live probe requires explicit --provider and --model");
const selected = { provider: values.provider, id: values.model };
const literal = (value: Json): Expr => ({ op: "literal", value });
const ref = (...path: string[]): Expr => ({ op: "ref", path });
const object = (fields: Record<string, Expr>): Expr => ({ op: "object", fields });
const equal = (left: Expr, right: Expr): Expr => ({ op: "eq", left, right });
const checkCommand = "import assert from 'node:assert/strict'; import {answer} from './answer.mjs'; assert.equal(answer(),42); console.log(JSON.stringify({cwd:process.cwd(),answer:answer()}));";
const check = (id: string): Node => ({ id, kind: "check", command: process.execPath, args: ["--input-type=module", "-e", checkCommand] });
const graphs: Record<string, Graph> = {
  main: {
    entry: "candidate",
    nodes: [
      { id: "candidate", kind: "worktree", graphId: "implementation", input: ref("input") },
      { id: "review", kind: "agent", role: "reviewer", config: { model: selected, thinking: "low" },
        task: literal("Independently review the actual answer.mjs file in the supplied workspacePath. Read the file using your read tool. Requirement: it must export answer() returning 42 by computing 6 * 7. The supplied checkResult is evidence from the real Node assertion run in that workspace. Do not modify files. Approve only if the actual source and check support the requirement, otherwise request_changes or inconclusive. Echo the exact supplied artifactRevision and acceptanceCriteriaRevision in submit_result; findings and summary must reflect your actual inspection."),
        input: object({ workspacePath: ref("nodes", "candidate", "workspace", "path"), artifactRevision: ref("nodes", "candidate", "workspace", "head"), acceptanceCriteriaRevision: literal("answer-six-times-seven-v1"), checkResult: ref("nodes", "candidate", "result") }) },
      { id: "merge", kind: "integrate", sources: { op: "array", items: [ref("nodes", "candidate")] } },
      check("rootCheck"),
      { id: "done", kind: "end", value: object({ approved: literal(true), candidate: ref("nodes", "candidate"), review: ref("nodes", "review"), integration: ref("nodes", "merge"), rootCheck: ref("nodes", "rootCheck") }) },
      { id: "declined", kind: "end", value: object({ approved: literal(false), candidate: ref("nodes", "candidate"), review: ref("nodes", "review") }) },
    ],
    edges: [
      { from: "candidate", to: "review" },
      { from: "review", to: "merge", when: equal(ref("nodes", "review", "decision"), literal("approve")) },
      { from: "review", to: "declined" }, { from: "merge", to: "rootCheck" }, { from: "rootCheck", to: "done" },
    ],
  },
  implementation: {
    entry: "implement",
    nodes: [
      { id: "implement", kind: "agent", role: "implementer", config: { model: selected, thinking: "low" },
        task: literal("In your assigned current working directory inspect answer.mjs and change it so exported answer() returns 42 by computing 6 * 7. Keep the change minimal. Use the actual file tools; do not merely describe the edit. Do not commit or switch branches: the workflow runtime commits after the actual check passes. If previousCheck is supplied, repair the demonstrated failure. Submit result through submit_result with a result object describing changed files and your actual current directory."),
        input: object({ request: ref("input"), previousCheck: { op: "select", when: { op: "exists", value: ref("nodes", "verify") }, then: ref("nodes", "verify"), otherwise: literal(null) } }) },
      check("verify"),
      { id: "done", kind: "end", value: ref("nodes", "verify") },
    ],
    edges: [{ from: "implement", to: "verify" }, { from: "verify", to: "done", when: equal(ref("nodes", "verify", "exitCode"), literal(0)) }, { from: "verify", to: "implement" }],
  },
};

const directory = await realpath(await mkdtemp(join(tmpdir(), "dynamicwf-workspace-live-")));
const repo = join(directory, "repo"); await mkdir(repo);
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Workspace Probe", "-c", "user.email=workspace-probe@localhost", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
git("init", "-b", "main");
await writeFile(join(repo, "answer.mjs"), "export const answer = () => 41;\n");
git("add", "answer.mjs"); git("commit", "-m", "Initial failing answer fixture");
const base = git("rev-parse", "HEAD");
const filename = join(directory, "state.sqlite");
const service = new WorkflowService(filename, { cwd: repo });
const controller = new RunController(filename);
let runId: string | undefined;
let evidence: Record<string, unknown> | undefined;
try {
  await service.dispatch("workflow.create", { id: "workspace-live", name: "Live pi worktree and independent review" });
  const operations: unknown[] = [{ op: "addGraph", graphId: "implementation" }];
  for (const [graphId, graph] of Object.entries(graphs)) {
    for (const node of graph.nodes) operations.push({ op: "addNode", graphId, node });
    for (const edge of graph.edges) operations.push({ op: "connect", graphId, edge });
  }
  const patched = await service.dispatch("workflow.patch", { id: "workspace-live", expectedRevision: 1, operations }) as { validation: { valid: boolean } };
  assert.equal(patched.validation.valid, true);
  const started = await service.dispatch("run.start", { id: "workspace-live", input: { request: "Make answer() return 42 by computing 6 * 7" } }) as { id: string };
  runId = started.id;
  process.stderr.write(`Live workspace probe started ${runId}\n`);
  const deadline = Date.now() + 180_000; // Probe observation timeout; not a product workflow limit.
  let run;
  for (;;) {
    run = controller.observe(runId).run;
    if (["succeeded", "failed", "cancelled", "interrupted"].includes(run.status)) break;
    if (Date.now() > deadline) throw new Error("Live workspace probe observation exceeded 180 seconds");
    await sleep(250);
  }
  assert.equal(run.status, "succeeded", run.error);
  const output = run.output as any;
  assert.equal(output.approved, true, `Reviewer did not approve: ${JSON.stringify(output.review)}`);
  assert.equal(output.review.decision, "approve");
  assert.equal(output.review.artifactRevision, output.candidate.workspace.head);
  assert.equal(output.review.acceptanceCriteriaRevision, "answer-six-times-seven-v1");
  assert.equal(output.candidate.result.exitCode, 0);
  assert.equal(output.rootCheck.exitCode, 0);
  const allocatedCheck = JSON.parse(output.candidate.result.stdout);
  const integratedCheck = JSON.parse(output.rootCheck.stdout);
  assert.equal(allocatedCheck.answer, 42); assert.equal(integratedCheck.answer, 42);
  assert.equal(allocatedCheck.cwd, output.candidate.workspace.path);
  assert.equal(integratedCheck.cwd, repo);
  assert.equal(output.candidate.workspace.base, base);
  assert.notEqual(output.candidate.workspace.head, base);
  assert.equal(output.integration.workspace.head, git("rev-parse", "HEAD"));
  assert.equal(git("status", "--porcelain"), "");
  assert.match(await readFile(join(repo, "answer.mjs"), "utf8"), /6\s*\*\s*7/);
  const agents = controller.store.listActivations(runId).filter(item => item.kind === "agent");
  const implementer = agents.find(item => item.context.nodeId === "implement")!;
  const reviewer = agents.find(item => item.context.nodeId === "review")!;
  assert.equal(implementer.metadata.cwd, output.candidate.workspace.path);
  assert.equal(reviewer.metadata.cwd, repo);
  assert.notEqual(implementer.metadata.sessionFile, reviewer.metadata.sessionFile);
  const toolEvents = controller.store.events(runId).filter(event => event.type === "worker.event").map(event => event.payload as any).filter(payload => payload.event.type === "tool_execution_start");
  const toolNames = toolEvents.map(payload => payload.event.toolName);
  assert.ok(toolEvents.some(payload => payload.key === reviewer.key && payload.event.toolName === "read"), "Independent reviewer must read actual files");
  evidence = {
    verifiedAt: new Date().toISOString(), runId, model: selected, planHash: run.plan.hash,
    base, candidate: output.candidate.workspace, integrated: output.integration.workspace,
    allocatedCheck, integratedCheck, review: output.review,
    agentCalls: agents.length, agents: agents.map(item => ({ graphId: item.context.graphId, nodeId: item.context.nodeId, visit: item.context.visit, cwd: item.metadata.cwd, model: item.metadata.model, thinking: item.metadata.thinking, usage: item.metadata.usage, tools: toolEvents.filter(payload => payload.key === item.key).map(payload => payload.event.toolName) })),
    observedTools: [...new Set(toolNames)], temporaryRepositoryCleaned: true,
  };
} finally {
  if (runId) {
    await controller.control(runId, "cancel");
    const deadline = Date.now() + 15_000;
    for (;;) {
      const observed = controller.observe(runId);
      if (["succeeded", "failed", "cancelled"].includes(observed.run.status) && observed.workersAlive === 0) break;
      if (Date.now() > deadline) throw new Error(`Probe could not drain workers; retained temporary repository at ${directory}`);
      await sleep(100);
    }
  }
  service.close(); controller.close();
  await rm(directory, { recursive: true, force: true });
}

assert.ok(evidence);
if (values.output) await writeFile(resolve(values.output), JSON.stringify(evidence, null, 2) + "\n");
process.stdout.write(JSON.stringify(evidence, null, 2) + "\n");
