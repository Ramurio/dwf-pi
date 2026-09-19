import { createHash } from "node:crypto";

/** Historical frozen-plan format; no legacy adapter is loaded at runtime. */
export const xaiBridgeCapabilityRevision = "dynamicwf-xai-bridge-v1";
export interface SdkIdentity { piAi: string; piCodingAgent: string; piAgentCore: string }
export interface AdapterIdentityRecord {
  packageName: string;
  packageVersion: string;
  contentDigest: string;
  capabilityRevision: string;
  sdk: SdkIdentity;
  files: Record<string, string>;
}
export function adapterContentDigest(files: Readonly<Record<string, string>>): string {
  const hash = createHash("sha256");
  for (const path of Object.keys(files).sort()) hash.update(`${path}:${files[path]}\n`);
  return hash.digest("hex");
}

export function parseAdapterIdentity(value: unknown): AdapterIdentityRecord | undefined {
  if (value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return;
  const keys = Reflect.ownKeys(value);
  const required = ["packageName", "packageVersion", "contentDigest", "capabilityRevision", "sdk", "files"];
  if (keys.length !== required.length || required.some(key => !keys.includes(key))) return;
  const record = value as Record<string, unknown>;
  if (typeof record.packageName !== "string" || !record.packageName || typeof record.packageVersion !== "string" || !record.packageVersion) return;
  if (typeof record.contentDigest !== "string" || !/^[a-f0-9]{64}$/.test(record.contentDigest)) return;
  if (typeof record.capabilityRevision !== "string" || !record.capabilityRevision) return;
  if (!record.sdk || typeof record.sdk !== "object" || Array.isArray(record.sdk)) return;
  const sdkKeys = Reflect.ownKeys(record.sdk);
  if (sdkKeys.length !== 3 || sdkKeys.some(key => !["piAi", "piCodingAgent", "piAgentCore"].includes(String(key)))) return;
  const sdk = record.sdk as Record<string, unknown>;
  if (typeof sdk.piAi !== "string" || typeof sdk.piCodingAgent !== "string" || typeof sdk.piAgentCore !== "string") return;
  if (!record.files || typeof record.files !== "object" || Array.isArray(record.files)) return;
  const files: Record<string, string> = {};
  for (const [path, digest] of Object.entries(record.files as Record<string, unknown>)) {
    if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest) || !path) return;
    files[path] = digest;
  }
  if (adapterContentDigest(files) !== record.contentDigest) return;
  return {
    packageName: record.packageName, packageVersion: record.packageVersion, contentDigest: record.contentDigest,
    capabilityRevision: record.capabilityRevision,
    sdk: { piAi: sdk.piAi, piCodingAgent: sdk.piCodingAgent, piAgentCore: sdk.piAgentCore },
    files,
  };
}

export function adapterIdentitiesEqual(left: AdapterIdentityRecord | null | undefined, right: AdapterIdentityRecord | null | undefined): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.packageName === right.packageName && left.packageVersion === right.packageVersion
    && left.contentDigest === right.contentDigest && left.capabilityRevision === right.capabilityRevision;
}
