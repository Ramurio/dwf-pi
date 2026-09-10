import { Type } from "typebox";
import { Check } from "typebox/value";
import { assertJson } from "./output-schema.js";
import type { Json } from "./graph.js";

export type IntegrationProgress = {
  phase: "ready" | "merging" | "between" | "complete";
  branch: string; originalHead: string; merged: string[];
  current?: { sourceHead: string; before: string }; head?: string;
};
export type OperationRecord =
  | { kind: "agent"; cwd: string; task: string; input: Json; sessionDirectory: string; resourceDirectory: string; continuedSessionFile?: string }
  | { kind: "check"; cwd: string; command: string; args: string[] }
  | { kind: "worktree"; source: string; childScope: string[]; base?: string; childResult?: Json }
  | { kind: "integrate"; target: string; sources: Json; progress?: IntegrationProgress };
const closed={additionalProperties:false} as const,string=Type.String(),hash=Type.String({pattern:"^(?:[a-f0-9]{40}|[a-f0-9]{64})$"});
const progress=Type.Object({phase:Type.Enum(["ready","merging","between","complete"]),branch:string,originalHead:hash,merged:Type.Array(hash),current:Type.Optional(Type.Object({sourceHead:hash,before:hash},closed)),head:Type.Optional(hash)},closed);
const schema=Type.Union([
  Type.Object({kind:Type.Literal("agent"),cwd:string,task:string,input:Type.Any(),sessionDirectory:string,resourceDirectory:string,continuedSessionFile:Type.Optional(string)},closed),
  Type.Object({kind:Type.Literal("check"),cwd:string,command:string,args:Type.Array(string)},closed),
  Type.Object({kind:Type.Literal("worktree"),source:string,childScope:Type.Array(string),base:Type.Optional(string),childResult:Type.Optional(Type.Any())},closed),
  Type.Object({kind:Type.Literal("integrate"),target:string,sources:Type.Any(),progress:Type.Optional(progress)},closed),
]);
/** An intent/progress observation is not proof that an external operation completed. */
export function parseOperation(value: unknown): OperationRecord | undefined {
  try{assertJson(value);}catch{return;}
  if(!Check(schema,value))return;
  const operation=value as unknown as OperationRecord;
  if(operation.kind==="integrate" && operation.progress && ((operation.progress.phase==="merging")!==Object.hasOwn(operation.progress,"current") || (operation.progress.phase==="complete")!==Object.hasOwn(operation.progress,"head")))return;
  return structuredClone(operation);
}
