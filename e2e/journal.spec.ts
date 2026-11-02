import { expect, test, type Page } from "@playwright/test";

import { createAlbumThroughStudio, named, withDatabase } from "./support";

// Workflow C: writing a journal. The words are checked as the author typed
// them: paragraphs, a line break, and literal markup, through saving,
// leaving, coming back, editing one field, and saving again. The tests run in
// order and share the journal they create.

test.describe.configure({ mode: "serial" });

const names = {
  artist: named("Journal Artist"),
  album: named("Journal Album"),
};
const opening = "[Test] E2E An opening sentence.";
const firstParagraph =
  "[Test] E2E First paragraph, with a\nline break inside it.";
const secondParagraph =
  "[Test] E2E Second paragraph with <b>literal markup</b> & more.";
const thirdParagraph = "[Test] E2E Third paragraph.";
const body = [firstParagraph, secondParagraph, thirdParagraph].join("\n\n");

let albumUrl = "";
let journalUrl = "";

async function openEditor(page: Page) {
  await page.goto(`${journalUrl}/edit`);
  await expect(page.getByLabel("Your reflection")).toBeVisible();
}

async function stored() {
  return withDatabase(async (client) => {
    const result = await client.query<{
      opening: string | null;
      body_text: string;
      status: string;
      version: number;
      deleted: boolean;
    }>(
      `select t.opening, t.body_text, t.status, e.version,
              e.deleted_at is not null as deleted
         from albums a
         join album_journals j on j.album_id = a.id
         join entries e on e.id = j.entry_id
         join entry_texts t on t.entry_id = e.id and t.is_original
        where a.title = $1`,
      [names.album],
    );
    return result.rows;
  });
}

test("creates a private draft with several paragraphs, and finds the exact text after leaving", async ({
  page,
}) => {
  ({ albumUrl } = await createAlbumThroughStudio(page, names));

  await page
    .getByRole("link", { name: "Write a journal about this album" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Write about ${names.album}` }),
  ).toBeVisible();
  await page.getByLabel("Opening sentence (optional)").fill(opening);
  await page.getByLabel("Your reflection").fill(body);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save as draft" }).click();

  // The new journal's page: a draft, in the author's words.
  await page.waitForURL(/\/studio\/journals\/[0-9a-f-]{36}$/);
  journalUrl = page.url();
  await expect(
    page.getByRole("heading", { level: 1, name: names.album, exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();

  // Leave for another page and come back through the list.
  await page.goto("/studio/journals");
  await page
    .getByRole("list", { name: "Journals" })
    .getByRole("listitem")
    .filter({ hasText: names.album })
    .getByRole("link", { name: names.album })
    .click();
  await expect(page).toHaveURL(journalUrl);

  // Every paragraph, in order; markup shown as text, never interpreted.
  const reading = page.locator(".studio-reading p");
  await expect(reading).toHaveCount(3);
  await expect(reading.nth(0)).toHaveText(firstParagraph.replace("\n", ""));
  await expect(reading.nth(0).locator("br")).toHaveCount(1);
  await expect(reading.nth(1)).toHaveText(secondParagraph);
  await expect(reading.nth(2)).toHaveText(thirdParagraph);
  await expect(page.locator(".studio-reading b")).toHaveCount(0);
  await expect(page.locator(".studio-opening")).toHaveText(opening);

  // And the editor gives back exactly what was typed.
  await openEditor(page);
  await expect(page.getByLabel("Your reflection")).toHaveValue(body);
  await expect(page.getByLabel("Opening sentence (optional)")).toHaveValue(
    opening,
  );

  const [row] = await stored();
  expect(row).toMatchObject({
    opening,
    body_text: body,
    status: "draft",
    version: 1,
    deleted: false,
  });
});

test("edits one field without touching the others, and the change survives a new visit", async ({
  page,
}) => {
  // Only the opening sentence: the reflection stays exactly as it was.
  await openEditor(page);
  const newOpening = "[Test] E2E A different opening.";
  await page.getByLabel("Opening sentence (optional)").fill(newOpening);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved just now")).toBeVisible();

  await page.goto("/studio/journals");
  await openEditor(page);
  await expect(page.getByLabel("Opening sentence (optional)")).toHaveValue(
    newOpening,
  );
  await expect(page.getByLabel("Your reflection")).toHaveValue(body);

  // Then only the reflection, with the keyboard: the opening stays.
  const editedBody = body.replace(
    "Third paragraph.",
    "Third paragraph, revised.",
  );
  await page.getByLabel("Your reflection").fill(editedBody);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved just now")).toBeVisible();

  await page.goto(journalUrl);
  await expect(page.locator(".studio-opening")).toHaveText(newOpening);
  await expect(page.locator(".studio-reading p").nth(2)).toHaveText(
    "[Test] E2E Third paragraph, revised.",
  );
  await expect(page.locator(".studio-reading p")).toHaveCount(3);
  const [row] = await stored();
  expect(row).toMatchObject({
    opening: newOpening,
    body_text: editedBody,
    status: "draft",
    version: 3,
  });
});

test("a save from a stale tab is refused as a conflict, and its text stays in the box", async ({
  page,
}) => {
  const other = await page.context().newPage();
  await openEditor(page);
  await openEditor(other);

  // The other tab saves first.
  await other
    .getByLabel("Opening sentence (optional)")
    .fill("[Test] E2E Saved in the other tab.");
  await other.getByRole("button", { name: "Save", exact: true }).click();
  await expect(other.getByText("Saved just now")).toBeVisible();

  // This tab still holds the old version.
  const typed = "[Test] E2E Typed in the stale tab.";
  await page.getByLabel("Opening sentence (optional)").fill(typed);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "changed somewhere else" }),
  ).toContainText("nothing was saved");
  await expect(page.getByLabel("Opening sentence (optional)")).toHaveValue(
    typed,
  );

  // The other tab's words are what is stored.
  const [row] = await stored();
  expect(row?.opening).toBe("[Test] E2E Saved in the other tab.");
  await other.close();
});

test("changes who can see it between draft and private; Publish… only shows the disclosure", async ({
  page,
}) => {
  await page.goto(journalUrl);
  const privacy = page.getByRole("group", {
    name: "Private state of the English version",
  });
  await expect(privacy.getByRole("button", { name: "Draft" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await privacy.getByRole("button", { name: "Private" }).click();
  await expect(page.getByText("English: now private.")).toBeVisible();
  await page.reload();
  await expect(
    privacy.getByRole("button", { name: "Private" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect((await stored())[0]?.status).toBe("private");

  // Publishing is offered only as a review: opening and cancelling it
  // publishes nothing (the publication spec covers the whole workflow).
  await page.getByRole("button", { name: "Publish…" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Publish the English version?",
  });
  await expect(dialog).toContainText("Nothing is published until you press");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect((await stored())[0]?.status).toBe("private");

  // The album still shows its journal.
  await page.goto(albumUrl);
  await expect(page.getByText("Journal started")).toBeVisible();
});
