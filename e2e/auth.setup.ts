import { expect, test as setup } from "@playwright/test";

import { AUTH_FILE } from "./constants";
import { env } from "./support";

// Signs in once, through the real sign-in form, as the synthetic author, and
// keeps the session for the authenticated projects. Sign-in is rate limited
// for all clients together (five a minute), so the suite signs in as few
// times as it can: here, and twice in authentication.spec.ts.
setup("sign in as the synthetic author", async ({ page }) => {
  await page.goto("/studio");
  await expect(page).toHaveURL(/\/studio\/sign-in$/);
  await page.getByLabel("Email").fill(env("E2E_AUTHOR_EMAIL"));
  await page.getByLabel("Password").fill(env("E2E_AUTHOR_PASSWORD"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Desk", exact: true }),
  ).toBeVisible();
  await page.context().storageState({ path: AUTH_FILE });
});
