import { executionFailure } from "./execution-failure.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createJiti } from "jiti";
import { lazyStream, type Api, type AssistantMessageEventStream, type Model, type Provider, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";

export const xaiAdapterVersion = "1.5.2";
export const xaiSubscriptionBaseUrl = "https://cli-chat-proxy.grok.com/v1";
type CatalogModel = Model<Api> & { apiBackend?: string; inputProvenance?: string };
interface Metadata {
  expandXaiCatalogWithAliases(models: CatalogModel[]): CatalogModel[];
  setXaiRuntimeModels(models: CatalogModel[]): void;
}
interface Catalog {
  selectXaiModelCatalog(options: Record<string, unknown>): Promise<{ source: string; models: CatalogModel[] }>;
}
interface Transport { streamSimpleXaiResponses(model: Model<Api>, context: Parameters<Provider["streamSimple"]>[1], options?: SimpleStreamOptions): AssistantMessageEventStream }
export interface XaiProviderOptions {
  agentDirectory: string;
  packageRoot?: string;
  cachePath?: string;
  /** Explicit test/network boundary; cache-only initialization never calls this. */
  catalogFetch?: typeof fetch;
}
export interface SubscriptionProvider extends Provider { catalogSource(): string; transportLoaded(): boolean }

// Reviewed transport temporarily wraps global fetch. Serialize transport lifetimes
// across provider instances in this process; parallel workflow workers use processes.
let transportTail: Promise<void> = Promise.resolve();
async function acquireTransport(signal?: AbortSignal): Promise<() => void> {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const previous = transportTail;
  transportTail = previous.then(() => held);
  let cancel!: () => void;
  try {
    await Promise.race([previous, new Promise<never>((_, reject) => {
      cancel = () => reject(new Error("Grok transport cancelled before admission"));
      if (signal?.aborted) cancel(); else signal?.addEventListener("abort", cancel, { once: true });
    })]);
    if (signal?.aborted) throw new Error("Grok transport cancelled before admission");
  } catch (error) { release(); throw error; }
  finally { signal?.removeEventListener("abort", cancel); }
  return release;
}

/** Only vetted helper modules are loaded, never the package's extension entry point. */
export async function createXaiSubscriptionProvider(options: XaiProviderOptions): Promise<SubscriptionProvider> {
  const packageRoot = options.packageRoot ?? join(options.agentDirectory, "npm/node_modules/pi-xai-oauth");
  let manifest: { name?: string; version?: string };
  try { manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")); }
  catch { throw executionFailure("configuration","setup","not-started","Grok subscription adapter is missing or unreadable; pi-xai-oauth 1.5.2 is required"); }
  if (!["pi-xai-oauth", "@blockedpath/pi-xai-oauth"].includes(manifest.name ?? "") || manifest.version !== xaiAdapterVersion) throw executionFailure("configuration","setup","not-started","Unsupported Grok adapter identity/version; pi-xai-oauth 1.5.2 is required");
  const compat = await import("@earendil-works/pi-ai/compat");
  const virtualModules: Record<string, unknown> = {
    "@earendil-works/pi-ai": compat,
    "@earendil-works/pi-ai/compat": compat,
    // Text-only workflows have no image input transport. Fail rather than silently
    // pretend the older package's image-resize ABI was verified against pi 0.85.
    "@earendil-works/pi-coding-agent": { getAgentDir: () => options.agentDirectory, resizeImage: () => { throw new Error("Grok bridge image conversion is not supported"); } },
  };
  // Disable Node's global module cache. Pin ./models in this loader's virtual
  // module map so catalog/payload/transport share only this provider's state.
  const metadataLoader = createJiti(join(packageRoot, "package.json"), { moduleCache: false, interopDefault: true, virtualModules });
  const metadata = await metadataLoader.import<Metadata>(join(packageRoot, "extensions/xai/models.ts"));
  const loader = createJiti(join(packageRoot, "package.json"), { moduleCache: false, interopDefault: true, virtualModules: { ...virtualModules, "./models": metadata } });
  const catalog = await loader.import<Catalog>(join(packageRoot, "extensions/xai/catalog.ts"));
  let current: Model<Api>[] = [];
  let source = "unavailable";
  let transport: Promise<Transport> | undefined;
  const nativeOAuth = xaiProvider().auth.oauth;
  if (!nativeOAuth) throw new Error("Native pi xAI OAuth support is unavailable");
  const provider: SubscriptionProvider = {
    id: "xai-auth", name: "xAI (SuperGrok subscription)", baseUrl: xaiSubscriptionBaseUrl,
    auth: { oauth: nativeOAuth }, getModels: () => current,
    catalogSource: () => source, transportLoaded: () => transport !== undefined,
    async refreshModels(context) {
      if (context.credential?.type !== "oauth") {
        await context.publish({ update: () => { current = []; source = "unavailable"; metadata.setXaiRuntimeModels([]); } });
        return;
      }
      let selected: Awaited<ReturnType<Catalog["selectXaiModelCatalog"]>>;
      try {
        selected = await catalog.selectXaiModelCatalog({ credential: context.credential,
          cachePath: options.cachePath ?? join(options.agentDirectory, "cache/pi-xai-oauth/models-v2.json"),
          signal: context.signal, forceRefresh: context.allowNetwork && context.force,
          fetchImpl: context.allowNetwork ? options.catalogFetch ?? globalThis.fetch : async () => { throw new Error("Cache-only Grok catalog initialization"); },
          commitAllowed: () => !context.signal.aborted,
        });
      } catch { throw new Error(context.signal.aborted ? "Grok catalog refresh cancelled" : "Grok authenticated catalog refresh failed"); }
      const entitled = selected.source === "curated-fallback" ? [] : metadata.expandXaiCatalogWithAliases(selected.models);
      await context.publish({ update: () => {
        source = selected.source;
        current = entitled.map(({ apiBackend: _, inputProvenance: __, ...model }) => ({ ...model, provider: "xai-auth", api: "xai-responses", baseUrl: xaiSubscriptionBaseUrl }));
        metadata.setXaiRuntimeModels(entitled);
      } });
    },
    streamSimple(model, context, streamOptions) {
      return lazyStream(model, async () => {
        if (!current.some(candidate => candidate.id === model.id)) throw new Error("Grok model is absent from the authenticated catalog");
        if (context.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === "image"))) throw new Error("Grok bridge currently supports text-only workflow inputs");
        return (async function* () {
          const release = await acquireTransport(streamOptions?.signal);
          try {
        transport ??= loader.import<Transport>(join(packageRoot, "extensions/xai/responses.ts"));
        const loaded = await transport;
        let sentReasoning: string | undefined;
        const upstreamFetch = streamOptions?.fetch ?? globalThis.fetch;
        const events = loaded.streamSimpleXaiResponses(model, context, { ...streamOptions, maxRetries: 0,
          fetch: async (input, init) => {
            if (typeof init?.body === "string") {
              try { const body = JSON.parse(init.body); sentReasoning = typeof body.reasoning?.effort === "string" ? body.reasoning.effort : model.reasoning ? undefined : "off"; } catch { /* transport owns payload validation */ }
            }
            return upstreamFetch(input, init);
          },
        });
          for await (const event of events) {
            const message = event.type === "done" ? event.message : event.type === "error" ? event.error : undefined;
            if (message && message.providerThinkingLevel === undefined && sentReasoning !== undefined) message.providerThinkingLevel = sentReasoning;
            yield event;
          }
          } finally { release(); }
        })();
      });
    },
    stream(model, context, streamOptions) { return provider.streamSimple(model, context, streamOptions as SimpleStreamOptions | undefined); },
  };
  return provider;
}
