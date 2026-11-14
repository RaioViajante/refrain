import { execFile } from "node:child_process";
import { promisify } from "node:util";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  env,
  expectNoHorizontalOverflow,
  expectTouchTarget,
  withDatabase,
} from "./support";

// Removing an album's cover in a real browser (ADR 0006 A8), at desktop width
// and at 390 px, in English and Portuguese: the album of a published journal
// shows the public-page panel (no cover can be chosen), and still offers
// "Remove artwork…", which asks first; Cancel changes nothing. After the
// removal the Studio and the public page show the fallback frame, focus goes
// to the page's heading, and the journal is still published. No real artwork
// is fetched: every request to a cover host is answered with a synthetic
// image.

const publicOn = env("E2E_PUBLIC_URL");
const studioOn = env("E2E_BASE_URL");
const slug = env("E2E_PUBLIC_SLUG");
const entryId = env("E2E_PUBLIC_ENTRY_ID");

const RELEASE = "3f8c4f8e-0000-4000-8000-000000000002";
const STORED = `https://coverartarchive.org/release/${RELEASE}/1000000002`;
const COVER_HOSTS =
  /^https?:\/\/([a-z0-9-]+\.)*(coverartarchive|archive)\.org\//;
const TEST_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#89341d"/></svg>`;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const execFileAsync = promisify(execFile);

test.describe.configure({ mode: "serial" });

async function setCover(value: string) {
  await execFileAsync(
    "pnpm",
    [
      "--silent",
      "tsx",
      "--conditions=react-server",
      "src/testing/public-seed-cli.ts",
      "cover",
      entryId,
      value,
    ],
    { env: process.env },
  );
}

async function storedCover(): Promise<string | null> {
  return withDatabase(
    async (client) =>
      (
        await client.query(
          `select a.cover_url from albums a
             join album_journals aj on aj.album_id = a.id
            where aj.entry_id = $1`,
          [entryId],
        )
      ).rows[0].cover_url as string | null,
  );
}

async function journalStatus(): Promise<string> {
  return withDatabase(
    async (client) =>
      (
        await client.query(
          "select status from entry_texts where entry_id = $1 and is_original",
          [entryId],
        )
      ).rows[0].status as string,
  );
}

test.afterAll(async () => {
  await setCover("none");
});

async function syntheticCovers(page: Page) {
  await page.route(COVER_HOSTS, (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: TEST_IMAGE }),
  );
}

async function noAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
}

const LANGUAGES = [
  {
    prefix: "",
    title: "Artwork",
    panel: "Shown on a public page",
    canRemove: "You can still remove the cover above.",
    remove: "Remove artwork…",
    question: "Remove this album’s artwork?",
    confirm: "Remove",
    cancel: "Cancel",
    done: "Artwork removed. The album shows the “no artwork yet” frame.",
    none: "No album artwork yet",
    fallback: /^Album artwork for .*: not available yet$/,
  },
  {
    prefix: "/pt",
    title: "Capa",
    panel: "Exibido numa página pública",
    canRemove: "Você ainda pode remover a capa acima.",
    remove: "Remover a capa…",
    question: "Remover a capa deste álbum?",
    confirm: "Remover",
    cancel: "Cancelar",
    done: "Capa removida. O álbum mostra o quadro “ainda sem capa”.",
    none: "Ainda sem capa do álbum",
    fallback: /^Capa do álbum .*: ainda não disponível$/,
  },
] as const;

for (const w of LANGUAGES) {
  test(`takes a published journal's cover down without unpublishing it (${w.prefix || "en"})`, async ({
    page,
  }) => {
    await setCover(STORED);
    await syntheticCovers(page);

    await page.goto(`${studioOn}${w.prefix}/studio/journals/${entryId}`);
    const album = await page
      .locator(`a[href^="${w.prefix}/studio/albums/"]`)
      .first()
      .getAttribute("href");
    expect(album).toMatch(/\/studio\/albums\/[0-9a-f-]{36}$/);
    await page.goto(`${studioOn}${album}/artwork`);
    await expect(
      page.getByRole("heading", { level: 1, name: w.title }),
    ).toBeVisible();
    await expect(page.getByText(w.panel)).toBeVisible();
    await expect(page.getByText(w.canRemove)).toBeVisible();
    await expect(page.locator(`img[src="${STORED}-500.jpg"]`)).toBeVisible();
    const remove = page.getByRole("button", { name: w.remove });
    await expectTouchTarget(remove);
    await expectNoHorizontalOverflow(page);
    await noAxeViolations(page);

    // Cancel sends nothing.
    await remove.click();
    const dialog = page.getByRole("dialog", { name: w.question });
    await expect(dialog).toBeVisible();
    await noAxeViolations(page);
    await dialog.getByRole("button", { name: w.cancel }).click();
    await expect(dialog).toBeHidden();
    expect(await storedCover()).toBe(STORED);

    await remove.click();
    await dialog.getByRole("button", { name: w.confirm, exact: true }).click();
    await expect(page.getByText(w.done)).toBeVisible();
    await expect(page.getByRole("button", { name: w.remove })).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 1, name: w.title }),
    ).toBeFocused();
    await expect(page.getByRole("img", { name: w.none })).toBeVisible();
    expect(await storedCover()).toBe(null);
    expect(await journalStatus()).toBe("published");

    // The public page is still served, with the fallback frame.
    const reader = await page.context().browser()!.newContext();
    const readerPage = await reader.newPage();
    await syntheticCovers(readerPage);
    const response = await readerPage.goto(
      `${publicOn}${w.prefix}/albums/${slug}`,
    );
    expect(response?.status()).toBe(200);
    await expect(readerPage.getByLabel(w.fallback)).toBeVisible();
    await expect(readerPage.locator('img[src*="archive.org"]')).toHaveCount(0);
    await reader.close();
  });
}
