import { preserveCredentialPersistence } from "./credential-persistence.js";
import { loadSdkAuthStorage } from "./sdk-auth-storage.js";
import { executionFailure } from "./execution-failure.js";
import { ModelRuntime, type CreateModelRuntimeOptions } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { AvailableExecutionModel } from "./execution-plan.js";
import { effectiveFromRaw, rawInputCapability } from "./capabilities.js";

export interface WorkflowModelRuntimeOptions extends CreateModelRuntimeOptions {
  requiredProvider?: string;
}
export async function createWorkflowModelRuntime(options: WorkflowModelRuntimeOptions = {}): Promise<ModelRuntime> {
  const { requiredProvider, ...runtimeOptions } = options;
  if (requiredProvider === "xai-auth") throw executionFailure("configuration", "setup", "not-started",
    "The pi-xai-oauth adapter has been removed. Use native xai/grok-4.6 and /login xai (Use a subscription). Existing frozen runs require an explicit continuation with the new provider; they are not silently migrated.");
  const credentials = preserveCredentialPersistence(runtimeOptions.credentials ??
    (await loadSdkAuthStorage()).create(runtimeOptions.authPath));
  return ModelRuntime.create({ ...runtimeOptions, credentials, allowModelNetwork: false });
}
export interface WorkflowCatalogOptions extends WorkflowModelRuntimeOptions {
  /** Explicit native xAI catalog refresh; ordinary discovery remains cache-only. */
  refresh?: boolean;
}
export async function discoverWorkflowCatalog(options: WorkflowCatalogOptions = {}): Promise<{ models: AvailableExecutionModel[]; issues: string[] }> {
  const { refresh, ...runtimeOptions } = options;
  const runtime = await createWorkflowModelRuntime(runtimeOptions);
  const issues: string[] = [];
  if (refresh) {
    const result = await runtime.refresh({ providers: ["xai"], allowNetwork: true, force: true, ...(options.signal ? { signal: options.signal } : {}) });
    if (result.aborted) issues.push("Native xAI catalog refresh cancelled");
    else if (result.errors.size) issues.push("Native xAI catalog refresh failed");
  }
  if (runtime.getError()) throw new Error("Authenticated pi model catalog discovery failed");
  return { models: runtime.getAvailableSnapshot().filter(model => model.provider !== "xai-auth").map(model => ({
    provider: model.provider, id: model.id, thinkingLevels: getSupportedThinkingLevels(model),
    capabilities: effectiveFromRaw(rawInputCapability(model.input, "model.input"), null, "native"),
    adapterIdentity: null,
  })), issues };
}
/** Credential-backed native pi catalog, without loading user extensions. */
export async function discoverWorkflowModels(options: WorkflowModelRuntimeOptions = {}): Promise<AvailableExecutionModel[]> {
  return (await discoverWorkflowCatalog(options)).models;
}
