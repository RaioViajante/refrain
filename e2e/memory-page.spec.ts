import { execFile } from "node:child_process";
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

const overflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

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

// The v3 memory page (docs/design-system.md, Part I, Pages: memory;
// evidence: docs/evidence/v3-public.md). The properties the V4.4 tests held,
// on the v3 page: the label, the title whole, the writing, and the song with
// its links only where their pages are public; no rating, favourite, or
// administrative control; the way back to the memories; a memory with no
// song; no sideways scrolling; complete without JavaScript; axe clean; 44px
// controls; a previous address redirected; and the identical not-found view
// for a memory that is not public.

const title = (page: Page) =>
  page
    .getByRole("heading", { level: 1 })
    .evaluate((element) => element.textContent?.replace(/\s+/g, " ").trim());

test("shows the label, the title, the writing, and the song", async ({
  page,
}) => {
  await open(page, seeded.shown.slug);
  expect(await title(page)).toBe("[Test] The summer a song arrived");
  await expect(page.locator(".mtop .k")).toHaveText(/^MEMORY/);
  await expect(page.locator(".sheet .para").first()).toBeVisible();
  await expect(page.locator(".np")).toBeVisible();
  await expect(page.locator(".np .s")).not.toHaveText("");
  await expect(
    page.getByText(/My rating|Favourite|Publish…|Unpublish|Writing studio/),
  ).toHaveCount(0);
});

test("follows a song's album to its journal, and its artist to their page", async ({
  page,
}) => {
  await open(page, seeded.shown.slug);
  await page.locator(".np .on a").first().click();
  await expect(page).toHaveURL(`${base}/albums/${seeded.albumJournal.slug}`);
  await open(page, seeded.shown.slug);
  await page.locator(".np .kr").first().click();
  await expect(page).toHaveURL(`${base}/artists/test-memory-artist`);
});

test("closes with the way back to the memories", async ({ page }) => {
  await open(page, seeded.shown.slug);
  const all = page
    .locator(".mnav2")
    .getByRole("link", { name: "All memories" });
  await expect(all).toHaveAttribute("href", "/memories");
  expect((await all.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await all.click();
  await expect(page).toHaveURL(`${base}/memories`);
});

test("shows a memory with no song without the song's section", async ({
  page,
}) => {
  await open(page, seeded.quiet.slug);
  await expect(page.locator(".np")).toHaveCount(0);
});

test("keeps a long title whole, without sideways scrolling, at every width", async ({
  page,
}) => {
  await open(page, seeded.long.slug);
  expect((await title(page))!.length).toBeGreaterThan(40);
  for (const width of [320, 390, 720, 721, 1024, 1440, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflow(page), `${width}px`).toBeLessThanOrEqual(0);
  }
});

test("reads the same without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await open(page, seeded.shown.slug);
  await expect(page.locator(".sheet .para").first()).toBeVisible();
  await expect(page.locator(".np")).toBeVisible();
  await context.close();
});

test("passes axe, and its controls are large enough to press", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const slug of [seeded.shown.slug, seeded.quiet.slug, seeded.long.slug]) {
    await open(page, slug);
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(
      results.violations.map(
        (v) =>
          `${v.id}: ${v.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
      ),
      slug,
    ).toEqual([]);
    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          "header a, footer nav a, footer button, .pill, .mnav2 a",
        ),
      ]
        .map((element) => element.getBoundingClientRect().height)
        .filter((height) => height > 0 && height < 44),
    );
    expect(small, slug).toEqual([]);
  }
});

test("redirects a previous address to the current one", async ({ page }) => {
  const response = await page.goto(
    `${base}/memories/${seeded.shown.previousSlug}`,
  );
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(`${base}/memories/${seeded.shown.slug}`);
  expect(await title(page)).toBe("[Test] The summer a song arrived");
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
    await expect(page.getByText("this track skipped")).toBeVisible();
    await expect(page.getByText("PRIVATE")).toHaveCount(0);
  }
});
