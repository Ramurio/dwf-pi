/** Opt-in paid/live probe. Not included in npm test. Authors only through official MCP tools. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { Client, type CallToolResult } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const { values } = parseArgs({ options: { live: { type: "boolean" }, provider: { type: "string", default: "openai-codex" }, model: { type: "string", default: "gpt-5.6-sol" } } });
if (!values.live) {
  console.log("Opt-in: node --import tsx spikes/council-live.ts --live [--provider openai-codex --model gpt-5.6-sol]. Starts four actual reviewer workers.");
  process.exit(0);
}
const execute = promisify(execFile);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const bin = fileURLToPath(new URL("../bin/dynamicwf.mjs", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "dynamicwf-council-live-"));
const store = join(root, "state.sqlite");
const connections: { client: Client; closed: boolean }[] = [];
async function connect() {
  const transport = new StdioClientTransport({ command: process.execPath, args: [bin, "mcp", "--store", store, "--cwd", root], stderr: "pipe" });
  transport.stderr?.on("data", () => {});
  const client = new Client({ name: "dynamicwf-council-live-proof", version: "1.0.0" });
  await client.connect(transport);
  const connection = { client, closed: false }; connections.push(connection); return connection;
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const response = await client.callTool({ name, arguments: args }) as CallToolResult;
  const envelope = response.structuredContent as { ok?: boolean; result?: unknown; error?: { message?: string } } | undefined;
  assert.ok(envelope && envelope.ok && !response.isError, `MCP ${name} failed; no provider error details exposed`);
  return envelope.result;
}
let runId: string | undefined;
let inspection: any;
let observer: Awaited<ReturnType<typeof connect>> | undefined;
let report: Record<string, unknown> | undefined;
let cleanupComplete = false;
try {
  const source = "export function answer() { return 42; }\n";
  const testSource = `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport {answer} from './answer.mjs';\ntest('answer is a repeatable synchronous numeric 42',()=>{assert.equal(typeof answer,'function');assert.equal(answer.length,0);assert.equal(answer(),42);assert.equal(typeof answer(),'number');assert.equal(answer(),42);});\n`;
  const criteria = "The isolated answer.mjs ES module must export a named, zero-argument synchronous function answer. Each call returns the number 42; repeated calls are deterministic. The implementation must perform no filesystem/network operations or mutable global-state updates. Review only these requirements; there are no CLI, packaging, integration or additional API requirements. Verification consists of inspecting the actual source/test files and the supplied actual Node test report. Reviewers have read-only tools and must not claim to have executed tests themselves.";
  await writeFile(join(root, "answer.mjs"), source);
  await writeFile(join(root, "answer.test.mjs"), testSource);
  const verified = await execute(process.execPath, ["--test", "--test-reporter=tap", "answer.test.mjs"], { cwd: root });
  const artifactRevision = digest(source), acceptanceCriteriaRevision = digest(criteria);
  await writeFile(join(root, "test-report.json"), JSON.stringify({ command: [process.execPath, "--test", "--test-reporter=tap", "answer.test.mjs"], cwd: root, exitCode: 0, sourceSha256: artifactRevision, testsSha256: digest(testSource), stdout: verified.stdout, stderr: verified.stderr }, null, 2));
  await writeFile(join(root, "acceptance-criteria.txt"), criteria);
  const create = JSON.parse(await readFile(new URL("../examples/council.create.json", import.meta.url), "utf8"));
  const patch = JSON.parse(await readFile(new URL("../examples/council.patch.json", import.meta.url), "utf8"));
  const first = await connect();
  await call(first.client, "workflow_create", create);
  const authored = await call(first.client, "workflow_patch", patch);
  assert.equal(authored.validation.valid, true);
  const reviewer = authored.workflow.graphs.reviewer.nodes.find((node: any) => node.id === "review");
  assert.ok(reviewer);
  const configured = await call(first.client, "workflow_patch", { id: create.id, expectedRevision: authored.workflow.revision, operations: [{ op: "replaceNode", graphId: "reviewer", node: { ...reviewer, config: { model: { provider: values.provider, id: values.model }, thinking: "low", permission: "read-only", tools: ["read", "grep", "find", "ls"], session: "fresh", skills: [] } } }] });
  assert.equal(configured.validation.valid, true);
  const prepared = await call(first.client, "workflow_prepare", { id: create.id });
  const started = await call(first.client, "run_start", { id: create.id, cwd: root, input: { policy: "unanimous", artifactRevision, acceptanceCriteriaRevision, acceptanceCriteria: criteria,
    artifact: { sourcePath: join(root, "answer.mjs"), testsPath: join(root, "answer.test.mjs"), actualTestReportPath: join(root, "test-report.json"), criteriaPath: join(root, "acceptance-criteria.txt"), sourceSha256: artifactRevision, description: "Small isolated module; inspect source, test and actual test report as evidence." },
  } });
  runId = started.id;
  assert.equal(started.planHash, prepared.hash);
  await first.client.close(); first.closed = true;
  observer = await connect();
  let observedLiveAfterReconnect = false;
  // Probe observation deadline only; the authored graph has no time/concurrency/token cap.
  const deadline = Date.now() + 180_000;
  for (;;) {
    const status = await call(observer.client, "run_status", { id: runId });
    observedLiveAfterReconnect ||= status.status === "running" && status.supervisorAlive;
    if (["succeeded", "failed", "cancelled", "interrupted"].includes(status.status)) break;
    if (Date.now() >= deadline) throw new Error("Council probe observation deadline; existing run will be cancelled and drained");
    await sleep(250);
  }
  inspection = await call(observer.client, "run_inspect", { id: runId });
  const events = (await call(observer.client, "run_events", { id: runId })).events as any[];
  const reviewers = inspection.activations.filter((activation: any) => activation.kind === "agent");
  const sessionCount = new Set(reviewers.map((activation: any) => activation.metadata.sessionFile)).size;
  const active = new Set<string>(); let maxActive = 0;
  const processActive = new Set<string>(); let maxProcesses = 0;
  for (const event of events) {
    if (event.type === "worker.event") {
      if (event.payload.event.type === "agent_start") active.add(event.payload.key);
      if (event.payload.event.type === "agent_settled") active.delete(event.payload.key);
      maxActive = Math.max(maxActive, active.size);
    }
    if (event.type === "activation.metadata" && Object.hasOwn(event.payload.metadata, "workerPid")) {
      if (typeof event.payload.metadata.workerPid === "number") processActive.add(event.payload.key); else processActive.delete(event.payload.key);
      maxProcesses = Math.max(maxProcesses, processActive.size);
    }
  }
  const votes = inspection.output?.votes ?? {};
  const usage = reviewers.reduce((sum: any, activation: any) => ({ input: sum.input + (activation.metadata.usage?.input ?? 0), output: sum.output + (activation.metadata.usage?.output ?? 0), totalTokens: sum.totalTokens + (activation.metadata.usage?.totalTokens ?? 0) }), { input: 0, output: 0, totalTokens: 0 });
  report = { runId, status: inspection.status, model: { provider: values.provider, id: values.model }, thinking: "low", reviewerCount: reviewers.length, distinctSessions: sessionCount, maxActiveAgentLoops: maxActive, maxActiveWorkerProcesses: maxProcesses, observedLiveAfterReconnect, artifactRevision, acceptanceCriteriaRevision, planHash: inspection.planHash, decision: inspection.output?.decision, accepted: inspection.output?.accepted, revisionConsistent: inspection.output?.revisionConsistent, votes, usage,
    reviewerIntervals: reviewers.map((activation: any) => ({ scope: activation.context.scope, startedAt: activation.startedAt, finishedAt: activation.finishedAt, status: activation.status, tools: events.filter(event => event.type === "worker.event" && event.payload.key === activation.key && event.payload.event.type === "tool_execution_start").map(event => event.payload.event.toolName) })),
  };
  // Publish genuine dissent before checking the expected result; never replace votes.
  console.log(JSON.stringify({ type: "council-observation", ...report }));
  assert.equal(inspection.status, "succeeded"); assert.equal(reviewers.length, 4); assert.equal(sessionCount, 4);
  assert.ok(reviewers.every((activation: any) => typeof activation.metadata.sessionFile === "string"));
  assert.equal(maxActive, 4); assert.equal(maxProcesses, 4); assert.equal(active.size, 0); assert.equal(processActive.size, 0);
  assert.ok(observedLiveAfterReconnect);
  assert.equal(inspection.output.policy, "unanimous"); assert.equal(inspection.output.revisionConsistent, true);
  for (const vote of Object.values(votes) as any[]) { assert.equal(vote.artifactRevision, artifactRevision); assert.equal(vote.acceptanceCriteriaRevision, acceptanceCriteriaRevision); }
  assert.equal(Object.keys(votes).length, 4); assert.equal(inspection.output.accepted, true); assert.equal(inspection.output.decision, "approve");
  assert.ok((Object.values(votes) as any[]).every(vote => vote.decision === "approve"));
  assert.equal(await readFile(join(root, "answer.mjs"), "utf8"), source);
} catch {
  process.exitCode = 1;
  console.log(JSON.stringify({ type: "council-probe-failure", runId, observedStatus: inspection?.status, observedDecision: inspection?.output?.decision, message: "Council live proof did not satisfy every assertion; retain the genuine observation above. Cleanup follows." }));
} finally {
  try {
    if (runId) {
      if (!observer || observer.closed) observer = await connect();
      await call(observer.client, "run_cancel", { id: runId });
      const deadline = Date.now() + 20_000;
      for (;;) {
        const state = await call(observer.client, "run_status", { id: runId });
        if (["succeeded", "failed", "cancelled"].includes(state.status) && !state.supervisorAlive && state.workersAlive === 0) { cleanupComplete = true; break; }
        if (Date.now() > deadline) throw new Error("Council cleanup did not reach confirmed terminal state");
        await sleep(100);
      }
    } else cleanupComplete = true;
  } catch { process.exitCode = 1; console.log(JSON.stringify({ type: "cleanup-failure", runId, directory: root, message: "Temporary state retained because run termination was not confirmed" })); }
  for (const connection of connections) if (!connection.closed) { await connection.client.close(); connection.closed = true; }
  if (cleanupComplete) await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify({ type: "council-probe-complete", passed: process.exitCode !== 1 && report !== undefined, cleanupComplete }));
}
