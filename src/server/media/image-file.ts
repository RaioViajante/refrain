// Validation and cleaning of uploaded photographs, from their bytes (never the
// file name or the browser's declared type). Only JPEG and PNG are accepted.
// Metadata that can reveal places, devices, or people (EXIF with GPS, XMP,
// IPTC, comments, PNG text chunks) is removed; the colour profile is kept.

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_DIMENSION = 12_000;

export type ImageKind = "jpeg" | "png";
export type InspectedImage = {
  kind: ImageKind;
  width: number;
  height: number;
  bytes: Uint8Array;
};

export class ImageFileError extends Error {
  override name = "ImageFileError";
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(b: Uint8Array) {
  return PNG_SIGNATURE.every((v, i) => b[i] === v);
}
function isJpeg(b: Uint8Array) {
  return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

const u16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32 = (b: Uint8Array, i: number) =>
  ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;

/** JPEG: keeps every segment except APP1 (EXIF, XMP), APP13 (IPTC), COM. */
function cleanJpeg(b: Uint8Array): {
  bytes: Uint8Array;
  width: number;
  height: number;
} {
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  let width = 0;
  let height = 0;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new ImageFileError("JPEG malformado.");
    let marker = b[i + 1]!;
    // Fill bytes before a marker.
    while (marker === 0xff) {
      i++;
      marker = b[i + 1]!;
    }
    if (marker === 0xd9) {
      out.push(b.subarray(i, i + 2));
      break;
    }
    if (marker === 0xda) {
      // Start of scan: the rest is image data (and EOI), kept as is.
      out.push(b.subarray(i));
      break;
    }
    if (i + 4 > b.length) throw new ImageFileError("JPEG incompleto.");
    const length = u16(b, i + 2);
    if (length < 2 || i + 2 + length > b.length) {
      throw new ImageFileError("JPEG malformado.");
    }
    const segment = b.subarray(i, i + 2 + length);
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof && length >= 7) {
      height = u16(b, i + 5);
      width = u16(b, i + 7);
    }
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) out.push(segment);
    i += 2 + length;
  }
  if (!width || !height) throw new ImageFileError("JPEG sem dimensões.");
  return { bytes: concat(out), width, height };
}

const PNG_DROP = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);

/** PNG: keeps every chunk except EXIF, text, and time chunks. */
function cleanPng(b: Uint8Array): {
  bytes: Uint8Array;
  width: number;
  height: number;
} {
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  let width = 0;
  let height = 0;
  let ended = false;
  while (i + 12 <= b.length) {
    const length = u32(b, i);
    const type = String.fromCharCode(...b.subarray(i + 4, i + 8));
    const end = i + 12 + length;
    if (end > b.length) throw new ImageFileError("PNG malformado.");
    if (type === "IHDR") {
      width = u32(b, i + 8);
      height = u32(b, i + 12);
    }
    if (!PNG_DROP.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended || !width || !height) throw new ImageFileError("PNG malformado.");
  return { bytes: concat(out), width, height };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Validates an upload and returns it cleaned, with its kind and size. */
export function inspectImage(input: Uint8Array): InspectedImage {
  if (input.length === 0) throw new ImageFileError("O arquivo está vazio.");
  if (input.length > MAX_UPLOAD_BYTES) {
    throw new ImageFileError("A foto passa de 4 MB.");
  }
  const kind: ImageKind | null = isJpeg(input)
    ? "jpeg"
    : isPng(input)
      ? "png"
      : null;
  if (!kind) throw new ImageFileError("Envie uma foto JPEG ou PNG.");
  const cleaned = kind === "jpeg" ? cleanJpeg(input) : cleanPng(input);
  if (cleaned.width > MAX_DIMENSION || cleaned.height > MAX_DIMENSION) {
    throw new ImageFileError("A foto é grande demais (máximo 12 000 px).");
  }
  return { kind, ...cleaned };
}
