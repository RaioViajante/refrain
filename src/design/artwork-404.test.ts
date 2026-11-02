import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// The approved 404 illustration (M3.1). The original is the author's own
// drawing, the local `reference/refrain-404.png` (1536×1024, 8-bit RGBA,
// SHA-256 7705f803a871cdd9e693dcf9ae2d222fe8545281c4e8b9975699f00ed96c4956),
// which stays outside the repository and is never altered. The application
// serves the production copy the owner authorized: a WebP made from it with
//
//   cwebp -q 90 -m 6 -sharp_yuv -alpha_q 100 -exact -metadata none \
//     reference/refrain-404.png -o public/artwork/refrain-404.webp
//
// (libwebp 1.6.0), whose colour is lossy at quality 90 and whose transparency
// is lossless. Decoded, its alpha channel equals the original's bit for bit
// (docs/design-system.md § Assets). These tests keep the file as it was made;
// the browser test reads its transparency back after decoding
// (e2e/public.spec.ts).

const FILE = "public/artwork/refrain-404.webp";
const SHA256 =
  "c3d879f0a9ad1ecb0ff33c1601abd34ce350c1ffefcaebed6ad5a1ca29fd4a96";

const file = readFileSync(FILE);

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

describe("the approved 404 illustration", () => {
  it("is the production copy that was made and reviewed, byte for byte", () => {
    expect(createHash("sha256").update(file).digest("hex")).toBe(SHA256);
    expect(file.length).toBe(467_460);
  });

  it("is an extended WebP, 1536 by 1024, that declares transparency", () => {
    expect(file.toString("latin1", 0, 4)).toBe("RIFF");
    expect(file.toString("latin1", 8, 12)).toBe("WEBP");
    expect(file.readUInt32LE(4)).toBe(file.length - 8);
    const header = chunks(file).find((chunk) => chunk.type === "VP8X")!.data;
    // Bit 4 of the flags: the image has an alpha channel.
    expect((header[0]! >> 4) & 1).toBe(1);
    expect(header.readUIntLE(4, 3) + 1).toBe(1536);
    expect(header.readUIntLE(7, 3) + 1).toBe(1024);
  });

  it("stores its transparency losslessly, and nothing but the picture", () => {
    const all = chunks(file);
    expect(all.map((chunk) => chunk.type)).toEqual(["VP8X", "ALPH", "VP8 "]);
    // The ALPH header's two low bits are the compression method: 1 is the
    // lossless WebP codec. (0 would be uncompressed, which is also exact; any
    // other value is invalid.)
    expect(all[1]!.data[0]! & 0b11).toBe(1);
    // No metadata chunk: no EXIF, XMP, or colour profile travels with it.
    expect(all.some((chunk) => /EXIF|XMP |ICCP/.test(chunk.type))).toBe(false);
  });

  it("is a fraction of the original's 2,824,585 bytes", () => {
    expect(file.length / 2_824_585).toBeLessThan(0.2);
  });
});
