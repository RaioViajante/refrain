import { expect, test } from "@playwright/test";

import {
  findUndersizedTargets,
  type UndersizedTarget,
} from "./support/target-size";
import { signIn } from "./support/studio";

const PUBLIC_ROUTES = [
  "/",
  "/mixtapes",
  "/mixtapes/e2e-fita-longa",
  "/mixtapes/e2e-fita-curta",
  "/sobre",
  "/nao-existe",
] as const;

const STUDIO_ROUTES = [
  "/studio",
  "/studio/mixtapes",
  "/studio/mixtapes/nova",
  "/studio/musicas",
  "/studio/textos",
  "/studio/fotos",
  "/studio/previa/home",
  "/studio/previa/sobre",
] as const;

/**
 * Known exception, kept by the owner on 2026-11-19 pending a design decision:
 * rows of the approved composition stacked closer than 44 px. Each of these
 * controls has a 44 px target of its own, but the area it holds alone is cut
 * by the next row's (and, at the foot of a column of the tape's full list, by
 * the column's end). Only controls matching these selectors that have a
 * 44 px target of their own are tolerated; their measures are attached to the
 * report. Remove an entry once its rows are 44 px apart: the test fails if an
 * entry no longer occurs.
 */
const OVERLAPPING_ROWS = [
  // The tape page's track list (37–38 px rows) and full list (20–27 px rows).
  'a[aria-label^="Ouvir "][aria-label$=" no Spotify (abre em nova aba)"]',
  // /studio/textos, "ainda em rascunho": 38 px rows (li + li, −6 px).
  'nav[aria-label="Rascunhos"] a',
] as const;

test("every visible control has a 44 × 44 px target", async ({
  browser,
}, testInfo) => {
  const viewports =
    testInfo.project.name === "desktop"
      ? ([
          ["desktop", 1440, 900],
          ["tablet", 1024, 768],
        ] as const)
      : ([["mobile", 390, 844]] as const);
  const failures: Array<UndersizedTarget & { viewport: string }> = [];

  for (const [viewport, width, height] of viewports) {
    const context = await browser.newContext({
      viewport: { width, height },
      locale: "pt-BR",
      // Scroll-driven reveals would move targets while they are hit-tested.
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const measure = async (scope?: string) => {
      for (const target of await findUndersizedTargets(
        page,
        scope,
        OVERLAPPING_ROWS,
      )) {
        failures.push({ viewport, ...target });
      }
    };

    for (const route of PUBLIC_ROUTES) {
      await page.goto(route);
      await measure();
    }

    await page.goto("/studio/entrar");
    await measure();
    await signIn(page);

    for (const route of STUDIO_ROUTES) {
      await page.goto(route);
      await measure();
    }

    await page.goto("/studio/mixtapes");
    const editor = await page
      .getByRole("link", { name: /Editar \[Test\] fita longa/ })
      .getAttribute("href");
    if (!editor) throw new Error("The seeded tape editor link is missing.");
    await page.goto(editor);
    await measure();

    await page
      .getByRole("button", { name: "escolher das fotos" })
      .first()
      .click();
    await measure();

    await page.goto("/studio/musicas");
    await page.getByRole("button", { name: "+ adicionar música" }).click();
    await expect(page.locator("dialog[open]")).toBeVisible();
    await measure("dialog[open]");

    await page.goto("/studio/fotos");
    await page
      .getByRole("button", { name: "editar: [Test] capa da fita longa" })
      .click();
    await measure();

    await context.close();
  }

  const grouped = new Map<
    string,
    Omit<UndersizedTarget, "name"> & {
      viewport: string;
      count: number;
      examples: string[];
    }
  >();
  for (const failure of failures.filter((f) => !f.overlaps)) {
    const { name, ...family } = failure;
    const key = JSON.stringify(family);
    const found = grouped.get(key);
    if (found) {
      found.count += 1;
      if (found.examples.length < 3 && !found.examples.includes(name)) {
        found.examples.push(name);
      }
    } else {
      grouped.set(key, { ...family, count: 1, examples: [name] });
    }
  }
  expect(
    [...grouped.values()],
    "Every visible control must have an effective target of at least 44 × 44 px.",
  ).toEqual([]);
  const tolerated = failures.filter((f) => f.overlaps);
  await testInfo.attach("overlapping-rows.json", {
    body: JSON.stringify(tolerated, null, 2),
    contentType: "application/json",
  });
  expect(
    [...new Set(tolerated.map((f) => f.overlaps))].sort(),
    "Each OVERLAPPING_ROWS entry must still occur; remove the ones that do not.",
  ).toEqual([...OVERLAPPING_ROWS].sort());
});

test.describe("the target measurement", () => {
  // The helper's logic does not depend on the viewport.
  test.skip(({ isMobile }) => isMobile, "measured once, on desktop");

  test("a play link whose own area is cut to 30 px is no longer tolerated", async ({
    page,
  }) => {
    const playLinks = OVERLAPPING_ROWS[0];
    const measure = async () =>
      (await findUndersizedTargets(page, "body", OVERLAPPING_ROWS)).filter(
        (t) => t.name.startsWith("Ouvir "),
      );

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/mixtapes/e2e-fita-longa");
    const before = await measure();
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((t) => t.overlaps === playLinks)).toBe(true);

    await page.addStyleTag({
      content: `${playLinks}::after { height: 30px !important; }`,
    });
    // The reduced-motion rule gives every property a 0.01 ms transition:
    // wait for the new height to apply.
    await expect
      .poll(() =>
        page
          .locator(playLinks)
          .evaluateAll((links) =>
            links.every(
              (l) => getComputedStyle(l, "::after").height === "30px",
            ),
          ),
      )
      .toBe(true);
    const after = await measure();
    expect(after.length).toBeGreaterThanOrEqual(before.length);
    expect(after.filter((t) => t.overlaps)).toEqual([]);
  });

  test("tolerates overlapping rows only with a 44 px area of their own and a clickable centre", async ({
    page,
  }) => {
    const rows = ["ul.rows a"];
    // Three rows 30 px apart; each link's ::after is set per case.
    const fixture = (after: string, extra = "") => `
      <style>
        body { margin: 0; font: 13px/15px sans-serif; }
        ul.rows { list-style: none; margin: 200px 0; padding: 0 200px; }
        ul.rows li { height: 30px; }
        ul.rows a { position: relative; display: inline-block; }
        ul.rows a::after { content: ""; position: absolute; ${after} }
        ${extra}
      </style>
      <ul class="rows">
        <li><a href="#a">primeira</a></li>
        <li><a href="#b">segunda</a></li>
        <li><a href="#c">terceira</a></li>
      </ul>`;
    const measure = async (after: string, extra?: string) => {
      await page.setContent(fixture(after, extra));
      return findUndersizedTargets(page, "body", rows);
    };
    const enlarged =
      "left: 50%; top: 50%; width: max(100%, 44px); height: 44px; translate: -50% -50%;";

    // A real 44 px area, cut only by the next row's: tolerated.
    const overlapping = await measure(enlarged);
    expect(overlapping.length).toBeGreaterThan(0);
    expect(overlapping.every((t) => t.overlaps === rows[0])).toBe(true);

    // An absolute ::after that does not enlarge anything: not tolerated.
    const noArea = await measure("inset: 0;");
    expect(noArea).toHaveLength(3);
    expect(noArea.filter((t) => t.overlaps)).toEqual([]);

    // A 44 px wide but 30 px tall area: not tolerated.
    const short = await measure(
      "left: 50%; top: 50%; width: 44px; height: 30px; translate: -50% -50%;",
    );
    expect(short).toHaveLength(3);
    expect(short.filter((t) => t.overlaps)).toEqual([]);

    // A 44 px area scaled down by half: not counted, not tolerated.
    const scaled = await measure(`${enlarged} scale: 0.5;`);
    expect(scaled).toHaveLength(3);
    expect(scaled.filter((t) => t.overlaps)).toEqual([]);

    // A 44 px area under a cover: its centre is not clickable.
    const covered = await measure(
      enlarged,
      "ul.rows li:nth-child(2) { position: relative; } ul.rows li:nth-child(2)::before { content: ''; position: absolute; inset: -20px 0; z-index: 1; }",
    );
    const second = covered.find((t) => t.name === "segunda");
    expect(second).toBeDefined();
    expect(second?.overlaps).toBeUndefined();
  });
});
