import { mkdirSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { removeMusicFixtureRecords } from "@/testing/music-records";
import { FIXTURE, SCENARIO } from "@/testing/provider-fixtures";

import {
  expectNoHorizontalOverflow,
  expectTouchTarget,
  named,
  withDatabase,
} from "./support";

// Add music and album artwork in the Writing Studio (M3.2), signed in as the
// synthetic author, at desktop width and at 390 px. The server's MusicBrainz
// and Cover Art Archive are the local mock (src/testing/provider-mock.ts), so
// every record is a synthetic "[Test]" fixture; the browser's own requests
// for cover images are answered here with a generated test image. Each run
// starts and ends without the fixture records. Screenshots only with
// E2E_SCREENSHOTS=1, to visual-review/m3-2/, which Git ignores.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const TEST_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#2a6f4f"/><circle cx="250" cy="250" r="140" fill="#e9c46a"/></svg>`;

test.describe.configure({ mode: "serial" });

test.beforeAll(() => withDatabase(removeMusicFixtureRecords));
test.afterAll(() => withDatabase(removeMusicFixtureRecords));

test.beforeEach(async ({ page }) => {
  await page.route("https://coverartarchive.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: TEST_IMAGE,
    }),
  );
});

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) <= 720;

async function screenshot(page: Page, name: string, project: string) {
  if (process.env.E2E_SCREENSHOTS !== "1") {
    return;
  }
  mkdirSync("visual-review/m3-2", { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: `visual-review/m3-2/${project}-${name}.png`,
    fullPage: true,
  });
}

async function noAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
}

test("searches MusicBrainz and shows what is new and what is already there", async ({
  page,
}, testInfo) => {
  await page.goto("/studio/catalog");
  await page.getByRole("link", { name: "Add music" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Add music" }),
  ).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Search MusicBrainz" });
  await search.fill("paper moon");
  await search.press("Enter");
  const results = page.getByRole("list", { name: "From MusicBrainz" });
  await expect(results.getByRole("listitem")).toHaveCount(3);
  // Two release groups share a title; their credits tell them apart.
  await expect(
    results.getByText("[Test] Paper Moon", { exact: true }),
  ).toHaveCount(2);
  await expect(
    results.getByText("Album · [Test] Paper Singer · 2013", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Data from MusicBrainz. Artwork from Cover Art Archive, added only if you choose it.",
    ),
  ).toBeVisible();
  await noAxeViolations(page);
  if (isMobile(page)) {
    await expectNoHorizontalOverflow(page);
    await expectTouchTarget(
      results.getByRole("link", { name: /^Add / }).first(),
    );
    await expectTouchTarget(
      page
        .getByRole("navigation", { name: "Search for" })
        .getByRole("link", { name: "Artists" }),
    );
  }
  await screenshot(page, "add-music", testInfo.project.name);
});

test("says when nothing is found and when MusicBrainz cannot be reached", async ({
  page,
}, testInfo) => {
  await page.goto(
    `/studio/catalog/add?q=${encodeURIComponent(SCENARIO.nothing)}`,
  );
  await expect(page.getByText(/Nothing found for/)).toBeVisible();
  await expect(
    page.getByText("Check the spelling, or try fewer words."),
  ).toBeVisible();

  await page.goto(
    `/studio/catalog/add?q=${encodeURIComponent(SCENARIO.unavailable)}`,
  );
  await expect(page.getByText("Couldn’t reach MusicBrainz.")).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByText(
      "Your catalog and your writing still work. Try again in a moment.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
  await noAxeViolations(page);
  await screenshot(page, "add-music-unreachable", testInfo.project.name);
});

test("adds an album only after choosing an edition and approving the review", async ({
  page,
}, testInfo) => {
  await page.goto("/studio/catalog/add?q=paper%20moon");
  await page
    .getByRole("list", { name: "From MusicBrainz" })
    .getByRole("link", { name: "Add [Test] Paper Moon by [Test] Ink Quartet" })
    .click();

  // The release group, and its editions to choose from.
  await expect(
    page.getByRole("heading", { level: 1, name: "[Test] Paper Moon" }),
  ).toBeVisible();
  const editions = page
    .getByRole("list", { name: "Choose an edition" })
    .getByRole("listitem");
  await expect(editions).toHaveCount(3);
  await expect(editions.first()).toContainText("1994-08-15 · GB");
  await expect(editions.nth(2)).toContainText("no date · XW");
  await noAxeViolations(page);
  await screenshot(page, "editions", testInfo.project.name);
  await editions
    .first()
    .getByRole("link", { name: /^Review/ })
    .click();

  // The review: nothing is written yet.
  await expect(
    page.getByRole("button", { name: "Add to catalog" }),
  ).toBeVisible();
  const before = await withDatabase(
    async (client) =>
      (
        await client.query(
          "select count(*)::int as n from albums where mb_release_group_id = $1",
          [FIXTURE.paperMoon],
        )
      ).rows[0].n,
  );
  expect(before).toBe(0);
  await expect(page.getByText("[Test] Second Verse")).toBeVisible();
  await expect(
    page.getByText(/\[Test\] Paper Singer · new, as a person/),
  ).toBeVisible();
  // No cover is chosen until the author chooses one.
  await expect(page.getByRole("radio", { name: "No artwork" })).toBeChecked();
  await expect(page.getByRole("img", { name: /front cover 1/ })).toBeVisible();
  await noAxeViolations(page);
  if (isMobile(page)) {
    await expectNoHorizontalOverflow(page);
    await expectTouchTarget(
      page.getByRole("button", { name: "Add to catalog" }),
    );
    await expectTouchTarget(
      page.getByRole("radio", { name: "Front cover 1" }).locator("xpath=.."),
    );
  }
  await screenshot(page, "review", testInfo.project.name);

  await page.getByRole("radio", { name: "Front cover 1" }).check();
  await page.getByRole("button", { name: "Add to catalog" }).click();

  // The album, with its cover over the fallback, its edition, and its tracks.
  await expect(
    page.getByRole("heading", { level: 1, name: "[Test] Paper Moon" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/studio\/albums\/[0-9a-f-]{36}$/);
  const frame = page.getByRole("img", {
    name: "Album artwork for [Test] Paper Moon",
  });
  await expect(frame).toBeVisible();
  await expect
    .poll(() =>
      frame
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("list", { name: "Tracklist" }).getByRole("listitem"),
  ).toHaveCount(3);
  const stored = await withDatabase(
    async (client) =>
      (
        await client.query(
          `select a.cover_url, a.cover_source, ed.mb_release_id
           from albums a join album_editions ed on ed.album_id = a.id and ed.is_reference
          where a.mb_release_group_id = $1`,
          [FIXTURE.paperMoon],
        )
      ).rows,
  );
  expect(stored).toEqual([
    {
      cover_url: `https://coverartarchive.org/release/${FIXTURE.firstPressing}/${FIXTURE.frontImage}`,
      cover_source: "Cover Art Archive",
      mb_release_id: FIXTURE.firstPressing,
    },
  ]);
  await screenshot(page, "album-with-cover", testInfo.project.name);

  // Searching again shows it in the catalog, with no way to add it twice.
  await page.goto("/studio/catalog/add?q=paper%20moon");
  await expect(
    page
      .getByRole("list", { name: "Already in your catalog" })
      .getByText("[Test] Paper Moon"),
  ).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "From MusicBrainz" })
      .getByRole("link", { name: "In catalog" }),
  ).toHaveCount(1);
});

test("changes and removes the cover only on purpose", async ({
  page,
}, testInfo) => {
  const albumId = await withDatabase(
    async (client) =>
      (
        await client.query(
          "select id from albums where mb_release_group_id = $1",
          [FIXTURE.paperMoon],
        )
      ).rows[0].id as string,
  );
  await page.goto(`/studio/albums/${albumId}`);
  await page.getByRole("link", { name: "Change artwork" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Artwork" }),
  ).toBeVisible();
  await expect(page.getByText("Current cover")).toBeVisible();
  await noAxeViolations(page);
  await screenshot(page, "artwork", testInfo.project.name);

  await page.getByRole("button", { name: "Remove artwork…" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Remove this album’s artwork?",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Current cover")).toBeVisible();

  await page.getByRole("button", { name: "Remove artwork…" }).click();
  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(
    page.getByRole("button", { name: /^Use this cover/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "No album artwork yet" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /^Use this cover/ }).click();
  await expect(page.getByText("Current cover")).toBeVisible();
  if (isMobile(page)) {
    await expectNoHorizontalOverflow(page);
  }
});

test("shows the chosen cover on every studio surface, and the fallback when it fails", async ({
  page,
}, testInfo) => {
  const albumId = await withDatabase(
    async (client) =>
      (
        await client.query(
          "select id from albums where mb_release_group_id = $1",
          [FIXTURE.paperMoon],
        )
      ).rows[0].id as string,
  );
  // A journal about the album, through the Studio's own form.
  await page.goto(`/studio/albums/${albumId}`);
  await page
    .getByRole("link", { name: "Write a journal about this album" })
    .click();
  await page
    .getByLabel("Your reflection", { exact: true })
    .fill("[Test] E2E words about the cover.");
  await page.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/studio\/journals\/[0-9a-f-]{36}$/);
  const journalUrl = new URL(page.url()).pathname;

  // A row's thumbnail holds the cover, square, over the record mark.
  const expectCoverRow = async (path: string, list: string) => {
    await page.goto(path);
    const thumb = page
      .getByRole("list", { name: list })
      .getByRole("listitem")
      .filter({ hasText: "[Test] Paper Moon" })
      .locator(".studio-thumb");
    const image = thumb.locator("img");
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => element.naturalWidth),
      )
      .toBeGreaterThan(0);
    const box = await image.boundingBox();
    expect(box!.width).toBeCloseTo(box!.height, 0);
    await expect(thumb.locator("svg")).toBeAttached();
    await noAxeViolations(page);
    if (isMobile(page)) {
      await expectNoHorizontalOverflow(page);
    }
  };
  await expectCoverRow("/studio", "Journals");
  await screenshot(page, "desk-with-cover", testInfo.project.name);
  await expectCoverRow("/studio/journals", "Journals");
  await expectCoverRow("/studio/albums", "Albums");
  await expectCoverRow(
    "/studio/catalog/add?q=paper%20moon",
    "Already in your catalog",
  );

  const frame = page.getByRole("img", {
    name: "Album artwork for [Test] Paper Moon",
  });
  await page.goto(journalUrl);
  await expect(frame).toBeVisible();
  await expect
    .poll(() =>
      frame
        .locator("img")
        .evaluate((element: HTMLImageElement) => element.naturalWidth),
    )
    .toBeGreaterThan(0);
  await noAxeViolations(page);
  await screenshot(page, "journal-with-cover", testInfo.project.name);

  // The editor, as the approved screen has it: the frame beside the heading,
  // and the album's artwork in the margin, with the way to change it.
  await page.goto(`${journalUrl}/edit`);
  await expect(frame).toBeVisible();
  const frameBox = await frame.boundingBox();
  expect(frameBox!.width).toBeCloseTo(120, 0);
  expect(frameBox!.height).toBeCloseTo(120, 0);
  await expect(page.getByRole("link", { name: /^Change…/ })).toHaveAttribute(
    "href",
    `/studio/albums/${albumId}/artwork`,
  );
  await expect(
    page.getByRole("link", { name: "Edit in catalog" }),
  ).toHaveAttribute("href", `/studio/albums/${albumId}`);
  await noAxeViolations(page);
  if (isMobile(page)) {
    await expectNoHorizontalOverflow(page);
  }
  await screenshot(page, "editor-with-cover", testInfo.project.name);

  // When the image cannot be loaded, the frame keeps its size and says so,
  // and no broken image is left in it.
  await page.unroute("https://coverartarchive.org/**");
  await page.route("https://coverartarchive.org/**", (route) =>
    route.abort("failed"),
  );
  await page.goto(`/studio/albums/${albumId}`);
  await expect(frame.getByText("artwork not shown")).toBeAttached();
  await expect(frame.locator("img")).toHaveCount(0);
  const failed = await frame.boundingBox();
  expect(failed!.width).toBeCloseTo(failed!.height, 0);
  await noAxeViolations(page);
  await screenshot(page, "cover-failed", testInfo.project.name);

  await page.goto("/studio/albums");
  const row = page
    .getByRole("list", { name: "Albums" })
    .getByRole("listitem")
    .filter({ hasText: "[Test] Paper Moon" })
    .locator(".studio-thumb");
  await expect(row.locator("img")).toHaveCount(0);
  await expect(row.locator("svg")).toBeVisible();
});

test("a new cover replaces one that failed to load", async ({ page }) => {
  const albumId = await withDatabase(async (client) => {
    const found = await client.query(
      "select id from albums where mb_release_group_id = $1",
      [FIXTURE.paperMoon],
    );
    const id = found.rows[0].id as string;
    // A stored cover the archive's listing does not offer, so the chooser
    // can replace it with the one it does.
    await client.query("update albums set cover_url = $1 where id = $2", [
      `https://coverartarchive.org/release/${FIXTURE.firstPressing}/${FIXTURE.legacyFrontImage}`,
      id,
    ]);
    return id;
  });
  // Registered after the beforeEach route, so it is consulted first: only the
  // stored cover fails, and the one the author chooses next can load.
  await page.route(
    (url) => url.pathname.includes(FIXTURE.legacyFrontImage),
    (route) => route.abort("failed"),
  );

  await page.goto(`/studio/albums/${albumId}/artwork`);
  const current = page.getByRole("img", {
    name: "Album artwork for [Test] Paper Moon",
    exact: true,
  });
  // 1 and 2: the source fails, and the frame shows its fallback.
  await expect(current).toBeVisible();
  await expect(current.getByText("artwork not shown")).toBeAttached();
  await expect(current.locator("img")).toHaveCount(0);
  const failed = await current.boundingBox();

  // 3: the source changes, in this same frame, without leaving the page.
  await page.getByRole("button", { name: /^Use this cover instead/ }).click();
  await expect(page.getByText("Current cover")).toBeVisible();

  // 4 and 5: the new image loads, and the earlier failure is not remembered.
  const image = current.locator("img");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", new RegExp(FIXTURE.frontImage));
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => element.naturalWidth),
    )
    .toBeGreaterThan(0);
  const loaded = await current.boundingBox();
  expect(loaded!.width).toBeCloseTo(failed!.width, 0);
  expect(loaded!.height).toBeCloseTo(failed!.height, 0);
});

test("links an album already in the catalog without changing it", async ({
  page,
}) => {
  // The import above holds the release group, so a manual album with the
  // same title is offered a link only after it is removed.
  await withDatabase(removeMusicFixtureRecords);
  const credited = named("Link Artist");
  await page.goto("/studio/artists/new");
  await page.getByLabel("Name", { exact: true }).fill(credited);
  await page.getByLabel("Person or band").selectOption("group");
  await page.getByRole("button", { name: "Add artist" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: credited }),
  ).toBeVisible();

  await page.goto("/studio/albums/new");
  await page.getByLabel("Title", { exact: true }).fill("[Test] Paper Moon");
  await page
    .getByLabel("Credited artists: artist 1", { exact: true })
    .selectOption({ label: credited });
  await page.getByRole("button", { name: "Add album" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "[Test] Paper Moon" }),
  ).toBeVisible();
  const albumUrl = page.url();

  await page.goto(`/studio/catalog/add/release/${FIXTURE.firstPressing}`);
  const link = page.getByRole("list", {
    name: "Or link an album you already have",
  });
  await link.getByRole("button", { name: /^Link to this album/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Link", exact: true })
    .click();
  await expect(page).toHaveURL(albumUrl);
  await expect(
    page.getByRole("link", { name: "Choose artwork" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Tracklist" }).getByRole("listitem"),
  ).toHaveCount(0);
  await withDatabase(async (client) => {
    await client.query("delete from albums where id = $1", [
      albumUrl.split("/").pop(),
    ]);
  });
});
