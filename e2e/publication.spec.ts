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
  // The repeat index keeps each `--repeat-each` round's records apart.
  const project = `${test.info().project.name} ${test.info().repeatEachIndex}`;
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
  page.getByRole("dialog", { name: "Update published writing?" });

const removalDialog = (page: Page) =>
  page.getByRole("dialog", {
    name: "Take this away from the published journal?",
  });

async function albumRatingStored() {
  return withDatabase(async (client) => {
    const result = await client.query<{ rating_half_steps: number | null }>(
      `select j.rating_half_steps
         from albums a
         join album_journals j on j.album_id = a.id
        where a.title = $1`,
      [names.album],
    );
    return result.rows[0]!.rating_half_steps;
  });
}

async function openEditor(page: Page) {
  await page.goto(`${journalUrl}/edit`);
  // Visible is not ready: hydration rewrites the field, and a `fill` running
  // at that moment inserts beside the stored text instead of replacing it.
  await expect(page.locator("form[data-editor-ready]")).toBeAttached();
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
  await page.getByLabel("Include when published").check();
  await expect(
    page.getByText(/That publishes nothing by itself/),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shoot(page, "track-setting");
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
    "Track reflections that will be published in English (1)",
  );
  await expect(dialog).toContainText(`${names.tracks[0]} · English`);
  await expect(dialog).toContainText(shown);
  // The private reflection is named by track only, never shown.
  const privateSection = dialog.locator("section").filter({
    hasText: "What stays private",
  });
  await expect(privateSection).toContainText(names.tracks[1]);
  await expect(dialog).not.toContainText(kept);
  // The artist page publishing would open (M3.5), with its address: the
  // album's artist has no page yet.
  const artistPages = dialog.locator("section").filter({
    hasText: "Artist pages that will open (1)",
  });
  await expect(artistPages).toContainText(names.artist);
  await expect(artistPages).toContainText(
    `/artists/${names.artist
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")}`,
  );
  await expect(artistPages).toContainText("Without a photograph");
  // It says, truthfully for any configuration, when the web page opens.
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
    "Track reflections that will be published in English (1)",
  );

  // Another tab sets the second track to show and saves.
  const other = await page.context().newPage();
  await openEditor(other);
  await openTrack(other, names.tracks[1]);
  await other.getByLabel("Include when published").check();
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
    "Track reflections that will be published in English (2)",
  );
  await expect(dialog).toContainText(kept);
  expect((await stored()).status).toBe("draft");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Put the second track back to private for the rest of the run.
  await openEditor(page);
  await openTrack(page, names.tracks[1]);
  await page.getByLabel("Include when published").uncheck();
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
    "Track reflections that will be published in English (1)",
  );
  await dialog
    .getByRole("button", { name: "Publish the English version" })
    .click();
  await expect(dialog).toBeHidden();

  // The words come only after the server confirmed it.
  const result = page.getByRole("status").filter({
    hasText: "The English version is now published in your journal.",
  });
  await expect(result).toContainText("only where public reads are switched on");
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

test("public reads are off by default: an anonymous visitor reaches nothing of it", async ({
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
      "This version is published. Saving changes the published writing.",
    ),
  ).toBeVisible();

  // A shorter text is still a change to the public page.
  const shorter = "[Test] E2E Pub short.";
  await page.getByLabel("Your reflection", { exact: true }).fill(shorter);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const dialog = changeDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Changed: Your reflection · English");
  await expect(dialog).toContainText("Published now");
  await expect(dialog).toContainText(body);
  await expect(dialog).toContainText("Published after saving");
  await expect(dialog).toContainText(shorter);
  await shoot(page, "change-dialog");
  await scan(page, "the change dialog");
  await expect(
    dialog.getByRole("heading", { name: "Update published writing?" }),
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
    .getByRole("button", { name: "Save and update published writing" })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Saved just now")).toBeVisible();
  expect(tokens).toHaveLength(1);
  const row = await stored();
  expect(row.body_text).toBe(shorter);
  expect(row.version).toBe(version + 1);
  expect(row.status).toBe("published");
});

test("a change that only takes something away asks first, names it, and Cancel writes nothing (issue #54)", async ({
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

  // Clearing the text of a public reflection takes it away from readers. It
  // needs no token, but the editor asks first and names it.
  const field = await openTrack(page, names.tracks[0]);
  await field.fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const removal = removalDialog(page);
  await expect(removal).toBeVisible();
  await expect(removal.getByRole("listitem")).toHaveText([
    `Reflection on the track · ${names.tracks[0]} · English`,
  ]);
  await expect(removal).toContainText(
    "Cancelling leaves your text in the editor",
  );
  await expect(changeDialog(page)).toHaveCount(0);
  await shoot(page, "removal-dialog");
  await scan(page, "the removal dialog");
  await expectTouchTarget(
    removal.getByRole("button", { name: "Save and take it away" }),
  );
  await expectTouchTarget(removal.getByRole("button", { name: "Cancel" }));
  await expectNoHorizontalOverflow(page);

  // Cancel writes nothing and leaves the edit in the editor.
  await removal.getByRole("button", { name: "Cancel" }).click();
  await expect(removal).toBeHidden();
  await expect(field).toHaveValue("");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  expect((await reflections())[0]).toMatchObject({
    is_published: true,
    body_text: shown,
  });

  // Text the server stores nothing for (a control character and a zero-width
  // one) is a removal too: the editor asks the server's own question.
  await field.fill("\u0001\u200B");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(removal.getByRole("listitem")).toHaveText([
    `Reflection on the track · ${names.tracks[0]} · English`,
  ]);
  await removal.getByRole("button", { name: "Cancel" }).click();
  await expect(removal).toBeHidden();
  expect((await reflections())[0]).toMatchObject({
    is_published: true,
    body_text: shown,
  });

  // Unflagging the reflection is the same removal, named once; confirming
  // saves it, without any token.
  await field.fill(shown);
  await page.getByLabel("Include when published").uncheck();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(removal.getByRole("listitem")).toHaveText([
    `Reflection on the track · ${names.tracks[0]} · English`,
  ]);
  await removal.getByRole("button", { name: "Save and take it away" }).click();
  await expect(removal).toBeHidden();
  await expect(page.getByText("Saved just now")).toBeVisible();
  expect(tokens).toEqual([]);
  expect((await reflections())[0]).toMatchObject({
    is_published: false,
    body_text: shown,
  });

  // An edit, then Cmd+S pressed twice quickly: one dialog, one preview.
  await page
    .getByLabel("Your reflection", { exact: true })
    .fill("[Test] E2E Pub edited twice.");
  previews.length = 0;
  await page.keyboard.press("Control+s");
  await page.keyboard.press("Control+s");
  const dialog = changeDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Published after saving");
  expect(previews).toHaveLength(1);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(tokens).toEqual([]);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
});

test("a save that edits and takes away shows both before anything is written (issue #54)", async ({
  page,
}) => {
  const tokens = watchTokens(page);
  await openEditor(page);
  const before = await stored();
  expect(await albumRatingStored()).toBe(9);

  await page
    .getByLabel("Your reflection", { exact: true })
    .fill("[Test] E2E Pub edited and taken away.");
  await page
    .getByRole("group", { name: /Your rating for the album/ })
    .getByRole("button", { name: "Clear" })
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const dialog = changeDialog(page);
  await expect(dialog).toContainText("Changed: Your reflection · English");
  await expect(dialog).toContainText("Taken away from the published writing");
  await expect(dialog.getByRole("list").last()).toHaveText(
    "Your rating for the album",
  );
  await expect(removalDialog(page)).toHaveCount(0);
  await shoot(page, "change-and-removal");
  await scan(page, "the change dialog with a removal");
  await expectNoHorizontalOverflow(page);

  // Cancel: neither the edit nor the removal is written.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect((await stored()).body_text).toBe(before.body_text);
  expect(await albumRatingStored()).toBe(9);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  expect(tokens).toEqual([]);
});

test("a review that no longer fits the journal stops the save in the dialog and keeps the text", async ({
  page,
}) => {
  await openEditor(page);
  const typed = "[Test] E2E Pub typed while another tab changed things.";
  await page.getByLabel("Your reflection", { exact: true }).fill(typed);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const dialog = changeDialog(page);
  await expect(dialog).toContainText("Published after saving");

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
    .getByRole("button", { name: "Save and update published writing" })
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

  // Another tab saves first: it takes the album rating away, which needs no
  // token, but the editor asks first (issue #54).
  const other = await page.context().newPage();
  await openEditor(other);
  await other
    .getByRole("group", { name: /Your rating for the album/ })
    .getByRole("button", { name: "Clear" })
    .click();
  await other.getByRole("button", { name: "Save", exact: true }).click();
  const removal = removalDialog(other);
  await expect(removal.getByRole("listitem")).toHaveText([
    "Your rating for the album",
  ]);
  await removal.getByRole("button", { name: "Save and take it away" }).click();
  await expect(other.getByText("Saved just now")).toBeVisible();
  expect(await albumRatingStored()).toBeNull();
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
  await page.getByLabel("Include when published").check();
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
    "including any track reflections you had set to be included when published",
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
    "Track reflections that will be published in English (1)",
  );
  await expect(dialog).toContainText(`${names.tracks[0]} · English`);
  expect((await stored()).status).toBe("private");
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("closing a review never changes anything, and the way to change what is shown is the track editor", async ({
  page,
}) => {
  const tokens = watchTokens(page);
  await page.goto(journalUrl);
  const state = async () => ({
    stored: await stored(),
    reflections: await reflections(),
  });
  const before = await state();

  const panel = visibility(page);
  await panel.getByRole("button", { name: "Publish…", exact: true }).click();
  const dialog = publishDialog(page);
  await expect(dialog).toContainText(
    "Track reflections that will be published in English (1)",
  );
  // Nothing in the review saves: there is no control that changes a flag.
  await expect(dialog.getByRole("button")).toHaveText([
    "Publish the English version",
    "Cancel",
  ]);
  await expect(dialog).toContainText("closing it leaves everything as it was");

  // Cancel, Escape, and opening it again: nothing moved, no token was sent.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await panel.getByRole("button", { name: "Publish…", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await state()).toEqual(before);
  expect(tokens).toEqual([]);

  // To change what is shown, the review points to the track editor. Following
  // it leaves the review (and its token) behind and still changes nothing.
  await panel.getByRole("button", { name: "Publish…", exact: true }).click();
  await dialog
    .getByRole("link", {
      name: "Change which reflections are included, on the tracks",
    })
    .click();
  await expect(page).toHaveURL(/\/edit$/);
  expect(await state()).toEqual(before);
  expect(tokens).toEqual([]);

  // There the author unflags the track and saves, on purpose; then a new
  // review lists the set as it now stands, and confirming publishes that.
  await openTrack(page, names.tracks[0]);
  await page.getByLabel("Include when published").uncheck();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved just now")).toBeVisible();
  await page.goto(journalUrl);
  await panel.getByRole("button", { name: "Publish…", exact: true }).click();
  await expect(dialog).toContainText(
    "Track reflections that will be published in English (0)",
  );
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

test("a stale tab cannot undo another tab: Draft, Private, and Unpublish say what changed and change nothing", async ({
  page,
}) => {
  // The journal is published (the previous test). Tab A loads the page now.
  await page.goto(journalUrl);
  const panel = visibility(page);
  await expect(
    panel.getByRole("button", { name: "Unpublish…", exact: true }),
  ).toBeVisible();

  // Tab B unpublishes it to private through the studio.
  const other = await page.context().newPage();
  await other.goto(journalUrl);
  const otherPanel = visibility(other);
  await otherPanel
    .getByRole("button", { name: "Unpublish…", exact: true })
    .click();
  await other
    .getByRole("dialog", { name: "Unpublish the English version?" })
    .getByRole("button", { name: "Unpublish" })
    .click();
  await expect(other.getByText("is no longer published.")).toBeVisible();
  expect((await stored()).status).toBe("private");

  // Tab A still shows "Published". Its Unpublish is stale: refused in words,
  // not applied a second time, and the page then shows the real state.
  await panel.getByRole("button", { name: "Unpublish…", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Unpublish the English version?" })
    .getByRole("button", { name: "Unpublish" })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "was changed somewhere else" }),
  ).toContainText("nothing was changed here");
  expect((await stored()).status).toBe("private");
  await expect(
    panel.getByRole("button", { name: "Private", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  // Tab B publishes it again; tab A, now showing "Private", clicks Draft.
  await visibility(other)
    .getByRole("button", { name: "Publish…", exact: true })
    .click();
  const review = publishDialog(other);
  await expect(review).toContainText(
    "Track reflections that will be published",
  );
  await review
    .getByRole("button", { name: "Publish the English version" })
    .click();
  await expect(
    other.getByText("is now published in your journal."),
  ).toBeVisible();
  expect((await stored()).status).toBe("published");

  await panel.getByRole("button", { name: "Draft", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "was changed somewhere else" }),
  ).toBeVisible();
  // Nothing was unpublished by the stale click.
  expect((await stored()).status).toBe("published");
  await expect(
    panel.getByRole("button", { name: "Unpublish…", exact: true }),
  ).toBeVisible();
  await other.close();
});

test("a tab that still shows the journal unpublished cannot take something away without asking (issue #54)", async ({
  page,
}) => {
  // The journal is published (the previous test). Unpublish it through the
  // studio, then load the editor: it shows nothing published.
  await page.goto(journalUrl);
  await visibility(page)
    .getByRole("button", { name: "Unpublish…", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Unpublish the English version?" })
    .getByRole("button", { name: "Unpublish" })
    .click();
  await expect(page.getByText("is no longer published.")).toBeVisible();
  await openEditor(page);
  // While nothing is published, including a reflection asks nothing.
  await openTrack(page, names.tracks[0]);
  await page.getByLabel("Include when published").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved just now")).toBeVisible();
  expect((await reflections())[0]!.is_published).toBe(true);

  // Another tab publishes it, with the reflection.
  const other = await page.context().newPage();
  await other.goto(journalUrl);
  await visibility(other)
    .getByRole("button", { name: "Publish…", exact: true })
    .click();
  await publishDialog(other)
    .getByRole("button", { name: "Publish the English version" })
    .click();
  await expect(
    other.getByText("is now published in your journal."),
  ).toBeVisible();
  expect((await stored()).status).toBe("published");

  // This tab still shows it unpublished. Its removal is refused, nothing is
  // written, and the page then shows the journal as published.
  await page.getByLabel("Include when published").uncheck();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "changed somewhere else" }),
  ).toBeVisible();
  await expect(removalDialog(page)).toHaveCount(0);
  expect((await reflections())[0]!.is_published).toBe(true);
  await expect(
    page.getByText(
      "This version is published. Saving changes the published writing.",
    ),
  ).toBeVisible();

  // The next save asks, naming what readers would lose; Cancel keeps it.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const removal = removalDialog(page);
  await expect(removal.getByRole("listitem")).toHaveText([
    `Reflection on the track · ${names.tracks[0]} · English`,
  ]);
  await removal.getByRole("button", { name: "Cancel" }).click();
  await expect(removal).toBeHidden();
  expect((await reflections())[0]!.is_published).toBe(true);
  await expect(page.getByLabel("Include when published")).not.toBeChecked();
  await other.close();
});
