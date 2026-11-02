import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { renderDocument } from "./rich-text";
import { ratingText, Stars } from "./stars";

const html = (document: unknown) =>
  renderToStaticMarkup(createElement(Fragment, null, renderDocument(document)));

const doc = (...content: unknown[]) => ({ type: "doc", content });
const text = (value: string, marks?: { type: string }[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });

describe("the journal renderer", () => {
  it("renders paragraphs, subheadings, quotes, breaks, and emphasis", () => {
    expect(
      html(
        doc(
          paragraph(
            text("One"),
            { type: "hardBreak" },
            text("two", [{ type: "italic" }]),
          ),
          { type: "heading", attrs: { level: 2 }, content: [text("Sub")] },
          { type: "blockquote", content: [paragraph(text("Quoted"))] },
        ),
      ),
    ).toBe(
      "<p>One<br/><em>two</em></p><h3>Sub</h3><blockquote><p>Quoted</p></blockquote>",
    );
  });

  it("escapes markup in text", () => {
    const out = html(
      doc(paragraph(text('<script>alert("x")</script><img src=x onerror=y>'))),
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
  });

  it("never renders a link, whatever its address", () => {
    const out = html(
      doc(
        paragraph(
          text("click", [{ type: "link" }]),
          text(" here", [
            { type: "link", href: "javascript:alert(1)" } as never,
          ]),
        ),
      ),
    );
    expect(out).toBe("<p>click here</p>");
    expect(out).not.toContain("href");
  });

  it("shows an unknown node as its text, never as its markup", () => {
    expect(
      html(
        doc({
          type: "iframe",
          attrs: { src: "https://example.test" },
          content: [text("inside")],
        }),
      ),
    ).toBe("<p>inside</p>");
    expect(
      html(
        doc(paragraph({ type: "image", attrs: { src: "x" } }, text("after"))),
      ),
    ).toBe("<p>after</p>");
  });

  it("drops empty paragraphs, and returns nothing for no text", () => {
    expect(html(doc(paragraph(), paragraph(text("   "))))).toBe("");
    expect(renderDocument(doc())).toBeNull();
  });

  it("returns nothing for anything that is not a document", () => {
    for (const value of [
      null,
      undefined,
      1,
      "text",
      [],
      { type: "paragraph" },
    ]) {
      expect(renderDocument(value)).toBeNull();
    }
  });

  it("is not defeated by a very deep or malformed document", () => {
    let deep: unknown = text("deep");
    for (let i = 0; i < 500; i += 1) {
      deep = { type: "blockquote", content: [deep] };
    }
    expect(() => html(doc(deep))).not.toThrow();
    expect(() =>
      html({
        type: "doc",
        content: [null, 3, "x", { type: "paragraph", content: "no" }],
      }),
    ).not.toThrow();
  });
});

describe("ratings", () => {
  it("writes half steps as a number out of five", () => {
    expect(ratingText(9)).toBe("4.5");
    expect(ratingText(8)).toBe("4");
    expect(ratingText(1)).toBe("0.5");
    expect(ratingText(10)).toBe("5");
  });

  it("draws full, half, and empty stars, and names the rating in words", () => {
    const out = renderToStaticMarkup(
      createElement(Stars, { halfSteps: 9, label: "My rating: 4.5 out of 5" }),
    );
    expect(out).toContain('aria-label="My rating: 4.5 out of 5"');
    expect(out.match(/<svg/g)).toHaveLength(5);
    // Four filled stars, and a half drawn on the fifth.
    expect(out.match(/<path d="[^"]+" fill="#111111"/g)).toHaveLength(4 + 1);
    const none = renderToStaticMarkup(
      createElement(Stars, { halfSteps: 0, label: "x" }),
    );
    expect(none).not.toContain('fill="#111111"');
  });
});
