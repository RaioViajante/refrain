import type { DatabaseExecutor, Locale } from "@/db";
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
