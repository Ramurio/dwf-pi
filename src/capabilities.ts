import { xaiBridgeCapabilityRevision, type AdapterIdentityRecord } from "./adapter-identity.js";

export const modalityNames = ["text", "image"] as const;
export type Modality = typeof modalityNames[number];
export const capabilityStates = ["supported", "unsupported", "unknown"] as const;
export type CapabilityStateName = typeof capabilityStates[number];
export const supportedImageMimeTypes = ["image/png", "image/jpeg"] as const;
export type SupportedImageMimeType = typeof supportedImageMimeTypes[number];

export interface ModalityCapability {
  state: CapabilityStateName;
  provenance: string;
  mimeTypes?: readonly SupportedImageMimeType[];
}
export interface EffectiveCapabilities {
  input: ModalityCapability;
  toolResult: ModalityCapability;
  imageMimeTypes: readonly SupportedImageMimeType[];
  adapterRevision: string;
}
export interface FrozenCapabilities {
  raw: { input: ModalityCapability };
  effective: EffectiveCapabilities;
}
export interface AgentRequirements {
  inputModalities?: readonly Modality[];
  toolResultModalities?: readonly Modality[];
}
export interface ReasoningSnapshot {
  available: readonly string[];
  requested: string;
  resolved: string;
}

const closedObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function unknownCapability(provenance = "catalog-omitted"): ModalityCapability {
  return { state: "unknown", provenance };
}
export function supportedImageCapability(provenance: string): ModalityCapability {
  return { state: "supported", provenance, mimeTypes: [...supportedImageMimeTypes] };
}
export function unsupportedCapability(provenance: string): ModalityCapability {
  return { state: "unsupported", provenance };
}

export function parseModalityCapability(value: unknown): ModalityCapability | undefined {
  if (!closedObject(value)) return;
  const keys = Reflect.ownKeys(value);
  if (!keys.includes("state") || !keys.includes("provenance") || keys.some(key => !["state", "provenance", "mimeTypes"].includes(String(key)))) return;
  if (typeof value.state !== "string" || !capabilityStates.includes(value.state as CapabilityStateName) || typeof value.provenance !== "string" || !value.provenance) return;
  if (value.state === "supported") {
    if (!Object.hasOwn(value, "mimeTypes") || !Array.isArray(value.mimeTypes) || value.mimeTypes.length === 0) return;
    if (value.mimeTypes.some(type => type !== "image/png" && type !== "image/jpeg")) return;
    return { state: "supported", provenance: value.provenance, mimeTypes: [...value.mimeTypes] as SupportedImageMimeType[] };
  }
  if (Object.hasOwn(value, "mimeTypes")) return;
  return { state: value.state as Exclude<CapabilityStateName, "supported">, provenance: value.provenance };
}

export function parseFrozenCapabilities(value: unknown): FrozenCapabilities | undefined {
  if (!closedObject(value)) return;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes("raw") || !keys.includes("effective")) return;
  if (!closedObject(value.raw) || Reflect.ownKeys(value.raw).join() !== "input") return;
  const rawInput = parseModalityCapability(value.raw.input);
  if (!rawInput) return;
  if (!closedObject(value.effective)) return;
  const effectiveKeys = Reflect.ownKeys(value.effective);
  if (effectiveKeys.length !== 4 || ["input", "toolResult", "imageMimeTypes", "adapterRevision"].some(key => !effectiveKeys.includes(key))) return;
  const input = parseModalityCapability(value.effective.input);
  const toolResult = parseModalityCapability(value.effective.toolResult);
  if (!input || !toolResult || typeof value.effective.adapterRevision !== "string" || !value.effective.adapterRevision) return;
  if (!Array.isArray(value.effective.imageMimeTypes) || value.effective.imageMimeTypes.some(type => type !== "image/png" && type !== "image/jpeg")) return;
  if (input.state !== "supported" && value.effective.imageMimeTypes.length !== 0) return;
  if (input.state === "supported" && value.effective.imageMimeTypes.length === 0) return;
  return {
    raw: { input: rawInput },
    effective: {
      input, toolResult,
      imageMimeTypes: [...value.effective.imageMimeTypes] as SupportedImageMimeType[],
      adapterRevision: value.effective.adapterRevision,
    },
  };
}

export function parseAgentRequirements(value: unknown): AgentRequirements | undefined {
  if (!closedObject(value)) return;
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => !["inputModalities", "toolResultModalities"].includes(String(key)))) return;
  const parseList = (list: unknown): Modality[] | undefined => {
    if (list === undefined) return [];
    if (!Array.isArray(list) || new Set(list).size !== list.length || list.some(item => item !== "text" && item !== "image")) return;
    return [...list] as Modality[];
  };
  const inputModalities = parseList(value.inputModalities);
  const toolResultModalities = parseList(value.toolResultModalities);
  if (!inputModalities || !toolResultModalities) return;
  return {
    ...(inputModalities.length ? { inputModalities } : {}),
    ...(toolResultModalities.length ? { toolResultModalities } : {}),
  };
}

export function parseReasoningSnapshot(value: unknown): ReasoningSnapshot | undefined {
  if (!closedObject(value)) return;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 3 || ["available", "requested", "resolved"].some(key => !keys.includes(key))) return;
  if (!Array.isArray(value.available) || value.available.some(item => typeof item !== "string" || !item) || typeof value.requested !== "string" || !value.requested || typeof value.resolved !== "string" || !value.resolved) return;
  return { available: [...value.available], requested: value.requested, resolved: value.resolved };
}

export function capabilityAllowsImage(capability: ModalityCapability): boolean {
  return capability.state === "supported";
}

export function requirementsSatisfied(requirements: AgentRequirements | undefined, capabilities: FrozenCapabilities): boolean {
  const needed = [...requirements?.inputModalities ?? [], ...requirements?.toolResultModalities ?? []];
  if (!needed.includes("image")) return true;
  return capabilityAllowsImage(capabilities.effective.input) && capabilityAllowsImage(capabilities.effective.toolResult);
}

const explicitImageSupportProvenance = new Set([
  "authenticated-accepts-images",
  "authenticated-input-modalities",
  "known-model-metadata",
  "model.input",
]);
const explicitImageDenialProvenance = new Set([
  "authenticated-input-modalities",
  "authenticated-accepts-images",
  "model.input",
  "known-model-metadata",
]);

export function rawInputCapability(input: readonly string[] | undefined, provenance: string | undefined): ModalityCapability {
  if (!provenance || input === undefined) return unknownCapability(provenance || "catalog-omitted");
  if (provenance === "conservative-default") return unknownCapability(provenance);
  if (input.includes("image") && explicitImageSupportProvenance.has(provenance)) {
    return supportedImageCapability(provenance);
  }
  if (!input.includes("image") && explicitImageDenialProvenance.has(provenance)) {
    return unsupportedCapability(provenance);
  }
  return unknownCapability(provenance);
}

export type CapabilityRoute = "xai-auth" | "native";
/** Native pi providers follow SDK model.input. xai-auth effective support requires the reviewed helper. */
export function effectiveFromRaw(raw: ModalityCapability, adapter: AdapterIdentityRecord | null, route: CapabilityRoute): FrozenCapabilities {
  if (route === "xai-auth") {
    if (!adapter || adapter.capabilityRevision !== xaiBridgeCapabilityRevision) {
      const unknown = unknownCapability("adapter-unreviewed");
      return {
        raw: { input: raw },
        effective: { input: unknown, toolResult: unknown, imageMimeTypes: [], adapterRevision: adapter?.capabilityRevision ?? "none" },
      };
    }
    if (raw.state === "supported") {
      const supported = supportedImageCapability(`bridge:${raw.provenance}`);
      return {
        raw: { input: raw },
        effective: { input: supported, toolResult: supported, imageMimeTypes: [...supportedImageMimeTypes], adapterRevision: adapter.capabilityRevision },
      };
    }
    if (raw.state === "unsupported") {
      const denied = unsupportedCapability(`bridge:${raw.provenance}`);
      return {
        raw: { input: raw },
        effective: { input: denied, toolResult: denied, imageMimeTypes: [], adapterRevision: adapter.capabilityRevision },
      };
    }
    const unknown = unknownCapability(`bridge:${raw.provenance}`);
    return {
      raw: { input: raw },
      effective: { input: unknown, toolResult: unknown, imageMimeTypes: [], adapterRevision: adapter.capabilityRevision },
    };
  }
  if (raw.state === "supported") {
    const supported = supportedImageCapability(`native-sdk:${raw.provenance}`);
    return {
      raw: { input: raw },
      effective: { input: supported, toolResult: supported, imageMimeTypes: [...supportedImageMimeTypes], adapterRevision: "native-sdk" },
    };
  }
  if (raw.state === "unsupported") {
    const denied = unsupportedCapability(`native-sdk:${raw.provenance}`);
    return {
      raw: { input: raw },
      effective: { input: denied, toolResult: denied, imageMimeTypes: [], adapterRevision: "native-sdk" },
    };
  }
  const unknown = unknownCapability(raw.provenance || "catalog-omitted");
  return {
    raw: { input: raw },
    effective: { input: unknown, toolResult: unknown, imageMimeTypes: [], adapterRevision: "none" },
  };
}

export function noneAdapterCapabilities(): FrozenCapabilities {
  const unknown = unknownCapability("catalog-omitted");
  return { raw: { input: unknown }, effective: { input: unknown, toolResult: unknown, imageMimeTypes: [], adapterRevision: "none" } };
}

/** Image permission is the safe intersection: never wider than frozen, never wider than current. */
export function intersectEffectiveCapabilities(frozen: FrozenCapabilities | undefined, current: FrozenCapabilities): FrozenCapabilities {
  const intersect = (planned: ModalityCapability | undefined, live: ModalityCapability): ModalityCapability => {
    if (!planned) return live;
    if (planned.state !== "supported") return planned;
    if (live.state !== "supported") return live;
    const allowed = new Set(planned.mimeTypes ?? supportedImageMimeTypes);
    const mimeTypes = (live.mimeTypes ?? [...supportedImageMimeTypes]).filter(type => allowed.has(type));
    if (!mimeTypes.length) return unsupportedCapability(`intersection:${planned.provenance}|${live.provenance}`);
    return { state: "supported", provenance: `intersection:${planned.provenance}|${live.provenance}`, mimeTypes };
  };
  const input = intersect(frozen?.effective.input, current.effective.input);
  const toolResult = intersect(frozen?.effective.toolResult, current.effective.toolResult);
  const imageMimeTypes = input.state === "supported" && toolResult.state === "supported"
    ? [...new Set([...(input.mimeTypes ?? []), ...(toolResult.mimeTypes ?? [])])] as typeof supportedImageMimeTypes[number][]
    : [];
  return {
    raw: current.raw,
    effective: { input, toolResult, imageMimeTypes, adapterRevision: current.effective.adapterRevision },
  };
}
