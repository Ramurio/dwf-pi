import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { executionFailure, type ExecutionFailure } from "./execution-failure.js";
import { diagnosticMessages, localDiagnostic, type TrustedRequestObservation } from "./request-observation.js";

export const xaiAdapterPackageNames = ["pi-xai-oauth", "@blockedpath/pi-xai-oauth"] as const;
export const xaiAdapterVersion = "1.5.2";
export const xaiBridgeCapabilityRevision = "dynamicwf-xai-bridge-v1";
export const reviewedSdkVersions = {
  piAi: "0.85.1",
  piCodingAgent: "0.85.1",
  piAgentCore: "0.85.1",
} as const;
/** Reviewed helper import closure for catalog/models/responses. Version string alone is not this digest. */
export const reviewedHelperFiles: Readonly<Record<string, string>> = {
  "extensions/xai/abort.ts": "7420a32c7e62d6cd25df15f5e83ec4216f0a34ea47e3593f67244e506df0cbb8",
  "extensions/xai/bounded-body.ts": "13de1264aba833cf2a761c3c5d31967cc2fcd0cca33978d25dd5c5996459a9eb",
  "extensions/xai/catalog.ts": "f9f081855087de8aca418cf3f32ce62fffcaa1408768d55386194ac153745253",
  "extensions/xai/constants.ts": "d965b09a94fa0b7a2836d60d7d570cea58cace7f4c92cb7d1c6244aa9dcfb3b6",
  "extensions/xai/images.ts": "6e2922b492158dd2e6c27f43195faf9c451d46ddc48829d3afce42d2edb956be",
  "extensions/xai/media/constants.ts": "5fb7abfacfa2c40bbfc0f708d6a6a88f2044fc220a1641eb31be62c4e34ecc74",
  "extensions/xai/media/data-url.ts": "93eb3a96c25aeb350be8c96787b264a0ecb3dd9fc1f582ae140282291220d894",
  "extensions/xai/media/image-info.ts": "3a60a4ed96d49dd5729888026ff57ec86fb979011e2c6445d8cd2773a6db4c53",
  "extensions/xai/media/paths.ts": "ff611cb86939bf4b455ea632bdfa37934268d199715d6040995a12742bc636e0",
  "extensions/xai/media/types.ts": "4f3f95e29e42aceba056d970860d67deb1e491db26cccf40fdb229ff9adfb4d5",
  "extensions/xai/models.ts": "466634fe7d4f8cce6d357f6bbdd79653de24a99c117ba55aff811d11db9866c9",
  "extensions/xai/payload.ts": "aacddbaefc538014d8aa44c181a20d6ea54a671dd711be6f5c3db406dffe08c1",
  "extensions/xai/responses.ts": "a3ad71f1ab878d015981fa12a45583e4f45bc8dcaddc5c55ca9bc43da16a9c4b",
  "extensions/xai/routing.ts": "9c6bda43ace86f1b9e2384acb3a7a29ab2eb0aa7ed4e1f1d4385cfcdfc424849",
  "extensions/xai/text.ts": "985610c99ad38713705996d50ab990a9da6de3d373251f2fce9ffb472f738a5c",
  "extensions/xai/vision-routing.ts": "1586d73e24afb1dae2a8df7169d3286a9d22ad8482113d311f39c7eec2cd3c5d",
  "extensions/xai/wire.ts": "1765d0750e89a929bb2aab75771ce7e68bf4e7993f4fb0fd82d7eea8528625d2",
  "package.json": "590fe6f687a9eec030854e67f23806ad7788bc638e8bda1e60c1848b1453d0e8",
};
export const reviewedHelperFileList = Object.keys(reviewedHelperFiles).sort();
export interface SdkIdentity { piAi: string; piCodingAgent: string; piAgentCore: string }
export interface AdapterIdentityRecord {
  packageName: string;
  packageVersion: string;
  contentDigest: string;
  capabilityRevision: string;
  sdk: SdkIdentity;
  files: Record<string, string>;
}
export function readInstalledSdkIdentity(): SdkIdentity {
  const version = (specifier: string): string => {
    try {
      let dir = dirname(fileURLToPath(import.meta.resolve(specifier)));
      for (let i = 0; i < 8; i++) {
        try {
          const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string; version?: string };
          if (pkg.name === specifier) return String(pkg.version ?? "");
        } catch { /* walk up */ }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch { /* missing package */ }
    return "";
  };
  return {
    piAi: version("@earendil-works/pi-ai"),
    piCodingAgent: version("@earendil-works/pi-coding-agent"),
    piAgentCore: version("@earendil-works/pi-agent-core"),
  };
}

export function adapterContentDigest(files: Readonly<Record<string, string>>): string {
  const hash = createHash("sha256");
  for (const path of Object.keys(files).sort()) hash.update(`${path}:${files[path]}\n`);
  return hash.digest("hex");
}

function mismatch(observation?: TrustedRequestObservation): ExecutionFailure {
  const error = executionFailure("configuration", "setup", "not-started",
    diagnosticMessages["adapter-content-mismatch"],
    { diagnostic: { subcode: "adapter-content-mismatch", dispatch: "not-dispatched" } });
  localDiagnostic(observation, { subcode: "adapter-content-mismatch", code: "configuration", message: error.message, dispatch: "not-dispatched" });
  return error;
}

export async function inspectReviewedAdapter(packageRoot: string, observation?: TrustedRequestObservation, sdk: SdkIdentity = readInstalledSdkIdentity()): Promise<AdapterIdentityRecord> {
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")); }
  catch { throw mismatch(observation); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw mismatch(observation);
  const manifest = parsed as { name?: unknown; version?: unknown };
  const packageName = manifest.name;
  const packageVersion = manifest.version;
  if (typeof packageName !== "string" || typeof packageVersion !== "string" || !(xaiAdapterPackageNames as readonly string[]).includes(packageName) || packageVersion !== xaiAdapterVersion) {
    throw mismatch(observation);
  }
  const files: Record<string, string> = {};
  for (const relative of reviewedHelperFileList) {
    let bytes: Buffer;
    try { bytes = await readFile(join(packageRoot, relative)); }
    catch { throw mismatch(observation); }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== reviewedHelperFiles[relative]) throw mismatch(observation);
    files[relative] = digest;
  }
  if (sdk.piAi !== reviewedSdkVersions.piAi || sdk.piCodingAgent !== reviewedSdkVersions.piCodingAgent || sdk.piAgentCore !== reviewedSdkVersions.piAgentCore) {
    throw mismatch(observation);
  }
  return {
    packageName,
    packageVersion,
    contentDigest: adapterContentDigest(files),
    capabilityRevision: xaiBridgeCapabilityRevision,
    sdk,
    files,
  };
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
