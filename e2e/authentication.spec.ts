import { expect, test } from "@playwright/test";

import { env } from "./support";

// Workflow A: authentication. These tests have no stored session (the
// "anonymous" project), and each runs in its own isolated browser context, so
// nothing is shared with the signed-in tests. Sign-in is rate limited for all
// clients together, so the two sign-ins here and the one in auth.setup.ts stay
// within the five a minute.

const PRIVATE_PATHS = [
  "/studio",
  "/studio/catalog",
  "/studio/artists",
  "/studio/albums",
  "/studio/tracks",
  "/studio/journals",
  "/studio/journals/deleted",
  "/studio/journals/new",
];

test("a visitor is sent to sign-in from every studio page, and sees nothing private", async ({
  page,
}) => {
  for (const path of PRIVATE_PATHS) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/studio\/sign-in$/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Desk", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "Writing studio" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "Catalog sections" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  }
  expect(await page.context().cookies()).toEqual([]);
});

test("a wrong password is refused in words, the right one opens the studio, and signing out ends the session", async ({
  page,
  context,
}) => {
  await page.goto("/studio/sign-in");

  // Wrong password: the same words whatever is wrong, and no session.
  await page.getByLabel("Email").fill(env("E2E_AUTHOR_EMAIL"));
  await page.getByLabel("Password").fill("[Test] not the password at all");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#sign-in-message")).toHaveText(
    "That email and password don’t match.",
  );
  await expect(page).toHaveURL(/\/studio\/sign-in$/);
  expect(
    (await context.cookies()).filter((c) => c.name.includes("session_token")),
  ).toEqual([]);

  // The right one.
  await page.getByLabel("Password").fill(env("E2E_AUTHOR_PASSWORD"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Desk", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/studio$/);

  // The session cookie is protected from scripts and from other sites.
  const [session] = (await context.cookies()).filter(
    (c) => c.name === "refrain.session_token",
  );
  expect(session).toBeDefined();
  expect(session).toMatchObject({ httpOnly: true, sameSite: "Strict" });
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "session_token",
  );

  // The studio is open to this session.
  await page.goto("/studio/journals");
  await expect(
    page.getByRole("heading", { level: 1, name: "Journals" }),
  ).toBeVisible();

  // Sign out: back at sign-in, the cookie gone, and the page cannot be
  // brought back, by reload, by "back", or by address.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/studio\/sign-in$/);
  expect(
    (await context.cookies()).filter((c) => c.name.includes("session_token")),
  ).toEqual([]);
  await page.goBack();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Journals" }),
  ).toHaveCount(0);
  for (const path of PRIVATE_PATHS) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/studio\/sign-in$/);
  }
});
