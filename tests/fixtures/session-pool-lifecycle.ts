import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, InMemoryModelsStore, type AssistantMessage } from "@earendil-works/pi-ai";
import { executePiWorker } from "../../src/pi-worker.js";
import type { PiWorkerRequest } from "../../src/execution-types.js";

const provider = "pool-lifecycle-offline", modelId = "fixture";
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

// Scripted inference only. The SDK sessions, bash tools and OS processes are real.
export async function fixtureRuntime(root: string) {
  const runtime = await ModelRuntime.create({ authPath: join(root, "unused-auth.json"), modelsStore: new InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const calls = new Map<string, number>();
  runtime.registerProvider(provider, {
    api: "openai-completions", baseUrl: "https://offline.invalid", apiKey: "offline-fixture",
    models: [{ id: modelId, name: modelId, reasoning: false, input: ["text"], contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(_model, context) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const base = { role: "assistant", api: "openai-completions", provider, model: modelId, timestamp: 1,
          usage: { input: 1, output: 1, totalTokens: 2, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } as const;
        try {
          const worker = JSON.stringify(context.messages[0]).match(/POOL_LIFECYCLE_(cancel|peer|saved|a|b)/)?.[1];
          assert.ok(worker);
          const turn = calls.get(worker) ?? 0;
          calls.set(worker, turn + 1);
          assert.ok(turn < 2, "Unexpected inference or task replay");
          if (turn === 1) {
            const result = context.messages.at(-1);
            assert.equal(result?.role, "toolResult");
            assert.ok(JSON.stringify(result).includes(`completed:${worker}`));
          }
          const name = turn === 0 ? "bash" : "submit_result";
          const args = turn === 0 ? { command: `exec ${quote(process.execPath)} fixture.cjs` } : { worker };
          const message: AssistantMessage = { ...base, stopReason: "toolUse", content: [{ type: "toolCall", id: `${worker}-${turn}`, name, arguments: args }] };
          stream.push({ type: "start", partial: message });
          stream.push({ type: "done", reason: "toolUse", message });
        } catch (error) {
          stream.push({ type: "error", reason: "error", error: { ...base, stopReason: "error", content: [], errorMessage: String(error) } });
        }
      });
      return stream;
    },
  });
  return { runtime, calls };
}

export async function fixtureRequest(root: string, worker: string): Promise<PiWorkerRequest> {
  const cwd = join(root, worker);
  await mkdir(cwd, { recursive: true });
  await writeFile(join(cwd, "fixture.cjs"), `
const fs = require('node:fs');
fs.appendFileSync('effect.txt', 'once\\n');
fs.writeFileSync('pid', String(process.pid));
const timer = setInterval(() => {
  if (!fs.existsSync('release')) return;
  clearInterval(timer);
  fs.writeFileSync('finished', ${JSON.stringify(worker)});
  process.stdout.write(${JSON.stringify(`completed:${worker}`)});
}, 20);
`);
  return { version: 1, cwd, task: `POOL_LIFECYCLE_${worker}`, input: null,
    sessionDirectory: join(cwd, "sessions"), resourceDirectory: join(cwd, "resources"),
    config: { model: { provider, id: modelId }, thinking: "off", systemPrompt: "Execute the assigned fixture.",
      tools: ["bash"], skills: [], session: "fresh", permission: "workspace-write",
      outputSchema: { type: "object", properties: { worker: { type: "string" } }, required: ["worker"], additionalProperties: false } } };
}

// A disposable shared process for the SIGKILL experiment; no production scheduler.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2]!;
  const { runtime } = await fixtureRuntime(root);
  const requests = await Promise.all(["saved", "a", "b"].map(worker => fixtureRequest(root, worker)));
  await writeFile(join(root, "saved", "release"), "release");
  await Promise.all(requests.map(async request => {
    const result = await executePiWorker(request, { modelRuntime: runtime });
    process.send?.({ type: "result", result });
  }));
  process.disconnect?.();
}
