import { expect, test, type Page } from "@playwright/test";

import {
  createAlbumThroughStudio,
  expectNoHorizontalOverflow,
  named,
} from "./support";

// The journal editor's keyboard and scrolling behavior, at a desktop and a
// phone width: the skip link is hidden until it has focus, the sticky action
// bar never covers the field that has focus, and a long opening sentence
// scrolls inside its own field without widening the page. Everything is
// synthetic. (A full-page screenshot taken from a scrolled page paints fixed
// and sticky elements where the scroll left them, which once looked like a
// defect in review screenshots; these tests look at the real page instead.)

test.describe.configure({ mode: "serial" });

const LONG_OPENING =
  "[Test] E2E A synthetic opening sentence that is deliberately much longer than a phone is wide, so that it has to scroll sideways inside its own field instead of widening the page.";
const paragraph = (n: number) =>
  `[Test] E2E Synthetic paragraph ${n}, written for these tests and for nothing else: a few sentences of plain prose, long enough to wrap over several lines on a narrow screen and to make the writing area tall.`;

const WIDTHS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const;

// macOS moves the caret to the end of a line with Cmd+Right, not End.
const LINE_END = process.platform === "darwin" ? "Meta+ArrowRight" : "End";
const LINE_START = process.platform === "darwin" ? "Meta+ArrowLeft" : "Home";

let editUrl = "";

test("set up a journal with a long opening sentence, a long reflection, and tracks", async ({
  page,
}) => {
  const created = await createAlbumThroughStudio(page, {
    artist: named("Editor Artist"),
    album: named("Editor Album"),
  });
  for (let n = 1; n <= 4; n++) {
    await page.locator("#new-track-title").fill(named(`Editor Song ${n}`));
    await page.getByRole("button", { name: "Create and add" }).click();
    await expect(
      page.getByRole("list", { name: "Tracklist" }).getByRole("listitem"),
    ).toHaveCount(n);
  }
  await page.goto(
    `/studio/journals/new?album=${created.albumUrl.split("/").pop()}`,
  );
  await page.getByLabel("Opening sentence (optional)").fill(LONG_OPENING);
  await page
    .getByLabel("Your reflection", { exact: true })
    .fill(Array.from({ length: 14 }, (_, i) => paragraph(i + 1)).join("\n\n"));
  await page.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/studio\/journals\/[0-9a-f-]{36}$/);
  editUrl = `${page.url()}/edit`;
});

async function openEditor(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(editUrl);
  await expect(
    page.getByLabel("Your reflection", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);
}

const skipLink = (page: Page) =>
  page.getByRole("link", { name: "Skip to the content" });

// The skip link's box in the viewport: off screen above it until it has focus.
async function skipTop(page: Page) {
  return (await skipLink(page).boundingBox())!.y;
}

for (const { name, width, height } of WIDTHS) {
  test(`at ${name}px: the skip link is hidden at every scroll position and shown only by the keyboard`, async ({
    page,
  }) => {
    await openEditor(page, width, height);
    for (const y of [0, 400, 900, 1500, 99999]) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      expect(await skipTop(page), `scrolled to ${y}`).toBeLessThan(-20);
    }
    // A pointer click on the page does not show it either.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByLabel("Your reflection", { exact: true }).click();
    expect(await skipTop(page)).toBeLessThan(-20);

    // The first Tab from the top of the page shows it, in view; the next hides it.
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    await page.keyboard.press("Tab");
    await expect(skipLink(page)).toBeFocused();
    expect(await skipTop(page)).toBeGreaterThanOrEqual(0);
    await page.keyboard.press("Tab");
    await expect(skipLink(page)).not.toBeFocused();
    expect(await skipTop(page)).toBeLessThan(-20);
  });

  test(`at ${name}px: the sticky bar follows the scroll and never covers the field that has focus`, async ({
    page,
  }) => {
    await openEditor(page, width, height);
    const bar = page.locator(".studio-editorbar");
    const barBox = async () => (await bar.boundingBox())!;

    // Once the page has scrolled past it, the bar sits at the top of the screen.
    await page.evaluate(() => window.scrollTo(0, 900));
    expect((await barBox()).y).toBeLessThanOrEqual(1);
    expect((await barBox()).height).toBeLessThan(80);

    // A field focused from far away is scrolled clear of the bar.
    for (const field of [
      page.getByLabel("Opening sentence (optional)"),
      page.getByLabel("Your reflection", { exact: true }),
    ]) {
      await page.evaluate(() => window.scrollTo(0, 99999));
      await field.focus();
      const box = (await field.boundingBox())!;
      const stuck = await barBox();
      expect(box.y, "the field's top is below the bar").toBeGreaterThanOrEqual(
        stuck.y + stuck.height - 1,
      );
    }

    // Tab, and Shift+Tab, through the whole editor with a track open: no
    // control that is not in the bar is ever left under it.
    await page.goto(editUrl);
    await page.getByRole("button", { name: /^Track 1:/ }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    const covered: string[] = [];
    let stops = 0;
    for (const key of ["Tab", "Shift+Tab"]) {
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press(key);
        const result = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          const barEl = document.querySelector(
            ".studio-editorbar",
          ) as HTMLElement | null;
          if (!el || el === document.body || !barEl) return null;
          const r = el.getBoundingClientRect();
          const b = barEl.getBoundingClientRect();
          const sticking = b.top <= 1;
          const overlaps =
            r.bottom > b.top &&
            r.top < b.bottom &&
            r.right > b.left &&
            r.left < b.right;
          return {
            covered:
              sticking &&
              overlaps &&
              !barEl.contains(el) &&
              !el.classList.contains("studio-skip"),
            label: `${el.tagName.toLowerCase()} ${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}`,
          };
        });
        if (result) {
          stops += 1;
          if (result.covered) covered.push(result.label);
        }
      }
    }
    expect(stops, "the keyboard visited the editor").toBeGreaterThan(40);
    expect(covered, "controls left under the sticky bar").toEqual([]);
  });

  test(`at ${name}px: a long opening sentence scrolls inside its field and does not widen the page`, async ({
    page,
  }) => {
    await openEditor(page, width, height);
    const field = page.getByLabel("Opening sentence (optional)");
    const state = () =>
      field.evaluate((el: HTMLInputElement) => ({
        scrollLeft: Math.round(el.scrollLeft),
        reach: Math.round(el.scrollLeft + el.clientWidth),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        start: el.selectionStart,
        end: el.selectionEnd,
        length: el.value.length,
        value: el.value,
      }));

    const before = await state();
    expect(
      before.scrollWidth,
      "the text is wider than the field",
    ).toBeGreaterThan(before.clientWidth);
    await expectNoHorizontalOverflow(page);

    // Keyboard focus, then the caret to the end: the field scrolls so that the
    // caret is in view.
    await field.focus();
    await page.keyboard.press(LINE_END);
    let now = await state();
    expect(now.start).toBe(now.length);
    expect(now.scrollLeft).toBeGreaterThan(0);
    expect(now.reach).toBeGreaterThanOrEqual(now.scrollWidth - 2);

    // Typing at the end keeps the caret in view and changes only the field.
    await page.keyboard.type(" and then some more words");
    now = await state();
    expect(now.value.endsWith(" and then some more words")).toBe(true);
    expect(now.reach).toBeGreaterThanOrEqual(now.scrollWidth - 2);
    await expectNoHorizontalOverflow(page);

    // Back to the start, and a selection through to the end, and select all.
    await page.keyboard.press(LINE_START);
    now = await state();
    expect(now.start).toBe(0);
    expect(now.scrollLeft).toBe(0);
    await page.keyboard.press("Shift+" + LINE_END);
    now = await state();
    expect([now.start, now.end]).toEqual([0, now.length]);
    await page.keyboard.press("ControlOrMeta+a");
    now = await state();
    expect(now.end! - now.start!).toBe(now.length);

    // A selection dragged past the right edge scrolls the field with it.
    const box = (await field.boundingBox())!;
    await page.keyboard.press(LINE_START);
    await page.mouse.move(box.x + 12, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, {
      steps: 6,
    });
    await expect
      .poll(async () => (await state()).scrollLeft, { timeout: 5000 })
      .toBeGreaterThan(0);
    await page.mouse.up();
    now = await state();
    expect(now.end! - now.start!).toBeGreaterThan(0);
    await expectNoHorizontalOverflow(page);
  });
}
