import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkflow, type WorkflowDefinition } from "../src/graph.js";
import { invalidSchemaCases, validSchemaCases } from "./helpers/schema-cases.js";

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

function assertSchemaIssue(result: ReturnType<typeof validateWorkflow>, path: string, message: string) {
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues.filter((issue) => issue.path === path), [{ path, message }]);
}

test("workflow.validate compiles effective agent outputSchema with the prepare validator", () => {
  for (const { schema, message } of Object.values(invalidSchemaCases)) {
    assertSchemaIssue(validateWorkflow(agentFlow("general", schema)), "$.graphs.main.nodes[0].config.outputSchema", message);
  }
  const nestedInvalid = invalidSchemaCases["root-array"];
  assertSchemaIssue(
    validateWorkflow(nestedFlow(nestedInvalid.schema)),
    "$.graphs.child.nodes[0].config.outputSchema",
    nestedInvalid.message,
  );
  assertSchemaIssue(
    validateWorkflow(agentFlow("reviewer", nestedInvalid.schema)),
    "$.graphs.main.nodes[0].config.outputSchema",
    nestedInvalid.message,
  );

  const override = validSchemaCases["answer-override"].schema;
  const localRef = validSchemaCases["local-ref"].schema;
  const literalRef = validSchemaCases["literal-ref"].schema;
  for (const workflow of [
    agentFlow("general"), agentFlow("reviewer"), agentFlow("general", override), agentFlow("reviewer", override),
    agentFlow("general", localRef), agentFlow("general", literalRef), nestedFlow(override),
  ]) assert.deepEqual(validateWorkflow(workflow), { valid: true, issues: [] });
});
