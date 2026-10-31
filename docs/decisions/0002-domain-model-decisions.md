# ADR 0002: Domain Model Decisions

- **Status:** Proposed. Awaiting owner approval.
- **Date:** 2026-10-31
- **Scope:** Journals, music catalog, translations, publication, deletion, track reflections, editor storage, and public URLs.

This ADR records domain decisions proposed by the owner during the M0 review. [ADR 0001](0001-modular-monolith.md) (modular monolith) is an accepted architectural decision. This ADR is not accepted yet.

[Data Model](../data-model.md), [Product](../product.md), and [Security](../security.md) are written to match this proposal and label it as pending. **No migration may encode these decisions until the status is Accepted.** Once the owner approves, change the status, the date, and the index in [`decisions/README.md`](README.md). If the owner changes a decision, record the change here before approval, or in a superseding ADR after it.

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
2. At most one journal per album and one per artist is **featured**. The featured journal is the one used for public presentation: listings and the album or artist page. If the featured journal is not publicly visible, public pages fall back to the most recently published journal for that album or artist.
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

## Consequences

**Positive**

- Long-term writing about the same music is possible without overwriting earlier writing.
- Catalog changes (new editions, archiving) cannot corrupt or delete writing.
- Publication is explicit at every level (language version, track reflection), which matches the privacy goal.
- Public URLs stay stable, and old links keep working.

**Negative and costs**

- The public read path is more complex: the predicate covers both the language version and per-track authorization. It must be implemented once and covered by tests ([Security](../security.md#publication-predicate)).
- The approved V4.4 screens do not show some controls these decisions require. These are listed as design gaps in [Design System](../design-system.md#design-gaps-from-adr-0002). They need the owner's design approval and are not redesigned in M0.
- V4.4 copy ("gone in 30 days") overstates current behavior while automatic purge is disabled (D4.4).

## Still open after this ADR

- Whether a slug is released when an entry is permanently deleted.
- How enum values are represented in PostgreSQL: `text` with `CHECK` constraints, or native enums.
- The exact fallback order when no journal for an album is publicly visible in the reader's interface language.
