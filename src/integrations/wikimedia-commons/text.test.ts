import { describe, expect, it } from "vitest";

import { metadataText } from "./text";

describe("metadata HTML as plain text", () => {
  it.each([
    // Live shapes (docs/evidence/m3-3.md).
    [
      '<a href="//commons.wikimedia.org/wiki/Category:Ron_Kroon" title="Category:Ron Kroon">Ron Kroon</a> for <a href="//commons.wikimedia.org/wiki/Category:Anefo">Anefo</a>',
      "Ron Kroon for Anefo",
    ],
    ["Gerrit de Bruin", "Gerrit de Bruin"],
    [
      '<bdi><a href="https://en.wikipedia.org/wiki/x" class="extiw">Alexander Gardner</a></bdi>',
      "Alexander Gardner",
    ],
    [
      "<p>This file was derived from:<br>Portrait.jpg</p>",
      "This file was derived from: Portrait.jpg",
    ],
    [
      "Caf&eacute; &amp; Bar &#8212; &#x2014;&nbsp;x",
      "Caf&eacute; & Bar — — x",
    ],
    ["  many\n\n  spaces\t here ", "many spaces here"],
    ["", ""],
  ])("reads %j", (html, text) => {
    expect(metadataText(html)).toBe(text);
  });

  it.each([
    ['<script>alert("x")</script>[Test] Name', "[Test] Name"],
    ["<style>a{}</style>[Test] Name", "[Test] Name"],
    ["<img src=x onerror=alert(1)>[Test] Name", "[Test] Name"],
    ['<a href="javascript:alert(1)">[Test] Name</a>', "[Test] Name"],
    ["<!-- <script>x</script> -->[Test] Name", "[Test] Name"],
    ["<script>never closed [Test] Name", ""],
    ["[Test] Name<b", "[Test] Name"],
    ["[Test]&#0;&#7;&#x7F;&#xD800;&#x110000; Name", "[Test] Name"],
  ])("drops markup and scripts from %j", (html, text) => {
    expect(metadataText(html)).toBe(text);
  });

  it("decodes escaped markup into visible text, which a credit then refuses", () => {
    expect(metadataText("&lt;b onmouseover=alert(2)&gt;Evil&lt;/b&gt;")).toBe(
      "<b onmouseover=alert(2)>Evil</b>",
    );
  });

  it("is bounded and total", () => {
    expect(metadataText(undefined)).toBe("");
    expect(metadataText(42)).toBe("");
    expect(metadataText("x".repeat(100_000)).length).toBe(20_000);
  });
});
