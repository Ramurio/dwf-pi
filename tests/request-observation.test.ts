import assert from "node:assert/strict";
import test from "node:test";
import { parseExecutionFailure } from "../src/execution-failure.js";
import { createRequestObservation, diagnosticFromObservation, localDiagnostic, markFetchAttempted, markHttpObserved, parseFailureDiagnostic, runWithRequestObservation } from "../src/request-observation.js";

test("trusted diagnostics are closed and are not recovered from error prose", () => {
  assert.equal(parseFailureDiagnostic({ dispatch: "not-dispatched", subcode: "image-unsupported", extra: true }), undefined);
  assert.equal(parseFailureDiagnostic({ dispatch: "not-dispatched", subcode: "made-up" }), undefined);
  const observation = createRequestObservation();
  localDiagnostic(observation, { subcode: "image-invalid", code: "resource" });
  assert.deepEqual(diagnosticFromObservation(observation), { subcode: "image-invalid", dispatch: "not-dispatched" });
  const forged = parseExecutionFailure({ version: 1, code: "provider", phase: "execution", effects: "read-only", message: "adapter-content-mismatch image-unsupported" });
  assert.equal(forged?.diagnostic, undefined);
  assert.equal(parseExecutionFailure({ version: 1, code: "configuration", phase: "setup", effects: "not-started", message: "safe", diagnostic: { dispatch: "not-dispatched", subcode: "adapter-content-mismatch", headers: "SECRET" } }), undefined);
});

test("request observations stay isolated across nested turns", async () => {
  const first = createRequestObservation();
  const second = createRequestObservation();
  await runWithRequestObservation(first, async () => {
    markFetchAttempted(first);
    await runWithRequestObservation(second, async () => {
      localDiagnostic(second, { subcode: "image-unsupported", code: "configuration" });
    });
    markHttpObserved(first, { status: 503, retryAfterMs: 1000 });
  });
  assert.equal(first.dispatch, "http-observed");
  assert.equal(first.diagnosticSubcode, undefined);
  assert.equal(second.dispatch, "not-dispatched");
  assert.equal(second.providerResponse, undefined);
  assert.equal(first.providerResponse?.status, 503);
});
