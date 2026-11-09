import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { env, withDatabase } from "./support";

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
    // The heading sits on the artwork's lower edge, as in the approved screen.
    expect(
      Math.abs(head!.y + head!.height - (art!.y + art!.height)),
    ).toBeLessThan(20);
    // The facts and the writing start together, one row below.
    const [meta, body] = await Promise.all([
      page.locator(".pj-meta").boundingBox(),
      page.locator(".pj-body").boundingBox(),
    ]);
    expect(Math.abs(meta!.y - body!.y)).toBeLessThan(4);
    expect(meta!.y).toBeGreaterThan(art!.y + art!.height);
    // The opening sentence keeps its measure instead of running the full column.
    const opening = await page.locator(".pj-opening").boundingBox();
    expect(opening!.width).toBeLessThan(head!.width * 0.95);
    const ratio = art!.width / head!.width;
    expect(ratio).toBeGreaterThan(5 / 7 - 0.1);
    expect(ratio).toBeLessThan(5 / 7 + 0.1);
  }
});

const smallControls = (page: Page) =>
  page.evaluate(() => {
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

test("every control is at least 44px, on the journal and on the not-found view", async ({
  page,
}) => {
  await openJournal(page);
  expect(await smallControls(page)).toEqual([]);
  await page.goto(`${base}/albums/e2e-no-such-journal`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Nothing here",
  );
  expect(await smallControls(page)).toEqual([]);
});

test("reflows at 320 px and at 200% text without scrolling sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openJournal(page);
  await page.locator("summary.pj-track-row").first().click();
  const overflow = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  expect(await overflow()).toBeLessThanOrEqual(0);
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

test("closes with the way back to the albums and to the credited artist, in keyboard order", async ({
  page,
}) => {
  await openJournal(page);
  const closing = page.getByRole("navigation", { name: "Keep reading" });
  const all = closing.getByRole("link", { name: "All albums" });
  const more = closing.getByRole("link", { name: "More about Jeff Buckley" });
  await expect(all).toHaveAttribute("href", "/albums");
  await expect(more).toHaveAttribute("href", /^\/artists\//);
  for (const link of [all, more]) {
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }

  // Tab reaches both, in reading order, with a visible ring.
  await page.locator(".pj-track summary").last().focus();
  await page.keyboard.press("Tab");
  await expect(all).toBeFocused();
  expect(
    await all.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe("solid");
  await page.keyboard.press("Tab");
  await expect(more).toBeFocused();
  expect(
    await more.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe("solid");

  await more.click();
  await expect(page).toHaveURL(/\/artists\//);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Jeff Buckley",
  );
  await openJournal(page);
  await page
    .getByRole("navigation", { name: "Keep reading" })
    .getByRole("link", { name: "All albums" })
    .click();
  await expect(page).toHaveURL(`${base}/albums`);
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

// The skip link (M3.1 owner review): the first tab stop, hidden until it has
// keyboard focus, then drawn clear of the page's writing; activating it moves
// focus to the one <main>.
for (const reducedMotion of ["no-preference", "reduce"] as const) {
  for (const view of ["journal", "not found"] as const) {
    test(`the skip link is the first tab stop, appears only on focus, and skips to the content (${view}, motion: ${reducedMotion})`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion });
      if (view === "journal") {
        await openJournal(page);
      } else {
        await page.goto(`${base}/albums/e2e-no-such-journal`);
      }
      const skip = page.getByRole("link", { name: "Skip to content" });
      const viewport = page.viewportSize()!;
      const box = () =>
        skip.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, right: r.right, bottom: r.bottom, left: r.left };
        });

      // At rest it is off screen: nothing for a pointer user to see.
      expect((await box()).bottom).toBeLessThanOrEqual(0);
      expect(await page.locator("#main").count()).toBe(1);

      const restMainTop = await page
        .locator("main")
        .evaluate((el) => el.getBoundingClientRect().top);

      // The first Tab reaches it, and it is drawn on screen.
      await page.keyboard.press("Tab");
      await expect(skip).toBeFocused();
      const shown = await box();
      expect(shown.top).toBeGreaterThanOrEqual(0);
      expect(shown.left).toBeGreaterThanOrEqual(0);
      expect(shown.right).toBeLessThanOrEqual(viewport.width);
      expect(shown.bottom - shown.top).toBeGreaterThanOrEqual(44);
      const look = await skip.evaluate((el) => {
        const css = getComputedStyle(el);
        return {
          font: css.fontFamily,
          background: css.backgroundColor,
          color: css.color,
          outline: `${css.outlineStyle} ${css.outlineWidth}`,
        };
      });
      expect(look.font).toMatch(/Kalam/);
      expect(look.background).toBe("rgb(17, 17, 17)");
      expect(look.color).toBe("rgb(255, 255, 255)");
      expect(look.outline).toBe("solid 2px");

      // It covers nothing visible: a navigation link under it is drawn
      // invisible while it has focus, and it never reaches the writing.
      const navigation = await page
        .locator(".public-link")
        .evaluateAll((links) =>
          links.map((link) => {
            const r = link.getBoundingClientRect();
            return {
              top: r.top,
              bottom: r.bottom,
              left: r.left,
              right: r.right,
              opacity: getComputedStyle(link.closest("ul")!).opacity,
            };
          }),
        );
      expect(navigation.length).toBeGreaterThan(0);
      for (const link of navigation) {
        const overlaps =
          shown.left < link.right &&
          shown.right > link.left &&
          shown.top < link.bottom &&
          shown.bottom > link.top;
        if (overlaps) {
          expect(link.opacity, "a link under the skip link is visible").toBe(
            "0",
          );
        }
      }
      // The page does not move while it is focused: the content starts where
      // it starts at rest.
      const mainAtRest = restMainTop;
      const main = await page
        .locator("main")
        .evaluate((el) => el.getBoundingClientRect().top);
      expect(shown.bottom).toBeLessThanOrEqual(main);
      expect(main).toBe(mainAtRest);

      // Nothing about it breaks the page's accessibility.
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(results.violations).toEqual([]);

      // Activating it goes to the content: the address names it, and focus
      // moves into <main>, so the next Tab continues from there.
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/#main$/);
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.id))
        .toBe("main");
      // The jump lands on the content: its top is on screen, not scrolled past
      // by the height of anything that moved.
      const landed = await page
        .locator("main")
        .evaluate((el) => el.getBoundingClientRect().top);
      expect(landed).toBeGreaterThanOrEqual(0);
      const ring = await page
        .locator("main")
        .evaluate((el) => getComputedStyle(el).outlineStyle);
      expect(ring).toBe("none");
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(
        () => !!document.activeElement?.closest("main"),
      );
      // The not-found view has a link in <main>; the journal has controls.
      expect(inside).toBe(true);

      // And it is gone again once focus leaves it.
      expect((await box()).bottom).toBeLessThanOrEqual(0);
    });
  }
}

// The approved 404 drawing on the shared not-found view (M3.1 owner review).
test("the not-found view shows the approved drawing, responsive and accessible", async ({
  page,
}) => {
  const response = await page.goto(`${base}/albums/e2e-no-such-journal`);
  expect(response?.status()).toBe(404);
  const art = page.getByRole("img", { name: /map marked 404/ });
  await expect(art).toBeVisible();
  // The original file, loaded in full: its own proportions, not stretched.
  const loaded = await art.evaluate((el) => {
    const image = el as HTMLImageElement;
    const box = image.getBoundingClientRect();
    return {
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      src: new URL(image.currentSrc).pathname,
      ratio: box.width / box.height,
      width: box.width,
    };
  });
  expect(loaded.complete).toBe(true);
  expect([loaded.naturalWidth, loaded.naturalHeight]).toEqual([1536, 1024]);
  expect(loaded.src).toBe("/artwork/refrain-404.webp");
  expect(loaded.ratio).toBeCloseTo(1536 / 1024, 2);
  // Its transparency survives in the browser: the corners and about half the
  // picture are fully clear, and the drawing itself is solid (the decoded
  // WebP, read back through a canvas).
  const alpha = await art.evaluate((el) => {
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
    let solid = 0;
    let sampled = 0;
    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 4) {
        const a = at(x, y);
        sampled += 1;
        if (a === 0) clear += 1;
        if (a >= 224) solid += 1;
      }
    }
    return {
      corners: [
        at(0, 0),
        at(width - 1, 0),
        at(0, height - 1),
        at(width - 1, height - 1),
      ],
      clear: clear / sampled,
      solid: solid / sampled,
    };
  });
  expect(alpha.corners).toEqual([0, 0, 0, 0]);
  expect(alpha.clear).toBeGreaterThan(0.4);
  expect(alpha.solid).toBeGreaterThan(0.4);
  // At most 560px, and never wider than the page's own container.
  const viewport = page.viewportSize()!;
  expect(loaded.width).toBeLessThanOrEqual(560.5);
  expect(loaded.width).toBeLessThanOrEqual(viewport.width - 35);
  // The message stays the heading, and the drawing sits above it, inside <main>.
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("Nothing here");
  const [artBox, headingBox] = await Promise.all([
    art.boundingBox(),
    heading.boundingBox(),
  ]);
  expect(artBox!.y + artBox!.height).toBeLessThanOrEqual(headingBox!.y);
  expect(await page.locator("main img").count()).toBe(1);
  // It reflows without sideways scrolling, down to 320px.
  await page.setViewportSize({ width: 320, height: 700 });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  // No accessibility violation with the drawing in place.
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test("the not-found view reserves the drawing's space before it loads, so nothing shifts", async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/artwork/refrain-404.webp", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(`${base}/albums/e2e-no-such-journal`, {
    waitUntil: "domcontentloaded",
  });
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("Nothing here");
  const before = (await heading.boundingBox())!.y;
  const art = page.getByRole("img", { name: /map marked 404/ });
  expect(await art.evaluate((el) => (el as HTMLImageElement).complete)).toBe(
    false,
  );
  release();
  await expect
    .poll(() => art.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBe(1536);
  expect((await heading.boundingBox())!.y).toBe(before);
});

test("the not-found message and link survive a drawing that fails to load", async ({
  page,
}) => {
  await page.route("**/artwork/refrain-404.webp", (route) => route.abort());
  await page.goto(`${base}/albums/e2e-no-such-journal`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Nothing here",
  );
  await expect(
    page.getByRole("link", { name: "Back to the start" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
});

test("the not-found drawing keeps its own white ground in forced colors", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto(`${base}/albums/e2e-no-such-journal`);
  const art = page.getByRole("img", { name: /map marked 404/ });
  await expect(art).toBeVisible();
  const look = await art.evaluate((el) => {
    const css = getComputedStyle(el);
    return { adjust: css.forcedColorAdjust, background: css.backgroundColor };
  });
  expect(look.adjust).toBe("none");
  expect(look.background).toBe("rgb(255, 255, 255)");
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

const RATING_STATES: [number | null, string][] = [
  [null, ""],
  [1, "0.5"],
  [2, "1"],
  [5, "2.5"],
  [9, "4.5"],
  [10, "5"],
];

async function setRatings(halfSteps: number | null) {
  await withDatabase(async (client) => {
    await client.query(
      "update album_journals set rating_half_steps = $1 where entry_id = $2",
      [halfSteps, entryId],
    );
    await client.query(
      "update track_reflections set rating_half_steps = $1 where album_journal_id = $2 and is_published",
      [halfSteps, entryId],
    );
  });
}

async function savedRatings() {
  return withDatabase(async (client) => ({
    album: (
      await client.query<{ value: number | null }>(
        "select rating_half_steps as value from album_journals where entry_id = $1",
        [entryId],
      )
    ).rows[0]!.value,
    tracks: (
      await client.query<{ track_id: string; value: number | null }>(
        "select track_id, rating_half_steps as value from track_reflections where album_journal_id = $1 and is_published",
        [entryId],
      )
    ).rows,
  }));
}

async function restoreRatings(saved: Awaited<ReturnType<typeof savedRatings>>) {
  await withDatabase(async (client) => {
    await client.query(
      "update album_journals set rating_half_steps = $1 where entry_id = $2",
      [saved.album, entryId],
    );
    for (const track of saved.tracks) {
      await client.query(
        "update track_reflections set rating_half_steps = $1 where album_journal_id = $2 and track_id = $3",
        [track.value, entryId, track.track_id],
      );
    }
  });
}

test("draws every rating as the stars it is, read-only, with its sentence", async ({
  page,
}) => {
  const saved = await savedRatings();
  try {
    for (const [halfSteps, value] of RATING_STATES) {
      await setRatings(halfSteps);
      await openJournal(page);
      if (halfSteps === null) {
        await expect(page.locator(".pj-rating")).toHaveCount(0);
        await expect(page.locator(".pj-track-rating .pj-stars")).toHaveCount(0);
        continue;
      }
      const rating = page.locator(".pj-rating");
      const name = `My rating: ${value} out of 5`;
      await expect(
        rating.getByRole("img", { name, exact: true }),
      ).toBeVisible();
      await expect(rating).toContainText(`[${value}] / 5`);
      const fills = await rating
        .locator(".pj-stars svg")
        .evaluateAll((drawings) =>
          drawings.map((drawing) => drawing.getAttribute("data-fill")),
        );
      expect(fills).toEqual(
        [2, 4, 6, 8, 10].map((whole) =>
          halfSteps >= whole
            ? "full"
            : halfSteps === whole - 1
              ? "half"
              : "empty",
        ),
      );
      const track = page.locator(".pj-track-rating").first();
      await expect(track.getByRole("img", { name, exact: true })).toBeVisible();
      await expect(track).toContainText(`[${value}]`);
      // The rating is drawn in the page's ink, and nothing in it is a control.
      await expect(rating.getByRole("radio")).toHaveCount(0);
      await expect(rating.locator("input, button")).toHaveCount(0);
    }
  } finally {
    await restoreRatings(saved);
  }
});

test("captures every state of the public rating, when asked for", async ({
  page,
}, testInfo) => {
  test.skip(process.env.E2E_SCREENSHOTS !== "1", "set E2E_SCREENSHOTS=1");
  test.skip(
    testInfo.project.name !== "public-desktop",
    "one project is enough",
  );
  test.setTimeout(240_000);
  const shots = `visual-review/ratings/${process.env.E2E_SCREENSHOTS_LABEL ?? "current"}`;
  mkdirSync(shots, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const saved = await savedRatings();
  try {
    for (const width of [1440, 390, 360, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [halfSteps] of RATING_STATES) {
        if (halfSteps === null) continue;
        await setRatings(halfSteps);
        await openJournal(page);
        await page.evaluate(() => document.fonts.ready);
        await page.locator(".pj-rating").screenshot({
          path: `${shots}/public-album-${width}-${halfSteps}.png`,
        });
        await page
          .locator(".pj-track-rating")
          .first()
          .screenshot({
            path: `${shots}/public-track-${width}-${halfSteps}.png`,
          });
      }
      await setRatings(9);
      await openJournal(page);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `${shots}/public-journal-${width}.png`,
        fullPage: true,
      });
    }
  } finally {
    await restoreRatings(saved);
  }
});

test("screenshots, when asked for", async ({ page }, testInfo) => {
  test.skip(process.env.E2E_SCREENSHOTS !== "1", "set E2E_SCREENSHOTS=1");
  mkdirSync("visual-review/m3-1", { recursive: true });
  // Settled frames: no transition is caught half way.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openJournal(page);
  const name = testInfo.project.name;
  await page.screenshot({
    path: `visual-review/m3-1/${name}-closed.png`,
    fullPage: true,
  });
  // The skip link, drawn while it has keyboard focus (the top of the page).
  await page.keyboard.press("Tab");
  await page.screenshot({
    path: `visual-review/m3-1/${name}-skip-focus.png`,
    clip: {
      x: 0,
      y: 0,
      width: page.viewportSize()!.width,
      height: 240,
    },
  });
  await page.locator("summary.pj-track-row").nth(1).click();
  // Move the pointer away, so no row is caught in its hover state.
  await page.mouse.move(0, 0);
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
