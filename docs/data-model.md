# Data Model

**Status:** preliminary design. This is not an applied schema or a finished migration. Table and column names, types, and constraints must be validated against the user flows and the Drizzle implementation in M1. Changes to an accepted design are recorded as ADRs.

The model follows the rules in [Product](product.md). The SQL below is PostgreSQL. During M0, a hand-written DDL sketch of these tables was run on a disposable PostgreSQL 17 instance with synthetic data. The representative queries returned the expected results. These constraints rejected invalid writes: `RESTRICT` deletes, rating `CHECK`, the publication `CHECK`, the composite subtype and album-track FKs, and the memory-music `CHECK`. The deferred position constraint allowed reordering, and a purge cascaded only to owned rows. The sketch is not a migration. The Drizzle schema in M1 must be verified again.

## Principles

1. **Catalog metadata and authored content are separate.** Catalog tables describe music, which is public and replaceable. Authored tables hold the author's writing, which is personal and irreplaceable. Writing references the catalog. The catalog never owns writing.
2. **Integrity lives in the database.** Primary keys, foreign keys, `NOT NULL`, `UNIQUE`, and `CHECK` constraints are declared in PostgreSQL. TypeScript types and Zod schemas validate input; they do not replace constraints.
3. **No cascade from catalog to writing.** Every foreign key from an authored table to a catalog table is `ON DELETE RESTRICT`. Cascades are allowed only from an entry to rows it exclusively owns.
4. **Multi-row writes are transactional.** See [Transaction boundaries](#transaction-boundaries).
5. **Public reads use one filter.** Public queries return only rows where `status = 'published' AND deleted_at IS NULL`, through a single shared query path (see [Security](security.md)).

## Overview

```text
Catalog (internal relationships)
  artists         1 ── N  album_artists  N ── 1  albums
  artists         1 ── N  track_artists  N ── 1  tracks
  albums          1 ── N  album_tracks   N ── 1  tracks

Authored content (internal relationships, ON DELETE CASCADE)
  entries         1 ── N  entry_texts
  entries         1 ── 1  album_journals | artist_journals | memories
  album_journals  1 ── N  track_reflections  1 ── N  track_reflection_texts
  memories        1 ── N  memory_music

Authored content → catalog (all ON DELETE RESTRICT)
  album_journals.album_id                   → albums
  artist_journals.artist_id                 → artists
  track_reflections (album_id, track_id)    → album_tracks
  memory_music.track_id | memory_music.album_id → tracks | albums
```

## Catalog tables

All catalog tables have `id uuid PRIMARY KEY`, `created_at timestamptz NOT NULL`, `updated_at timestamptz NOT NULL`, and `removed_at timestamptz NULL` (see [Deletion and recovery](#deletion-and-recovery)).

| Table | Key columns | Constraints and notes |
| --- | --- | --- |
| `artists` | `name text NOT NULL`, `sort_name text`, `kind text` (person, group), `mb_artist_id uuid`, `photo_url`, `photo_credit`, `photo_license`, `photo_source_url` | `UNIQUE (mb_artist_id)`. Photo columns are all-or-nothing: `CHECK` that `photo_credit` and `photo_license` are present whenever `photo_url` is. |
| `albums` | `title text NOT NULL`, `release_year smallint`, `label text`, `mb_release_group_id uuid`, `mb_release_id uuid`, `cover_url text`, `cover_source text` | `UNIQUE (mb_release_id)`. `CHECK (release_year BETWEEN 1800 AND 2100)`. Represents one chosen release (edition); see open questions. |
| `album_artists` | `album_id`, `artist_id`, `position smallint`, `credited_as text` | `PRIMARY KEY (album_id, artist_id)`. `album_id` cascades from `albums` (catalog-internal); `artist_id` is `RESTRICT`. |
| `tracks` | `title text NOT NULL`, `length_ms integer`, `credit text`, `mb_recording_id uuid` | `credit` holds songwriter lines such as "by Leonard Cohen". `UNIQUE (mb_recording_id)`. A track exists independently of any album so that a single can be linked from a memory. |
| `track_artists` | `track_id`, `artist_id`, `position smallint` | `PRIMARY KEY (track_id, artist_id)`. Same delete rules as `album_artists`. |
| `album_tracks` | `album_id`, `track_id`, `disc_number smallint`, `position smallint` | `PRIMARY KEY (album_id, track_id)`. `UNIQUE (album_id, disc_number, position)`. `album_id` cascades; `track_id` is `RESTRICT`. This table is the authoritative track order. |

## Authored tables

### Entries (supertype)

Album journals, artist journals, and memories share visibility, language, deletion, and timestamps, so they share one `entries` table. Each kind has a subtype table keyed by `entry_id`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid PK` | |
| `kind` | `text NOT NULL` | `CHECK (kind IN ('album_journal', 'artist_journal', 'memory'))` |
| `status` | `text NOT NULL DEFAULT 'draft'` | `CHECK (status IN ('draft', 'private', 'published'))` |
| `original_locale` | `text NOT NULL` | `CHECK (original_locale IN ('en', 'pt-BR'))` |
| `slug` | `text NOT NULL` | Public URL segment |
| `published_at` | `timestamptz` | `CHECK ((status = 'published') = (published_at IS NOT NULL))` |
| `deleted_at` | `timestamptz` | Set when the entry moves to Recently deleted |
| `version` | `integer NOT NULL DEFAULT 1` | Optimistic concurrency for saves |
| `created_at`, `updated_at` | `timestamptz NOT NULL` | Shown as "Started" and "edited" |

Indexes: a partial unique index on `(kind, slug) WHERE deleted_at IS NULL`, and an index on `(status, published_at)` for public listings.

The subtype's kind must match `entries.kind`. The candidate enforcement: each subtype table carries a constant `kind` column and a composite foreign key to `entries (id, kind)`, which requires `UNIQUE (id, kind)` on `entries`. Validate during implementation.

### Entry texts (language versions)

| Column | Notes |
| --- | --- |
| `entry_id` | FK to `entries`, `ON DELETE CASCADE` |
| `locale` | `'en'` or `'pt-BR'` |
| `is_original` | `true` for the text in `entries.original_locale`; at most one per entry (partial unique index) |
| `title` | Memory title. Journals take their title from the catalog record. |
| `opening` | Opening sentence (journals) |
| `body` | `jsonb`: rich-text document (Tiptap JSON; format to be confirmed) |
| `body_text` | Plain-text projection of `body`, used for search and word counts |
| `margin_note` | Optional (album journals) |
| `updated_at` | |

`PRIMARY KEY (entry_id, locale)`. A row with `is_original = false` is an **author's translation**. It is never generated.

### Subtypes

| Table | Columns | Constraints |
| --- | --- | --- |
| `album_journals` | `entry_id PK`, `album_id`, `rating_half_steps smallint` | FK `album_id` to `albums`, `RESTRICT`. `CHECK (rating_half_steps BETWEEN 1 AND 10)`; `NULL` means no rating. `UNIQUE (album_id)` if one journal per album is confirmed. |
| `artist_journals` | `entry_id PK`, `artist_id` | FK to `artists`, `RESTRICT`. `UNIQUE (artist_id)` if one journal per artist is confirmed. |
| `memories` | `entry_id PK`, `remembered_when text` | Free text ("a date, a season, a year"). |

Ratings are stored as integer half steps (`1` = 0.5 stars, `10` = 5 stars) to avoid floating-point comparisons. Album and track ratings are separate columns with no derivation between them.

### Track reflections

| Table | Columns | Constraints |
| --- | --- | --- |
| `track_reflections` | `id PK`, `album_journal_id`, `album_id`, `track_id`, `rating_half_steps smallint`, `is_favourite boolean NOT NULL DEFAULT false`, `is_still_writing boolean NOT NULL DEFAULT false`, timestamps | FK `album_journal_id` to `album_journals`, `ON DELETE CASCADE`. Composite FK `(album_id, track_id)` to `album_tracks`, `RESTRICT`, so a reflection can only be about a track on that album. `UNIQUE (album_journal_id, track_id)`. Same rating `CHECK`. |
| `track_reflection_texts` | `track_reflection_id`, `locale`, `body jsonb`, `body_text text` | `PRIMARY KEY (track_reflection_id, locale)`, `ON DELETE CASCADE`. |

`track_reflections.album_id` duplicates `album_journals.album_id`. A second composite foreign key, `(album_journal_id, album_id)` to `album_journals (entry_id, album_id)`, would keep the two in sync. Validate whether that extra constraint is worth its complexity.

Displayed track state is derived, not stored:

- **empty** when there is no reflection text;
- **still writing** when `is_still_writing` is true;
- **written** otherwise.

Track reflections inherit the parent journal's visibility. See [Open questions](#open-questions).

### Memory music

| Column | Notes |
| --- | --- |
| `memory_id` | FK to `memories`, `ON DELETE CASCADE` |
| `position` | `smallint NOT NULL`; `UNIQUE (memory_id, position) DEFERRABLE INITIALLY DEFERRED` so items can be reordered in one transaction |
| `track_id`, `album_id` | FKs, `RESTRICT`. `CHECK (num_nonnulls(track_id, album_id) = 1)` |

### Identity

Authentication tables (users, sessions, accounts, verification) are created and owned by the selected authentication library (planned: Better Auth). They live alongside, not inside, the domain tables, and no domain table depends on them. Single-author enforcement is described in [Security](security.md).

### Revisions (later)

`entry_revisions (id, entry_id, locale, snapshot jsonb, created_at)` provides point-in-time recovery of writing. It is planned after the academic milestone; see [Roadmap](roadmap.md). Until then, recovery relies on Recently deleted and database backups.

## Deletion and recovery

| Action | Behavior | Mechanism |
| --- | --- | --- |
| Delete an entry | Moves to Recently deleted; hidden from the public site and from Desk listings | `UPDATE entries SET deleted_at = now()` |
| Restore an entry | Returns with its previous status | `deleted_at = NULL`. Restoring a published entry should probably return it as private; confirm. |
| Purge an entry | 30 days after deletion, or "Delete now…" after a second confirmation | `DELETE FROM entries`, cascading only to rows the entry owns: texts, subtype row, track reflections and their texts, memory music, revisions |
| Remove a catalog record | All writing stays; links to it render as plain text | **Proposed:** set `removed_at` (archive). FKs remain intact. Re-adding the same MusicBrainz record restores it. |
| Hard-delete a catalog record | Allowed only when nothing references it | `DELETE`; PostgreSQL rejects it with a foreign-key violation if any writing references it |
| Remove music from a memory | Deletes only the link row | `DELETE FROM memory_music` |

The alternative to archiving catalog records is detaching: nullable foreign keys plus text snapshots of titles. It was considered and is not proposed, because album journals and track reflections would need snapshots of album, artist, and track metadata. Confirm the choice with an ADR in M1.

## Transaction boundaries

Each of these runs in a single database transaction:

1. **Import from MusicBrainz**: upsert artists; insert the album, its tracks, `album_artists`, `track_artists`, and `album_tracks`.
2. **Create an entry**: `entries` + original `entry_texts` + subtype row.
3. **Save an album journal**: entry text, album rating, and every changed track reflection and text. Checks `version` and rejects stale saves instead of silently overwriting.
4. **Publish or unpublish**: `status` and `published_at` together, after verifying the entry is not deleted and has original text.
5. **Reorder memory music**: all position updates (deferred unique constraint).
6. **Purge**: delete the entry and everything it owns.

External HTTP calls (MusicBrainz, artwork) happen **before** the transaction opens, never inside it.

## Representative SQL

These are the candidate queries for academic requirements AC-04 and AC-05 ([Requirements](requirements.md)). They also back real interface features.

**JOIN: albums with their credited artists** (Catalog, public Albums listing):

```sql
SELECT al.id, al.title, al.release_year, ar.name AS artist_name
FROM albums al
JOIN album_artists aa ON aa.album_id = al.id
JOIN artists ar       ON ar.id = aa.artist_id
WHERE al.removed_at IS NULL
ORDER BY al.title, aa.position;
```

**Aggregate: tracks written per album journal** (Desk, "4 of 10 tracks written"):

```sql
SELECT e.id, al.title,
       COUNT(trt.track_reflection_id) AS tracks_written,
       (SELECT COUNT(*) FROM album_tracks at WHERE at.album_id = al.id) AS track_count
FROM album_journals aj
JOIN entries e  ON e.id = aj.entry_id
JOIN albums al  ON al.id = aj.album_id
LEFT JOIN track_reflections tr      ON tr.album_journal_id = aj.entry_id
LEFT JOIN track_reflection_texts trt ON trt.track_reflection_id = tr.id
                                    AND trt.locale = e.original_locale
                                    AND trt.body_text <> ''
WHERE e.deleted_at IS NULL
GROUP BY e.id, al.id, al.title;
```

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
WHERE al.removed_at IS NULL;
```

**Public filter** (every public query includes it):

```sql
WHERE e.status = 'published' AND e.deleted_at IS NULL
```

## Open questions

Each must be answered before or during the M1 migration work.

1. **One journal per album and per artist?** The design suggests one, which gives `UNIQUE (album_id)` and `UNIQUE (artist_id)`. Multiple dated journals per album would remove those constraints and change URLs.
2. **Release vs. release group.** Is an `albums` row a specific release (label, track list) or the abstract album? The design shows a label ("Columbia") and a fixed track list, which points to a specific release.
3. **Track reflection visibility.** In the approved Grace mockup, a "still writing" track still has an expand control on the public page, which implies its text is public with the label. Confirm that per-track hiding is not required. If it is, add a per-reflection visibility column and extend the public filter.
4. **Publishing translations.** Does an author's translation share the entry's status, or can it be published separately?
5. **Purge execution.** With no job queue in the architecture, how does the 30-day purge run: a scheduled job, or a check when the studio loads?
6. **Enum representation.** `text` + `CHECK` (shown above) versus PostgreSQL enums via Drizzle `pgEnum`. Decide based on how migrations behave when values are added.
7. **Rich-text storage.** Confirm the Tiptap JSON shape, the derivation of `body_text`, and the export format before the first real entries are written.
8. **Slug rules** for each kind, and how slugs behave across languages.
