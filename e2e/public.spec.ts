import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { env } from "./support";

// The public album journal in a browser (M3.1), anonymous, from the second
// server of the same production build that has public reads switched on
// (e2e/global-setup.ts). It runs at desktop width and at 390 px. The journal
// is the synthetic Grace / Jeff Buckley fixture; every piece of writing in it
// is labelled "[Test]". Screenshots are written only when E2E_SCREENSHOTS=1,
// to visual-review/m3-1/, which Git ignores.

const base = env("E2E_PUBLIC_URL");
const slug = env("E2E_PUBLIC_SLUG");
const draftSlug = env("E2E_PUBLIC_DRAFT_SLUG");
const entryId = env("E2E_PUBLIC_ENTRY_ID");
const opening = env("E2E_PUBLIC_OPENING");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const execFileAsync = promisify(execFile);

test.describe.configure({ mode: "serial" });

async function seedCommand(command: "publish" | "unpublish") {
  await execFileAsync(
    "pnpm",
    [
      "--silent",
      "tsx",
      "--conditions=react-server",
      "src/testing/public-seed-cli.ts",
      command,
      entryId,
    ],
    { env: process.env },
  );
}

async function openJournal(page: Page) {
  const response = await page.goto(`${base}/albums/${slug}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Grace");
  // The streamed page has finished once the last section is there.
  await expect(
    page.getByRole("heading", { name: "Track by track" }),
  ).toBeVisible();
}

function isMobile(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1440) <= 720;
}

test("shows the album journal as the approved screen does", async ({
  page,
}) => {
  await openJournal(page);

  await expect(page.getByText("Album journal")).toBeVisible();
  await expect(page.getByText("Jeff Buckley").first()).toBeVisible();
  await expect(page.getByText("1994 · Columbia · 6 tracks")).toBeVisible();
  await expect(page.locator(".pj-opening")).toHaveText(opening);
  await expect(page.locator(".pj-rating")).toContainText("My rating");
  await expect(page.locator(".pj-rating")).toContainText("[4.5] / 5");
  await expect(
    page.getByRole("img", { name: "My rating: 4.5 out of 5" }).first(),
  ).toBeVisible();
  await expect(page.getByText("Written in English")).toBeVisible();

  // The writing's own structure, under the page title.
  await expect(page.locator(".pj-body h2")).toHaveText("[Test] A subheading");
  await expect(page.locator(".pj-body blockquote")).toBeVisible();

  // Six tracks, in order; three have a public reflection, three do not.
  const rows = page.locator(".pj-track");
  await expect(rows).toHaveCount(6);
  await expect(page.locator(".pj-track-number").first()).toHaveText("01");
  await expect(page.locator(".pj-track-unwritten")).toHaveCount(3);
  await expect(page.getByText("not written yet")).toHaveCount(3);
  // The favourite is circled and named; "still writing" is a real label.
  await expect(page.locator(".pj-fav")).toHaveCount(1);
  await expect(page.locator(".pj-fav")).toContainText("Last Goodbye");
  await expect(page.getByText("(still writing)")).toHaveCount(1);
  await expect(page.getByText("by James Shelton")).toBeVisible();

  // Nothing private, and no author control.
  await expect(page.getByText("PRIVATE-")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /studio|edit|publish|sign in/i }),
  ).toHaveCount(0);

  // The header has navigation only, the footer its closing line and nothing
  // else (the language selector arrives with next-intl).
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.locator(".public-closing")).toHaveText(
    "some songs take you back.",
  );
  await expect(
    page.locator(".public-header img, .public-header svg"),
  ).toHaveCount(0);
});

test("uses the approved typefaces and the approved sizes", async ({ page }) => {
  await openJournal(page);
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

  const title = await style(".pj-title");
  expect(title.family).toContain("Kalam");
  expect(title.weight).toBe("700");
  expect(title.size).toBe(mobile ? "62px" : "104px");

  const opening = await style(".pj-opening");
  expect(opening.family).toContain("Kalam");
  expect(opening.weight).toBe("300");
  expect(opening.size).toBe(mobile ? "26px" : "31px");

  const body = await style(".pj-body p");
  expect(body.family).toContain("Alegreya");
  expect(body.size).toBe(mobile ? "19.5px" : "21px");

  // Only the two approved faces are in use by anything that is shown.
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

test("is black ink on white paper: no color anywhere", async ({ page }) => {
  await openJournal(page);
  const colored = await page.evaluate(() => {
    const isGray = (value: string) => {
      const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(
        value,
      );
      if (!match) return true;
      if (match[4] !== undefined && Number(match[4]) === 0) return true;
      // The design's own paper tokens (#F4F4F2, #F6F6F4, #F7F7F5) are off
      // gray by two parts in 255; any real hue is far beyond that.
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
        "borderLeftColor",
        "outlineColor",
        "textDecorationColor",
      ] as const) {
        if (!isGray(css[property])) {
          found.push(
            `${element.tagName}.${element.className} ${property} ${css[property]}`,
          );
        }
      }
    }
    return found;
  });
  expect(colored).toEqual([]);
});

test("fits the screen without horizontal scrolling, and keeps the reading measure", async ({
  page,
}) => {
  await openJournal(page);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // The long-form measure is about 62 characters, never the full width.
  const width = await page
    .locator(".pj-body")
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(isMobile(page) ? 390 : 62 * 15);

  if (isMobile(page)) {
    // One column: the artwork, then the heading, then the facts, then the writing.
    const tops = await page.evaluate(() =>
      [".pj-art", ".pj-head", ".pj-meta", ".pj-body"].map(
        (selector) =>
          document.querySelector(selector)!.getBoundingClientRect().top,
      ),
    );
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    const lefts = await page.evaluate(() =>
      [".pj-art", ".pj-head", ".pj-body"].map(
        (selector) =>
          document.querySelector(selector)!.getBoundingClientRect().left,
      ),
    );
    expect(new Set(lefts.map((left) => Math.round(left))).size).toBe(1);
    // The artwork and the track list use the full width of the column.
    const widths = await page.evaluate(() => {
      const shell = document
        .querySelector(".pj")!
        .getBoundingClientRect().width;
      return [".pj-art", ".pj-tracks"].map(
        (selector) =>
          document.querySelector(selector)!.getBoundingClientRect().width /
          shell,
      );
    });
    for (const ratio of widths) {
      expect(ratio).toBeGreaterThan(0.98);
    }
    // A track's rating moves under its title.
    const row = page.locator("summary.pj-track-row").first();
    const [title, rating] = await Promise.all([
      row.locator(".pj-track-name").boundingBox(),
      row.locator(".pj-track-rating").boundingBox(),
    ]);
    expect(rating!.y).toBeGreaterThan(title!.y + title!.height - 1);
  } else {
    // Two columns: the artwork beside the title, 5fr and 7fr.
    const [art, head] = await Promise.all([
      page.locator(".pj-art").boundingBox(),
      page.locator(".pj-head").boundingBox(),
    ]);
    expect(head!.x).toBeGreaterThan(art!.x + art!.width);
    expect(Math.abs(head!.y - art!.y)).toBeLessThan(20);
    const ratio = art!.width / head!.width;
    expect(ratio).toBeGreaterThan(5 / 7 - 0.1);
    expect(ratio).toBeLessThan(5 / 7 + 0.1);
  }
});

test("every control is at least 44px", async ({ page }) => {
  await openJournal(page);
  const small = await page.evaluate(() => {
    const found: string[] = [];
    for (const element of document.querySelectorAll("a, summary, button")) {
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

test("a track opens and closes with the keyboard, and focus is always visible", async ({
  page,
}) => {
  await openJournal(page);
  const first = page.locator("summary.pj-track-row").first();
  const details = page.locator(".pj-track details").first();
  await expect(details).not.toHaveAttribute("open", "");
  await expect(page.locator(".pj-reflection").first()).toBeHidden();

  for (let presses = 0; presses < 12; presses += 1) {
    await page.keyboard.press("Tab");
    if (await first.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(first).toBeFocused();
  const outline = await first.evaluate((el) => {
    const css = getComputedStyle(el);
    return { style: css.outlineStyle, width: css.outlineWidth };
  });
  expect(outline.style).toBe("solid");
  expect(outline.width).toBe("2px");

  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await expect(page.locator(".pj-reflection").first()).toBeVisible();
  await expect(page.locator(".pj-reflection").first()).toContainText(
    "[Test] A public reflection on Mojo Pin.",
  );
  await page.keyboard.press("Space");
  await expect(details).not.toHaveAttribute("open", "");

  // "Go to the tracks" is a plain link to the section.
  await page.getByRole("link", { name: "Go to the tracks" }).click();
  await expect(page).toHaveURL(/#tracks$/);
});

test("respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openJournal(page);
  const durations = await page.evaluate(() =>
    [".public-link", ".pj-chevron"].map(
      (selector) =>
        getComputedStyle(document.querySelector(selector)!).transitionDuration,
    ),
  );
  expect(durations).toEqual(["0s", "0s"]);
});

test("labels the written language and keeps the document in English", async ({
  page,
}) => {
  await openJournal(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".pj-opening")).toHaveAttribute("lang", "en");
  await expect(page.locator(".pj-body")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Grace · Jeff Buckley · refrain");
});

test("loads nothing from another origin and logs no error", async ({
  page,
}) => {
  const hosts = new Set<string>();
  const errors: string[] = [];
  page.on("request", (request) => hosts.add(new URL(request.url()).host));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await openJournal(page);
  await page.locator("summary.pj-track-row").first().click();
  expect([...hosts]).toEqual([new URL(base).host]);
  expect(errors).toEqual([]);
});

test("has no accessibility violations (WCAG 2.2 A and AA), tracks open", async ({
  page,
}) => {
  await openJournal(page);
  for (const row of await page.locator("summary.pj-track-row").all()) {
    await row.click();
  }
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    result.violations.map((v) => ({
      rule: v.id,
      impact: v.impact,
      targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
    })),
  ).toEqual([]);
});

test("a draft, and an unknown address, show the same not-found view with a real 404", async ({
  page,
}) => {
  const draft = await page.goto(`${base}/albums/${draftSlug}`);
  expect(draft?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Nothing here",
  );
  const draftText = await page.locator("body").innerText();
  expect(draftText).not.toContain("PRIVATE");
  expect(draftText).not.toContain("Draft album");

  const unknown = await page.goto(`${base}/albums/e2e-no-such-journal`);
  expect(unknown?.status()).toBe(404);
  expect(await page.locator("body").innerText()).toBe(draftText);
  await expect(page).toHaveTitle("Not found · refrain");

  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
});

test("a trailing slash is normalized to the same address", async ({ page }) => {
  await openJournal(page);
  const response = await page.goto(`${base}/albums/${slug}/`);
  // A trailing slash is normalized to the same address for every address.
  expect(new URL(page.url()).pathname).toBe(`/albums/${slug}`);
  expect(response?.status()).toBe(200);
});

test("unpublishing is seen at once, including when going back", async ({
  page,
}) => {
  await openJournal(page);
  await page.goto(`${base}/`);
  try {
    await seedCommand("unpublish");
    // Back to a page that was public a moment ago: the browser may not show it
    // from its own history, because the response was `no-store`.
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Nothing here",
    );
    await expect(page.getByText(opening)).toHaveCount(0);
    // A reload and a fresh visit agree.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Nothing here",
    );
    const fresh = await page.request.get(`${base}/albums/${slug}`);
    expect(fresh.status()).toBe(404);
  } finally {
    await seedCommand("publish");
  }
  const back = await page.goto(`${base}/albums/${slug}`);
  expect(back?.status()).toBe(200);
});

test("screenshots, when asked for", async ({ page }, testInfo) => {
  test.skip(process.env.E2E_SCREENSHOTS !== "1", "set E2E_SCREENSHOTS=1");
  mkdirSync("visual-review/m3-1", { recursive: true });
  await openJournal(page);
  const name = testInfo.project.name;
  await page.screenshot({
    path: `visual-review/m3-1/${name}-closed.png`,
    fullPage: true,
  });
  await page.locator("summary.pj-track-row").nth(1).click();
  await page.screenshot({
    path: `visual-review/m3-1/${name}-open.png`,
    fullPage: true,
  });
  await page.goto(`${base}/albums/e2e-no-such-journal`);
  await page.screenshot({
    path: `visual-review/m3-1/${name}-not-found.png`,
    fullPage: true,
  });
});
