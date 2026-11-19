import { expect, type Page, test } from "@playwright/test";

import { FLOW_TEXT } from "./support/data";
import { BASE_URL, TEST_STUDIO_EMAIL } from "./support/env";
import { testPng } from "./support/png";
import { createTape, signIn, STUDIO_ROUTES, unique } from "./support/studio";

// The Studio, signed in with the [Test] credentials. Sign-in and sign-out run
// at both widths; the longer editing flows at desktop width only. Each test
// creates the records it changes, under a unique [Test] title.

/** The editor's save bar: its status line, error, and "salvar". */
function saveBar(page: Page) {
  const bar = page.locator("#mx-form");
  return {
    status: bar.getByRole("status"),
    save: bar.getByRole("button", { name: "salvar" }),
  };
}

test.describe("sign-in", () => {
  test("a wrong password shows the error", async ({ page }) => {
    await page.goto("/studio/entrar");
    await page.getByLabel("e-mail").fill(TEST_STUDIO_EMAIL);
    await page.getByLabel("senha", { exact: true }).fill("[Test] wrong");
    await page.getByRole("button", { name: "entrar" }).click();
    // Filtered: Next.js's route announcer is also an alert.
    await expect(
      page.getByRole("alert").filter({ hasText: "e-mail ou senha" }),
    ).toHaveText("e-mail ou senha incorretos.");
    await expect(page).toHaveURL(/\/studio\/entrar$/);
    await expect(page.getByLabel("e-mail")).toHaveValue(TEST_STUDIO_EMAIL);
  });

  test("signing in opens the dashboard; signing out closes the Studio", async ({
    page,
  }) => {
    await signIn(page);
    await expect(
      page.getByRole("navigation", { name: "Studio" }).getByRole("link", {
        name: "painel",
      }),
    ).toHaveAttribute("aria-current", "page");

    // A signed-in owner who opens sign-in is sent to the dashboard.
    await page.goto("/studio/entrar");
    await expect(page).toHaveURL(/\/studio$/);

    await page.getByRole("button", { name: "sair" }).click();
    await expect(page).toHaveURL(/\/studio\/entrar$/);
    for (const path of STUDIO_ROUTES) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/studio\/entrar$/);
    }
  });
});

test.describe("editing", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, "the long Studio flows run at desktop width");
    await signIn(page);
  });

  test("a tape: tracks, order, note, preview, publish, unpublish, delete", async ({
    page,
    browser,
    request,
  }) => {
    const title = `[Test] fita ${unique()}`;
    const id = await createTape(page, title);
    const bar = saveBar(page);
    await expect(bar.status).toHaveText("tudo salvo");

    // Three tracks.
    const songs = [1, 2, 3].map((n) => `[Test] faixa ${n} ${unique()}`);
    for (const song of songs) {
      await page.getByLabel("música", { exact: true }).fill(song);
      await page.getByLabel("artista", { exact: true }).fill("[Test] artista");
      await page.getByRole("button", { name: "+ adicionar" }).click();
      await expect(bar.status).toContainText(`${song} entrou na fita`);
      await expect(
        page.getByRole("button", { name: `Subir ${song}` }),
      ).toBeVisible();
    }

    // The first track moves down: the second becomes the first.
    await page.getByRole("button", { name: `Descer ${songs[0]}` }).click();
    await expect(bar.status).toContainText(`${songs[0]} agora é a faixa 02`);
    await expect(
      page.getByRole("button", { name: `Subir ${songs[1]}` }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: `Subir ${songs[0]}` }),
    ).toBeEnabled();

    // A note on the third track, saved with "salvar".
    const note = `[Test] nota ${unique()}`;
    await page.getByRole("button", { name: `+ nota de ${songs[2]}` }).click();
    await page.getByLabel("anotação de margem").fill(note);
    await expect(bar.status).toHaveText("alterações não salvas");
    await bar.save.click();
    await expect(bar.status).toHaveText("salvo agora");

    const slug = await page
      .getByLabel("endereço", { exact: true })
      .inputValue();
    expect(slug).toMatch(/^test-fita-/);

    // The preview opens in a new tab and shows the draft.
    const [preview] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("link", { name: "pré-visualizar ↗" }).first().click(),
    ]);
    await expect(preview).toHaveURL(
      new RegExp(`/studio/previa/mixtapes/${id}$`),
    );
    await expect(
      preview.getByRole("complementary", { name: "Prévia" }),
    ).toBeVisible();
    await expect(preview.getByRole("heading", { level: 1 })).toContainText(
      title,
    );
    await expect(preview.getByText(note)).toBeVisible();
    await preview.close();

    // Not public while a draft.
    expect((await request.get(`/mixtapes/${slug}`)).status()).toBe(404);

    // Publish: the tape is on the site and in the catalogue.
    await page.getByRole("switch", { name: "rascunho" }).click();
    await expect(bar.status).toHaveText("a fita está no site");
    await expect(page.getByRole("switch", { name: "publicada" })).toBeChecked();

    const published = await request.get(`/mixtapes/${slug}`);
    expect(published.status()).toBe(200);
    expect(await published.text()).toContain(note);
    const visitor = await browser.newPage({ baseURL: BASE_URL });
    try {
      await visitor.goto(`/mixtapes/${slug}`);
      await expect(visitor.getByRole("heading", { level: 1 })).toContainText(
        title,
      );
      await visitor.goto("/mixtapes");
      await expect(
        visitor.getByRole("link", { name: `Abrir ${title}` }),
      ).toBeVisible();
    } finally {
      await visitor.close();
    }

    // Unpublish: the public page is gone.
    await page.getByRole("switch", { name: "publicada" }).click();
    await expect(bar.status).toHaveText("a fita voltou a ser rascunho");
    await expect(
      page.getByRole("switch", { name: "rascunho" }),
    ).not.toBeChecked();
    expect((await request.get(`/mixtapes/${slug}`)).status()).toBe(404);

    // Delete, after confirming.
    await page.getByRole("button", { name: "excluir esta fita…" }).click();
    const dialog = page.getByRole("dialog", { name: `excluir ${title}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "excluir fita" }).click();
    await expect(page).toHaveURL(/\/studio\/mixtapes$/);
    await expect(
      page.getByRole("link", { name: `Editar ${title}` }),
    ).toHaveCount(0);
    expect((await request.get(`/mixtapes/${slug}`)).status()).toBe(404);
  });

  test("a site text: publish, then back to draft", async ({
    page,
    browser,
    request,
  }) => {
    const body = `[Test] citacao publicada ${unique()}`;
    await page.goto("/studio/textos");
    const field = page.getByRole("textbox", {
      name: FLOW_TEXT.label,
      exact: true,
    });
    const form = page.locator("form").filter({ has: field });
    await field.fill(body);
    await page
      .getByRole("button", { name: `salvar: ${FLOW_TEXT.label}` })
      .click();
    await expect(form.getByRole("status")).toHaveText("texto salvo.");

    // Saved as a draft: not public yet.
    expect(await (await request.get("/sobre")).text()).not.toContain(body);

    await page
      .getByRole("button", { name: `publicar: ${FLOW_TEXT.label}` })
      .click();
    await expect(form.getByRole("status")).toHaveText("o texto está no site.");
    const visitor = await browser.newPage({ baseURL: BASE_URL });
    try {
      await visitor.goto("/sobre");
      await expect(visitor.getByText(body)).toBeVisible();
    } finally {
      await visitor.close();
    }

    await page
      .getByRole("button", { name: `voltar a rascunho: ${FLOW_TEXT.label}` })
      .click();
    await expect(form.getByRole("status")).toHaveText(
      "o texto voltou a ser rascunho.",
    );
    expect(await (await request.get("/sobre")).text()).not.toContain(body);
  });

  test("a photo: upload, cover of a published tape, rights revoked", async ({
    page,
    request,
  }) => {
    const alt = `[Test] foto ${unique()}`;
    const title = `[Test] capa ${unique()}`;
    await createTape(page, title);
    const editor = page.url();
    await page.getByRole("switch", { name: "rascunho" }).click();
    await expect(saveBar(page).status).toHaveText("a fita está no site");

    // Upload to the library, rights confirmed.
    await page.goto("/studio/fotos");
    const upload = page.getByRole("region", { name: "enviar uma foto" });
    await upload.locator('input[type="file"]').setInputFiles({
      name: "e2e-test.png",
      mimeType: "image/png",
      buffer: testPng(24, 0x60),
    });
    await upload.getByLabel("descrição da imagem").fill(alt);
    await upload
      .getByRole("checkbox", { name: "tenho o direito de publicar esta foto" })
      .check();
    await upload.getByLabel("de onde ela vem").fill("[Test] gerada pelo teste");
    await upload.getByRole("button", { name: "enviar foto" }).click();
    await expect(upload.getByRole("status")).toHaveText("foto enviada.");

    const library = page.getByRole("region", { name: "biblioteca" });
    const thumb = library.getByRole("img", { name: alt });
    await expect(thumb).toBeVisible();
    const src = await thumb.getAttribute("src");
    expect(src).toMatch(/^\/fotos\/[0-9a-f-]{36}$/);
    const photo = src!;

    // Confirmed but in no public use yet: still private.
    expect((await request.get(photo)).status()).toBe(404);

    // The cover of the published tape: public.
    await page.goto(editor);
    await page
      .getByRole("button", { name: "escolher das fotos" })
      .first()
      .click();
    await page.getByRole("button", { name: `usar ${alt}` }).click();
    await expect(saveBar(page).status).toHaveText("foto escolhida.");
    await expect
      .poll(async () => (await request.get(photo)).status())
      .toBe(200);
    const served = await request.get(photo);
    expect(served.headers()["cache-control"]).toContain("public");

    // Rights revoked: private again at once.
    await page.goto("/studio/fotos");
    const row = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("img", { name: alt }) });
    await row.getByRole("button", { name: `editar: ${alt}` }).click();
    await row
      .getByRole("checkbox", { name: "tenho o direito de publicar esta foto" })
      .uncheck();
    await row.getByRole("button", { name: "salvar" }).click();
    await expect(row.getByRole("status").last()).toHaveText("foto salva.");
    expect((await request.get(photo)).status()).toBe(404);
  });

  test("a song: create, edit, delete", async ({ page }) => {
    const title = `[Test] canção ${unique()}`;
    const renamed = `${title} (editada)`;
    await page.goto("/studio/musicas");
    const status = page
      .getByRole("region", { name: "Catálogo" })
      .getByRole("status");

    await page.getByRole("button", { name: "+ adicionar música" }).click();
    const drawer = page.getByRole("dialog", { name: "nova música" });
    await drawer.getByLabel("música", { exact: true }).fill(title);
    await drawer.getByLabel("artista", { exact: true }).fill("[Test] artista");
    await drawer.getByRole("button", { name: "salvar" }).click();
    await expect(status).toHaveText(`${title} entrou no catálogo.`);
    await expect(drawer).toBeHidden();

    await page
      .getByRole("button", { name: `Editar ${title}` })
      .first()
      .click();
    const edit = page.getByRole("dialog", { name: "editar música" });
    await expect(edit.getByLabel("música", { exact: true })).toHaveValue(title);
    await edit.getByLabel("música", { exact: true }).fill(renamed);
    await edit.getByRole("button", { name: "salvar" }).click();
    await expect(status).toHaveText(`${renamed} foi atualizada.`);
    await expect(
      page.getByRole("button", { name: `Editar ${renamed}` }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: `Excluir ${renamed}` }).click();
    const confirm = page.getByRole("dialog", { name: `excluir ${renamed}?` });
    await confirm.getByRole("button", { name: "excluir", exact: true }).click();
    await expect(status).toHaveText("a música saiu do catálogo e das fitas.");
    await expect(
      page.getByRole("button", { name: `Excluir ${renamed}` }),
    ).toHaveCount(0);
  });
});
