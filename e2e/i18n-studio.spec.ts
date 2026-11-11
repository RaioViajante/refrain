import { mkdirSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  env,
  expectNoHorizontalOverflow,
  expectTouchTarget,
  named,
  withDatabase,
} from "./support";
import { FIXTURE } from "@/testing/provider-fixtures";
import { PHOTO } from "@/testing/wikimedia-fixtures";

// The Writing Studio in Brazilian Portuguese (ADR 0008; ADR 0006 A7), signed
// in as the synthetic author, against the disposable test database: the
// language selector, sign-in and sign-out in Portuguese, the catalog, an
// album journal written in Portuguese, rated, reviewed, published, changed,
// deleted, and restored, a memory written originally in Portuguese and
// published, a change in one language seen in the other without a restart,
// the unsaved-changes guard on the selector, the shared not-found view, and
// every Portuguese Studio page at 320, 360, 390, 768, and 1440 px with no
// sideways scroll and no axe violation. Screenshots only with
// E2E_SCREENSHOTS=1, to visual-review/i18n-studio/ (ignored by Git).

test.describe.configure({ mode: "serial" });

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const WIDTHS = [320, 360, 390, 768, 1440];
const SHOTS = "visual-review/i18n-studio";
const PORTUGUESE = "português (Brasil)";

const names = {
  artist: "",
  album: "",
  track: "",
  memory: "",
};
let albumPath = "";
let journalPath = "";
let memoryPath = "";
let trackPath = "";
let artistPath = "";

function literal(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

async function shot(page: Page, name: string) {
  if (process.env.E2E_SCREENSHOTS !== "1") {
    return;
  }
  mkdirSync(SHOTS, { recursive: true });
  const width = page.viewportSize()?.width ?? 0;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `${SHOTS}/${name}-${width}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

async function scan(page: Page, what: string) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    result.violations.map((violation) => ({
      rule: violation.id,
      targets: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
    })),
    `axe violations on ${what}`,
  ).toEqual([]);
}

/** The Studio page has finished reading: its own heading is on screen. */
async function settled(page: Page) {
  // While a page streams, its loading placeholder and the page itself can
  // both be in the document for a moment: the placeholder goes first.
  await expect(page.getByText("Carregando…")).toHaveCount(0);
  await expect(page.getByRole("main")).toBeVisible();
}

// The visible footer's: after a refresh the framework may keep the previous
// view of a route hidden, out of the accessibility tree, with its own copy.
const footer = (page: Page) => page.getByRole("contentinfo");
const selector = (page: Page) =>
  footer(page).locator("summary.studio-language-button");
const option = (page: Page, name: string) =>
  footer(page).locator(".studio-language-option", { hasText: name });

async function versionsOf(title: string, kind: "album" | "memory") {
  return withDatabase(async (client) => {
    const result = await client.query<{
      locale: string;
      status: string;
      is_original: boolean;
    }>(
      kind === "album"
        ? `select t.locale, t.status, t.is_original
             from entry_texts t
             join album_journals j on j.entry_id = t.entry_id
             join albums a on a.id = j.album_id
            where a.title = $1
            order by t.locale`
        : `select t.locale, t.status, t.is_original
             from entry_texts t
            where t.title = $1
            order by t.locale`,
      [title],
    );
    return result.rows;
  });
}

test("the Portuguese Studio speaks Portuguese, and the selector keeps the page", async ({
  page,
}) => {
  names.artist = named("Artista PT");
  names.album = named("Álbum PT");
  names.track = named("Faixa PT");
  names.memory = named("Memória de verão");

  await page.goto("/pt/studio");
  await settled(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mesa");
  const nav = page.getByRole("navigation", { name: "Estúdio de escrita" });
  await expect(nav.getByRole("link", { name: "Mesa" })).toHaveAttribute(
    "href",
    "/pt/studio",
  );
  await expect(nav.getByRole("link", { name: "Catálogo" })).toHaveAttribute(
    "href",
    "/pt/studio/catalog",
  );
  await expect(page.getByRole("button", { name: "Sair" })).toBeVisible();
  await expect(selector(page)).toHaveText(/Idioma: Português/);

  await selector(page).click();
  await expect(option(page, "Português (Brasil)")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByText(
      "Muda só a interface. O que foi escrito fica no idioma original.",
    ),
  ).toBeVisible();
  await option(page, "English").click();
  await page.waitForURL(/\/studio$/);
  expect(new URL(page.url()).pathname).toBe("/studio");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Desk");

  // By keyboard: the arrows open the menu and move, Escape closes it.
  await selector(page).focus();
  await page.keyboard.press("ArrowUp");
  await expect(footer(page).locator("details.studio-language")).toHaveAttribute(
    "open",
    "",
  );
  await expect(
    footer(page).locator(".studio-language-option").last(),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(selector(page)).toBeFocused();
  await expectTouchTarget(selector(page));
});

test("adds an artist, an album, and a track in Portuguese, and the English Studio has them at once", async ({
  page,
}) => {
  await page.goto("/pt/studio/artists/new");
  await page.getByLabel("Nome", { exact: true }).fill(names.artist);
  await page.getByRole("button", { name: "Adicionar artista" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: names.artist }),
  ).toBeVisible();
  await page.waitForURL(/\/pt\/studio\/artists\/[0-9a-f-]{36}$/);
  artistPath = new URL(page.url()).pathname;

  await page.goto("/pt/studio/albums/new");
  await page.getByLabel("Título", { exact: true }).fill(names.album);
  await page
    .getByLabel("Artistas creditados: artista 1", { exact: true })
    .selectOption({ label: names.artist });
  await page.getByRole("button", { name: "Adicionar álbum" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: names.album }),
  ).toBeVisible();
  await page.waitForURL(/\/pt\/studio\/albums\/[0-9a-f-]{36}$/);
  albumPath = new URL(page.url()).pathname;

  await page.locator("#new-track-title").fill(names.track);
  await page.getByRole("button", { name: "Criar e adicionar" }).click();
  await expect(
    page.getByText("Faixa criada e adicionada ao fim da lista de faixas."),
  ).toBeVisible();
  // The list refreshed in this language, with the new track's link in it.
  const trackLink = page.getByRole("link", { name: names.track });
  await expect(trackLink).toBeVisible();
  trackPath = (await trackLink.getAttribute("href"))!;
  expect(trackPath).toMatch(/^\/pt\/studio\/tracks\/[0-9a-f-]{36}$/);
  await expect(
    page.getByText("1 faixa", { exact: false }).first(),
  ).toBeVisible();

  // The same album in English, by the selector: the track is there, with no
  // restart and no reload of anything but the page.
  await selector(page).click();
  await option(page, "English").click();
  await page.waitForURL((url) => url.pathname === albumPath.slice(3));
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("link", { name: names.track })).toBeVisible();
  await expect(page.getByText("Tracklist", { exact: true })).toBeVisible();

  // And the English lists have the new records.
  await page.goto("/studio/artists");
  await expect(page.getByRole("link", { name: names.artist })).toBeVisible();
});

test("writes an album journal in Portuguese, rates it, and publishes it only after the review", async ({
  page,
}) => {
  await page.goto(albumPath);
  await page
    .getByRole("link", { name: "Escrever um diário sobre este álbum" })
    .click();
  await expect(page.locator("form[data-editor-ready]")).toBeAttached();
  // A new journal starts in the page's language.
  await expect(page.getByLabel("Escrito em")).toHaveValue("pt-BR");
  await page
    .getByLabel("Frase de abertura (opcional)")
    .fill(named("Uma frase de abertura."));
  await page
    .getByLabel("Sua reflexão", { exact: true })
    .fill(named("Uma reflexão escrita em português."));
  await expect(page.getByText(/^\d+ palavras$/)).toBeVisible();
  await page.getByRole("button", { name: "Salvar como rascunho" }).click();
  await page.waitForURL(/\/pt\/studio\/journals\/[0-9a-f-]{36}$/);
  journalPath = new URL(page.url()).pathname;
  await expect(page.locator("article")).toHaveAttribute("lang", "pt-BR");
  await expect(page.getByText(/escrito em português \(Brasil\)/)).toBeVisible();

  await expect(
    page.getByRole("link", { name: "Editar este diário" }),
  ).toHaveAttribute("href", `${journalPath}/edit`);
  // A full load, as the English editor tests do: a client navigation keeps the
  // previous view hidden, with copies of its words.
  await page.goto(`${journalPath}/edit`);
  await expect(page.locator("form[data-editor-ready]")).toBeAttached();
  await page
    .getByRole("group", { name: /Sua nota para o álbum/ })
    .locator("label")
    .filter({ hasText: "4,5 estrelas" })
    .click();
  await expect(
    page
      .getByRole("group", { name: /Sua nota para o álbum/ })
      .getByText("4,5 estrelas", { exact: true })
      .last(),
  ).toBeVisible();
  await page.getByRole("button", { name: literal(names.track) }).click();
  await page
    .getByLabel(literal(`Sua reflexão sobre ${names.track}, em ${PORTUGUESE}`))
    .fill(named("Sobre esta faixa."));
  await page.getByLabel("Incluir ao publicar").check();
  await expect(page.getByText(/Isso sozinho não publica nada/)).toBeVisible();
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(
    page.getByText("Salvo agora").filter({ visible: true }),
  ).toBeVisible();

  await page.goto(journalPath);
  const panel = page.getByRole("region", {
    name: `Visibilidade · ${PORTUGUESE} (original)`,
  });
  await panel.getByRole("button", { name: "Publicar…", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: `Publicar a versão em ${PORTUGUESE}?`,
  });
  await expect(dialog).toContainText(named("Uma frase de abertura."));
  await expect(dialog).toContainText(
    `Reflexões de faixa que serão publicadas em ${PORTUGUESE} (1)`,
  );
  await expect(dialog).toContainText("4,5 estrelas");
  await expectNoHorizontalOverflow(page);
  // Cancel publishes nothing.
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();
  expect(await versionsOf(names.album, "album")).toEqual([
    { locale: "pt-BR", status: "draft", is_original: true },
  ]);

  await panel.getByRole("button", { name: "Publicar…", exact: true }).click();
  await dialog
    .getByRole("button", { name: `Publicar a versão em ${PORTUGUESE}` })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("status").filter({
      hasText: `A versão em ${PORTUGUESE} agora está publicada no seu diário.`,
    }),
  ).toBeVisible();
  await expect(panel).toContainText("Publicado");
  // Only the Portuguese version exists, and only it is published: nothing was
  // made in English, and nothing was translated.
  expect(await versionsOf(names.album, "album")).toEqual([
    { locale: "pt-BR", status: "published", is_original: true },
  ]);
});

test("asks before a change to the published writing, and saves only on confirmation", async ({
  page,
}) => {
  await page.goto(`${journalPath}/edit`);
  await expect(page.locator("form[data-editor-ready]")).toBeAttached();
  await expect(
    page.getByText(
      /Esta versão está publicada\. Salvar muda o texto publicado\./,
    ),
  ).toBeVisible();
  const field = page.getByLabel("Sua reflexão", { exact: true });
  const shorter = named("Mais curta.");
  await field.fill(shorter);
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Atualizar o texto publicado?",
  });
  await expect(dialog).toContainText("Alterado: Sua reflexão");
  await expect(dialog).toContainText("Publicado agora");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(field).toHaveValue(shorter);
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Salvar e atualizar o texto publicado" })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText("Salvo agora").filter({ visible: true }),
  ).toBeVisible();
});

test("moves the journal to Recently deleted and restores it as private, in Portuguese", async ({
  page,
}) => {
  await page.goto(journalPath);
  await page
    .getByRole("button", { name: "Mover para Excluídos recentemente…" })
    .click();
  const remove = page.getByRole("dialog", {
    name: "Mover este diário para Excluídos recentemente?",
  });
  await remove
    .getByRole("button", { name: "Mover para Excluídos recentemente" })
    .click();
  await page.waitForURL((url) => url.pathname === "/pt/studio/journals");

  await page.goto("/pt/studio/journals/deleted");
  await expect(
    page.getByRole("heading", { level: 1, name: "Excluídos recentemente" }),
  ).toBeVisible();
  const list = page.getByRole("list", {
    name: "Diários excluídos recentemente",
  });
  await expect(list).toContainText(names.album);
  await expect(list).toContainText(
    `${PORTUGUESE}: publicada, volta como privada`,
  );
  await list
    .getByRole("button", { name: `Restaurar o diário sobre ${names.album}` })
    .click();
  const restore = page.getByRole("dialog", { name: "Restaurar este diário?" });
  await restore.getByRole("button", { name: "Restaurar diário" }).click();
  await page.waitForURL(
    /\/pt\/studio\/journals\/[0-9a-f-]{36}\?restored=private$/,
  );
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Restaurado de Excluídos recentemente." }),
  ).toBeVisible();
  expect(await versionsOf(names.album, "album")).toEqual([
    { locale: "pt-BR", status: "private", is_original: true },
  ]);
});

test("writes a memory originally in Portuguese and publishes it after the review", async ({
  page,
}) => {
  await page.goto("/pt/studio/memories/new");
  await expect(page.getByLabel("Escrito em")).toHaveValue("pt-BR");
  await page.getByLabel("Título", { exact: true }).fill(names.memory);
  await page
    .getByLabel("Quando", { exact: true })
    .fill(named("Num agosto qualquer"));
  await page
    .getByLabel("A memória", { exact: true })
    .fill(named("O que eu lembro daquela tarde."));
  await page.getByRole("button", { name: "Salvar como rascunho" }).click();
  await page.waitForURL(/\/pt\/studio\/memories\/[0-9a-f-]{36}$/);
  memoryPath = new URL(page.url()).pathname;
  // The fields carry the memory's own language, and it is fixed now.
  await expect(page.getByLabel("A memória", { exact: true })).toHaveAttribute(
    "lang",
    "pt-BR",
  );
  await expect(
    page.getByText(
      "O idioma em que ela foi escrita. Nada é traduzido para você.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Escrito em" })).toHaveCount(
    0,
  );

  await page.getByRole("button", { name: "Publicar…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Publicar esta memória?" });
  await expect(dialog).toContainText(`desta memória, em ${PORTUGUESE}`);
  await expect(dialog).toContainText(names.memory);
  await dialog.getByRole("button", { name: "Publicar esta memória" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(/Esta memória agora está publicada\./),
  ).toBeVisible();
  expect(await versionsOf(names.memory, "memory")).toEqual([
    { locale: "pt-BR", status: "published", is_original: true },
  ]);

  // The English Studio shows the same memory, in its own language.
  await page.goto(memoryPath.slice(3));
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByLabel("The memory", { exact: true })).toHaveAttribute(
    "lang",
    "pt-BR",
  );
  await expect(page.getByText("Português (Brasil)").first()).toBeVisible();
});

test("asks before the language selector leaves unsaved changes", async ({
  page,
}) => {
  await page.goto(memoryPath);
  await expect(page.getByLabel("A memória", { exact: true })).toBeVisible();
  await page
    .getByLabel("A memória", { exact: true })
    .fill(named("Sem salvar."));
  await expect(page.getByText("Alterações não salvas")).toBeVisible();
  const asked: string[] = [];
  page.once("dialog", async (dialog) => {
    asked.push(dialog.message());
    await dialog.dismiss();
  });
  await selector(page).click();
  await option(page, "English").click();
  await expect
    .poll(() => asked)
    .toEqual(["Há alterações não salvas. Sair sem salvar?"]);
  expect(new URL(page.url()).pathname).toBe(memoryPath);
  await expect(page.getByLabel("A memória", { exact: true })).toHaveValue(
    named("Sem salvar."),
  );
});

test("answers a Portuguese Studio record that does not exist with the shared view in Portuguese", async ({
  page,
}) => {
  await page.goto("/pt/studio/artists/00000000-0000-4000-8000-000000000000");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await expect(
    page.getByRole("heading", { level: 1, name: "Nada aqui" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Voltar ao início" }),
  ).toHaveAttribute("href", "/pt");
});

test("signs in and out in Portuguese, staying in Portuguese, with no callback parameter", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await page.goto("/pt/studio/journals");
  await page.waitForURL((url) => url.pathname === "/pt/studio/sign-in");
  expect(new URL(page.url()).search).toBe("");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await page.getByLabel("E-mail").fill(env("E2E_AUTHOR_EMAIL"));
  await page.getByLabel("Senha").fill("not the password");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator("#sign-in-message")).toHaveText(
    "Esse e-mail e essa senha não conferem.",
  );
  await page.getByLabel("Senha").fill(env("E2E_AUTHOR_PASSWORD"));
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((url) => url.pathname === "/pt/studio");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mesa");
  await page.getByRole("button", { name: "Sair" }).click();
  await page.waitForURL((url) => url.pathname === "/pt/studio/sign-in");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entrar");
  await context.close();
});

test("every Portuguese Studio page fits 320 to 1440 px, its selector too, with no axe violation", async ({
  page,
}) => {
  test.setTimeout(600_000);
  // Each page with the heading it must show and, for a page whose data comes
  // from a provider, a fact of the synthetic fixture: a page that only
  // rendered its error panel, also a 200, would not pass.
  const pages: {
    name: string;
    path: string;
    heading: string;
    fact?: string;
  }[] = [
    { name: "desk", path: "/pt/studio", heading: "Mesa" },
    { name: "catalog", path: "/pt/studio/catalog", heading: "Catálogo" },
    {
      name: "add-music",
      path: "/pt/studio/catalog/add",
      heading: "Adicionar música",
    },
    { name: "artists", path: "/pt/studio/artists", heading: "Artistas" },
    { name: "artist", path: artistPath, heading: names.artist },
    {
      name: "artist-new",
      path: "/pt/studio/artists/new",
      heading: "Adicionar um artista",
    },
    { name: "artist-photo", path: `${artistPath}/photo`, heading: "Foto" },
    {
      name: "photo-review",
      path: `${artistPath}/photo/review?file=${PHOTO.onStage}`,
      heading: "Revisar foto",
      fact: "[Test] Photographer One",
    },
    {
      name: "add-edition",
      path: `/pt/studio/catalog/add/album/${FIXTURE.paperMoon}`,
      heading: "[Test] Paper Moon",
      fact: "Escolha uma edição",
    },
    {
      name: "add-release",
      path: `/pt/studio/catalog/add/release/${FIXTURE.firstPressing}`,
      heading: "[Test] Paper Moon",
      fact: "Esta edição",
    },
    {
      name: "add-artist",
      path: `/pt/studio/catalog/add/artist/${FIXTURE.inkQuartet}`,
      heading: "[Test] Ink Quartet",
      fact: "Ordenado como",
    },
    { name: "albums", path: "/pt/studio/albums", heading: "Álbuns" },
    { name: "album", path: albumPath, heading: names.album },
    {
      name: "album-new",
      path: "/pt/studio/albums/new",
      heading: "Adicionar um álbum",
    },
    { name: "album-artwork", path: `${albumPath}/artwork`, heading: "Capa" },
    { name: "tracks", path: "/pt/studio/tracks", heading: "Faixas" },
    { name: "track", path: trackPath, heading: names.track },
    {
      name: "track-new",
      path: "/pt/studio/tracks/new",
      heading: "Adicionar uma faixa",
    },
    { name: "journals", path: "/pt/studio/journals", heading: "Diários" },
    { name: "journal", path: journalPath, heading: names.album },
    {
      name: "journal-edit",
      path: `${journalPath}/edit`,
      heading: names.album,
    },
    {
      name: "journal-new",
      path: "/pt/studio/journals/new",
      heading: "Escrever um diário",
    },
    {
      name: "deleted",
      path: "/pt/studio/journals/deleted",
      heading: "Excluídos recentemente",
    },
    { name: "memories", path: "/pt/studio/memories", heading: "Memórias" },
    { name: "memory", path: memoryPath, heading: "Editar uma memória" },
    {
      name: "memory-new",
      path: "/pt/studio/memories/new",
      heading: "Escrever uma memória",
    },
  ];
  expect(pages).toHaveLength(26);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const { name, path, heading, fact } of pages) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await settled(page);
      await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
      // The page itself, not a panel saying a provider could not be reached.
      await expect(
        page.getByRole("heading", { level: 1, name: literal(heading) }),
        path,
      ).toBeVisible();
      if (fact) {
        await expect(
          page.getByRole("main").getByText(fact, { exact: false }).first(),
          path,
        ).toBeVisible();
      }
      await expect(page.getByText(/Não deu para acessar/), path).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      // No button's words are cut off.
      const cut = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll<HTMLElement>(
            ".studio-button, .studio-button-quiet",
          ),
        )
          .filter((button) => button.offsetParent !== null)
          .filter((button) => button.scrollWidth > button.clientWidth + 1)
          .map((button) => button.textContent?.trim() ?? ""),
      );
      expect(cut, `${path} at ${width}`).toEqual([]);
      if (width === 320 || width === 1440) {
        await scan(page, `${path} at ${width}`);
      }
      await shot(page, name);
      // The selector, opened, stays on the screen.
      await selector(page).click();
      const menu = await footer(page)
        .locator(".studio-language-menu")
        .boundingBox();
      expect(menu!.x, `${path} at ${width}`).toBeGreaterThanOrEqual(0);
      expect(menu!.x + menu!.width, `${path} at ${width}`).toBeLessThanOrEqual(
        width,
      );
      await expectNoHorizontalOverflow(page);
      await selector(page).click();
    }
  }
});
