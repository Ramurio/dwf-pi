import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

const progressSchema = Type.Object({
  round: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  status: Type.Enum(["running", "succeeded", "invalid", "failed"]),
  cause: Type.Enum(["missing", "schema", "duplicate"]),
  /** Worker report IDs in (afterReport, throughReport]; same activation attempt. */
  afterReport: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  throughReport: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false });
export type OutputRepairProgress = Static<typeof progressSchema>;
export type OutputFailureCause = OutputRepairProgress["cause"];
export const outputFailureMessages: Record<OutputFailureCause, string> = {
  missing: "Pi worker completed without exactly one valid submit_result",
  schema: "submit_result failed strict output schema validation",
  duplicate: "submit_result called more than once",
};
export function parseOutputRepairProgress(value: unknown): OutputRepairProgress | null {
  return Check(progressSchema, value) && value.throughReport >= value.afterReport ? value : null;
}
