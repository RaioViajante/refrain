import { execFile } from "node:child_process";
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
const ARCHIVES = ["albums", "artists", "memories"] as const;
const TITLES = {
  albums: /^album journals/,
  artists: /^artists/,
  memories: /^memories/,
};
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

// The v3 archives (docs/design-system.md, Part I, Pages: Albums, Artists,
// Memories; evidence: docs/evidence/v3-public.md). The properties the V4.4
// tests held, on the v3 pages: each album once and every other journal still
// linked; exactly the artists with a page and no photograph; the served
// memories; the same header on every page; the unknown address while reads
// are off; complete without JavaScript; axe clean; 44px controls (list rows:
// WCAG 2.2's 24px, a decision recorded for the owner); no sideways scrolling;
// still under reduced motion.

const links = (page: Page, under: string) =>
  page
    .locator(`main a[href^='/${under}/']`)
    .evaluateAll((all) => [
      ...new Set(all.map((link) => link.getAttribute("href")!)),
    ]);

test("the Albums archive shows each album once, with every other journal about it", async ({
  page,
}) => {
  await open(page, "albums");
  const rows = page.locator(".alist li:not(.gh):not(.oj) a");
  // Each row is one album: no journal address appears on two rows.
  const rowLinks = await rows.evaluateAll((all) =>
    all.map((link) => link.getAttribute("href")),
  );
  expect(new Set(rowLinks).size).toBe(rowLinks.length);
  const linked = await links(page, "albums");
  expect(linked).toContain(`/albums/${graceSlug}`);
  expect(linked).toContain(`/albums/${another.slug}`);
  await expect(page.locator(".alist li.oj")).not.toHaveCount(0);
  // The orbit's covers are decoration, out of the tab order.
  const orbit = page.locator(".orb2 .ri").first();
  await expect(orbit).toHaveAttribute("aria-hidden", "true");
  await expect(orbit).toHaveAttribute("tabindex", "-1");
  // The four sorts, as pressed buttons.
  for (const name of ["order written", "year", "artist", "my rating"]) {
    const button = page.getByRole("button", { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
});

test("the Artists archive lists the artists with a page, and no photograph", async ({
  page,
}) => {
  await open(page, "artists");
  const linked = await links(page, "artists");
  expect(linked.length).toBeGreaterThan(0);
  for (const href of linked) {
    expect((await page.request.get(`${base}${href}`)).status(), href).toBe(200);
  }
  const photos = await page.locator("main img").count();
  expect(photos).toBe(0);
  await page.getByRole("button", { name: "A to Z" }).click();
  await expect(page.locator(".az")).toBeVisible();
});

test("the Memories archive lists the served memories, and never their whole writing", async ({
  page,
}) => {
  await open(page, "memories");
  const linked = await links(page, "memories");
  expect(linked).toContain(`/memories/${memories.shown.slug}`);
  for (const hidden of memories.hidden) {
    expect(linked).not.toContain(`/memories/${hidden.slug}`);
  }
});

test("the header is the same three sections on every page, with the current one marked", async ({
  page,
}) => {
  for (const archive of ARCHIVES) {
    await open(page, archive);
    const nav = await navigation(page);
    expect(nav.map((link) => link.href)).toEqual([
      "/albums",
      "/artists",
      "/memories",
    ]);
    expect(nav.find((link) => link.href === `/${archive}`)?.current).toBe(
      "page",
    );
  }
});

test("with public reads off, each archive is the not-found view", async ({
  page,
}) => {
  for (const archive of ARCHIVES) {
    const response = await page.goto(`${offBase}/${archive}`);
    expect(response?.status(), archive).toBe(404);
    await expect(page.getByText("this track skipped")).toBeVisible();
  }
});

test("every archive reads the same without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  for (const archive of ARCHIVES) {
    await page.goto(`${base}/${archive}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      TITLES[archive],
    );
    expect((await links(page, archive)).length, archive).toBeGreaterThan(0);
  }
  await context.close();
});

test("every archive passes axe, and its controls are large enough to press", async ({
  page,
}) => {
  // Settled, as a reader with reduced motion sees it: axe never measures
  // text halfway through an entrance.
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const archive of ARCHIVES) {
    await open(page, archive);
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(
      results.violations.map(
        (v) =>
          `${archive} ${v.id}: ${v.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
      ),
    ).toEqual([]);
    const small = await page.evaluate(() => {
      const found: string[] = [];
      const check = (selector: string, minimum: number) => {
        for (const element of document.querySelectorAll(selector)) {
          const height = element.getBoundingClientRect().height;
          if (height > 0 && height < minimum)
            found.push(`${element.textContent?.trim()}: ${height}`);
        }
      };
      check("header a, footer nav a, footer button, .pill, .sorts button", 44);
      check(".alist li a, .az li a, .wall2 a, .yb .mi", 24);
      return found;
    });
    expect(small, archive).toEqual([]);
  }
});

test("never scrolls sideways, at every width", async ({ page }) => {
  for (const archive of ARCHIVES) {
    await open(page, archive);
    for (const width of [320, 390, 720, 721, 1024, 1440, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await overflow(page),
        `${archive} at ${width}px`,
      ).toBeLessThanOrEqual(0);
    }
  }
});

test("still under reduced motion: the orbit does not turn", async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await open(page, "albums");
  const running = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((animation) => animation.playState === "running").length,
  );
  expect(running).toBe(0);
  await context.close();
});
