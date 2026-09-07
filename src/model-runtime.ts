import { getAgentDir, ModelRuntime, type CreateModelRuntimeOptions } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { AvailableExecutionModel } from "./execution-plan.js";
import type { XaiProviderOptions } from "./xai-provider.js";
export interface WorkflowModelRuntimeOptions extends CreateModelRuntimeOptions {
  /** Auto registers only when xai-auth OAuth credentials are configured; false disables integration. */
  grok?: false | XaiProviderOptions;
  requiredProvider?: string;
  onDiagnostic?: (message: string) => void;
}
export async function createWorkflowModelRuntime(options: WorkflowModelRuntimeOptions = {}): Promise<ModelRuntime> {
  const { grok, requiredProvider, onDiagnostic, ...runtimeOptions } = options;
  const runtime = await ModelRuntime.create({ ...runtimeOptions, allowModelNetwork: false });
  if (grok === false) return runtime;
  const configured = (await runtime.listCredentials()).some(item => item.providerId === "xai-auth" && item.type === "oauth");
  if (!configured && !grok) return runtime;
  let registered = false;
  try {
    const { createXaiSubscriptionProvider } = await import("./xai-provider.js");
    runtime.registerNativeProvider(await createXaiSubscriptionProvider(grok || { agentDirectory: getAgentDir() }));
    registered = true;
    const refresh = await runtime.refresh({ providers: ["xai-auth"], allowNetwork: false, ...(options.signal ? { signal: options.signal } : {}) });
    if (refresh.errors.size) throw new Error("Grok subscription cached catalog could not be restored");
  } catch (error) {
    const message = error instanceof Error && /^(Grok subscription adapter is missing|Unsupported Grok adapter identity\/version|Grok subscription cached catalog)/.test(error.message)
      ? error.message : "Grok subscription adapter could not be loaded; verify local pi-xai-oauth 1.5.2 installation";
    if (registered) { runtime.unregisterProvider("xai-auth"); await runtime.refresh({ allowNetwork: false }); }
    if (requiredProvider === "xai-auth") throw new Error(message);
    onDiagnostic?.(message);
  }
  return runtime;
}
export interface WorkflowCatalogOptions extends WorkflowModelRuntimeOptions {
  /** Explicit authenticated Grok network refresh; never enabled by startup/default discovery. */
  refresh?: boolean;
}
export async function discoverWorkflowCatalog(options: WorkflowCatalogOptions = {}): Promise<{ models: AvailableExecutionModel[]; issues: string[] }> {
  const { refresh, ...runtimeOptions } = options;
  const issues: string[] = [];
  const runtime = await createWorkflowModelRuntime({ ...runtimeOptions, onDiagnostic: message => { issues.push(message); options.onDiagnostic?.(message); } });
  if (refresh && runtime.getRegisteredNativeProvider("xai-auth")) {
    const result = await runtime.refresh({ providers: ["xai-auth"], allowNetwork: true, force: true, ...(options.signal ? { signal: options.signal } : {}) });
    if (result.aborted) issues.push("Grok authenticated catalog refresh cancelled");
    else if (result.errors.size) issues.push("Grok authenticated catalog refresh failed");
  }
  const subscription = runtime.getRegisteredNativeProvider("xai-auth") as { catalogSource?: () => string } | undefined;
  if (subscription?.catalogSource?.() === "curated-fallback") issues.push("Grok subscription has no authenticated catalog; explicitly refresh the model catalog");
  else if (subscription?.catalogSource?.() === "stale-cache") issues.push("Grok model IDs come from a stale authenticated cache; refresh to verify current account access");
  if (runtime.getError()) throw new Error("Authenticated pi model catalog discovery failed");
  return { models: runtime.getAvailableSnapshot().map(model => ({ provider: model.provider, id: model.id, thinkingLevels: getSupportedThinkingLevels(model) })), issues };
}
/** Authenticated, cache-only catalog for graph authoring and service discovery. */
export async function discoverWorkflowModels(options: WorkflowModelRuntimeOptions = {}): Promise<AvailableExecutionModel[]> {
  return (await discoverWorkflowCatalog(options)).models;
}
