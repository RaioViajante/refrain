// Seeds, changes, and removes the synthetic public journals that the browser
// tests read (`pnpm test:e2e`). It runs under `tsx --conditions=react-server`,
// as `author:provision` does, because it uses server-only modules that
// Playwright's own process cannot load. It touches only the disposable test
// database: the same five safety checks as every test apply to
// TEST_DATABASE_URL, and a record is removed only by the ids it printed.
//
//   seed <slug-prefix>        prints a JSON description of what it created
//   unpublish <entry-id>      the real command, as the author's unpublish
//   publish <entry-id>        the real preview-then-publish, for a test
//   remove <json> <prefix>    removes what `seed` printed
//   cover <entry-id> <url|none>
//                             sets (or clears) the cover of the journal's
//                             album, as the catalog stores one (M3.2)
import { randomBytes } from "node:crypto";

import { Client } from "pg";

import { testAuthor } from "./fixtures";
import {
  fixtureDatabase,
  PUBLIC_TEXT,
  removeSeeded,
  seedGrace,
  seedSimple,
  type SeededJournal,
} from "./public-journals";
import { publishForTest } from "./publishing";
import {
  assertDisposableTestDatabase,
  readTestDatabaseUrl,
} from "./test-database";

// The commands that publish need the application's configuration; it exists
// only in this process's memory.
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.REFRAIN_AUTHOR_EMAIL = "author@example.com";

async function main() {
  const [command, first, second] = process.argv.slice(2);
  const client = new Client({
    connectionString: readTestDatabaseUrl(process.env),
    application_name: "refrain-public-seed",
  });
  await client.connect();
  try {
    await assertDisposableTestDatabase(client);
    switch (command) {
      case "seed": {
        const prefix = first!;
        const grace = await seedGrace(client, {
          slug: `${prefix}-grace`,
          document: "editorial",
        });
        const draft = await seedSimple(client, {
          slug: `${prefix}-draft`,
          title: "[Test] Draft album",
          status: "draft",
          marker: "[Test] PRIVATE-DRAFT-MARKER",
        });
        console.log(
          JSON.stringify({
            grace,
            draft,
            opening: PUBLIC_TEXT.opening,
          }),
        );
        break;
      }
      case "unpublish": {
        const { unpublishLanguageVersion } =
          await import("@/modules/publication/commands");
        await unpublishLanguageVersion(
          fixtureDatabase(client),
          testAuthor(),
          first!,
          "en",
          "private",
        );
        break;
      }
      case "publish": {
        await publishForTest(fixtureDatabase(client), first!, "en");
        break;
      }
      case "cover": {
        const coverUrl = second === "none" ? null : second!;
        await client.query(
          `update albums set cover_url = $1, cover_source = $2
            where id = (select album_id from album_journals where entry_id = $3)`,
          [coverUrl, coverUrl ? "Cover Art Archive" : null, first!],
        );
        break;
      }
      case "remove": {
        const seeded = JSON.parse(first!) as {
          grace: SeededJournal;
          draft: SeededJournal;
        };
        await removeSeeded(client, [seeded.grace, seeded.draft], second!);
        break;
      }
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
