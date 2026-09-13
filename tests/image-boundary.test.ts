import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createReadToolDefinition } from "@earendil-works/pi-coding-agent";
import { applyImageToolGuard, decodeInlineImage, inspectImageBytes, wrapImageProducingTool } from "../src/image-boundary.js";
import { effectiveFromRaw, noneAdapterCapabilities, rawInputCapability, supportedImageCapability } from "../src/capabilities.js";
import { pngDigit } from "./helpers/test-images.js";
import { xaiBridgeCapabilityRevision, type AdapterIdentityRecord } from "../src/adapter-identity.js";
import { ExecutionFailure } from "../src/execution-failure.js";

const adapter: AdapterIdentityRecord = {
  packageName: "pi-xai-oauth", packageVersion: "1.5.2", contentDigest: "a".repeat(64),
  capabilityRevision: xaiBridgeCapabilityRevision, sdk: { piAi: "0.85.1", piCodingAgent: "0.85.1", piAgentCore: "0.85.1" },
  files: { "package.json": "b".repeat(64) },
};

function isInvalid(error: unknown) {
  assert.ok(error instanceof ExecutionFailure); assert.equal(error.failure.diagnostic?.subcode, "image-invalid"); return true;
}
test("PNG/JPEG decode rejects GIF, corrupt bytes and MIME mismatch", async () => {
  const png = pngDigit(4);
  const inspected = inspectImageBytes(png, "image/png");
  assert.equal(inspected.mimeType, "image/png");
  assert.ok(inspected.width > 0);
  const truncated = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(truncated);
  truncated.writeUInt32BE(13, 8); truncated.write("IHDR", 12); truncated.writeUInt32BE(1, 16); truncated.writeUInt32BE(1, 20);
  await assert.rejects(decodeInlineImage("image/png", truncated.toString("base64")), isInvalid);
  await assert.rejects(decodeInlineImage("image/gif", png.toString("base64")), (error: unknown) => {
    assert.ok(error instanceof ExecutionFailure); assert.equal(error.failure.diagnostic?.subcode, "image-unsupported"); return true;
  });
  await assert.rejects(decodeInlineImage("image/png", "@@@@"), isInvalid);
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  assert.throws(() => inspectImageBytes(jpegHeader, "image/png"));
});

test("registered read tool guard executes and returns a recoverable error instead of image content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-image-guard-"));
  try {
    const path = join(directory, "neutral.png");
    await writeFile(path, pngDigit(7));
    const denied = wrapImageProducingTool(createReadToolDefinition(directory), noneAdapterCapabilities());
    await assert.rejects(denied.execute("call", { path: "neutral.png" }, undefined, undefined, { cwd: directory } as never), /does not accept image tool results/);
    const allowed = wrapImageProducingTool(createReadToolDefinition(directory), effectiveFromRaw(supportedImageCapability("test"), adapter, "xai-auth"));
    const result = await allowed.execute("call", { path: "neutral.png" }, undefined, undefined, { cwd: directory } as never);
    assert.equal(result.content.some(part => part.type === "image"), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("applyImageToolGuard keeps text results on an unknown-image route", async () => {
  const text = await applyImageToolGuard({ content: [{ type: "text", text: "hello" }], details: {} }, noneAdapterCapabilities());
  assert.deepEqual(text.content, [{ type: "text", text: "hello" }]);
  await assert.rejects(applyImageToolGuard({ content: [{ type: "text", text: "img" }, { type: "image", data: pngDigit(1).toString("base64"), mimeType: "image/png" }], details: {} }, noneAdapterCapabilities()));
  assert.equal(rawInputCapability(["text"], "authenticated-input-modalities").state, "unsupported");
});

test("progressive JPEG remains valid and CRC-valid PNG without pixels is rejected", async () => {
  const { crc32 } = await import("node:zlib");
  const progressive = await readFile(new URL("./fixtures/progressive.jpg", import.meta.url));
  const jpeg = await decodeInlineImage("image/jpeg", progressive.toString("base64"));
  assert.equal(jpeg.mimeType, "image/jpeg");
  assert.ok(jpeg.width > 0 && jpeg.height > 0);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8]=8; ihdr[9]=2;
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const empty = Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", Buffer.from("789c030000000001", "hex")),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  await assert.rejects(decodeInlineImage("image/png", empty.toString("base64")), isInvalid);
});

test("empty-scan JPEG and PNG decompression bombs are rejected without decoding huge output", async () => {
  const { crc32, deflateSync } = await import("node:zlib");
  await assert.rejects(decodeInlineImage("image/jpeg", Buffer.from("ffd8ffc000070800010001ffda0002ffd9", "hex").toString("base64")), isInvalid);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const bombHeader = Buffer.alloc(13);
  bombHeader.writeUInt32BE(20000, 0); bombHeader.writeUInt32BE(20000, 4); bombHeader[8]=8; bombHeader[9]=2;
  const bomb = Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk("IHDR", bombHeader),
    chunk("IDAT", deflateSync(Buffer.from([0]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  const started = Date.now();
  await assert.rejects(decodeInlineImage("image/png", bomb.toString("base64")), isInvalid);
  assert.ok(Date.now() - started < 1000, "dimension cap must reject before inflating a 20000x20000 raster");
  const tinyHeader = Buffer.alloc(13);
  tinyHeader.writeUInt32BE(1, 0); tinyHeader.writeUInt32BE(1, 4); tinyHeader[8]=8; tinyHeader[9]=6;
  const surplus = Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk("IHDR", tinyHeader),
    chunk("IDAT", deflateSync(Buffer.alloc(1024 * 1024))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  await assert.rejects(decodeInlineImage("image/png", surplus.toString("base64")), isInvalid);
  await assert.rejects(decodeInlineImage("image/jpeg", Buffer.from("ffd8ffc0000b080001000101011100ffda0008010100003f0000ffd9", "hex").toString("base64")), isInvalid);
  const invalidFilterHeader = Buffer.alloc(13);
  invalidFilterHeader.writeUInt32BE(1, 0); invalidFilterHeader.writeUInt32BE(1, 4); invalidFilterHeader[8]=8; invalidFilterHeader[9]=6;
  const invalidFilter = Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk("IHDR", invalidFilterHeader),
    chunk("IDAT", deflateSync(Buffer.from([255, 0, 0, 0, 0]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  await assert.rejects(decodeInlineImage("image/png", invalidFilter.toString("base64")), isInvalid);
});
