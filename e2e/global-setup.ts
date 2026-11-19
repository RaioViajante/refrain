// Rebuilds the browser tests' disposable database before every run: creates
// it if missing, drops and recreates its schema, applies every committed
// migration, and seeds synthetic [Test] records (./support/data.ts).
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";

import {
  imageFiles,
  images,
  mixtapes,
  mixtapeTracks,
  siteTexts,
  songs,
} from "../src/db/schema";
import * as schema from "../src/db/schema";
import { readTestDatabaseUrl } from "../src/db/env";

import {
  DRAFT_TAPE,
  DRAFT_TEXT,
  FLOW_TEXT,
  LONG_TAPE,
  PRIVATE_PHOTO_ID,
  PUBLIC_PHOTO_ID,
  PUBLISHED_TEXTS,
  SHORT_TAPE,
} from "./support/data";
import { E2E_DATABASE_URL } from "./support/env";
import { testPng } from "./support/png";

/** Creates the e2e database on its (local, disposable) server if missing. */
async function ensureDatabase(url: string) {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  // Identifier is quoted below; the guard already limits it to *_test.
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error("The e2e database name must match ^[a-z0-9_]+_test$.");
  }
  const server = new URL(url);
  server.pathname = "/postgres";
  const client = new Client({ connectionString: server.toString() });
  await client.connect();
  try {
    const found = await client.query(
      "select 1 from pg_database where datname = $1",
      [name],
    );
    if (found.rowCount === 0) await client.query(`create database "${name}"`);
  } finally {
    await client.end();
  }
}

export default async function globalSetup() {
  // Validated again here: local host, name ending in _test.
  const url = readTestDatabaseUrl({ TEST_DATABASE_URL: E2E_DATABASE_URL });
  await ensureDatabase(url);

  const pool = new Pool({ connectionString: url });
  try {
    const db = drizzle(pool, { schema });
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`create schema public`);
    await migrate(db, { migrationsFolder: "src/db/migrations" });
    await seed(db);
  } finally {
    await pool.end();
  }
}

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function seed(db: Db) {
  const now = new Date();
  const png = testPng();

  await db.insert(images).values([
    {
      id: PUBLIC_PHOTO_ID,
      alt: "[Test] capa da fita longa",
      width: 16,
      height: 16,
      rightsConfirmed: true,
      rightsNote: "[Test] gerada pelo teste",
    },
    {
      id: PRIVATE_PHOTO_ID,
      alt: "[Test] foto sem direitos confirmados",
      width: 16,
      height: 16,
      rightsConfirmed: false,
    },
  ]);
  await db.insert(imageFiles).values(
    [PUBLIC_PHOTO_ID, PRIVATE_PHOTO_ID].map((imageId) => ({
      imageId,
      contentType: "image/png",
      byteSize: png.length,
      bytes: png,
    })),
  );

  const songRows = await db
    .insert(songs)
    .values(
      Array.from({ length: LONG_TAPE.trackCount }, (_, i) => ({
        title: `[Test] canção ${String(i + 1).padStart(2, "0")}`,
        // A few artists repeat, so the artist cloud has something to show.
        artist: `[Test] artista ${"ABCDEFG"[i % 7]}`,
      })),
    )
    .returning({ id: songs.id });

  const [long, short, draft] = await db
    .insert(mixtapes)
    .values([
      {
        number: 1,
        slug: LONG_TAPE.slug,
        title: LONG_TAPE.title,
        theme: "[Test] tema",
        feeling: LONG_TAPE.feeling,
        description: "[Test] frase da fita longa",
        reflection:
          "[Test] reflexão, primeiro parágrafo.\n\n[Test] reflexão, último parágrafo.",
        year: 2024,
        coverImageId: PUBLIC_PHOTO_ID,
        featuredRank: 1,
        status: "published",
        publishedAt: now,
      },
      {
        number: 2,
        slug: SHORT_TAPE.slug,
        title: SHORT_TAPE.title,
        theme: "[Test] outro tema",
        feeling: SHORT_TAPE.feeling,
        description: "[Test] frase da fita curta",
        year: 2025,
        featuredRank: 2,
        status: "published",
        publishedAt: now,
      },
      {
        number: 3,
        slug: DRAFT_TAPE.slug,
        title: DRAFT_TAPE.title,
        description: DRAFT_TAPE.description,
        coverImageId: PRIVATE_PHOTO_ID,
        status: "draft",
      },
    ])
    .returning({ id: mixtapes.id });

  const track = (mixtapeId: string, i: number, note = "") => ({
    mixtapeId,
    songId: songRows[i]!.id,
    position: i + 1,
    note,
    noteSide: i % 2 === 0 ? ("right" as const) : ("left" as const),
  });
  await db
    .insert(mixtapeTracks)
    .values([
      ...songRows.map((_, i) =>
        track(long!.id, i, LONG_TAPE.notes[i + 1] ?? ""),
      ),
      ...Array.from({ length: SHORT_TAPE.trackCount }, (_, i) =>
        track(short!.id, i),
      ),
      track(draft!.id, 0, "[Test] nota do rascunho"),
    ]);

  await db.insert(siteTexts).values([
    ...Object.entries(PUBLISHED_TEXTS).map(([key, body]) => ({
      key,
      body,
      published: true,
    })),
    { key: DRAFT_TEXT.key, body: DRAFT_TEXT.body, published: false },
    { key: FLOW_TEXT.key, body: FLOW_TEXT.body, published: false },
  ]);
}
