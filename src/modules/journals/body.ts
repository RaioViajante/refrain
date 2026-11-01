import { isDeepStrictEqual } from "node:util";

import { cleanText } from "@/validation";

// Plain text <-> the accepted storage format (ADR 0002, D6): a Tiptap
// (ProseMirror) document in `jsonb`, with a plain-text projection. The simple
// writing interface of M1.3B is a textarea. Its text becomes a document at
// the trusted server boundary, and a stored document becomes the textarea's
// text again, so a save never changes the storage format.
//
// A blank line separates paragraphs and a single line break inside a
// paragraph is a hard break. Pure functions, with no database access.
//
// The plain editor can represent only paragraphs, text without marks, and hard
// breaks. `documentToText` returns `null` for anything else (for example a
// heading or bold text written by the later rich-text editor), so a textarea
// can never flatten formatting it cannot show.

export interface TextNode {
  type: "text";
  text: string;
}
export interface HardBreakNode {
  type: "hardBreak";
}
export interface ParagraphNode {
  type: "paragraph";
  content?: (TextNode | HardBreakNode)[];
}
export interface PlainDocument {
  type: "doc";
  content: ParagraphNode[];
}

/**
 * The canonical form of the text the author wrote: well-formed Unicode, no
 * control characters, line feeds only, no trailing spaces on a line, no blank
 * lines at the start or end, and at most one blank line between paragraphs.
 * Normalizing twice gives the same text, which makes save-and-reload stable.
 */
export function normalizeBodyText(text: string): string {
  return cleanText(text)
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/^\n+|\n+$/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * The document for `text`, or `null` when there is nothing to store (the
 * database requires `body` to be `NULL` when `body_text` is empty).
 */
export function textToDocument(text: string): PlainDocument | null {
  const normalized = normalizeBodyText(text);
  if (normalized === "") {
    return null;
  }
  return {
    type: "doc",
    content: normalized.split("\n\n").map((paragraph) => {
      const content: (TextNode | HardBreakNode)[] = [];
      for (const [index, line] of paragraph.split("\n").entries()) {
        if (index > 0) {
          content.push({ type: "hardBreak" });
        }
        content.push({ type: "text", text: line });
      }
      return { type: "paragraph", content };
    }),
  };
}

function hasOnlyKeys(node: object, keys: string[]): boolean {
  return Object.keys(node).every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The text a stored document holds, or `null` when the plain editor cannot
 * represent it without losing something: any node other than paragraphs, text
 * and hard breaks, and any marks, attributes, or unknown properties.
 * `null` or an absent body is an empty text.
 */
export function documentToText(body: unknown): string | null {
  if (body === null || body === undefined) {
    return "";
  }
  if (
    !isRecord(body) ||
    body.type !== "doc" ||
    !hasOnlyKeys(body, ["type", "content"])
  ) {
    return null;
  }
  const paragraphs = body.content ?? [];
  if (!Array.isArray(paragraphs)) {
    return null;
  }

  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (
      !isRecord(paragraph) ||
      paragraph.type !== "paragraph" ||
      !hasOnlyKeys(paragraph, ["type", "content"])
    ) {
      return null;
    }
    const content = paragraph.content ?? [];
    if (!Array.isArray(content)) {
      return null;
    }
    let text = "";
    for (const node of content) {
      if (!isRecord(node)) {
        return null;
      }
      if (node.type === "text" && hasOnlyKeys(node, ["type", "text"])) {
        if (typeof node.text !== "string") {
          return null;
        }
        text += node.text;
      } else if (node.type === "hardBreak" && hasOnlyKeys(node, ["type"])) {
        text += "\n";
      } else {
        return null;
      }
    }
    lines.push(text);
  }
  return lines.join("\n\n");
}

/**
 * The text of a stored document, but only if the plain editor reproduces that
 * document exactly when the text is saved again; otherwise `null`. This is
 * stricter than `documentToText`: a document without marks or attributes can
 * still change when it is saved (an empty paragraph, a line feed inside a text
 * node, trailing spaces, control characters), and a save must never rewrite
 * writing that the author did not edit. An empty text is always editable.
 */
export function editableText(body: unknown): string | null {
  const text = documentToText(body);
  if (text === null) {
    return null;
  }
  if (text === "") {
    return "";
  }
  return isDeepStrictEqual(textToDocument(text), body) ? text : null;
}

/** The paragraphs of a text, each a list of its lines, for rendering. */
export function textToParagraphs(text: string): string[][] {
  const normalized = normalizeBodyText(text);
  if (normalized === "") {
    return [];
  }
  return normalized.split("\n\n").map((paragraph) => paragraph.split("\n"));
}
