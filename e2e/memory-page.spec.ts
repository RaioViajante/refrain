import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { env } from "./support";

// The public memory page (M3.7) in a browser, anonymous, at 1440 px (project
// "memory-desktop") and at 390 px on a touch screen ("memory-390"), from the
// server of the production build that has public reads on. The memories are
// seeded here (src/testing/public-memories.ts) and removed afterwards: one
// with two songs (one on an album with a public journal, whose artist has a
// page; one whose artist has none), one with no songs, one with a long title,
// and memories in every state that must never be served. Every word is
// synthetic. Screenshots are written only with E2E_SCREENSHOTS=1, to
// visual-review/m3-7/ (ignored by Git).

const base = env("E2E_PUBLIC_URL");
const prefix = `em${Date.now().toString(36)}`;
const SHOTS = "visual-review/m3-7";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const execFileAsync = promisify(execFile);

interface Seeded {
  shown: { slug: string; previousSlug: string };
  quiet: { slug: string };
  long: { slug: string };
  albumJournal: { slug: string };
  hidden: { state: string; slug: string }[];
}

let seededJson = "";
let seeded: Seeded;

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

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) <= 720;

const overflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

/** Words of the title the browser broke across lines, in the middle. */
const brokenWords = (page: Page) =>
  page.locator("h1").evaluate((heading) => {
    const text = heading.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) {
      return ["(no text)"];
    }
    const content = text.textContent ?? "";
    const broken: string[] = [];
    for (const match of content.matchAll(/[^\s‐‑-]+/gu)) {
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

async function shot(page: Page, name: string, fullPage = true) {
  if (process.env.E2E_SCREENSHOTS !== "1") {
    return;
  }
  mkdirSync(SHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
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

async function open(page: Page, slug: string) {
  const response = await page.goto(`${base}/memories/${slug}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test.beforeAll(async () => {
  seededJson = await seed("memories", prefix);
  seeded = JSON.parse(seededJson) as Seeded;
});

test.afterAll(async () => {
  if (seededJson) {
    await seed("remove-memories", seededJson, prefix);
  }
});

test("shows the approved composition: the label, the title, the writing, and the margin with the music", async ({
  page,
}) => {
  await open(page, seeded.shown.slug);

  // The header: Home, and Memories as the current page (not a link).
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link")).toHaveCount(1);
  await expect(nav.getByText("Memories")).toHaveAttribute(
    "aria-current",
    "page",
  );

  const article = page.locator("article");
  await expect(article.getByText("Memory", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "[Test] The summer a song arrived",
  );
  await expect(article.locator(".pm-body p")).toHaveText([
    "[Test] The first paragraph of a synthetic memory.",
    "[Test] A second paragraph, so the column holds more than one.",
  ]);
  // The heading's typeface and size are the screen's: Kalam 700 at 58px
  // (42px on a phone).
  const style = await page.locator("h1").evaluate((heading) => {
    const computed = getComputedStyle(heading);
    return {
      family: computed.fontFamily,
      weight: computed.fontWeight,
      size: computed.fontSize,
    };
  });
  expect(style.family).toMatch(/Kalam/i);
  expect(style.weight).toBe("700");
  expect(style.size).toBe(isMobile(page) ? "42px" : "58px");
  const reading = await page
    .locator(".pm-body")
    .evaluate((body) => getComputedStyle(body).fontFamily);
  expect(reading).toMatch(/Alegreya Sans/i);

  const margin = page.getByRole("complementary", { name: "About this memory" });
  await expect(margin).toContainText("[Test] A summer, some years ago");
  await expect(margin).toContainText("Published October 28, 2026");
  await expect(margin).toContainText("Written in English");
  await expect(
    margin.getByRole("heading", { level: 2, name: "The music" }),
  ).toBeVisible();
  const songs = margin.getByRole("listitem");
  await expect(songs).toHaveCount(2);
  await expect(songs.nth(0)).toContainText("[Test] First Memory Song");
  await expect(songs.nth(0).locator(".pm-song-line")).toHaveText([
    "[Test] Memory Artist",
    "[Test] Memory Album",
  ]);
  await expect(songs.nth(1)).toContainText("[Test] Second Memory Song");
  await expect(songs.nth(1)).toContainText("[Test] Second Memory Artist");

  // Links only to pages that are public: the album journal, and the artist
  // who has a page. The second song's artist has none.
  await expect(margin.getByRole("link")).toHaveCount(2);
  await expect(
    margin.getByRole("link", { name: "[Test] Memory Album" }),
  ).toHaveAttribute("href", `/albums/${seeded.albumJournal.slug}`);
  await expect(
    margin.getByRole("link", { name: "[Test] Memory Artist" }),
  ).toHaveAttribute("href", "/artists/test-memory-artist");
  // No artwork, rating, or favourite in this milestone.
  await expect(page.locator("main img")).toHaveCount(0);

  // On a wide screen the margin sits left of the writing; on a phone the
  // writing comes first.
  const title = (await page.locator("h1").boundingBox())!;
  const facts = (await margin.boundingBox())!;
  if (isMobile(page)) {
    expect(facts.y).toBeGreaterThan(title.y);
    expect(Math.abs(facts.x - title.x)).toBeLessThan(2);
  } else {
    expect(facts.x + facts.width).toBeLessThan(title.x);
    expect(Math.abs(facts.y - title.y)).toBeLessThan(120);
  }
  await shot(page, "1-memory-several-songs");
});

test("follows a song's album to its journal, and its artist to their page", async ({
  page,
}) => {
  await open(page, seeded.shown.slug);
  await page
    .getByRole("complementary", { name: "About this memory" })
    .getByRole("link", { name: "[Test] Memory Album" })
    .click();
  await expect(page).toHaveURL(`${base}/albums/${seeded.albumJournal.slug}`);
  await open(page, seeded.shown.slug);
  await page
    .getByRole("complementary", { name: "About this memory" })
    .getByRole("link", { name: "[Test] Memory Artist" })
    .click();
  await expect(page).toHaveURL(`${base}/artists/test-memory-artist`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "[Test] Memory Artist",
  );
});

test("shows a memory with one song, and one with none", async ({ page }) => {
  await open(page, seeded.long.slug);
  await expect(page.locator(".pm-song")).toHaveCount(1);
  // A song with a long name wraps inside the margin, beside its frame.
  await expect(page.locator(".pm-song-title")).toContainText(
    "runs on for a long while",
  );
  await shot(page, "2-memory-one-song-long-title");
  await open(page, seeded.quiet.slug);
  await expect(page.getByText("The music")).toHaveCount(0);
  await expect(page.locator(".pm-song")).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "About this memory" }),
  ).toContainText("Written in English");
  await shot(page, "3-memory-no-music");
});

test("wraps a long title between words, without sideways scrolling, at every width", async ({
  page,
}) => {
  await open(page, seeded.long.slug);
  const mobile = isMobile(page);
  for (const width of [320, 360, 390, 721, 768, 1024, 1440, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflow(page), `${width}px`).toBeLessThanOrEqual(0);
    expect(await brokenWords(page), `${width}px`).toEqual([]);
    const heading = (await page.locator("h1").boundingBox())!;
    expect(heading.x + heading.width, `${width}px`).toBeLessThanOrEqual(width);
    for (const song of await page.locator(".pm-song").all()) {
      const box = (await song.boundingBox())!;
      expect(box.x + box.width, `${width}px song`).toBeLessThanOrEqual(width);
    }
  }
  await page.setViewportSize(
    mobile ? { width: 390, height: 844 } : { width: 768, height: 1024 },
  );
  if (!mobile) {
    await open(page, seeded.shown.slug);
    await shot(page, "4-memory-tablet");
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});

test("reads the same without JavaScript", async ({ browser }, info) => {
  const mobile = info.project.name === "memory-390";
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();
  const response = await page.goto(`${base}/memories/${seeded.shown.slug}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "[Test] The summer a song arrived",
  );
  await expect(page.locator(".pm-body p")).toHaveCount(2);
  await expect(page.locator(".pm-song")).toHaveCount(2);
  await expect(page.getByText("Written in English")).toBeVisible();
  await expect(page.getByText("some songs take you back.")).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.querySelectorAll('div[hidden][id^="S:"]').length,
    ),
  ).toBe(0);
  await shot(page, "5-javascript-disabled");
  await context.close();
});

test("passes axe, with keyboard operation, a visible focus ring, and 44px targets", async ({
  page,
}) => {
  await open(page, seeded.shown.slug);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  // The skip link first, then the main content takes focus.
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  // Then the song's links, in order.
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "[Test] Memory Artist" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "[Test] Memory Album" }),
  ).toBeFocused();

  for (const target of await page.locator(".pm-song-link").all()) {
    await target.focus();
    const outline = await target.evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.outlineStyle} ${style.outlineWidth}`;
    });
    expect(outline).toBe("solid 2px");
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
    expect(edges.height).toBeGreaterThanOrEqual(44);
    expect(edges.hits).toEqual(["itself", "itself"]);
  }

  // The heading structure: one h1, then The music.
  expect(
    await page
      .locator("h1, h2, h3")
      .evaluateAll((headings) => headings.map((heading) => heading.tagName)),
  ).toEqual(["H1", "H2"]);
  // The writing and the title carry their own language.
  await expect(page.locator(".pm-body")).toHaveAttribute("lang", "en");
  await expect(page.locator("h1")).toHaveAttribute("lang", "en");

  // With reduced motion nothing transitions.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const durations = await page
    .locator(".public-link")
    .evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).transitionDuration),
    );
  expect(durations.every((duration) => /^0s(, 0s)*$/.test(duration))).toBe(
    true,
  );
});

test("keeps the song frames, the links, and the footer rule visible in forced colors", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await open(page, seeded.shown.slug);
  const frame = await page
    .locator(".pm-song-art .ph-art-fallback")
    .first()
    .evaluate((element) => getComputedStyle(element).borderTopStyle);
  expect(frame).toBe("solid");
  const link = await page
    .locator(".pm-song-link")
    .first()
    .evaluate((element) => getComputedStyle(element).textDecorationLine);
  expect(link).toContain("underline");
  const footer = await page
    .locator(".public-footer")
    .evaluate((element) => getComputedStyle(element).borderTopStyle);
  expect(footer).toBe("solid");
});

test("does not shift its layout while it loads", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { shifts: number }).shifts = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      })[]) {
        if (!entry.hadRecentInput) {
          (window as unknown as { shifts: number }).shifts += entry.value;
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await open(page, seeded.shown.slug);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const shifts = await page.evaluate(
    () => (window as unknown as { shifts: number }).shifts,
  );
  expect(shifts).toBeLessThan(0.01);
});

test("redirects a previous address to the current one", async ({ page }) => {
  const response = await page.goto(
    `${base}/memories/${seeded.shown.previousSlug}`,
  );
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(`${base}/memories/${seeded.shown.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "[Test] The summer a song arrived",
  );
});

test("answers the shared not-found view for a memory that is not public, and for an unknown one", async ({
  page,
}) => {
  for (const slug of [
    ...seeded.hidden.map((hidden) => hidden.slug),
    `${prefix}-no-such-memory`,
  ]) {
    const response = await page.goto(`${base}/memories/${slug}`);
    expect(response?.status(), slug).toBe(404);
    await expect(
      page.getByRole("heading", { name: "Nothing here" }),
    ).toBeVisible();
    await expect(page.getByText("PRIVATE")).toHaveCount(0);
    await expect(page.getByText("Memory", { exact: true })).toHaveCount(0);
  }
  await shot(page, "6-memory-not-found", false);
});
