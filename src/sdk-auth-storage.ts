import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";

interface LocalAuthStorage {
  create(path?: string): CredentialStore;
  inMemory(data?: Record<string, Credential>): CredentialStore;
}
/** Private SDK entry point, deliberately restricted to the project's pinned dependency. */
export async function loadSdkAuthStorage(): Promise<LocalAuthStorage> {
  const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  const root = dirname(dirname(entry));
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (manifest.name !== "@earendil-works/pi-coding-agent" || manifest.version !== "0.85.1") {
    throw new Error("Credential persistence requires project SDK 0.85.1");
  }
  const { AuthStorage } = await import(pathToFileURL(join(root, "dist/core/auth-storage.js")).href);
  if (typeof AuthStorage?.create !== "function" || typeof AuthStorage?.inMemory !== "function" ||
      ["read", "list", "modify", "delete"].some(key => typeof AuthStorage.prototype?.[key] !== "function")) {
    throw new Error("Unsupported project SDK AuthStorage API");
  }
  return AuthStorage as LocalAuthStorage;
}
