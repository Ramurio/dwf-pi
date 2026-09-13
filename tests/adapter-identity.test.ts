import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectReviewedAdapter, reviewedHelperFiles, reviewedSdkVersions, xaiAdapterVersion } from "../src/adapter-identity.js";
import { ExecutionFailure } from "../src/execution-failure.js";
import { createRequestObservation } from "../src/request-observation.js";

const packageRoot = join(homedir(), ".pi/agent/npm/node_modules/pi-xai-oauth");

test("reviewed helper identity is content-addressed and does not treat version as proof", async () => {
  const identity = await inspectReviewedAdapter(packageRoot);
  assert.equal(identity.packageVersion, xaiAdapterVersion);
  assert.equal(identity.files["extensions/xai/images.ts"], reviewedHelperFiles["extensions/xai/images.ts"]);
  assert.equal(identity.sdk.piAi, "0.85.1");
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.notEqual(manifest.peerDependencies["@earendil-works/pi-ai"], "0.85.1");
});

test("same-version helper tamper is adapter-content-mismatch before import", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-adapter-tamper-"));
  try {
    await cp(packageRoot, directory, { recursive: true });
    const target = join(directory, "extensions/xai/images.ts");
    await writeFile(target, `${await readFile(target, "utf8")}\n// tamper\n`);
    await assert.rejects(inspectReviewedAdapter(directory), (error: unknown) => {
      assert.ok(error instanceof ExecutionFailure);
      assert.equal(error.failure.code, "configuration");
      assert.equal(error.failure.diagnostic?.subcode, "adapter-content-mismatch");
      assert.equal(error.failure.diagnostic?.dispatch, "not-dispatched");
      return true;
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("missing transitive helper module is adapter-content-mismatch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-adapter-missing-"));
  try {
    await cp(packageRoot, directory, { recursive: true });
    await rm(join(directory, "extensions/xai/media/image-info.ts"));
    await assert.rejects(inspectReviewedAdapter(directory), (error: unknown) => {
      assert.ok(error instanceof ExecutionFailure);
      assert.equal(error.failure.diagnostic?.subcode, "adapter-content-mismatch");
      return true;
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function assertTrustedMismatch(error: unknown, observation: ReturnType<typeof createRequestObservation>, leaked?: string): boolean {
  assert.ok(error instanceof ExecutionFailure);
  assert.equal(error.failure.code, "configuration");
  assert.equal(error.failure.diagnostic?.subcode, "adapter-content-mismatch");
  assert.equal(error.failure.diagnostic?.dispatch, "not-dispatched");
  assert.equal(observation.diagnosticSubcode, "adapter-content-mismatch");
  assert.equal(observation.failureCode, "configuration");
  assert.equal(observation.dispatch, "not-dispatched");
  assert.equal(observation.message, error.failure.message);
  const publicText = `${error.failure.message}\n${JSON.stringify(error.failure)}\n${observation.message}`;
  assert.doesNotMatch(publicText, /ENOENT|EACCES|TEST_ACCESS|TEST_REFRESH/);
  if (leaked) assert.doesNotMatch(publicText, new RegExp(leaked.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  return true;
}

test("missing or unreadable adapter manifest records a trusted not-dispatched diagnostic", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-adapter-absent-"));
  try {
    const observation = createRequestObservation();
    await assert.rejects(inspectReviewedAdapter(join(directory, "missing-helper"), observation), error => assertTrustedMismatch(error, observation, directory));
    for (const contents of ["{not-json", "null", "[]", "42", "\"invalid\""]) {
      const observation = createRequestObservation();
      await writeFile(join(directory, "package.json"), contents);
      await assert.rejects(inspectReviewedAdapter(directory, observation), error => assertTrustedMismatch(error, observation, directory));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("unsupported adapter identity/version records a trusted not-dispatched diagnostic", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-adapter-identity-"));
  try {
    await writeFile(join(directory, "package.json"), JSON.stringify({ name: "unrelated", version: xaiAdapterVersion }));
    const observation = createRequestObservation();
    await assert.rejects(inspectReviewedAdapter(directory, observation), error => assertTrustedMismatch(error, observation, directory));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("SDK version mismatch records a trusted not-dispatched diagnostic", async () => {
  const observation = createRequestObservation();
  await assert.rejects(inspectReviewedAdapter(packageRoot, observation, { piAi: "0.0.0", piCodingAgent: reviewedSdkVersions.piCodingAgent, piAgentCore: reviewedSdkVersions.piAgentCore }), error => assertTrustedMismatch(error, observation, packageRoot));
});
