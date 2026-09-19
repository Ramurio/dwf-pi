import { createHash, randomInt } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkflowModelRuntime } from "../src/model-runtime.js";
import { executePiWorker } from "../src/pi-worker.js";
import type { PiWorkerRequest } from "../src/execution-types.js";
import { jpegDigit, oversizedPng, pngDigit } from "./helpers/test-images.js";
import {
  extractToolIO,
  lastOutboundIndex,
  lsRoundTripConsumed,
  publishedLsRoundTrips,
  recordSuccessfulLsCompletion,
  type Invocation,
  type SuccessfulLsCompletion,
  type ToolIoTurn,
} from "./helpers/tool-round-trip.js";
import {
  publishRepairLiveEvidence,
  resolveRepairLiveEvidencePath,
} from "./helpers/repair-live-evidence.js";
import { drainReadResizeObservations, sessionHistoryHasImages } from "../src/image-boundary.js";

const PNG_ANSWER = 10 + randomInt(89);
const JPEG_ANSWER = 10 + randomInt(89);
const OVERSIZED_SIDE = 2200;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function redactId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function extractImages(payload: unknown): { mimeType: string; digest: string; chars: number }[] {
  const found: { mimeType: string; digest: string; chars: number }[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    const record = value as Record<string, unknown>;
    if (record.type === "input_image" && typeof record.image_url === "string") {
      const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(record.image_url);
      if (match) found.push({ mimeType: match[1]!, digest: createHash("sha256").update(match[2]!).digest("hex").slice(0, 16), chars: match[2]!.length });
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(payload);
  return found;
}

type OutboundTurn = ToolIoTurn & {
  effort: string;
  imageCount: number;
  mimeTypes: string[];
  digests: string[];
};

type ToolEvent = { type: string; toolName?: string; isError?: boolean };
function successful(events: ToolEvent[], name: string): number[] {
  return events.flatMap((event, index) => event.type === "tool_execution_end" && event.toolName === name && event.isError === false ? [index] : []);
}

const workspace = await mkdtemp(join(tmpdir(), "dynamicwf-repair-live-"));
await mkdir(join(workspace, "evidence"));
await writeFile(join(workspace, "panel-north.png"), pngDigit(PNG_ANSWER % 10, 24, [20, 20, 20], [250, 250, 250]));
await writeFile(join(workspace, "panel-south.jpg"), await jpegDigit(JPEG_ANSWER % 10));
await writeFile(join(workspace, "panel-wide.png"), oversizedPng());
drainReadResizeObservations();

let runtime;
try {
  runtime = await createWorkflowModelRuntime({ requiredProvider: "xai" });
  const refresh = await runtime.refresh({ providers: ["xai"], allowNetwork: true, force: true });
  if (refresh.errors.size) fail("Live Grok catalog refresh failed");
} catch (error) {
  await rm(workspace, { recursive: true, force: true });
  fail(`Live Grok probe failed to load xai: ${error instanceof Error ? error.message : error}`);
}
const grok = runtime.getAvailableSnapshot().find(model => model.provider === "xai" && model.id === "grok-4.6");
if (!grok) {
  await rm(workspace, { recursive: true, force: true });
  fail("Live probe requires xai/grok-4.6 in the authenticated catalog");
}
const outbound: OutboundTurn[] = [];
const completions: SuccessfulLsCompletion[] = [];
let activeInvocation: Invocation = "first";
const realFetch = globalThis.fetch;
const spyFetch: typeof fetch = async (input, init) => {
  if (typeof init?.body === "string") {
    try {
      const payload = JSON.parse(init.body) as { model?: string; input?: unknown; reasoning?: { effort?: string } };
      if (typeof payload.model === "string" && Array.isArray(payload.input)) {
        const images = extractImages(payload);
        const io = extractToolIO(payload);
        outbound.push({
          invocation: activeInvocation,
          index: outbound.filter(turn => turn.invocation === activeInvocation).length,
          effort: payload.reasoning?.effort === "xhigh" ? "xhigh" : "",
          imageCount: images.length,
          mimeTypes: images.map(image => image.mimeType),
          digests: images.map(image => image.digest),
          calls: io.calls,
          results: io.results,
        });
      }
    } catch { /* ignore non-JSON */ }
  }
  return realFetch(input, init);
};

const schema = {
  type: "object", additionalProperties: false,
  required: ["pngDigit", "jpegDigit", "listed", "continued"],
  properties: { pngDigit: { type: "integer" }, jpegDigit: { type: "integer" }, listed: { type: "boolean" }, continued: { type: "boolean" } },
};
const request: PiWorkerRequest = {
  version: 1, cwd: workspace, resourceDirectory: join(workspace, "resources"), sessionDirectory: join(workspace, "sessions"),
  task: "There are image files in the workspace with neutral names. First turn: call read on every image file only. After image tool results exist, on a later turn call ls only. After a subsequent model request has consumed that ls result, submit_result with pngDigit (the digit from the PNG that is not the oversized noisy panel) and jpegDigit from the JPEG. listed must be true. continued must be false. Never call ls and submit_result in the same assistant turn.",
  input: { files: ["panel-north.png", "panel-south.jpg", "panel-wide.png"] },
  config: {
    model: { provider: "xai", id: "grok-4.6" }, thinking: "xhigh", tools: ["read", "ls"],
    systemPrompt: "Inspect visual file contents yourself. Do not guess. The filenames do not contain the digits.",
    skills: [], session: "fresh", permission: "read-only", outputSchema: schema,
  },
};

type ProbeTool = {
  name: string;
  execute: (...args: never[]) => Promise<unknown>;
  prepareArguments?: (raw: unknown) => unknown;
};

function gateTools(invocation: Invocation) {
  return (session: { agent: { state: { tools: ProbeTool[] } }; messages: unknown[] }): void => {
    session.agent.state.tools = session.agent.state.tools.map(tool => {
      if (tool.name === "ls") {
        const execute = tool.execute.bind(tool);
        return {
          ...tool,
          execute: async (...args: never[]) => {
            if (invocation === "first" && !sessionHistoryHasImages(session.messages)) {
              throw new Error("ls is only valid after image read results exist. Read the image files first, then call ls on a later turn.");
            }
            const result = await execute(...args);
            recordSuccessfulLsCompletion(completions, {
              invocation,
              toolCallId: typeof (args as unknown[])[0] === "string" ? (args as unknown[])[0] as string : "",
              afterRequestIndex: lastOutboundIndex(outbound, invocation),
            });
            return result;
          },
        };
      }
      if (tool.name !== "submit_result") return tool;
      const prepareArguments = tool.prepareArguments?.bind(tool);
      const execute = tool.execute.bind(tool);
      const assertConsumed = () => {
        if (!lsRoundTripConsumed(completions, outbound, invocation)) {
          throw new Error("submit_result is only valid after a later model request includes this invocation's successful ls tool result. Call ls, wait for the next turn, then submit.");
        }
      };
      return {
        ...tool,
        prepareArguments: (raw: unknown) => {
          // Reject before the worker prepareArguments increments submissions, so an early
          // gated submit cannot poison later duplicate-submission / shouldStopAfterTurn state.
          assertConsumed();
          return prepareArguments ? prepareArguments(raw) : raw;
        },
        execute: async (...args: never[]) => {
          assertConsumed();
          return execute(...args);
        },
      };
    });
  };
}

const firstEvents: ToolEvent[] = [];
let first;
activeInvocation = "first";
try {
  first = await executePiWorker(request, { modelRuntime: runtime, providerFetch: spyFetch, onEvent: event => firstEvents.push(event), onSession: gateTools("first") });
} catch (error) {
  const summary = firstEvents.map(event => `${event.type}:${event.toolName ?? ""}:${event.isError ?? ""}`).join("|");
  const io = outbound.map(turn => `${turn.invocation}#${turn.index} img=${turn.imageCount} calls=${turn.calls.map(c=>c.name+":"+c.id.slice(0,8)).join(",")} results=${turn.results.map(r=>r.id.slice(0,8)).join(",")}`).join(" || ");
  await rm(workspace, { recursive: true, force: true });
  fail(`First live worker failed: ${error instanceof Error ? error.message : error} (${summary}) [${io}]`);
}

const firstOut = first.output as { pngDigit?: unknown; jpegDigit?: unknown; listed?: unknown; continued?: unknown };
if (firstOut.pngDigit !== PNG_ANSWER % 10 || firstOut.jpegDigit !== JPEG_ANSWER % 10 || firstOut.listed !== true || firstOut.continued !== false) {
  await rm(workspace, { recursive: true, force: true });
  fail("Live probe returned incorrect visual answers or skipped the later tool");
}
const firstReads = successful(firstEvents, "read");
const firstLs = successful(firstEvents, "ls");
const lsAfterImages = firstReads.length > 0 && firstLs.some(index => index > firstReads[0]!);
if (!lsAfterImages) {
  const summary = firstEvents.map(event => `${event.type}:${event.toolName ?? ""}:${event.isError ?? ""}`).join("|");
  await rm(workspace, { recursive: true, force: true });
  fail(`Live probe did not execute a successful ls after a successful image read (${summary})`);
}
if (!lsRoundTripConsumed(completions, outbound, "first")) {
  await rm(workspace, { recursive: true, force: true });
  fail("First invocation did not send a later request containing this invocation's successful ls result before submit_result");
}

const secondEvents: ToolEvent[] = [];
let second;
activeInvocation = "second";
try {
  second = await executePiWorker({
    ...request, task: "This is a continued session. Call ls again on a turn that does not submit. After a subsequent model request has consumed that fresh ls result, submit_result with the same digits, listed true and continued true. Never call ls and submit_result in the same assistant turn.",
    config: { ...request.config, session: "continue-node" }, sessionFile: first.sessionFile,
    resourceDirectory: join(workspace, "resources-2"),
  }, { modelRuntime: runtime, providerFetch: spyFetch, onEvent: event => secondEvents.push(event), onSession: gateTools("second") });
} catch (error) {
  const summary = secondEvents.map(event => `${event.type}:${event.toolName ?? ""}:${event.isError ?? ""}`).join("|");
  await rm(workspace, { recursive: true, force: true });
  fail(`Continuation live worker failed: ${error instanceof Error ? error.message : error} (${summary})`);
}
const secondOut = second.output as { pngDigit?: unknown; jpegDigit?: unknown; listed?: unknown; continued?: unknown };
if (secondOut.pngDigit !== PNG_ANSWER % 10 || secondOut.jpegDigit !== JPEG_ANSWER % 10 || secondOut.continued !== true || secondOut.listed !== true) {
  await rm(workspace, { recursive: true, force: true });
  fail("Continuation did not return structured submit_result with the visual answers");
}
const continuationLs = successful(secondEvents, "ls").length > 0;
if (!continuationLs) {
  await rm(workspace, { recursive: true, force: true });
  fail("Continuation did not execute a successful ls tool");
}
if (!lsRoundTripConsumed(completions, outbound, "second")) {
  await rm(workspace, { recursive: true, force: true });
  fail("Continuation did not send a later request containing this invocation's successful ls result before submit_result");
}
if (!outbound.length || outbound.some(item => item.effort !== "xhigh")) {
  await rm(workspace, { recursive: true, force: true });
  fail("Every observed live Grok request must serialize reasoning effort xhigh");
}
if (!outbound.some(item => item.imageCount >= 2 && item.mimeTypes.includes("image/png") && item.mimeTypes.includes("image/jpeg"))) {
  await rm(workspace, { recursive: true, force: true });
  fail("Live probe did not transport both PNG and JPEG");
}
if (second.sessionFile !== first.sessionFile) {
  await rm(workspace, { recursive: true, force: true });
  fail("Continuation must reuse the first session file");
}

const resize = [
  ...drainReadResizeObservations(),
];
if (!resize.some(item => item.wasResized === true && (item.originalWidth >= OVERSIZED_SIDE || item.originalHeight >= OVERSIZED_SIDE))) {
  await rm(workspace, { recursive: true, force: true });
  fail("Live probe did not record a native resize of the oversized panel");
}

const firstTurns = outbound.filter(turn => turn.invocation === "first");
const secondTurns = outbound.filter(turn => turn.invocation === "second");
const toolRoundTrips = publishedLsRoundTrips(completions, outbound, redactId);
const sameTurnBlocked = "submit_result.prepareArguments throws before the worker increments submissions unless a strictly later outbound request already contains function_call and function_call_output for this invocation's successful SDK ls call_id; historical ids and same-turn ls+submit cannot pass";

if (firstTurns.length < 3 || secondTurns.length < 2) {
  await rm(workspace, { recursive: true, force: true });
  fail(`Expected at least 3 first-invocation requests and 2 continuation requests; got ${firstTurns.length} and ${secondTurns.length}`);
}
if (!toolRoundTrips.some(trip => trip.invocation === "first") || !toolRoundTrips.some(trip => trip.invocation === "second")) {
  await rm(workspace, { recursive: true, force: true });
  fail("toolRoundTrips must prove a current-invocation ls completion consumed by a strictly later outbound request in both first and continuation invocations");
}

const evidence = {
  ok: true,
  model: "xai/grok-4.6",
  thinkingRequested: "xhigh",
  outboundTurns: outbound.map(turn => ({
    invocation: turn.invocation, index: turn.index, effort: turn.effort, imageCount: turn.imageCount,
    mimeTypes: turn.mimeTypes, digests: turn.digests,
    calls: turn.calls.map(call => ({ name: call.name, id: redactId(call.id) })),
    results: turn.results.map(result => ({ id: redactId(result.id) })),
  })),
  toolRoundTrips,
  resize: resize.map(item => ({ wasResized: item.wasResized, originalWidth: item.originalWidth, width: item.width, mimeType: item.mimeType, source: "source" in item && typeof item.source === "string" ? item.source.split("/").pop() : undefined, via: "via" in item ? item.via : "helper-compact" })),
  toolEvidence: {
    lsAfterImages,
    continuationLs,
    firstLsResultConsumed: lsRoundTripConsumed(completions, outbound, "first"),
    continuationLsResultConsumed: lsRoundTripConsumed(completions, outbound, "second"),
    firstRequestCount: firstTurns.length,
    continuationRequestCount: secondTurns.length,
    sameTurnLsSubmitCannotPass: sameTurnBlocked,
    derivation: "lsAfterImages uses tool_execution_end ordering. Completions are recorded from the actual successful ls execute wrapper with the transport-normalized SDK call id and the last outbound index at completion. A round trip requires a strictly later same-invocation outbound request containing matching function_call and function_call_output ids. Historical payload ls ids cannot establish this. submit_result.prepareArguments is refused until that later request has already been sent, so same-turn ls+submit cannot increment the worker submission count. Output listed/continued flags are checked separately.",
  },
  firstSession: Boolean(first.sessionFile),
  continuedSession: second.sessionFile === first.sessionFile,
};
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const published = resolveRepairLiveEvidencePath({ packageRoot, env: process.env });
const body = `${JSON.stringify(evidence, null, 2)}\n`;
try {
  await publishRepairLiveEvidence(published.path, body);
} catch (error) {
  await rm(workspace, { recursive: true, force: true });
  fail(`Live evidence could not be published: ${error instanceof Error ? error.message : error}`);
}
console.log(JSON.stringify(evidence, null, 2));
await rm(workspace, { recursive: true, force: true });
