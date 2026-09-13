import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const REPAIR_LIVE_EVIDENCE_ENV = "DYNAMICWF_REPAIR_LIVE_EVIDENCE";
export const REPAIR_LIVE_EVIDENCE_FILENAME = "repair-live-latest.json";

export function defaultRepairLiveEvidencePath(packageRoot: string): string {
  return join(resolve(packageRoot), "scratch", REPAIR_LIVE_EVIDENCE_FILENAME);
}

export function resolveRepairLiveEvidencePath(options: {
  packageRoot: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
}): { path: string; source: "override" | "default" } {
  const raw = options.env?.[REPAIR_LIVE_EVIDENCE_ENV]?.trim();
  if (raw) {
    return { path: isAbsolute(raw) ? raw : resolve(options.cwd ?? process.cwd(), raw), source: "override" };
  }
  return { path: defaultRepairLiveEvidencePath(options.packageRoot), source: "default" };
}

export async function publishRepairLiveEvidence(destination: string, body: string): Promise<string> {
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, body);
  return destination;
}
