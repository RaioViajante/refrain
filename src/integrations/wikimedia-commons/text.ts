import { cleanText } from "@/validation";

// Commons returns extended metadata as HTML ("Results are HTML formatted",
// https://www.mediawiki.org/wiki/API:Imageinfo): an author is often a link to
// a user page or a category, sometimes a table or a template's markup. That
// HTML is never rendered. This reduces it to plain text on one line: tags
// dropped (with the content of `script`, `style`, and comments), common
// entities decoded, whitespace collapsed. The result is shown as text, which
// React escapes; whether it is acceptable as a credit is decided after this
// (`isPlainCredit`), and anything that still reads as markup is refused.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  copy: "©",
  middot: "·",
};

const MAX_INPUT = 20_000;

function decodeEntity(entity: string, body: string): string {
  if (body.startsWith("#")) {
    const code =
      body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
    // A control character or an invalid code point is dropped, not decoded.
    if (
      !Number.isInteger(code) ||
      code < 0x20 ||
      (code >= 0x7f && code < 0xa0) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code > 0x10ffff
    ) {
      return "";
    }
    return String.fromCodePoint(code);
  }
  return NAMED_ENTITIES[body] ?? entity;
}

/** HTML from a provider, as one line of plain text (possibly empty). */
export function metadataText(html: unknown): string {
  if (typeof html !== "string") {
    return "";
  }
  const text = html
    .slice(0, MAX_INPUT)
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(
      /<(script|style|template|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)/gi,
      " ",
    )
    .replace(/<\/?(?:br|p|div|li|tr|td|th|dd|dt|ul|ol|table)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>?/g, "")
    .replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (entity, body) =>
      decodeEntity(entity, body),
    );
  return cleanText(text).replace(/\s+/g, " ").trim();
}
