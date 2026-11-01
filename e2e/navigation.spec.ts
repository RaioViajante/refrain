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
// so each section brings its own header and keyboard focus returns to the top of
// the page. That is documented in docs/design/studio-visual-fidelity.md as a
// follow-up that needs a decision about the authorization boundary.
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
