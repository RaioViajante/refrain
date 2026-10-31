# Data Model

**Status:** preliminary design. Not an applied schema and not a migration.

- The domain rules come from [ADR 0002](decisions/0002-domain-model-decisions.md), which is **Proposed** and awaits owner approval. No migration may encode them until it is accepted.
- Table and column names, types, and constraints must be validated again against the Drizzle implementation in M1.
- In M0, a hand-written DDL sketch of this model was run on a disposable PostgreSQL 17 instance with synthetic data. The results are under [Validation](#validation).

The model implements the rules in [Product](product.md). All SQL is PostgreSQL.

## Principles

1. **Catalog metadata and authored content are separate.** Catalog tables describe music, which is public and replaceable. Authored tables hold the author's writing, which is personal and irreplaceable. Writing references the catalog; the catalog never owns writing.
2. **Integrity lives in the database.** Primary keys, foreign keys, `NOT NULL`, `UNIQUE`, and `CHECK` constraints are declared in PostgreSQL. TypeScript and Zod validate input; they do not replace constraints.
3. **No cascade from catalog to writing.** Every foreign key from an authored table to a catalog table is `ON DELETE RESTRICT`. Cascades are used only inside the catalog, or from an entry to the rows it exclusively owns.
4. **Multi-row writes are transactional.** See [Transaction boundaries](#transaction-boundaries).
5. **Public reads use one predicate**, defined in [Security § Publication predicate](security.md#publication-predicate).

## Relationships

```text
Catalog (internal; cascades allowed)
  albums          1 ── N  album_artists  N ── 1  artists
  tracks          1 ── N  track_artists  N ── 1  artists
  albums          1 ── N  album_tracks   N ── 1  tracks      (which recordings belong to the album)
  albums          1 ── N  album_editions                     (v1: exactly one, the reference edition)
  album_editions  1 ── N  edition_tracks N ── 1  album_tracks (order, disc layout)

Authored content (internal; ON DELETE CASCADE from the entry)
  entries         1 ── N  entry_texts          (one per language; each has its own visibility)
  entries         1 ── N  entry_slugs          (current slug + reserved previous slugs)
  entries         1 ── N  entry_revisions      (later)
  entries         1 ── 1  album_journals | artist_journals | memories
  album_journals  1 ── N  track_reflections  1 ── N  track_reflection_texts
  memories        1 ── N  memory_music

Authored content → catalog (all ON DELETE RESTRICT)
  album_journals.album_id                     → albums
  artist_journals.artist_id                   → artists
  track_reflections (album_id, track_id)      → album_tracks
  memory_music.track_id | memory_music.album_id → tracks | albums
```

## Catalog

Every catalog table has `id uuid PRIMARY KEY`, `created_at`, `updated_at`, and `archived_at timestamptz NULL`. Archived records are hidden from catalog pickers and render as plain text inside writing ([Deletion and recovery](#deletion-and-recovery)).

| Table | Key columns | Constraints and notes |
| --- | --- | --- |
| `artists` | `name text NOT NULL`, `sort_name`, `kind` (person, group), `mb_artist_id uuid`, `photo_url`, `photo_credit`, `photo_license`, `photo_source_url` | `UNIQUE (mb_artist_id)`. `CHECK` that credit and license are present whenever `photo_url` is. |
| `albums` | `title text NOT NULL`, `first_release_year smallint`, `mb_release_group_id uuid`, `cover_url`, `cover_source` | The conceptual album (MusicBrainz release group). `UNIQUE (mb_release_group_id)`. Year `CHECK (BETWEEN 1800 AND 2100)`. |
| `album_artists` | `album_id`, `artist_id`, `position`, `credited_as` | `PK (album_id, artist_id)`. Album side cascades; artist side `RESTRICT`. |
| `album_editions` | `album_id`, `label`, `release_date date`, `country`, `mb_release_id uuid`, `is_reference boolean` | A specific release. `UNIQUE (mb_release_id)`. A partial unique index on `(album_id) WHERE is_reference` allows at most one reference edition. `UNIQUE (id, album_id)` supports the composite FK below. In v1, each album has exactly one edition, the reference edition. |
| `tracks` | `title text NOT NULL`, `length_ms`, `credit`, `mb_recording_id uuid` | A recording, which exists independently so a single can be linked from a memory. `credit` holds lines such as "by Leonard Cohen". `UNIQUE (mb_recording_id)`. |
| `track_artists` | `track_id`, `artist_id`, `position` | `PK (track_id, artist_id)`; same delete rules as `album_artists`. |
| `album_tracks` | `album_id`, `track_id` | **Membership:** the recording belongs to the album. `PK (album_id, track_id)`. Album side cascades; track side `RESTRICT`. Track reflections reference this table, so they never depend on an edition. |
| `edition_tracks` | `edition_id`, `album_id`, `track_id`, `disc_number`, `position` | **Order** within an edition. `PK (edition_id, track_id)`. `UNIQUE (edition_id, disc_number, position)`. FK `(edition_id, album_id)` → `album_editions (id, album_id)` and FK `(album_id, track_id)` → `album_tracks`, both cascading inside the catalog. |

Public track order is the reference edition's order. Adding another edition adds `album_editions` and `edition_tracks` rows, plus `album_tracks` rows for any new recordings. Existing journals are untouched. Reflections on recordings missing from a newly chosen reference edition remain valid and are listed after the ordered tracks.

## Authored content

### `entries` (supertype)

| Column | Notes |
| --- | --- |
| `id uuid PK` | |
| `kind text NOT NULL` | `CHECK (kind IN ('album_journal', 'artist_journal', 'memory'))`; `UNIQUE (id, kind)` for subtype FKs |
| `deleted_at timestamptz` | Set when the entry moves to Recently deleted. It is not a visibility state. |
| `version integer NOT NULL DEFAULT 1` | Optimistic concurrency for saves |
| `created_at`, `updated_at` | Shown as "Started" and "edited" |

The entry has no `status` column, because visibility belongs to each language version.

### `entry_texts` (language versions)

| Column | Notes |
| --- | --- |
| `entry_id` | FK → `entries`, `ON DELETE CASCADE` |
| `locale` | `CHECK (locale IN ('en', 'pt-BR'))` |
| `is_original boolean NOT NULL` | Partial unique index: at most one original per entry. `false` marks an author's translation, which is never generated. |
| `status text NOT NULL DEFAULT 'draft'` | `CHECK (status IN ('draft', 'private', 'published'))` |
| `published_at timestamptz` | `CHECK ((status = 'published') = (published_at IS NOT NULL))` |
| `first_published_at timestamptz` | Set once, the first time any version is published. It freezes the slug (ADR 0002, D7). |
| `title` | Memory title. Journals take their title from the catalog. |
| `opening` | Opening sentence (journals) |
| `body jsonb` | Tiptap (ProseMirror) document |
| `body_format_version smallint NOT NULL` | Version of the allowed node and mark schema, for export and migrations |
| `body_text text NOT NULL DEFAULT ''` | Plain-text projection of `body`, used for search and word counts |
| `margin_note` | Optional (album journals) |
| `updated_at` | |

`PRIMARY KEY (entry_id, locale)`. Every entry has exactly one original version. The creation transaction enforces that, because a constraint cannot require "at least one" row.

### Subtypes

Each subtype table carries a constant `kind` column, with a `CHECK`, and a composite FK `(entry_id, kind)` → `entries (id, kind)` with `ON DELETE CASCADE`. A memory row therefore cannot attach to an album-journal entry.

| Table | Columns | Constraints |
| --- | --- | --- |
| `album_journals` | `entry_id PK`, `album_id`, `is_featured boolean NOT NULL DEFAULT false`, `rating_half_steps smallint` | FK `album_id` → `albums`, `RESTRICT`. **Not unique per album** (ADR 0002, D1). A partial unique index on `(album_id) WHERE is_featured` allows at most one featured journal. `CHECK (rating_half_steps BETWEEN 1 AND 10)`; `NULL` means no rating. `UNIQUE (entry_id, album_id)` supports the track-reflection FK. |
| `artist_journals` | `entry_id PK`, `artist_id`, `is_featured` | FK → `artists`, `RESTRICT`. A partial unique index on `(artist_id) WHERE is_featured`. |
| `memories` | `entry_id PK`, `remembered_when text` | Free text ("a date, a season, a year") |

Ratings are integer half steps (`1` = 0.5 stars, `10` = 5 stars). Album and track ratings are separate columns, and neither is derived from the other.

### Track reflections

| Table | Columns | Constraints |
| --- | --- | --- |
| `track_reflections` | `id PK`, `album_journal_id`, `album_id`, `track_id`, `is_published boolean NOT NULL DEFAULT false`, `is_still_writing boolean NOT NULL DEFAULT false`, `is_favourite boolean NOT NULL DEFAULT false`, `rating_half_steps smallint`, timestamps | FK `(album_journal_id, album_id)` → `album_journals (entry_id, album_id)`, `ON DELETE CASCADE`, which keeps the album consistent with the journal. FK `(album_id, track_id)` → `album_tracks`, `RESTRICT`, so only tracks that belong to the album are accepted. `UNIQUE (album_journal_id, track_id)`. Rating `CHECK` as above. |
| `track_reflection_texts` | `track_reflection_id`, `locale`, `body jsonb`, `body_format_version`, `body_text` | `PK (track_reflection_id, locale)`, `ON DELETE CASCADE` |

- `is_published` is the explicit per-track publication authorization (ADR 0002, D5).
- `is_still_writing` records progress only.
- `is_favourite` and `rating_half_steps` are independent.

The displayed state is derived:

- **empty**: no text;
- **still writing**: the flag is set;
- **written**: otherwise.

### `memory_music`

| Column | Notes |
| --- | --- |
| `memory_id` | FK → `memories`, `ON DELETE CASCADE` |
| `position smallint NOT NULL` | `UNIQUE (memory_id, position) DEFERRABLE INITIALLY DEFERRED`, so items can be reordered in one transaction |
| `track_id`, `album_id` | FKs, `RESTRICT`; `CHECK (num_nonnulls(track_id, album_id) = 1)` |

### `entry_slugs`

| Column | Notes |
| --- | --- |
| `kind`, `slug` | `PRIMARY KEY (kind, slug)`: unique across current *and* previous slugs of that kind |
| `entry_id` | Composite FK `(entry_id, kind)` → `entries (id, kind)`, `ON DELETE CASCADE` |
| `is_current boolean NOT NULL` | Partial unique index on `(entry_id) WHERE is_current`: one current slug per entry |
| `created_at` | |

Previous slugs remain as rows with `is_current = false` and redirect (308) to the current slug. Normalization, freezing, and 404 rules are in ADR 0002, D7.

### `entry_revisions` (later)

`entry_revisions (id, entry_id, locale, snapshot jsonb, created_at)` stores earlier states of one language version, for recovery. A revision belongs to its entry and is never shown or promoted as a separate journal (ADR 0002, D1). It is planned after the academic milestone. Until then, recovery relies on Recently deleted and database backups.

### Identity

Authentication tables are created and owned by the selected authentication library (planned: Better Auth). They live alongside the domain tables, and no domain table references them. Single-author enforcement is described in [Security](security.md).

## Deletion and recovery

| Action | Behavior | Mechanism |
| --- | --- | --- |
| Delete an entry | Moves to Recently deleted; hidden from public pages and from Desk listings | `UPDATE entries SET deleted_at = now()` |
| Restore an entry | Returns with each language version's previous status | `deleted_at = NULL`. Whether published versions return as private is a product choice, to be confirmed. |
| Permanent delete ("Delete now") | Explicit author action with its own confirmation | `DELETE FROM entries`, cascading only to rows the entry owns |
| Automatic purge | **Disabled** (ADR 0002, D4.4). Entries stay in Recently deleted past 30 days. | Enabled only after backups exist, a restore has been tested, and a tested purge job exists |
| Archive a catalog record | All writing stays; links render as plain text; re-importing restores the record | `UPDATE … SET archived_at = now()` |
| Hard-delete a catalog record | Only when nothing in the writing references it | `DELETE`; PostgreSQL raises a foreign-key violation otherwise |
| Remove music from a memory | Deletes only the link row | `DELETE FROM memory_music` |

## Transaction boundaries

Each item below is one transaction:

1. **Import from MusicBrainz**: upsert artists; insert the album, its reference edition, tracks, `album_artists`, `track_artists`, `album_tracks`, and `edition_tracks`.
2. **Create an entry**: `entries`, the original `entry_texts` row, the subtype row, and the initial `entry_slugs` row.
3. **Save an album journal**: language-version text, album rating, and every changed track reflection and text. The save checks `entries.version` and rejects a stale save instead of overwriting.
4. **Change visibility** of a language version: `status`, `published_at`, and on the first publish `first_published_at`, after verifying that the entry is not deleted.
5. **Feature a journal**: clear the previous featured journal and set the new one (the partial unique index enforces at most one).
6. **Change a published slug**: mark the old slug non-current and insert the new current slug.
7. **Reorder memory music** (deferred unique constraint).
8. **Permanent delete**: the entry and everything it owns.

External HTTP calls (MusicBrainz, artwork) happen **before** a transaction opens, never inside one.

## Representative SQL

These are the candidate queries for academic requirements AC-04 and AC-05 ([Requirements](requirements.md)). They also back real interface features.

**JOIN: albums with their credited artists** (Catalog, public Albums listing):

```sql
SELECT al.id, al.title, al.first_release_year, ar.name AS artist_name
FROM albums al
JOIN album_artists aa ON aa.album_id = al.id
JOIN artists ar       ON ar.id = aa.artist_id
WHERE al.archived_at IS NULL
ORDER BY al.title, aa.position;
```

**Aggregate: tracks written per album journal** (Desk, "4 of 10 tracks written"):

```sql
SELECT e.id, al.title,
       COUNT(trt.track_reflection_id) AS tracks_written,
       (SELECT COUNT(*)
          FROM edition_tracks et
          JOIN album_editions ed ON ed.id = et.edition_id
         WHERE ed.album_id = al.id AND ed.is_reference) AS track_count
FROM album_journals aj
JOIN entries e      ON e.id = aj.entry_id
JOIN albums al      ON al.id = aj.album_id
JOIN entry_texts o  ON o.entry_id = e.id AND o.is_original
LEFT JOIN track_reflections tr       ON tr.album_journal_id = aj.entry_id
LEFT JOIN track_reflection_texts trt ON trt.track_reflection_id = tr.id
                                    AND trt.locale = o.locale
                                    AND trt.body_text <> ''
                                    AND NOT tr.is_still_writing
WHERE e.deleted_at IS NULL
GROUP BY e.id, al.id, al.title;
```

A track counts as written when it has text in the original language and is not flagged "still writing", which matches the derived states above.

**Subquery: catalog usage** (Catalog, "used in 2 entries"):

```sql
SELECT al.id, al.title,
       (SELECT COUNT(*)
          FROM entries e
         WHERE e.deleted_at IS NULL
           AND (   e.id IN (SELECT aj.entry_id  FROM album_journals aj WHERE aj.album_id = al.id)
                OR e.id IN (SELECT mm.memory_id FROM memory_music mm  WHERE mm.album_id = al.id))
       ) AS used_in
FROM albums al
WHERE al.archived_at IS NULL;
```

The public read predicate is defined once, in [Security](security.md#publication-predicate).

## Validation

In M0, a DDL sketch of this model was run on a disposable PostgreSQL 17 container with synthetic data. The three queries above returned the expected results.

The constraints rejected:

- a hard delete of an album referenced by writing;
- an out-of-range rating;
- `published` without `published_at`;
- a subtype row attached to an entry of another kind;
- a reflection on a track that does not belong to the album;
- a second featured journal for the same album;
- a duplicate slug, including a reused previous slug;
- a memory link with both a track and an album.

They accepted:

- two journals for the same album;
- a translation that is private while the original is published;
- a reordered memory list (deferred unique constraint);
- a second edition added without touching existing reflections.

Permanently deleting an entry removed only the rows it owns. The sketch is not a migration, and the Drizzle schema must be verified again in M1.

## Open questions

1. Enum representation: `text` with `CHECK` constraints (shown here) or PostgreSQL enums through Drizzle `pgEnum`.
2. Whether published language versions return as private when an entry is restored.
3. Slug release after permanent deletion, and the featured-journal fallback order by interface language (ADR 0002, "Still open").
4. How the automatic purge will run once enabled: a scheduled job or an on-access check.
