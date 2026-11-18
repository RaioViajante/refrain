import { sql } from "drizzle-orm";

import type { DatabaseExecutor, Locale } from "@/db";
import type { AuthorizedAuthor } from "@/modules/identity";
// Test support drives the command with a database handle, which the module's
// public entry point does not offer (it binds the application database), so
// that tests can run inside a rolled-back transaction.
// eslint-disable-next-line no-restricted-imports
import { setAlbumJournalPrivacy } from "@/modules/journals/commands";
import {
  previewPublication,
  publishLanguageVersion,
} from "@/modules/publication";

import { testAuthor } from "./fixtures";

/**
 * Publishes a fixture's language version through the real checked command:
 * a preview, then a publish with the token it returned. Production code never
 * does this (ADR 0006 § 9: no code mints a token and consumes it in one
 * operation), because that would simulate an acknowledgement that no human
 * gave. A test that needs a published version, and is not testing the
 * acknowledgement, does it here on purpose. Imported only by tests.
 */
export async function publishForTest(
  db: DatabaseExecutor,
  entryId: string,
  locale: Locale,
  author = testAuthor(),
): Promise<{ changed: boolean }> {
  const { disclosure, confirmation } = await previewPublication(db, author, {
    entryId,
    locale,
  });
  return publishLanguageVersion(db, author, {
    entryId,
    locale,
    expectedVersion: disclosure.entryVersion,
    confirmation,
  });
}

/**
 * Changes a language version to `draft` or `private` through the real command,
 * expecting the status it has now. For tests whose subject is something else;
 * the stale-state refusal has its own tests, which pass the status
 * themselves.
 */
export async function setPrivacyForTest(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  input: { entryId: string; locale: Locale; status: "draft" | "private" },
): Promise<void> {
  const result = await db.execute<{ status: string }>(sql`
    select status from entry_texts
     where entry_id = ${input.entryId} and locale = ${input.locale}`);
  await setAlbumJournalPrivacy(db, author, {
    ...input,
    expectedStatus: result.rows[0]?.status ?? "draft",
  });
}
