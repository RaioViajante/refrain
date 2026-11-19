import { expect, type Page, test } from "@playwright/test";

import {
  DRAFT_TAPE,
  DRAFT_TEXT,
  LONG_TAPE,
  PUBLISHED_TEXTS,
  SHORT_TAPE,
} from "./support/data";

// The public site, signed out, at both widths (desktop 1440, mobile 390).

const PUBLIC_PAGES = [
  "/",
  "/mixtapes",
  `/mixtapes/${LONG_TAPE.slug}`,
  `/mixtapes/${SHORT_TAPE.slug}`,
  "/sobre",
] as const;

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBe(innerWidth);
}

test.describe("public pages", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} renders in pt-BR without horizontal scroll`, async ({
      page,
    }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  }

  test("home shows the seeded texts and the featured tapes", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("refrain · músicas que voltam");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "músicas que voltam",
    );
    await expect(page.getByText(PUBLISHED_TEXTS["home.lede"])).toBeVisible();
    const start = page.getByRole("navigation", { name: "Comece por" });
    await expect(
      start.getByRole("link", { name: LONG_TAPE.title }),
    ).toBeVisible();
    await expect(
      start.getByRole("link", { name: SHORT_TAPE.title }),
    ).toBeVisible();
  });

  test("home lays out two tapes without changing the mobile composition", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/");

    const featured = page
      .getByRole("heading", { name: "02 mixtapes" })
      .locator("xpath=ancestor::section");
    const cards = featured.getByRole("link");
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    const archive = page
      .getByRole("heading", { name: "o arquivo" })
      .locator("xpath=ancestor::section");
    const archiveBox = await archive.boundingBox();

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(archiveBox).not.toBeNull();

    if (isMobile) {
      expect(first!.x).toBeCloseTo(20, 0);
      expect(second!.x).toBeCloseTo(110, 0);
      expect(archiveBox!.height).toBeCloseTo(550, 0);
    } else {
      expect(first!.x).toBeCloseTo(362.5, 0);
      expect(second!.x).toBeCloseTo(777.5, 0);
      expect(archiveBox!.height).toBeCloseTo(650, 0);
    }
  });

  test("catalogue filters by feeling and switches to the index", async ({
    page,
  }) => {
    await page.goto("/mixtapes");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "mixtapes",
    );
    await expect(page.getByText(PUBLISHED_TEXTS["catalog.lede"])).toBeVisible();

    const feelings = page.getByRole("group", {
      name: "Filtrar por sentimento",
    });
    const filter = feelings.getByRole("button", { name: LONG_TAPE.feeling });
    await filter.click();
    await expect(filter).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByText(`1 fita sobre ${LONG_TAPE.feeling}`),
    ).toBeVisible();
    await feelings.getByRole("button", { name: "todas" }).click();
    await expect(filter).toHaveAttribute("aria-pressed", "false");

    const views = page.getByRole("group", { name: "Modo de visualização" });
    const sky = page.getByRole("region", { name: "constelação" });
    const index = page.getByRole("region", { name: "índice" });
    await expect(sky).toBeVisible();
    await views.getByRole("button", { name: "índice" }).click();
    await expect(views.getByRole("button", { name: "índice" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(index).toBeVisible();
    await expect(sky).toHaveCount(0);
    await expect(
      index.getByRole("link", { name: `Abrir ${LONG_TAPE.title}` }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);

    await index
      .getByRole("link", { name: `Abrir ${SHORT_TAPE.title}` })
      .click();
    await expect(page).toHaveURL(`/mixtapes/${SHORT_TAPE.slug}`);
  });

  test("a published tape shows its sides and the full tape", async ({
    page,
    isMobile,
  }) => {
    await page.goto(`/mixtapes/${LONG_TAPE.slug}`);
    await expect(page).toHaveTitle(`${LONG_TAPE.title} · refrain`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      LONG_TAPE.title,
    );

    const sideA = page.getByRole("region", { name: "lado A" });
    const sideB = page.getByRole("region", { name: "lado B" });
    await expect(sideA.getByRole("listitem")).toHaveCount(10);
    await expect(sideB.getByRole("listitem")).toHaveCount(10);
    await expect(sideA.getByText(LONG_TAPE.notes[3]!)).toBeVisible();
    await expect(sideB.getByText(LONG_TAPE.notes[14]!)).toBeVisible();

    // "a fita inteira": tracks 21 onwards, the first 30 (12 on a phone)
    // until the list is opened.
    const full = page.getByRole("region", { name: "a fita inteira" });
    const rows = full.getByRole("list").getByRole("listitem");
    const rest = LONG_TAPE.trackCount - 20;
    const collapsed = isMobile ? 12 : 30;
    await expect(rows).toHaveCount(collapsed);

    const expand = full.getByRole("button", {
      name: `ver as ${LONG_TAPE.trackCount} faixas`,
    });
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expand.click();
    const collapse = full.getByRole("button", { name: "recolher" });
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await expect(rows).toHaveCount(rest);
    await collapse.click();
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expect(rows).toHaveCount(collapsed);

    // "só as que têm anotação" keeps only the annotated tracks after 20.
    await full.getByRole("button", { name: "só as que têm anotação" }).click();
    const all = full.getByRole("button", { name: "mostrar todas" });
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toHaveCount(2);
    await expect(full.getByText(LONG_TAPE.notes[45]!)).toBeVisible();
    await all.click();
    await expect(rows).toHaveCount(collapsed);
    await expectNoHorizontalScroll(page);
  });

  test("sobre shows the seeded letter", async ({ page }) => {
    await page.goto("/sobre");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "um lugar para ficar",
    );
    await expect(page.getByText(PUBLISHED_TEXTS["about.lede"])).toBeVisible();
    await expect(
      page.getByText("[Test] carta do sobre, primeiro parágrafo."),
    ).toBeVisible();
    await expect(
      page.getByText("[Test] carta do sobre, último parágrafo."),
    ).toBeVisible();
  });

  test("header and footer navigate between the sections", async ({ page }) => {
    await page.goto("/");
    const header = page.getByRole("navigation", { name: "Principal" });
    await header.getByRole("link", { name: "mixtapes" }).click();
    await expect(page).toHaveURL("/mixtapes");
    await expect(
      header.getByRole("link", { name: "mixtapes" }),
    ).toHaveAttribute("aria-current", "page");

    await header.getByRole("link", { name: "sobre" }).click();
    await expect(page).toHaveURL("/sobre");
    await expect(header.getByRole("link", { name: "sobre" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await page.getByRole("link", { name: "Início" }).click();
    await expect(page).toHaveURL("/");

    const footer = page.getByRole("navigation", { name: "Rodapé" });
    await footer.getByRole("link", { name: "sobre" }).click();
    await expect(page).toHaveURL("/sobre");
    await footer.getByRole("link", { name: "mixtapes" }).click();
    await expect(page).toHaveURL("/mixtapes");
  });

  test("an unknown slug shows the 404 page", async ({ page }) => {
    const response = await page.goto("/mixtapes/nao-existe-e2e");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "essa música se perdeu",
    );
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expectNoHorizontalScroll(page);
    await page.getByRole("link", { name: "ver todas as fitas" }).click();
    await expect(page).toHaveURL("/mixtapes");
  });

  test("the draft tape's slug is a 404", async ({ page }) => {
    const response = await page.goto(`/mixtapes/${DRAFT_TAPE.slug}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "essa música se perdeu",
    );
    await expect(page.getByText(DRAFT_TAPE.title)).toHaveCount(0);
  });

  test("keyboard: the skip link comes first and focus is visible", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "keyboard navigation is checked at desktop width");
    await page.goto("/mixtapes");

    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "pular para o conteúdo" });
    await expect(skip).toBeFocused();
    const box = await skip.boundingBox();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    await expectVisibleFocus(page);

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Início" })).toBeFocused();
    await expectVisibleFocus(page);
    await page.keyboard.press("Tab");
    await expect(
      page
        .getByRole("navigation", { name: "Principal" })
        .getByRole("link", { name: "mixtapes" }),
    ).toBeFocused();
    await expectVisibleFocus(page);

    // The skip link moves the focus starting point into <main>.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#conteudo$/);
    await page.keyboard.press("Tab");
    const inMain = await page.evaluate(
      () => document.activeElement?.closest("main")?.id ?? null,
    );
    expect(inMain).toBe("conteudo");
    await expectVisibleFocus(page);
  });
});

/** The focused element draws an outline (the site's dashed focus ring). */
async function expectVisibleFocus(page: Page) {
  const outline = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(outline).not.toBeNull();
  expect(outline!.style).not.toBe("none");
  expect(outline!.width).not.toBe("0px");
}

test.describe("privacy of drafts", () => {
  test("no public page reveals the draft tape or the draft text", async ({
    request,
  }) => {
    for (const path of PUBLIC_PAGES) {
      const html = await (await request.get(path)).text();
      // The page holds seeded content: the check below reads real markup.
      expect(html, path).toContain("[Test]");
      expect(html, path).not.toContain(DRAFT_TAPE.title);
      expect(html, path).not.toContain(DRAFT_TAPE.slug);
      expect(html, path).not.toContain(DRAFT_TAPE.description);
      expect(html, path).not.toContain(DRAFT_TEXT.marker);
    }
    // The 404 pages, including the draft's own URL (whose slug the router
    // state repeats, since it was requested): nothing of the draft's content.
    for (const path of [
      "/mixtapes/nao-existe-e2e",
      `/mixtapes/${DRAFT_TAPE.slug}`,
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
      const html = await response.text();
      expect(html, path).toContain("essa música");
      expect(html, path).not.toContain(DRAFT_TAPE.title);
      expect(html, path).not.toContain(DRAFT_TAPE.description);
      expect(html, path).not.toContain(DRAFT_TEXT.marker);
    }
  });
});
