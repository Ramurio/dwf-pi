import type { Json } from "./graph.js";

export type TaskDecision = "accepted" | "rejected" | "inconclusive";
export interface TaskOutcome {
  decision: TaskDecision | "unclassified";
  reason: string;
  evidence: Json[];
  source: "explicit" | "legacy";
}
export function explicitOutcome(decision: TaskDecision, reason: Json, evidence: Json): TaskOutcome {
  if (!["accepted", "rejected", "inconclusive"].includes(decision)) throw new Error("Unknown task outcome");
  if (typeof reason !== "string" || !reason.trim()) throw new Error("Task outcome requires a nonempty reason");
  if (!Array.isArray(evidence)) throw new Error("Task outcome evidence must be an array");
  return { decision, reason, evidence: structuredClone(evidence), source: "explicit" };
}
/** Old end outputs keep their meaning, but an arbitrary JSON value is not an acceptance claim. */
export function legacyOutcome(output: Json): TaskOutcome {
  const object = output && typeof output === "object" && !Array.isArray(output) ? output : {};
  const decision = object.accepted === true ? "accepted" : object.accepted === false ? "rejected" : "unclassified";
  return { decision, source: "legacy", evidence: [], reason: typeof object.reason === "string" && object.reason.trim()
    ? object.reason : decision === "unclassified" ? "Legacy end did not declare task acceptance" : `Legacy end returned accepted:${object.accepted}` };
}
