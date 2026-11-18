import { execFile } from "node:child_process";
import { promisify } from "node:util";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { env, withDatabase } from "./support";

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
const draftSlug = env("E2E_PUBLIC_DRAFT_SLUG");
const shelf = JSON.parse(env("E2E_PUBLIC_SHELF")) as {
  slug: string;
  entryId: string;
}[];

const execFileAsync = promisify(execFile);

/** The public seed's commands, against the disposable test database. */
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

/** The publication dates the public seed gives the Home's shelf. */
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

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const KEPT = "a music journal, kept by hand";
const TEST_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500"><rect width="500" height="500" fill="#1d4e89"/><circle cx="250" cy="230" r="120" fill="#c8553d"/></svg>`;

test.describe.configure({ mode: "serial" });

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
  await expect(page.getByText(KEPT)).toBeVisible();
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

// The v3 Home (docs/design-system.md, Part I, Pages: Home; evidence:
// docs/evidence/v3-public.md). These tests hold the properties the V4.4 tests
// held, on the v3 composition: only served journals, never a draft; A6's
// limits; the approved faces; no sideways scrolling at any width; 44px
// targets; no accessibility violation; complete without JavaScript; still
// under reduced motion; covers only from the archive; and the empty Home
// while public reads are off.

test("shows the v3 composition, with only what exists", async ({ page }) => {
  await openHome(page);
  // The Home's header: the sections stacked, no wordmark, nothing current.
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link")).toHaveText([
    "Albums",
    "Artists",
    "Memories",
  ]);
  await expect(nav.locator("[aria-current]")).toHaveCount(0);
  await expect(page.locator(".hdr .wm")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("refrain");
  // The newest journal opens from the hero.
  const latest = page.getByRole("link", { name: "Read the latest journal" });
  await expect(latest).toHaveAttribute("href", /^\/albums\//);
  // Every album link is a served journal; the draft never appears.
  const listed = await addresses(page);
  for (const slug of [graceSlug, ...shelf.map((journal) => journal.slug)]) {
    expect(listed).toContain(`/albums/${slug}`);
  }
  expect(listed).not.toContain(`/albums/${draftSlug}`);
  await expect(page.getByText("[Test] Draft album")).toHaveCount(0);
  await expect(page.getByText("PRIVATE-")).toHaveCount(0);
  // A6: at most five recent entries, four albums (the sleeve and its shelf).
  expect(await page.locator("#ph-recent .it").count()).toBeLessThanOrEqual(5);
  expect(
    (await page.locator(".sl.front").count()) +
      (await page.locator(".mini").count()),
  ).toBeLessThanOrEqual(4);
  // The archive links, and no link to the studio.
  const main = page.locator("main");
  await expect(
    main.getByRole("link", { name: "All album journals" }),
  ).toHaveAttribute("href", "/albums");
  await expect(
    page.getByRole("link", { name: /studio|sign in|edit/i }),
  ).toHaveCount(0);
  await expect(page.locator(".ftr .tg")).toHaveText(
    "some songs take you back.",
  );
});

test("uses only the four approved faces", async ({ page }) => {
  await openHome(page);
  const strays = await page.evaluate(() => {
    const found: string[] = [];
    for (const element of document.querySelectorAll("body *")) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const family = getComputedStyle(element).fontFamily;
      if (!/Archivo|Instrument Serif|Silkscreen|La Belle Aurore/.test(family)) {
        found.push(`${element.tagName}.${element.className}: ${family}`);
      }
    }
    return found;
  });
  expect(strays).toEqual([]);
  const name = await page
    .locator(".hero .w")
    .first()
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(name).toContain("Archivo");
});

test("never scrolls sideways, at any width", async ({ page }) => {
  await openHome(page);
  for (const width of [320, 390, 640, 720, 721, 768, 1024, 1280, 1440, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflow(page), `${width}px`).toBeLessThanOrEqual(0);
  }
});

test("a long title stays inside the latest journal's sleeve, at every width", async ({
  browser,
}) => {
  // The sleeve shows the latest journal's album. A long title once shrank its
  // white label until the label's own title ran out of it (as on the album
  // journal's sleeve). That album is renamed in the disposable database for
  // this test, in one transaction, and restored after it.
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await openHome(page);
  const shown = (await page.locator(".sl.front .card h3").textContent())!
    .trim()
    .replace(/\.$/, "");
  const longTitle =
    "[Test] E2E A Very Long Album Title That Goes On Well Past Two Lines";
  const albumId = await withDatabase(async (client) => {
    await client.query("begin");
    try {
      const album = await client.query<{ id: string }>(
        "select id from albums where title = $1",
        [shown],
      );
      expect(album.rows).toHaveLength(1);
      await client.query("update albums set title = $2 where id = $1", [
        album.rows[0]!.id,
        longTitle,
      ]);
      await client.query("commit");
      return album.rows[0]!.id;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
  try {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await openHome(page);
      await expect(page.locator(".sl.front .card h3")).toHaveText(
        `${longTitle}.`,
      );
      const boxes = await page.evaluate(() => {
        const rect = (selector: string) => {
          const box = document
            .querySelector(`.sl.front .card ${selector}`.trim())!
            .getBoundingClientRect();
          return { top: box.top, bottom: box.bottom };
        };
        return {
          card: rect(""),
          title: rect("h3"),
          cover: rect("h3 + *"),
          label: document.querySelector(".sl.front .card .covx b")
            ? rect(".covx b")
            : null,
          foot: rect(".foot"),
        };
      });
      for (const part of ["title", "cover", "foot"] as const) {
        expect(boxes[part].bottom, `${part} at ${width}px`).toBeLessThanOrEqual(
          boxes.card.bottom + 0.5,
        );
      }
      if (boxes.label) {
        expect(boxes.label.bottom, `label at ${width}px`).toBeLessThanOrEqual(
          boxes.cover.bottom + 0.5,
        );
      }
      expect(boxes.foot.top, `${width}px`).toBeGreaterThanOrEqual(
        boxes.cover.bottom - 0.5,
      );
    }
  } finally {
    await context.close();
    await withDatabase(async (client) => {
      await client.query("update albums set title = $2 where id = $1", [
        albumId,
        shown,
      ]);
    });
  }
});

test("the header's links and languages never overlap, at any width, in both languages", async ({
  page,
}) => {
  // On a phone the three 44 px section links once ran under the language
  // switch, which sat on top of "Memories".
  for (const prefix of ["", "/pt"]) {
    const response = await page.goto(`${base}${prefix || "/"}`);
    expect(response?.status()).toBe(200);
    await streamed(page);
    for (const width of [320, 390, 720, 721, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const boxes = await page.evaluate(() => {
        const box = (element: Element) => {
          const r = element.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        };
        return {
          links: [...document.querySelectorAll(".hdr nav a")].map(box),
          languages: [
            ...document.querySelectorAll(".hdr .lang a, .hdr .lang .lang-off"),
          ].map(box),
        };
      });
      expect(boxes.links).toHaveLength(3);
      expect(boxes.languages.length).toBeGreaterThanOrEqual(2);
      for (const link of boxes.links) {
        for (const language of boxes.languages) {
          const overlaps =
            link.left < language.right &&
            language.left < link.right &&
            link.top < language.bottom &&
            language.top < link.bottom;
          expect(overlaps, `${prefix || "/"} at ${width}px`).toBe(false);
        }
      }
    }
  }
});

test("every link and button in the page is at least 44px tall", async ({
  page,
}) => {
  await openHome(page);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("header a, footer a, footer button, .pill")]
      .map((element) => ({
        text: element.textContent?.trim(),
        height: element.getBoundingClientRect().height,
      }))
      .filter((target) => target.height > 0 && target.height < 44),
  );
  expect(small).toEqual([]);
});

test("loads nothing from another origin but the covers, and logs no error", async ({
  page,
}) => {
  const errors: string[] = [];
  const foreign: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.origin !== new URL(base).origin &&
      url.hostname !== "coverartarchive.org"
    ) {
      foreign.push(url.origin);
    }
  });
  await serveTestCovers(page);
  await openHome(page);
  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
});

test("works without JavaScript: the lists, their links, and the footer", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${base}/`);
  // Nothing waits to be revealed: every section is visible as sent.
  await expect(page.getByText(KEPT)).toBeVisible();
  const listed = await addresses(page);
  expect(listed).toContain(`/albums/${graceSlug}`);
  await expect(page.locator("#ph-recent .it").first()).toBeVisible();
  await expect(page.locator(".ftr .tg")).toBeVisible();
  await context.close();
});

test("has no accessibility violations (WCAG 2.2 A and AA)", async ({
  page,
}) => {
  // Settled, as a reader with reduced motion sees it: axe never measures
  // text halfway through an entrance.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openHome(page);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    results.violations.map(
      (violation) => `${violation.id}: ${violation.nodes.length}`,
    ),
  ).toEqual([]);
});

test("the skip link is the first tab stop, and leads to the content", async ({
  page,
}) => {
  await openHome(page);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test("respects reduced motion: everything is in place, and nothing animates", async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await openHome(page);
  const moving = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((animation) => animation.playState === "running").length,
  );
  expect(moving).toBe(0);
  const hidden = await page.evaluate(
    () =>
      [...document.querySelectorAll("[data-a]")].filter(
        (element) => getComputedStyle(element).opacity === "0",
      ).length,
  );
  expect(hidden).toBe(0);
  await context.close();
});

test("plays no sound until the reader turns it on: no AudioContext before, suspended after", async ({
  page,
}) => {
  // Every AudioContext the page makes is recorded, with its state.
  await page.addInitScript(() => {
    const made: AudioContext[] = [];
    (window as unknown as { __audio: AudioContext[] }).__audio = made;
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        made.push(this);
      }
    } as typeof AudioContext;
  });
  const contexts = () =>
    page.evaluate(() =>
      (window as unknown as { __audio: AudioContext[] }).__audio.map(
        (context) => context.state,
      ),
    );
  await openHome(page);
  const toggle = page.locator(".ftr .snd");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  // Scrolling reveals sections, and hovering a link: still no sound engine.
  await page.mouse.wheel(0, 2400);
  await page.locator(".hdr nav a").first().hover();
  expect(await contexts()).toEqual([]);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(contexts).toEqual(["running"]);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  // One engine, suspended, never a second one.
  await expect.poll(contexts).toEqual(["suspended"]);
});

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
  // The entrances move things on purpose (a transform, which is not a layout
  // shift); measured as a reader with reduced motion would see it too.
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion });
    await openHome(page);
    await page.waitForLoadState("networkidle");
    const shifts = await page.evaluate(
      () =>
        (
          window as unknown as {
            __shifts: { total: number; entries: string[] };
          }
        ).__shifts,
    );
    // A web font replacing its fallback can nudge a line by a fraction of a
    // pixel; anything a reader could see is far above this.
    expect(
      shifts.total,
      `${reducedMotion}: ${shifts.entries.join("; ")}`,
    ).toBeLessThan(0.01);
  }
});

test("reflows at 320 px, which is 200% zoom of a 640 px window and 400% of 1280 px, and with text at 200%", async ({
  page,
}) => {
  await openHome(page);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await overflow(page), "320 px").toBeLessThanOrEqual(0);
  // Text resized on its own (WCAG 1.4.4), where the faces are set in rem.
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  expect(await overflow(page), "200% text").toBeLessThanOrEqual(0);
});

test("keeps its rings, its text, and focus in the system's colours in forced-colours mode", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active", colorScheme: "dark" });
  await openHome(page);
  const look = await page.evaluate(() => {
    const css = (selector: string) =>
      getComputedStyle(document.querySelector(selector)!);
    return {
      footerTexture: css(".ftr .sheet").backgroundImage,
      boardTexture: css(".mem .sheet").backgroundImage,
      ring: css(".hdr nav a .penring path").stroke,
      language: css(".lang a[aria-current] .penring path").stroke,
      text: css(".ftr .tg").color,
    };
  });
  expect(look.footerTexture).toBe("none");
  expect(look.boardTexture).toBe("none");
  // The rings take system colours, never the pen's blue, which a dark system
  // canvas would swallow.
  expect(look.ring).not.toBe("rgb(43, 69, 196)");
  expect(look.language).not.toBe("rgb(43, 69, 196)");
  expect(look.ring).toBe(look.text);
  // A keyboard reader still sees where focus is.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const css = getComputedStyle(document.activeElement!);
    return { style: css.outlineStyle, width: css.outlineWidth };
  });
  expect(outline.style).toBe("solid");
  expect(outline.width).toBe("2px");
});

test("draws the pen ring around a section link that has keyboard focus", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openHome(page);
  const link = page.locator(".hdr nav a").first();
  const offset = () =>
    link
      .locator(".penring path")
      .evaluate((path) => getComputedStyle(path).strokeDashoffset);
  expect(await offset()).not.toBe("0px");
  await page.keyboard.press("Tab"); // the skip link
  await page.keyboard.press("Tab"); // the first section
  await expect(link).toBeFocused();
  await expect.poll(offset).toBe("0px");
});

test("with public reads off, it is the empty Home, whatever is published", async ({
  page,
}) => {
  const response = await page.goto(`${offBase}/`);
  expect(response?.status()).toBe(200);
  await expect(page.getByText("nothing pinned yet")).toBeVisible();
  await expect(page.locator("main a[href^='/albums/']")).toHaveCount(0);
  await expect(page.getByText("Grace")).toHaveCount(0);
});

// G2 on the Home (ADR 0006 A4: G2's checks, going back after an unpublish
// included, apply to `/`). The v3 Home links through prefetching client
// links, so this goes through them: a push navigation reads the lists again,
// and a link from a Home loaded before the change leads to the not-found
// view, never to the journal.
test("a change is seen on the next navigation, and a stale link leads nowhere", async ({
  page,
}) => {
  const pinkMoon = shelf.find((journal) =>
    journal.slug.endsWith("-pink-moon"),
  )!;
  const address = `/albums/${pinkMoon.slug}`;
  const heading = page.getByRole("heading", { level: 1 });
  const notFound = "this track skipped";
  await openHome(page);
  await page.locator(`main a[href="${address}"]`).first().click();
  await expect(page).toHaveURL(`${base}${address}`);
  await expect(heading).toContainText("Pink Moon");
  await seed("unpublish", pinkMoon.entryId);
  try {
    // A push navigation to the Home (the wordmark) reads the lists again.
    await page.locator(".hdr .wm").click();
    await expect(page).toHaveURL(`${base}/`);
    await streamed(page);
    expect(await addresses(page)).not.toContain(address);

    // Back: the browser may show the page it was sent before. Recorded for
    // the evidence; a reload asks the server again, and it is gone.
    await page.goBack();
    await expect(page).toHaveURL(`${base}${address}`);
    console.log(
      `back after unpublishing (${page.viewportSize()!.width}px): "${await heading.textContent()}"`,
    );
    await page.reload();
    await expect(heading).toContainText(notFound);

    // A Home loaded before the change still links it; following that stale
    // link shows the not-found view, never the journal.
    await seed("publish", pinkMoon.entryId, seededDate(pinkMoon.slug));
    await openHome(page);
    await expect(
      page.locator(`main a[href="${address}"]`).first(),
    ).toBeVisible();
    await seed("unpublish", pinkMoon.entryId);
    await page.locator(`main a[href="${address}"]`).first().click();
    await expect(heading).toContainText(notFound);
    await expect(page.getByText("[Test] A synthetic journal")).toHaveCount(0);
  } finally {
    await seed("publish", pinkMoon.entryId, seededDate(pinkMoon.slug));
  }
});

// The entrances never flash: content on screen when the page arrives is sent
// waiting (the page is armed on the server), so it enters once and never
// shows, vanishes at hydration, and comes back.
test("what is on screen when the page arrives enters once, and never vanishes after showing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const samples: number[][] = [];
    (window as unknown as { __samples: number[][] }).__samples = samples;
    const sample = () => {
      const watched = [
        ...document.querySelectorAll(".hero [data-a], .hdr nav a"),
      ].slice(0, 6);
      if (watched.length > 0) {
        samples.push(
          watched.map((element) => Number(getComputedStyle(element).opacity)),
        );
      }
      if (samples.length < 240) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await openHome(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __samples: number[][] }).__samples.length,
      ),
    )
    .toBeGreaterThanOrEqual(240);
  const samples = await page.evaluate(
    () => (window as unknown as { __samples: number[][] }).__samples,
  );
  // Per element: once it has shown (opacity above 0.9), it never drops back
  // under 0.1 in a later frame.
  const columns = samples[0]!.length;
  for (let column = 0; column < columns; column += 1) {
    let shown = false;
    for (const frame of samples) {
      const value = frame[column] ?? 1;
      if (shown) expect(value, `element ${column}`).toBeGreaterThan(0.1);
      if (value > 0.9) shown = true;
    }
  }
  // And everything ends in place.
  expect(samples.at(-1)!.every((value) => value > 0.99)).toBe(true);
});
