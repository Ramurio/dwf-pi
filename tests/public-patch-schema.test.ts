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
    assert.deepEqual(portableInputSchema(PublicDraftPatchSchema), PublicDraftPatchSchema);
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
    const value = { $id: "data", $ref: "Thing", $defs: { nested: [{ $ref: "literal" }] } };
    const node = { id: "done", kind: "end", value: { op: "literal", value } };
    const request = { id: "demo", expectedRevision: 2, operations: [{ op: "addNode", graphId: "main", node }] };
    validate(request);
    await service.dispatch("workflow.patch", request);
    const inspected = await service.dispatch("workflow.inspect", { id: "demo" }) as any;
    assert.deepEqual(inspected.graphs.main.nodes, [node]);
    await assert.rejects(service.dispatch("workflow.patch", internal));
  } finally { service.close(); }
});

test("public draft schema compiles independently after JSON transport", async () => {
  const service = new WorkflowService(":memory:");
  try {
    const schemas = JSON.parse(JSON.stringify(await service.dispatch("workflow.schema")));
    const validate = createOutputValidator(schemas.draft);
    const draft = await service.dispatch("workflow.create", { id: "portable", name: "Переносимая схема" });
    assert.deepEqual(validate(draft), draft);
    assert.throws(() => validate({ ...(draft as object), extra: true }));
  } finally { service.close(); }
});
