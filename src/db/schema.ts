// Refrain's schema (decision 0002). Integrity lives here, in PostgreSQL:
// keys, NOT NULL, UNIQUE, and CHECK. Authored content (mixtapes, track notes,
// site texts) is never removed by a cascade: every foreign key restricts, and
// the Studio deletes dependent rows explicitly, in one transaction.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** PostgreSQL bytea, as a Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow();

/**
 * A photograph or cover uploaded by the owner. Its bytes live in
 * `image_files`; the application serves them at /fotos/<id>, to anyone only
 * when the photo is public (src/server/visibility.ts: rights confirmed and
 * in public use), otherwise only to the signed-in owner. `focus` is the 3 × 3 focal point used by `object-position`
 * (0 = top left … 4 = centre … 8 = bottom right). `treatment` chooses
 * between the site's photographic filter and the original colours.
 */
export const images = pgTable(
  "images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    alt: text("alt").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    focus: smallint("focus").notNull().default(4),
    treatment: text("treatment").notNull().default("mood"),
    rightsConfirmed: boolean("rights_confirmed").notNull().default(false),
    rightsNote: text("rights_note").notNull().default(""),
    createdAt,
    updatedAt,
  },
  (t) => [
    check("images_alt_length", sql`char_length(${t.alt}) between 1 and 300`),
    check("images_size_positive", sql`${t.width} > 0 and ${t.height} > 0`),
    check("images_focus_range", sql`${t.focus} between 0 and 8`),
    check("images_treatment", sql`${t.treatment} in ('mood', 'original')`),
    check(
      "images_rights_note_length",
      sql`char_length(${t.rightsNote}) <= 500`,
    ),
  ],
);

/**
 * The bytes of an uploaded photograph (JPEG or PNG, cleaned of metadata,
 * at most 4 MB), kept apart so listing photos never loads them.
 */
export const imageFiles = pgTable(
  "image_files",
  {
    imageId: uuid("image_id")
      .primaryKey()
      .references(() => images.id, { onDelete: "cascade" }),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt,
  },
  (t) => [
    check(
      "image_files_content_type",
      sql`${t.contentType} in ('image/jpeg', 'image/png')`,
    ),
    check(
      "image_files_byte_size",
      sql`${t.byteSize} between 1 and 4194304 and ${t.byteSize} = octet_length(${t.bytes})`,
    ),
  ],
);

/**
 * A mixtape. Public pages show it only when `status = 'published'`
 * (src/server/visibility.ts). `number` is its catalogue number ("Nº 01");
 * `featured_rank` places it among the three tapes the home page opens with.
 */
export const mixtapes = pgTable(
  "mixtapes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: smallint("number").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    theme: text("theme").notNull().default(""),
    // One short word the catalogue filters by ("saudade", "estrada").
    feeling: text("feeling").notNull().default(""),
    description: text("description").notNull().default(""),
    reflection: text("reflection").notNull().default(""),
    pullQuote: text("pull_quote").notNull().default(""),
    pullQuoteCredit: text("pull_quote_credit").notNull().default(""),
    playlistUrl: text("playlist_url"),
    year: smallint("year"),
    coverImageId: uuid("cover_image_id").references(() => images.id, {
      onDelete: "restrict",
    }),
    detailImageId: uuid("detail_image_id").references(() => images.id, {
      onDelete: "restrict",
    }),
    detailCaption: text("detail_caption").notNull().default(""),
    featuredRank: smallint("featured_rank"),
    status: text("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("mixtapes_number_key").on(t.number),
    uniqueIndex("mixtapes_slug_key").on(t.slug),
    uniqueIndex("mixtapes_featured_rank_key").on(t.featuredRank),
    // Positive only, with no upper bound: reordering the shelf moves numbers
    // above the current range inside its transaction. The Studio caps new
    // numbers at 999.
    check("mixtapes_number_positive", sql`${t.number} > 0`),
    check(
      "mixtapes_slug_format",
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.slug}) <= 80`,
    ),
    check(
      "mixtapes_title_length",
      sql`char_length(${t.title}) between 1 and 120`,
    ),
    check("mixtapes_theme_length", sql`char_length(${t.theme}) <= 120`),
    check(
      "mixtapes_feeling_format",
      sql`${t.feeling} = '' or ${t.feeling} ~ '^[a-zà-ÿ]+( [a-zà-ÿ]+)?$' and char_length(${t.feeling}) <= 30`,
    ),
    check(
      "mixtapes_description_length",
      sql`char_length(${t.description}) <= 600`,
    ),
    check(
      "mixtapes_reflection_length",
      sql`char_length(${t.reflection}) <= 20000`,
    ),
    check(
      "mixtapes_pull_quote_length",
      sql`char_length(${t.pullQuote}) <= 600 and char_length(${t.pullQuoteCredit}) <= 200`,
    ),
    check(
      "mixtapes_playlist_url_https",
      sql`${t.playlistUrl} is null or (${t.playlistUrl} ~ '^https://' and char_length(${t.playlistUrl}) <= 500)`,
    ),
    check(
      "mixtapes_year_range",
      sql`${t.year} is null or ${t.year} between 1900 and 2100`,
    ),
    check(
      "mixtapes_detail_caption_length",
      sql`char_length(${t.detailCaption}) <= 200`,
    ),
    check(
      "mixtapes_featured_rank_range",
      sql`${t.featuredRank} is null or ${t.featuredRank} between 1 and 3`,
    ),
    check("mixtapes_status", sql`${t.status} in ('draft', 'published')`),
    check(
      "mixtapes_published_at",
      sql`(${t.status} = 'published') = (${t.publishedAt} is not null)`,
    ),
  ],
);

/** A song in the owner's catalogue, which tapes reference by tracks. */
export const songs = pgTable(
  "songs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    artist: text("artist").notNull(),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("songs_title_artist_key").on(
      sql`lower(${t.title})`,
      sql`lower(${t.artist})`,
    ),
    index("songs_artist_idx").on(t.artist),
    check(
      "songs_title_length",
      sql`char_length(btrim(${t.title})) between 1 and 200`,
    ),
    check(
      "songs_artist_length",
      sql`char_length(btrim(${t.artist})) between 1 and 200`,
    ),
  ],
);

/**
 * One song's place on one tape: its order (`position`, from 1) and the
 * owner's note for it on this tape. `note_side` places the note to the left
 * or right of the tracklist in the editorial layout.
 */
export const mixtapeTracks = pgTable(
  "mixtape_tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mixtapeId: uuid("mixtape_id")
      .notNull()
      .references(() => mixtapes.id, { onDelete: "restrict" }),
    songId: uuid("song_id")
      .notNull()
      .references(() => songs.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    note: text("note").notNull().default(""),
    noteSide: text("note_side").notNull().default("right"),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("mixtape_tracks_position_key").on(t.mixtapeId, t.position),
    uniqueIndex("mixtape_tracks_song_key").on(t.mixtapeId, t.songId),
    index("mixtape_tracks_song_idx").on(t.songId),
    // Positive only, with no upper bound: reordering moves positions above the
    // current range inside its transaction (src/server/tracklist.ts).
    check("mixtape_tracks_position_positive", sql`${t.position} > 0`),
    check("mixtape_tracks_note_length", sql`char_length(${t.note}) <= 1000`),
    check("mixtape_tracks_note_side", sql`${t.noteSide} in ('left', 'right')`),
  ],
);

/**
 * The owner's texts on fixed pages (the home letter and quote, the about
 * page), edited in the Studio. Keys are defined in src/content/site-texts.ts.
 * A text is public only once the owner publishes it (`published`).
 */
export const siteTexts = pgTable(
  "site_texts",
  {
    key: text("key").primaryKey(),
    body: text("body").notNull(),
    published: boolean("published").notNull().default(false),
    createdAt,
    updatedAt,
  },
  (t) => [
    check(
      "site_texts_key_format",
      sql`${t.key} ~ '^[a-z0-9]+(\\.[a-z0-9_]+)+$'`,
    ),
    check("site_texts_body_length", sql`char_length(${t.body}) <= 20000`),
  ],
);

/** Which uploaded image fills each fixed photograph slot on public pages. */
export const siteImages = pgTable(
  "site_images",
  {
    slot: text("slot").primaryKey(),
    imageId: uuid("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "restrict" }),
    createdAt,
    updatedAt,
  },
  (t) => [
    check(
      "site_images_slot_format",
      sql`${t.slot} ~ '^[a-z0-9]+(\\.[a-z0-9_]+)+$'`,
    ),
  ],
);

/**
 * A signed-in Studio session. Only a SHA-256 of the random token is stored;
 * the token itself lives in the owner's HttpOnly cookie.
 */
export const studioSessions = pgTable(
  "studio_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    createdAt,
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("studio_sessions_token_hash_key").on(t.tokenHash),
    index("studio_sessions_expires_at_idx").on(t.expiresAt),
    check(
      "studio_sessions_token_hash_format",
      sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check("studio_sessions_expiry", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

/**
 * Sign-in attempts, for throttling. `client_key` is a SHA-256 of the client's
 * address, never the address itself. Rows older than a day are pruned.
 */
export const studioLoginAttempts = pgTable(
  "studio_login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientKey: text("client_key").notNull(),
    succeeded: boolean("succeeded").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("studio_login_attempts_client_idx").on(t.clientKey, t.attemptedAt),
    index("studio_login_attempts_at_idx").on(t.attemptedAt),
    check(
      "studio_login_attempts_client_key_format",
      sql`${t.clientKey} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

// The Studio's trash and text history (decision 0003). A deleted item leaves
// its live table and is kept here as a snapshot for 30 days; a replaced text
// is kept as a version for 30 days. Public pages never read these tables.
// `purge_after` comes from the database's clock, and nothing can be kept
// longer than 30 days after it was deleted or replaced. The 30 days are
// counted as 720 hours: adding days to a timestamptz depends on the session's
// time zone, so a restore under another zone could reject rows it accepted.

/** Thirty days (720 hours) after `from`. */
const retention = (from: string) => sql.raw(`${from} + interval '720 hours'`);

/**
 * A deleted tape, song, track, or photo, as a snapshot of its rows
 * (`payload`, in the shape `payload_version` names). `subject_id` is the
 * deleted row's original id, which a restore reuses. Expired once
 * `purge_after` has passed: from then on it cannot be restored, and the
 * daily purge deletes it.
 */
export const trashItems = pgTable(
  "trash_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    subjectId: uuid("subject_id").notNull(),
    label: text("label").notNull(),
    payload: jsonb("payload").notNull(),
    payloadVersion: smallint("payload_version").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    purgeAfter: timestamp("purge_after", { withTimezone: true })
      .notNull()
      .default(retention("now()")),
  },
  (t) => [
    uniqueIndex("trash_items_subject_key").on(t.kind, t.subjectId),
    index("trash_items_purge_after_idx").on(t.purgeAfter),
    index("trash_items_deleted_at_idx").on(t.deletedAt),
    check(
      "trash_items_kind",
      sql`${t.kind} in ('mixtape', 'song', 'track', 'image')`,
    ),
    check(
      "trash_items_label_length",
      sql`char_length(${t.label}) between 1 and 500`,
    ),
    check(
      "trash_items_payload_object",
      sql`jsonb_typeof(${t.payload}) = 'object'`,
    ),
    check("trash_items_payload_version", sql`${t.payloadVersion} > 0`),
    check(
      "trash_items_retention",
      sql`${t.purgeAfter} > ${t.deletedAt} and ${t.purgeAfter} <= ${retention(t.deletedAt.name)}`,
    ),
  ],
);

/**
 * The bytes of a deleted photograph, exactly as they were in `image_files`.
 * They belong to their trash item and go with it.
 */
export const trashFiles = pgTable(
  "trash_files",
  {
    trashItemId: uuid("trash_item_id")
      .primaryKey()
      .references(() => trashItems.id, { onDelete: "cascade" }),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt,
  },
  (t) => [
    check(
      "trash_files_content_type",
      sql`${t.contentType} in ('image/jpeg', 'image/png')`,
    ),
    check(
      "trash_files_byte_size",
      sql`${t.byteSize} between 1 and 4194304 and ${t.byteSize} = octet_length(${t.bytes})`,
    ),
  ],
);

/**
 * The photographs a trash item still uses (a deleted tape's cover and
 * support photo). While the item exists, PostgreSQL refuses to delete them.
 */
export const trashImageRefs = pgTable(
  "trash_image_refs",
  {
    trashItemId: uuid("trash_item_id")
      .notNull()
      .references(() => trashItems.id, { onDelete: "cascade" }),
    imageId: uuid("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "restrict" }),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.trashItemId, t.imageId] }),
    index("trash_image_refs_image_idx").on(t.imageId),
  ],
);

/**
 * A text's earlier wording, kept when a save replaced or emptied it: a site
 * text's body (`subject_key` is its key), a tape's texts (its id), or a
 * track's note (its id). `label` names the field as it was then.
 */
export const textVersions = pgTable(
  "text_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subject: text("subject").notNull(),
    subjectKey: text("subject_key").notNull(),
    field: text("field").notNull(),
    label: text("label").notNull(),
    body: text("body").notNull(),
    replacedAt: timestamp("replaced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    purgeAfter: timestamp("purge_after", { withTimezone: true })
      .notNull()
      .default(retention("now()")),
  },
  (t) => [
    index("text_versions_subject_idx").on(
      t.subject,
      t.subjectKey,
      t.field,
      t.replacedAt,
    ),
    index("text_versions_purge_after_idx").on(t.purgeAfter),
    check(
      "text_versions_subject_field",
      sql`(${t.subject} = 'site_text' and ${t.field} = 'body')
        or (${t.subject} = 'mixtape' and ${t.field} in ('reflection', 'description', 'pull_quote', 'pull_quote_credit', 'detail_caption'))
        or (${t.subject} = 'track' and ${t.field} = 'note')`,
    ),
    check(
      "text_versions_subject_key",
      sql`(${t.subject} = 'site_text' and ${t.subjectKey} ~ '^[a-z0-9]+(\\.[a-z0-9_]+)+$')
        or (${t.subject} in ('mixtape', 'track') and ${t.subjectKey} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')`,
    ),
    check(
      "text_versions_label_length",
      sql`char_length(${t.label}) between 1 and 300`,
    ),
    check(
      "text_versions_body_length",
      sql`char_length(${t.body}) between 1 and 20000`,
    ),
    check(
      "text_versions_retention",
      sql`${t.purgeAfter} > ${t.replacedAt} and ${t.purgeAfter} <= ${retention(t.replacedAt.name)}`,
    ),
  ],
);
