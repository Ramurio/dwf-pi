import { ExecutionFailure, executionFailure } from "./execution-failure.js";
import { getAgentDir, ModelRuntime, type CreateModelRuntimeOptions } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { AvailableExecutionModel } from "./execution-plan.js";
import type { XaiProviderOptions, SubscriptionProvider } from "./xai-provider.js";
import { effectiveFromRaw, rawInputCapability, type FrozenCapabilities } from "./capabilities.js";
import type { AdapterIdentityRecord } from "./adapter-identity.js";
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
    if (refresh.errors.size) throw executionFailure("configuration","setup","not-started","Grok subscription cached catalog could not be restored");
  } catch (error) {
    const failure = error instanceof ExecutionFailure ? error : executionFailure("configuration","setup","not-started","Grok subscription adapter could not be loaded; verify local pi-xai-oauth 1.5.2 installation");
    const message = failure.message;
    if (registered) { runtime.unregisterProvider("xai-auth"); await runtime.refresh({ allowNetwork: false }); }
    if (requiredProvider === "xai-auth") throw failure;
    onDiagnostic?.(message);
  }
  return runtime;
}
export interface WorkflowCatalogOptions extends WorkflowModelRuntimeOptions {
  /** Explicit authenticated Grok network refresh; never enabled by startup/default discovery. */
  refresh?: boolean;
}

function catalogModel(model: { provider: string; id: string; input?: readonly string[]; reasoning?: boolean; inputProvenance?: string }, adapter: AdapterIdentityRecord | null): AvailableExecutionModel {
  const provenance = typeof model.inputProvenance === "string" ? model.inputProvenance : Array.isArray(model.input) ? "model.input" : undefined;
  const raw = rawInputCapability(Array.isArray(model.input) ? [...model.input] : undefined, provenance);
  const capabilities: FrozenCapabilities = model.provider === "xai-auth"
    ? effectiveFromRaw(raw, adapter, "xai-auth")
    : effectiveFromRaw(raw, null, "native");
  return {
    provider: model.provider, id: model.id, thinkingLevels: getSupportedThinkingLevels(model as never),
    capabilities, adapterIdentity: model.provider === "xai-auth" ? adapter : null,
  };
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
  const subscription = runtime.getRegisteredNativeProvider("xai-auth") as (SubscriptionProvider & { adapterIdentity?: () => AdapterIdentityRecord }) | undefined;
  if (subscription?.catalogSource?.() === "curated-fallback") issues.push("Grok subscription has no authenticated catalog; explicitly refresh the model catalog");
  else if (subscription?.catalogSource?.() === "stale-cache") issues.push("Grok model IDs come from a stale authenticated cache; refresh to verify current account access");
  if (runtime.getError()) throw new Error("Authenticated pi model catalog discovery failed");
  const adapter = subscription?.adapterIdentity?.() ?? null;
  return { models: runtime.getAvailableSnapshot().map(model => catalogModel(model as { provider: string; id: string; input?: readonly string[]; reasoning?: boolean; inputProvenance?: string }, model.provider === "xai-auth" ? adapter : null)), issues };
}
/** Authenticated, cache-only catalog for graph authoring and service discovery. */
export async function discoverWorkflowModels(options: WorkflowModelRuntimeOptions = {}): Promise<AvailableExecutionModel[]> {
  return (await discoverWorkflowCatalog(options)).models;
}
