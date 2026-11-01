import { expect, test, type Page } from "@playwright/test";

import { createAlbumThroughStudio, named } from "./support";

// The Studio's navigation: exactly two destinations in the header, Desk and
// Catalog (the owner's decision, matching the approved V4.4 design), with the
// Catalog's own sections one click further. Everything that used to be in the
// header (Artists, Albums, Tracks, Journals) must stay reachable by normal
// interactions, and moving around must be a client-side navigation: the
// browser never loads a new document (issue #23).
//
// What these tests deliberately do not claim: the Studio header is rendered
// by each authorized page, not by a shared layout (an anonymous response must
// never contain the studio's furniture, see
// src/modules/identity/studio.http.test.ts), so each page brings its own
// header and keyboard focus is no longer on the link that was activated. That
// is documented in docs/design/studio-visual-fidelity.md as a follow-up that
// needs a decision about the authorization boundary.
//
// Sign-out is a full navigation on purpose, so that nothing rendered under
// the old session can be shown again; authentication.spec.ts covers it.

test.describe.configure({ mode: "serial" });

const primary = (page: Page) =>
  page.getByRole("navigation", { name: "Writing studio" });
const catalogNav = (page: Page) =>
  page.getByRole("navigation", { name: "Catalog sections" });
const heading = (page: Page, name: string) =>
  page.getByRole("heading", { level: 1, name, exact: true });

const ARTIST = named("Nav Artist");
const ALBUM = named("Nav Album");
let albumId = "";
let journalUrl = "";

test("set up: an album and a journal", async ({ page }) => {
  const created = await createAlbumThroughStudio(page, {
    artist: ARTIST,
    album: ALBUM,
  });
  albumId = created.albumUrl.split("/").pop()!;
  await page.goto(`/studio/journals/new?album=${albumId}`);
  await page.getByLabel("Your reflection").fill("[Test] A navigation test.");
  await page.getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/studio\/journals\/[0-9a-f-]{36}$/);
  journalUrl = page.url();
});

test("the header has exactly two destinations, Desk and Catalog, on every page", async ({
  page,
}) => {
  for (const path of [
    "/studio",
    "/studio/catalog",
    "/studio/artists",
    "/studio/albums",
    "/studio/tracks",
    "/studio/journals",
    journalUrl,
    `${journalUrl}/edit`,
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    const links = primary(page).getByRole("link");
    await expect(links, path).toHaveText(["Desk", "Catalog"]);
    // Sign out stays available, as a control of its own.
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  }
});

test("Desk is current on the Desk and in the writing workflows, Catalog on the music library", async ({
  page,
}) => {
  const deskPaths = [
    "/studio",
    "/studio/journals",
    "/studio/journals/new",
    "/studio/journals/deleted",
    journalUrl,
    `${journalUrl}/edit`,
  ];
  const catalogPaths = [
    "/studio/catalog",
    "/studio/artists",
    "/studio/artists/new",
    "/studio/albums",
    "/studio/albums/new",
    `/studio/albums/${albumId}`,
    "/studio/tracks",
    "/studio/tracks/new",
  ];
  for (const [paths, current, other] of [
    [deskPaths, "Desk", "Catalog"],
    [catalogPaths, "Catalog", "Desk"],
  ] as const) {
    for (const path of paths) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { level: 1 }).first(),
      ).toBeVisible();
      await expect(
        primary(page).getByRole("link", { name: current, exact: true }),
        path,
      ).toHaveAttribute("aria-current", "page");
      await expect(
        primary(page).getByRole("link", { name: other, exact: true }),
        path,
      ).not.toHaveAttribute("aria-current", "page");
    }
  }
});

test("the Catalog's sections are always-visible links, and the current one is marked", async ({
  page,
}) => {
  await page.goto("/studio");
  await expect(catalogNav(page)).toHaveCount(0);
  for (const [path, current] of [
    ["/studio/catalog", "Overview"],
    ["/studio/artists", "Artists"],
    ["/studio/albums", "Albums"],
    ["/studio/tracks", "Tracks"],
    ["/studio/albums/new", "Albums"],
    [`/studio/albums/${albumId}`, "Albums"],
  ] as const) {
    await page.goto(path);
    const nav = catalogNav(page);
    await expect(nav.getByRole("link")).toHaveText([
      "Overview",
      "Artists",
      "Albums",
      "Tracks",
    ]);
    await expect(
      nav.getByRole("link", { name: current, exact: true }),
      path,
    ).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  }
});

test("every section is reachable by clicking, with no menu to open", async ({
  page,
}) => {
  await page.goto("/studio");
  await expect(heading(page, "Desk")).toBeVisible();

  // Desk to Catalog to each Catalog section and back.
  await primary(page)
    .getByRole("link", { name: "Catalog", exact: true })
    .click();
  await expect(heading(page, "Catalog")).toBeVisible();
  for (const section of ["Artists", "Albums", "Tracks"]) {
    await catalogNav(page)
      .getByRole("link", { name: section, exact: true })
      .click();
    await expect(heading(page, section)).toBeVisible();
  }
  await catalogNav(page)
    .getByRole("link", { name: "Overview", exact: true })
    .click();
  await expect(heading(page, "Catalog")).toBeVisible();

  // The overview also leads to each section.
  await page
    .getByRole("list", { name: "Catalog areas" })
    .getByRole("link", { name: "Albums", exact: true })
    .click();
  await expect(heading(page, "Albums")).toBeVisible();

  // Desk to the writing: a journal, its editor, all journals, Recently deleted.
  await primary(page).getByRole("link", { name: "Desk", exact: true }).click();
  await expect(heading(page, "Desk")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Write a journal" }),
  ).toBeVisible();
  const row = page
    .getByRole("list", { name: "Journals" })
    .getByRole("listitem")
    .filter({ hasText: ALBUM });
  await expect(row).toHaveCount(1);
  await row.getByRole("link", { name: /^Edit/ }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.goBack();
  await row.getByRole("link", { name: ALBUM, exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/journals\/[0-9a-f-]{36}$/);
  await page.goBack();
  await page.getByRole("link", { name: /^All (\d+ )?journals$/ }).click();
  await expect(heading(page, "Journals")).toBeVisible();
  await page.goBack();
  await page.getByRole("link", { name: /^Recently deleted/ }).click();
  await expect(heading(page, "Recently deleted")).toBeVisible();
});

test("browser history keeps working across the sections", async ({ page }) => {
  await page.goto("/studio");
  await primary(page)
    .getByRole("link", { name: "Catalog", exact: true })
    .click();
  await catalogNav(page)
    .getByRole("link", { name: "Tracks", exact: true })
    .click();
  await expect(heading(page, "Tracks")).toBeVisible();
  await page.goBack();
  await expect(heading(page, "Catalog")).toBeVisible();
  await page.goBack();
  await expect(heading(page, "Desk")).toBeVisible();
  await page.goForward();
  await expect(heading(page, "Catalog")).toBeVisible();
});

test("moving between sections is a client-side navigation", async ({
  page,
}) => {
  const documentRequests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") {
      documentRequests.push(new URL(request.url()).pathname);
    }
  });

  await page.goto("/studio");
  await expect(heading(page, "Desk")).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __documentMarker: string }).__documentMarker =
      "same-document";
  });
  documentRequests.length = 0;

  await primary(page)
    .getByRole("link", { name: "Catalog", exact: true })
    .click();
  await expect(heading(page, "Catalog")).toBeVisible();
  for (const section of ["Artists", "Albums", "Tracks"]) {
    await catalogNav(page)
      .getByRole("link", { name: section, exact: true })
      .click();
    await expect(heading(page, section)).toBeVisible();
  }
  await primary(page).getByRole("link", { name: "Desk", exact: true }).click();
  await expect(heading(page, "Desk")).toBeVisible();

  expect(documentRequests, "document requests during navigation").toEqual([]);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __documentMarker?: string }).__documentMarker,
    ),
    "the document was reloaded",
  ).toBe("same-document");
});

test("keyboard navigation between sections raises no console, script, or hydration error", async ({
  page,
}) => {
  // A production build reports a hydration mismatch as a console error (React
  // minified error 418, 423 or 425), so an empty list means there was none.
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      problems.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

  await page.goto("/studio");
  await expect(heading(page, "Desk")).toBeVisible();
  const steps: [() => ReturnType<Page["getByRole"]>, string][] = [
    [
      () => primary(page).getByRole("link", { name: "Catalog", exact: true }),
      "Catalog",
    ],
    [
      () =>
        catalogNav(page).getByRole("link", { name: "Artists", exact: true }),
      "Artists",
    ],
    [
      () => catalogNav(page).getByRole("link", { name: "Albums", exact: true }),
      "Albums",
    ],
    [
      () => catalogNav(page).getByRole("link", { name: "Tracks", exact: true }),
      "Tracks",
    ],
    [
      () => primary(page).getByRole("link", { name: "Desk", exact: true }),
      "Desk",
    ],
  ];
  for (const [link, title] of steps) {
    await link().focus();
    await page.keyboard.press("Enter");
    await expect(heading(page, title)).toBeVisible();
    await expect(page.getByText("Loading…")).toHaveCount(0);
  }
  expect(problems).toEqual([]);
});

// A KNOWN LIMITATION, recorded so it cannot be forgotten or quietly changed:
// each page renders its own header, so the link that was just activated is
// replaced by the next page's copy and keyboard focus is no longer on that
// link. Moving the header into a shared layout would fix it, but a layout is
// part of the static shell, which an anonymous request receives, and the
// Studio's furniture (including "Sign out") must never be in it. The
// follow-up and its required protections are in
// docs/design/studio-visual-fidelity.md (§ A shared, authenticated header).
// If that is ever built, this test is expected to change to the opposite
// assertion: that focus stays on the activated link.
test("known limitation: after a section loads, focus is no longer on the link that was activated", async ({
  page,
}) => {
  await page.goto("/studio");
  await expect(heading(page, "Desk")).toBeVisible();
  const link = primary(page).getByRole("link", {
    name: "Catalog",
    exact: true,
  });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(heading(page, "Catalog")).toBeVisible();
  // Asserts only what is documented: focus is not on a visible link in the new
  // page's navigation. (It may be on the document or on the page's <main>.)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.activeElement?.tagName === "A" &&
          document.activeElement.checkVisibility(),
      ),
    )
    .toBe(false);
});
