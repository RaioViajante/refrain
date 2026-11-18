import { describe, expect, it } from "vitest";

import {
  documentToText,
  editableText,
  normalizeBodyText,
  textToDocument,
  textToParagraphs,
} from "./body";

describe("normalizeBodyText", () => {
  it.each([
    ["a\r\nb", "a\nb"],
    ["a\rb", "a\nb"],
    ["  a  \n b \t", "  a\n b"],
    ["\n\n\na\n\n\n\n\nb\n\n", "a\n\nb"],
    ["a\n  \nb", "a\n\nb"],
    ["", ""],
    ["\n \n\t\n", ""],
    ["nul\u0000 and \u0007bell", "nul and bell"],
    ["lone \ud800 surrogate", "lone � surrogate"],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeBodyText(input)).toBe(expected);
  });

  it("is idempotent", () => {
    for (const text of ["a\n\n\nb  ", "\n\n x \n\n\n y\n", "é\n\nã"]) {
      const once = normalizeBodyText(text);
      expect(normalizeBodyText(once)).toBe(once);
    }
  });
});

describe("textToDocument", () => {
  it("stores nothing for an empty text", () => {
    expect(textToDocument("")).toBeNull();
    expect(textToDocument(" \n\n ")).toBeNull();
  });

  it("makes one paragraph per blank-line-separated block, with hard breaks", () => {
    expect(textToDocument("First line\nsecond line\n\nNext paragraph")).toEqual(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "First line" },
              { type: "hardBreak" },
              { type: "text", text: "second line" },
            ],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Next paragraph" }],
          },
        ],
      },
    );
  });

  it("never produces an empty text node, which ProseMirror rejects", () => {
    const document = JSON.stringify(textToDocument("a\n\n\n\nb\n \nc"));
    expect(document).not.toContain('"text":""');
  });

  it("keeps markup characters as plain text", () => {
    const text =
      '<script>alert("x")</script>\n\n**not bold** [link](javascript:1)';
    expect(documentToText(textToDocument(text))).toBe(text);
  });
});

describe("documentToText", () => {
  it("round-trips normalized text exactly, so saving never corrupts it", () => {
    for (const text of [
      "One paragraph.",
      "Two\nlines\n\nand a second paragraph",
      "  leading spaces are kept\n\nÃ§ accents ✓ 日本語 🎵",
      "a\n\nb\n\nc",
    ]) {
      expect(documentToText(textToDocument(text))).toBe(
        normalizeBodyText(text),
      );
    }
  });

  it("reads an empty body as empty text", () => {
    expect(documentToText(null)).toBe("");
    expect(documentToText({ type: "doc" })).toBe("");
    expect(
      documentToText({ type: "doc", content: [{ type: "paragraph" }] }),
    ).toBe("");
  });

  it.each([
    [
      "a heading",
      {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "x" }],
          },
        ],
      },
    ],
    [
      "bold text",
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "x", marks: [{ type: "bold" }] }],
          },
        ],
      },
    ],
    [
      "a paragraph with attributes",
      {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { textAlign: "center" }, content: [] },
        ],
      },
    ],
    ["a list", { type: "doc", content: [{ type: "bulletList", content: [] }] }],
    [
      "a node of an unknown kind",
      {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "mention", text: "x" }] },
        ],
      },
    ],
    ["a non-document", { type: "paragraph" }],
    ["a string", "text"],
    ["an array", []],
    [
      "text that is not a string",
      {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: 5 }] }],
      },
    ],
    ["content that is not an array", { type: "doc", content: "x" }],
    ["extra properties", { type: "doc", content: [], extra: true }],
  ])("refuses %s rather than flatten it", (_name, document) => {
    expect(documentToText(document)).toBeNull();
  });
});

describe("textToParagraphs", () => {
  it("splits a text for rendering", () => {
    expect(textToParagraphs("a\nb\n\nc")).toEqual([["a", "b"], ["c"]]);
    expect(textToParagraphs("")).toEqual([]);
  });
});

describe("editableText", () => {
  it("accepts what the plain editor itself wrote, and an empty body", () => {
    for (const text of ["One.", "a\nb\n\nc", "  indented\n\né ✓ 日本語"]) {
      expect(editableText(textToDocument(text))).toBe(normalizeBodyText(text));
    }
    expect(editableText(null)).toBe("");
    expect(
      editableText({ type: "doc", content: [{ type: "paragraph" }] }),
    ).toBe("");
  });

  const p = (...content: object[]) => ({ type: "paragraph", content });
  const text = (value: string) => ({ type: "text", text: value });
  it.each([
    [
      "an empty paragraph between two paragraphs",
      {
        type: "doc",
        content: [p(text("a")), { type: "paragraph" }, p(text("b"))],
      },
    ],
    [
      "a line feed inside one text node",
      { type: "doc", content: [p(text("a\n\nb"))] },
    ],
    [
      "trailing spaces on a text node",
      { type: "doc", content: [p(text("a   "))] },
    ],
    ["a control character", { type: "doc", content: [p(text("a\u0001b"))] }],
    [
      "adjacent text nodes",
      { type: "doc", content: [p(text("a"), text("b"))] },
    ],
    [
      "a hard break at the end",
      { type: "doc", content: [p(text("a"), { type: "hardBreak" })] },
    ],
  ])("refuses %s, because saving would change it", (_name, document) => {
    // The structural reader accepts these; saving them would rewrite them.
    expect(documentToText(document)).not.toBeNull();
    expect(editableText(document)).toBeNull();
  });
});
