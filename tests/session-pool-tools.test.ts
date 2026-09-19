import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, readStoredCredential } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, InMemoryModelsStore, type AssistantMessage } from "@earendil-works/pi-ai";
import { executePiWorker } from "../src/pi-worker.js";

const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

test("shared runtime refreshes fixture OAuth once and isolates concurrent real read/write tools", { timeout: 15_000 }, async t => {
  // Real SDK/file credential store/tools; scripted inference, no provider network or user credentials.
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-pool-tools-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const originalCwd = process.cwd();
  const provider = "pool-tools-offline", modelId = "fixture";
  const authPath = join(directory, "fixture-auth.json");
  await writeFile(authPath, JSON.stringify({ [provider]: { type: "oauth", access: "fixture-old", refresh: "fixture-refresh", expires: 0 } }));
  const runtime = await ModelRuntime.create({ authPath, modelsStore: new InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const refreshEntered = gate(), admitted = gate(), release = gate();
  let refreshes = 0, admissions = 0;
  const calls = new Map<string, number>();
  runtime.registerProvider(provider, {
    api: "openai-completions", baseUrl: "https://offline.invalid", apiKey: "fixture-snapshot-only",
    oauth: {
      name: "Offline fixture", login: async () => { throw new Error("Login must not run"); },
      async refreshToken() {
        refreshes++; refreshEntered.resolve(); await release.promise;
        return { access: "fixture-rotated", refresh: "fixture-refresh", expires: Date.now() + 3_600_000 };
      },
      getApiKey: value => value.access,
    },
    models: [{ id: modelId, name: modelId, reasoning: false, input: ["text"], contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(_model, context) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const base = { role: "assistant", api: "openai-completions", provider, model: modelId, timestamp: 1,
          usage: { input: 1, output: 1, totalTokens: 2, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } as const;
        try {
          const marker = JSON.stringify(context.messages[0]).match(/POOL_TOOL_[0-3]/)?.[0];
          assert.ok(marker);
          const turn = calls.get(marker) ?? 0; calls.set(marker, turn + 1);
          assert.ok(turn < 3, "Unexpected extra inference/repair");
          if (turn === 1) {
            const result = context.messages.at(-1);
            assert.equal(result?.role, "toolResult");
            assert.ok(JSON.stringify(result).includes(marker), "read tool used a peer's cwd");
          }
          const name = ["read", "write", "submit_result"][turn]!;
          const args = turn === 0 ? { path: "input.txt" } : turn === 1 ? { path: "output.txt", content: marker } : { marker };
          const message: AssistantMessage = { ...base, stopReason: "toolUse", content: [{ type: "toolCall", id: `${marker}-${turn}`, name, arguments: args }] };
          stream.push({ type: "start", partial: message });
          stream.push({ type: "done", reason: "toolUse", message });
        } catch (error) {
          stream.push({ type: "error", reason: "error", error: { ...base, stopReason: "error", content: [], errorMessage: String(error) } });
        }
      });
      return stream;
    },
  });
  const getAuth = runtime.getAuth.bind(runtime);
  runtime.getAuth = (model, options) => {
    if (++admissions === 4) admitted.resolve();
    return typeof model === "string" ? getAuth(model, options) : getAuth(model, options);
  };
  const requests = await Promise.all(Array.from({ length: 4 }, async (_, i) => {
    const cwd = join(directory, String(i)); await mkdir(cwd);
    const marker = `POOL_TOOL_${i}`; await writeFile(join(cwd, "input.txt"), marker);
    return { version: 1 as const, cwd, task: marker, input: null, sessionDirectory: join(cwd, "sessions"), resourceDirectory: join(cwd, "resources"),
      config: { model: { provider, id: modelId }, thinking: "off" as const, systemPrompt: "Execute the assigned fixture.", tools: ["read", "write"] as ("read" | "write")[], skills: [], session: "fresh" as const, permission: "workspace-write" as const,
        outputSchema: { type: "object", properties: { marker: { type: "string" } }, required: ["marker"], additionalProperties: false } } };
  }));
  const pending = Promise.allSettled(requests.map(request => executePiWorker(request, { modelRuntime: runtime })));
  try {
    await Promise.all([refreshEntered.promise, admitted.promise]);
    release.resolve();
    const results = await pending;
    assert.equal(refreshes, 1);
    assert.equal(process.cwd(), originalCwd);
    const sessions = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const result = results[i]!;
      if (result.status !== "fulfilled") throw result.reason;
      const marker = `POOL_TOOL_${i}`;
      assert.deepEqual(result.value.output, { marker });
      assert.equal(await readFile(join(requests[i]!.cwd, "output.txt"), "utf8"), marker);
      assert.equal(calls.get(marker), 3);
      assert.equal(result.value.usage?.totalTokens, 6);
      sessions.add(result.value.sessionFile);
      const transcript = await readFile(result.value.sessionFile, "utf8");
      for (let j = 0; j < 4; j++) if (j !== i) assert.ok(!transcript.includes(`POOL_TOOL_${j}`));
    }
    assert.equal(sessions.size, 4);
    const stored = readStoredCredential(provider, authPath);
    assert.equal(stored?.type === "oauth" && stored.access, "fixture-rotated");
  } finally { release.resolve(); await pending; }
});
