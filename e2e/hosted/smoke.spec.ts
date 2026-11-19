// Hosted smoke test: the public site and the Studio on a real deployment,
// with the real database. Creates only [Test] records and removes them.
import { expect, test, type Page } from "@playwright/test";

import { testPng } from "../support/png";
import { STUDIO_ROUTES, unique } from "../support/studio";

const EMAIL = process.env.HOSTED_STUDIO_EMAIL ?? "";
const PASSWORD = process.env.HOSTED_STUDIO_PASSWORD ?? "";

async function signIn(page: Page) {
  await page.goto("/studio/entrar");
  await page.getByLabel("e-mail").fill(EMAIL);
  await page.getByLabel("senha", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "entrar" }).click();
  await expect(page).toHaveURL(/\/studio$/);
}

const saveStatus = (page: Page) => page.locator("#mx-form").getByRole("status");

test("public pages render from the hosted database", async ({ page }) => {
  for (const path of ["/", "/mixtapes", "/sobre"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe(
      "pt-BR",
    );
  }
  expect((await page.goto("/mixtapes/nao-existe"))?.status()).toBe(404);
});

test("the Studio and previews refuse anyone without a session", async ({
  request,
}) => {
  for (const path of STUDIO_ROUTES) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    expect(response.headers().location, path).toContain("/studio/entrar");
  }
  expect(
    (await request.get("/fotos/00000000-0000-4000-8000-000000000000")).status(),
  ).toBe(404);
});

test("sign-in, session, a tape with a photo, publication, and privacy", async ({
  page,
  browser,
  request,
}) => {
  test.skip(!EMAIL || !PASSWORD, "HOSTED_STUDIO_EMAIL / _PASSWORD not set");

  // A wrong password is refused.
  await page.goto("/studio/entrar");
  await page.getByLabel("e-mail").fill(EMAIL);
  await page.getByLabel("senha", { exact: true }).fill("[Test] wrong password");
  await page.getByRole("button", { name: "entrar" }).click();
  await expect(page.locator("#entrar-erro")).toHaveText(
    "e-mail ou senha incorretos.",
  );

  await signIn(page);
  // The session survives a reload and a new tab.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("painel");
  const state = await page.context().storageState();
  const second = await browser.newContext({ storageState: state });
  const tab = await second.newPage();
  await tab.goto("/studio/mixtapes");
  await expect(tab).toHaveURL(/\/studio\/mixtapes$/);
  await second.close();

  // A [Test] tape with a track, published.
  const title = `[Test] hosted ${unique()}`;
  await page.goto("/studio/mixtapes/nova");
  await page.getByLabel("título", { exact: true }).fill(title);
  await page.getByRole("button", { name: "criar fita" }).click();
  await expect(page).toHaveURL(/\/studio\/mixtapes\/[0-9a-f-]{36}$/);
  const editor = page.url();
  await page.getByLabel("música").fill(`[Test] canção ${unique()}`);
  await page.getByLabel("artista").fill("[Test] artista");
  await page.getByRole("button", { name: "+ adicionar" }).click();
  await expect(saveStatus(page)).toContainText("entrou na fita");

  // A photo, uploaded with rights confirmed: private until in public use.
  const alt = `[Test] foto hosted ${unique()}`;
  await page.goto("/studio/fotos");
  const upload = page.getByRole("region", { name: "enviar uma foto" });
  await upload.locator('input[type="file"]').setInputFiles({
    name: "hosted-test.png",
    mimeType: "image/png",
    buffer: testPng(32, 0x50),
  });
  await upload.getByLabel("descrição da imagem").fill(alt);
  await upload
    .getByRole("checkbox", { name: "tenho o direito de publicar esta foto" })
    .check();
  await upload.getByLabel("de onde ela vem").fill("[Test] gerada pelo teste");
  await upload.getByRole("button", { name: "enviar foto" }).click();
  await expect(upload.getByRole("status")).toHaveText("foto enviada.");
  // Vercel may append its deployment parameter (?dpl=…) to asset URLs.
  const photo = (await page
    .getByRole("region", { name: "biblioteca" })
    .getByRole("img", { name: alt })
    .getAttribute("src"))!.split("?")[0]!;
  expect(photo).toMatch(/^\/fotos\/[0-9a-f-]{36}$/);
  // The owner sees it; nobody else does (request has no session cookie).
  expect((await page.request.get(photo)).status()).toBe(200);
  expect((await request.get(photo)).status()).toBe(404);

  // As the cover of the tape, then published: public.
  await page.goto(editor);
  await page
    .getByRole("button", { name: "escolher das fotos" })
    .first()
    .click();
  await page.getByRole("button", { name: `usar ${alt}` }).click();
  await expect(saveStatus(page)).toHaveText("foto escolhida.");
  expect((await request.get(photo)).status()).toBe(404);
  await page.getByRole("switch", { name: "rascunho" }).click();
  await expect(saveStatus(page)).toHaveText("a fita está no site");
  await expect.poll(async () => (await request.get(photo)).status()).toBe(200);
  const slug = (await page.getByLabel("endereço").inputValue()).trim();
  expect((await request.get(`/mixtapes/${slug}`)).status()).toBe(200);
  // The cover really loads on the public page (through the image optimizer).
  const visitor = await browser.newContext();
  const pub = await visitor.newPage();
  await pub.goto(`/mixtapes/${slug}`);
  const cover = pub.getByRole("img", { name: alt }).first();
  await expect(cover).toBeVisible();
  await expect
    .poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await visitor.close();

  // Unpublished: the page and the photo are private again at once.
  await page.getByRole("switch", { name: "publicada" }).click();
  await expect(saveStatus(page)).toHaveText("a fita voltou a ser rascunho");
  expect((await request.get(`/mixtapes/${slug}`)).status()).toBe(404);
  expect((await request.get(photo)).status()).toBe(404);

  // Sign out: the Studio closes.
  await page.getByRole("button", { name: "sair" }).click();
  await expect(page).toHaveURL(/\/studio\/entrar$/);
  expect((await page.request.get(photo)).status()).toBe(404);

  // Leave a record for cleanup.
  console.log(`hosted-test-records title="${title}" alt="${alt}"`);
});
