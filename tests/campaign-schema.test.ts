import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkflow, type WorkflowDefinition } from "../src/graph.js";
import { createOutputValidator, defaultOutputSchema } from "../src/output-schema.js";

const task = { op: "literal" as const, value: "Complete task" };

function agentFlow(role: "general" | "reviewer", outputSchema?: Record<string, unknown>): WorkflowDefinition {
  return {
    schemaVersion: 1, id: "sample", name: "Sample", revision: 1, entryGraph: "main",
    graphs: { main: { entry: "work", nodes: [
      { id: "work", kind: "agent", role, task, ...(outputSchema ? { config: { outputSchema } } : {}) },
      { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "work"] } },
    ], edges: [{ from: "work", to: "done" }] } },
  };
}

function nestedFlow(outputSchema: Record<string, unknown>): WorkflowDefinition {
  return {
    schemaVersion: 1, id: "sample", name: "Sample", revision: 1, entryGraph: "main",
    graphs: {
      main: { entry: "call", nodes: [
        { id: "call", kind: "subworkflow", graphId: "child", input: { op: "literal", value: null } },
        { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "call"] } },
      ], edges: [{ from: "call", to: "done" }] },
      child: { entry: "work", nodes: [
        { id: "work", kind: "agent", role: "general", task, config: { outputSchema } },
        { id: "end", kind: "end", value: { op: "ref", path: ["nodes", "work"] } },
      ], edges: [{ from: "work", to: "end" }] },
    },
  };
}

function validatorMessage(schema: Record<string, unknown>): string {
  try { createOutputValidator(schema); }
  catch (error) { if (error instanceof Error) return error.message; }
  throw new Error("createOutputValidator accepted a schema that the current contract rejects");
}

function assertSchemaIssue(result: ReturnType<typeof validateWorkflow>, path: string, message: string) {
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues.filter((issue) => issue.path === path), [{ path, message }]);
}

test("workflow.validate compiles effective agent outputSchema with the prepare validator", () => {
  const invalid: Record<string, unknown>[] = [
    { type: "array" },
    { type: "object", typo: true },
    { type: "object", properties: { x: { type: "banana" } } },
    { type: "object", $ref: "https://remote.example/schema" },
    { type: "object", $dynamicRef: "https://remote.example/schema" },
    { type: "object", $async: true },
    { type: "object", $schema: "https://unsupported.example" },
    { type: "object", properties: { id: { type: "string", format: "email" } } },
    { type: "object", properties: { count: { $ref: "#/$defs/missing" } } },
  ];
  for (const schema of invalid) {
    assertSchemaIssue(validateWorkflow(agentFlow("general", schema)), "$.graphs.main.nodes[0].config.outputSchema", validatorMessage(schema));
  }
  const nestedInvalid = { type: "array" };
  assertSchemaIssue(
    validateWorkflow(nestedFlow(nestedInvalid)),
    "$.graphs.child.nodes[0].config.outputSchema",
    validatorMessage(nestedInvalid),
  );
  assertSchemaIssue(
    validateWorkflow(agentFlow("reviewer", { type: "array" })),
    "$.graphs.main.nodes[0].config.outputSchema",
    validatorMessage({ type: "array" }),
  );

  const override = { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"] };
  const localRef = { type: "object", properties: { count: { $ref: "#/$defs/count" } }, required: ["count"], additionalProperties: false, $defs: { count: { type: "integer", minimum: 1 } } };
  const literalRef = { type: "object", const: { $ref: "https://literal.example" } };
  for (const schema of [{ ...defaultOutputSchema }, override, localRef, literalRef]) createOutputValidator(schema);
  for (const workflow of [
    agentFlow("general"), agentFlow("reviewer"), agentFlow("general", override), agentFlow("reviewer", override),
    agentFlow("general", localRef), agentFlow("general", literalRef), nestedFlow(override),
  ]) assert.deepEqual(validateWorkflow(workflow), { valid: true, issues: [] });
});
