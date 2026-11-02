import { expect, test, type Page } from "@playwright/test";

import {
  createAlbumThroughStudio,
  expectNoHorizontalOverflow,
  expectTouchTarget,
  named,
} from "./support";

// The Studio at 390 px, on a touch device: no page scrolls sideways, the
// main controls are at least 44 by 44 pixels, and the delete-and-restore flow
// works with taps. The tests run in order and share their records.

test.describe.configure({ mode: "serial" });

test.describe("sign-in", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("fits the screen and its controls are large enough", async ({
    page,
  }) => {
    await page.goto("/studio/sign-in");
    await expectNoHorizontalOverflow(page);
    await expectTouchTarget(page.getByRole("button", { name: "Sign in" }));
    await expectTouchTarget(page.getByLabel("Email"));
    await expectTouchTarget(page.getByLabel("Password"));
  });
});

const names = { artist: named("Mobile Artist"), album: named("Mobile Album") };
let albumUrl = "";
let journalUrl = "";

async function expectFits(page: Page, path: string) {
  await page.goto(path);
  await expect(
    page.getByRole("navigation", { name: "Writing studio" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
}

test("every studio page fits a 390 px screen", async ({ page }) => {
  ({ albumUrl } = await createAlbumThroughStudio(page, names));
  await page.locator("#new-track-title").fill(named("Mobile Track"));
  await page.getByRole("button", { name: "Create and add" }).click();
  await expect(
    page.getByRole("list", { name: "Tracklist" }).getByRole("listitem"),
  ).toHaveCount(1);

  await page.goto(`/studio/journals/new?album=${albumUrl.split("/").pop()}`);
  await page
    .getByLabel("Your reflection")
    .fill("[Test] E2E Mobile first.\n\n[Test] E2E Mobile second.");
  await page.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/studio\/journals\/[0-9a-f-]{36}$/);
  journalUrl = page.url();

  for (const path of [
    "/studio",
    "/studio/artists",
    "/studio/artists/new",
    "/studio/albums",
    "/studio/albums/new",
    new URL(albumUrl).pathname,
    "/studio/tracks",
    "/studio/tracks/new",
    "/studio/journals",
    "/studio/journals/new",
    new URL(journalUrl).pathname,
    `${new URL(journalUrl).pathname}/edit`,
    "/studio/journals/deleted",
  ]) {
    await expectFits(page, path);
  }
});

test("deleting and restoring a journal works by touch, and the controls are large enough", async ({
  page,
}) => {
  await page.goto(journalUrl);
  await expectTouchTarget(page.getByRole("button", { name: "Sign out" }));
  await expectTouchTarget(page.getByRole("button", { name: "Draft" }));
  await expectTouchTarget(page.getByRole("button", { name: "Private" }));
  const remove = page.getByRole("button", {
    name: "Move to Recently deleted…",
  });
  await expectTouchTarget(remove);
  await remove.tap();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectTouchTarget(
    dialog.getByRole("button", { name: "Move to Recently deleted" }),
  );
  await expectTouchTarget(dialog.getByRole("button", { name: "Cancel" }));
  await dialog.getByRole("button", { name: "Move to Recently deleted" }).tap();
  await expect(page).toHaveURL(/\/studio\/journals$/);

  await page.getByRole("link", { name: "Open Recently deleted" }).tap();
  await expect(page).toHaveURL(/\/deleted$/);
  await expectNoHorizontalOverflow(page);
  const row = page.getByRole("listitem").filter({ hasText: names.album });
  const restore = row.getByRole("button", {
    name: `Restore the journal about ${names.album}`,
  });
  await expectTouchTarget(restore);
  await restore.tap();
  const confirm = page.getByRole("dialog");
  await expectNoHorizontalOverflow(page);
  await expectTouchTarget(
    confirm.getByRole("button", { name: "Restore journal" }),
  );
  await confirm.getByRole("button", { name: "Restore journal" }).tap();

  await expect(page).toHaveURL(/\?restored=1$/);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Restored from Recently deleted" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".studio-reading p")).toHaveCount(2);
});

test("track by track fits a 390 px screen, and its controls are large enough to tap", async ({
  page,
}) => {
  await page.goto(`${new URL(journalUrl).pathname}/edit`);
  const head = page.getByRole("button", { name: /^Track 1:/ });
  await expectTouchTarget(head);
  await head.tap();
  const text = page.getByLabel(/^Your reflection on /);
  await expect(text).toBeVisible();
  await expectNoHorizontalOverflow(page);
  for (const label of [
    "Mark as favourite",
    "Still writing",
    "Show on the public page",
  ]) {
    const control = page.getByLabel(label);
    await control.tap();
    await expect(control).toBeChecked();
    // The label is the target: the whole row is at least 44px tall.
    const box = await page.getByText(label, { exact: true }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(43.5);
  }
  const rating = page.getByRole("group", { name: /Rating for this track/ });
  for (const half of await rating.locator(".studio-star-half label").all()) {
    const box = await half.boundingBox();
    // Star halves are the documented exception to the width; the row is 44px.
    expect(box!.height).toBeGreaterThanOrEqual(43.5);
  }
  await rating.locator("label").filter({ hasText: "4 stars" }).tap();
  await expect(rating.getByLabel("4 stars")).toBeChecked();
  await expectNoHorizontalOverflow(page);
});
