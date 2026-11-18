import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// The Home's character (M3.4). The original is the author's own drawing, the
// local `reference/refrain-home-character.png` (1536×1024, 8-bit RGBA,
// SHA-256 ad58315e79980337147ef11f30a0ed418a5c3bf509a0a77da81bce59290ba63c),
// kept byte for byte in `public/artwork/refrain-home-character.png` for the
// README and never altered. The Home serves the production copy the owner
// authorized for M3.4, made with the same recipe as the approved 404 copy:
//
//   cwebp -q 90 -m 6 -sharp_yuv -alpha_q 100 -exact -metadata none \
//     reference/refrain-home-character.png \
//     -o public/artwork/refrain-home-character.webp
//
// (libwebp 1.6.0). Its colour is lossy at quality 90 and its transparency is
// lossless: decoded, its alpha channel equals the original's for every pixel
// (docs/design-system.md § Assets; docs/evidence/m3-4.md). These tests keep
// the file as it was made, and the original as it is.

const COPY = "public/artwork/refrain-home-character.webp";
const COPY_SHA256 =
  "e98f523f5bce1262c4e1b4fa525922356dc0acf31b09b4cfc0a69787948edeec";
const ORIGINAL = "public/artwork/refrain-home-character.png";
const ORIGINAL_SHA256 =
  "ad58315e79980337147ef11f30a0ed418a5c3bf509a0a77da81bce59290ba63c";

const file = readFileSync(COPY);
const sha256 = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");

function chunks(webp: Buffer) {
  const found: { type: string; data: Buffer }[] = [];
  let position = 12;
  while (position < webp.length) {
    const length = webp.readUInt32LE(position + 4);
    found.push({
      type: webp.toString("latin1", position, position + 4),
      data: webp.subarray(position + 8, position + 8 + length),
    });
    position += 8 + length + (length % 2);
  }
  return found;
}

describe("the Home's character", () => {
  it("is the production copy that was made and reviewed, byte for byte", () => {
    expect(sha256(file)).toBe(COPY_SHA256);
    expect(file.length).toBe(312_852);
  });

  it("leaves the original untouched beside it", () => {
    expect(sha256(readFileSync(ORIGINAL))).toBe(ORIGINAL_SHA256);
  });

  it("is an extended WebP, 1536 by 1024, that declares transparency", () => {
    expect(file.toString("latin1", 0, 4)).toBe("RIFF");
    expect(file.toString("latin1", 8, 12)).toBe("WEBP");
    expect(file.readUInt32LE(4)).toBe(file.length - 8);
    const header = chunks(file).find((chunk) => chunk.type === "VP8X")!.data;
    expect((header[0]! >> 4) & 1).toBe(1);
    expect(header.readUIntLE(4, 3) + 1).toBe(1536);
    expect(header.readUIntLE(7, 3) + 1).toBe(1024);
  });

  it("stores its transparency losslessly, and nothing but the picture", () => {
    const all = chunks(file);
    expect(all.map((chunk) => chunk.type)).toEqual(["VP8X", "ALPH", "VP8 "]);
    expect(all[1]!.data[0]! & 0b11).toBe(1);
    expect(all.some((chunk) => /EXIF|XMP |ICCP/.test(chunk.type))).toBe(false);
  });

  it("is a fraction of the original's 1,949,226 bytes", () => {
    expect(file.length / 1_949_226).toBeLessThan(0.2);
  });
});
