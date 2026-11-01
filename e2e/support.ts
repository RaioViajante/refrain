import { expect, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";

import { mintAuthorSession, type MintedSession } from "@/testing/http-session";
import {
  assertDisposableTestDatabase,
  readTestDatabaseUrl,
} from "@/testing/test-database";

// Helpers shared by the browser tests. Everything they create is synthetic
// and named "[Test] E2E <run id> …", so the global teardown can remove it and
// nothing is ever mistaken for the author's writing.

export function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set; the global setup did not run.`);
  }
  return value;
}

/** A name for a synthetic record, unique to this run and to the test. */
export function named(what: string): string {
  return `[Test] E2E ${env("E2E_RUN_ID")} ${what}`;
}

/**
 * Runs `work` with a connection to the disposable test database, after the
 * same server-side marker check that guards every other test. Tests use it to
 * check what was stored and to mint sessions, never to create the records
 * under test.
 */
export async function withDatabase<Result>(
  work: (client: Client) => Promise<Result>,
): Promise<Result> {
  const client = new Client({
    connectionString: readTestDatabaseUrl(process.env),
    application_name: "refrain-e2e",
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  try {
    await assertDisposableTestDatabase(client);
    return await work(client);
  } finally {
    await client.end();
  }
}

/** A session of the synthetic author that only the calling test owns. */
export function mintSession(expiresInSeconds = 3600): Promise<MintedSession> {
  return withDatabase((client) =>
    mintAuthorSession(client, env("E2E_SESSION_SECRET"), expiresInSeconds),
  );
}

/** Ends a minted session on the server, as sign-out or expiry would. */
export function revokeSession(session: MintedSession): Promise<void> {
  return withDatabase(async (client) => {
    await client.query("delete from auth_sessions where token = $1", [
      session.token,
    ]);
  });
}

/** Adds a minted session's cookie to the page's own (isolated) context. */
export async function useSession(
  page: Page,
  session: MintedSession,
): Promise<void> {
  const separator = session.cookie.indexOf("=");
  await page.context().addCookies([
    {
      name: session.cookie.slice(0, separator),
      value: session.cookie.slice(separator + 1),
      url: env("E2E_BASE_URL"),
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
}

/**
 * The page must not scroll sideways. In mobile emulation a page that is wider
 * than the screen makes the browser widen its layout viewport to fit it, so
 * `scrollWidth` alone would report nothing wrong: the layout viewport itself
 * must also stay at the width of the screen.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const screen = page.viewportSize()!.width;
  const { layoutWidth, overflow } = await page.evaluate(() => ({
    layoutWidth: window.innerWidth,
    overflow:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  }));
  expect(
    layoutWidth,
    "the layout is wider than the screen",
  ).toBeLessThanOrEqual(screen);
  expect(overflow, "horizontal overflow in pixels").toBeLessThanOrEqual(0);
}

/** The control is at least 44 by 44 CSS pixels (WCAG 2.5.5). */
export async function expectTouchTarget(control: Locator): Promise<void> {
  const box = await control.boundingBox();
  expect(box, "the control is on screen").not.toBeNull();
  expect(box!.height, "target height").toBeGreaterThanOrEqual(43.5);
  expect(box!.width, "target width").toBeGreaterThanOrEqual(43.5);
}

export interface StudioAlbum {
  artist: string;
  album: string;
  albumUrl: string;
}

/**
 * Creates an artist and an album credited to it through the Studio's own
 * forms, and returns where the album is. For the tests that are about
 * something else (journals) but need an album to write about.
 */
export async function createAlbumThroughStudio(
  page: Page,
  names: { artist: string; album: string },
): Promise<StudioAlbum> {
  await page.goto("/studio/artists/new");
  await page.getByLabel("Name", { exact: true }).fill(names.artist);
  await page.getByRole("button", { name: "Add artist" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: names.artist }),
  ).toBeVisible();

  await page.goto("/studio/albums/new");
  await page.getByLabel("Title", { exact: true }).fill(names.album);
  await page
    .getByLabel("Credited artists: artist 1", { exact: true })
    .selectOption({ label: names.artist });
  await page.getByRole("button", { name: "Add album" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: names.album }),
  ).toBeVisible();
  return { ...names, albumUrl: page.url() };
}
