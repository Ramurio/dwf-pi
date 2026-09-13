import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { crc32, deflateSync } from "node:zlib";

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** Deterministic RGB PNG. Never used as a filename or prompt answer. */
export function encodePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const i = row + 1 + x * 3;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const DIGITS: Record<string, string[]> = {
  "0": ["111","101","101","101","111"],
  "1": ["010","110","010","010","111"],
  "2": ["111","001","111","100","111"],
  "3": ["111","001","111","001","111"],
  "4": ["101","101","111","001","001"],
  "5": ["111","100","111","001","111"],
  "6": ["111","100","111","101","111"],
  "7": ["111","001","001","001","001"],
  "8": ["111","101","111","101","111"],
  "9": ["111","101","111","001","111"],
};

export function pngDigit(digit: number, scale = 12, ink: [number, number, number] = [16, 16, 16], paper: [number, number, number] = [240, 240, 240]): Buffer {
  const glyph = DIGITS[String(digit)]!;
  const width = glyph[0]!.length * scale + scale * 2;
  const height = glyph.length * scale + scale * 2;
  return encodePng(width, height, (x, y) => {
    const gx = Math.floor((x - scale) / scale);
    const gy = Math.floor((y - scale) / scale);
    const row = glyph[gy];
    if (!row || gx < 0 || gx >= row.length || row[gx] !== "1") return paper;
    return ink;
  });
}

export async function jpegDigit(digit: number): Promise<Buffer> {
  const png = pngDigit(digit, 20, [8, 8, 180], [250, 250, 250]);
  const directory = mkdtempSync(join(tmpdir(), "dynamicwf-jpeg-"));
  try {
    const source = join(directory, "source.png");
    const dest = join(directory, "dest.jpg");
    writeFileSync(source, png);
    const converted = spawnSync("sips", ["-s", "format", "jpeg", source, "--out", dest], { encoding: "utf8" });
    if (converted.status !== 0) throw new Error(`JPEG conversion failed: ${converted.stderr}`);
    const bytes = readFileSync(dest);
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("JPEG conversion did not produce JPEG bytes");
    return bytes;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

export function oversizedPng(): Buffer {
  return encodePng(2200, 2200, (x, y) => [(x * 13 + y * 7) % 256, (x * 3) % 256, (y * 5) % 256]);
}

export function corruptPng(): Buffer {
  const valid = encodePng(8, 8, () => [255, 0, 0]);
  valid[20] = 0xff;
  return valid;
}
