import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { env } from "./support";

// The public archives and the shared navigation (M3.8a) in a browser,
// anonymous, at 1440 px and at 390 px. Populated: the server with public reads
// on, which holds the global seed (Grace, a draft, the Home's shelf) and what
// this file seeds: the artist pages' fixtures, the memories' fixtures, and a
// second, earlier journal about one Grace. Switched off: the studio's server,
// whose switch stays off as a default deployment's does. Every piece of
// writing is "[Test]". No real artwork or photograph is requested: covers are
// answered with a synthetic image. Screenshots are written only with
// E2E_SCREENSHOTS=1, to visual-review/m3-8a/ (ignored by Git).

const base = env("E2E_PUBLIC_URL");
const offBase = env("E2E_BASE_URL");
const graceId = env("E2E_PUBLIC_ENTRY_ID");
const graceSlug = env("E2E_PUBLIC_SLUG");
const prefix = `${env("E2E_PUBLIC_SEED_PREFIX")}-arc`;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SHOTS = "visual-review/m3-8a";
const ARCHIVES = ["albums", "artists", "memories"] as const;
const TITLES = { albums: "Albums", artists: "Artists", memories: "Memories" };
const TEST_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500"><rect width="500" height="500" fill="#1d4e89"/><circle cx="250" cy="230" r="120" fill="#c8553d"/></svg>`;

const execFileAsync = promisify(execFile);
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

let artistsJson = "";
let memoriesJson = "";
let another: { entryId: string; slug: string };
let memories: {
  shown: { slug: string };
  long: { slug: string };
  hidden: { slug: string }[];
};

test.beforeAll(async () => {
  artistsJson = await seed("artists", prefix);
  memoriesJson = await seed("memories", prefix);
  memories = JSON.parse(memoriesJson) as typeof memories;
  another = JSON.parse(
    await seed("another-journal", graceId, `${prefix}-grace-earlier`),
  ) as typeof another;
});

test.afterAll(async () => {
  if (another) await seed("remove-entry", another.entryId);
  if (memoriesJson) await seed("remove-memories", memoriesJson, prefix);
  if (artistsJson) await seed("remove-artists", artistsJson, prefix);
});

async function serveTestImages(page: Page) {
  await page.route("https://coverartarchive.org/**", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: TEST_IMAGE }),
  );
  await page.route("https://thumb.wikimedia.org/**", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: TEST_IMAGE }),
  );
}

async function open(page: Page, archive: (typeof ARCHIVES)[number]) {
  await serveTestImages(page);
  const response = await page.goto(`${base}/${archive}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    TITLES[archive],
  );
}

async function shot(page: Page, name: string, fullPage = true) {
  if (process.env.E2E_SCREENSHOTS !== "1") return;
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

const overflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

/** The navigation as a reader meets it: each link, and which is current. */
async function navigation(page: Page) {
  return page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((link) => ({
        name: link.textContent,
        href: link.getAttribute("href"),
        current: link.getAttribute("aria-current"),
        // The drawn underline is the background, drawn in full when current.
        drawn: getComputedStyle(link).backgroundSize.startsWith("100%"),
      })),
    );
}

const expectedNavigation = (current: string | null, value: string | null) =>
  [
    ["Home", "/"],
    ["Albums", "/albums"],
    ["Artists", "/artists"],
    ["Memories", "/memories"],
  ].map(([name, href]) => ({
    name,
    href,
    current: name === current ? value : null,
    drawn: name === current,
  }));

/** Every target of a list is 44px tall, and nothing else lies over its edges. */
async function expectTargets(page: Page, selector: string) {
  const targets = await page.locator(selector).all();
  expect(targets.length, selector).toBeGreaterThan(0);
  for (const target of targets) {
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
    expect(edges.height, selector).toBeGreaterThanOrEqual(44);
    expect(edges.hits, selector).toEqual(["itself", "itself"]);
  }
}

test("the Albums archive shows each album once, with every other journal about it", async ({
  page,
}) => {
  await open(page, "albums");
  await expect(
    page.getByText(
      "Whole records, written about slowly. Some have every track, some only a few.",
    ),
  ).toBeVisible();
  expect(await navigation(page)).toEqual(expectedNavigation("Albums", "page"));

  // The card of the album the earlier journal is about, with a quiet link to
  // that journal under it, and no second card.
  const card = page
    .locator(".px-album-item")
    .filter({ has: page.locator(`a[href="/albums/${graceSlug}"]`) });
  await expect(card).toHaveCount(1);
  await expect(card.locator(".ph-album-title")).toHaveText("Grace");
  await expect(card.locator(".px-progress")).toHaveText(
    /^\d+ of \d+ tracks written$/,
  );
  const more = card.getByRole("link", {
    name: "Another journal, published Jan 2, 2020 (about Grace)",
  });
  await expect(more).toBeVisible();
  await expect(
    page.locator(`a[href="/albums/${another.slug}"]`).locator(".ph-album"),
  ).toHaveCount(0);
  await shot(page, "albums");

  await more.click();
  await expect(page).toHaveURL(`${base}/albums/${another.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Grace");
  expect(await navigation(page)).toEqual(expectedNavigation("Albums", "true"));
});

test("the Artists archive is a ruled list of the artists with a page, and no photograph", async ({
  page,
}) => {
  await open(page, "artists");
  await expect(
    page.getByText("The artists behind the albums I've written about."),
  ).toBeVisible();
  expect(await navigation(page)).toEqual(expectedNavigation("Artists", "page"));
  const rows = page.locator(".px-row");
  expect(await rows.count()).toBeGreaterThanOrEqual(3);
  await expect(page.locator("main img")).toHaveCount(0);
  await expect(page.getByText(/PRIVATE/)).toHaveCount(0);
  await expect(page.getByText(/Solo artist|Band\b/)).toHaveCount(0);
  // The long band name wraps inside its row.
  const long = rows.filter({ hasText: "Extraordinarily Long-Named" });
  await expect(long).toHaveCount(1);
  expect(await overflow(page)).toBe(0);
  await shot(page, "artists");

  await rows.filter({ hasText: "Jeff Buckley" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Jeff Buckley",
  );
  expect(await navigation(page)).toEqual(expectedNavigation("Artists", "true"));
});

test("the Memories archive lists each memory's when, title, excerpt, music, and date", async ({
  page,
}) => {
  await open(page, "memories");
  await expect(
    page.getByText(
      "Moments that came with a song. Dated the way I remember them, not by when I wrote them down.",
    ),
  ).toBeVisible();
  expect(await navigation(page)).toEqual(
    expectedNavigation("Memories", "page"),
  );
  const shown = page.locator(".px-memory").filter({
    has: page.locator(`a[href="/memories/${memories.shown.slug}"]`),
  });
  await expect(shown.locator(".px-when")).toHaveText(
    "[Test] A summer, some years ago",
  );
  await expect(shown.getByRole("heading", { level: 2 })).toHaveText(
    "[Test] The summer a song arrived",
  );
  await expect(shown.locator(".px-excerpt")).toHaveText(
    "[Test] The first paragraph of a synthetic memory.",
  );
  await expect(shown.locator(".px-music")).toContainText(
    "[Test] First Memory Song — [Test] Memory Artist",
  );
  await expect(shown.locator(".px-published")).toHaveText(/^Published /);
  for (const hidden of memories.hidden) {
    await expect(
      page.locator(`a[href="/memories/${hidden.slug}"]`),
    ).toHaveCount(0);
  }
  await shot(page, "memories");

  await shown.getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "[Test] The summer a song arrived",
  );
  expect(await navigation(page)).toEqual(
    expectedNavigation("Memories", "true"),
  );
});

test("the navigation is the same four links on the Home, the detail pages, and the not-found view", async ({
  page,
}) => {
  await serveTestImages(page);
  await page.goto(`${base}/`);
  expect(await navigation(page)).toEqual(expectedNavigation("Home", "page"));
  await shot(page, "nav-home", false);
  await page.goto(`${base}/albums/${graceSlug}`);
  // The album journal streams its writing in (issue #44): the capture waits.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Grace");
  expect(await navigation(page)).toEqual(expectedNavigation("Albums", "true"));
  await shot(page, "nav-album-journal", false);
  await page.goto(`${base}/memories/${memories.shown.slug}`);
  expect(await navigation(page)).toEqual(
    expectedNavigation("Memories", "true"),
  );
  await shot(page, "nav-memory", false);
  await page.goto(`${base}/artists`);
  await page
    .locator(".px-row")
    .filter({ hasText: "Jeff Buckley" })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Jeff Buckley",
  );
  await shot(page, "nav-artist", false);
  const missing = await page.goto(`${base}/albums/${prefix}-nothing-here`);
  expect(missing?.status()).toBe(404);
  expect(await navigation(page)).toEqual(expectedNavigation(null, null));
  await shot(page, "nav-not-found", false);
});

test("with public reads off, each archive is the not-found view, and the navigation is unchanged", async ({
  page,
}) => {
  for (const archive of ARCHIVES) {
    const response = await page.goto(`${offBase}/${archive}`);
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "Nothing here" }),
    ).toBeVisible();
    expect(await navigation(page)).toEqual(expectedNavigation(null, null));
    await shot(page, `off-${archive}`, false);
  }
  await page.goto(`${offBase}/`);
  expect(await navigation(page)).toEqual(expectedNavigation("Home", "page"));
});

test("every archive reads the same without JavaScript", async ({
  browser,
}, info) => {
  const mobile = info.project.name === "archives-390";
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();
  for (const [archive, item] of [
    ["albums", ".px-album-item"],
    ["artists", ".px-row"],
    ["memories", ".px-memory"],
  ] as const) {
    const response = await page.goto(`${base}/${archive}`);
    expect(response?.status()).toBe(200);
    expect(await page.locator(item).count()).toBeGreaterThan(1);
    await expect(page.getByText("some songs take you back.")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.querySelectorAll('div[hidden][id^="S:"]').length,
      ),
    ).toBe(0);
    await shot(page, `nojs-${archive}`);
  }
  await context.close();
});

test("every archive passes axe, with keyboard operation, a visible focus ring, and 44px targets", async ({
  page,
}) => {
  for (const [archive, targets] of [
    ["albums", ".ph-album, .px-more-link"],
    ["artists", ".px-row"],
    ["memories", ".px-memory-link"],
  ] as const) {
    await open(page, archive);
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(
      results.violations.map((violation) => violation.id),
      archive,
    ).toEqual([]);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to content" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
    await page.keyboard.press("Tab");
    const first = page.locator(targets).first();
    await expect(first).toBeFocused();
    const outline = await first.evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.outlineStyle} ${style.outlineWidth}`;
    });
    expect(outline, archive).toBe("solid 2px");
    await expectTargets(page, targets);
    await expectTargets(page, ".public-nav .public-link");
    // One h1, then one h2 per memory on the Memories archive, none elsewhere.
    const headings = await page
      .locator("h1, h2, h3")
      .evaluateAll((all) => all.map((heading) => heading.tagName));
    expect(headings[0]).toBe("H1");
    expect(headings.filter((tag) => tag === "H1")).toHaveLength(1);
    expect(headings.includes("H3")).toBe(false);
  }
  // The memories' writing carries its own language.
  await expect(page.locator(".px-excerpt").first()).toHaveAttribute(
    "lang",
    "en",
  );
  await expect(page.locator(".px-memory-link").first()).toHaveAttribute(
    "lang",
    "en",
  );
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

test("keeps its frames, rules, links, and the current section visible in forced colors", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await open(page, "albums");
  expect(
    await page
      .locator(".ph-album .ph-art-fallback, .ph-album .ph-art")
      .first()
      .evaluate((element) => getComputedStyle(element).borderTopStyle),
  ).toMatch(/solid|none/);
  expect(
    await page
      .locator(".px-more-link")
      .first()
      .evaluate((element) => getComputedStyle(element).textDecorationLine),
  ).toContain("underline");
  expect(
    await page
      .locator('.public-link[aria-current="page"]')
      .evaluate((element) => getComputedStyle(element).textDecorationLine),
  ).toContain("underline");
  await open(page, "artists");
  expect(
    await page
      .locator(".px-row-item")
      .first()
      .evaluate((element) => getComputedStyle(element).borderBottomStyle),
  ).toBe("solid");
  await page.goto(`${base}/albums/${graceSlug}`);
  expect(
    await page
      .locator('.public-link[aria-current="true"]')
      .evaluate((element) => getComputedStyle(element).textDecorationLine),
  ).toContain("underline");
});

test("never scrolls sideways, and keeps the navigation whole, at every width", async ({
  page,
}, info) => {
  test.skip(info.project.name === "archives-390", "widths set here");
  for (const width of [320, 360, 390, 768, 1280, 1440, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    for (const archive of ARCHIVES) {
      await open(page, archive);
      expect(await overflow(page), `${archive} at ${width}`).toBe(0);
      // Every link of the navigation is inside the page and none is cut.
      const links = await page
        .locator(".public-nav .public-link")
        .evaluateAll((all) =>
          all.map((link) => {
            const rect = link.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= window.innerWidth;
          }),
        );
      expect(links, `${archive} at ${width}`).toEqual([true, true, true, true]);
      // And they sit on one line.
      const tops = await page
        .locator(".public-nav .public-link")
        .evaluateAll((all) =>
          all.map((link) => Math.round(link.getBoundingClientRect().top)),
        );
      expect(new Set(tops).size, `one row at ${width}`).toBe(1);
      if ([320, 390, 768, 1440, 2560].includes(width)) {
        await shot(page, `${archive}-w`);
      }
    }
    // The long titles and names wrap between words.
    await open(page, "memories");
    expect(await overflow(page)).toBe(0);
  }
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
  for (const archive of ARCHIVES) {
    await open(page, archive);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const shifts = await page.evaluate(
      () => (window as unknown as { shifts: number }).shifts,
    );
    expect(shifts, archive).toBeLessThan(0.01);
  }
});
