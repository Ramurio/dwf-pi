import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { createWorkflowModelRuntime, discoverWorkflowCatalog } from "../src/model-runtime.js";
import { ExecutionFailure } from "../src/execution-failure.js";

test("native OAuth catalog exposes Grok 4.6 xhigh and vision without an extension", async () => {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify("xai", async () => ({ type: "oauth", access: "TEST_NATIVE_ACCESS", refresh: "TEST_NATIVE_REFRESH", expires: Date.now() + 3600000 }));
  await credentials.modify("xai-auth", async () => ({ type: "oauth", access: "TEST_LEGACY_ACCESS", refresh: "TEST_LEGACY_REFRESH", expires: Date.now() + 3600000 }));
  const options = { credentials, modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: true };
  const before = globalThis.fetch;
  const runtime = await createWorkflowModelRuntime(options);
  assert.equal(runtime.getRegisteredNativeProvider("xai-auth"), undefined);
  const { models, issues } = await discoverWorkflowCatalog(options);
  assert.deepEqual(issues, []);
  assert.equal(models.some(model => model.provider === "xai-auth"), false);
  const grok = models.find(model => model.provider === "xai" && model.id === "grok-4.6");
  assert.ok(grok);
  assert.ok(grok.thinkingLevels.includes("xhigh"));
  assert.equal(grok.capabilities?.effective.toolResult.state, "supported");
  assert.equal(grok.adapterIdentity, null);
  assert.equal(globalThis.fetch, before);
  assert.doesNotMatch(JSON.stringify(models), /TEST_NATIVE|TEST_LEGACY/);
});

test("a historical xai-auth worker fails explicitly instead of switching provider", async () => {
  await assert.rejects(createWorkflowModelRuntime({ requiredProvider: "xai-auth" }), (error: unknown) => {
    assert.ok(error instanceof ExecutionFailure);
    assert.equal(error.failure.effects, "not-started");
    assert.equal(error.failure.code, "configuration");
    assert.match(error.message, /removed.*native xai/s);
    return true;
  });
});
