import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { inflateSync, crc32 } from "node:zlib";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { resizeImage as nativeResizeImage, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { diagnosticMessages, localDiagnostic, type TrustedRequestObservation } from "./request-observation.js";
import { capabilityAllowsImage, supportedImageMimeTypes, type FrozenCapabilities, type ModalityCapability, type SupportedImageMimeType } from "./capabilities.js";
import { executionFailure } from "./execution-failure.js";

export const IMAGE_TOOL_GUARD_MESSAGE = diagnosticMessages["image-unsupported"];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
export const MAX_INLINE_IMAGE_COUNT = 32;
export const MAX_INLINE_IMAGE_BASE64_CHARS = 16 * 1024 * 1024;
export const MAX_INLINE_IMAGE_AGGREGATE_BASE64_CHARS = 24 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 8192;
export const MAX_IMAGE_PIXELS = 12_000_000;
export const MAX_DECODED_IMAGE_BYTES = 48 * 1024 * 1024;

export interface InspectedInlineImage {
  mimeType: SupportedImageMimeType;
  width: number;
  height: number;
  encodedChars: number;
  decodedBytes: number;
}

function normalizeMime(value: string): string {
  const mime = value.toLowerCase();
  return mime === "image/jpg" ? "image/jpeg" : mime;
}

const PNG_BIT_DEPTHS = new Set([1, 2, 4, 8, 16]);
const PNG_COLOR_TYPES = new Set([0, 2, 3, 4, 6]);

function inspectPng(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 8 || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return;
  if (bytes.length < 33) throw new Error("invalid-png");
  let offset = 8;
  let ihdr: { width: number; height: number; bitDepth: number; colorType: number; interlace: number } | undefined;
  let sawIdat = false;
  let sawIend = false;
  const idat: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (!Number.isSafeInteger(length) || length < 0 || offset + 12 + length > bytes.length) throw new Error("invalid-png");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error("invalid-png");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const crc = bytes.readUInt32BE(offset + 8 + length);
    if (crc !== crc32(bytes.subarray(offset + 4, offset + 8 + length))) throw new Error("invalid-png");
    if (!ihdr) {
      if (type !== "IHDR" || length !== 13) throw new Error("invalid-png");
      const width = data.readUInt32BE(0), height = data.readUInt32BE(4);
      const bitDepth = data[8]!, colorType = data[9]!, compression = data[10]!, filter = data[11]!, interlace = data[12]!;
      if (width <= 0 || height <= 0 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || !PNG_BIT_DEPTHS.has(bitDepth) || !PNG_COLOR_TYPES.has(colorType) || compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) throw new Error("invalid-png");
      if (width * height > MAX_IMAGE_PIXELS) throw new Error("invalid-png");
      ihdr = { width, height, bitDepth, colorType, interlace };
    } else if (type === "IHDR") throw new Error("invalid-png");
    else if (type === "IDAT") { sawIdat = true; idat.push(Buffer.from(data)); }
    else if (type === "IEND") {
      if (length !== 0 || sawIend) throw new Error("invalid-png");
      sawIend = true;
      offset += 12 + length;
      if (offset !== bytes.length) throw new Error("invalid-png");
      break;
    }
    offset += 12 + length;
  }
  if (!ihdr || !sawIdat || !sawIend) throw new Error("invalid-png");
  const expected = pngExpectedBytes(ihdr.width, ihdr.height, ihdr.bitDepth, ihdr.colorType, ihdr.interlace);
  if (!Number.isSafeInteger(expected) || expected <= 0 || expected > MAX_DECODED_IMAGE_BYTES) throw new Error("invalid-png");
  let inflated: Buffer;
  try { inflated = inflateSync(Buffer.concat(idat), { maxOutputLength: expected }); }
  catch { throw new Error("invalid-png"); }
  if (inflated.length !== expected) throw new Error("invalid-png");
  return ihdr;
}

function pngSamples(colorType: number): number {
  return colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 1;
}
function pngPassRows(width: number, height: number, bitDepth: number, colorType: number, x0: number, y0: number, dx: number, dy: number): number {
  const w = x0 < width ? Math.floor((width - x0 - 1) / dx) + 1 : 0;
  const h = y0 < height ? Math.floor((height - y0 - 1) / dy) + 1 : 0;
  if (w <= 0 || h <= 0) return 0;
  return h * (1 + Math.ceil((w * pngSamples(colorType) * bitDepth) / 8));
}
function pngExpectedBytes(width: number, height: number, bitDepth: number, colorType: number, interlace: number): number {
  if (interlace === 0) return pngPassRows(width, height, bitDepth, colorType, 0, 0, 1, 1);
  const passes: Array<[number, number, number, number]> = [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]];
  return passes.reduce((sum, [x0,y0,dx,dy]) => sum + pngPassRows(width, height, bitDepth, colorType, x0, y0, dx, dy), 0);
}

function readJpegMarker(bytes: Buffer, start: number): { marker: number; offset: number } {
  let offset = start;
  if (offset >= bytes.length || bytes[offset] !== 0xff) throw new Error("invalid-jpeg");
  while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
  if (offset >= bytes.length) throw new Error("invalid-jpeg");
  return { marker: bytes[offset]!, offset: offset + 1 };
}
function skipJpegScan(bytes: Buffer, start: number): number {
  let offset = start;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    if (offset + 1 >= bytes.length) throw new Error("invalid-jpeg");
    const next = bytes[offset + 1]!;
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { offset += 2; continue; }
    return offset;
  }
  throw new Error("invalid-jpeg");
}
function inspectJpeg(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
  let offset = 2;
  let dimensions: { width: number; height: number } | undefined;
  let sawSos = false;
  while (offset < bytes.length) {
    const read = readJpegMarker(bytes, offset);
    const marker = read.marker;
    offset = read.offset;
    if (marker === 0xd9) {
      if (!dimensions || !sawSos) throw new Error("invalid-jpeg");
      return dimensions;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xda) {
      if (!dimensions) throw new Error("invalid-jpeg");
      if (offset + 2 > bytes.length) throw new Error("invalid-jpeg");
      const segmentLength = bytes.readUInt16BE(offset);
      if (segmentLength < 8 || offset + segmentLength > bytes.length) throw new Error("invalid-jpeg");
      const ns = bytes[offset + 2]!;
      if (ns < 1 || ns > 4 || segmentLength !== 6 + 2 * ns) throw new Error("invalid-jpeg");
      const scanStart = offset + segmentLength;
      offset = skipJpegScan(bytes, scanStart);
      if (offset <= scanStart) throw new Error("invalid-jpeg");
      sawSos = true;
      continue;
    }
    if (offset + 2 > bytes.length) throw new Error("invalid-jpeg");
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) throw new Error("invalid-jpeg");
    if (JPEG_SOF.has(marker)) {
      if (segmentLength < 11) throw new Error("invalid-jpeg");
      const height = bytes.readUInt16BE(offset + 3), width = bytes.readUInt16BE(offset + 5);
      const nf = bytes[offset + 7]!;
      if (width <= 0 || height <= 0 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) throw new Error("invalid-jpeg");
      if (nf < 1 || nf > 4 || segmentLength !== 8 + 3 * nf) throw new Error("invalid-jpeg");
      for (let i = 0; i < nf; i++) {
        const sampling = bytes[offset + 9 + 3 * i]!;
        const quant = bytes[offset + 10 + 3 * i]!;
        const h = sampling >> 4, v = sampling & 0x0f;
        if (h < 1 || h > 4 || v < 1 || v > 4 || quant > 3) throw new Error("invalid-jpeg");
      }
      dimensions = { width, height };
    }
    offset += segmentLength;
  }
  throw new Error("invalid-jpeg");
}

export function inspectImageBytes(bytes: Buffer, declaredMime?: string): InspectedInlineImage {
  let kind: SupportedImageMimeType | undefined;
  let dimensions: { width: number; height: number } | undefined;
  try { dimensions = inspectPng(bytes); if (dimensions) kind = "image/png"; } catch { throw invalidImage(); }
  if (!kind) {
    try { dimensions = inspectJpeg(bytes); if (dimensions) kind = "image/jpeg"; } catch { throw invalidImage(); }
  }
  if (!kind || !dimensions) throw unsupportedImage();
  if (declaredMime && normalizeMime(declaredMime) !== kind) throw invalidImage();
  return { mimeType: kind, width: dimensions.width, height: dimensions.height, encodedChars: 0, decodedBytes: bytes.length };
}

function invalidImage() {
  return executionFailure("resource", "execution", "not-started", diagnosticMessages["image-invalid"], { diagnostic: { subcode: "image-invalid", dispatch: "not-dispatched" } });
}
function unsupportedImage() {
  return executionFailure("configuration", "execution", "not-started", diagnosticMessages["image-unsupported"], { diagnostic: { subcode: "image-unsupported", dispatch: "not-dispatched" } });
}

export async function decodeInlineImage(mimeType: string, data: string): Promise<InspectedInlineImage> {
  const mime = normalizeMime(mimeType);
  if (!(supportedImageMimeTypes as readonly string[]).includes(mime)) throw unsupportedImage();
  if (typeof data !== "string" || data.length > MAX_INLINE_IMAGE_BASE64_CHARS) throw invalidImage();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) throw invalidImage();
  const bytes = Buffer.from(data, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== data) throw invalidImage();
  const inspected = inspectImageBytes(bytes, mime);
  let decoded: Awaited<ReturnType<typeof nativeResizeImage>>;
  try {
    decoded = await nativeResizeImage(new Uint8Array(bytes), inspected.mimeType, {
      maxWidth: MAX_IMAGE_SIDE, maxHeight: MAX_IMAGE_SIDE, maxBytes: MAX_DECODED_IMAGE_BYTES,
    });
  } catch {
    throw invalidImage();
  }
  if (!decoded) throw invalidImage();
  return { ...inspected, encodedChars: data.length };
}

export function contentHasImage(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(part => part && typeof part === "object" && (part as { type?: string }).type === "image");
}

export async function collectContextImages(messages: readonly { content?: unknown; role?: string }[]): Promise<InspectedInlineImage[]> {
  const images: InspectedInlineImage[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!part || typeof part !== "object" || (part as { type?: string }).type !== "image") continue;
      const image = part as { mimeType?: string; data?: string };
      images.push(await decodeInlineImage(String(image.mimeType ?? ""), String(image.data ?? "")));
    }
  }
  return images;
}

export async function assertContextImagesAllowed(
  messages: readonly { content?: unknown }[],
  capability: ModalityCapability,
  observation?: TrustedRequestObservation,
): Promise<InspectedInlineImage[]> {
  let images: InspectedInlineImage[];
  try { images = await collectContextImages(messages); }
  catch (error) {
    localDiagnostic(observation, { subcode: "image-invalid", code: "resource", dispatch: "not-dispatched" });
    throw error;
  }
  if (images.length === 0) return images;
  if (images.length > MAX_INLINE_IMAGE_COUNT) {
    localDiagnostic(observation, { subcode: "image-invalid", code: "resource", dispatch: "not-dispatched" });
    throw invalidImage();
  }
  const aggregate = images.reduce((sum, image) => sum + image.encodedChars, 0);
  if (aggregate > MAX_INLINE_IMAGE_AGGREGATE_BASE64_CHARS) {
    localDiagnostic(observation, { subcode: "image-invalid", code: "resource", dispatch: "not-dispatched" });
    throw invalidImage();
  }
  if (!capabilityAllowsImage(capability)) {
    localDiagnostic(observation, { subcode: "image-unsupported", code: "configuration", dispatch: "not-dispatched" });
    throw unsupportedImage();
  }
  return images;
}

export interface ReadResizeObservation {
  wasResized: boolean;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  mimeType: string;
  source: string;
  via: "read-tool";
}
const readResizeObservations: ReadResizeObservation[] = [];
export function drainReadResizeObservations(): ReadResizeObservation[] {
  return readResizeObservations.splice(0, readResizeObservations.length);
}

export function wrapImageProducingTool(definition: ToolDefinition<any, any, any>, capabilities: FrozenCapabilities): ToolDefinition<any, any, any> {
  const original = definition.execute.bind(definition);
  return {
    ...definition,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const result = await original(toolCallId, params, signal, onUpdate, ctx);
      const guarded = await applyImageToolGuard(result, capabilities);
      const path = params && typeof params === "object" && typeof (params as { path?: unknown }).path === "string" ? (params as { path: string }).path : undefined;
      const image = guarded.content.find(part => part.type === "image");
      if (path && image && image.type === "image") {
        try {
          const cwd = ctx && typeof ctx === "object" && typeof (ctx as { cwd?: unknown }).cwd === "string" ? (ctx as { cwd: string }).cwd : "";
          const absolute = isAbsolute(path) ? path : resolve(cwd, path);
          const source = inspectImageBytes(await readFile(absolute));
          const sent = await decodeInlineImage(image.mimeType, image.data);
          if (sent.width !== source.width || sent.height !== source.height || sent.decodedBytes < source.decodedBytes) {
            readResizeObservations.push({
              wasResized: true, originalWidth: source.width, originalHeight: source.height,
              width: sent.width, height: sent.height, mimeType: sent.mimeType, source: path, via: "read-tool",
            });
          }
        } catch { /* observation must not change the tool result */ }
      }
      return guarded;
    },
  } as ToolDefinition;
}

export async function applyImageToolGuard<T>(result: AgentToolResult<T>, capabilities: FrozenCapabilities): Promise<AgentToolResult<T>> {
  if (!contentHasImage(result.content)) return result;
  if (capabilityAllowsImage(capabilities.effective.toolResult)) {
    for (const part of result.content) {
      if (part.type !== "image") continue;
      await decodeInlineImage(part.mimeType, part.data);
    }
    return result;
  }
  throw new Error(IMAGE_TOOL_GUARD_MESSAGE);
}

export function sessionHistoryHasImages(messages: readonly unknown[]): boolean {
  return messages.some(message => !!message && typeof message === "object" && contentHasImage((message as { content?: unknown }).content));
}
