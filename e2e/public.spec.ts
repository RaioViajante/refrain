import { execFile } from "node:child_process";
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
  await expect(page.locator(".tk ol")).toBeVisible();
}

// The v3 album journal (docs/design-system.md, Part I, Pages: album journal;
// evidence: docs/evidence/v3-public.md). The properties the V4.4 tests held,
// on the v3 page: the projection (title, credits, opening, rating, margin
// note, writing, the language line), the tracks (public reflections only, the
// favourite and "still writing", "not written yet" for the rest), the
// approved faces, no sideways scrolling, 44px controls, tracks by keyboard,
// the way back, still under reduced motion, nothing from another origin,
// axe clean, the identical 404 for a draft and an unknown address, the
// indexing policy, a normalized address, unpublishing seen at once, and the
// rating drawn as it is.

const NOT_FOUND = "this track skipped";

test("shows the album journal's projection", async ({ page }) => {
  await openJournal(page);
  await expect(page.locator(".gtop .k")).toHaveText(
    /^ALBUM JOURNAL · \d+ TRACKS$/,
  );
  await expect(page.locator(".gtop .by")).toContainText("Jeff Buckley");
  await expect(page.locator(".gtop .by")).toContainText("1994");
  await expect(page.getByText(opening)).toBeVisible();
  await expect(
    page.getByRole("img", { name: "My rating: 4.5 out of 5" }).first(),
  ).toBeVisible();
  await expect(page.locator(".review .mg")).toBeVisible();
  await expect(page.locator(".review .fine2")).toContainText("IN ENGLISH");
  // Tracks: written ones open; the rest say so, without saying why.
  await expect(page.locator(".tk details.trw").first()).toBeVisible();
  await expect(page.locator(".trow.off .ny").first()).toHaveText(
    "NOT WRITTEN YET",
  );
  await expect(page.locator(".tk .note", { hasText: "the one" })).toHaveCount(
    1,
  );
  await expect(
    page.locator(".tk .note", { hasText: "still writing" }),
  ).toHaveCount(1);
  await expect(page.getByText("PRIVATE")).toHaveCount(0);
  await expect(page.locator(`a[href="/albums/${draftSlug}"]`)).toHaveCount(0);
});

test("uses only the four approved faces", async ({ page }) => {
  await openJournal(page);
  const strays = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => getComputedStyle(element).fontFamily)
      .filter(
        (family) =>
          !/Archivo|Instrument Serif|Silkscreen|La Belle Aurore/.test(family),
      ),
  );
  expect(strays).toEqual([]);
});

test("reflows at 320 px with a track open, and with text at 200%", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openJournal(page);
  await page.locator("summary.trow").first().click();
  const overflow = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
  expect(await overflow(), "320 px, a track open").toBeLessThanOrEqual(0);
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  expect(await overflow(), "200% text").toBeLessThanOrEqual(0);
});

test("fits the screen without sideways scrolling, at every width", async ({
  page,
}) => {
  await openJournal(page);
  for (const width of [320, 390, 720, 721, 1024, 1440, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
  }
});

test("a long title and artist stay inside the sleeve, at every width", async ({
  browser,
}) => {
  // A catalog title of the reference's length fits the sleeve; a long one
  // pushed the cover and the foot (year, handwritten artist) out of it, over
  // the eyebrow and the h1. The album is renamed directly in the disposable
  // database for this test and restored after it.
  const longTitle =
    "[Test] E2E A Very Long Album Title That Goes On Well Past Two Lines";
  const longArtist = "[Test] E2E An Artist Credited Under A Long Name";
  const saved = await withDatabase(async (client) => {
    const album = await client.query<{ id: string; title: string }>(
      `select al.id, al.title from album_journals aj
         join albums al on al.id = aj.album_id where aj.entry_id = $1`,
      [entryId],
    );
    const { id, title } = album.rows[0]!;
    const credits = await client.query<{
      artist_id: string;
      credited_as: string | null;
    }>("select artist_id, credited_as from album_artists where album_id = $1", [
      id,
    ]);
    await client.query("update albums set title = $2 where id = $1", [
      id,
      longTitle,
    ]);
    await client.query(
      "update album_artists set credited_as = $2 where album_id = $1",
      [id, longArtist],
    );
    return { id, title, credits: credits.rows };
  });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(`${base}/albums/${slug}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        longTitle,
      );
      const boxes = await page.evaluate(() => {
        const rect = (selector: string) => {
          const box = document
            .querySelector(`.gtop .sl.front .card ${selector}`.trim())!
            .getBoundingClientRect();
          return { top: box.top, bottom: box.bottom };
        };
        return {
          card: rect(""),
          title: rect(".gt"),
          cover: rect(".gt + *"),
          foot: rect(".foot"),
          hand: rect(".foot .hand"),
        };
      });
      for (const part of ["title", "cover", "foot", "hand"] as const) {
        expect(boxes[part].top, `${part} at ${width}px`).toBeGreaterThanOrEqual(
          boxes.card.top - 0.5,
        );
        expect(boxes[part].bottom, `${part} at ${width}px`).toBeLessThanOrEqual(
          boxes.card.bottom + 0.5,
        );
      }
      expect(boxes.cover.top, `${width}px`).toBeGreaterThanOrEqual(
        boxes.title.bottom - 0.5,
      );
      expect(boxes.foot.top, `${width}px`).toBeGreaterThanOrEqual(
        boxes.cover.bottom - 0.5,
      );
    }
  } finally {
    await context.close();
    await withDatabase(async (client) => {
      await client.query("update albums set title = $2 where id = $1", [
        saved.id,
        saved.title,
      ]);
      for (const credit of saved.credits) {
        await client.query(
          "update album_artists set credited_as = $3 where album_id = $1 and artist_id = $2",
          [saved.id, credit.artist_id, credit.credited_as],
        );
      }
    });
  }
});

test("every control is at least 44px, on the journal and on the not-found view", async ({
  page,
}) => {
  for (const path of [`/albums/${slug}`, `/albums/${draftSlug}`]) {
    await page.goto(`${base}${path}`);
    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          "header a, footer nav a, footer button, .pill, summary.trow, .nf .kr",
        ),
      ]
        .map((element) => ({
          text: element.textContent?.trim(),
          height: element.getBoundingClientRect().height,
        }))
        .filter((target) => target.height > 0 && target.height < 44),
    );
    expect(small, path).toEqual([]);
  }
});

test("a track opens and closes with the keyboard, and focus is visible", async ({
  page,
}) => {
  await openJournal(page);
  const row = page.locator(".tk details.trw").nth(1);
  const summary = row.locator("summary");
  await summary.focus();
  const outline = await summary.evaluate(
    (element) => getComputedStyle(element).outlineStyle,
  );
  expect(outline).not.toBe("none");
  const before = await row.evaluate(
    (element) => (element as HTMLDetailsElement).open,
  );
  await page.keyboard.press("Enter");
  await expect
    .poll(() => row.evaluate((element) => (element as HTMLDetailsElement).open))
    .toBe(!before);
});

test("closes with the way back to the albums and to the credited artist", async ({
  page,
}) => {
  await openJournal(page);
  await expect(
    page.getByRole("link", { name: "All album journals" }),
  ).toHaveAttribute("href", "/albums");
  await expect(
    page.getByRole("link", { name: "More about Jeff Buckley" }),
  ).toHaveAttribute("href", /^\/artists\//);
});

test("respects reduced motion", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await openJournal(page);
  const running = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((animation) => animation.playState === "running").length,
  );
  expect(running).toBe(0);
  await context.close();
});

test("labels the written language and keeps the document in English", async ({
  page,
}) => {
  await openJournal(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("article")).toHaveAttribute("lang", "en");
});

test("loads nothing from another origin and logs no error", async ({
  page,
}) => {
  const errors: string[] = [];
  const foreign: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(base).origin) foreign.push(url.origin);
  });
  await openJournal(page);
  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
});

test("has no accessibility violations (WCAG 2.2 A and AA), tracks open", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openJournal(page);
  await page.locator(".tk details.trw").evaluateAll((rows) => {
    for (const row of rows) (row as HTMLDetailsElement).open = true;
  });
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    results.violations.map(
      (v) =>
        `${v.id}: ${v.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
    ),
  ).toEqual([]);
});

test("a draft, and an unknown address, show the same not-found view with a real 404", async ({
  page,
}) => {
  const draft = await page.goto(`${base}/albums/${draftSlug}`);
  expect(draft?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    NOT_FOUND,
  );
  const draftText = await page.locator("body").innerText();
  expect(draftText).not.toContain("PRIVATE");
  expect(draftText).not.toContain("Draft album");
  const unknown = await page.goto(`${base}/albums/e2e-no-such-journal`);
  expect(unknown?.status()).toBe(404);
  expect(await page.locator("body").innerText()).toBe(draftText);
  await expect(page).toHaveTitle("Not found · refrain");
});

test("reads in full without JavaScript, in both languages (issue #44)", async ({
  browser,
}) => {
  // Rendered on the server in one pass (`instant = false`): the writing, the
  // rating, the tracks, and the footer's languages are in the document the
  // server sends, and nothing waits for a script to be revealed.
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  for (const [path, other] of [
    [`/albums/${slug}`, "PT"],
    [`/pt/albums/${slug}`, "EN"],
  ] as const) {
    const response = await page.goto(`${base}${path}`);
    expect(response?.status(), path).toBe(200);
    await expect(page.getByText("Loading…"), path).toHaveCount(0);
    await expect(page.getByText(opening), path).toBeVisible();
    await expect(page.locator(".gtop .by"), path).toContainText("Jeff Buckley");
    await expect(page.locator(".review .fine2"), path).toBeVisible();
    // A written track opens as a native disclosure, with no script.
    const row = page.locator(".tk details.trw").first();
    await expect(row, path).toBeVisible();
    await row.locator("summary").click();
    await expect(row, path).toHaveAttribute("open", "");
    // The footer's languages are real links to this journal's other form.
    const footer = page.locator("footer").last();
    await expect(
      footer.getByRole("link", { name: other, exact: true }),
      path,
    ).toBeVisible();
    await expect(page.getByText("PRIVATE"), path).toHaveCount(0);
  }
  await context.close();
});

test("asks not to be indexed without JavaScript, in both languages, served or not", async ({
  browser,
}) => {
  // The initial indexing policy (docs/security.md#indexing): the meta tag is
  // in the document the server sends, and the header on the response.
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  for (const path of [
    "/",
    "/pt",
    `/albums/${slug}`,
    `/pt/albums/${slug}`,
    `/albums/${draftSlug}`,
    `/pt/albums/e2e-no-such-journal`,
  ]) {
    const response = await page.goto(`${base}${path}`);
    expect(response?.headers()["x-robots-tag"], path).toBe("noindex, nofollow");
    await expect(
      page.locator('meta[name="robots"][content="noindex, nofollow"]'),
      path,
    ).toHaveCount(1);
  }
  await context.close();
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
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      NOT_FOUND,
    );
    await expect(page.getByText(opening)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      NOT_FOUND,
    );
    const fresh = await page.request.get(`${base}/albums/${slug}`);
    expect(fresh.status()).toBe(404);
  } finally {
    await seedCommand("publish");
  }
  const back = await page.goto(`${base}/albums/${slug}`);
  expect(back?.status()).toBe(200);
});

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

test("draws the rating as it is, with its sentence, and none once cleared", async ({
  page,
}) => {
  const saved = await savedRatings();
  try {
    for (const [halfSteps, shown] of [
      [3, "1.5"],
      [10, "5"],
      [null, ""],
    ] as const) {
      await setRatings(halfSteps);
      await openJournal(page);
      const rating = page.locator(".gtop .rt");
      if (halfSteps === null) {
        await expect(rating).toHaveCount(0);
      } else {
        await expect(rating).toHaveAttribute(
          "aria-label",
          `My rating: ${shown} out of 5`,
        );
        await expect(rating).toContainText(`[${shown}]`);
      }
    }
  } finally {
    await restoreRatings(saved);
  }
});
