import assert from "node:assert/strict";
import test from "node:test";
import { adapterContentDigest, parseAdapterIdentity } from "../src/adapter-identity.js";

test("historical frozen adapter identities remain readable without the removed plugin", () => {
  const files = { "extensions/xai/responses.ts": "a".repeat(64) };
  const identity = { packageName: "pi-xai-oauth", packageVersion: "1.5.2", capabilityRevision: "dynamicwf-xai-bridge-v1", files,
    contentDigest: adapterContentDigest(files), sdk: { piAi: "0.85.1", piCodingAgent: "0.85.1", piAgentCore: "0.85.1" } };
  assert.deepEqual(parseAdapterIdentity(identity), identity);
  assert.equal(parseAdapterIdentity({ ...identity, files: { ...files, extra: "b".repeat(64) } }), undefined);
  assert.equal(parseAdapterIdentity({ ...identity, unexpected: true }), undefined);
});
