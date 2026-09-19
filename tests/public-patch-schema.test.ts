import test from "node:test";
import assert from "node:assert/strict";
import { WorkflowService } from "../src/service.js";
import { DraftPatchSchema, PublicDraftPatchSchema } from "../src/authoring.js";
import { createOutputValidator } from "../src/output-schema.js";
import { portableInputSchema, type InputSchema } from "../src/public-schema.js";

test("public patch requires id while internal patch excludes it", async () => {
  const service = new WorkflowService(":memory:");
  try {
    const schemas = await service.dispatch("workflow.schema") as any;
    assert.deepEqual(schemas.patch, PublicDraftPatchSchema);
    assert.ok(schemas.patch.required.includes("id"));
    assert.equal(schemas.patch.additionalProperties, false);
    const internal = { expectedRevision: 1, operations: [{ op: "addGraph", graphId: "child" }] };
    const validate = createOutputValidator(schemas.patch);
    validate({ id: "demo", ...internal });
    assert.throws(() => validate(internal));
    assert.throws(() => validate({ id: "demo", ...internal, extra: true }));
    const privateValidate = createOutputValidator(portableInputSchema(DraftPatchSchema as unknown as InputSchema));
    privateValidate(internal);
    assert.throws(() => privateValidate({ id: "demo", ...internal }));
    await service.dispatch("workflow.create", { id: "demo", name: "Demo" });
    await service.dispatch("workflow.patch", { id: "demo", ...internal });
    await assert.rejects(service.dispatch("workflow.patch", internal));
  } finally { service.close(); }
});
