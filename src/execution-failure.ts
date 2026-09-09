/** Structured observations, not retry authorization. Unknown facts stay unknown. */
export const failureCodes = ["configuration", "resource", "provider", "output", "process", "protocol", "cancelled", "interrupted", "expression", "uncertain-effect", "unknown"] as const;
export const failurePhases = ["setup", "execution", "output", "routing", "recovery", "cleanup", "unknown"] as const;
export const effectStates = ["not-started", "read-only", "unknown"] as const;
export interface ExecutionFailureRecord {
  version: 1;
  code: typeof failureCodes[number];
  phase: typeof failurePhases[number];
  effects: typeof effectStates[number];
  message: string;
}
export class ExecutionFailure extends Error {
  readonly failure: ExecutionFailureRecord;
  constructor(failure: ExecutionFailureRecord) {
    super(failure.message);
    this.name = "ExecutionFailure";
    const parsed = parseExecutionFailure(failure);
    if (!parsed) throw new Error("Invalid structured execution failure");
    this.failure = Object.freeze(parsed);
  }
}
export function executionFailure(code: ExecutionFailureRecord["code"], phase: ExecutionFailureRecord["phase"], effects: ExecutionFailureRecord["effects"], message: string): ExecutionFailure {
  return new ExecutionFailure({ version: 1, code, phase, effects, message });
}
/** Closed JSON protocol. Do not recognize provider/task strings as trusted exception classes. */
export function parseExecutionFailure(value: unknown): ExecutionFailureRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) return;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== 5 || ["version","code","phase","effects","message"].some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key]!,"value"))) return;
  const record = value as ExecutionFailureRecord;
  if (record.version !== 1 || !failureCodes.includes(record.code) || !failurePhases.includes(record.phase) || !effectStates.includes(record.effects) || typeof record.message !== "string" || !record.message.length) return;
  return { version: 1, code: record.code, phase: record.phase, effects: record.effects, message: record.message };
}
export function failureRecord(error: unknown, fallback: Omit<ExecutionFailureRecord,"version">): ExecutionFailureRecord {
  return error instanceof ExecutionFailure ? error.failure : { version: 1, ...fallback };
}
