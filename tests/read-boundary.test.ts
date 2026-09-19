import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createReadToolDefinition, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, InMemoryCredentialStore, InMemoryModelsStore, type AssistantMessage } from "@earendil-works/pi-ai";
import { executePiWorker } from "../src/pi-worker.js";

const payload = "RAW_BEGIN_" + "я".repeat(30000) + "_RAW_END";
async function fixture(t: TestContext) {
  const cwd = await mkdtemp(join(tmpdir(), "read-boundary-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const tool = createReadToolDefinition(cwd);
  return { cwd, read: (path: string, offset?: number, limit?: number) => tool.execute("read", { path, ...(offset === undefined ? {} : { offset }), ...(limit === undefined ? {} : { limit }) }, undefined, undefined, { cwd } as never) };
}
const text = (result: { content: Array<{ type: string; text?: string }> }) => result.content.map(p => p.text ?? "").join("");

test("SDK read explicitly withholds an oversized single JSON line; line offsets cannot resume it", async t => {
  const { cwd, read } = await fixture(t);
  const raw = JSON.stringify({ payload });
  assert.ok(Buffer.byteLength(raw) > 50 * 1024);
  await writeFile(join(cwd, "raw.json"), raw);
  for (const limit of [undefined, 1, 2000]) {
    const result = await read("raw.json", 1, limit);
    assert.equal(result.details?.truncation?.firstLineExceedsLimit, true);
    assert.equal(result.details?.truncation?.content, "");
    assert.equal(result.details?.truncation?.outputBytes, 0);
    assert.match(text(result), /exceeds 50\.0KB limit.*Use bash/);
    assert.doesNotMatch(JSON.stringify(result), /RAW_BEGIN|RAW_END|я/);
  }
  await assert.rejects(read("raw.json", 2, 1), /beyond end of file \(1 lines total\)/);
});

test("short-line JSON is losslessly pageable; pretty-print alone does not split a huge string", async t => {
  const { cwd, read } = await fixture(t);
  const value = { start: "MATERIAL_BEGIN", findings: Array.from({ length: 1800 }, (_, i) => ({ id: i, raw: `Сырой факт ${i}`, valid: i % 2 === 0 })), end: "MATERIAL_END" };
  const raw = JSON.stringify(value, null, 2);
  assert.ok(Buffer.byteLength(raw) > 50 * 1024);
  await writeFile(join(cwd, "pretty.json"), raw);
  const pages: string[] = [];
  const lines = raw.split("\n");
  for (let offset = 1; offset <= lines.length; offset += 100) {
    const result = await read("pretty.json", offset, 100);
    assert.equal(result.details?.truncation, undefined);
    // Remove only the SDK pagination notice, never source content.
    const page = text(result).replace(/\n\n\[\d+ more lines in file\. Use offset=\d+ to continue\.\]$/, "");
    assert.equal(page, lines.slice(offset - 1, offset + 99).join("\n"));
    pages.push(page);
  }
  const restored = pages.join("\n");
  assert.match(pages[0]!, /MATERIAL_BEGIN/);
  assert.match(pages.at(-1)!, /MATERIAL_END/);
  assert.equal(restored, raw);
  assert.deepEqual(JSON.parse(restored), value);
  await writeFile(join(cwd, "huge-pretty.json"), JSON.stringify({ payload }, null, 2));
  assert.equal(text(await read("huge-pretty.json", 1, 1)).startsWith("{"), true);
  const blocked = await read("huge-pretty.json", 2, 1);
  assert.equal(blocked.details?.truncation?.firstLineExceedsLimit, true);
  assert.doesNotMatch(text(blocked), /RAW_BEGIN|RAW_END/);
  assert.equal(text(await read("huge-pretty.json", 3, 1)), "}");
});

test("offline read-only worker does not gain bash/write/edit from SDK read warning", { timeout: 15000 }, async t => {
  const { cwd } = await fixture(t);
  await writeFile(join(cwd, "raw.json"), JSON.stringify({ payload }));
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const provider = "read-boundary-offline", id = "fixture";
  let turn = 0;
  runtime.registerProvider(provider, {
    api: "openai-completions", baseUrl: "https://offline.invalid", apiKey: "FAKE_TEST_ONLY",
    models: [{ id, name: id, reasoning: false, input: ["text"], contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(_model, context) {
      const stream = createAssistantMessageEventStream();
      const base = { role: "assistant", api: "openai-completions", provider, model: id, timestamp: 1, usage: { input: 1, output: 1, totalTokens: 2, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } as const;
      queueMicrotask(() => {
        try {
          assert.deepEqual(context.tools?.map(tool => tool.name).sort(), ["read", "submit_result"]);
          assert.ok(turn < 3);
          if (turn === 1) {
            const last = context.messages.at(-1);
            assert.equal(last?.role, "toolResult");
            assert.match(JSON.stringify(last), /Use bash/);
            assert.doesNotMatch(JSON.stringify(last), /RAW_BEGIN|RAW_END/);
          }
          if (turn === 2) {
            const last = context.messages.at(-1);
            assert.equal(last?.role, "toolResult");
            assert.ok(last?.role === "toolResult" && last.isError);
            assert.match(JSON.stringify(last), /not found|not available|unknown tool/i);
          }
          const name = ["read", "bash", "submit_result"][turn]!;
          const args = turn === 0 ? { path: "raw.json" } : turn === 1 ? { command: "touch forbidden.txt" } : { unavailable: true };
          const message: AssistantMessage = { ...base, stopReason: "toolUse", content: [{ type: "toolCall", id: `call-${turn++}`, name, arguments: args }] };
          stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: "toolUse", message });
        } catch (error) {
          stream.push({ type: "error", reason: "error", error: { ...base, stopReason: "error", content: [], errorMessage: String(error) } });
        }
      });
      return stream;
    },
  });
  const result = await executePiWorker({ version: 1, cwd, task: "Read the material; report inaccessible content.", input: null, sessionDirectory: join(cwd, "sessions"), resourceDirectory: join(cwd, "resources"), config: { model: { provider, id }, thinking: "off", systemPrompt: "Offline boundary fixture", tools: ["read"], skills: [], session: "fresh", permission: "read-only", outputSchema: { type: "object", properties: { unavailable: { const: true } }, required: ["unavailable"], additionalProperties: false } } }, { modelRuntime: runtime });
  assert.deepEqual(result.output, { unavailable: true });
  assert.equal(turn, 3);
  await assert.rejects(access(join(cwd, "forbidden.txt")), { code: "ENOENT" });
});
