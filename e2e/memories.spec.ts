import { mkdirSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  env,
  expectNoHorizontalOverflow,
  expectTouchTarget,
  named,
  withDatabase,
} from "./support";

// The Memories Studio (M3.6, M3.7) in a browser, signed in as the synthetic
// author, at 1280 px (project "desktop") and at 390 px on a touch screen
// (project "memories-390"). The catalog is built through the Studio's own
// forms; every record is "[Test] E2E …" and the global teardown removes it.
// Publishing is checked on the public server of the same build, whose switch
// is on (E2E_PUBLIC_URL); the studio's own server keeps it off. Screenshots
// are written only with E2E_SCREENSHOTS=1, to visual-review/m3-6/ and, for
// publication, visual-review/m3-7/ (ignored by Git); they hold synthetic text
// only.

test.describe.configure({ mode: "serial" });

const SHOTS = "visual-review/m3-6";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const project = (info: TestInfo) => info.project.name;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const label = (info: TestInfo, what: string) =>
  named(`${project(info)} ${what}`);

const catalog = {
  singer: "",
  band: "",
  songOne: "",
  twin: "",
  songOneUrl: "",
};
let memoryUrl = "";
const title = { value: "" };

async function shot(
  page: Page,
  info: TestInfo,
  name: string,
  fullPage = true,
  folder = SHOTS,
) {
  if (process.env.E2E_SCREENSHOTS !== "1") {
    return;
  }
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  if (fullPage) {
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
  }
  mkdirSync(folder, { recursive: true });
  await page.screenshot({
    path: `${folder}/${project(info)}-${name}.png`,
    fullPage,
  });
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

async function memoryRow(entryUrl: string) {
  const id = entryUrl.split("/").pop()!.split("?")[0]!;
  return withDatabase(async (client) => {
    const result = await client.query<{
      kind: string;
      status: string;
      title: string;
      remembered_when: string | null;
      deleted: boolean;
      version: number;
      tracks: string[];
    }>(
      `select e.kind, t.status, t.title, m.remembered_when,
              e.deleted_at is not null as deleted, e.version,
              coalesce((select array_agg(tr.title order by mm.position)
                          from memory_music mm join tracks tr on tr.id = mm.track_id
                         where mm.memory_id = e.id), '{}') as tracks
         from entries e
         join memories m on m.entry_id = e.id
         join entry_texts t on t.entry_id = e.id and t.is_original
        where e.id = $1`,
      [id],
    );
    return result.rows[0]!;
  });
}

const songs = (page: Page) =>
  page
    .getByRole("list", { name: "Songs in this memory" })
    .getByRole("listitem");

test("shows an empty Memories page", async ({ page }, info) => {
  // The 390 px project runs after the desktop one, whose memories remain
  // until the teardown, so only the first sees the empty state.
  test.skip(project(info) !== "desktop", "empty only before any memory");
  const existing = await withDatabase(async (client) => {
    const result = await client.query<{ n: number }>(
      `select count(*)::int as n from memories m
         join entries e on e.id = m.entry_id where e.deleted_at is null`,
    );
    return result.rows[0]!.n;
  });
  test.skip(existing > 0, "the test database already holds a memory");
  await page.goto("/studio/memories");
  await expect(
    page.getByRole("heading", { level: 1, name: "Memories" }),
  ).toBeVisible();
  await expect(page.getByText("No memories yet")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await shot(page, info, "01-memories-empty");
});

test("builds a small catalog through the Studio", async ({ page }, info) => {
  catalog.singer = label(info, "Memory Singer");
  catalog.band = label(info, "Memory Band");
  catalog.songOne = label(info, "Song One");
  catalog.twin = label(info, "Twin Title");
  for (const name of [catalog.singer, catalog.band]) {
    await page.goto("/studio/artists/new");
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Add artist" }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  }
  await page.goto("/studio/albums/new");
  await page
    .getByLabel("Title", { exact: true })
    .fill(label(info, "Memory Album"));
  await page
    .getByLabel("Credited artists: artist 1", { exact: true })
    .selectOption({ label: catalog.singer });
  await page.getByRole("button", { name: "Add album" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const albumName = label(info, "Memory Album");

  async function track(
    trackTitle: string,
    artist: string,
    options: { length?: string; album?: string },
  ) {
    await page.goto("/studio/tracks/new");
    await page.getByLabel("Title", { exact: true }).fill(trackTitle);
    if (options.length) {
      await page.getByLabel("Length (optional)").fill(options.length);
    }
    await page.getByRole("button", { name: "Add an artist" }).click();
    await page
      .getByLabel("Credited artists (optional): artist 1", { exact: true })
      .selectOption({ label: artist });
    if (options.album) {
      await page
        .getByLabel("Add to an album (optional)")
        .selectOption({ label: options.album });
    }
    await page.getByRole("button", { name: "Add track" }).click();
    await page.waitForURL(/\/studio\/tracks\/[0-9a-f-]{36}$/);
    return page.url();
  }
  catalog.songOneUrl = await track(catalog.songOne, catalog.singer, {
    album: albumName,
  });
  // Two recordings with one title: one on the album, one a single.
  await track(catalog.twin, catalog.singer, { album: albumName });
  await track(catalog.twin, catalog.band, { length: "3:05" });
});

test("starts a memory from a song's page, refuses a blank title, and saves a private draft", async ({
  page,
}, info) => {
  await page.goto(catalog.songOneUrl);
  await page
    .getByRole("link", { name: "Write a memory about this song" })
    .click();
  await page.waitForURL(/\/studio\/memories\/new\?track=/);
  await expect(songs(page)).toHaveCount(1);
  await expect(songs(page).first()).toContainText(catalog.songOne);
  await expect(page.getByText("Artists, from the music")).toBeVisible();
  await expect(page.getByText(catalog.singer).first()).toBeVisible();
  // Nothing here publishes.
  await expect(page.getByRole("button", { name: /publish/i })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await shot(page, info, "02-memory-new");

  // A memory needs a title; nothing is created without one.
  await page
    .getByRole("textbox", { name: "The memory" })
    .fill("[Test] Words without a title.");
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page.getByText("This is required.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "The memory" })).toHaveValue(
    "[Test] Words without a title.",
  );
  await expect(page).toHaveURL(/\/studio\/memories\/new/);
  await shot(page, info, "09a-validation");

  title.value = label(info, "A Summer Memory");
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill(title.value);
  await page
    .getByRole("textbox", { name: "When" })
    .fill("[Test] a summer, years ago");
  await page
    .getByRole("textbox", { name: "The memory" })
    .fill(
      "[Test] Synthetic words for the review, and nothing else.\n\n[Test] A second paragraph.",
    );
  await expect(page.getByText("13 words")).toBeVisible();
  await page.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/studio\/memories\/[0-9a-f-]{36}$/);
  memoryUrl = page.url();

  const stored = await memoryRow(memoryUrl);
  expect(stored).toMatchObject({
    kind: "memory",
    status: "draft",
    title: title.value,
    remembered_when: "[Test] a summer, years ago",
    deleted: false,
    version: 1,
    tracks: [catalog.songOne],
  });
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue(title.value);
  await shot(page, info, "04-memory-one-song");
});

test("adds same-named recordings told apart by their facts, and reorders with the keyboard", async ({
  page,
}, info) => {
  await page.goto(memoryUrl);
  const search = page.getByRole("searchbox", {
    name: "Add a song from your catalog",
  });
  await search.fill(`${project(info)} Twin Title`);
  const results = page.getByRole("region", { name: "Songs in your catalog" });
  const adds = results.getByRole("button", { name: /to this memory$/ });
  await expect(adds).toHaveCount(2);
  // Each says what the catalog records: the album, or the length.
  await expect(results).toContainText(`on ${label(info, "Memory Album")}`);
  await expect(results).toContainText("3:05");
  await expect(results).toContainText(catalog.band);
  await expect(
    page.getByRole("status").filter({ hasText: "2 songs found" }),
  ).toHaveCount(1);
  await results.evaluate((region) => region.scrollIntoView({ block: "end" }));
  await shot(page, info, "06-picker", false);

  await results.getByRole("button", { name: /3:05.*to this memory$/ }).click();
  await expect(search).toBeFocused();
  await search.fill(`${project(info)} Twin Title`);
  await results.getByRole("button", { name: /to this memory$/ }).click();
  await expect(songs(page)).toHaveCount(3);

  // Move the single (song 2 of 3) to the top with the keyboard. Its Move up
  // is then disabled, so focus stays with it on its Move down.
  await page
    .getByRole("button", {
      name: new RegExp(`^Move ${escaped(catalog.twin)} up \\(song 2 of 3\\)$`),
    })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", {
      name: new RegExp(
        `^Move ${escaped(catalog.twin)} down \\(song 1 of 3\\)$`,
      ),
    }),
  ).toBeFocused();
  await expect(songs(page).first()).toContainText("3:05");
  for (const control of await page
    .getByRole("list", { name: "Songs in this memory" })
    .getByRole("button")
    .all()) {
    await expectTouchTarget(control);
  }

  // Remove the first song; it stays in the catalog.
  await page
    .getByRole("button", {
      name: new RegExp(`^Remove ${escaped(catalog.songOne)} from this memory`),
    })
    .click();
  await expect(search).toBeFocused();
  await expect(songs(page)).toHaveCount(2);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved just now")).toBeVisible();

  const stored = await memoryRow(memoryUrl);
  expect(stored.tracks).toEqual([catalog.twin, catalog.twin]);
  expect(stored.version).toBe(2);
  const catalogKept = await withDatabase(async (client) => {
    const result = await client.query<{ n: number }>(
      "select count(*)::int as n from tracks where title = $1",
      [catalog.songOne],
    );
    return result.rows[0]!.n;
  });
  expect(catalogKept).toBe(1);

  // Back to several songs for the review, saved with Cmd/Ctrl+S.
  await search.fill(`${project(info)} Song One`);
  await results.getByRole("button", { name: /to this memory$/ }).click();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved just now")).toBeVisible();
  await page.reload();
  await expect(songs(page)).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await shot(page, info, "05-memory-several");
});

test("refuses a save from a stale tab and keeps the text", async ({
  page,
  context,
}, info) => {
  await page.goto(memoryUrl);
  const other = await context.newPage();
  await other.goto(memoryUrl);
  await other
    .getByRole("textbox", { name: "When" })
    .fill("[Test] another season");
  await other.getByRole("button", { name: "Save", exact: true }).click();
  await expect(other.getByText("Saved just now")).toBeVisible();
  await other.close();

  await page
    .getByRole("textbox", { name: "The memory" })
    .fill("[Test] Written in a stale tab.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({
      hasText: "This memory changed somewhere else",
    }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "The memory" })).toHaveValue(
    "[Test] Written in a stale tab.",
  );
  expect((await memoryRow(memoryUrl)).remembered_when).toBe(
    "[Test] another season",
  );
  await shot(page, info, "09b-conflict");
});

test("offers Draft, Private, and Publish…, and lists the memory on the Desk", async ({
  page,
}, info) => {
  await page.goto(memoryUrl);
  await expect(
    page.getByRole("button", { name: "Publish…", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Unpublish/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Private", exact: true }).click();
  await expect(page.getByText("Now private.")).toBeVisible();
  expect((await memoryRow(memoryUrl)).status).toBe("private");

  await page.goto("/studio/memories");
  await expect(page.getByRole("link", { name: title.value })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await shot(page, info, "03-memories-list");

  await page.goto("/studio");
  await expect(
    page.getByRole("list", { name: "Memories" }).getByText(title.value),
  ).toBeVisible();
  await shot(page, info, "03b-desk");
});

test("publishes a memory through its review, asks before a change to it, and unpublishes it", async ({
  page,
  context,
  browser,
}, info) => {
  const publicBase = env("E2E_PUBLIC_URL");
  const slug = await withDatabase(async (client) => {
    const result = await client.query<{ slug: string }>(
      "select slug from entry_slugs where entry_id = $1 and is_current",
      [memoryUrl.split("/").pop()],
    );
    return result.rows[0]!.slug;
  });
  const reader = await browser.newContext({ storageState: undefined });
  const readerPage = await reader.newPage();
  const publicStatus = async () =>
    (await readerPage.goto(`${publicBase}/memories/${slug}`))?.status();
  expect(await publicStatus()).toBe(404);

  await page.goto(memoryUrl);
  // Publishing waits until the editor's changes are saved.
  await page.getByRole("textbox", { name: "When" }).fill("[Test] unsaved");
  const publish = page.getByRole("button", { name: "Publish…", exact: true });
  await expect(publish).toHaveAttribute("aria-disabled", "true");
  await expect(
    page.getByText(
      "Save your changes first: Publish… shows you what is saved.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved just now")).toBeVisible();

  // The review shows everything that will be published, and changes nothing.
  await publish.click();
  const review = page.getByRole("dialog", { name: "Publish this memory?" });
  await expect(review).toContainText(title.value);
  await expect(review).toContainText("[Test] unsaved");
  await expect(review).toContainText(
    "[Test] Synthetic words for the review, and nothing else.",
  );
  await expect(review).toContainText("The music (3)");
  await expect(review).toContainText(catalog.twin);
  await expect(review).toContainText(`/memories/${slug}`);
  await expect(review).toContainText(
    "Publishing a memory opens no artist page",
  );
  await axe(page);
  await shot(page, info, "10-publication-review", false, "visual-review/m3-7");
  await review.getByRole("button", { name: "Cancel" }).click();
  await expect(review).toHaveCount(0);
  expect((await memoryRow(memoryUrl)).status).toBe("private");

  // A review that went stale in another tab publishes nothing, and asks for
  // a new review.
  await publish.click();
  await expect(
    review.getByRole("button", { name: "Publish this memory" }),
  ).toBeVisible();
  const other = await context.newPage();
  await other.goto(memoryUrl);
  await other
    .getByRole("textbox", { name: "Title", exact: true })
    .fill(`${title.value} (retold)`);
  await other.getByRole("button", { name: "Save", exact: true }).click();
  await expect(other.getByText("Saved just now")).toBeVisible();
  await other.close();
  await review.getByRole("button", { name: "Publish this memory" }).click();
  await expect(
    review.getByText("What would be published has changed since you looked"),
  ).toBeVisible();
  expect((await memoryRow(memoryUrl)).status).toBe("private");
  await review.getByRole("button", { name: "Review it again" }).click();
  await expect(review).toContainText(`${title.value} (retold)`);
  await review.getByRole("button", { name: "Publish this memory" }).click();
  await expect(review).toHaveCount(0);
  await expect(
    page.getByText("This memory is now published.", { exact: false }),
  ).toBeVisible();
  expect((await memoryRow(memoryUrl)).status).toBe("published");
  title.value = `${title.value} (retold)`;

  // The public page, on the server whose public reads are on.
  expect(await publicStatus()).toBe(200);
  await expect(readerPage.getByRole("heading", { level: 1 })).toHaveText(
    title.value,
  );
  await expect(readerPage.getByText("[Test] unsaved")).toBeVisible();

  // A change to the published memory asks first, with what changes.
  await page.reload();
  await expect(
    page.getByText("This memory is published. Saving changes what readers see"),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "When" })
    .fill("[Test] a later summer");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const change = page.getByRole("dialog", {
    name: "Update the published memory?",
  });
  await expect(change).toContainText("Changed: When");
  await expect(change).toContainText("Published now");
  await expect(change).toContainText("[Test] unsaved");
  await expect(change).toContainText("Published after saving");
  await expect(change).toContainText("[Test] a later summer");
  await axe(page);
  await shot(page, info, "11-confirmed-update", false, "visual-review/m3-7");
  // Cancelling writes nothing and keeps the text.
  await change.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("textbox", { name: "When" })).toHaveValue(
    "[Test] a later summer",
  );
  expect((await memoryRow(memoryUrl)).remembered_when).toBe("[Test] unsaved");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await change
    .getByRole("button", { name: "Save and update the published memory" })
    .click();
  await expect(page.getByText("Saved just now")).toBeVisible();
  expect((await memoryRow(memoryUrl)).remembered_when).toBe(
    "[Test] a later summer",
  );
  expect(await publicStatus()).toBe(200);
  await expect(readerPage.getByText("[Test] a later summer")).toBeVisible();

  // Removing a song is a removal: saved without asking.
  await page
    .getByRole("button", { name: /^Remove .* from this memory/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved just now")).toBeVisible();
  await expect(change).toHaveCount(0);
  expect((await memoryRow(memoryUrl)).tracks).toHaveLength(2);

  // Unpublish asks first, keeps everything, and the page answers 404.
  await page.getByRole("button", { name: "Unpublish…" }).click();
  const unpublish = page.getByRole("dialog", {
    name: "Unpublish this memory?",
  });
  await expect(unpublish).toContainText("Nothing is deleted");
  await unpublish.getByRole("button", { name: "Unpublish" }).click();
  await expect(
    page.getByText("This memory is no longer published.", { exact: false }),
  ).toBeVisible();
  const stored = await memoryRow(memoryUrl);
  expect(stored.status).toBe("private");
  expect(stored.tracks).toHaveLength(2);
  expect(await publicStatus()).toBe(404);
  await expect(
    readerPage.getByRole("heading", { name: "Nothing here" }),
  ).toBeVisible();
  await shot(
    readerPage,
    info,
    "12-unpublished-404",
    false,
    "visual-review/m3-7",
  );
  await expectNoHorizontalOverflow(page);
  await reader.close();
});

test("moves a memory to Recently deleted and restores it whole", async ({
  page,
}, info) => {
  await page.goto(memoryUrl);
  await page.getByRole("button", { name: "Delete…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete this memory?" });
  await expect(dialog).toContainText("Its songs stay in your catalog.");
  await dialog.getByRole("button", { name: "Delete memory" }).click();
  await page.waitForURL(/\/studio\/memories\?deleted=1$/);
  await expect(
    page.getByText("The memory is in Recently deleted."),
  ).toBeVisible();
  expect((await memoryRow(memoryUrl)).deleted).toBe(true);

  await page.goto("/studio/journals/deleted");
  await expect(
    page
      .getByRole("list", { name: "Recently deleted memories" })
      .getByText(title.value),
  ).toBeVisible();
  await axe(page);
  await shot(page, info, "08a-recently-deleted");

  await page.goto(memoryUrl);
  await expect(
    page.getByRole("heading", { level: 1, name: title.value }),
  ).toBeVisible();
  // Read-only: no field to type into.
  await expect(page.getByRole("textbox", { name: "The memory" })).toHaveCount(
    0,
  );
  await axe(page);
  await shot(page, info, "08b-memory-deleted");

  await page.getByRole("button", { name: /^Restore the memory/ }).click();
  await page
    .getByRole("dialog", { name: "Restore this memory?" })
    .getByRole("button", { name: "Restore memory" })
    .click();
  await page.waitForURL(/\/studio\/memories\/[0-9a-f-]{36}\?restored=1$/);
  await expect(
    page.getByText("Restored from Recently deleted", { exact: false }),
  ).toBeVisible();
  const stored = await memoryRow(memoryUrl);
  expect(stored).toMatchObject({ deleted: false, status: "private" });
  // Three songs, less the one the publication test removed.
  expect(stored.tracks).toHaveLength(2);
});
