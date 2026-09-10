import { parseExecutionFailure, type ExecutionFailureRecord } from "./execution-failure.js";
import { assertJson } from "./output-schema.js";
import type { Json } from "./graph.js";

export type CollectedResult = { status: "succeeded"; value: Json } | { status: "failed"; failure: ExecutionFailureRecord };
export interface CollectionRecord { seq: number; runId: string; key: string; itemId: string; attempt: number; at: number; result: CollectedResult }
export function validateCollectedResult(value: unknown): CollectedResult {
  assertJson(value);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2) throw new Error("Invalid collected result");
  if (value.status === "succeeded" && Object.hasOwn(value, "value")) return structuredClone(value) as CollectedResult;
  if (value.status === "failed" && parseExecutionFailure(value.failure)) return structuredClone(value) as CollectedResult;
  throw new Error("Invalid collected result");
}
