# ADR 0009: The Public Music Collection

- **Status:** **Proposed.** It is not accepted, and it changes nothing yet. Until the owner accepts it, the existing contract holds word for word: [Security § Publication predicate](../security.md#publication-predicate) ("Catalog metadata … public pages show it only in the context of publicly visible entries"), [ADR 0006](0006-publication-decision-and-acknowledgement.md) and its amendments A1 to A7, and gates G1 to G8. No code, schema, migration, data, hosting setting, or public surface changes because this file exists.
- **Date:** Proposed 2026-11-12. Revised the same day after the owner's review, and on 2026-11-13 with the owner's last five product decisions, all recorded in [Owner decisions](#owner-decisions-2026-11-12). **Narrowed on 2026-11-13 by the owner's decision to split the proposal:** gate G8's resolution, the lock model, the album a memory names, and residual risks R1, R4, R5, and R6 moved to **ADR 0010** (Catalog, Memory, and Publication Integrity, proposed in [draft PR #99](https://github.com/RaioViajante/refrain/pull/99)).
- **Scope:** Letting a reader browse selected catalog metadata (an album's title, artists, year, cover or fallback, tracklist, and durations) when no journal about the album is published, through an explicit, reviewed, confirmed listing by the author. It covers the schema, the visibility rule, the addresses and their lifecycle, listing and removal, artist pages, public surfaces in both languages, the switches, indexing, restore, and the tests. It does **not** cover publishing writing, hosting, data transfer, or enabling public reads anywhere.
- **Depends on ADR 0010.** A listed album is a shown catalog record (ADR 0010 § 1). **Implementing this ADR does not authorize opening the collection to the public** until ADR 0010 and the applicable gates (G1 to G8, deployment-gate items 6 and 7) are implemented and validated. ADR 0010's guards for listed albums are merge conditions of this ADR's listing command (§ 15, delivery order). "ADR 0010 § N" refers to that proposal; the link becomes relative when it merges.

## Context

**What exists** (`main` at `fd65134`):

- **Catalog metadata is public only beside published writing.** The predicate's closing rule says so, and every public read follows it: an album appears only through a served album journal, an artist page only while a served album journal credits the artist ([ADR 0006 A5](0006-publication-decision-and-acknowledgement.md#a5-artist-pages-open-only-through-a-confirmed-publication)), and memory pages show only the music they link.
- **Adding to the catalog never publishes anything** ([Product § Music catalog](../product.md#music-catalog)). Imports from MusicBrainz create private catalog records.
- **Gate G8 (C11) is open.** Catalog edits (an album or artist name, a track title, credits, edition details, tracklist order) change the wording of a public page without a confirmation.
  - A3 guards artwork. A5 guards photographs, credits that would open an artist page, and artist restores.
  - Renames, track titles, credit wording, and edition details are still unguarded.
  - The publication fingerprint does not bind catalog wording ([ADR 0006 § 2](0006-publication-decision-and-acknowledgement.md#2-the-disclosure), "Informational lines").
  - G8 cannot be waived ([ADR 0006 § 14](0006-publication-decision-and-acknowledgement.md#14-public-page-release-gates)).
- **Rights.** Covers ([Security § Deployment gate](../security.md#deployment-gate), item 6, read by the owner on 2026-11-08 to cover every hosted surface, including the private Studio, issue #82) and photographs (item 7) may not be shown on a hosted surface until the owner records the reviews. No switch enforces item 6 today.
- **#44.** The public album journal is not fully readable without JavaScript, and its footer language selector is hidden without it.
- **The local catalog** (the author's local database, read-only counts taken on 2026-11-12 for this ADR; not checkable from the repository): 22 albums, 21 artists, 219 track positions, 20 covers, and no artist photograph. Nothing is published.

**Forces.**

- A reader should be able to browse the collection before the author has written about it.
- Listing must be a deliberate act, never a side effect of an import, a journal publication, a restore, or a script.
- A collection page that changes its wording without a confirmation would widen G8. ADR 0010 closes G8; this ADR must not widen it, and the collection does not open before ADR 0010 is built and validated.
- No public surface may reveal that unpublished writing exists (ADR 0002, INV-3).
- The smallest change is preferred: no new service, no cache, no snapshot store, no new component.

### Owner decisions (2026-11-12)

(The heading keeps its date so links to it keep working; decisions 16 to 20 were added on 2026-11-13.)

1. An album may be listed publicly with no published journal.
2. Being in the private catalog never authorizes publication. Importing a release never makes it public. Each album needs its own listing confirmation in the Studio.
3. Every public listing requires the author's explicit review and confirmation.
4. Drafts, private texts, ratings, favourites, and reflections stay under the current rules.
5. A catalog-only page shows only authorized music metadata.
6. **Routes:** `/collection`, `/collection/<slug>`, `/pt/collection`, and `/pt/collection/<slug>`. **`/albums` stays reserved for published album journals.**
7. The author may adjust the proposed slug before the **first** listing, with review and validation. After that the slug stays stable.
8. No "not written yet" label on individual tracks of a collection page.
9. **Approved copy** for a collection page with no served journal:
   - EN: "Some words are still waiting to be written."
   - PT-BR: "Algumas palavras ainda esperam para ser escritas."
10. **Home:** a discreet "Collection" / "Coleção" section, with at most four listed albums, using the V4.4 identity and the existing album components.
11. When a published journal exists, the reader can move between the journal and the collection page in both directions, with **no automatic `308`**.
12. **The first public opening uses `noindex`.** It is lifted later only after review and the owner's authorization. Decision 20 extends it to every public surface.
13. No artist photograph is shown, **or can be chosen**, for an artist who is public only through the collection, in this first implementation.
14. The V4.4 design is not redesigned. The interface stays in English and Brazilian Portuguese, responsive, and readable without JavaScript.
15. No real data is imported into, or published on, the hosted database in this stage.

Added on 2026-11-13:

16. **Navigation:** "Collection" is **not** added to the header's sections. The collection is reached from the Home and from contextual links.
17. **Order of `/collection`:** the artist's name alphabetically, then the release year, then the release title. The order is deterministic, with a stable tie-break, and never depends on ratings, favourites, or journals (§ 11).
18. **Approved labels:**

    | Link | EN | PT-BR |
    | --- | --- | --- |
    | Home → collection | "View the collection" | "Ver a coleção" |
    | Collection page → published journal | "Read the journal" | "Ler o diário" |
    | Journal page → collection page | "Back to the collection" | "Voltar à coleção" |

    Decision 9's sentence is unchanged.
19. **Artists on the Home:** the Home's Artists section keeps showing only artists related to published journals. Artists public only through the collection appear on the collection's own pages and in the artists archive, under the approved predicate.
20. **Indexing at the first anonymous opening:** `noindex` on **every public surface**, not only the collection. Lifting it needs an explicit decision, an SEO review, and an update of the hosted-launch plan (§ 16). This ADR records requirements and dependencies only. Nothing is implemented now.
21. *(Moved to ADR 0010 on 2026-11-13, with the owner's choice for residual risk R1 and its seven conditions.)*

### Alternatives considered

| Alternative | Verdict |
| --- | --- |
| **Status quo:** catalog only beside published writing | Rejected. It does not meet decision 1. |
| **Implicit visibility:** every catalog album that is not archived is public | Rejected. It breaks decisions 2 and 3. |
| **A separate `catalog_listings` table** | Not chosen. It is equivalent to two columns, with one more join, and listings need no history rows. |
| **Addresses in the `/albums/<slug>` namespace** | Rejected, also by decision 6. Journal slugs live in `entry_slugs` ([ADR 0003 § 3](0003-relational-schema-conventions.md#3-published-slugs-stay-reserved-after-permanent-deletion)), so uniqueness across both tables would need a trigger. It would also change M3.1's resolution, `308`s, and G1 evidence. |
| **Chosen:** two columns on `albums`, a confirmed listing, and the `/collection` section; catalog wording on collection pages kept under review by ADR 0010 | The smallest change designed against the owner's decisions; it keeps uniqueness declared in PostgreSQL and leaves the journal routes untouched. The alternatives for closing G8 (a published snapshot, a confirmed catalog change) are ADR 0010's. |

## Decision

### 1. Terms

- **The collection:** the albums the author has listed.
- **A listed album:** `albums.collection_listed_at IS NOT NULL` and `albums.archived_at IS NULL`.
- **A collection page:** the public page of a listed album at `/collection/<slug>`. It shows catalog metadata only.
- **The collection archive:** `/collection`, the list of listed albums.
- **A shown catalog record:** defined in ADR 0010 § 1. A listed album, its credited artists, its reference edition, and that edition's tracks are shown records, whatever the public-reads switch says.

### 2. Schema

One migration, through [`/refrain-db-change`](../development.md#database-changes), adds two nullable columns to `albums`:

| Column | Meaning | Constraints |
| --- | --- | --- |
| `collection_listed_at timestamptz NULL` | When the current listing was confirmed. `NULL` means not listed. | `albums_collection_listed_requires_slug_check`: `CHECK (collection_listed_at IS NULL OR collection_slug IS NOT NULL)`; `albums_collection_archived_unlisted_check`: `CHECK (archived_at IS NULL OR collection_listed_at IS NULL)`, so an archive of a listed album made outside the commands is refused, and a later restore cannot relist anything |
| `collection_slug text NULL` | The collection address. It is set at the first confirmed listing, then **never changed or cleared**. | `albums_collection_slug_unique`: `UNIQUE (collection_slug)`; `albums_collection_slug_format_check`: `CHECK (collection_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(collection_slug) <= 80)`, the same form as `entry_slugs`. Constraints are named (ADR 0003) |

- **Both default to `NULL`.** Every existing album, and every future import, starts unlisted (decision 2). The migration sets no values: it lists nothing.
- **The application sets a slug only at the first listing,** so a slug is present exactly when the album was listed at least once. That plays the role of `was_published` in ADR 0003, without a history table. The database enforces "listed ⇒ slug" and "archived ⇒ unlisted" (so `archiveAlbum`, in one transaction under ADR 0010 § 3's locks, first clears the listing through the Publication function of § 14, then sets `archived_at`; the reverse order fails on the `CHECK`, which PostgreSQL checks immediately for each row; setting both columns in one `UPDATE` would also satisfy it). "Slug ⇒ listed once" and the slug's immutability are the commands' rules, as `entry_slugs`' retention is in ADR 0003, and an out-of-process writer is on G3's inventory (§ 14).
- **No other column changes.** Listing touches no foreign key and no authored table.
- **The smaller alternative was examined.** A single `collection_slug` whose presence means "listed" cannot keep the address stable across unlisting, so the second column is needed.

### 3. The visibility rule

The publication predicate gains one fragment, implemented once in [`predicate.ts`](../../src/modules/publication/predicate.ts) and used by every collection read:

> An album is **in the public collection** when `collection_listed_at IS NOT NULL`, `collection_slug IS NOT NULL`, and `archived_at IS NULL`.

**What a collection page may show** (a closed list):

- the album's title and `first_release_year`;
- its credited artists, in credit order, as `credited_as` or the artist's name;
- each one linked only when that artist has a public page;
- the reference edition's tracklist: disc, position, title, and `length_ms` formatted as minutes and seconds (nothing when the length is unknown, never an invented value);
- the cover, under § 12, or the existing fallback frame, with its source line;
- either the approved sentence (decision 9) or the link to a served journal of the album (several links once their copy is approved, § 11).

**What a collection page never shows or uses** (the Home's section may order by `collection_listed_at`, § 11, but shows no listing time):

- ratings, favourite marks, reflections, "still writing", margin notes, or excerpts;
- any count of entries;
- `collection_listed_at`;
- MBIDs, Image IDs, edition labels, countries, or any Studio-only value, as text. The cover's image source (under § 12) contains a release MBID and an Image ID; that address is the only place they appear;
- anything about an entry that is not served.

**The rule is additive and independent.**

- It does not change when an entry, a language version, a reflection, or a rating is public.
- Listing an album publishes no writing.
- Publishing a journal does not list its album.
- An album with a served journal and no listing keeps today's behaviour at `/albums/<slug>`.

### 4. No inference of unpublished writing

A public collection surface (the collection page, the collection archive, the Home's Collection section, an artist page's list of collection albums, their metadata, and the sitemap) is a function only of:

- catalog rows: the atoms of § 3, and the names and archived state of artists in the visible set (namesakes decide addresses);
- the listing columns;
- the set of **served** entries, and those entries' **served** language versions (address and `published_at`), and the served journals' `is_featured`, which decides the presented journal (§ 11, ADR 0010 § 4).

Every draft, private, deleted, restored, or unpublished-translation journal or memory, and every unpublished reflection, has **no effect** on any of them: the status, every header, the markup, the Flight data, and the visible text are identical to the state with no such entry (only the framework's per-request key is masked in the comparison).

In particular:

- **The approved sentence** depends only on whether a served journal exists. A listed album with a draft journal shows the sentence exactly as one with no journal does.
- **Listing state never depends on writing.** No command lists or unlists because of a journal's state, and the listing review is identical with or without unpublished writing.
- **Refusals that name writing** (ADR 0010 § 2) are Studio responses: authorized, `private, no-store`, never logged with their content, and never part of a public response.

This must be verified by tests (§ 15), not assumed.

### 5. Addresses and their lifecycle

- **Routes** (decision 6):
  - `/collection` and `/collection/<slug>`;
  - `/pt/collection` and `/pt/collection/<slug>` ([ADR 0008 § 2](0008-interface-localization.md#2-routes));
  - `/albums` and `/albums/<slug>` stay exactly as they are, for served album journals only.

  A collection slug and a journal slug may have the same text: they are different sections in different tables, so neither address can be mistaken for the other.
- **Decided by the proxy.** [`src/proxy.ts`](../../src/proxy.ts) decides `404`, before any page renders, in every request form (document, `_rsc`, `.rsc`, `.segments`, `/_next/data`, percent-encoded spellings), as for the existing sections. **No collection address ever answers `308`**, apart from the address normalization every section shares (the proxy's trailing-slash `308` and the framework's repeated-slash `308`), as INV-5's tests already exclude.

| Event | `collection_slug` | `collection_listed_at` | The address answers |
| --- | --- | --- | --- |
| **First listing** (slug `NULL`) | Proposed from the title by [`slug.ts`](../../src/modules/publication/slug.ts)'s normalization, with suffixes (`-2`, `-3`) for slugs that any album holds. Only an album listed at least once holds a slug, so a suffix reveals only catalog listing state (that another album was once listed), never writing; a never-listed album never causes one. A title that normalizes to nothing (for example, one written entirely in a non-Latin script) gets no proposal: the preview answers `slug_required`, and the author supplies one. **The author may replace a proposal** in the review (decision 7). It is validated (the `CHECK` form, at most 80 characters, not held by any album, listed or not, archived or not), shown in the disclosure, and bound into the token. Then it is written. | set | `200` |
| **Unlisting** | Kept | `NULL` | The identical unknown-address `404` |
| **Relisting** the same album | Kept. A slug input is refused (`slug_fixed`), and the review shows the existing address. | set | `200` at the **same** address |
| **Archiving** the album | Kept | Cleared in the same transaction | `404` |
| **Restoring** the album | Kept | Stays `NULL`. Restore never relists. | `404` until a confirmed relisting |
| **Renaming** the album | Kept: the slug does not follow the title | Unchanged (refused while shown, ADR 0010 § 2) | Unchanged |
| **Deleting** the album | Refused (`collection_address_reserved`) while a slug exists. Archive instead. | n/a | n/a |
| **Collision** | The preview refuses a slug held by another album (`slug_taken`). A concurrent first listing of the same slug waits for the other transaction at its `UPDATE`, then fails on the non-deferrable `UNIQUE` if that one committed (`slug_taken`). Nothing is written, and the author previews again. The `UPDATE` is the listing's last statement, after all of its locks, so this wait, which L4 does not otherwise cover, is designed not to form a cycle (ADR 0010's R6 tests must show it). | unchanged | unchanged |

- **Stable and never reused.** An album has one collection address for its whole life.
  - The application never changes or clears it.
  - `UNIQUE` keeps it from another album.
  - Refusing deletion keeps it reserved even after the album is no longer wanted.
- **No historical addresses.** Because a slug never changes, there are no previous addresses and no redirects to preserve. Changing an address would need its own decision, with `308` semantics that respect INV-5.
- **Out-of-process writers.** A deletion or edit through `psql`, a console, or a script could break these rules. They are on G3's inventory (§ 14).
- **A limit shared with journal slugs: restoring an older backup.** A backup taken before an album's first listing holds no slug for it. If such a copy were restored, that address would no longer be reserved, and another album could take it. The backup inventory deliberately carries no slugs (`ops/backup/inventory.sql`: "never titles, writing, or slugs"; [ADR 0007 § 3](0007-hosted-backups-and-retention.md#3-what-a-recovery-may-do): "identifiers and states, never content"), and journal slugs published after the backup have the same limit today. It is recorded as [R3](#residual-risks), not closed. Two mitigations:
  - a restored copy starts with nothing listed (§ 14);
  - the recovery review compares the restored albums with the newest available state before anything is listed again.

### 6. Listing: preview and confirmation

Listing follows ADR 0006's three-part model: a disclosure, a server-authenticated token, and the author's explicit act in the interface. **One album per confirmation** (decision 2). A bulk listing would need its own decision on how the acknowledgement is obtained ([ADR 0006 § 3](0006-publication-decision-and-acknowledgement.md#3-the-confirmation-token)).

- **`previewCollectionListing(db, author, { albumId, slug? })`** reads one consistent snapshot, takes no lock, and returns:
  - the album's state (never listed, unlisted, or listed);
  - the **collection address** that will be public: the existing slug, or for a first listing the proposed slug or the author's valid replacement;
  - every atom of § 3 exactly as the page will render it;
  - the **artist pages the listing would open** and the **public artist pages whose address would change**, as A5's review does. A page opened only by a listing is collection-only and shows no photograph (§ 8), so the listing binds none;
  - the **existing public artist pages that will show this album** (§ 8), whatever its journals' state, each with the album and its link (to its presented journal when one is served, otherwise to its collection page);
  - the **stored cover**, or "none", **whatever the cover switch says** (§ 12), and separately whether the switch currently shows it. With the switch off, the Studio shows no image, so the review shows the stored cover's source line and stored identifier as text; the item 6 review is the visual check;
  - the **served journal pages that will gain a link** to this collection page (§ 11);
  - the **served album journal and memory pages on which an artist credit will become a link**, because the listing gives that artist a page (§ 8). In practice these are memory pages: a served album journal's credited artists already have pages (A5), unless archived, and an archived artist gets none. The list keeps both kinds so that the disclosure does not depend on that reasoning. Pages are bound by entry id; the Studio title shown beside each is informational;
  - a confirmation token.

  It refuses:
  - an archived album;
  - an album with no reference edition or no tracks (`nothing_to_list`);
  - an invalid or taken slug, or a missing one where none can be proposed (`slug_required`);
  - a slug input for an album that already has one.
- **The token** reuses ADR 0006's machinery: an HMAC over claims, a key derived from the application secret through the Identity module, binding to the author's user and session, a 15-minute expiry on the database clock, no storage, never logged or echoed, and a refusal carries none. It differs in four ways:
  - its own prefix, `cc1.`;
  - its own HKDF `info` string, `refrain/confirmation-token/cc1` (matching `ct1`'s `refrain/confirmation-token/ct1`), under ADR 0006's rule that "a new use of the secret gets a new `info` string";
  - its purpose, `list_collection`;
  - the album id in place of the entry id and locale.

  Its claims are therefore: the prefix, the purpose, the user, the session, the album id, the expiry, and the fingerprint. It keeps `ct1`'s issued-at claim `i`. There is no counterpart of `ct1`'s `n` (`entries.version`): the album's `updated_at` plays that role inside the fingerprint.

  Its fingerprint is the SHA-256 of the canonical JSON of the album id, the operation, the slug, every atom of the disclosure, and the album's `updated_at` as the state stamp. The atoms are bound directly and are the primary guarantee: `updated_at` changes only when the `albums` row is updated, not on edits to credits, tracks, or artists, so it is a weak stamp on its own.
- **`listAlbumInCollection(db, author, { albumId, slug?, confirmation })`** runs in one transaction:
  1. Zod, then the token's form, key, MAC, purpose, actor, and album binding, all **before** any lock.
  2. The locks of ADR 0010 § 3.
  3. Refuse an archived album.
  4. The expiry, on `clock_timestamp()` after the locks.
  5. Re-apply the preview's refusals under the locks (`nothing_to_list`, `slug_fixed`, `invalid_slug`, `slug_required`). Then recompute the disclosure from the locked rows, and refuse `confirmation_stale` (fresh disclosure, no token) on any difference.
  6. Write `collection_listed_at = clock_timestamp()` if it was `NULL` (an already listed album keeps its time, so a reconfirmation does not reorder the Home's section), and `collection_slug` if it was `NULL`.

  An already listed album with an unchanged disclosure is a no-op.
- **Error codes** are ADR 0006's (`invalid_input`, `unavailable`, `confirmation_required`, `confirmation_invalid`, `confirmation_expired`, `confirmation_stale`), plus:
  - `album_not_found`, `album_archived`, `nothing_to_list` (unlisting answers only `invalid_input` and `album_not_found`; it needs no secret, so it never answers `unavailable`, like ADR 0006's unpublishing; unlisting an unlisted album is a no-op);
  - `invalid_slug`, `slug_required`, `slug_taken`, `slug_fixed`;
  - and, from Catalog's `deleteAlbum` rather than the listing commands, `collection_address_reserved` (beside Catalog's `cover_display_disabled`, § 12).

  Every failure writes nothing.
- **The explicit acknowledgement is mandatory**, as in ADR 0006 § 3:
  - the token exists only in the dialog's state and leaves only from its confirm control;
  - no code mints and consumes a token in one operation;
  - no autosave, retry, script, migration, or import lists an album.

### 7. Unlisting and takedown

These operations only take something away. Each **needs no token** (ADR 0006's owner decision R4, not ADR 0010's residual risk R4), the interface asks first, and each is always allowed, including while Cover Art Archive, Wikimedia Commons, or MusicBrainz is unreachable.

| Operation | Effect |
| --- | --- |
| `unlistAlbumFromCollection` | Clears `collection_listed_at` and keeps the slug (§ 5). Artist pages that existed only through this listing close. |
| Archive a listed album | Unlists it in the same transaction |
| Remove an album's cover | **Always allowed**, including while a journal is served, while the album is listed, and **while the album is archived** (archiving does not hide a served journal's page). **This amends A3**, which today refuses removal while a journal is public, and drops `removeAlbumArtwork`'s refusal of archived albums. Removal is the cover takedown path, and the fallback frame shows instead. It still refuses `review_stale`, writing nothing, when the stored cover changed since the author's view. |
| Remove an artist's photograph | Always allowed, as A5 already says |
| Unpublish or delete a journal or memory | Unchanged in effect (ADR 0006); an album journal's also takes the locks of ADR 0010 § 3 |

The atoms public after each operation are a subset of the atoms public before, with unchanged values (to be tested, § 15). The comparison runs over the **site-wide** set of atoms, not per-surface positions: **membership of capped lists** (the Home's at most four, A6's capped sections), **order**, and **counts** (`/artists`' counts, the Home's served counts) are derived values, like link order below, so a fifth album reaching the Home after an unlisting, or a count going down, adds nothing. The test also asserts that no count increases after a takedown. For this property, **the presence of a link** (an artist credit's link, a journal ↔ collection link) **is an atom of its own**, so a link that becomes plain text is a removal. **The approved sentence is not an atom.** It is fixed interface copy, shown exactly when a collection page has no journal links, so its reappearance after the last link goes is the removal of those links. The publication disclosure still mentions it, for the author's information. **The order and labels of journal links are not atoms either.** They are derived from atoms already public: which journals and versions are served, and their `published_at` (§ 11). So when an unpublication moves a link, or changes which journal is presented, nothing is added. The subset test compares the set of atoms, not the order, labels, or targets of journal links. There is **one recorded exception**, described next. (M3.7's current naming rule adds a second, ADR 0010's R1: a memory's named album depends on other albums' served journals. ADR 0010 § 4 is designed to remove it; R1 stays open until ADR 0010 § 4 is built and tested.) **The recorded exception:** unlisting, archiving an album or an artist, or unpublishing or deleting an album journal (A5's existing residual) can remove a namesake from the visible set. The other artist's derived address then changes from its suffixed form to the bare one ([`artist-address.ts`](../../src/modules/publication/artist-address.ts)), and the old address answers the unknown-address `404`; the bare address may earlier have identified a different artist. It is the A5 residual for derived artist addresses, recorded as [R2](#residual-risks): it reveals nothing private, and a stored artist slug would remove it.

### 8. Artist pages and photographs

- **The public artist set becomes A5's set plus the artists credited** (`album_artists`, never `track_artists`) on a listed album, while the artist is not archived.
- **Addresses** are still derived from names over the whole visible set ([`artist-address.ts`](../../src/modules/publication/artist-address.ts)). A listing can open pages and change a namesake's address, and both are in its disclosure and fingerprint (§ 6).
- **An artist page lists** the artist's served album journals (as today) and its listed albums, each linked to its collection page.
  - **A collection card on an artist page shows (a closed list):** the album's title, its year, its cover or the fallback frame (§ 12), and one link: to the album's presented journal when one is served (the album then shows as its journal card, unchanged), otherwise to its collection address. No track or written-track count, rating, or journal date. A listed album with a served journal does not show its collection address on the artist page.
  - **Each album appears once on an artist page.** "Album B on artist A's page" (its title, year, and cover or fallback) is **one atom**, present while B has a served journal crediting A or is listed crediting A. Its link leads to B's presented journal when one is served, otherwise to B's collection page. The link's target is derived, like § 7's journal links, and is not an atom. So unpublishing B's last served journal while B is listed moves the link to the collection page and drops the journal card's extra fields: nothing is added. A listed and journaled album's collection page is also reached from its journal page's "Back to the collection" link (§ 11).
  - **A collection-only artist's page renders** with no served album journal. Today [`public-artist.ts`](../../src/modules/publication/public-artist.ts) answers not-found when the artist has no served album, so this must change with the extended set.
  - The oracle and the HTTP suite must assert these (§ 15).
- **Lists of artists (amends A6, item 1):**
  - **Two named fragments** in [`queries.ts`](../../src/modules/publication/queries.ts):
    - **`publicArtists`, extended**, is the one source of visibility and of addresses. `publicArtistAddresses` is built from it. Every surface that shows an artist address takes the address from it: the artist page, album-journal credits, memory pages, the sitemap, address resolution, the collection pages, **and the `/artists` archive and the Home's Artists section**. Those two derive addresses over their own rows today ([`public-archives.ts`](../../src/modules/publication/public-archives.ts), [`public-home.ts`](../../src/modules/publication/public-home.ts)), so a namesake would get different addresses on different surfaces.
    - **`journalArtists`, A5's set unchanged** (credited on an album with a served journal), is used for exactly four decisions:
      - the publication disclosure's new list "Artist pages gaining a journal", to be added beside A5's existing lists in [`disclosure.ts`](../../src/modules/publication/disclosure.ts);
      - the Home's Artists section's membership (decision 19);
      - **which artist pages the sitemap lists**, until § 16's SEO review decides otherwise. Collection-only artist pages stay out of it (§ 11), while their addresses still come from the extended set;
      - **whether an artist page shows its photograph:** only for members of `journalArtists` (decision 13). Today [`public-artist.ts`](../../src/modules/publication/public-artist.ts) shows a stored photograph for every artist with a page, so this must change with the extended set. `setArtistPhoto`'s refusal for collection-only artists would be covered by the extended-set refusal.
    - **`artistsNewlyExposedByCredit` decides nothing new.** It refuses only on an album with a served journal, and ADR 0010 § 2 would refuse every credit change on such an album. It stays as defence in depth, with A5's wider entry locks (ADR 0010 § 3's `updateAlbum` row), but its outcome is ADR 0010 § 2's, and it is exempt from § 15's mutation rule;
    - **Every other exposure check uses the extended set:** `lockArtistRestoreExposure` (restore) and `lockArtistPublicExposure`, which wraps `isArtistOnPublicPage` (`setArtistPhoto`, rename; `archiveArtist` takes the locks only and decides nothing), in [`catalog-exposure.ts`](../../src/modules/publication/catalog-exposure.ts). Restoring an artist credited only on a listed album would otherwise open a collection-derived page with no review;
  - the `/artists` archive lists every artist with a page. It keeps today's counts (albums with a served journal, and served journals, shown when they differ, [`public-archives.ts`](../../src/modules/publication/public-archives.ts)) and **adds a listed-albums count**, which may overlap them: every listed album crediting the artist, whether or not a journal of it is served, so a journal's publication or unpublication never moves it. A collection-only artist shows no journal-album count (it would be zero) and only the listed-albums count. The Home's Artists section keeps A6's served counts, from journals only (decision 19);
  - the Home's Artists section keeps A6's choice, artists with served journals only (decision 19). A collection-only artist is never listed there, but its address is still computed over the extended set.
- **Collection-only artists** (decision 13): an artist whose only public page comes from the collection.
  - Their page shows **no photograph**, even when one is stored.
  - **None can be chosen.** `setArtistPhoto` refuses (`public_page`) for them, and the Studio offers no photograph control for them.
  - Removing a stored photograph stays allowed.
  - An artist whose page also comes from a served journal keeps A5's behaviour, which stays local-only until deployment-gate item 7 is recorded.
- **A5's publication disclosure decides membership against A5's own set (amends A5, part 1).** A collection-only artist has a page but shows no photograph. A publication that would give that artist a journal-derived page therefore lists it under **"Artist pages gaining a journal"**, with its photograph's file, version, credit, and license, or none, and binds it into the fingerprint, beside A5's "Artist pages that will open".
  - **Which artists** are listed is decided against A5's set: artists with a page from a served journal.
  - **Their addresses**, and those of any namesake, are still computed over the **extended** set, because that is what the pages answer. Without this, a photograph stored before the artist became collection-only (for example, chosen while a journal gave the artist a page that was later unpublished) would appear unreviewed, because the page already counts as open.
- **Restoring an artist** who would gain a page, or whose shown credit would change its rendering, is refused, as in A5, now also when the page would come from a listed album.

### 9. Gate G8 (moved to ADR 0010)

Listing makes an album a shown catalog record. The refusal of edits to shown records, the catalog atoms that join publication and listing fingerprints, and the transition for pages served before those rules ship are ADR 0010 § 2. The listing's own disclosure (§ 6) binds every atom of § 3, so a catalog edit between its preview and its confirmation makes it stale.

### 10. Locks and concurrency (moved to ADR 0010)

The lock order, the listing's, unlisting's, and archiving's locks, and the concurrency scenarios are ADR 0010 § 3. § 5's collision wait (a concurrent first listing of the same slug) stays here.

### 11. Public surfaces

Every surface reads only through the Publication module's reading entry point, is rendered per request in one pass (`instant = false`), is sent with `Cache-Control: no-store`, and prerenders nothing of the collection ([ADR 0006 § 11](0006-publication-decision-and-acknowledgement.md#11-public-reads-and-caches), A2). **The V4.4 design is not redesigned, and no new component is added:**

- **Collection page** (`/collection/<slug>`): the V4.4 album-journal layout without its writing.
  - It has the cover frame, title, artists, year, and the tracklist with durations.
  - It has no rating stars, favourite circles, or per-track "not written yet" labels (decision 8).
  - With no served journal, it shows the approved sentence (decision 9), once, in the place where the journal's writing would begin.
  - With served journals, the sentence is replaced by a "Read the journal" / "Ler o diário" link (decision 18) at a served `/albums/<slug>` address.
  - **Album journals have no titles of their own** (they take their title from the catalog), so several links that all read "Read the journal" would not say where each leads (WCAG 2.4.4). **How several links are told apart is a pending copy decision** ([Open decisions](#open-decisions)). The proposal is each version's published date beside the label, as `/albums` lists an album's other journals. **Until the owner approves it, a collection page shows one link**, to the journal presented for the album (ADR 0002, D1.2; `presentedJournals`), which is chosen from served versions only.
  - When several links are approved, they are ordered by the earliest `entry_texts.published_at` among each entry's **currently visible** versions (from `publicLanguageVersions`), oldest first, then by entry id. Neither `entries.first_published_at` nor any version's `first_published_at` is used: they keep the history of versions that are no longer public, which would let the order reveal an unpublished translation (§ 4). The order is the same in both languages and depends only on served versions. There is no excerpt, no rating, and no `308` (decision 11).
- **Album journal page** (`/albums/<slug>`): unchanged, plus **one "Back to the collection" / "Voltar à coleção" link to the album's collection page when the album is listed** (decisions 11 and 18). The link's presence depends only on the listing, never on other writing.
- **Collection archive** (`/collection`): every listed album once, linked to its collection page, built from the existing album-archive components.
  - **What a card shows (a closed list):** the album's title, its artists as credited (each linked only when the artist has a page), its year, its cover or the fallback frame (§ 12), and its collection address.
  - **Never:** a rating, a track or written-track count, a journal's date, links to other journals, or anything else the album-archive card carries for journals. An oracle and the HTTP suite assert the list.
  - **Order (decision 17), the same in both languages and for every reader**, never using ratings, favourites, journals, or the listing time:
    1. the first credited artist's name **as the page shows it** (`credited_as`, or the artist's name), which is how decision 17's "artist's name" is read. It is compared with the archives' existing `nameOrder` ([`public-archives.ts`](../../src/modules/publication/public-archives.ts): `Intl.Collator("en", { sensitivity: "base", numeric: true })`), in TypeScript. That ignores case and accents, does not depend on the database's collation or the reader's language, and needs no database object. Albums with no credit come last;
    2. `first_release_year`, ascending, with an unknown year last;
    3. the title, under the same collation;
    4. stable tie-breaks: the artist name and then the title in code-point order (PostgreSQL's `COLLATE "C"` on UTF-8; in TypeScript, a comparison of UTF-8 bytes such as `Buffer.compare`, not `<`, which compares UTF-16 code units), then the album id.

    The sort name is not used (ADR 0010 § 2).
- **Navigation (decision 16):** the header's sections are unchanged. "Collection" is not added. The collection is reached from the Home section, collection and artist pages, and the journal page's link.
- **`/albums` archive:** unchanged. It lists served album journals only (decision 6).
- **Artist pages and `/artists`:** § 8.
- **Home:**
  - **This amends A4 and A6:** the Home may also show a discreet section, "Collection" / "Coleção", with **at most four** listed albums, each card a **closed list** (title, artists as credited, each linked only when the artist has a page, year, cover or fallback, collection address; **never** a rating, a journal date, an excerpt, or a count), newest `collection_listed_at` first, then album id, using the Home's existing album cards, and a "View the collection" / "Ver a coleção" link to `/collection` (decision 18) in the pattern of the other sections' links.
  - The Home's Artists section is unchanged: only artists related to served journals (decision 19).
  - A4's switch-off rule is unchanged: with reads off, the section is empty and the Home is identical whatever the database holds.
- **Headers and routing:** `/collection/:path*` and `/pt/collection/:path*` join [`next.config.ts`](../../next.config.ts)'s public header rules (the public headers, with a CSP that allows the cover hosts, as A7 item 6 requires per section) and the proxy's list of sections.
- **Metadata:** title, description, canonical address, language alternates and `og:locale` as [ADR 0008 § 7](0008-interface-localization.md#7-metadata-and-alternates) requires, and Open Graph tags from the § 3 atoms only. No Open Graph image is generated, and no `og:image` points at the stored cover (§ 12).
- **Indexing:** every collection surface follows the site-wide rule of § 16 (decisions 12 and 20). Once `noindex` is lifted under § 16, collection surfaces are not added to the sitemap without their own decision.
- **Without JavaScript:**
  - every collection surface is complete in the first response, with no content inside a Suspense boundary that only a script reveals;
  - the footer language selector is visible on every one of them;
  - a browser test with JavaScript disabled is required for each.

  The album journal's own gap (#44) is fixed separately and stays a launch condition.
- **Responsiveness and accessibility** follow the existing pages: 390px and desktop, 44px targets, visible focus, correct `lang`.

### 12. Switches

- **Public reads (D4) are unchanged and cover every new surface.** With `REFRAIN_PUBLIC_READS_ENABLED` anything other than exactly `true`:
  - `/collection`, `/collection/<slug>`, and their `/pt` forms answer the identical unknown-address `404` in every request form;
  - the album journal page's link is never reached;
  - the Home's Collection section is empty.

  The static guard test and the HTTP switch-off matrix are extended to the new routes. The switch hides and never reveals.
- **Cover display: `REFRAIN_COVER_DISPLAY_ENABLED`, a new server-only switch.** It follows D4's form: never `NEXT_PUBLIC_`, read per request, enabled only by exactly `true`, and **off by default**.
  - **Off:** every surface (public pages, and the Studio, under the owner's 2026-11-08 reading in #82) renders the existing fallback frame, and no page asks a reader's or the author's browser to fetch from the Cover Art Archive. Stored `cover_url` values and their Image IDs are **kept**, not cleared, so the author's choices survive.
    - **The Studio's choosing screens** (the artwork chooser, the release review, and the edition list's cover previews of M3.2): the author's browser fetches nothing from the Cover Art Archive; the server may still list candidates through its adapter. **Until the owner decides** ([Open decisions](#open-decisions)), they show the candidates as text (type and Image ID) and **offer no choice**: choosing an image the author cannot see is not a choice, so it fails closed and the stored cover is kept.
    - **The commands enforce it, not only the interface** (a hidden control is not a control): with the switch off, `setAlbumArtwork`, and `importMusicRelease` given a `coverImageId`, refuse `cover_display_disabled` and write nothing.
    - Removal stays allowed (§ 7). Local development may turn the switch on and choose there.
  - **On a hosted deployment,** the owner turns it on only after recording the deployment-gate item 6 review. Local development may turn it on.
  - **It can only hide.** Listing and publication disclosures bind the **stored** cover whatever the switch says (§ 6, ADR 0010 § 2), so a cover shown after the switch is turned on is one that a review disclosed. **Limit:** journals published before ADR 0010 § 2's fingerprint rule is implemented did not bind their cover (ADR 0006 kept covers out of the fingerprint). ADR 0010 § 2's transition republishes every served entry through the new review, so after ADR 0010 §§ 2 to 4 deploy, no served journal has an unbound cover; the limit applies only if § 12 is deployed before ADR 0010 § 2. The item 6 review covers every cover the deployment would show in either case.
- **An Image ID is not a licence.** Choosing an image in the Studio, or the Cover Art Archive serving it, says which image the author prefers. It grants no right to display it publicly. The Cover Art Archive states that its images are "copyrighted by their respective copyright owners".
  - Only the owner's recorded item 6 review authorizes hosted display. No document, test, or agent may treat an Image ID approval, a successful fetch, or this switch's existence as that authorization.
  - The same holds for photographs and item 7.

### 13. Languages

[ADR 0006 A7](0006-publication-decision-and-acknowledgement.md#a7-the-pt-surfaces) applies in full:

- `/collection…` and `/pt/collection…` get the same visibility decision, the same `404`, and the same headers per section.
- Interface strings come from `src/i18n/` and `src/i18n/studio/`, and a missing functional translation is a defect.
- The approved sentence ships in both languages (decision 9).
- The three link labels are approved in both languages (decision 18). Any other new functional string still needs both languages before it ships.
- Catalog metadata is shown as stored and never translated.
- The interface language never decides what is listed.

### 14. Authorization, the Studio, and writers outside the commands

- **Commands and actions.** Every new command takes the `AuthorizedAuthor`. Every Server Action awaits `authorizeAuthor`, runs through `perform` (the exact `Origin`), and validates with Zod inside the command. Each action joins the HTTP suite's table, and the static scans cover the new files.
- **The Studio**, in English and Portuguese, uses existing Studio components and the M2.3 dialog pattern:
  - on each album's page, a *Public collection* panel: never listed, listed, or unlisted, and the address;
  - **Add to the public collection…**, a review dialog listing every atom of § 6, with the slug field only on a first listing;
  - **Remove from the public collection…**, behind a confirmation;
  - **the cover's remove control in every state** (§ 7): while a journal is served, while the album is listed or archived, when it is not linked to MusicBrainz, while the provider is unreachable, and with the cover switch off. Today it exists only inside the artwork chooser, which a status panel replaces in those states, so it must move out of the chooser;
  - refusals as in ADR 0010 § 2;
  - a "listed" marker in the albums list;
  - no photograph control for collection-only artists.

  There is no bulk control. Administrative controls never appear on public pages.
- **Module ownership.** The listing, unlisting, and preview commands belong to the **Publication** module. It owns public state and the confirmation tokens, and it writes only `albums.collection_listed_at` and `albums.collection_slug`, as the one checked writer of listing state (ADR 0006 § 9).
  - **The Studio reaches them through Catalog wrappers**, which call Publication through its `index.ts`, as Catalog already does for `catalog-exposure`. Presentation never imports Publication (ADR 0006 § 9). The wrappers join `no-publishing.test.ts`'s `WRAPPER_FILES`, the `cc1` token's carriers join `TOKEN_FILES`, and the preview action sits alone in its own file, imported only by its dialog (`PREVIEW_ACTION_IMPORTERS`), so § 6's "no listing without the dialog's confirm control" is checked statically.
  - `archiveAlbum` stays in Catalog and clears the listing through a Publication function, before it sets `archived_at` (§ 2), the way Catalog commands already ask [`catalog-exposure.ts`](../../src/modules/publication/catalog-exposure.ts) whether a record is shown.
  - Identity's signing functions gain the `list_collection` purpose and the `cc1` claims, with their own tests. Only the Publication module may import them.
- **The new writers** of `collection_listed_at` and `collection_slug` (the listing and unlisting commands, and the Publication function `archiveAlbum` calls) join ADR 0006 § 9's static writer scan by call target. Any other writer in production code fails it. The migration that adds the columns writes no value; migrations are outside that scan and on G3's inventory.
- **G3's inventory** gains both columns: scripts, migrations, fixtures (confined to `src/testing/` and the disposable database), manual access, CI, and restore.
- **Restoring a backup makes nothing public ([ADR 0007 § 3](0007-hosted-backups-and-retention.md#3-what-a-recovery-may-do)):**
  - `ops/backup/recovery-demote.sql` also sets `collection_listed_at = NULL` on every album, keeping the slugs;
  - `recovery-check.sql` fails while any album is listed;
  - both are tested.
- **No transfer lists anything.** Listing state is never copied between databases. A hosted database gets listings only through its own Studio's confirmed listing, after the gates allow it.

### 15. Required tests

On real PostgreSQL unless stated. Each one is a merge condition of the change that builds the rule, and each guard has a mutation that is seen to fail.

**Delivery order.** Nothing merged may widen G8, even locally. ADR 0010's §§ 2 to 4 merge first, as one change. §§ 2 to 5 (schema, predicate fragment, addresses) and § 14 (Studio, writers, restore scripts) merge no later than § 6's listing command; ADR 0010's rows for listed albums, and their tests, are merge conditions of the change that adds § 6. § 8 (the extended set, `journalArtists`, and the photograph rule) merges in or before that change. § 12's cover switch, § 7's always-allowed cover removal (with § 14's remove control in every state, or the gap noted), and § 16's `noindex` may merge earlier. § 5's routes count as a collection surface. Merging does not open the collection to the public (see the status).

- **Schema:**
  - the constraints of § 2, including an out-of-process `archived_at` update on a listed album being refused;
  - the migration on fresh and populated databases;
  - every existing album stays unlisted.
- **Oracle:**
  - an independent implementation of § 3 and § 8, compared with every collection read over the state matrix (listed or not × archived or not × journal and memory states × artist archived × namesakes);
  - the existing oracles updated to § 8 (A5's artist oracle), with their privacy cases unchanged.
- **No inference (§ 4):** for each public collection surface in both languages and every request form, the whole response for a listed album with each kind of unpublished writing (draft, private, deleted, restored, unpublished translation, unflagged reflection) equals the response with no writing.
  - In particular, once several links are approved (§ 11), two served journals J and K of a listed album, where J has a translation that was published **before** K's earliest visible `published_at` and later unpublished, and J's visible version was published after K's, give the same "Read the journal" order as without that history (K before J). A mutation back to `entries.first_published_at` fails this test.
- **Slug lifecycle (§ 5):**
  - every row of the table;
  - the author's slug accepted only on a first listing;
  - validation;
  - `slug_taken` for a slug held by a listed, unlisted, or archived album;
  - the concurrent first listing over real connections;
  - a collection slug equal to a journal slug resolves independently in both sections;
  - deleting a listed-once album refused.
- **Listing (§ 6):**
  - the disclosure equals the page;
  - token binding, `cc1` separated from `ct1` in both directions, expiry, and staleness after each kind of catalog edit and after another publication opens an artist page;
  - no mint-and-consume, and no listing without the dialog's confirm control (static and browser).
- **Takedown (§ 7):**
  - the next request answers `404` or the fallback frame;
  - cover removal allowed while a journal is served, for an archived album, and while the provider is down, at command level and, in the browser, reachable from the album's Studio page in each of § 14's states;
  - the subset property.
- **Artist pages (§ 8):**
  - restoring an artist credited only on a listed album is refused; setting a photograph and renaming decide from the extended set; a credit change on an album with a served journal is refused by ADR 0010 § 2;
  - a publication that gives a collection-only artist a journal page discloses it under "Artist pages gaining a journal" (not "Artist pages that will open"), with its stored photograph, and goes stale when that photograph changes;
  - addresses are equal across the artist page, the `/artists` archive, and the Home for namesakes split between the collection and journals;
  - an album appears once on an artist page; unpublishing a listed album's last served journal moves its link to the collection page and adds no atom; `/artists`' listed count does not move with journals;
  - a collection-only artist shows no photograph, and `setArtistPhoto` refuses for one;
  - a mutation that decides photograph display from the extended set instead of `journalArtists` fails;
  - a collection-only artist is absent from the sitemap's membership while a namesake's address there comes from the extended set. While § 16 holds, `/sitemap.xml` answers `404`, so this runs at the read function that builds the sitemap's list; a mutation that uses the extended set for sitemap membership fails;
  - the namesake exception of § 7 is the only non-subset outcome.
- **G8, the named album, and concurrency:** ADR 0010 § 5.
- **Switches:**
  - the HTTP switch-off matrix over the new routes in both language forms;
  - the Home identical with reads off;
  - the cover switch off means no Cover Art Archive URL in any response, Studio included (the artwork chooser, the release review, and the edition list's cover previews among them), and the fallback frame; with it off, the choosing screens offer no choice, and `setAlbumArtwork` and `importMusicRelease` with a `coverImageId` refuse `cover_display_disabled` with no row changed (integration tests).
- **Indexing:**
  - the tests of § 16, on every collection surface as on every other public surface.
- **Order and labels:**
  - the collection archive's order over names differing only by case and accents, unknown years, missing credits, and full ties. The order depends on Node's ICU version through `Intl.Collator`; it is not a privacy property, and the test pins the expected order so that an ICU upgrade that changes it is seen;
  - the same order in both languages;
  - the approved labels in both languages.
- **HTTP:**
  - `no-store` on every response class;
  - the identical `404` for unknown, unlisted, archived, and never-listed addresses;
  - no `308` from a collection address;
  - no collection data in the build output.
- **Browser:**
  - at desktop width and 390px, in English and Portuguese: the collection page, the collection archive, the Home section, an artist page, the journal ↔ collection links, and the Studio's listing and unlisting dialogs;
  - axe, keyboard, 44px targets, and no sideways scroll;
  - every collection surface with JavaScript disabled.
- **Restore:** the demote and check scripts clear and detect listings.

### 16. Indexing at the first anonymous opening (site-wide; requirements only)

Decision 20: when the site is first reachable anonymously, **every public surface carries `noindex`**. This section records the requirements and dependencies. **Nothing is implemented, and nothing changes now.**

**Surface classes.**

| Class | Members | Today (local) | Requirement while `noindex` holds | Must not change |
| --- | --- | --- | --- | --- |
| **Public content routes** | `/`, `/pt`, `/albums…`, `/artists…`, `/memories…`, `/collection…`, and their `/pt` forms, in every transport form (document, `_rsc`, `.rsc`, `.segments`, `/_next/data`) | No robots directive | `<meta name="robots" content="noindex">` in both root layouts' metadata, **and** `X-Robots-Tag: noindex` on every response | Statuses, bodies, `no-store`, A4's switch-off identity (the header is a constant, so it cannot depend on the database) |
| **`404` responses** | Every unknown, unserved, switch-off, or page-level not-found answer | One shared view, identical headers across reasons | The same `X-Robots-Tag: noindex` on **every** `404`, whatever its reason, set by the proxy's not-found headers and by the header rules alike | INV-5 and A7 item 5: identical status, body, and headers across reasons |
| **`308` redirects** | Previous journal slugs, address normalizations | `no-store` | `X-Robots-Tag: noindex` on the application's own `308`s. The framework's repeated-slash `308` stays outside application headers: the gap A2 and G2 already record | INV-5 |
| **Studio and authenticated routes** | `/studio/**`, `/pt/studio/**`, sign-in | `robots: noindex, nofollow` metadata ([`studio-layout.tsx`](../../src/app/studio/studio-layout.tsx)); `robots.txt` disallows them; private, `no-store` headers | Add `X-Robots-Tag: noindex, nofollow` to their private headers. `noindex` is **never** the access control: authorization is (Security § Authorization contract) | Authorization on every page and action, private headers, the sign-in behaviour |
| **Internal endpoints** | `/api/auth/**`, Server Action `POST`s | `robots.txt` disallows `/api/`; `/api/auth/**` shares the Studio's private headers ([`next.config.ts`](../../next.config.ts)) | `X-Robots-Tag: noindex, nofollow` on `/api/auth/**`, through the private headers it shares with the Studio, and `noindex` on other responses; the `Disallow` stays | The handler's origin checks and responses |
| **Technical files** | `/robots.txt`, `/sitemap.xml`, `/_next/static/**`, `/artwork/*` (the Home character, the `404` artwork), icons | `robots.txt` served with reads on; the sitemap lists served addresses | `robots.txt` keeps its `Disallow` lines and **does not disallow content routes**, so that crawlers can read `noindex`. It omits its `Sitemap:` line. `/sitemap.xml` answers the unknown-address `404` (a sitemap of `noindex` pages contradicts itself). Static files and images carry `X-Robots-Tag: noindex` | `robots.txt` and the sitemap under D4 when reads are off |
| **Platform responses** | Vercel Authentication's `302`, the provider's sign-in | Outside the application | Not controlled by the application. They disappear for anonymous readers when protection changes (S4) | Never relied on |

**Mechanism.**
- **Two fixed values, `noindex` for public surfaces and `noindex, nofollow` for the Studio,** defined once in server-only code.
  - **A catch-all header rule** is required, because today no rule covers unmatched paths or `/_next/static` ([`next.config.ts`](../../next.config.ts)).
  - Next.js keeps the **last** matching rule for a header key, so the catch-all must come **before** the Studio rule, and a test must assert the Studio's value.
- **Fixed in code,** read by the header rules ([`next.config.ts`](../../next.config.ts)), the proxy's own responses ([`src/proxy.ts`](../../src/proxy.ts)), the root layouts, `robots.txt`, and the sitemap.
- **Not an environment variable and not request-controlled,** so no configuration change, header, cookie, or query can lift it.
- **Constant on every response,** so it adds no difference between states, reasons, or languages.

**Tests,** required with the implementation:
- a static test that every header rule, the proxy's responses, and both root layouts apply the constant;
- the anonymous HTTP matrix asserting `X-Robots-Tag` on every class above, in both language forms and every request form, with the reads switch on and off;
- `404` headers still identical across reasons;
- `robots.txt` without a `Sitemap:` line and without a content `Disallow`;
- `/sitemap.xml` answering the identical `404`;
- a browser check of the meta tag with JavaScript disabled.

**Dependencies.**
- It must be **implemented and verified before S4's protection change** ([hosted-launch plan](../hosted-launch.md), stage S4, step 2).
- It is part of the evidence for G5 (`robots`, the sitemap) and for deployment-gate item 2 (redirect status and indexing reviewed).

**Lifting it** needs all of these, as one reviewed pull request:
- the owner's explicit, written decision;
- an SEO review: which surfaces to index, canonical addresses, language alternates, which sitemap entries return (including collection-only artist pages, which the extended `publicArtists` would add), and the collection's own decision (§ 11);
- an update of the hosted-launch plan.

## Residual risks

Each risk stays open until its criterion is met. Documenting a risk does not resolve it. R1 (a memory's named album), R4 (reductions and namesakes during a listing or a publication), R5 (late entries), and R6 (deadlocks) moved to ADR 0010 with the rules they concern.

| # | Cause | Consequence | Mitigation | Test evidence required | Criterion |
| --- | --- | --- | --- | --- | --- |
| **R2. Namesakes and derived artist addresses** | Artist addresses are derived from names over the visible set ([`artist-address.ts`](../../src/modules/publication/artist-address.ts)). A suffix depends on which namesakes are visible, and listing, unlisting, archiving, publishing, and unpublishing change that set. | An artist page's address can change without its own review. The old address answers the identical unknown-address `404` and inbound links break. **An address can also come to identify a different artist:** while two namesakes are visible neither has the bare name, so `/artists/x` can serve A1, then answer `404`, then serve A2 once A1's page closes, and an old link to A1 then shows another artist. Nothing private is revealed (the addresses come from public names). Additions disclose the change they cause (A5, § 6). Reductions (unlisting, archiving, unpublishing) do not. | Additions are bound by the listing and publication reviews. The definitive fix is a stored, retained artist slug (a migration and its own decision), the owner decision already open under G1 in the [hosted-launch plan](../hosted-launch.md) § 6 | The namesake matrix: addresses equal across the artist page, the `/artists` archive, and the Home; the old address answering a byte-identical `404` with no `308`; disclosures listing the address changes that listing and publication cause | **Blocks S4** until the owner records the G1 decision: either a stored artist slug, implemented and tested before S4, or the derived addresses accepted in writing in #47 with this evidence. It does not block accepting this ADR. |
| **R3. Slug reservation lost after restoring an older backup** | The reservation lives only in `albums.collection_slug`. The backup inventory carries no slugs (`ops/backup/inventory.sql`; [ADR 0007 § 3](0007-hosted-backups-and-retention.md#3-what-a-recovery-may-do)), so a backup taken before an album's first listing has no slug for it. | After such a restore, an address that was public is free. Another album could later be listed at it, and an old link would show a different album. Nothing private is revealed. Journal slugs published after a backup have the same limit today. | A restored copy starts with nothing listed (§ 14). **Proposed procedure:** on a restored database, no first listing is made until the owner has compared its collection slugs with those of the newest available state. Carrying collection slugs (public text) in the inventory would make this mechanical, but it needs an ADR 0007 amendment, because the inventory carries no slugs today. | `recovery-demote.sql` clears listings and keeps slugs; `recovery-check.sql` fails while any album is listed; if the inventory is amended, `reconcile` reports a collection slug missing from the candidate | **Blocks any first listing on a restored database** until the comparison is recorded, or the owner accepts the gap in writing for that recovery. It does not block S4 by itself: no hosted backup exists yet, and G6 is open. It does not block accepting this ADR. |
| **R7. A provider replaces an image under the same Image ID** | The Cover Art Archive serves the image. Refrain stores only its address. | A reader could see an image the author never reviewed | The cover switch (§ 12), the always-allowed takedown (§ 7), and the item 6 review | The cover switch tests (§ 15) | Part of the deployment-gate item 6 review; covers stay hidden on a hosted surface until it is recorded |

## Effect on existing decisions

None of these texts changes before acceptance. **At acceptance,** each gains a pointer marking the change as decided, not built; text that records implemented behaviour or verified evidence keeps its wording, with a note "superseded by ADR 0009 once built and tested", and new requirement rows (Security § Required tests) are added marked "not built". **In the pull request that builds and tests each part,** the text is rewritten; for ADRs, the build step adds amendment text under their *Amendments* and never rewrites their decisions. Changes that concern G8, locks, fingerprints, or the named album are ADR 0010's.

- **[Security § Publication predicate](../security.md#publication-predicate):** the closing sentence about catalog metadata becomes "…only in the context of publicly visible entries, **or of an album listed in the public collection** ([ADR 0009](0009-public-music-collection.md))". The required-tests list gains § 15's tests.
- **[Security](../security.md), the M3.2 row "Artwork cannot change while a published journal shows the album":** removal becomes always allowed (§ 7); a change of cover stays refused.
- **[Security § External providers](../security.md#external-providers):** removal becomes always allowed (§ 7), and the edition list's cover previews follow the cover switch (§ 12).
- **[Security § Deployment gate](../security.md#deployment-gate):** item 6 gains the collection as a surface, with `REFRAIN_COVER_DISPLAY_ENABLED` as the switch it says does not exist yet, and its removal procedure no longer says "unpublish first"; item 7 gains the collection-only rule of § 8; item 2 gains § 16's requirements.
- **[Security](../security.md), the implemented sitemap rows (M3.1, M3.7):** while § 16 holds, `/sitemap.xml` answers the identical `404`.
- **ADR 0006** (by a pointer under *Amendments*):
  - § 3 and L5: a third preview, `previewCollectionListing`, mints tokens (the `list_collection` purpose and the `cc1` family) and takes no lock;
  - § 5 (removals): the subset property is evaluated as § 7 defines it (site-wide; capped-list membership, order, counts, link targets, and the approved sentence are not atoms), and R2's derived-address change is an exception to "unchanged values", now also on unlisting and archiving an album;
  - § 9: the static scans gain `cc1` and the listing writers, and Catalog becomes a second wrapper module (§ 14);
  - § 10 and § 12: the new commands and error codes (§ 6's listing codes, Catalog's `collection_address_reserved` and `cover_display_disabled`; `slug_taken` and `invalid_slug` reused with a collection meaning);
  - § 14: D3 step 2 (restoring a backup) also unlists every album; G3's scope gains `albums.collection_listed_at` and `albums.collection_slug`;
  - A3: cover removal is always allowed, also for an archived album (§ 7), and a cover choice is refused `cover_display_disabled` while the cover switch is off (§ 12);
  - L4: a new wait beside its rules, a concurrent first listing of the same slug waiting on the `UNIQUE` at its last statement (§ 5);
  - A4 and A6: the Home's Collection section, including its order by listing time; A6, item 1: artist addresses over the extended set (§ 8);
  - A5 part 1 ("A publication is the one way a page opens"): a confirmed listing (`cc1`) becomes a second way, its review disclosing and binding the pages (§ 6); and A5's public artist set grows, its disclosure is computed against its own set, and no photograph is chosen or shown for a collection-only artist (§ 8).
- **[ADR 0007 § 3](0007-hosted-backups-and-retention.md#3-what-a-recovery-may-do):** the recovery demotion also unlists.
- **[ADR 0003 § 3](0003-relational-schema-conventions.md#3-published-slugs-stay-reserved-after-permanent-deletion):** a pointer to a second, album-scoped slug reservation, `albums.collection_slug`, playing `was_published`'s role (§ 2).
- **[ADR 0008 § 2](0008-interface-localization.md#2-routes):** a pointer to the new `/collection` and `/pt/collection` routes (§ 5).
- **[Product](../product.md) § People and § Two experiences, and [`AGENTS.md`](../../AGENTS.md) § 1:** "the public can read only explicitly published entries", "Only published writing appears", M3.5's "never because of a catalog record", and A5's "the only way an artist page opens" each gain the collection, a public surface that is not an entry, under decision 1.
- **[Hosted Launch](../hosted-launch.md):** stage S4 gains § 16's site-wide `noindex` as a precondition of its protection change; S4 step 5 expects the sitemap's identical `404` and `X-Robots-Tag: noindex` while § 16 holds; § 6 records R2 as a launch blocker under G1.
- **[Product](../product.md), [Data Model](../data-model.md), [Architecture](../architecture.md), [Design System](../design-system.md), [Roadmap](../roadmap.md), [Development](../development.md), [Hosted Backups](../hosted-backups.md), and `ops/backup/README.md`:** each records what is decided and, separately, what is built (Development's local setup for the cover switch; the recovery-demote step and its script row for unlisting).

## Consequences

- **Positive:**
  - Readers can browse the collection before any writing exists.
  - Every public listing is a recorded, reviewed act, and imports stay private.
  - The rights review of covers is decoupled from building pages, and a takedown is always possible.
  - No new service, cache, copy of the catalog, or component is added.
- **Negative:**
  - Collection addresses are permanent: an album that was listed can be archived but never deleted.
  - A second token family, with its own key derivation, needs its own tests.
  - Listed albums become shown records, so ADR 0010's refusals apply to them: fixing a typo on a listed album means unlisting it first.
  - With the cover switch off, a hosted Studio cannot choose covers until the owner decides otherwise (§ 12).
  - The switch is off by default **everywhere**, local development and tests included: covers approved for local development (M3.2, M3.4) disappear and local cover choices are refused until the developer sets it to `true`. The build pull request updates [Development](../development.md)'s local setup, the test environment, and the browser tests that expect a cover.
- **Unchanged:** the publication predicate for writing; every journal and memory route, slug, and `308`; `/albums` and its archive; INV-1 to INV-5; the `ct1` token; gates G1 to G8, which still block any hosted public page.

  Accepting this ADR closes no gate and authorizes no deployment, data transfer, switch change, lifting of `noindex`, or opening of the collection to the public.

## Open decisions

Product decisions 1 to 20 are settled. Decision 21 moved to ADR 0010. One reading still to be confirmed:

- **Decision 17's "artist's name":** § 11 reads it as the first credit as the page shows it (`credited_as`, or the artist's name). The owner confirms that reading at acceptance.

**Explicit approvals at acceptance,** one for each item under [Effect on existing decisions](#effect-on-existing-decisions) that changes an accepted rule: the Security predicate, deployment gate, and external-provider changes; each ADR 0006 item; ADR 0007 § 3; and the Product and AGENTS.md rules.

**Pending owner decision (Studio):**

- **Choosing covers on a hosted Studio while the cover switch is off.** Until decided, the choosing screens show candidates as text and offer no choice (§ 12).

**Pending Studio design review** (AGENTS § 6: nothing the V4.4 design does not show is presumed approved):

- § 14's *Public collection* panel, its two dialogs, and the albums list's "listed" marker;
- § 14's cover remove control outside the chooser, and § 12's text-only candidate screen with the cover switch off.

**Pending public design and copy review** (decisions 9, 10, and 18 approve only the sentence, the Home section, and the three link labels):

- the collection page as the V4.4 album-journal layout without its writing (§ 11);
- the collection archive's card (§ 11) and the artist page's collection card (§ 8);
- `/artists`' listed-albums count, its label, and how a collection-only artist's counts read (§ 8);
- the Home's Collection card variant (§ 11), and the placement of "Read the journal" and "Back to the collection";
- the empty states, with public reads on: `/collection` with nothing listed, and whether the Home's Collection section is hidden or shown empty (§ 11);
- the collection pages' metadata description copy (§ 11).

**Pending copy decision:**

- **How several "Read the journal" links on one collection page are told apart** (§ 11). Proposal: each version's published date beside the label. Until it is approved, a collection page shows one link, to the presented journal. Decision 11 (both directions) is then met only for the presented journal.

**Pending, not needed by this ADR:** whether a memory links its named album's collection page when the album is listed (ADR 0010 § 4). Until decided, a memory never links to a collection page.

**In [Residual risks](#residual-risks):** the G1 decision for R2, before S4; the recovery procedure for R3, and whether to amend ADR 0007's inventory.

## Revisit when

- A bulk listing is wanted. It needs its own acknowledgement decision.
- Addresses need to change. That needs a `308` design that respects INV-5.
- Artist photographs are wanted for collection-only artists, after deployment-gate item 7.
- Indexing is to be enabled: § 16's conditions.
