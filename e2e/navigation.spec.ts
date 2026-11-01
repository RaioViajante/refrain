import { expect, test } from "@playwright/test";

// Moving between Studio sections is a client-side navigation: the browser
// never loads a new document. This test gathers the browser's own evidence,
// instead of assuming it (issue #23):
//
//  - a marker on `window` survives, so the document was not reloaded;
//  - no request of resource type "document" is made after the first one.
//
// What it deliberately does not claim: the Studio header is rendered by each
// authorized page, not by a shared layout (an anonymous response must never
// contain the studio's furniture, see src/modules/identity/studio.http.test.ts),
// so each section brings its own header and keyboard focus is no longer on the
// link that was activated. That is documented in
// docs/design/studio-visual-fidelity.md as a follow-up that needs a decision
// about the authorization boundary.
//
// Sign-out is a full navigation on purpose, so that nothing rendered under
// the old session can be shown again; it is covered by authentication.spec.ts.

const SECTIONS = [
  { link: "Artists", heading: "Artists" },
  { link: "Albums", heading: "Albums" },
  { link: "Tracks", heading: "Tracks" },
  { link: "Journals", heading: "Journals" },
  { link: "Desk", heading: "Your desk" },
];

test("moving between Studio sections is a client-side navigation", async ({
  page,
}) => {
  const documentRequests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") {
      documentRequests.push(new URL(request.url()).pathname);
    }
  });

  await page.goto("/studio");
  await expect(
    page.getByRole("heading", { level: 1, name: "Your desk" }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __documentMarker: string }).__documentMarker =
      "same-document";
  });
  documentRequests.length = 0;

  for (const section of SECTIONS) {
    // Earlier routes stay in the DOM, hidden, so only the visible
    // navigation is used.
    await page
      .getByRole("navigation", { name: "Writing studio" })
      .getByRole("link", { name: section.link, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: section.heading }),
    ).toBeVisible();
  }

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
  await expect(
    page.getByRole("heading", { level: 1, name: "Your desk" }),
  ).toBeVisible();
  for (const section of SECTIONS) {
    const link = page
      .getByRole("navigation", { name: "Writing studio" })
      .getByRole("link", { name: section.link, exact: true });
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { level: 1, name: section.heading }),
    ).toBeVisible();
    await expect(page.getByText("Loading…")).toHaveCount(0);
    await expect(link).toHaveAttribute("aria-current", "page");
  }
  expect(problems).toEqual([]);
});

// A KNOWN LIMITATION, recorded so it cannot be forgotten or quietly changed:
// each page renders its own header, so the link that was just activated is
// replaced by the next page's copy and keyboard focus is no longer on that link. Moving the header into a shared layout would fix it, but a
// layout is part of the static shell, which an anonymous request receives, and
// the Studio's furniture (including "Sign out") must never be in it. The
// follow-up and its required protections are in
// docs/design/studio-visual-fidelity.md (§ A shared, authenticated header).
// If that is ever built, this test is expected to change to the opposite
// assertion: that focus stays on the activated link.
test("known limitation: after a section loads, focus is no longer on the link that was activated", async ({
  page,
}) => {
  await page.goto("/studio");
  await expect(
    page.getByRole("heading", { level: 1, name: "Your desk" }),
  ).toBeVisible();
  const link = page
    .getByRole("navigation", { name: "Writing studio" })
    .getByRole("link", { name: "Artists", exact: true });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Artists" }),
  ).toBeVisible();
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
