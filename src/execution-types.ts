import { createHash } from "node:crypto";
import type { ExecutionFailureRecord } from "./execution-failure.js";
import type { AgentConfig } from "./catalog.js";
import type { Json, WorkflowDefinition } from "./graph.js";
import type { TokenUsage } from "./usage.js";

export const runtimeVersion = "dynamicwf-runtime-v7";
export interface SkillFileSnapshot { path: string; base64: string; executable: boolean }
export interface SkillSnapshot { name: string; hash: string; files: SkillFileSnapshot[] }
export interface FrozenAgent {
  model: { provider: string; id: string };
  thinking: NonNullable<AgentConfig["thinking"]>;
  systemPrompt: string;
  tools: NonNullable<AgentConfig["tools"]>;
  skills: SkillSnapshot[];
  session: "fresh" | "continue-node";
  permission: "read-only" | "workspace-write" | "unrestricted";
  outputSchema: Record<string, unknown>;
  /** Required since v4; absent in v1–v3 means disabled. */
  outputRepair?: NonNullable<AgentConfig["outputRepair"]>;
}
export interface ExecutionPlan {
  version: 1;
  runtimeVersion: "dynamicwf-runtime-v1" | "dynamicwf-runtime-v2" | "dynamicwf-runtime-v3" | "dynamicwf-runtime-v4" | "dynamicwf-runtime-v5" | "dynamicwf-runtime-v6" | typeof runtimeVersion;
  compilerVersion: string;
  workflow: WorkflowDefinition;
  source: string;
  sourceHash: string;
  agents: Record<string, Record<string, FrozenAgent>>;
  hash: string;
}
export interface PiWorkerRequest {
  version: 1;
  config: FrozenAgent;
  task: string;
  input: Json;
  cwd: string;
  sessionDirectory: string;
  resourceDirectory: string;
  sessionFile?: string;
}
export interface PiWorkerResult {
  output: Json;
  sessionFile: string;
  model: { provider: string; id: string };
  thinking: FrozenAgent["thinking"];
  usage: TokenUsage;
}
export type PiWorkerMessage =
  | { type: "ready" }
  | { type: "event"; event: { type: string; [key: string]: unknown } }
  | { type: "result"; result: PiWorkerResult }
  | { type: "error"; error: string; failure?: ExecutionFailureRecord };

export interface PreparedExecution {
  preparedId: string;
  planHash: string;
  cwd: string;
  createdAt: number;
  plan: ExecutionPlan;
}

/** A prepared handle binds the workspace as well as frozen plan bytes. */
export function preparedExecutionId(planHash: string, cwd: string): string {
  return `prepared-${createHash("sha256").update(JSON.stringify(["dynamicwf-prepared-v1", planHash, cwd])).digest("hex")}`;
}
