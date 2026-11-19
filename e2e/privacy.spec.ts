import { expect, test } from "@playwright/test";

import { PRIVATE_PHOTO_ID, PUBLIC_PHOTO_ID } from "./support/data";
import { STUDIO_ROUTES } from "./support/studio";

// Authorization without a session: every Studio page and preview sends the
// visitor to sign-in, and photographs follow the public rule.

test.describe("signed out", () => {
  for (const path of STUDIO_ROUTES) {
    test(`${path} redirects to sign-in`, async ({ page, request }) => {
      // The server answers with a redirect, before rendering anything.
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBeGreaterThanOrEqual(300);
      expect(response.status(), path).toBeLessThan(400);
      expect(response.headers()["location"], path).toMatch(/\/studio\/entrar$/);

      await page.goto(path);
      await expect(page).toHaveURL(/\/studio\/entrar$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "studio",
      );
    });
  }

  test("Studio responses are marked noindex", async ({ request }) => {
    for (const path of ["/studio/entrar", ...STUDIO_ROUTES]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.headers()["x-robots-tag"], path).toContain("noindex");
    }
  });

  test("an unconfirmed photo is a 404", async ({ request }) => {
    const response = await request.get(`/fotos/${PRIVATE_PHOTO_ID}`);
    expect(response.status()).toBe(404);
    expect(response.headers()["cache-control"]).toContain("no-store");
  });

  test("a published tape's confirmed cover is public", async ({ request }) => {
    const response = await request.get(`/fotos/${PUBLIC_PHOTO_ID}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
    expect(response.headers()["cache-control"]).toContain("public");
  });

  test("a malformed or unknown photo id is a 404", async ({ request }) => {
    expect((await request.get("/fotos/x")).status()).toBe(404);
    expect(
      (
        await request.get("/fotos/00000000-0000-4000-8000-000000000000")
      ).status(),
    ).toBe(404);
  });
});
