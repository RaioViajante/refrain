import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { env } from "./support";

// The public Home (M3.4) in a browser, anonymous, at 1440 px and at 390 px.
// Populated: the second server of the same production build, with public
// reads on, which holds the synthetic Grace journal, a draft, and the Home's
// shelf (Pink Moon, Twin Fantasy, Cleopatra), whose writing is "[Test]".
// Switched off: the studio's own server, whose switch stays off as a default
// deployment's does, and which reads the same database. No real artwork is
// requested: covers are answered here with a synthetic image. Screenshots are
// written only with E2E_SCREENSHOTS=1, to visual-review/m3-4/ (ignored).

const base = env("E2E_PUBLIC_URL");
const offBase = env("E2E_BASE_URL");
const graceSlug = env("E2E_PUBLIC_SLUG");
const graceId = env("E2E_PUBLIC_ENTRY_ID");
const draftSlug = env("E2E_PUBLIC_DRAFT_SLUG");
const shelf = JSON.parse(env("E2E_PUBLIC_SHELF")) as {
  slug: string;
  entryId: string;
}[];
const twinFantasy = shelf.find((journal) =>
  journal.slug.endsWith("-twin-fantasy"),
)!;

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const INTRODUCTION =
  "A personal music journal about albums, songs, and the memories attached to them.";
const CHARACTER_ALT =
  "Ink drawing of a person with curly hair and headphones, sitting cross-legged on the floor and writing in a notebook while looking up, next to a stack of records, a mug, a cassette and a few crumpled pages.";
const COVER = `https://coverartarchive.org/release/3f8c4f8e-0000-4000-8000-000000000001/1000000001`;
const TEST_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500"><rect width="500" height="500" fill="#1d4e89"/><circle cx="250" cy="230" r="120" fill="#c8553d"/></svg>`;
const SHOTS = "visual-review/m3-4";
const execFileAsync = promisify(execFile);

test.describe.configure({ mode: "serial" });

async function seed(...args: string[]) {
  await execFileAsync(
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
}

async function serveTestCovers(page: Page) {
  await page.route("https://coverartarchive.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: TEST_IMAGE,
    }),
  );
}

async function openHome(page: Page, from = base) {
  const response = await page.goto(`${from}/`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("img", { name: CHARACTER_ALT })).toBeVisible();
  await expect(page.getByText(INTRODUCTION)).toBeVisible();
  await expect(page.locator(".ph-since")).toBeVisible();
  await streamed(page);
}

/**
 * Waits until React has revealed every streamed part of the page. Each
 * Suspense boundary arrives hidden (`<div hidden id="S:n">`, at the end of
 * the body) and is revealed on its own, a little later: reading the page
 * before then finds the lists outside the page's frame, unstyled, or not yet
 * in it.
 */
async function streamed(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelectorAll('template[id^="B:"], div[hidden][id^="S:"]')
            .length,
      ),
    )
    .toBe(0);
}

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) <= 720;

const overflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

const addresses = (page: Page) =>
  page
    .locator("main a[href^='/albums/']")
    .evaluateAll((links) => [
      ...new Set(links.map((link) => link.getAttribute("href")!)),
    ]);

test("shows the approved composition, with only what exists", async ({
  page,
}) => {
  await openHome(page);

  // The header: navigation only, the four sections (M3.8a), and Home is the
  // current page.
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link")).toHaveText([
    "Home",
    "Albums",
    "Artists",
    "Memories",
  ]);
  await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.locator("[aria-current]")).toHaveCount(1);
  await expect(
    page.locator(".public-header img, .public-header svg"),
  ).toHaveCount(0);

  // The headings: the site's name for screen readers, then the sections.
  // The shelf's artists have pages, so the Artists section is shown (M3.8b);
  // no memory is published here, so there is no Memories section.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("refrain");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Recently written",
    "Albums",
    "Artists",
  ]);

  // The newest journal, then the lists, linked to the journals' addresses.
  // Another test may publish Grace again, which dates it today: the line
  // names whichever journal is first in "Recently written", with its date.
  const firstRow = page.locator(".ph-row").first();
  const newest = await firstRow.locator(".ph-row-title").textContent();
  const newestDate = await firstRow.locator("time").textContent();
  await expect(page.locator(".ph-since")).toHaveText(
    `Most recent: ${newest} · Album journal · ${newestDate}`,
  );
  expect(newestDate).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  const listed = await addresses(page);
  for (const slug of [graceSlug, ...shelf.map((journal) => journal.slug)]) {
    expect(listed).toContain(`/albums/${slug}`);
  }
  expect(listed).not.toContain(`/albums/${draftSlug}`);
  await expect(page.getByText("[Test] Draft album")).toHaveCount(0);
  await expect(page.getByText("PRIVATE-")).toHaveCount(0);

  const grace = page.locator(`.ph-row[href="/albums/${graceSlug}"]`);
  await expect(grace.locator("time")).toHaveAttribute("datetime", /^2026-/);
  await expect(grace).toContainText("Grace");
  await expect(grace).toContainText("Album journal · Jeff Buckley");
  const graceCard = page.locator(`.ph-album[href="/albums/${graceSlug}"]`);
  await expect(graceCard).toContainText("Jeff Buckley · 1994");
  await expect(
    graceCard.getByRole("img", { name: "My rating: 4.5 out of 5" }),
  ).toBeVisible();
  await expect(page.locator(".ph-albums > li")).toHaveCount(4);

  // M3.8b: each shown section links to its archive; with no public memory
  // there is no Memories section and no "All memories". No language selector,
  // and no link to the studio.
  const main = page.locator("main");
  await expect(
    main.getByRole("link", { name: "All album journals" }),
  ).toHaveAttribute("href", "/albums");
  await expect(main.getByRole("link", { name: "All artists" })).toHaveAttribute(
    "href",
    "/artists",
  );
  await expect(main.getByRole("link", { name: "All memories" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /studio|sign in|edit/i }),
  ).toHaveCount(0);
  await expect(page.locator(".public-closing")).toHaveText(
    "some songs take you back.",
  );
});

test("uses the approved typefaces and sizes", async ({ page }) => {
  await openHome(page);
  const mobile = isMobile(page);
  const style = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => {
        const css = getComputedStyle(element);
        return {
          family: css.fontFamily,
          size: css.fontSize,
          weight: css.fontWeight,
        };
      });
  const heading = await style(".ph-margin h2");
  expect(heading.family).toContain("Kalam");
  expect([heading.size, heading.weight]).toEqual(["27px", "700"]);
  const intro = await style(".ph-intro");
  expect(intro.family).toContain("Alegreya");
  expect(intro.size).toBe(mobile ? "20.5px" : "23px");
  const row = await style(".ph-row-title");
  expect(row.family).toContain("Kalam");
  expect(row.size).toBe("22px");
  const album = await style(".ph-album-title");
  expect(album.size).toBe(mobile ? "20px" : "22px");
  const width = await page
    .locator(".ph-character")
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBe(mobile ? 300 : 380);

  const strays = await page.evaluate(() => {
    const found: string[] = [];
    for (const element of document.querySelectorAll("body *")) {
      const rect = element.getBoundingClientRect();
      const family = getComputedStyle(element).fontFamily.split(",")[0]!.trim();
      if (rect.width > 0 && rect.height > 0 && !/Kalam|Alegreya/.test(family)) {
        found.push(`${element.tagName}.${element.className}: ${family}`);
      }
    }
    return found;
  });
  expect(strays).toEqual([]);
});

test("composes the notebook at every width without scrolling sideways", async ({
  page,
}) => {
  await openHome(page);
  // 640px is also 200% browser zoom of a 1280px window: the page's sizes are
  // in px, so zoom is what enlarges its text, and it lays the page out at
  // half the window's width (WCAG 1.4.4 and 1.4.10).
  for (const width of [
    320, 390, 640, 768, 960, 961, 1024, 1100, 1101, 1280, 1440, 2560,
  ]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflow(page), `${width}px`).toBeLessThanOrEqual(0);
    const layout = await page.evaluate(() => {
      const box = (selector: string) =>
        document.querySelector(selector)!.getBoundingClientRect();
      const shell = box("main");
      const character = box(".ph-character");
      const heading = box(".ph-recent h2");
      const rows = box(".ph-rows");
      const columns = getComputedStyle(
        document.querySelector(".ph-albums")!,
      ).gridTemplateColumns.split(" ").length;
      // Nothing in a card or a row reaches past its own box (a rating that
      // ran into the next album at 768px once did).
      const spilled: string[] = [];
      for (const card of document.querySelectorAll(
        ".ph-album, .ph-row, .ph-artist",
      )) {
        const edge = card.getBoundingClientRect();
        for (const part of card.querySelectorAll("*")) {
          const r = part.getBoundingClientRect();
          if (
            r.width > 0 &&
            (r.right > edge.right + 0.5 || r.left < edge.left - 0.5)
          ) {
            spilled.push(`${part.tagName}.${part.getAttribute("class")}`);
          }
        }
      }
      return {
        shellWidth: shell.width,
        shellLeft: shell.left,
        characterCenter: character.left + character.width / 2,
        headingBesideRows: heading.right <= rows.left,
        headingAboveRows: heading.bottom <= rows.top,
        columns,
        spilled,
      };
    });
    // The RaioViajante lateral contract: 17.6px each side, at most 1320px.
    expect(layout.shellWidth).toBeCloseTo(Math.min(width - 35.2, 1320), 0);
    expect(layout.characterCenter).toBeCloseTo(width / 2, 0);
    expect(layout.spilled, `${width}px`).toEqual([]);
    if (width > 720) {
      expect(layout.headingBesideRows, `${width}px`).toBe(true);
    } else {
      expect(layout.headingAboveRows, `${width}px`).toBe(true);
    }
    // Four albums to a row on a wide screen, three from 961px to 1100px,
    // two below.
    expect(layout.columns, `${width}px`).toBe(
      width > 1100 ? 4 : width > 960 ? 3 : 2,
    );
  }
});

test("keeps the newest journal's link a 44px target that never widens the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openHome(page);
  const link = page.locator(".ph-since-link");
  // A title that is one very long word, then one that is a single letter.
  await link.evaluate((el) => {
    el.textContent = "Supercalifragilisticexpialidociouslylongalbumtitle";
  });
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  const long = (await link.boundingBox())!;
  expect(long.x + long.width).toBeLessThanOrEqual(320);
  await link.evaluate((el) => {
    el.textContent = "x";
  });
  const short = (await link.boundingBox())!;
  expect(short.width).toBeGreaterThanOrEqual(43.5);
  expect(short.height).toBeGreaterThanOrEqual(43.5);
});

test("is black ink on white paper, and every control is at least 44px", async ({
  page,
}) => {
  await openHome(page);
  const colored = await page.evaluate(() => {
    const isGray = (value: string) => {
      const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(
        value,
      );
      if (!match) return true;
      if (match[4] !== undefined && Number(match[4]) === 0) return true;
      const channels = [match[1], match[2], match[3]].map(Number);
      return Math.max(...channels) - Math.min(...channels) <= 3;
    };
    const found: string[] = [];
    for (const element of document.querySelectorAll("body, body *")) {
      const css = getComputedStyle(element);
      for (const property of [
        "color",
        "backgroundColor",
        "borderTopColor",
        "outlineColor",
        "textDecorationColor",
      ] as const) {
        if (!isGray(css[property])) {
          found.push(`${element.tagName}.${element.className} ${property}`);
        }
      }
    }
    return found;
  });
  expect(colored).toEqual([]);

  const small = await page.evaluate(() => {
    const found: string[] = [];
    for (const element of document.querySelectorAll("a, button, summary")) {
      const rect = element.getBoundingClientRect();
      if (rect.height < 43.5 || rect.width < 43.5) {
        found.push(
          `${element.tagName}.${element.className} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        );
      }
    }
    return found;
  });
  expect(small).toEqual([]);
});

test("the character is the production copy, loaded whole, with its transparency, and reserves its space", async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/artwork/refrain-home-character.webp", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  const intro = page.getByText(INTRODUCTION);
  await expect(intro).toBeVisible();
  const before = (await intro.boundingBox())!.y;
  const art = page.getByRole("img", { name: CHARACTER_ALT });
  expect(await art.evaluate((el) => (el as HTMLImageElement).complete)).toBe(
    false,
  );
  release();
  await expect
    .poll(() => art.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBe(1536);
  // Nothing below the drawing moved when it arrived.
  expect((await intro.boundingBox())!.y).toBe(before);

  const loaded = await art.evaluate((el) => {
    const image = el as HTMLImageElement;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const at = (x: number, y: number) => data[(y * width + x) * 4 + 3]!;
    let clear = 0;
    let sampled = 0;
    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 4) {
        sampled += 1;
        if (at(x, y) === 0) clear += 1;
      }
    }
    return {
      src: new URL(image.currentSrc).pathname,
      size: [image.naturalWidth, image.naturalHeight],
      corners: [
        at(0, 0),
        at(width - 1, 0),
        at(0, height - 1),
        at(width - 1, height - 1),
      ],
      clear: clear / sampled,
    };
  });
  expect(loaded.src).toBe("/artwork/refrain-home-character.webp");
  expect(loaded.size).toEqual([1536, 1024]);
  expect(loaded.corners).toEqual([0, 0, 0, 0]);
  // About two thirds of the picture is clear paper (68.5% of the original).
  expect(loaded.clear).toBeGreaterThan(0.6);
  expect(loaded.clear).toBeLessThan(0.75);
});

test("loads nothing from another origin but the covers, and logs no error", async ({
  page,
}) => {
  const hosts = new Set<string>();
  const errors: string[] = [];
  page.on("request", (request) => hosts.add(new URL(request.url()).host));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await openHome(page);
  await page.waitForLoadState("networkidle");
  expect([...hosts]).toEqual([new URL(base).host]);
  expect(errors).toEqual([]);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("refrain");
});

test("shows a chosen cover in its frame, with nothing moving, and the fallback when it fails", async ({
  page,
}) => {
  await seed("cover", twinFantasy.entryId, COVER);
  try {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("https://coverartarchive.org/**", async (route) => {
      await held;
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: TEST_IMAGE,
      });
    });
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await streamed(page);
    const card = page.locator(`.ph-album[href="/albums/${twinFantasy.slug}"]`);
    const title = card.locator(".ph-album-title");
    await expect(title).toHaveText("Twin Fantasy");
    const before = await title.boundingBox();
    expect(before).not.toBeNull();
    release();
    const image = card.locator(".ph-art-image");
    await expect
      .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    expect(await title.boundingBox()).toEqual(before);
    // The cover is the frame's size, never the reason for a shift.
    const [frame, picture] = await Promise.all([
      card.locator(".ph-cover").boundingBox(),
      image.boundingBox(),
    ]);
    expect(picture).toEqual(frame);
    // Decorative inside a link named by the album: no extra name.
    await expect(image).toHaveAttribute("alt", "");
    await expect(image).toHaveAttribute("referrerpolicy", "no-referrer");

    // Refused: the fallback stays, and nothing moves.
    await page.unrouteAll();
    await page.route("https://coverartarchive.org/**", (route) =>
      route.abort(),
    );
    await page.reload();
    await streamed(page);
    await expect(card.locator(".ph-art-words")).toBeVisible();
    await expect(card.locator(".ph-art-words")).toHaveText("no artwork yet");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  } finally {
    await seed("cover", twinFantasy.entryId, "none");
  }
});

// Nothing painted may move as the page loads (a streamed first version
// pushed its footer down by 0.08 at 1440 px). The Home is now sent complete,
// so there is nothing to arrive late; this measures it.
test("does not move as it loads", async ({ page }) => {
  await serveTestCovers(page);
  await page.addInitScript(() => {
    const record = { total: 0, entries: [] as string[] };
    (window as unknown as { __shifts: typeof record }).__shifts = record;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
        sources?: { node?: Node | null }[];
      })[]) {
        if (!entry.hadRecentInput) {
          record.total += entry.value;
          record.entries.push(
            `${entry.value.toFixed(4)} ${(entry.sources ?? [])
              .map((source) => (source.node as Element | null)?.className)
              .join(",")}`,
          );
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await openHome(page);
  await page.waitForLoadState("networkidle");
  const shifts = await page.evaluate(
    () =>
      (window as unknown as { __shifts: { total: number; entries: string[] } })
        .__shifts,
  );
  // A web font replacing its fallback can nudge a line by a fraction of a
  // pixel (a score that rounds to 0.0000); anything a reader could see is
  // far above this.
  expect(shifts.total, shifts.entries.join("; ")).toBeLessThan(0.001);
});

// Without JavaScript (M3.4 owner review): the Home is rendered on the server
// in one pass, so its lists, their links, and the footer are in the HTML a
// reader receives, with public reads on; with them off, the empty Home. No
// part of the page waits hidden for a script to reveal it.
async function withoutJavaScript<Result>(
  browser: Browser,
  work: (page: Page) => Promise<Result>,
): Promise<Result> {
  const { viewport, isMobile, hasTouch, deviceScaleFactor } =
    test.info().project.use;
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport,
    isMobile,
    hasTouch,
    deviceScaleFactor,
  });
  try {
    const page = await context.newPage();
    await serveTestCovers(page);
    return await work(page);
  } finally {
    await context.close();
  }
}

test("works without JavaScript: the lists, their links, and the footer", async ({
  browser,
}) => {
  await withoutJavaScript(browser, async (page) => {
    const response = await page.goto(`${base}/`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("img", { name: CHARACTER_ALT })).toBeVisible();
    await expect(page.locator(".ph-since")).toBeVisible();
    await expect(page.locator(".ph-since")).toContainText("Most recent:");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Recently written",
      "Albums",
      "Artists",
    ]);
    for (const heading of await page.getByRole("heading", { level: 2 }).all()) {
      await expect(heading).toBeVisible();
    }
    const rows = page.locator(".public .ph-row");
    expect(await rows.count()).toBeGreaterThanOrEqual(4);
    await expect(rows.first()).toBeVisible();
    for (const slug of [graceSlug, ...shelf.map((journal) => journal.slug)]) {
      await expect(
        page.locator(`.public .ph-row[href="/albums/${slug}"]`),
      ).toBeVisible();
    }
    await expect(page.locator(".public .ph-album").first()).toBeVisible();
    await expect(page.locator(".public-footer")).toBeVisible();
    await expect(page.locator(".public-closing")).toHaveText(
      "some songs take you back.",
    );
    // Nothing is left hidden for a script to reveal.
    await expect(page.locator("div[hidden][id^='S:']")).toHaveCount(0);
    await expect(page.getByText("[Test] Draft album")).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // A link is an ordinary link: following it loads the journal's address.
    await page.locator(`.ph-row[href="/albums/${graceSlug}"]`).click();
    await expect(page).toHaveURL(`${base}/albums/${graceSlug}`);
    if (process.env.E2E_SCREENSHOTS === "1") {
      await page.goto(`${base}/`);
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({
        path: `${SHOTS}/home-no-js-${page.viewportSize()!.width}.png`,
        fullPage: true,
      });
    }
  });
});

test("works without JavaScript with public reads off: the empty Home and its footer", async ({
  browser,
}) => {
  await withoutJavaScript(browser, async (page) => {
    const response = await page.goto(`${offBase}/`);
    expect(response?.status()).toBe(200);
    await expect(page.locator(".ph-since")).toBeVisible();
    await expect(page.locator(".ph-since")).toHaveText(
      "Nothing published yet.",
    );
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
    expect(await addresses(page)).toEqual([]);
    await expect(page.locator(".public-footer")).toBeVisible();
    await expect(page.locator("div[hidden][id^='S:']")).toHaveCount(0);
    if (process.env.E2E_SCREENSHOTS === "1") {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({
        path: `${SHOTS}/home-no-js-reads-off-${page.viewportSize()!.width}.png`,
        fullPage: true,
      });
    }
  });
});

test("the shared header and footer render without JavaScript on the album journal and the not-found view", async ({
  browser,
}) => {
  await withoutJavaScript(browser, async (page) => {
    await page.goto(`${base}/albums/${graceSlug}`);
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", {
        name: "Home",
      }),
    ).toBeVisible();
    await expect(page.locator(".public-footer")).toBeVisible();
    // Recorded for the evidence: the album journal (M3.1) still streams its
    // content after a shell, which needs a script to reveal it; without one,
    // the shell's <main> shows and the journal's stays in hidden markup.
    const mains = await page
      .locator("main")
      .evaluateAll((elements) =>
        elements.map(
          (element) =>
            `${element.closest("[hidden]") ? "hidden" : "shown"}: ${(element as HTMLElement).innerText.trim().slice(0, 40)}`,
        ),
      );
    console.log(`album journal without JavaScript: ${JSON.stringify(mains)}`);
    const notFound = await page.goto(`${base}/albums/e2e-no-such-journal`);
    expect(notFound?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Nothing here",
    );
    await expect(
      page.getByRole("link", { name: "Back to the start" }),
    ).toBeVisible();
    await expect(page.locator(".public-footer")).toBeVisible();
  });
});

test("has no accessibility violations (WCAG 2.2 A and AA)", async ({
  page,
}) => {
  await serveTestCovers(page);
  await openHome(page);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test("the skip link is the first tab stop, and the keyboard reaches every journal with a visible ring", async ({
  page,
}) => {
  await openHome(page);
  const skip = page.getByRole("link", { name: "Skip to content" });
  expect((await skip.boundingBox())!.y + 44).toBeLessThanOrEqual(0);
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  expect((await skip.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  const mainTop = await page
    .locator("main")
    .evaluate((el) => el.getBoundingClientRect().top);
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id))
    .toBe("main");
  expect(
    await page.locator("main").evaluate((el) => el.getBoundingClientRect().top),
  ).toBeGreaterThanOrEqual(Math.min(mainTop, 0));

  // From the content, Tab visits the newest journal, then every row and
  // card, each with the 2px ink ring.
  const visited: string[] = [];
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || !element.closest("main")) return null;
      const css = getComputedStyle(element);
      return {
        href: element.getAttribute("href"),
        ring: `${css.outlineStyle} ${css.outlineWidth} ${css.outlineColor}`,
      };
    });
    if (!focused) break;
    expect(focused.ring, focused.href ?? "").toBe("solid 2px rgb(17, 17, 17)");
    visited.push(focused.href!);
  }
  expect(visited[0]).toBe(
    await page.locator(".ph-row").first().getAttribute("href"),
  );
  expect(visited.length).toBeGreaterThanOrEqual(1 + 5 + 4 - 1);
  // Journals, the archives' "All …" links (M3.8b), and artists' pages.
  for (const address of visited) {
    expect(address).toMatch(/^\/(albums|artists)(\/|$)/);
  }
});

// The first public links into `/albums/*` (docs/evidence/m3-1.md left the
// client router's reuse of a page to the milestone that adds them). A change
// is seen on the next navigation; a stale link leads to the not-found view;
// going back may show again what this reader was already sent, which is
// recorded, not hidden.
test("a change is seen on the next navigation, and a stale link leads nowhere", async ({
  page,
}) => {
  const pinkMoon = shelf.find((journal) =>
    journal.slug.endsWith("-pink-moon"),
  )!;
  const address = `/albums/${pinkMoon.slug}`;
  const heading = page.getByRole("heading", { level: 1 });
  await openHome(page);
  await page.locator(`.ph-row[href="${address}"]`).click();
  await expect(heading).toHaveText("Pink Moon");
  await seed("unpublish", pinkMoon.entryId);
  try {
    // A push navigation to the Home reads the lists again.
    await page.getByRole("link", { name: "Home" }).click();
    await expect(page).toHaveURL(`${base}/`);
    await streamed(page);
    expect(await addresses(page)).not.toContain(address);

    // Back: the browser shows this reader the journal page they were sent
    // before. Recorded for the evidence; a reload asks the server again.
    await page.goBack();
    await expect(page).toHaveURL(`${base}${address}`);
    console.log(
      `back after unpublishing (${page.viewportSize()!.width}px): "${await heading.textContent()}"`,
    );
    await page.reload();
    await expect(heading).toHaveText("Nothing here");

    // A Home loaded before the change still lists it; following that stale
    // link shows the not-found view, never the journal.
    await seed("publish", pinkMoon.entryId, seededDate(pinkMoon.slug));
    await openHome(page);
    await expect(page.locator(`.ph-row[href="${address}"]`)).toHaveCount(1);
    await seed("unpublish", pinkMoon.entryId);
    await page.locator(`.ph-row[href="${address}"]`).click();
    await expect(heading).toHaveText("Nothing here");
    await expect(page.getByText("[Test] A synthetic journal")).toHaveCount(0);
  } finally {
    await seed("publish", pinkMoon.entryId, seededDate(pinkMoon.slug));
  }
});

test("opens a journal from the Home, and comes back", async ({ page }) => {
  await openHome(page);
  await page.locator(`.ph-row[href="/albums/${graceSlug}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/albums/${graceSlug}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Grace");
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page).toHaveURL(`${base}/`);
  await expect(page.locator(".ph-since")).toContainText("Most recent:");
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Grace");
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("refrain");
});

test("respects reduced motion, and keeps its drawing and frames in forced colors", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openHome(page);
  expect(
    await page
      .locator(".public-link")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");

  await page.emulateMedia({ forcedColors: "active" });
  const look = await page.evaluate(() => {
    const css = (selector: string) =>
      getComputedStyle(document.querySelector(selector)!);
    return {
      character: [
        css(".ph-character").forcedColorAdjust,
        css(".ph-character").backgroundColor,
      ],
      frame: css(".ph-art-fallback").borderTopStyle,
      rows: css(".ph-row-item").borderBottomStyle,
      current: css(".public-link[aria-current='page']").textDecorationLine,
    };
  });
  expect(look.character).toEqual(["none", "rgb(255, 255, 255)"]);
  expect(look.frame).toBe("solid");
  expect(look.rows).toBe("solid");
  expect(look.current).toBe("underline");
});

test("with public reads off, it is the empty Home, whatever is published", async ({
  page,
}) => {
  await openHome(page, offBase);
  await expect(page.locator(".ph-since")).toHaveText("Nothing published yet.");
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
  expect(await addresses(page)).toEqual([]);
  await expect(page.getByText("Grace", { exact: true })).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

// When each seeded journal was first published (src/testing/public-journals.ts),
// so that publishing again keeps the Home's order for the tests after this one.
const SEEDED_DATES: Record<string, string> = {
  grace: "2026-10-20T12:00:00Z",
  "pink-moon": "2026-10-18T12:00:00Z",
  "twin-fantasy": "2026-10-12T12:00:00Z",
  cleopatra: "2026-10-05T12:00:00Z",
};
const seededDate = (slug: string) =>
  SEEDED_DATES[
    Object.keys(SEEDED_DATES).find((name) => slug.endsWith(`-${name}`))!
  ]!;

test("with nothing published, it shows the empty Home", async ({ page }) => {
  const ours = [{ entryId: graceId, slug: graceSlug }, ...shelf];
  for (const journal of ours) {
    await seed("unpublish", journal.entryId);
  }
  try {
    await openHome(page);
    // Another test may have left a journal of its own published on this
    // shared database; the empty state can only be seen without one.
    test.skip(
      (await addresses(page)).length > 0,
      "another public journal is in the database",
    );
    await expect(page.locator(".ph-since")).toHaveText(
      "Nothing published yet.",
    );
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
    // The footer rests at the bottom of the screen.
    const footer = (await page.locator(".public-footer").boundingBox())!;
    expect(footer.y + footer.height).toBeGreaterThanOrEqual(
      page.viewportSize()!.height - 1,
    );
    if (process.env.E2E_SCREENSHOTS === "1") {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({
        path: `${SHOTS}/home-empty-${page.viewportSize()!.width}.png`,
        fullPage: true,
      });
    }
  } finally {
    for (const journal of ours) {
      await seed("publish", journal.entryId, seededDate(journal.slug));
    }
  }
});

test("screenshots, when asked for", async ({ page }) => {
  test.skip(process.env.E2E_SCREENSHOTS !== "1", "set E2E_SCREENSHOTS=1");
  mkdirSync(SHOTS, { recursive: true });
  await seed("cover", twinFantasy.entryId, COVER);
  try {
    await serveTestCovers(page);
    const mobile = isMobile(page);
    const widths = mobile ? [390] : [768, 1280, 1440, 2560];
    await openHome(page);
    for (const width of widths) {
      await page.setViewportSize({ width, height: mobile ? 844 : 900 });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `${SHOTS}/home-${width}.png`,
        fullPage: true,
      });
    }
    // The states at the reference widths: 1440 and 390.
    await page.setViewportSize({
      width: mobile ? 390 : 1440,
      height: mobile ? 844 : 900,
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    const width = page.viewportSize()!.width;
    // Keyboard focus: the skip link, then a journal row.
    await page.keyboard.press("Tab");
    await page.screenshot({ path: `${SHOTS}/home-skip-focus-${width}.png` });
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.screenshot({ path: `${SHOTS}/home-since-focus-${width}.png` });
    await page.keyboard.press("Tab");
    await page.locator(":focus").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/home-row-focus-${width}.png` });
    await page.emulateMedia({ forcedColors: "active" });
    await page.screenshot({
      path: `${SHOTS}/home-forced-colors-${width}.png`,
      fullPage: true,
    });
    await page.emulateMedia({ forcedColors: "none" });
    await openHome(page, offBase);
    await page.screenshot({
      path: `${SHOTS}/home-reads-off-${width}.png`,
      fullPage: true,
    });
  } finally {
    await seed("cover", twinFantasy.entryId, "none");
  }
});

// ---------------------------------------------------------------------------
// M3.8b (ADR 0006 A6): the Home with public memories and artists, from the
// M3.7 and M3.5 fixtures (every hidden memory state and artist reason beside
// the public ones). Screenshots go to visual-review/m3-8b/ (ignored).

const SHOTS_A6 = "visual-review/m3-8b";
const a6Prefix = `${env("E2E_PUBLIC_SEED_PREFIX")}-home6`;

/** "[Test] …" words of the memory fixtures (src/testing/public-memories.ts). */
const MEMORY = {
  title: "[Test] The summer a song arrived",
  when: "[Test] A summer, some years ago",
  first: "[Test] The first paragraph of a synthetic memory.",
  second: "[Test] A second paragraph, so the column holds more than one.",
  song: "[Test] First Memory Song",
  artist: "[Test] Memory Artist",
  longTitle:
    "[Test] A memory with a very long title that has to wrap across several lines without pushing anything sideways",
};

async function seedOutput(...args: string[]): Promise<string> {
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

async function screenshotA6(page: Page, name: string) {
  if (process.env.E2E_SCREENSHOTS !== "1") return;
  mkdirSync(SHOTS_A6, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `${SHOTS_A6}/${name}-${page.viewportSize()!.width}.png`,
    fullPage: true,
  });
}

test("screenshots of the album-journal-only and empty Homes (M3.8b), when asked for", async ({
  page,
}) => {
  test.skip(process.env.E2E_SCREENSHOTS !== "1", "set E2E_SCREENSHOTS=1");
  await serveTestCovers(page);
  await openHome(page);
  await screenshotA6(page, "home-album-journals-only");
  // With reads off the Home is the empty site, whatever is published.
  await openHome(page, offBase);
  await screenshotA6(page, "home-empty");
});

test.describe("with memories and artists (A6)", () => {
  let artistsJson = "";
  let memoriesJson = "";
  let shownMemory = "";

  test.beforeAll(async () => {
    artistsJson = await seedOutput("artists", a6Prefix);
    memoriesJson = await seedOutput("memories", a6Prefix);
    shownMemory = (JSON.parse(memoriesJson) as { shown: { slug: string } })
      .shown.slug;
  });

  test.afterAll(async () => {
    if (memoriesJson) await seed("remove-memories", memoriesJson, a6Prefix);
    if (artistsJson) await seed("remove-artists", artistsJson, a6Prefix);
  });

  test("shows the four sections in the approved order, each with its archive link", async ({
    page,
  }) => {
    await openHome(page);
    const main = page.locator("main");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Recently written",
      "Albums",
      "Artists",
      "Memories",
    ]);
    for (const [name, href] of [
      ["All album journals", "/albums"],
      ["All artists", "/artists"],
      ["All memories", "/memories"],
    ] as const) {
      const link = main.getByRole("link", { name, exact: true });
      await expect(link).toHaveAttribute("href", href);
      // The drawn arrow, decorative.
      await expect(link.locator("svg")).toHaveAttribute("aria-hidden", "true");
    }

    // The memory in Recently written: the note mark, "Memory" and its first
    // song only, linked to its served address.
    const row = page.locator(`.ph-row[href="/memories/${shownMemory}"]`);
    await expect(row).toHaveCount(1);
    await expect(row.locator(".ph-row-title")).toHaveText(MEMORY.title);
    await expect(row.locator(".ph-row-title")).toHaveAttribute("lang", "en");
    await expect(row.locator(".ph-row-kind")).toHaveText(
      `Memory · ${MEMORY.song} — ${MEMORY.artist}`,
    );
    await expect(row.locator(".ph-row-mark svg")).toHaveCount(1);
    await expect(row.locator(".ph-art")).toHaveCount(0);

    // Artists: three cards, the person mark in the frame, never a photograph,
    // the archive's count wording, each at an artist's page.
    const artists = page.locator(".ph-artist");
    await expect(artists).toHaveCount(3);
    await expect(page.locator(".ph-artists img")).toHaveCount(0);
    for (const card of await artists.all()) {
      await expect(card).toHaveAttribute("href", /^\/artists\/[a-z0-9-]+$/);
      await expect(card.locator(".ph-portrait svg")).toHaveCount(1);
      await expect(card.locator(".ph-artist-meta")).toHaveText(
        /^\d+ albums?( · \d+ journals?)?$/,
      );
    }

    // Memories: three cards, the title the only link, "when", the first
    // paragraph only, the music as plain text, no date.
    const cards = page.locator(".ph-memories > li");
    await expect(cards).toHaveCount(3);
    const shown = cards.filter({ hasText: MEMORY.title });
    await expect(shown.locator(".px-when")).toHaveText(MEMORY.when);
    await expect(shown.locator(".px-excerpt")).toHaveText(MEMORY.first);
    await expect(shown.locator(".px-excerpt")).toHaveAttribute("lang", "en");
    await expect(shown.locator("a")).toHaveCount(1);
    await expect(shown.getByRole("heading", { level: 3 })).toHaveText(
      MEMORY.title,
    );
    await expect(shown.locator(".px-music")).toContainText(MEMORY.song);
    await expect(page.locator(".ph-memories-section time")).toHaveCount(0);
    await expect(page.locator(".ph-memories-section")).not.toContainText(
      "Published",
    );
    await expect(page.getByText(MEMORY.second)).toHaveCount(0);
    await expect(page.getByText("PRIVATE-")).toHaveCount(0);
  });

  test("uses the approved measures for Artists and Memories", async ({
    page,
  }) => {
    await openHome(page);
    const mobile = isMobile(page);
    const measures = await page.evaluate(() => {
      const css = (selector: string) =>
        getComputedStyle(document.querySelector(selector)!);
      const box = (selector: string) =>
        document.querySelector(selector)!.getBoundingClientRect();
      return {
        artistsTop: css(".ph-artists-section").paddingTop,
        memoriesTop: css(".ph-memories-section").paddingTop,
        portrait: [box(".ph-portrait").width, box(".ph-portrait").height],
        name: [
          css(".ph-artist-name").fontFamily,
          css(".ph-artist-name").fontSize,
        ],
        columns: css(".ph-artists").gridTemplateColumns.split(" ").length,
        when: [
          css(".ph-memories .px-when").fontFamily,
          css(".ph-memories .px-when").fontSize,
        ],
        title: css(".ph-memories .px-memory-title").fontSize,
        excerpt: css(".ph-memories .px-excerpt").fontSize,
        all: [css(".ph-all").fontSize, box(".ph-all-link").height],
      };
    });
    expect(measures.artistsTop).toBe("96px");
    expect(measures.memoriesTop).toBe("96px");
    expect(measures.portrait[0]).toBeCloseTo(mobile ? 76 : 96, 0);
    expect(measures.portrait[1]).toBeCloseTo(mobile ? 95 : 120, 0);
    expect(measures.name[0]).toContain("Kalam");
    expect(measures.name[1]).toBe("22px");
    expect(measures.columns).toBe(mobile ? 1 : 3);
    expect(measures.when[0]).toContain("Kalam");
    expect(measures.when[1]).toBe("19px");
    expect(measures.title).toBe(mobile ? "23px" : "25px");
    expect(measures.excerpt).toBe(mobile ? "18.5px" : "20px");
    expect(measures.all[0]).toBe(mobile ? "16.5px" : "17px");
    expect(measures.all[1]).toBeGreaterThanOrEqual(43.5);
    await screenshotA6(page, "home-all-sections");
  });

  test("lays out every section at every width without scrolling sideways, also with long names", async ({
    page,
  }) => {
    await openHome(page);
    const startWidth = page.viewportSize()!.width;
    // The longest name the catalog fixtures have, and one very long word,
    // in an artist card; the long memory title is one of the three memories.
    await page
      .locator(".ph-artist-name")
      .first()
      .evaluate((el) => {
        el.textContent =
          "[Test] The Extraordinarily Long-Named Synthetic Chamber Orchestra and Choir of Nowhere in Particular";
      });
    await page
      .locator(".ph-artist-name")
      .nth(1)
      .evaluate((el) => {
        el.textContent =
          "Supercalifragilisticexpialidociousorchestralcollective";
      });
    await expect(page.locator(".ph-memories")).toContainText(MEMORY.longTitle);
    for (const width of [
      320, 360, 390, 640, 768, 960, 961, 1024, 1100, 1101, 1280, 1440, 2560,
    ]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await overflow(page), `${width}px`).toBeLessThanOrEqual(0);
      const layout = await page.evaluate(() => {
        const spilled: string[] = [];
        for (const card of document.querySelectorAll(
          ".ph-artist, .ph-row, .ph-memories > li",
        )) {
          const edge = card.getBoundingClientRect();
          for (const part of card.querySelectorAll("*")) {
            const r = part.getBoundingClientRect();
            if (
              r.width > 0 &&
              (r.right > edge.right + 0.5 || r.left < edge.left - 0.5)
            ) {
              spilled.push(`${part.tagName}.${part.getAttribute("class")}`);
            }
          }
        }
        return {
          spilled,
          columns: getComputedStyle(
            document.querySelector(".ph-artists")!,
          ).gridTemplateColumns.split(" ").length,
        };
      });
      expect(layout.spilled, `${width}px`).toEqual([]);
      expect(layout.columns, `${width}px`).toBe(
        width > 1100 ? 3 : width > 960 ? 2 : 1,
      );
    }
    await page.setViewportSize({ width: startWidth, height: 900 });
    await screenshotA6(page, "home-long-names");

    // The density of a full excerpt (the archive's rule: about 240
    // characters), for the owner's comparison with the screen's "two or three
    // lines at most". Measured, not asserted: no second truncation rule.
    const lines = await page
      .locator(".ph-memories .px-excerpt")
      .first()
      .evaluate((el) => {
        el.textContent =
          "[Test] A synthetic paragraph of about the length the excerpt keeps, written only to see how a full excerpt sits in the Home's Memories section beside the others, at this width, before it stops at a word boundary and the…";
        const css = getComputedStyle(el);
        return Math.round(
          el.getBoundingClientRect().height / parseFloat(css.lineHeight),
        );
      });
    console.log(`a full excerpt at ${startWidth}px: ${lines} lines`);
    await page.locator(".ph-memories-section").scrollIntoViewIfNeeded();
    if (process.env.E2E_SCREENSHOTS === "1") {
      mkdirSync(SHOTS_A6, { recursive: true });
      await page.locator(".ph-memories-section").screenshot({
        path: `${SHOTS_A6}/home-excerpt-density-${startWidth}.png`,
      });
    }
  });

  test("keeps every link a 44px target that nothing covers, with a visible ring from the keyboard", async ({
    page,
  }) => {
    await openHome(page);
    const problems = await page.evaluate(() => {
      const found: string[] = [];
      for (const link of document.querySelectorAll("main a")) {
        const rect = link.getBoundingClientRect();
        if (rect.height < 43.5 || rect.width < 43.5) {
          found.push(`small ${link.getAttribute("href")}`);
        }
        link.scrollIntoView({ block: "center" });
        const r = link.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + Math.min(r.height / 2, 20),
        );
        if (!hit || !(hit === link || link.contains(hit))) {
          found.push(`covered ${link.getAttribute("href")}`);
        }
      }
      return found;
    });
    expect(problems).toEqual([]);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("main").focus();
    const visited: string[] = [];
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element || !element.closest("main")) return null;
        const css = getComputedStyle(element);
        return {
          href: element.getAttribute("href"),
          ring: `${css.outlineStyle} ${css.outlineWidth} ${css.outlineColor}`,
        };
      });
      if (!focused) break;
      expect(focused.ring, focused.href ?? "").toBe(
        "solid 2px rgb(17, 17, 17)",
      );
      visited.push(focused.href!);
    }
    for (const archive of ["/albums", "/artists", "/memories"]) {
      expect(visited).toContain(archive);
    }
    expect(visited.filter((href) => href.startsWith("/artists/"))).toHaveLength(
      3,
    );
    expect(visited).toContain(`/memories/${shownMemory}`);
    // The sections in reading order: all of an earlier section first.
    const lastOf = (prefix: string) =>
      visited.map((href) => href.startsWith(prefix)).lastIndexOf(true);
    expect(visited.indexOf("/albums")).toBeLessThan(
      visited.findIndex((href) => href.startsWith("/artists/")),
    );
    expect(lastOf("/artists/")).toBeLessThan(visited.indexOf("/memories"));
  });

  test("has no accessibility violations, and no layout shift (WCAG 2.2 A and AA)", async ({
    page,
  }) => {
    await serveTestCovers(page);
    await page.addInitScript(() => {
      const record = { total: 0 };
      (window as unknown as { __shifts: typeof record }).__shifts = record;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        })[]) {
          if (!entry.hadRecentInput) record.total += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await openHome(page);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations).toEqual([]);
    const shifts = await page.evaluate(
      () => (window as unknown as { __shifts: { total: number } }).__shifts,
    );
    expect(shifts.total).toBeLessThan(0.001);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("works without JavaScript: every section, its links, and the footer", async ({
    browser,
  }) => {
    await withoutJavaScript(browser, async (page) => {
      const response = await page.goto(`${base}/`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 2 })).toHaveText([
        "Recently written",
        "Albums",
        "Artists",
        "Memories",
      ]);
      for (const selector of [
        ".ph-row",
        ".ph-album",
        ".ph-artist",
        ".ph-memories > li",
        ".ph-all-link",
      ]) {
        await expect(page.locator(selector).first()).toBeVisible();
      }
      await expect(page.locator(".public-footer")).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await page.getByRole("link", { name: MEMORY.title }).first().click();
      await expect(page).toHaveURL(`${base}/memories/${shownMemory}`);
      await page.goto(`${base}/`);
      await screenshotA6(page, "home-no-js");
    });
  });

  test("respects reduced motion, and keeps its frames and links in forced colors", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page);
    expect(
      await page
        .locator(".ph-all-link")
        .first()
        .evaluate((el) => getComputedStyle(el).transitionDuration),
    ).toBe("0s");
    await page.emulateMedia({ forcedColors: "active" });
    const look = await page.evaluate(() => {
      const css = (selector: string) =>
        getComputedStyle(document.querySelector(selector)!);
      return {
        portrait: css(".ph-portrait").borderTopStyle,
        all: css(".ph-all-link").textDecorationLine,
      };
    });
    expect(look).toEqual({ portrait: "solid", all: "underline" });
  });

  test("with public reads off, it is still the empty Home", async ({
    page,
  }) => {
    await openHome(page, offBase);
    await expect(page.locator(".ph-since")).toHaveText(
      "Nothing published yet.",
    );
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
    await expect(page.locator("main a")).toHaveCount(0);
    await expect(page.getByText(MEMORY.title)).toHaveCount(0);
  });

  // The owner's decision (M3.8b): on a phone the Home draws at most three
  // lines of a memory's excerpt, in CSS only. The server's excerpt (the
  // archive's rule) is unchanged and whole in the page; desktop and the
  // Memories archive are unchanged.
  test("draws at most three lines of a memory's excerpt on a phone, keeping the whole excerpt in the page", async ({
    page,
    browser,
  }) => {
    const quiet = (JSON.parse(memoriesJson) as { quiet: { entryId: string } })
      .quiet.entryId;
    const quietTitle = "[Test] A memory without songs";
    const quietText = "[Test] A memory with no songs linked to it.";
    const long =
      `[Test] ${"A synthetic sentence that keeps going so that the excerpt reaches its full length. ".repeat(5)}`.trim();
    await seed("memory-writing", quiet, long);
    try {
      await openHome(page);
      const card = page
        .locator(".ph-memories > li")
        .filter({ hasText: quietTitle });
      const excerpt = card.locator(".px-excerpt");
      const served = (await excerpt.textContent())!;
      // The server's cut, about 240 characters, unchanged.
      expect(served.length).toBeGreaterThan(200);
      expect(served.length).toBeLessThanOrEqual(241);
      expect(served.endsWith("…")).toBe(true);

      const samples: Record<string, string> = {
        "the served excerpt": served,
        "one long word": `[Test] ${"Supercalifragilistic".repeat(12)}`,
        unicode:
          `[Test] ${"Ça me rappelle «l\u2019été» — 夏の終わりに聴いた歌、Привет, мир, نص عربي، 🎧🎶 e\u0301te\u0301. ".repeat(3)}`.trim(),
      };
      const measure = () =>
        excerpt.evaluate((element) => {
          const css = getComputedStyle(element);
          return {
            lines:
              element.getBoundingClientRect().height /
              parseFloat(css.lineHeight),
            clamp: css.webkitLineClamp,
            clipped: element.scrollHeight > element.clientHeight + 1,
            text: element.textContent,
          };
        });
      for (const width of [320, 360, 390, 721, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const [name, text] of Object.entries(samples)) {
          await excerpt.evaluate((element, value) => {
            element.textContent = value;
          }, text);
          const drawn = await measure();
          const label = `${width}px, ${name}`;
          // The authored words are never changed, only what is drawn.
          expect(drawn.text, label).toBe(text);
          expect(await overflow(page), label).toBeLessThanOrEqual(0);
          if (width <= 720) {
            expect(drawn.clamp, label).toBe("3");
            expect(drawn.lines, label).toBeLessThanOrEqual(3.05);
          } else {
            expect(drawn.clamp, label).toBe("none");
            expect(drawn.clipped, label).toBe(false);
          }
        }
        await excerpt.evaluate((element, value) => {
          element.textContent = value;
        }, served);
        // A screen reader is given the whole excerpt, once; the title leads to
        // the whole memory.
        expect(await card.ariaSnapshot(), `${width}px`).toContain(served);
        await expect(
          card.getByRole("link", { name: quietTitle }),
        ).toHaveAttribute("href", /^\/memories\//);
      }
      if (process.env.E2E_SCREENSHOTS === "1") {
        await page.setViewportSize({ width: 390, height: 900 });
        mkdirSync(SHOTS_A6, { recursive: true });
        await page
          .locator(".ph-memories-section")
          .screenshot({ path: `${SHOTS_A6}/home-excerpt-clamped-390.png` });
      }

      // The Memories archive is unchanged: the whole excerpt, at every width.
      await page.goto(`${base}/memories`);
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page
            .locator(".px-excerpt")
            .first()
            .evaluate((element) => getComputedStyle(element).webkitLineClamp),
          `archive ${width}px`,
        ).toBe("none");
      }

      // Without JavaScript the clamp is the same: it is CSS alone.
      await withoutJavaScript(browser, async (noScript) => {
        await noScript.setViewportSize({ width: 390, height: 900 });
        await noScript.goto(`${base}/`);
        const plain = noScript
          .locator(".ph-memories > li")
          .filter({ hasText: quietTitle })
          .locator(".px-excerpt");
        expect(await plain.textContent()).toBe(served);
        const box = (await plain.boundingBox())!;
        // 18.5px at a line height of 1.65: three lines.
        expect(box.height).toBeLessThanOrEqual(3 * 18.5 * 1.65 + 1);
        expect(box.height).toBeGreaterThan(2 * 18.5 * 1.65);
      });
    } finally {
      await seed("memory-writing", quiet, quietText);
    }
  });

  test("screenshots of a Home with only memories, when asked for", async ({
    page,
  }) => {
    test.skip(process.env.E2E_SCREENSHOTS !== "1", "set E2E_SCREENSHOTS=1");
    const artists = JSON.parse(artistsJson) as Record<
      string,
      { entryId: string }
    >;
    const memories = JSON.parse(memoriesJson) as {
      albumJournal: { entryId: string };
    };
    // Every album journal published here, with the date to restore.
    const journals: [string, string][] = [
      [graceId, seededDate(graceSlug)],
      ...shelf.map(
        (journal) =>
          [journal.entryId, seededDate(journal.slug)] as [string, string],
      ),
      [artists.grace!.entryId, "2026-10-20T12:00:00Z"],
      [artists.sketches!.entryId, "2026-10-15T12:00:00Z"],
      [artists.long!.entryId, "2026-10-10T12:00:00Z"],
      [artists.broken!.entryId, "2026-10-08T12:00:00Z"],
      [memories.albumJournal.entryId, "2026-01-01T00:00:00Z"],
    ];
    for (const [entryId] of journals) {
      await seed("unpublish", entryId);
    }
    try {
      await openHome(page);
      test.skip(
        (await addresses(page)).length > 0,
        "another public journal is in the database",
      );
      await expect(page.getByRole("heading", { level: 2 })).toHaveText([
        "Recently written",
        "Memories",
      ]);
      await screenshotA6(page, "home-memories-only");
    } finally {
      for (const [entryId, date] of journals) {
        await seed("publish", entryId, date);
      }
    }
  });
});
