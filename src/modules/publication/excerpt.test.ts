import { describe, expect, it } from "vitest";

import { cutAtWord, EXCERPT_TARGET, memoryExcerpt } from "./excerpt";

// The excerpt of a public memory (M3.8a): the first readable paragraph, as
// plain text through a restricted reading of the stored document, cut to
// about 240 characters at a word boundary, with an ellipsis only when cut.

const doc = (...content: unknown[]) => ({ type: "doc", content });
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});

describe("memoryExcerpt", () => {
  it("is the first paragraph, whole, when it is short", () => {
    expect(
      memoryExcerpt(
        doc(paragraph(text("A short one.")), paragraph(text("Next."))),
      ),
    ).toBe("A short one.");
  });

  it("skips empty paragraphs and reads hard breaks and marks as plain text", () => {
    expect(
      memoryExcerpt(
        doc(
          paragraph(),
          paragraph(text("   ")),
          paragraph(
            text("Bold", [{ type: "bold" }]),
            { type: "hardBreak" },
            text("and a "),
            text("link", [
              { type: "link", attrs: { href: "https://x.example" } },
            ]),
          ),
        ),
      ),
    ).toBe("Bold and a link");
  });

  it("prefers a paragraph to a heading before it, and falls back to any block", () => {
    expect(
      memoryExcerpt(
        doc(
          { type: "heading", content: [text("A heading")] },
          paragraph(text("The paragraph.")),
        ),
      ),
    ).toBe("The paragraph.");
    expect(
      memoryExcerpt(
        doc({ type: "heading", content: [text("Only a heading")] }),
      ),
    ).toBe("Only a heading");
    expect(
      memoryExcerpt(
        doc({
          type: "blockquote",
          content: [paragraph(text("A quoted first paragraph."))],
        }),
      ),
    ).toBe("A quoted first paragraph.");
  });

  it("cuts a long paragraph at a word boundary, with an ellipsis", () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const excerpt = memoryExcerpt(doc(paragraph(text(long))))!;
    expect(excerpt.endsWith("…")).toBe(true);
    const body = excerpt.slice(0, -1);
    expect(body.length).toBeLessThanOrEqual(EXCERPT_TARGET);
    expect(body.length).toBeGreaterThan(EXCERPT_TARGET * 0.6);
    // Never half a word.
    expect(long.startsWith(body)).toBe(true);
    expect(long[body.length]).toBe(" ");
  });

  it("does not end on a comma or a dash before the ellipsis", () => {
    const words = `${"a".repeat(230)}, ${"b".repeat(30)}`;
    expect(cutAtWord(words)).toBe(`${"a".repeat(230)}…`);
  });

  it("cuts one very long word at the target, without splitting a character", () => {
    const flags = "🇧🇷".repeat(300);
    const excerpt = cutAtWord(flags)!;
    expect(excerpt.endsWith("…")).toBe(true);
    // Each flag is two code points and one grapheme: the cut keeps whole flags.
    expect(Array.from(excerpt.slice(0, -1)).length % 2).toBe(0);
    const accented = "é".repeat(300);
    const cut = cutAtWord(accented).slice(0, -1);
    expect(cut.endsWith("é")).toBe(true);
  });

  it("keeps Unicode text as written and turns invisible controls into spaces", () => {
    expect(
      memoryExcerpt(doc(paragraph(text("Verão‮ de\u0000 2019​, São Paulo")))),
    ).toBe("Verão de 2019 , São Paulo");
  });

  it("gives null for an empty, malformed, or hostile document", () => {
    expect(memoryExcerpt(null)).toBeNull();
    expect(memoryExcerpt("text")).toBeNull();
    expect(memoryExcerpt([paragraph(text("array"))])).toBeNull();
    expect(memoryExcerpt(doc())).toBeNull();
    expect(memoryExcerpt({ type: "doc", content: "nope" })).toBeNull();
    expect(
      memoryExcerpt(
        doc({ type: "paragraph", content: [{ type: "text", text: 42 }] }),
      ),
    ).toBeNull();
    // Markup in a text node is text, never markup.
    expect(memoryExcerpt(doc(paragraph(text("<script>x</script>"))))).toBe(
      "<script>x</script>",
    );
  });

  it("does not read nesting deeper than the renderer does", () => {
    let node: unknown = text("deep");
    for (let i = 0; i < 20; i += 1) node = { type: "span", content: [node] };
    expect(memoryExcerpt(doc(paragraph(node)))).toBeNull();
  });

  it("stops collecting a huge paragraph long before its end", () => {
    const huge = paragraph(
      ...Array.from({ length: 10_000 }, () => text("lorem ipsum ")),
    );
    const excerpt = memoryExcerpt(doc(huge))!;
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(EXCERPT_TARGET + 1);
  });
});
