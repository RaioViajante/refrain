import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

// The approved 404 illustration (M3.1 owner review). It is the author's own
// drawing, promoted byte for byte from the local reference file and never
// altered (AGENTS.md § 6; docs/design-system.md § Assets). These tests keep it
// that way and check the two properties the not-found view depends on: it is
// RGBA, and its transparency is genuine (a transparent ground and a drawing
// that is solid), not a white background that happens to look transparent.

const FILE = "public/artwork/refrain-404.png";
const SHA256 =
  "7705f803a871cdd9e693dcf9ae2d222fe8545281c4e8b9975699f00ed96c4956";

const file = readFileSync(FILE);

function chunks(png: Buffer) {
  const found: { type: string; data: Buffer }[] = [];
  let position = 8;
  while (position < png.length) {
    const length = png.readUInt32BE(position);
    found.push({
      type: png.toString("latin1", position + 4, position + 8),
      data: png.subarray(position + 8, position + 8 + length),
    });
    position += 12 + length;
  }
  return found;
}

/** The alpha of every pixel of an 8-bit RGBA, non-interlaced PNG. */
function alphaOf(png: Buffer) {
  const all = chunks(png);
  const header = all.find((chunk) => chunk.type === "IHDR")!.data;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const raw = inflateSync(
    Buffer.concat(
      all.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data),
    ),
  );
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const alpha = new Uint8Array(width * height);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    const filter = raw[start]!;
    const line = new Uint8Array(raw.subarray(start + 1, start + 1 + stride));
    for (let i = 0; i < stride; i += 1) {
      const left = i >= bytesPerPixel ? line[i - bytesPerPixel]! : 0;
      const up = previous[i]!;
      const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel]! : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      line[i] = (line[i]! + predictor) & 255;
    }
    for (let x = 0; x < width; x += 1) {
      alpha[y * width + x] = line[x * bytesPerPixel + 3]!;
    }
    previous = line;
  }
  return { width, height, alpha };
}

describe("the approved 404 illustration", () => {
  it("is the original file, byte for byte", () => {
    expect(createHash("sha256").update(file).digest("hex")).toBe(SHA256);
  });

  it("is an 8-bit RGBA PNG, 1536 by 1024, not interlaced", () => {
    expect(file.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const header = chunks(file).find((chunk) => chunk.type === "IHDR")!.data;
    expect(header.readUInt32BE(0)).toBe(1536);
    expect(header.readUInt32BE(4)).toBe(1024);
    expect(header[8]).toBe(8); // bit depth
    expect(header[9]).toBe(6); // color type: truecolor with alpha
    expect(header[12]).toBe(0); // no interlace
  });

  it("has genuine transparency: a clear ground, transparent corners, and a solid drawing", () => {
    const { width, height, alpha } = alphaOf(file);
    const total = width * height;
    const clear = alpha.filter((a) => a === 0).length;
    const solid = alpha.filter((a) => a >= 224).length;
    // About half the picture is the clear ground around the drawing, and
    // nearly all of the rest is solid: a real cut-out, not a faded image.
    expect(clear / total).toBeGreaterThan(0.4);
    expect(solid / total).toBeGreaterThan(0.4);
    for (const [x, y] of [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
    ] as const) {
      expect(alpha[y! * width + x!]).toBe(0);
    }
  });
});
