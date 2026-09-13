import { join } from "node:path";
import { createJiti } from "jiti";
import { lazyStream, type Api, type AssistantMessageEventStream, type Model, type Provider, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { getAgentDir, resizeImage as nativeResizeImage, type ResizedImage } from "@earendil-works/pi-coding-agent";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import { inspectReviewedAdapter, readInstalledSdkIdentity, xaiAdapterVersion, type AdapterIdentityRecord, type SdkIdentity } from "./adapter-identity.js";
import { effectiveFromRaw, rawInputCapability } from "./capabilities.js";
import { assertContextImagesAllowed } from "./image-boundary.js";
import {
  currentRequestObservation, localDiagnostic, markFetchAttempted, markHttpObserved,
  recordSentReasoning,
} from "./request-observation.js";
import { observeProviderResponse } from "./provider-response.js";

export { xaiAdapterVersion };
export const xaiSubscriptionBaseUrl = "https://cli-chat-proxy.grok.com/v1";
type CatalogModel = Model<Api> & { apiBackend?: string; inputProvenance?: string; input?: ("text" | "image")[] };
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
  /** Test instrumentation for SDK identity drift after provider initialization. */
  sdkIdentity?: () => SdkIdentity;
}
export interface ResizeObservation {
  wasResized: boolean;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  mimeType: string;
  inputBytes: number;
  outputChars: number;
}
export interface SubscriptionProvider extends Provider {
  catalogSource(): string;
  transportLoaded(): boolean;
  adapterIdentity(): AdapterIdentityRecord;
  resizeObservations(): readonly ResizeObservation[];
}

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

function bindResizeImage(observations: ResizeObservation[]): typeof nativeResizeImage {
  return async (inputBytes: Uint8Array, mimeType: string, options?: { maxWidth?: number; maxHeight?: number; maxBytes?: number; jpegQuality?: number }): Promise<ResizedImage | null> => {
    const resized = await nativeResizeImage(inputBytes, mimeType, options);
    if (resized) {
      observations.push({
        wasResized: resized.wasResized, originalWidth: resized.originalWidth, originalHeight: resized.originalHeight,
        width: resized.width, height: resized.height, mimeType: resized.mimeType,
        inputBytes: inputBytes.byteLength, outputChars: resized.data.length,
      });
    } else {
      const observation = currentRequestObservation();
      localDiagnostic(observation, { subcode: "image-compaction-failed", code: "resource", dispatch: "not-dispatched" });
    }
    return resized;
  };
}

/** Only vetted helper modules are loaded, never the package's extension entry point. */
export async function createXaiSubscriptionProvider(options: XaiProviderOptions): Promise<SubscriptionProvider> {
  const packageRoot = options.packageRoot ?? join(options.agentDirectory, "npm/node_modules/pi-xai-oauth");
  const readSdk = options.sdkIdentity ?? readInstalledSdkIdentity;
  const identity = await inspectReviewedAdapter(packageRoot, undefined, readSdk());
  const resizeObservations: ResizeObservation[] = [];
  const compat = await import("@earendil-works/pi-ai/compat");
  const virtualModules: Record<string, unknown> = {
    "@earendil-works/pi-ai": compat,
    "@earendil-works/pi-ai/compat": compat,
    "@earendil-works/pi-coding-agent": { getAgentDir: () => options.agentDirectory || getAgentDir(), resizeImage: bindResizeImage(resizeObservations) },
  };
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
    adapterIdentity: () => identity, resizeObservations: () => resizeObservations,
    async refreshModels(context) {
      await inspectReviewedAdapter(packageRoot, undefined, readSdk());
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
        current = entitled.map(({ apiBackend: _, ...model }) => ({ ...model, provider: "xai-auth", api: "xai-responses", baseUrl: xaiSubscriptionBaseUrl }));
        metadata.setXaiRuntimeModels(entitled);
      } });
    },
    streamSimple(model, context, streamOptions) {
      return lazyStream(model, async () => {
        const observation = currentRequestObservation();
        await inspectReviewedAdapter(packageRoot, observation, readSdk());
        if (!current.some(candidate => candidate.id === model.id)) throw new Error("Grok model is absent from the authenticated catalog");
        const catalogModel = current.find(candidate => candidate.id === model.id) as CatalogModel | undefined;
        const raw = rawInputCapability(catalogModel?.input, catalogModel?.inputProvenance);
        const effective = effectiveFromRaw(raw, identity, "xai-auth");
        const admittedImages = await assertContextImagesAllowed(context.messages, effective.effective.input, observation);
        return (async function* () {
          const release = await acquireTransport(streamOptions?.signal);
          try {
        if (observation && observation.dispatch === "unknown") observation.dispatch = "not-dispatched";
        await inspectReviewedAdapter(packageRoot, observation, readSdk());
        transport ??= loader.import<Transport>(join(packageRoot, "extensions/xai/responses.ts"));
        const loaded = await transport;
        let sentReasoning: string | undefined;
        const upstreamFetch = streamOptions?.fetch ?? globalThis.fetch;
        const upstreamOnPayload = streamOptions?.onPayload;
        const events = loaded.streamSimpleXaiResponses(model, context, { ...streamOptions, maxRetries: 0,
          onPayload: async (payload, payloadModel) => {
            const next = await upstreamOnPayload?.(payload, payloadModel);
            return next === undefined ? payload : next;
          },
          fetch: async (input, init) => {
            markFetchAttempted(observation);
            if (typeof init?.body === "string") {
              try {
                const body = JSON.parse(init.body);
                sentReasoning = typeof body.reasoning?.effort === "string" ? body.reasoning.effort : model.reasoning ? undefined : "off";
                recordSentReasoning(observation, sentReasoning);
              } catch { /* transport owns payload validation */ }
            }
            try {
              const result = await upstreamFetch(input, init);
              markHttpObserved(observation, observeProviderResponse(result.status, result.headers.get("retry-after")));
              return result;
            } catch (error) {
              markFetchAttempted(observation);
              throw error;
            }
          },
        });
          try {
          for await (const event of events) {
            const message = event.type === "done" ? event.message : event.type === "error" ? event.error : undefined;
            if (message && message.providerThinkingLevel === undefined && sentReasoning !== undefined) message.providerThinkingLevel = sentReasoning;
            if (event.type === "error" && admittedImages.length && observation && observation.dispatch === "not-dispatched" && !observation.diagnosticSubcode) {
              localDiagnostic(observation, { subcode: "image-compaction-failed", code: "resource", dispatch: "not-dispatched" });
            }
            yield event;
          }
          } catch (error) {
            if (admittedImages.length && observation && observation.dispatch === "not-dispatched" && !observation.diagnosticSubcode) {
              localDiagnostic(observation, { subcode: "image-compaction-failed", code: "resource", dispatch: "not-dispatched" });
            }
            throw error;
          }
          } finally { release(); }
        })();
      });
    },
    stream(model, context, streamOptions) { return provider.streamSimple(model, context, streamOptions as SimpleStreamOptions | undefined); },
  };
  return provider;
}
