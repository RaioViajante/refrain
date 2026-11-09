import { execFile } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { promisify } from "node:util";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { env } from "./support";

// The public artist page (M3.5) in a browser, anonymous, at 1440 px and at
// 390 px, from the server of the production build that has public reads on.
// The artists are seeded here (src/testing/public-artists.ts) and removed
// afterwards: Jeff Buckley with two published albums and a synthetic
// photograph, a band with a very long name and no photograph, an artist whose
// thumbnail fails, and artists that must never have a page. No real
// photograph or cover is requested: Wikimedia's and the archive's addresses
// are answered here with synthetic images. Screenshots are written only with
// E2E_SCREENSHOTS=1, to visual-review/m3-5/ (ignored by Git).

const base = env("E2E_PUBLIC_URL");
const prefix = `ea${Date.now().toString(36)}`;
const SHOTS = "visual-review/m3-5";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
// A synthetic "photograph": shapes in color, so the only color on the page is
// the photograph's, as the design requires. Not a real image of anyone.
const TEST_PHOTO = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500"><rect width="400" height="500" fill="#3d5a80"/><circle cx="200" cy="190" r="80" fill="#e0c9a6"/><rect x="90" y="300" width="220" height="200" rx="90" fill="#ee6c4d"/></svg>`;
const TEST_COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500"><rect width="500" height="500" fill="#1d4e89"/><circle cx="250" cy="230" r="120" fill="#c8553d"/></svg>`;
const BROKEN_FILE = "Test_Ink_Quartet_with_attribution.jpg";
const HIDDEN_ADDRESS = "test-private-draft-only-artist-marker";
const execFileAsync = promisify(execFile);

interface Seeded {
  grace: { slug: string };
  sketches: { slug: string };
  long: { slug: string };
  broken: { slug: string };
}

let seededJson = "";
let seeded: Seeded;
const address = { grace: "", long: "", broken: "" };

test.describe.configure({ mode: "serial" });

async function seed(...args: string[]) {
  const { stdout } = await execFileAsync(
    "pnpm",
    [
      "--silent",
      "tsx",
      "--conditions=react-server",
      "src/testing/public-seed-cli.ts",
      ...args,
    ],
    { env: process.env },
  );
  return stdout.trim();
}

/** Answers every remote image with a synthetic one; the broken file fails. */
async function serveImages(page: Page, requested: string[] = []) {
  await page.route("https://thumb.wikimedia.org/**", (route) => {
    requested.push(route.request().url());
    return route.request().url().includes(BROKEN_FILE)
      ? route.fulfill({ status: 404, body: "Not Found" })
      : route.fulfill({
          status: 200,
          contentType: "image/svg+xml",
          body: TEST_PHOTO,
        });
  });
  await page.route("https://coverartarchive.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: TEST_COVER,
    }),
  );
  return requested;
}

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) <= 720;

/**
 * The words of the page's title that the browser split across lines: each
 * word's rectangles must share one top, or it was broken in the middle.
 */
const brokenWords = (page: Page) =>
  page.locator("h1").evaluate((heading) => {
    const text = heading.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) {
      return ["(no text)"];
    }
    const content = text.textContent ?? "";
    const broken: string[] = [];
    for (const match of content.matchAll(/[^\s\u2010\u2011-]+/gu)) {
      const range = document.createRange();
      range.setStart(text, match.index);
      range.setEnd(text, match.index + match[0].length);
      const tops = new Set(
        [...range.getClientRects()].map((rect) => Math.round(rect.top)),
      );
      if (tops.size > 1) {
        broken.push(match[0]);
      }
    }
    return broken;
  });

const titleSize = (page: Page) =>
  page.locator("h1").evaluate((heading) => getComputedStyle(heading).fontSize);

const overflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

async function shot(page: Page, name: string, fullPage = true) {
  if (process.env.E2E_SCREENSHOTS !== "1") {
    return;
  }
  mkdirSync(SHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const width = page.viewportSize()?.width ?? 0;
  await page.screenshot({
    path: `${SHOTS}/${name}-${width}.png`,
    fullPage,
    animations: "disabled",
  });
}

async function openArtist(
  page: Page,
  which: keyof typeof address,
  waitUntil: "load" | "domcontentloaded" = "load",
) {
  const response = await page.goto(`${base}/artists/${address[which]}`, {
    waitUntil,
  });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** The address an album journal's credit links to. */
async function creditAddress(page: Page, slug: string) {
  await page.goto(`${base}/albums/${slug}`);
  const link = page.locator(".pj-artist a").first();
  await expect(link).toBeVisible();
  return (await link.getAttribute("href"))!.replace("/artists/", "");
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  seededJson = await seed("artists", prefix);
  seeded = JSON.parse(seededJson) as Seeded;
  const page = await browser.newPage();
  address.grace = await creditAddress(page, seeded.grace.slug);
  address.long = await creditAddress(page, seeded.long.slug);
  address.broken = await creditAddress(page, seeded.broken.slug);
  await page.close();
});

test.afterAll(async () => {
  if (seededJson) {
    await seed("remove-artists", seededJson, prefix);
  }
});

test("shows the approved composition: the photograph, the name, and what is in the journal", async ({
  page,
}) => {
  const requested = await serveImages(page);
  await openArtist(page, "grace");

  // The header: the four sections (M3.8a), and Artists as the current
  // section, its link leading back to the Artists archive.
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link")).toHaveCount(4);
  await expect(nav.getByRole("link", { name: "Artists" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(nav.locator("[aria-current]")).toHaveCount(1);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Jeff Buckley",
  );
  await expect(page.getByText("Artist", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(
    "In this journal",
  );
  await expect(page.getByRole("heading", { level: 3 })).toHaveText([
    "Album journals",
    "Tracks I wrote about",
  ]);

  // The photograph fills its 4:5 frame, in color, under its credit.
  const frame = page.getByRole("img", { name: "Photograph of Jeff Buckley" });
  await expect(frame).toBeVisible();
  const box = (await frame.boundingBox())!;
  expect(Math.abs(box.width / box.height - 0.8)).toBeLessThan(0.01);
  await expect
    .poll(() =>
      page
        .locator(".pa-photo-image")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  expect(
    requested.every((url) => url.startsWith("https://thumb.wikimedia.org/")),
  ).toBe(true);
  await expect(page.locator(".pa-credit-by")).toHaveText(
    "Photo: [Test] Photographer One",
  );
  await expect(page.locator(".pa-credit-license")).toHaveText(
    "CC BY-SA 4.0 · via Wikimedia Commons",
  );
  await expect(
    page.getByRole("link", { name: "CC BY-SA 4.0" }).first(),
  ).toHaveAttribute("href", "https://creativecommons.org/licenses/by-sa/4.0/");

  // The details: opened with the keyboard, everything the license asks for.
  const summary = page.getByText("Photo details");
  await summary.focus();
  await page.keyboard.press("Enter");
  const details = page.locator(".pa-credit-details dl");
  await expect(details).toBeVisible();
  await expect(details).toContainText("Test Ink Quartet on stage.jpg");
  await expect(details).toContainText(
    "Resized, and cropped to fit the frame. No other changes.",
  );
  await expect(
    page.getByRole("link", { name: "Test Ink Quartet on stage.jpg" }),
  ).toHaveAttribute(
    "href",
    "https://commons.wikimedia.org/wiki/File:Test_Ink_Quartet_on_stage.jpg",
  );

  // Both album journals, linked; the tracks with public reflections only.
  await expect(page.locator(".pa-album")).toHaveCount(2);
  await expect(page.locator(".pa-album-title")).toHaveText([
    "Grace",
    "Sketches for My Sweetheart the Drunk",
  ]);
  await expect(page.locator(".pa-track-title")).toHaveText([
    "Mojo Pin",
    "Grace",
    "Last Goodbye",
    "Everybody Here Wants You",
  ]);
  await expect(page.locator(".pa-track-where").first()).toHaveText(
    "in Grace · 01",
  );
  await expect(page.getByText("Lilac Wine")).toHaveCount(0);

  await page.getByText("Photo details").click();
  await shot(page, "1-artist-with-photo");
});

test("leads from an album journal's credit to the artist, and back to the journal", async ({
  page,
}) => {
  await serveImages(page);
  await page.goto(`${base}/albums/${seeded.sketches.slug}`);
  // The album journal streams its content (issue #44): wait for it.
  await expect(page.locator(".pj-artist a")).toBeVisible();
  await expect(page.locator(".pj-artist")).toContainText(
    "Jeff Buckley, [Test] Archived Credit Artist",
  );
  // The archived artist has no page: plain text, no link. Only the linked
  // name carries the drawn underline, so the two read differently; the link
  // is a 44px target.
  const link = page.locator(".pj-artist a");
  await expect(link).toHaveCount(1);
  expect(
    await page
      .locator(".pj-artist")
      .evaluate((element) => getComputedStyle(element).backgroundImage),
  ).toBe("none");
  expect(
    await link.evaluate((element) => getComputedStyle(element).backgroundImage),
  ).not.toBe("none");
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await shot(page, "8-album-journal-links-to-artist", false);
  // The closing row names only the artist with a page, never the archived one.
  const closing = page.getByRole("navigation", { name: "Keep reading" });
  await expect(closing.getByRole("link", { name: /^More about/ })).toHaveText([
    "More about Jeff Buckley",
  ]);
  await page.locator(".pj-artist a").click();
  await expect(page).toHaveURL(`${base}/artists/${address.grace}`);
  await expect(
    page
      .getByRole("navigation", { name: "Keep reading" })
      .getByRole("link", { name: "All artists" }),
  ).toHaveAttribute("href", "/artists");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Jeff Buckley",
  );
  await page
    .locator(".pa-album", { hasText: "Sketches for My Sweetheart" })
    .click();
  await expect(page).toHaveURL(`${base}/albums/${seeded.sketches.slug}`);
});

test("shows the empty frame and the whole name for a band without a photograph", async ({
  page,
}) => {
  const requested = await serveImages(page);
  await openArtist(page, "long");
  await expect(
    page.getByRole("img", {
      name: /^No photograph of \[Test\] The Extraordinarily/,
    }),
  ).toBeVisible();
  await expect(page.locator(".pa-photo")).toContainText("not available yet");
  await expect(page.locator(".pa-credit")).toHaveCount(0);
  await expect(page.locator(".pa-photo-image")).toHaveCount(0);
  expect(requested).toEqual([]);
  const mobile = isMobile(page);
  // The name wraps inside its column, at every width, between words: no
  // ordinary word is broken in the middle (the owner's visual review).
  for (const width of [320, 360, 390, 721, 768, 1024, 1440, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflow(page), `${width}px`).toBeLessThanOrEqual(0);
    expect(await brokenWords(page), `${width}px`).toEqual([]);
    const title = (await page
      .getByRole("heading", { level: 1 })
      .boundingBox())!;
    expect(title.x + title.width, `${width}px`).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize(
    mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  );
  await shot(page, "3-6-artist-without-photo-long-name");
});

test("shows the fallback, and no broken image, when the thumbnail cannot be loaded", async ({
  page,
}) => {
  const requested = await serveImages(page);
  await openArtist(page, "broken");
  await expect.poll(() => requested.length).toBeGreaterThan(0);
  const frame = page.getByRole("img", {
    name: "Photograph of [Test] Broken Thumbnail Trio: not available just now",
  });
  await expect(frame).toBeVisible();
  await expect(page.locator(".pa-photo-image")).toHaveCount(0);
  await expect(page.locator(".pa-photo")).toContainText(
    "not available just now",
  );
  // The attribution of the chosen photograph stays, as the record of it.
  await expect(page.locator(".pa-credit-line")).toContainText(
    "[Test] Photographer Two",
  );
  await shot(page, "7-missing-thumbnail");
});

test("reads the same without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await serveImages(page);
  const response = await page.goto(`${base}/artists/${address.grace}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Jeff Buckley",
  );
  await expect(page.locator(".pa-photo-image")).toBeVisible();
  await expect(page.locator(".pa-album")).toHaveCount(2);
  await expect(page.locator(".pa-track")).toHaveCount(4);
  await expect(page.getByText("some songs take you back.")).toBeVisible();
  // The details still open, natively.
  await page.getByText("Photo details").click();
  await expect(page.locator(".pa-credit-details dl")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.querySelectorAll('div[hidden][id^="S:"]').length,
    ),
  ).toBe(0);
  await shot(page, "9-javascript-disabled");
  await context.close();
});

test("passes axe, with keyboard operation, a visible focus ring, and 44px targets", async ({
  page,
}) => {
  await serveImages(page);
  await openArtist(page, "grace");
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);

  // The skip link first, then the header, then the credit's links.
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();

  for (const target of [
    page.locator(".pa-album").first(),
    page.locator(".pa-track").first(),
    page.locator(".pa-credit-details summary"),
  ]) {
    await target.focus();
    const outline = await target.evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.outlineStyle} ${style.outlineWidth}`;
    });
    expect(outline).toBe("solid 2px");
    expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }

  // Without JavaScript-dependent behavior, no motion is needed; with reduced
  // motion nothing transitions.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const durations = await page
    .locator(".public-link, .pa-album, .pa-track")
    .evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).transitionDuration),
    );
  expect(durations.every((duration) => /^0s(, 0s)*$/.test(duration))).toBe(
    true,
  );

  // Every link of the credit, the summary included, owns a 44px target
  // where it is: at the top and the bottom of its box, the element there is
  // the link itself, never a neighbour drawn over it.
  await page.getByText("Photo details").click();
  const credit = page.locator(".pa-credit a, .pa-credit summary");
  expect(await credit.count()).toBe(4);
  for (const target of await credit.all()) {
    const label = (await target.textContent()) ?? "";
    // In the middle of the viewport, where every edge can be hit.
    const edges = await target.evaluate((element) => {
      element.scrollIntoView({ block: "center" });
      const rect = element.getBoundingClientRect();
      const x = rect.left + Math.min(rect.width / 2, 8);
      return {
        height: rect.height,
        hits: [rect.top + 2, rect.bottom - 2].map((y) => {
          const found = document.elementFromPoint(x, y);
          return found !== null &&
            (found === element || element.contains(found))
            ? "itself"
            : `${found?.tagName}.${found?.className}`;
        }),
      };
    });
    expect(edges.height, label).toBeGreaterThanOrEqual(44);
    expect(edges.hits, label).toEqual(["itself", "itself"]);
  }
  await page.getByText("Photo details").click();
});

test("keeps the frame and its rules visible in forced colors", async ({
  page,
}) => {
  await serveImages(page);
  await page.emulateMedia({ forcedColors: "active" });
  await openArtist(page, "long");
  const border = await page
    .locator(".pa-photo")
    .evaluate((element) => getComputedStyle(element).borderTopStyle);
  expect(border).toBe("solid");
  const rule = await page
    .locator(".pa-tracks, .pa-albums")
    .first()
    .evaluate((element) => getComputedStyle(element).display);
  expect(rule).not.toBe("none");
});

test("is laid out without sideways scrolling, and the photograph keeps its size while it loads", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("https://thumb.wikimedia.org/**", async (route) => {
    await held;
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: TEST_PHOTO,
    });
  });
  await page.route("https://coverartarchive.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: TEST_COVER,
    }),
  );
  // The image is held back, so the page's load event waits for it.
  await openArtist(page, "grace", "domcontentloaded");
  const frame = page.locator(".pa-photo");
  const before = await frame.boundingBox();
  const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
  release();
  await expect
    .poll(() =>
      page
        .locator(".pa-photo-image")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  expect(await frame.boundingBox()).toEqual(before);
  expect(await page.getByRole("heading", { level: 1 }).boundingBox()).toEqual(
    heading,
  );

  const mobile = isMobile(page);
  for (const width of [320, 390, 721, 768, 1024, 1440, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflow(page), `${width}px`).toBeLessThanOrEqual(0);
    // A name of ordinary length keeps the approved sizes exactly, except
    // in the narrowest two-column layout, where 104px would break "Buckley"
    // in the middle: there it is set a little smaller instead.
    if (width === 721) {
      const size = parseFloat(await titleSize(page));
      expect(size).toBeLessThan(104);
      expect(size).toBeGreaterThan(90);
    } else {
      expect(await titleSize(page), `${width}px`).toBe(
        width <= 370 ? "54px" : width <= 720 ? "62px" : "104px",
      );
    }
    expect(await brokenWords(page), `${width}px`).toEqual([]);
  }
  if (!mobile) {
    await page.setViewportSize({ width: 768, height: 1024 });
    await shot(page, "tablet-artist-with-photo");
    await page.setViewportSize({ width: 1440, height: 900 });
    // At 1440 px the photograph sits left and the name right, as on the screen.
    const photo = (await frame.boundingBox())!;
    const title = (await page
      .getByRole("heading", { level: 1 })
      .boundingBox())!;
    expect(photo.x + photo.width).toBeLessThan(title.x);
  }
});

test("answers the not-found view for an artist with no public writing", async ({
  page,
}) => {
  const response = await page.goto(`${base}/artists/${HIDDEN_ADDRESS}`);
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Nothing here" }),
  ).toBeVisible();
  await expect(page.getByText("PRIVATE")).toHaveCount(0);
  await shot(page, "5-artist-without-public-journals", false);
});

test("composes the comparison sheet with the Home and the album journal", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_SCREENSHOTS !== "1" || isMobile(page),
    "only when writing screenshots, once",
  );
  await serveImages(page);
  const captures: [string, string][] = [];
  for (const [label, path] of [
    ["Home (M3.4)", "/"],
    ["Album journal (M3.1)", `/albums/${seeded.grace.slug}`],
    ["Artist (M3.5)", `/artists/${address.grace}`],
  ] as const) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto(`${base}${path}`);
      await expect(page.locator("footer")).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.querySelectorAll('div[hidden][id^="S:"]').length,
          ),
        )
        .toBe(0);
      const file = `${SHOTS}/sheet-${captures.length}.png`;
      await page.screenshot({ path: file, animations: "disabled" });
      captures.push([
        `${label}, ${width}px`,
        readFileSync(file).toString("base64"),
      ]);
    }
  }
  await page.setViewportSize({ width: 2400, height: 1200 });
  await page.setContent(`<!doctype html><html><body style="margin:24px;font:16px system-ui;background:#fff;color:#111">
    <h1 style="font-size:20px">Refrain M3.5: the artist page beside the approved Home and album journal (synthetic data)</h1>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;align-items:start">
    ${[0, 1, 2]
      .map(
        (column) =>
          `<div>${[0, 1]
            .map((row) => {
              const [label, data] = captures[column * 2 + row]!;
              return `<figure style="margin:0 0 24px"><figcaption style="margin-bottom:8px">${label}</figcaption><img style="width:${row === 0 ? "100%" : "40%"};border:1px solid #ccc" src="data:image/png;base64,${data}"></figure>`;
            })
            .join("")}</div>`,
      )
      .join("")}
    </div></body></html>`);
  await page.screenshot({
    path: `${SHOTS}/comparison-sheet.png`,
    fullPage: true,
  });
});
