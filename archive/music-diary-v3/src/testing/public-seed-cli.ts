// Seeds, changes, and removes the synthetic public journals that the browser
// tests read (`pnpm test:e2e`). It runs under `tsx --conditions=react-server`,
// as `author:provision` does, because it uses server-only modules that
// Playwright's own process cannot load. It touches only the disposable test
// database: the same five safety checks as every test apply to
// TEST_DATABASE_URL, and a record is removed only by the ids it printed.
//
//   seed <slug-prefix>        prints a JSON description of what it created:
//                             Grace, a draft, and the Home's shelf (M3.4)
//   unpublish <entry-id>      the real command, as the author's unpublish
//   publish <entry-id> [at]   the real preview-then-publish, for a test; with
//                             an ISO date, the English version's publication
//                             date is then set back to it (the Home's order)
//   remove <json> <prefix>    removes what `seed` printed
//   cover <entry-id> <url|none>
//                             sets (or clears) the cover of the journal's
//                             album, as the catalog stores one (M3.2)
//   artists <slug-prefix>     the artist pages' states (M3.5), as JSON
//   remove-artists <json> <prefix>
//                             removes what `artists` printed
//   memories <slug-prefix>    the public memory pages' states (M3.7), as JSON
//   remove-memories <json> <prefix>
//                             removes what `memories` printed
import { randomBytes } from "node:crypto";

import { Client } from "pg";

import { createTestAlbumJournal, testAuthor } from "./fixtures";
import {
  fixtureDatabase,
  PUBLIC_TEXT,
  removeSeeded,
  seedGrace,
  seedHomeShelf,
  seedSimple,
  type SeededJournal,
} from "./public-journals";
import { publishForTest } from "./publishing";
import {
  removeSeededArtists,
  seedArtistPages,
  type SeededArtists,
} from "./public-artists";
import {
  removeSeededMemories,
  seedMemories,
  type SeededMemories,
} from "./public-memories";
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
        const shelf = await seedHomeShelf(client, prefix);
        console.log(
          JSON.stringify({
            grace,
            draft,
            shelf,
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
        if (second) {
          await client.query(
            `update entry_texts set published_at = $2
              where entry_id = $1 and locale = 'en' and status = 'published'`,
            [first!, new Date(second)],
          );
        }
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
      case "artists": {
        console.log(JSON.stringify(await seedArtistPages(client, first!)));
        break;
      }
      case "remove-artists": {
        await removeSeededArtists(
          client,
          JSON.parse(first!) as SeededArtists,
          second!,
        );
        break;
      }
      case "memories": {
        console.log(JSON.stringify(await seedMemories(client, first!)));
        break;
      }
      case "remove-memories": {
        await removeSeededMemories(
          client,
          JSON.parse(first!) as SeededMemories,
          second!,
        );
        break;
      }
      case "another-journal": {
        // A second, earlier published journal about the album of the journal
        // `first` (M3.8a: several journals about one album).
        const [{ album_id: albumId }] = (
          await client.query<{ album_id: string }>(
            "select album_id from album_journals where entry_id = $1",
            [first!],
          )
        ).rows as [{ album_id: string }];
        const entryId = await fixtureDatabase(client).transaction((tx) =>
          createTestAlbumJournal(tx, {
            albumId,
            slug: second!,
            versions: [
              {
                locale: "en",
                status: "published",
                text: "[Test] An earlier journal about the same album.",
                publishedAt: new Date("2020-01-02T00:00:00Z"),
              },
            ],
          }),
        );
        console.log(JSON.stringify({ entryId, slug: second }));
        break;
      }
      case "memory-writing": {
        // A memory's English writing as one paragraph (M3.8b: the Home's
        // excerpt at its full length). Test fixtures only.
        const text = second!;
        await client.query(
          `update entry_texts
              set body = $2::jsonb, body_text = $3
            where entry_id = $1 and locale = 'en'`,
          [
            first!,
            JSON.stringify({
              type: "doc",
              content: [
                { type: "paragraph", content: [{ type: "text", text }] },
              ],
            }),
            text,
          ],
        );
        break;
      }
      case "remove-entry": {
        await client.query("delete from entry_slugs where entry_id = $1", [
          first!,
        ]);
        await client.query("delete from entries where id = $1", [first!]);
        break;
      }
      case "remove": {
        const seeded = JSON.parse(first!) as {
          grace: SeededJournal;
          draft: SeededJournal;
          shelf?: SeededJournal[];
        };
        await removeSeeded(
          client,
          [seeded.grace, seeded.draft, ...(seeded.shelf ?? [])],
          second!,
        );
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
