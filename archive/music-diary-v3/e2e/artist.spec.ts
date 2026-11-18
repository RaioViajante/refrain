import { execFile } from "node:child_process";
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

const overflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

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
  const link = page.locator(".gtop .by a").first();
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

// The v3 artist page (docs/design-system.md, Part I, Pages: artist;
// evidence: docs/evidence/v3-public.md). The properties the V4.4 tests held,
// on the v3 page: the photograph the author chose, loaded with no referrer,
// with its credit, licence, and source (linked with noreferrer), shown in
// black and white and torn in two, and saying so; the name whole; the shelf
// of public journals only; the way from a journal's credit and back; the
// kraft frame for a band without a photograph; no broken page when a
// thumbnail fails; complete without JavaScript; axe clean; 44px controls; no
// sideways scrolling; and the identical not-found view for an artist with no
// public writing.

const heading = (page: Page) =>
  page
    .getByRole("heading", { level: 1 })
    .evaluate((element) => element.textContent?.replace(/\s+/g, " ").trim());

test("shows the photograph, the name, and the public journals on the shelf", async ({
  page,
}) => {
  const requested = await serveImages(page);
  await openArtist(page, "grace");
  expect(await heading(page)).toBe("Jeff Buckley");
  const halves = page.locator(".torn .half img");
  await expect(halves).toHaveCount(2);
  for (const image of await halves.all()) {
    await expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(image).toHaveAttribute("alt", "");
  }
  expect(requested.length).toBeGreaterThan(0);
  await expect(
    page.getByRole("img", { name: "Photograph of Jeff Buckley" }),
  ).toHaveCount(1);
  const credit = page.locator(".pcredit");
  await expect(credit).toContainText("Photo: ");
  await expect(credit).toContainText("Shown in black and white, torn in two.");
  for (const link of await credit.getByRole("link").all()) {
    await expect(link).toHaveAttribute("rel", /noreferrer/);
  }
  const shelf = page.locator(".his a.tx");
  await expect(shelf.first()).toBeVisible();
  const journals = await shelf.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")),
  );
  expect(journals).toContain(`/albums/${seeded.grace.slug}`);
  expect(journals).toContain(`/albums/${seeded.sketches.slug}`);
  await expect(page.getByText("Lilac Wine")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "All artists" })).toHaveAttribute(
    "href",
    "/artists",
  );
});

test("leads from an album journal's credit to the artist, and back to the journal", async ({
  page,
}) => {
  await serveImages(page);
  await page.goto(`${base}/albums/${seeded.grace.slug}`);
  await page.locator(".gtop .by a").first().click();
  await expect(page).toHaveURL(new RegExp(`/artists/${address.grace}$`));
  await page.locator(`.his a.tx[href="/albums/${seeded.grace.slug}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/albums/${seeded.grace.slug}$`));
});

test("shows the kraft frame and the whole name for a band without a photograph", async ({
  page,
}) => {
  await serveImages(page);
  await openArtist(page, "long");
  await expect(page.locator(".torn.no-photo")).toHaveCount(1);
  await expect(page.locator(".torn img")).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: /^No photograph of / }),
  ).toHaveCount(1);
  expect((await heading(page))!.length).toBeGreaterThan(20);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  // The long name stays above the labels and inside its column, wherever the
  // labels sit beside it (a long name once ran over "albums written").
  for (const width of [1024, 1440, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    const boxes = await page.evaluate(() => {
      const rect = (selector: string) =>
        document.querySelector(selector)!.getBoundingClientRect();
      const h1 = rect(".torn h1");
      const mid = rect(".torn .mid");
      const label = rect(".torn .lab");
      return {
        h1: { left: h1.left, right: h1.right, bottom: h1.bottom },
        mid: { left: mid.left, right: mid.right },
        labelTop: label.top,
      };
    });
    expect(boxes.h1.bottom, `${width}px`).toBeLessThanOrEqual(boxes.labelTop);
    expect(boxes.h1.left, `${width}px`).toBeGreaterThanOrEqual(
      boxes.mid.left - 1,
    );
    expect(boxes.h1.right, `${width}px`).toBeLessThanOrEqual(
      boxes.mid.right + 1,
    );
  }
});

test("keeps the page whole when the thumbnail cannot be loaded", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await serveImages(page);
  await openArtist(page, "broken");
  await expect(page.locator(".pcredit")).toBeVisible();
  expect(errors).toEqual([]);
});

test("reads the same without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await serveImages(page);
  await openArtist(page, "grace");
  expect(await heading(page)).toBe("Jeff Buckley");
  await expect(page.locator(".his a.tx").first()).toBeVisible();
  await context.close();
});

test("passes axe, and its controls are large enough to press", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await serveImages(page);
  for (const which of ["grace", "long"] as const) {
    await openArtist(page, which);
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(
      results.violations.map(
        (v) =>
          `${which} ${v.id}: ${v.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
      ),
    ).toEqual([]);
    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          "header a, footer nav a, footer button, .pill",
        ),
      ]
        .map((element) => element.getBoundingClientRect().height)
        .filter((height) => height > 0 && height < 44),
    );
    expect(small, which).toEqual([]);
  }
});

test("is laid out without sideways scrolling, at every width", async ({
  page,
}) => {
  await serveImages(page);
  for (const which of ["grace", "long"] as const) {
    await openArtist(page, which);
    for (const width of [320, 390, 720, 721, 1024, 1440, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await overflow(page),
        `${which} at ${width}px`,
      ).toBeLessThanOrEqual(0);
    }
  }
});

test("answers the not-found view for an artist with no public writing", async ({
  page,
}) => {
  const response = await page.goto(`${base}/artists/${HIDDEN_ADDRESS}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText("this track skipped")).toBeVisible();
});
