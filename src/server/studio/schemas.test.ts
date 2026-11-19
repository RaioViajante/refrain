import { describe, expect, it } from "vitest";

import { noteSchema, siteTextBodySchema } from "./schemas";

describe("text fields", () => {
  it("store line breaks as \\n, whatever the browser sends", () => {
    expect(siteTextBodySchema.parse(" a\r\n\r\nb\rc ")).toBe("a\n\nb\nc");
    expect(noteSchema.parse({ note: "x\r\ny", noteSide: "left" }).note).toBe(
      "x\ny",
    );
  });
});
