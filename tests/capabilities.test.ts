import assert from "node:assert/strict";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { capabilityAllowsImage, effectiveFromRaw, intersectEffectiveCapabilities, noneAdapterCapabilities, parseFrozenCapabilities, rawInputCapability, requirementsSatisfied } from "../src/capabilities.js";
import test from "node:test";

test("missing modality metadata is unknown and does not establish support or denial", () => {
  const omitted = rawInputCapability(undefined, undefined);
  assert.equal(omitted.state, "unknown");
  assert.equal(capabilityAllowsImage(omitted), false);
  const empty = parseFrozenCapabilities(noneAdapterCapabilities());
  assert.equal(empty?.effective.imageMimeTypes.length, 0);
  assert.equal(empty?.effective.input.state, "unknown");
});

test("authenticated text-only is unsupported; advertised vision without the reviewed bridge stays ineffective", () => {
  const denied = rawInputCapability(["text"], "authenticated-input-modalities");
  assert.equal(denied.state, "unsupported");
  const authenticatedModalities = rawInputCapability(["text", "image"], "authenticated-input-modalities");
  assert.equal(authenticatedModalities.state, "supported");
  assert.equal(authenticatedModalities.provenance, "authenticated-input-modalities");
  assert.equal(rawInputCapability(["text", "image"], "conservative-default").state, "unknown");
  assert.equal(rawInputCapability(undefined, "authenticated-input-modalities").state, "unknown");
  assert.equal(rawInputCapability(["text", "image"], undefined).state, "unknown");
  const rawVision = rawInputCapability(["text", "image"], "authenticated-accepts-images");
  const withoutBridge = effectiveFromRaw(rawVision, null, "xai-auth");
  assert.equal(withoutBridge.raw.input.state, "supported");
  assert.equal(withoutBridge.effective.input.state, "unknown");
  assert.equal(requirementsSatisfied({ toolResultModalities: ["image"] }, withoutBridge), false);
  const withBridge = effectiveFromRaw(authenticatedModalities, { packageName: "pi-xai-oauth", packageVersion: "1.5.2", contentDigest: "a".repeat(64), capabilityRevision: "dynamicwf-xai-bridge-v1", sdk: { piAi: "0.85.1", piCodingAgent: "0.85.1", piAgentCore: "0.85.1" }, files: { "package.json": "b".repeat(64) } }, "xai-auth");
  assert.equal(withBridge.effective.toolResult.state, "supported");
  assert.equal(requirementsSatisfied({ toolResultModalities: ["image"] }, withBridge), true);
});

test("native SDK image models keep supported tool-result provenance; missing metadata stays unknown", () => {
  const native = effectiveFromRaw(rawInputCapability(["text", "image"], "model.input"), null, "native");
  assert.equal(native.raw.input.state, "supported");
  assert.equal(native.effective.input.state, "supported");
  assert.equal(native.effective.toolResult.state, "supported");
  assert.match(native.effective.input.provenance, /native-sdk/);
  const unknown = effectiveFromRaw(rawInputCapability(undefined, undefined), null, "native");
  assert.equal(unknown.effective.toolResult.state, "unknown");
  const textOnly = effectiveFromRaw(rawInputCapability(["text"], "model.input"), null, "native");
  assert.equal(textOnly.effective.toolResult.state, "unsupported");
});

test("prepare rejects unknown or unsupported required image capabilities and leaves ordinary text workflows usable", async () => {
  const workflow = (requirements?: { inputModalities?: ("text" | "image")[] }) => ({
    schemaVersion: 1 as const, id: "caps", name: "Caps", revision: 1, entryGraph: "main",
    graphs: { main: { entry: "work", nodes: [
      { id: "work", kind: "agent" as const, role: "general" as const, task: { op: "literal" as const, value: "Go" }, config: { tools: [] as const, permission: "read-only" as const, ...(requirements ? { requirements } : {}) } },
      { id: "done", kind: "end" as const, value: { op: "ref" as const, path: ["nodes", "work"] } },
    ], edges: [{ from: "work", to: "done" }] } },
  });
  const text = await prepareExecutionPlan(workflow(), { cwd: process.cwd(), availableModels: [{ provider: "offline", id: "fixture", thinkingLevels: ["off"] }] });
  assert.equal(text.runtimeVersion, "dynamicwf-runtime-v9");
  assert.equal(text.agents.main!.work!.capabilities?.effective.input.state, "unknown");
  assert.deepEqual(text.agents.main!.work!.reasoning, { available: ["off"], requested: "medium", resolved: "off" });
  await assert.rejects(prepareExecutionPlan(workflow({ inputModalities: ["image"] }), { cwd: process.cwd(), availableModels: [{ provider: "offline", id: "fixture", thinkingLevels: ["off"] }] }), /unknown required image|Unsupported or unknown/);
});

test("capability intersection never widens frozen image permission and follows current denial", () => {
  const frozen = effectiveFromRaw(rawInputCapability(["text", "image"], "authenticated-accepts-images"), { packageName: "pi-xai-oauth", packageVersion: "1.5.2", contentDigest: "a".repeat(64), capabilityRevision: "dynamicwf-xai-bridge-v1", sdk: { piAi: "0.85.1", piCodingAgent: "0.85.1", piAgentCore: "0.85.1" }, files: { "package.json": "b".repeat(64) } }, "xai-auth");
  const denied = effectiveFromRaw(rawInputCapability(["text"], "authenticated-input-modalities"), frozen.effective.adapterRevision === "dynamicwf-xai-bridge-v1" ? { packageName: "pi-xai-oauth", packageVersion: "1.5.2", contentDigest: "a".repeat(64), capabilityRevision: "dynamicwf-xai-bridge-v1", sdk: { piAi: "0.85.1", piCodingAgent: "0.85.1", piAgentCore: "0.85.1" }, files: { "package.json": "b".repeat(64) } } : null, "xai-auth");
  const narrowed = intersectEffectiveCapabilities(frozen, denied);
  assert.equal(frozen.effective.toolResult.state, "supported");
  assert.equal(denied.effective.toolResult.state, "unsupported");
  assert.equal(narrowed.effective.toolResult.state, "unsupported");
  const unknown = effectiveFromRaw(rawInputCapability(["text"], "conservative-default"), { packageName: "pi-xai-oauth", packageVersion: "1.5.2", contentDigest: "a".repeat(64), capabilityRevision: "dynamicwf-xai-bridge-v1", sdk: { piAi: "0.85.1", piCodingAgent: "0.85.1", piAgentCore: "0.85.1" }, files: { "package.json": "b".repeat(64) } }, "xai-auth");
  assert.equal(intersectEffectiveCapabilities(frozen, unknown).effective.toolResult.state, "unknown");
  const laterSupported = frozen;
  const stillDenied = intersectEffectiveCapabilities(denied, laterSupported);
  assert.equal(stillDenied.effective.toolResult.state, "unsupported");
});
