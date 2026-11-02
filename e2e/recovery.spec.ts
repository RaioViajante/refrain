import { expect, test, type Page } from "@playwright/test";

import { createAlbumThroughStudio, named, withDatabase } from "./support";

// Workflow D: recovery. A journal moved to Recently deleted is kept, and the
// author can restore it with every word intact. Restoring never publishes:
// writing that was published comes back private, under the owner-accepted
// policy (docs/roadmap.md). The tests run in order and share their records.

test.describe.configure({ mode: "serial" });

const names = {
  artist: named("Recovery Artist"),
  album: named("Recovery Album"),
};
const opening = "[Test] E2E Recovery opening.";
const body = [
  "[Test] E2E Recovery first paragraph.",
  "[Test] E2E Recovery second paragraph,\nwith a line break.",
  "[Test] E2E Recovery third paragraph.",
].join("\n\n");

let albumId = "";
let journalUrl = "";

const journalRows = (page: Page, list: string) =>
  page
    .getByRole("list", { name: list })
    .getByRole("listitem")
    .filter({ hasText: names.album });

async function writeJournal(page: Page) {
  await page.goto(`/studio/journals/new?album=${albumId}`);
  await page.getByLabel("Opening sentence (optional)").fill(opening);
  await page.getByLabel("Your reflection").fill(body);
  await page.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/studio\/journals\/[0-9a-f-]{36}$/);
  return page.url();
}

async function moveToRecentlyDeleted(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole("button", { name: "Move to Recently deleted…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("You can restore it from there");
  await dialog
    .getByRole("button", { name: "Move to Recently deleted" })
    .click();
  await expect(page).toHaveURL(/\/studio\/journals$/);
}

async function stored(entryId: string) {
  return withDatabase(async (client) => {
    const result = await client.query<{
      deleted: boolean;
      status: string;
      published_at: string | null;
      first_published_at: string | null;
      entry_first_published_at: string | null;
      opening: string | null;
      body_text: string;
      version: number;
      slug: string;
      was_published: boolean;
    }>(
      `select e.deleted_at is not null as deleted, t.status, t.published_at,
              t.first_published_at,
              e.first_published_at as entry_first_published_at,
              t.opening, t.body_text, e.version, s.slug, s.was_published
         from entries e
         join entry_texts t on t.entry_id = e.id and t.is_original
         join entry_slugs s on s.entry_id = e.id and s.is_current
        where e.id = $1`,
      [entryId],
    );
    return result.rows[0]!;
  });
}

const idOf = (url: string) => url.split("/").pop()!;

test("writes a journal and makes it private", async ({ page }) => {
  const created = await createAlbumThroughStudio(page, names);
  albumId = idOf(created.albumUrl);
  journalUrl = await writeJournal(page);
  await page.getByRole("button", { name: "Private" }).click();
  await expect(page.getByText("Now private.")).toBeVisible();
  expect((await stored(idOf(journalUrl))).status).toBe("private");
});

test("moves the journal to Recently deleted: it leaves the lists and is kept", async ({
  page,
}) => {
  await moveToRecentlyDeleted(page, journalUrl);

  // Gone from the normal listing ...
  await expect(journalRows(page, "Journals")).toHaveCount(0);
  // ... and counted in Recently deleted, which says plainly what that means.
  await expect(
    page.getByRole("heading", { name: /^Recently deleted \(\d+\)$/ }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: /^Recently deleted/ })
      .getByText("nothing removes it automatically"),
  ).toBeVisible();

  await page.getByRole("link", { name: "Open Recently deleted" }).click();
  await expect(page).toHaveURL(/\/studio\/journals\/deleted$/);
  const row = journalRows(page, "Recently deleted journals");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("English: private");
  await expect(
    page
      .getByText("Permanent deletion is not offered yet")
      .filter({ visible: true }),
  ).toBeVisible();
  // No control removes anything permanently.
  await expect(
    page.getByRole("button", { name: /delete (now|permanently|forever)/i }),
  ).toHaveCount(0);

  // The writing is still in PostgreSQL, whole, and the journal is only marked.
  expect(await stored(idOf(journalUrl))).toMatchObject({
    deleted: true,
    status: "private",
    opening,
    body_text: body,
  });

  // Its page is read-only and offers the restore, not an editor.
  await page.goto(journalUrl);
  await expect(
    page.getByRole("link", { name: "Edit this journal" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByText("cannot be changed there until you restore it")
      .filter({ visible: true }),
  ).toBeVisible();
});

test("the album cannot be deleted while a journal about it is in Recently deleted", async ({
  page,
}) => {
  await page.goto(`/studio/albums/${albumId}`);
  await page.getByRole("button", { name: "Delete album…" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(
    page.getByText(
      "Journals are written about it, so it stays in your catalog.",
    ),
  ).toBeVisible();
});

test("restores the journal with its text intact, still private", async ({
  page,
}) => {
  const before = await stored(idOf(journalUrl));
  await page.goto("/studio/journals/deleted");
  await journalRows(page, "Recently deleted journals")
    .getByRole("button", { name: `Restore the journal about ${names.album}` })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Restore this journal?");
  await expect(dialog).toContainText(
    "Drafts stay drafts and private stays private.",
  );
  await dialog.getByRole("button", { name: "Restore journal" }).click();

  // Back at the journal, with the result said in words.
  await expect(page).toHaveURL(new RegExp(`${idOf(journalUrl)}\\?restored=1$`));
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Restored from Recently deleted" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Edit this journal" }),
  ).toBeVisible();
  await expect(page.locator(".studio-reading p")).toHaveCount(3);
  await expect(page.locator(".studio-opening")).toHaveText(opening);
  await expect(
    page
      .getByText("Private", { exact: true })
      .filter({ visible: true })
      .first(),
  ).toBeVisible();

  // It is among the journals again, and out of Recently deleted.
  await page.goto("/studio/journals");
  await expect(journalRows(page, "Journals")).toHaveCount(1);
  await page.goto("/studio/journals/deleted");
  await expect(journalRows(page, "Recently deleted journals")).toHaveCount(0);

  // PostgreSQL: the same writing, the same version and address, still private.
  const after = await stored(idOf(journalUrl));
  expect(after).toMatchObject({
    deleted: false,
    status: "private",
    published_at: null,
    opening,
    body_text: body,
    version: before.version,
    slug: before.slug,
    was_published: false,
  });

  // And it can be edited and deleted again.
  await page.goto(`${journalUrl}/edit`);
  await expect(page.getByLabel("Your reflection")).toHaveValue(body);
});

test("a journal that was published returns private, never published, with its history", async ({
  page,
}) => {
  // The Studio cannot publish yet, so a journal that was once published is
  // set up directly in the disposable test database, as a later milestone's
  // publish command would leave it. The restore is what is under test.
  const url = await writeJournal(page);
  const entryId = idOf(url);
  await withDatabase(async (client) => {
    await client.query(
      `update entry_texts set status = 'published',
              published_at = timestamptz '2026-01-01 00:00:00+00',
              first_published_at = timestamptz '2026-01-01 00:00:00+00'
        where entry_id = $1`,
      [entryId],
    );
    await client.query(
      `update entries set first_published_at = timestamptz '2026-01-01 00:00:00+00'
        where id = $1`,
      [entryId],
    );
    await client.query(
      "update entry_slugs set was_published = true where entry_id = $1 and is_current",
      [entryId],
    );
  });
  const before = await stored(entryId);
  expect(before.status).toBe("published");

  await moveToRecentlyDeleted(page, url);
  await page.goto("/studio/journals/deleted");
  const row = page
    .getByRole("listitem")
    .filter({ hasText: names.album })
    .filter({ hasText: "returns as private" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("English: published, returns as private");

  await row.getByRole("button", { name: /^Restore the journal about/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("comes back as private");
  await expect(dialog).toContainText("Restoring publishes nothing");
  await expect(dialog).toContainText(
    "including any track reflections you had set to be included when published",
  );
  await dialog.getByRole("button", { name: "Restore journal" }).click();

  await expect(page).toHaveURL(new RegExp(`${entryId}\\?restored=private$`));
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Restored from Recently deleted" }),
  ).toContainText("is now private");
  await expect(
    page
      .getByText("Private", { exact: true })
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await expect(page.getByText("Published", { exact: true })).toHaveCount(0);

  const after = await stored(entryId);
  expect(after).toMatchObject({
    deleted: false,
    status: "private",
    published_at: null,
    opening,
    body_text: body,
    version: before.version,
    slug: before.slug,
    // The address was public once, so it stays reserved as one.
    was_published: true,
  });
  expect(new Date(after.first_published_at!).toISOString()).toBe(
    "2026-01-01T00:00:00.000Z",
  );
  expect(new Date(after.entry_first_published_at!).toISOString()).toBe(
    "2026-01-01T00:00:00.000Z",
  );
  // Nothing about this album is published anywhere.
  const published = await withDatabase(async (client) => {
    const result = await client.query(
      `select count(*)::int as n from entry_texts t
         join album_journals j on j.entry_id = t.entry_id
        where j.album_id = $1 and (t.status = 'published' or t.published_at is not null)`,
      [albumId],
    );
    return result.rows[0].n as number;
  });
  expect(published).toBe(0);
});

test("a second restore of the same journal, from a stale tab, is refused in words", async ({
  page,
}) => {
  const url = await writeJournal(page);
  await moveToRecentlyDeleted(page, url);

  const other = await page.context().newPage();
  await page.goto("/studio/journals/deleted");
  await other.goto("/studio/journals/deleted");

  const restoreButton = (target: Page) =>
    journalRows(target, "Recently deleted journals").getByRole("button", {
      name: `Restore the journal about ${names.album}`,
    });

  // The first tab restores it.
  await restoreButton(page).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Restore journal" })
    .click();
  await expect(page).toHaveURL(/\?restored=1$/);

  // The other tab still lists it. Restoring again is refused in words, and
  // nothing changes.
  await restoreButton(other).click();
  await other
    .getByRole("dialog")
    .getByRole("button", { name: "Restore journal" })
    .click();
  await expect(
    other.getByRole("alert").filter({ hasText: "not in Recently deleted" }),
  ).toContainText("It may already have been restored");
  const after = await stored(idOf(url));
  // It was a draft, and a draft returns as a draft.
  expect(after).toMatchObject({ deleted: false, status: "draft" });
  await other.close();
});

test("an editor opened before the delete cannot overwrite newer writing after the restore", async ({
  page,
}) => {
  const url = await writeJournal(page);
  const entryId = idOf(url);

  // Two tabs load the editor at the same version.
  const first = await page.context().newPage();
  const second = await page.context().newPage();
  for (const tab of [first, second]) {
    await tab.goto(`${url}/edit`);
    await expect(tab.getByLabel("Your reflection")).toHaveValue(body);
  }

  // Meanwhile the journal is deleted and restored.
  await moveToRecentlyDeleted(page, url);
  await page.goto("/studio/journals/deleted");
  await journalRows(page, "Recently deleted journals")
    .getByRole("button", { name: `Restore the journal about ${names.album}` })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Restore journal" })
    .click();
  await expect(page).toHaveURL(/\?restored=1$/);

  // The second tab saves first. It started from the same text, so it is not stale.
  await second
    .getByLabel("Opening sentence (optional)")
    .fill("[Test] E2E Newer opening from the second tab.");
  await second.getByRole("button", { name: "Save", exact: true }).click();
  await expect(second.getByText("Saved just now")).toBeVisible();

  // The first tab still holds the old version: its save is refused, its text
  // stays in the box, and the newer writing is what is stored.
  const typed = "[Test] E2E Typed in the stale first tab.";
  await first.getByLabel("Opening sentence (optional)").fill(typed);
  await first.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    first.getByRole("alert").filter({ hasText: "changed somewhere else" }),
  ).toContainText("nothing was saved");
  await expect(first.getByLabel("Opening sentence (optional)")).toHaveValue(
    typed,
  );

  const after = await stored(entryId);
  expect(after).toMatchObject({
    deleted: false,
    status: "draft",
    published_at: null,
    opening: "[Test] E2E Newer opening from the second tab.",
    body_text: body,
    version: 2,
  });
  await first.close();
  await second.close();
});
