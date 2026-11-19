import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { ImageFileError, inspectImage, MAX_UPLOAD_BYTES } from "./image-file";

const ascii = (s: string) => new TextEncoder().encode(s);
const has = (bytes: Uint8Array, s: string) =>
  Buffer.from(bytes).includes(Buffer.from(s, "latin1"));

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  return Uint8Array.from([
    0xff,
    marker,
    length >> 8,
    length & 0xff,
    ...payload,
  ]);
}

/** A synthetic JPEG: SOI, JFIF, EXIF with GPS, ICC, a comment, SOF0, SOS, EOI. */
function jpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    ...segment(0xe0, ascii("JFIF\0\x01\x02")),
    ...segment(0xe1, ascii("Exif\0\0GPSLatitude=-23.5")),
    ...segment(0xe2, ascii("ICC_PROFILE\0colour")),
    ...segment(0xfe, ascii("camera owner name")),
    ...segment(
      0xc0,
      Uint8Array.from([
        8,
        height >> 8,
        height & 0xff,
        width >> 8,
        width & 0xff,
        1,
        1,
        0x11,
        0,
      ]),
    ),
    ...segment(0xda, Uint8Array.from([1, 1, 0, 0, 0x3f, 0])),
    0x12,
    0x34,
    0x56,
    0xff,
    0xd9,
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  Buffer.from(data).copy(out, 8);
  // The CRC is not checked by the cleaner; browsers check it at display.
  return out;
}

function png(width: number, height: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("tEXt", ascii("Author\0someone")),
    chunk("eXIf", ascii("GPS data")),
    chunk("IDAT", deflateSync(Buffer.alloc(height * (width * 3 + 1)))),
    chunk("IEND", new Uint8Array()),
  ]);
}

describe("inspectImage", () => {
  it("reads a JPEG's size and strips EXIF, GPS, and comments, keeping its colour profile", () => {
    const out = inspectImage(jpeg(1600, 1200));
    expect(out).toMatchObject({ kind: "jpeg", width: 1600, height: 1200 });
    expect(has(out.bytes, "GPSLatitude")).toBe(false);
    expect(has(out.bytes, "camera owner")).toBe(false);
    expect(has(out.bytes, "ICC_PROFILE")).toBe(true);
    expect(out.bytes[out.bytes.length - 1]).toBe(0xd9);
  });

  it("reads a PNG's size and strips its text and EXIF chunks", () => {
    const out = inspectImage(png(4, 3));
    expect(out).toMatchObject({ kind: "png", width: 4, height: 3 });
    expect(has(out.bytes, "Author")).toBe(false);
    expect(has(out.bytes, "GPS data")).toBe(false);
    expect(has(out.bytes, "IDAT")).toBe(true);
  });

  it("refuses anything that is not a JPEG or PNG by its bytes", () => {
    for (const bytes of [
      ascii("GIF89a....."),
      ascii("<svg onload=alert(1)>"),
      ascii("%PDF-1.7"),
      new Uint8Array(),
    ]) {
      expect(() => inspectImage(bytes)).toThrow(ImageFileError);
    }
  });

  it("refuses truncated, oversized, or giant images", () => {
    expect(() => inspectImage(jpeg(10, 10).subarray(0, 12))).toThrow(
      ImageFileError,
    );
    expect(() => inspectImage(png(4, 3).subarray(0, 40))).toThrow(
      ImageFileError,
    );
    expect(() =>
      inspectImage(new Uint8Array(MAX_UPLOAD_BYTES + 1).fill(0xff)),
    ).toThrow("4 MB");
    expect(() => inspectImage(png(20_000, 1))).toThrow("grande demais");
  });
});
