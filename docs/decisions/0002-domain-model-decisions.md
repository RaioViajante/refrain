# ADR 0002: Domain Model Decisions

- **Status:** Accepted
- **Date:** 2026-10-31 (proposed and accepted the same day, during the M0 review)
- **Scope:** Journals, music catalog, translations, publication, deletion, track reflections, editor storage, and public URLs.

This ADR records the domain decisions the owner approved during the M0 review. It complements [ADR 0001](0001-modular-monolith.md), the modular monolith. [Data Model](../data-model.md), [Product](../product.md), [Security](../security.md), and [Design System](../design-system.md) implement these decisions. Any later change to a decision requires a superseding ADR.

## Context

The approved V4.4 design implies some domain rules but leaves others open:

- Each mockup shows one journal per album, but writing about music happens over years.
- The design shows a label and a fixed track list, but MusicBrainz separates the album (release group) from its editions (releases).
- The editor has an author-translation tab, but publication is shown only per entry.
- A track's "still writing" flag appears on the public page, which mixes writing progress with publication.

These must be settled before the first migration, because they shape keys, uniqueness, and the public read path.

## Decisions

### D1. Journals

1. An album or artist may have **several independent journals** written over time. Each is its own entry with its own visibility, language versions, and deletion state.
2. At most one journal per album and one per artist is **featured**, selected explicitly by the author. Featuring a journal never changes its visibility. For a given album or artist *X* and reader interface language *L*, the journal presented publicly (on listings and on the album or artist page) is resolved deterministically:
   1. the featured journal, if it is publicly visible in any language;
   2. otherwise, the publicly visible journal with the most recent `published_at` among its visible language versions, with ties broken by the lowest entry `id`;
   3. otherwise, none: *X* has no public page content.

   *L* never changes which journal is chosen. It decides only which version of that journal is shown: the version in *L* if it is publicly visible, otherwise the original if it is visible, otherwise the remaining visible version.
3. **Revision history is separate from journals.** A revision is a recoverable earlier state of one entry. It is never presented as, or converted into, an independent journal. A new journal is always a new entry.

### D2. Music catalog

1. An **album** is the conceptual musical work, corresponding to a MusicBrainz *release group*.
2. Each album has one **reference edition**, a specific release that defines track order, disc layout, and label metadata.
3. Track reflections refer to an album and a **track (recording) that belongs to that album**, not to a position in an edition. Adding another edition later, or changing the reference edition, therefore never invalidates existing writing.
4. Only the reference edition is modelled and used in v1. A full editions feature (choosing editions, comparing track lists, bonus tracks) is out of scope until there is a real need.

### D3. Translations

1. Translations are **written by the author**. Personal writing is never machine-translated, in storage, rendering, export, or tooling.
2. **Each language version has its own visibility.** The original and a translation can be in different states: for example, the original published and the translation still a draft.
3. Interface localization (`en`, `pt-BR`) is independent of the language the writing is in.

### D4. Publication and deletion

1. Visibility has three distinct states: `draft`, `private`, `published`. Visibility is held per language version (D3).
2. Deletion is held separately, in `deleted_at` on the entry, and is never expressed as a visibility state.
3. Deleted entries are **recoverable for at least 30 days** from Recently deleted.
4. **Automatic permanent deletion stays disabled** until three things are in place: backups exist, a restore has been tested, and the purge behavior has been designed and tested. Until then, entries remain in Recently deleted past 30 days. Only an explicit, separately confirmed "Delete now" by the author removes them permanently.
5. A catalog record referenced by authored writing is **archived** (`archived_at`), never destructively deleted. Only unreferenced catalog records may be hard-deleted, and the database enforces this with `ON DELETE RESTRICT`.

### D5. Track reflections

1. **"Still writing" indicates writing progress, not publication permission.** It never makes a reflection public and never hides one.
2. A track reflection appears publicly only when it is **explicitly authorized for publication** by its own flag, *and* the parent journal's language version is published, *and* the entry is not deleted. Publishing a journal does not publish its track reflections.
3. The **favourite** flag and the **half-step rating** (0.5–5) are independent of each other, of the "still writing" flag, and of the album rating. None is derived from another.

### D6. Editor storage

1. Rich text is stored as **Tiptap (ProseMirror) JSON in PostgreSQL `jsonb`**, together with a format version and a plain-text projection used for search and word counts.
2. The allowed node and mark set stays limited to what converts losslessly to a portable format. **Export** produces Markdown with front matter for each language version, plus the original JSON. It is planned for after the academic milestone, but the storage constraints apply from the first migration.

### D7. Slugs and public URLs

1. Every entry has **one current public slug**, which is the same for all languages. The language is carried by the URL's locale segment, not by the slug.
2. **Normalization:**
   - Unicode NFKD decomposition, then removal of combining marks;
   - lowercase;
   - every run of characters outside `a–z0–9` becomes `-`;
   - leading and trailing hyphens are trimmed;
   - the result is limited to 80 characters.

   For example, "Saudade de março" becomes `saudade-de-marco`.
3. **Collision safety:** a slug is unique per entry kind across *current and previous* slugs, enforced by a database unique constraint. A collision gets a numeric suffix (`grace`, `grace-2`).
4. **Stability:** the slug may change freely until the entry is first published, and is fixed from then on. A later change is an explicit author action that keeps the old slug as a permanent redirect (HTTP 308) to the current one. Editing a title never changes a published URL implicitly.
5. Old slugs stay reserved and are never reassigned to another entry while the entry exists. A slug that resolves to an entry that is not publicly visible (draft, private, or deleted) returns 404, for both current and old slugs.

## Implementation invariants

These are requirements on the implementation. Each one must be covered by an automated test before the feature it governs ships. Public visibility itself is defined once, by the [publication predicate](../security.md#publication-predicate).

- **INV-1. Featured selection is unambiguous.** For every album or artist and every interface language, the resolution in D1.2 yields at most one journal, and the same inputs always give the same result. The database allows at most one featured journal per album and per artist.
- **INV-2. "Still writing" grants nothing.** Setting or clearing `is_still_writing` never changes whether a track reflection, its rating, or its favourite mark is public.
- **INV-3. No unpublished content through any public interface.** Public pages, route handlers, server actions reachable without a session, metadata, sitemaps, feeds, search, and caches never return or reveal:
  - an entry, or a language version of an entry, that fails the publication predicate;
  - an author's translation that is not itself published, including a link to it or a mention that it exists;
  - a track reflection, its text, rating, or favourite mark, that is not published.
- **INV-4. The recovery policy is described truthfully.** While automatic purge is disabled (D4.4), no interface text, documentation, or API response may say that deleted writing is permanently removed after 30 days. The V4.4 wording returns only once a tested purge mechanism is enabled.
- **INV-5. Redirects respect visibility.** A previous slug redirects (308) only when the entry it belongs to is publicly visible. Otherwise it returns 404, exactly as an unknown slug does. A redirect never reveals a current slug, title, or the existence of an entry that is not publicly visible.

## Consequences

**Positive**

- Long-term writing about the same music is possible without overwriting earlier writing.
- Catalog changes (new editions, archiving) cannot corrupt or delete writing.
- Publication is explicit at every level (language version, track reflection), which matches the privacy goal.
- Public URLs stay stable, and old links keep working.

**Negative and costs**

- The public read path is more complex: the predicate covers both the language version and per-track authorization. It must be implemented once and covered by tests ([Security](../security.md#publication-predicate)).
- The V4.4 studio screens lack some controls these decisions require. The intended controls are specified in [Design System § Writing Studio controls](../design-system.md#writing-studio-controls-for-adr-0002). They are studio-only and use existing V4.4 components. The public design is unchanged.
- Until purge is enabled, the V4.4 delete copy is replaced with accurate interim wording (INV-4).

## Still open after this ADR

These do not affect the accepted decisions. They are settled during M1 and M2.

- Whether a slug is released when an entry is permanently deleted.
- How enum values are represented in PostgreSQL: `text` with `CHECK` constraints, or native enums.
- Whether published language versions return as private when a deleted entry is restored.
