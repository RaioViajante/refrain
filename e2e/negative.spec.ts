import { expect, test } from "@playwright/test";

import {
  createAlbumThroughStudio,
  env,
  mintSession,
  named,
  revokeSession,
  useSession,
  withDatabase,
} from "./support";

// Workflow E: negative behavior. Sessions that the server must not accept,
// and what the author sees when a session ends in the middle of writing. The
// sessions are minted for each test in the disposable database (as the HTTP
// tests do), so none of this uses the rate-limited sign-in.

test.describe("sessions the server does not accept", () => {
  test("an expired session is sent to sign-in", async ({ page }) => {
    await useSession(page, await mintSession(-60));
    await page.goto("/studio/journals");
    await expect(page).toHaveURL(/\/studio\/sign-in$/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("a revoked session is sent to sign-in", async ({ page }) => {
    const session = await mintSession();
    await useSession(page, session);
    await page.goto("/studio");
    await expect(
      page.getByRole("heading", { level: 1, name: "Desk", exact: true }),
    ).toBeVisible();
    await revokeSession(session);
    await page.goto("/studio");
    await expect(page).toHaveURL(/\/studio\/sign-in$/);
  });

  test("a forged cookie, and a real token with a wrong signature, are sent to sign-in", async ({
    page,
    context,
  }) => {
    for (const value of [
      "forged.value",
      `${(await mintSession()).token}.bm90IHRoZSBzaWduYXR1cmU%3D`,
    ]) {
      await context.clearCookies();
      await context.addCookies([
        {
          name: "refrain.session_token",
          value,
          url: env("E2E_BASE_URL"),
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
      await page.goto("/studio/albums");
      await expect(page).toHaveURL(/\/studio\/sign-in$/);
    }
  });
});

test.describe("when the session ends while the author is writing", () => {
  test("the save is refused in words, nothing is stored, and the text stays in the box", async ({
    page,
  }) => {
    const session = await mintSession();
    await useSession(page, session);
    const names = {
      artist: named("Ended Artist"),
      album: named("Ended Album"),
    };
    const { albumUrl } = await createAlbumThroughStudio(page, names);
    const albumId = albumUrl.split("/").pop()!;

    await page.goto(`/studio/journals/new?album=${albumId}`);
    const writing = [
      "[Test] E2E This must not be lost.",
      "",
      "[Test] E2E Second paragraph, typed before the session ended.",
    ].join("\n");
    await page.getByLabel("Your reflection").fill(writing);

    // The session ends (signed out in another tab, expired, revoked).
    await revokeSession(session);

    await page.getByRole("button", { name: "Save as draft" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Your session has ended" }),
    ).toContainText(
      "Your session has ended. Sign in again in another tab, then try again. What you typed is still here.",
    );
    await expect(page.getByLabel("Your reflection")).toHaveValue(writing);
    // The refusal came from the server: no journal was written.
    expect(
      await withDatabase(async (client) => {
        const result = await client.query(
          `select count(*)::int as n from album_journals j
             join albums a on a.id = j.album_id where a.title = $1`,
          [names.album],
        );
        return result.rows[0].n;
      }),
    ).toBe(0);
    // And the studio is closed to this browser from now on.
    await page.goto("/studio/journals");
    await expect(page).toHaveURL(/\/studio\/sign-in$/);
  });
});

test.describe("invalid input is refused in words", () => {
  test("a blank artist name and a malformed identifier say what is wrong, and store nothing", async ({
    page,
  }) => {
    await useSession(page, await mintSession());
    await page.goto("/studio/artists/new");
    await page.getByRole("button", { name: "Add artist" }).click();
    await expect(page.getByText("This is required.")).toBeVisible();
    await expect(page).toHaveURL(/\/studio\/artists\/new$/);

    await page.getByLabel("Name", { exact: true }).fill(named("Invalid Id"));
    await page
      .getByLabel("MusicBrainz artist ID (optional)")
      .fill("not-an-identifier");
    await page.getByRole("button", { name: "Add artist" }).click();
    await expect(page.getByText("This isn’t valid.")).toBeVisible();
    await expect(page).toHaveURL(/\/studio\/artists\/new$/);
    expect(
      await withDatabase(async (client) => {
        const result = await client.query(
          "select count(*)::int as n from artists where name = $1",
          [named("Invalid Id")],
        );
        return result.rows[0].n;
      }),
    ).toBe(0);
  });
});
