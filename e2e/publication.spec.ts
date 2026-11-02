import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  createAlbumThroughStudio,
  expectNoHorizontalOverflow,
  expectTouchTarget,
  named,
  withDatabase,
} from "./support";

// Workflow E: publishing from the studio (ADR 0006, browser tests 18 to 22).
// The author previews what readers would see, publishes only by pressing the
// dialog's confirm control, edits published writing only after seeing exactly
// what changes, unpublishes, and restores. The same file runs at a desktop
// width and at 390px (two Playwright projects), each with its own records.
//
// Nothing here exposes anything publicly: M3 has no public routes. The tests
// also check that, and that the confirmation token is never in the page
// outside the dialog and is sent only by the confirm control.
//
// Set PUBLICATION_SHOTS=1 to also write review screenshots to
// visual-review/m2-3/ (ignored by Git; synthetic data only).

test.describe.configure({ mode: "serial" });

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SHOTS = process.env.PUBLICATION_SHOTS === "1";

const opening = "[Test] E2E Pub opening sentence.";
const body = "[Test] E2E Pub the whole album, in the author's words.";
const shown = "[Test] E2E Pub reflection that is set to show.";
const kept = "[Test] E2E Pub reflection that stays private.";

let names: {
  artist: string;
  album: string;
  tracks: [string, string, string];
} = { artist: "", album: "", tracks: ["", "", ""] };
let journalUrl = "";
let slug = "";

function nameThings() {
  const project = test.info().project.name;
  names = {
    artist: named(`Pub ${project} Artist`),
    album: named(`Pub ${project} Album`),
    tracks: [
      named(`Pub ${project} Song 1`),
      named(`Pub ${project} Song 2`),
      named(`Pub ${project} Song 3`),
    ],
  };
}

const literal = (text: string) =>
  new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

async function stored() {
  return withDatabase(async (client) => {
    const result = await client.query<{
      status: string;
      published_at: string | null;
      first_published_at: string | null;
      body_text: string;
      opening: string | null;
      version: number;
      deleted: boolean;
      slug: string;
      was_published: boolean;
    }>(
      `select t.status, t.published_at, t.first_published_at, t.body_text,
              t.opening, e.version, e.deleted_at is not null as deleted,
              s.slug, s.was_published
         from albums a
         join album_journals j on j.album_id = a.id
         join entries e on e.id = j.entry_id
         join entry_texts t on t.entry_id = e.id and t.is_original
         join entry_slugs s on s.entry_id = e.id and s.is_current
        where a.title = $1`,
      [names.album],
    );
    return result.rows[0]!;
  });
}

async function reflections() {
  return withDatabase(async (client) => {
    const result = await client.query<{
      title: string;
      is_published: boolean;
      body_text: string | null;
    }>(
      `select t.title, tr.is_published, trt.body_text
         from albums a
         join album_journals j on j.album_id = a.id
         join track_reflections tr on tr.album_journal_id = j.entry_id
         join tracks t on t.id = tr.track_id
         left join track_reflection_texts trt on trt.track_reflection_id = tr.id
        where a.title = $1
        order by t.title`,
      [names.album],
    );
    return result.rows;
  });
}

async function openTrack(page: Page, title: string) {
  const head = page.getByRole("button", { name: literal(title) });
  if ((await head.getAttribute("aria-expanded")) !== "true") {
    await head.click();
  }
  return page.getByLabel(literal(`Your reflection on ${title}`));
}

const visibility = (page: Page) =>
  page.getByRole("region", { name: "Visibility · English (original)" });

const publishDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Publish the English version?" });

const changeDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Update the public page?" });

async function openEditor(page: Page) {
  await page.goto(`${journalUrl}/edit`);
  await expect(
    page.getByLabel("Your reflection", { exact: true }),
  ).toBeVisible();
}

async function scan(page: Page, what: string) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    result.violations.map((violation) => ({
      rule: violation.id,
      targets: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
    })),
    `axe violations on ${what}`,
  ).toEqual([]);
}

async function shoot(page: Page, name: string) {
  if (SHOTS) {
    await page.screenshot({
      path: `visual-review/m2-3/${test.info().project.name}-${name}.png`,
    });
  }
}

// Every request that carries a confirmation token, so the tests can see where
// it goes. A token has the form "ct1.<claims>.<mac>".
function watchTokens(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (request) => {
    if ((request.postData() ?? "").includes("ct1.")) {
      sent.push(request.url());
    }
  });
  return sent;
}

async function tokenInPage(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document.documentElement.outerHTML.includes("ct1."),
  );
}

test("set up: an album with tracks, a private journal, and two track reflections", async ({
  page,
}) => {
  nameThings();
  await createAlbumThroughStudio(page, {
    artist: names.artist,
    album: names.album,
  });
  for (const title of names.tracks) {
    await page.locator("#new-track-title").fill(title);
    await page.getByRole("button", { name: "Create and add" }).click();
    await expect(page.getByText(title).first()).toBeVisible();
  }
  await page
    .getByRole("link", { name: "Write a journal about this album" })
    .click();
  await page.getByLabel("Opening sentence (optional)").fill(opening);
  await page.getByLabel("Your reflection", { exact: true }).fill(body);
  await page.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/studio\/journals\/[0-9a-f-]{36}$/);
  journalUrl = page.url();

  await openEditor(page);
  // Track 1 is set to show; track 2 is written and stays private.
  await (await openTrack(page, names.tracks[0])).fill(shown);
  await page.getByLabel("Show on the public page").check();
  await (await openTrack(page, names.tracks[1])).fill(kept);
  await page
    .getByRole("group", { name: /Your rating for the album/ })
    .locator("label")
    .filter({ hasText: "4.5 stars" })
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved just now")).toBeVisible();

  expect((await stored()).status).toBe("draft");
  slug = (await stored()).slug;
  expect(await reflections()).toEqual([
    { title: names.tracks[0], is_published: true, body_text: shown },
    { title: names.tracks[1], is_published: false, body_text: kept },
  ]);
});

test("Publish… shows exactly what readers would see and publishes nothing until confirmed", async ({
  page,
}) => {
  const tokens = watchTokens(page);
  await page.goto(journalUrl);
  const panel = visibility(page);
  await expect(panel).toContainText("Draft");
  await panel.getByRole("button", { name: "Publish…", exact: true }).click();

  const dialog = publishDialog(page);
  await expect(dialog).toBeVisible();
  // The disclosure: the opening, the reflection, the address, the album
  // rating, and the track reflection that is set to show, with its language.
  await expect(dialog).toContainText(opening);
  await expect(dialog).toContainText(body);
  await expect(dialog).toContainText(slug);
  await expect(dialog).toContainText("4.5 stars");
  await expect(dialog).toContainText(
    "Track reflections that will be public in English (1)",
  );
  await expect(dialog).toContainText(`${names.tracks[0]} · English`);
  await expect(dialog).toContainText(shown);
  // The private reflection is named by track only, never shown.
  const privateSection = dialog.locator("section").filter({
    hasText: "What stays private",
  });
  await expect(privateSection).toContainText(names.tracks[1]);
  await expect(dialog).not.toContainText(kept);
  // It says that no web page exists yet.
  await expect(dialog).toContainText("nothing opens on the web");
  await shoot(page, "publish-dialog");
  await scan(page, "the publish dialog");

  // Focus starts on the title, so a keypress cannot confirm before reading.
  await expect(
    dialog.getByRole("heading", { name: "Publish the English version?" }),
  ).toBeFocused();
  const confirm = dialog.getByRole("button", {
    name: "Publish the English version",
  });
  await expectTouchTarget(confirm);
  await expectTouchTarget(dialog.getByRole("button", { name: "Cancel" }));
  if (page.viewportSize()!.width <= 400) {
    await expectNoHorizontalOverflow(page);
  }

  // The token exists in the dialog's state only: not in the page, and in no
  // request yet. Nothing is published.
  expect(await tokenInPage(page)).toBe(false);
  expect(tokens).toEqual([]);
  expect((await stored()).status).toBe("draft");

  // Cancelling writes nothing and hands focus back.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    panel.getByRole("button", { name: "Publish…", exact: true }),
  ).toBeFocused();
  expect((await stored()).status).toBe("draft");
  expect(tokens).toEqual([]);

  // Escape closes it too, and writes nothing.
  await panel.getByRole("button", { name: "Publish…", exact: true }).click();
  await expect(publishDialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(publishDialog(page)).toBeHidden();
  expect((await stored()).status).toBe("draft");
  expect(tokens).toEqual([]);
});

test("a change made after the review stops the publication and shows the new state", async ({
  page,
}) => {
  const tokens = watchTokens(page);
  await page.goto(journalUrl);
  await visibility(page)
    .getByRole("button", { name: "Publish…", exact: true })
    .click();
  const dialog = publishDialog(page);
  await expect(dialog).toContainText(
    "Track reflections that will be public in English (1)",
  );

  // Another tab sets the second track to show and saves.
  const other = await page.context().newPage();
  await openEditor(other);
  await openTrack(other, names.tracks[1]);
  await other.getByLabel("Show on the public page").check();
  await other.getByRole("button", { name: "Save", exact: true }).click();
  await expect(other.getByText("Saved just now")).toBeVisible();
  await other.close();

  // The author presses confirm on the old review: refused, nothing published.
  await dialog
    .getByRole("button", { name: "Publish the English version" })
    .click();
  // The notice takes focus, so it is read before anything else.
  await expect(dialog.locator("[data-notice]")).toContainText(
    "has changed since you looked",
  );
  await expect(dialog.locator("[data-notice]")).toBeFocused();
  expect((await stored()).status).toBe("draft");
  // The token was sent once, by the confirm control, and is not offered again.
  expect(tokens).toHaveLength(1);
  await expect(
    dialog.getByRole("button", { name: "Publish the English version" }),
  ).toHaveCount(0);
  expect(await tokenInPage(page)).toBe(false);

  // The author asks for a new review on purpose and sees both reflections.
  await dialog.getByRole("button", { name: "Review it again" }).click();
  await expect(dialog).toContainText(
    "Track reflections that will be public in English (2)",
  );
  await expect(dialog).toContainText(kept);
  expect((await stored()).status).toBe("draft");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Put the second track back to private for the rest of the run.
  await openEditor(page);
  await openTrack(page, names.tracks[1]);
  await page.getByLabel("Show on the public page").uncheck();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved just now")).toBeVisible();
});

test("confirming publishes the version, and the page says what that does and does not mean", async ({
  page,
}) => {
  const tokens = watchTokens(page);
  await page.goto(journalUrl);
  const panel = visibility(page);
  await panel.getByRole("button", { name: "Publish…", exact: true }).click();
  const dialog = publishDialog(page);
  await expect(dialog).toContainText(
    "Track reflections that will be public in English (1)",
  );
  await dialog
    .getByRole("button", { name: "Publish the English version" })
    .click();
  await expect(dialog).toBeHidden();

  // The words come only after the server confirmed it.
  const result = page.getByRole("status").filter({
    hasText: "The English version is now published in your journal.",
  });
  await expect(result).toContainText("Public web pages are not built yet");
  await expect(panel).toContainText("Published");
  await expect(
    panel.getByRole("button", { name: "Unpublish…", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Publish…", exact: true }),
  ).toHaveCount(0);
  expect(tokens).toHaveLength(1);
  expect(await tokenInPage(page)).toBe(false);
  await shoot(page, "published");

  const row = await stored();
  expect(row.status).toBe("published");
  expect(row.published_at).not.toBeNull();
  expect(row.first_published_at).not.toBeNull();
  expect(row.was_published).toBe(true);
  // Publishing changed no reflection's own setting.
  expect((await reflections()).map((r) => r.is_published)).toEqual([
    true,
    false,
  ]);
});

test("no public page exists: an anonymous visitor reaches nothing of it", async ({
  browser,
  baseURL,
}) => {
  const visitor = await browser.newContext({ baseURL });
  const page = await visitor.newPage();
  for (const path of [
    `/${slug}`,
    `/albums/${slug}`,
    `/journals/${slug}`,
    `/en/albums/${slug}`,
    "/sitemap.xml",
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    expect(await page.content(), path).not.toContain(body);
  }
  await visitor.close();
});

test("editing published writing shows exactly what changes, and saves only on confirmation", async ({
  page,
}) => {
  const tokens = watchTokens(page);
  await openEditor(page);
  await expect(
    page.getByText(
      "This version is published. Saving changes the public page.",
    ),
  ).toBeVisible();

  // A shorter text is still a change to the public page.
  const shorter = "[Test] E2E Pub short.";
  await page.getByLabel("Your reflection", { exact: true }).fill(shorter);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const dialog = changeDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Changed: Your reflection · English");
  await expect(dialog).toContainText("Readers see now");
  await expect(dialog).toContainText(body);
  await expect(dialog).toContainText("Readers will see");
  await expect(dialog).toContainText(shorter);
  await shoot(page, "change-dialog");
  await scan(page, "the change dialog");
  await expect(
    dialog.getByRole("heading", { name: "Update the public page?" }),
  ).toBeFocused();
  expect(tokens).toEqual([]);
  expect(await tokenInPage(page)).toBe(false);

  // Cancel: nothing is written and the text stays in the editor.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Your reflection", { exact: true })).toHaveValue(
    shorter,
  );
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  expect((await stored()).body_text).toBe(body);
  expect(tokens).toEqual([]);

  // Save again and confirm.
  const version = (await stored()).version;
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Save and update the public page" })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Saved just now")).toBeVisible();
  expect(tokens).toHaveLength(1);
  const row = await stored();
  expect(row.body_text).toBe(shorter);
  expect(row.version).toBe(version + 1);
  expect(row.status).toBe("published");
});

test("a change that only takes something away asks nothing, and a repeated Save does not double-submit", async ({
  page,
}) => {
  const tokens = watchTokens(page);
  const previews: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") {
      previews.push(request.url());
    }
  });
  await openEditor(page);

  // Unflagging a reflection removes it from the public page: no dialog.
  await openTrack(page, names.tracks[0]);
  await page.getByLabel("Show on the public page").uncheck();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved just now")).toBeVisible();
  await expect(changeDialog(page)).toHaveCount(0);
  expect(tokens).toEqual([]);
  expect((await reflections())[0]!.is_published).toBe(false);

  // An edit, then Cmd+S pressed twice quickly: one dialog, one preview.
  await page
    .getByLabel("Your reflection", { exact: true })
    .fill("[Test] E2E Pub edited twice.");
  previews.length = 0;
  await page.keyboard.press("Control+s");
  await page.keyboard.press("Control+s");
  const dialog = changeDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Readers will see");
  expect(previews).toHaveLength(1);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(tokens).toEqual([]);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
});

test("a review that no longer fits the journal stops the save in the dialog and keeps the text", async ({
  page,
}) => {
  await openEditor(page);
  const typed = "[Test] E2E Pub typed while another tab changed things.";
  await page.getByLabel("Your reflection", { exact: true }).fill(typed);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const dialog = changeDialog(page);
  await expect(dialog).toContainText("Readers will see");

  // Another tab changes a private reflection (nothing public, so no dialog),
  // which moves the journal's version under the open review.
  const other = await page.context().newPage();
  await openEditor(other);
  await (await openTrack(other, names.tracks[1])).fill(`${kept} (edited)`);
  await other.getByRole("button", { name: "Save", exact: true }).click();
  await expect(other.getByText("Saved just now")).toBeVisible();
  await other.close();

  const before = await stored();
  await dialog
    .getByRole("button", { name: "Save and update the public page" })
    .click();
  // The version moved under the review: the save is refused as a conflict,
  // the dialog closes, and the editor says so with the writing still in it.
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("alert").filter({ hasText: "changed somewhere else" }),
  ).toContainText("nothing was saved");
  expect((await stored()).body_text).toBe(before.body_text);
  await expect(page.getByLabel("Your reflection", { exact: true })).toHaveValue(
    typed,
  );
});

test("a conflict keeps the unsaved writing and says what happened", async ({
  page,
}) => {
  await openEditor(page);
  const typed = "[Test] E2E Pub typed in the stale tab.";
  await page.getByLabel("Your reflection", { exact: true }).fill(typed);

  // Another tab saves first (a removal-free edit of the opening needs its own
  // confirmation, so it saves the album rating away instead: a removal).
  const other = await page.context().newPage();
  await openEditor(other);
  await other
    .getByRole("group", { name: /Your rating for the album/ })
    .getByRole("button", { name: "Clear" })
    .click();
  await other.getByRole("button", { name: "Save", exact: true }).click();
  await expect(other.getByText("Saved just now")).toBeVisible();
  await other.close();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  // The review is asked for with the old version: refused before any dialog
  // content, with the writing still in the box.
  await expect(
    page.getByRole("alert").filter({ hasText: "changed somewhere else" }),
  ).toContainText("nothing was saved");
  await expect(changeDialog(page)).toHaveCount(0);
  await expect(page.getByLabel("Your reflection", { exact: true })).toHaveValue(
    typed,
  );
  expect((await stored()).body_text).not.toBe(typed);
});

test("Unpublish… asks first, keeps the writing and its history, and touches nothing else", async ({
  page,
}) => {
  await page.goto(journalUrl);
  const panel = visibility(page);
  await panel.getByRole("button", { name: "Unpublish…", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Unpublish the English version?",
  });
  await expect(dialog).toContainText("Nothing is deleted");
  await expect(dialog).toContainText("other language versions are not touched");
  await shoot(page, "unpublish-dialog");
  await scan(page, "the unpublish dialog");
  const before = await stored();

  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect((await stored()).status).toBe("published");

  await panel.getByRole("button", { name: "Unpublish…", exact: true }).click();
  await dialog.getByRole("button", { name: "Unpublish" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText("The English version is no longer published."),
  ).toBeVisible();
  await expect(page.getByText("Nothing was deleted.")).toBeVisible();

  const after = await stored();
  expect(after.status).toBe("private");
  expect(after.published_at).toBeNull();
  expect(after.body_text).toBe(before.body_text);
  expect(after.first_published_at).toEqual(before.first_published_at);
  expect(after.was_published).toBe(true);
  expect(after.slug).toBe(before.slug);
  expect(await reflections()).toHaveLength(2);
});

test("a published journal that is deleted and restored comes back private, and publishing it again shows the full disclosure first", async ({
  page,
}) => {
  // Publish it again, then set the first track to show, so that a reflection
  // is flagged when the journal is deleted.
  await openEditor(page);
  await openTrack(page, names.tracks[0]);
  await page.getByLabel("Show on the public page").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved just now")).toBeVisible();

  await page.goto(journalUrl);
  await visibility(page)
    .getByRole("button", { name: "Publish…", exact: true })
    .click();
  await publishDialog(page)
    .getByRole("button", { name: "Publish the English version" })
    .click();
  await expect(
    page.getByText("The English version is now published in your journal."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Move to Recently deleted…" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Move to Recently deleted" })
    .click();
  await expect(page).toHaveURL(/\/studio\/journals$/);

  await page.goto("/studio/journals/deleted");
  const row = page.getByRole("listitem").filter({ hasText: names.album });
  await row.getByRole("button", { name: /^Restore the journal about/ }).click();
  const restore = page.getByRole("dialog");
  // The promise matches what the flow really does.
  await expect(restore).toContainText("Restoring publishes nothing");
  await expect(restore).toContainText(
    "including any track reflections you had set to show",
  );
  await restore.getByRole("button", { name: "Restore journal" }).click();
  await expect(page).toHaveURL(/\?restored=private$/);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Restored from Recently deleted" }),
  ).toContainText("Restoring publishes nothing");
  expect((await stored()).status).toBe("private");

  // Publishing again shows the reflection that was set to show before.
  await visibility(page)
    .getByRole("button", { name: "Publish…", exact: true })
    .click();
  const dialog = publishDialog(page);
  await expect(dialog).toContainText(
    "Track reflections that will be public in English (1)",
  );
  await expect(dialog).toContainText(`${names.tracks[0]} · English`);
  expect((await stored()).status).toBe("private");
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("a reflection can be taken off the list from inside the review, and the author confirms the set as it then stands", async ({
  page,
}) => {
  const tokens = watchTokens(page);
  await page.goto(journalUrl);
  await visibility(page)
    .getByRole("button", { name: "Publish…", exact: true })
    .click();
  const dialog = publishDialog(page);
  await expect(dialog).toContainText(
    "Track reflections that will be public in English (1)",
  );

  await dialog.getByRole("button", { name: /^Don’t show this one: / }).click();
  // The removal is saved and said in words; the review on screen is gone with
  // its token, and nothing is published. The author asks for the new review.
  await expect(dialog.locator("[data-notice]")).toContainText(
    "Taken off the list",
  );
  await expect(dialog.locator("[data-notice]")).toBeFocused();
  expect((await reflections())[0]!.is_published).toBe(false);
  expect((await stored()).status).toBe("private");
  expect(tokens).toEqual([]);
  await dialog.getByRole("button", { name: "Review it again" }).click();
  await expect(dialog).toContainText(
    "Track reflections that will be public in English (0)",
  );
  await expect(dialog).toContainText("No track reflection will be shown.");
  await expect(
    dialog.getByRole("heading", { name: "Publish the English version?" }),
  ).toBeFocused();
  expect((await stored()).status).toBe("private");
  expect(tokens).toEqual([]);
  expect((await reflections())[0]!.is_published).toBe(false);

  // Confirming publishes the set as it now stands: no reflection.
  await dialog
    .getByRole("button", { name: "Publish the English version" })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("status").filter({ hasText: "is now published" }),
  ).toBeVisible();
  expect((await stored()).status).toBe("published");
  expect(tokens).toHaveLength(1);
  expect((await reflections()).every((row) => !row.is_published)).toBe(true);
});
