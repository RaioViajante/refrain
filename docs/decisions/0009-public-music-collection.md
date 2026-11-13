# ADR 0009: The Public Music Collection

- **Status:** **Proposed.** It is not accepted, and it changes nothing yet. Until the owner accepts it, the existing contract holds word for word: [Security § Publication predicate](../security.md#publication-predicate) ("Catalog metadata … public pages show it only in the context of publicly visible entries"), [ADR 0006](0006-publication-decision-and-acknowledgement.md) and its amendments A1 to A7, and gates G1 to G8. No code, schema, migration, data, hosting setting, or public surface changes because this file exists.
- **Date:** Proposed 2026-11-12. Revised the same day after the owner's review, and on 2026-11-13 with the owner's last five product decisions and the owner's choice for residual risk R1 (decision 21), all recorded in [Owner decisions](#owner-decisions-2026-11-12).
- **Scope:** Letting a reader browse selected catalog metadata (an album's title, artists, year, cover or fallback, tracklist, and durations) when no journal about the album is published, through an explicit, reviewed, confirmed listing by the author. It covers the schema, the visibility rule, the addresses and their lifecycle, listing and removal, artist pages, the catalog-wording gate G8, locks, public surfaces in both languages, the switches, indexing, and the tests. It does **not** cover publishing writing, hosting, data transfer, or enabling public reads anywhere.

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
- **The local catalog** (read-only counts, 2026-11-12): 22 albums, 21 artists, 219 track positions, 20 covers, and no artist photograph. Nothing is published.

**Forces.**

- A reader should be able to browse the collection before the author has written about it.
- Listing must be a deliberate act, never a side effect of an import, a journal publication, a restore, or a script.
- A collection page that changes its wording without a confirmation would widen G8, which this ADR must close rather than widen.
- No public surface may reveal that unpublished writing exists (ADR 0002, INV-3).
- The smallest change is preferred: no new service, no cache, no snapshot store, no new component.

### Owner decisions (2026-11-12)

(The heading keeps its date so links to it keep working; decisions 16 to 21 were added on 2026-11-13.)

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
21. **Residual risk R1: option (a), as a direction.** The album a public memory names must not depend on publishing or unpublishing other journals, and must stay stable and predictable. The owner set seven conditions, which § 17 is written against:
    1. no private memory or draft becomes public through this change;
    2. no album of the private catalog is exposed automatically;
    3. the named album's identity is part of the published memory's explicit review;
    4. another journal's publication cannot silently change the named album;
    5. taking content down reveals nothing private and creates no unauthorized public address;
    6. ADR 0006's guarantees, the publication predicates, and the protections against concurrent changes are preserved;
    7. if option (a) needed a new product decision about which metadata a public memory may show, it would be recorded as pending, and the work would stop before presuming authorization.

    G8 is not weakened to resolve R1.

### Alternatives considered

| Alternative | Verdict |
| --- | --- |
| **Status quo:** catalog only beside published writing | Rejected. It does not meet decision 1. |
| **Implicit visibility:** every catalog album that is not archived is public | Rejected. It breaks decisions 2 and 3. |
| **A published snapshot:** a frozen JSON copy of what was reviewed, which public pages read | Not chosen. It closes G8 by construction for the collection only, and adds a second copy of the catalog and a second rendering path. It remains the fallback if the refusal guard proves too costly in use ([Revisit when](#revisit-when)). |
| **A confirmed catalog change:** a token-bound preview of the wording delta across every page that shows a record, then the edit | Not chosen for now. It would let a typo be fixed without taking pages down. But it needs a delta over every surface kind, its own token purpose, and its own tests: a larger change than refusal. It is the next step if § 9's cost is too high. |
| **A separate `catalog_listings` table** | Not chosen. It is equivalent to two columns, with one more join, and listings need no history rows. |
| **Addresses in the `/albums/<slug>` namespace** | Rejected, also by decision 6. Journal slugs live in `entry_slugs` ([ADR 0003 § 3](0003-relational-schema-conventions.md#3-published-slugs-stay-reserved-after-permanent-deletion)), so uniqueness across both tables would need a trigger. It would also change M3.1's resolution, `308`s, and G1 evidence. |
| **Chosen:** two columns on `albums`, a confirmed listing, the `/collection` section, a refusal guard for every shown catalog record, and catalog atoms bound into publication fingerprints | The smallest change that meets the owner's decisions, keeps uniqueness declared in PostgreSQL, leaves the journal routes untouched, and closes G8 in a way that tests can verify. |

## Decision

### 1. Terms

- **The collection:** the albums the author has listed.
- **A listed album:** `albums.collection_listed_at IS NOT NULL` and `albums.archived_at IS NULL`.
- **A collection page:** the public page of a listed album at `/collection/<slug>`. It shows catalog metadata only.
- **The collection archive:** `/collection`, the list of listed albums.
- **A shown catalog record:** any catalog row whose wording a public surface renders while public reads are on. That means:
  - a listed album, its credited artists, its reference edition, and that edition's tracks;
  - an album with a served album journal, its credits, its reference edition (including the label the journal page shows), and its tracks;
  - every album and track linked from a served memory, the artists credited on them (`album_artists` for a linked album, `track_artists` for a linked track), and **every album that contains a linked track**, called a **containing album** of that memory: under § 17 a memory page would name one of them for the track, the earliest by year, code-point-ordered title, and id, whatever any entry's state (§ 17; today [`memory-music.ts`](../../src/modules/publication/memory-music.ts) still prefers an album with a served journal, which is [R1](#residual-risks)), so adding the track to an album, or renaming or re-dating any album that contains it, can change the memory page;
  - every artist with a public page.

  "Shown" is computed only from Publication fragments (§ 3).

### 2. Schema

One migration, through [`/refrain-db-change`](../development.md#database-changes), adds two nullable columns to `albums`:

| Column | Meaning | Constraints |
| --- | --- | --- |
| `collection_listed_at timestamptz NULL` | When the current listing was confirmed. `NULL` means not listed. | `albums_collection_listed_requires_slug_check`: `CHECK (collection_listed_at IS NULL OR collection_slug IS NOT NULL)`; `albums_collection_archived_unlisted_check`: `CHECK (archived_at IS NULL OR collection_listed_at IS NULL)`, so an archived album is never listed, even after an archive made outside the commands, and a later restore cannot relist it |
| `collection_slug text NULL` | The collection address. It is set at the first confirmed listing, then **never changed or cleared**. | `albums_collection_slug_unique`: `UNIQUE (collection_slug)`; `albums_collection_slug_check`: `CHECK (collection_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(collection_slug) <= 80)`, the same form as `entry_slugs`. Constraints are named (ADR 0003) |

- **Both default to `NULL`.** Every existing album, and every future import, starts unlisted (decision 2). The migration sets no values: it lists nothing.
- **The application sets a slug only at the first listing,** so a slug is present exactly when the album was listed at least once. That plays the role of `was_published` in ADR 0003, without a history table. The database enforces "listed ⇒ slug" and "archived ⇒ unlisted" (so `archiveAlbum`, in one transaction under § 10's locks, first clears the listing through the Publication function of § 14, then sets `archived_at`; the reverse order fails on the `CHECK`, which PostgreSQL checks immediately for each row; setting both columns in one `UPDATE` would also satisfy it). "Slug ⇒ listed once" and the slug's immutability are the commands' rules, as `entry_slugs`' retention is in ADR 0003, and an out-of-process writer is on G3's inventory (§ 14).
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

- the catalog atoms of § 3;
- the listing columns;
- the set of **served** entries, and those entries' **served** language versions (address and `published_at`), and the served journals' `is_featured`, which decides the presented journal (§ 11, § 17).

Every draft, private, deleted, restored, or unpublished-translation journal or memory, and every unpublished reflection, has **no effect** on any of them: the status, every header, the markup, the Flight data, and the visible text are identical to the state with no such entry (only the framework's per-request key is masked in the comparison).

In particular:

- **The approved sentence** depends only on whether a served journal exists. A listed album with a draft journal shows the sentence exactly as one with no journal does.
- **Listing state never depends on writing.** No command lists or unlists because of a journal's state, and the listing review is identical with or without unpublished writing.
- **Refusals that name writing** (§ 9) are Studio responses: authorized, `private, no-store`, never logged with their content, and never part of a public response.

This is verified by tests (§ 15), not assumed.

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
| **Renaming** the album | Kept: the slug does not follow the title | Unchanged (refused while shown, § 9) | Unchanged |
| **Deleting** the album | Refused (`collection_address_reserved`) while a slug exists. Archive instead. | n/a | n/a |
| **Collision** | The preview refuses a slug held by another album (`slug_taken`). A concurrent first listing of the same slug waits for the other transaction at its `UPDATE`, then fails on the non-deferrable `UNIQUE` if that one committed (`slug_taken`). Nothing is written, and the author previews again. The `UPDATE` is the listing's last statement, after all of its locks, so this wait is designed not to form a cycle (R6's tests must show it) (a wait L4 does not otherwise cover). | unchanged | unchanged |

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
  - the **artist pages the listing would open** and the **public artist pages whose address would change**, as A5's review does;
  - the **existing public artist pages that will show this album** (§ 8), whatever its journals' state, each with the album and its link (to its presented journal when one is served, otherwise to its collection page);
  - the **stored cover**, or "none", **whatever the cover switch says** (§ 12), and separately whether the switch currently shows it. With the switch off, the Studio shows no image, so the review shows the stored cover's source line and stored identifier as text; the item 6 review is the visual check;
  - the **served journal pages that will gain a link** to this collection page (§ 11);
  - the **served album journal and memory pages on which an artist credit will become a link**, because the listing gives that artist a page (§ 8). In practice these are memory pages: a served album journal's credited artists already have pages (A5), unless archived, and an archived artist gets none. The list keeps both kinds so that the disclosure does not depend on that reasoning;
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

  Its fingerprint is the SHA-256 of the canonical JSON of the album id, the operation, the slug, every atom of the disclosure, and the album's `updated_at` as the state stamp. The atoms are bound directly and are the primary guarantee.
- **`listAlbumInCollection(db, author, { albumId, slug?, confirmation })`** runs in one transaction:
  1. Zod, then the token's form, key, MAC, purpose, actor, and album binding, all **before** any lock.
  2. The locks of § 10.
  3. Refuse an archived album.
  4. The expiry, on `clock_timestamp()` after the locks.
  5. Recompute the disclosure from the locked rows, and refuse `confirmation_stale` (fresh disclosure, no token) on any difference.
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

These operations only take something away. Each **needs no token** (ADR 0006's owner decision R4, not this ADR's residual risk R4), the interface asks first, and each is always allowed, including while Cover Art Archive, Wikimedia Commons, or MusicBrainz is unreachable.

| Operation | Effect |
| --- | --- |
| `unlistAlbumFromCollection` | Clears `collection_listed_at` and keeps the slug (§ 5). Artist pages that existed only through this listing close. |
| Archive a listed album | Unlists it in the same transaction |
| Remove an album's cover | **Always allowed**, including while a journal is served, while the album is listed, and **while the album is archived** (archiving does not hide a served journal's page). **This amends A3**, which today refuses removal while a journal is public, and drops `removeAlbumArtwork`'s refusal of archived albums. Removal is the cover takedown path, and the fallback frame shows instead. It still refuses `review_stale`, writing nothing, when the stored cover changed since the author's view. |
| Remove an artist's photograph | Always allowed, as A5 already says |
| Unpublish or delete a journal or memory | Unchanged in effect (ADR 0006); an album journal's also takes the locks of § 10 |

The atoms public after each operation are a subset of the atoms public before, with unchanged values (tested, § 15). The comparison runs over the **site-wide** set of atoms, not per-surface positions: **membership of capped lists** (the Home's at most four, A6's capped sections), **order**, and **counts** (`/artists`' counts, the Home's served counts) are derived values, like link order below, so a fifth album reaching the Home after an unlisting, or a count going down, adds nothing. For this property, **the presence of a link** (an artist credit's link, a journal ↔ collection link) **is an atom of its own**, so a link that becomes plain text is a removal. **The approved sentence is not an atom.** It is fixed interface copy, shown exactly when a collection page has no journal links, so its reappearance after the last link goes is the removal of those links. The publication disclosure still mentions it, for the author's information. **The order and labels of journal links are not atoms either.** They are derived from atoms already public: which journals and versions are served, and their `published_at` (§ 11). So when an unpublication moves a link, or changes which journal is presented, nothing is added. The subset test compares the set of atoms, not the order, labels, or targets of journal links. There is **one recorded exception**, described next. (M3.7's current naming rule adds a second, [R1](#residual-risks): a memory's named album depends on other albums' served journals. § 17 is designed to remove it; R1 stays open until § 17 is built and tested.) **The recorded exception:** unlisting, or archiving an album or an artist, can remove a namesake from the visible set. The other artist's derived address then changes from its suffixed form to the bare one ([`artist-address.ts`](../../src/modules/publication/artist-address.ts)), and the old address answers the unknown-address `404`; the bare address may earlier have identified a different artist. It is the A5 residual for derived artist addresses, recorded as [R2](#residual-risks): it reveals nothing private, and a stored artist slug would remove it.

### 8. Artist pages and photographs

- **The public artist set becomes A5's set plus the artists credited** (`album_artists`, never `track_artists`) on a listed album, while the artist is not archived.
- **Addresses** are still derived from names over the whole visible set ([`artist-address.ts`](../../src/modules/publication/artist-address.ts)). A listing can open pages and change a namesake's address, and both are in its disclosure and fingerprint (§ 6).
- **An artist page lists** the artist's served album journals (as today) and its listed albums, each linked to its collection page.
  - **A collection card on an artist page shows (a closed list):** the album's title, its year, its cover or the fallback frame (§ 12), and one link: to the album's presented journal when one is served (the album then shows as its journal card, unchanged), otherwise to its collection address. No track or written-track count, rating, or journal date. A listed album with a served journal does not show its collection address on the artist page.
  - **Each album appears once on an artist page.** "Album B on artist A's page" (its title, year, and cover or fallback) is **one atom**, present while B has a served journal crediting A or is listed crediting A. Its link leads to B's presented journal when one is served, otherwise to B's collection page. The link's target is derived, like § 7's journal links, and is not an atom. So unpublishing B's last served journal while B is listed moves the link to the collection page and drops the journal card's extra fields: nothing is added. A listed and journaled album's collection page is also reached from its journal page's "Back to the collection" link (§ 11).
  - **A collection-only artist's page renders** with no served album journal. Today [`public-artist.ts`](../../src/modules/publication/public-artist.ts) answers not-found when the artist has no served album, so this must change with the extended set.
  - The oracle and the HTTP suite assert these (§ 15).
- **Lists of artists (amends A6, item 1):**
  - **Two named fragments** in [`queries.ts`](../../src/modules/publication/queries.ts):
    - **`publicArtists`, extended**, is the one source of visibility and of addresses. `publicArtistAddresses` is built from it. Every surface that shows an artist address takes the address from it: the artist page, album-journal credits, memory pages, the sitemap, address resolution, the collection pages, **and the `/artists` archive and the Home's Artists section**. Those two derive addresses over their own rows today ([`public-archives.ts`](../../src/modules/publication/public-archives.ts), [`public-home.ts`](../../src/modules/publication/public-home.ts)), so a namesake would get different addresses on different surfaces.
    - **`journalArtists`, A5's set unchanged** (credited on an album with a served journal), is used for exactly four decisions:
      - the publication disclosure's new list "Artist pages gaining a journal", to be added beside A5's existing lists in [`disclosure.ts`](../../src/modules/publication/disclosure.ts);
      - the Home's Artists section's membership (decision 19);
      - **which artist pages the sitemap lists**, until § 16's SEO review decides otherwise. Collection-only artist pages stay out of it (§ 11), while their addresses still come from the extended set;
      - **whether an artist page shows its photograph:** only for members of `journalArtists` (decision 13). Today [`public-artist.ts`](../../src/modules/publication/public-artist.ts) shows a stored photograph for every artist with a page, so this must change with the extended set. `setArtistPhoto`'s refusal for collection-only artists is already covered by the extended-set refusal.
    - **`artistsNewlyExposedByCredit` decides nothing new.** It refuses only on an album with a served journal, and § 9 would refuse every credit change on such an album. It stays as defence in depth, with A5's wider entry locks (§ 10's `updateAlbum` row), but its outcome is § 9's, and it is exempt from § 15's mutation rule;
    - **Every other exposure check uses the extended set:** `lockArtistRestoreExposure` (restore) and `isArtistOnPublicPage` (`setArtistPhoto`, rename, archive), in [`catalog-exposure.ts`](../../src/modules/publication/catalog-exposure.ts). Restoring an artist credited only on a listed album would otherwise open a collection-derived page with no review;
  - the `/artists` archive lists every artist with a page, with two counts that may overlap: served album journals, and listed albums (every listed album crediting the artist, whether or not a journal of it is served), so a journal's publication or unpublication never moves the listed count. The Home's Artists section keeps A6's served counts, from journals only (decision 19);
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

### 9. Gate G8: shown catalog records are not edited in place

**The rule.** While a catalog record is shown (§ 1), every command that would change what a public page says about it is **refused** with `public_page`, writing nothing. To change it, the author:

1. takes down every surface that shows the record (unlist the album, unpublish the journals and memories that show it);
2. edits;
3. lists and publishes again, each through its review, which discloses the new wording.

**Coverage.** Every writer of a catalog table in `src/modules/catalog` is listed below. A static test fails when a new writer is not on this list.

**Only rendered atoms are guarded.** An album shown **only as a containing album** of a served memory (§ 1) is guarded only for what decides or renders that memory's named album (§ 17): its title, its year, the linked track's membership, and its deletion. Its credits, its other tracks, its edition label, its cover, and its artists' names are not guarded on that account. They are guarded only when some page renders them. Every row below that refuses for "a shown album" applies this exception, and names it. Other refusals are **conservative**: an album a served memory links directly, or a listed album, is refused for some atoms its page does not render (for example its artwork or tracklist on a memory page, or its edition label on a collection page). Narrowing them is possible later and not needed for G8.

| Command | While the record is shown |
| --- | --- |
| `updateAlbum`: title, year, credits (adding, removing, order, `credited_as`), and the reference edition's **label** | Refused for a shown album. **This narrows A5**, which allowed reordering, credit wording, and credit removal. For an album shown **only as a containing album**, only the title and year are refused: they decide which album is named, and the named one's title is rendered. |
| `updateAlbum`: the reference edition's date and country | Allowed when the reference edition exists: no public read selects them. The static column test of the `updateArtist` row covers them too. When none exists, `updateAlbum` creates one, which is refused for an album with a served journal, as for `linkAlbumToMusic`. |
| `setAlbumTracklist`, `addTrackToAlbum`, `removeTrackFromAlbum`, `moveTrackInAlbum` | Refused for a shown album, and whenever they would add a track linked from a served memory to any album. That is conservative: under § 17 only an album that would precede the named one changes what the memory shows. For an album shown only as a containing album, only adding or removing the linked track is refused. |
| `createTrack` **with an `albumId`** (it appends to that album's tracklist) | Refused for a shown album, except an album shown only as a containing album (a new track is linked from nothing, so it changes no memory). Without an album, allowed. |
| `importMusicRelease` reusing an existing recording | Refused when a reused recording is linked from a served memory and the new album would become the album that memory names (§ 1). The rule's last tie-break is the album id, which exists only after the insert, so the check runs after the insert, in the same transaction, and a refusal rolls everything back. Otherwise allowed. |
| `updateTrack`: title, length, credit, track artists | Refused for a track linked from a served memory, or on a shown album other than one shown only as a containing album |
| `updateAlbum`: `mbReleaseGroupId`; `updateTrack`: `mbRecordingId` | Allowed: no Publication read selects them; included in the static column test |
| `archiveTrack`, `restoreTrack` | Allowed: no public read depends on a track's archived state, and the collection page lists the reference edition's tracks as they are |
| `updateArtist`: the **name** | Refused for an artist with a public page, credited on a shown album other than one shown only as a containing album, or credited on a track linked from a served memory. **This narrows A5**, which allowed renames. |
| `updateArtist`: sort name, kind, identifier | Allowed: no public read uses them. A static test asserts that the Publication reads do not select these columns. |
| `archiveArtist` | Allowed (a reduction, as A5 says). The credit renders as plain text. |
| `restoreArtist` | Refused when it would open a page or change a shown credit's rendering |
| `setAlbumArtwork` | Refused for a shown album other than one shown only as a containing album, which no memory renders with a cover (A3, extended to listed albums) |
| `setArtistPhoto` | Refused while the artist has any public page (A5), and always for a collection-only artist (§ 8) |
| `removeAlbumArtwork`, `removeArtistPhoto`, unlist, archive album | Always allowed (§ 7), apart from `removeAlbumArtwork`'s `review_stale`, which writes nothing |
| `restoreAlbum` | Allowed: it never relists (§ 5). Among public reads, only the collection rule depends on `albums.archived_at`. |
| `linkAlbumToMusic`, `linkArtistToMusic` | Allowed when they fill identifiers only, which no page shows. `linkAlbumToMusic` is refused for an album with a served journal if linking would create its reference edition. A listed album always has one, and a memory page never renders the edition. |
| `importMusicArtist`, `createAlbum`, `createArtist`, and `importMusicRelease` outside the refusal above | Allowed: a new record is not shown, and reused artists and recordings are not changed |
| `deleteAlbum` | Refused for a listed-once album (§ 5), and with `public_page` while the album contains a track linked from a served memory. `album_tracks` cascades from the album, so no foreign key protects the album a memory names (§ 1). A journal about the album already makes it `RESTRICT`. |
| `deleteArtist`, `deleteTrack` | The foreign keys already refuse a credited artist or a linked or tracklisted track (`RESTRICT`) |

**Closing the gap at publication time (amends ADR 0006 § 2, and strengthens it).** Refusal alone leaves one window: while a journal is unpublished its album is not shown, so a catalog edit made **between a publication's preview and its confirmation** would reach the page unreviewed. Therefore:

- **the catalog atoms each page renders join the publication disclosure and fingerprint**, as A5 already did for artist pages:
  - for an album journal: title, year, edition label, credits as rendered (each with its link presence and address), each rendered track's title, credit, and order (the edition's tracks, and any track a served reflection, or one this publication makes public, names), the stored cover or none, and the presence and address of the collection link; when the album is listed, **the collection page's change**: its approved sentence replaced by a "Read the journal" link, or the link moved to this journal or added beside the others (§ 11); **the served memories that name the album** (§ 17) **on which it will become a link, or whose link will lead to this journal**, bound by entry id (the Studio title shown beside each is informational, because it can come from an unserved version); and **the served album journal and memory pages on which an artist credit will become a link**, because the publication opens that artist's page (A5), as a listing already discloses them (§ 6; in practice memory pages);
  - for a memory: each link's rendered title, its credited artists **with each one's link presence and address**, and the album named for each linked track: **its identity (the album id), its title, and whether and where it links** (§ 17). So that two albums with the same title can be told apart, the Studio review also shows, and the fingerprint binds, the named album's year and credited artists. Neither reaches the public page;
- **a catalog edit in that window makes the publication stale** (`confirmation_stale`, the fresh disclosure, no token);
- **the confirmed save (amends ADR 0006 §§ 1 and 5):** a memory link's atom gains its rendered wording (title, credits, named album). Today a link is bound by id only, so a track not yet linked could be renamed between `previewPublicChange` and the save. An added or reordered link's wording is now part of the delta, so such a rename makes the save stale. **An album journal's confirmed save** binds the catalog atoms its own page renders (title, year, label, credits with their link presence and address, track wording, cover, and the collection link), not the publication's transition lists (memories and pages gaining links), because a save changes no served state, so a catalog edit between `previewPublicChange` and the save makes it stale; its locks are taken in `saveAlbumJournal` ([`journals/commands.ts`](../../src/modules/journals/commands.ts)), the only album-journal caller of the confirmed-save gate, after `lockAlbumJournal`.

ADR 0006's "Informational lines are not part of the set" therefore ends for catalog wording. That is the resolution proposed for G8, effective once §§ 9, 10, and 17 are built, tested, and reviewed by the owner.

**Pages served before § 9 ships.** Today's fingerprints bind no catalog wording, and A5 allowed renames, credit wording, and track titles after publication. A page served when § 9 is deployed may therefore show wording no review bound, which § 9 would then freeze. So, as for memories in § 17: **before** § 9 is deployed on a database, every served entry there (album journals and memories) is unpublished, and after the deploy each is published again through the new review, before public reads are turned on; or the record shows that none was served, the expected path for both current databases. The record is G8 evidence, beside R1's. Republishing sets a new `published_at` (§ 17).

**When a journal is also published.** Unlisting alone does not make the record editable while a served journal or memory still shows it.

- **The Studio's refusal names every kind of surface that shows the record**: the collection page, and each journal and memory by its Studio title. It is a private, authorized response.
- **The author unpublishes those** through ADR 0006's own unpublish, which asks first, edits, then republishes each through ADR 0006's full preview and confirmation. Each confirmation now binds the new catalog wording.
- **This take-down, edit, and republish path adds no way to publish** (the rule changes this ADR makes elsewhere are in § 10 and [Open decisions](#open-decisions)):
  - there is no new way to publish;
  - every reappearance is reviewed;
  - unpublishing keeps the slugs, the publication history, `first_published_at`, and the reflection flags;
  - a previous address still answers as INV-5 says.
- **The cost** is that the pages are briefly absent and the author confirms each again. It is recorded as a consequence. If it proves too high, the confirmed catalog change in [Alternatives](#alternatives-considered) is the next step, through its own decision.

**What remains outside the guard, recorded rather than accepted as harmless:** what external providers serve (an image replaced at the Cover Art Archive under the same Image ID). § 12's cover switch and the takedown path bound it, and the rights review records it.

### 10. Locks and concurrency

- **Order, for every command in § 6 to § 9:**
  1. entries `FOR SHARE`, in ascending id order: every album journal of the albums involved, as A3 and A5 already do, and **every memory that links any album involved, any track involved, or any track on an album involved, whatever its state**, **except where the table below lists fewer, with its reason**. That includes the memories linking the recordings that `importMusicRelease` reuses, which therefore takes entry locks for the first time;
  2. then albums, in ascending id order: for a write, the mode each command already uses (`FOR UPDATE` in `updateAlbum`, the tracklist commands, and linking; A3's `FOR NO KEY UPDATE` for artwork); `FOR SHARE` otherwise, except as below (an album journal's publication, unpublication, and deletion, and listing, unlisting, and archiving, take the album in a write mode);
  3. then artists, in ascending id order;
  4. then tracks, in ascending id order: **in a write mode (`FOR NO KEY UPDATE`, or `FOR UPDATE` where the command already uses it, as `updateTrack` does) for every track the command changes, adds to an album, or reuses**, before it decides; `FOR SHARE` otherwise.

     Adding a track to an album writes an `album_tracks` row (and, through `rewriteTracklist`, `edition_tracks` rows, whose foreign keys point at `album_tracks` and `album_editions`, not at `tracks`). Its foreign key to the track takes `KEY SHARE`, which does not conflict with a publication's `FOR SHARE`. Today `addTrackToAlbum`, `setAlbumTracklist`, and `importMusicRelease` read the added or reused track with a plain `select`. Without this write-mode lock, a memory published meanwhile would not see the new album and would not wait. `FOR NO KEY UPDATE` conflicts with `FOR SHARE` and still allows foreign-key `KEY SHARE`.

     **`createTrack` with an album follows the order too.** Today it inserts the track and its `track_artists` rows, taking `KEY SHARE` on the artists, before it locks the album ([`commands.ts`](../../src/modules/catalog/commands.ts)). It must lock the entries, the album, and the named artists (`FOR SHARE`) **before** inserting anything. Otherwise, under this order, a rename that changes an artist's identifier and a `createTrack` naming that artist could deadlock with only two transactions. **`importMusicRelease` must do the same:** today it inserts the album, its `album_artists` rows (taking `KEY SHARE` on reused artists), and the tracks before any lock ([`music.ts`](../../src/modules/catalog/music.ts)). It is also the command that takes entry locks for the first time. **`updateTrack` is reordered too:** today its first statement locks the track `FOR UPDATE` ([`commands.ts`](../../src/modules/catalog/commands.ts)). Kept first, with the album locks added after it, it would deadlock with an album journal publication that holds the album and waits for the track. It must take the entries, the albums, and the artists before the track. **`setAlbumArtwork`, and every caller of `lockAlbumPublicExposure` or `lockArtistPublicExposure`, decides only after its album or artist row lock:** today `setAlbumArtwork` decides whether the album is shown and only then locks the album ([`music.ts`](../../src/modules/catalog/music.ts)), so a listing holding the album could commit between the decision and the write. Any other catalog command that inserts or locks rows, or decides, before taking § 10's earlier locks is reordered the same way.

  **What "involved" means, per command** (lock modes as in the order above):

  | Command | Albums | Artists | Tracks | Entries share-locked |
  | --- | --- | --- | --- | --- |
  | `updateAlbum`, the tracklist commands, `createTrack` with an album, `setAlbumArtwork`, `deleteAlbum` | that album (write) | the artists it names (share) | its tracks (share); **the tracks added (write)** | the album's journals; memories linking the album or any of its tracks or the added track; for `updateAlbum`'s credit changes, also the journals of every album crediting the named artists (A5's set, kept because `artistsNewlyExposedByCredit` reads them) |
  | `archiveTrack`, `restoreTrack` | none | none | that track (the `UPDATE`'s own lock) | none: allowed with no decision (§ 9) |
  | `updateTrack` (it decides in a fresh statement after its track lock, never from the album set it read before locking) | every album containing the track (share) | the track's stored and new artists (share), for lock-order hygiene: the track's credit rows are read and written under them (the track's own write lock already serializes it with publications) | that track (write) | journals of those albums; memories linking the track or those albums. Not memories linking other tracks on those albums: a track edit changes only that track's atoms, and no other track's named album depends on it |
  | `updateArtist`, `restoreArtist`, `setArtistPhoto`, `archiveArtist` | albums crediting the artist, and albums of tracks crediting it (share) | that artist (write) | tracks crediting it (share) | journals of those albums; memories linking those albums or tracks. Not memories linking other tracks on those albums: a memory renders an artist only through the track or album it links directly |
  | `importMusicRelease` | the albums already containing each reused recording (share) | reused artists (share) | **reused recordings (write)** | memories linking the reused recordings only: under § 17 no journal decides the named album, and the new album has no journal (§§ 9, 10, and 17 merge as one change, so this lock set never runs under M3.7's rule) |
  | `linkAlbumToMusic` | that album (write) | none | none | the album's journals only: it changes only identifiers, which no memory renders |
  | `archiveAlbum` (with its listing clear) | that album (write) | its credited artists (**write**, `FOR NO KEY UPDATE`) | none | none, as for `unlistAlbumFromCollection`: both are reductions serialized on the album row, and a memory sees the listing only through its artist links (§ 7; addresses: R2) |
  | `listAlbumInCollection` | that album (write) | its credited artists (**write**, `FOR NO KEY UPDATE`) | its reference edition's tracks (`FOR SHARE`), whose titles and lengths it binds | the album's journals only: a memory sees a listing only through its artist links, and memory publications serialize with it on the artist rows |
  | `unlistAlbumFromCollection` | that album (write) | its credited artists (**write**, `FOR NO KEY UPDATE`) | none | none: a reduction, and every publication that renders the album already locks its row (album journal publications `FOR NO KEY UPDATE`; their confirmed saves and memories `FOR SHARE`) |
  | `removeAlbumArtwork` | that album (write, A3's `FOR NO KEY UPDATE`) | none | none | none: always allowed (§ 7). The album row serializes it with every publication and listing that binds the cover |
  | `restoreAlbum` | that album (write) | none | none | none: it never relists, and no public read other than the collection rule depends on the archived state (§ 9) |
  | `removeArtistPhoto` | none | that artist (write) | none | none: always allowed (A5). The artist row serializes it with the publications that bind the photograph |
  | `linkArtistToMusic` | none | that artist (write) | none | none: identifiers only, which no page shows |
  | `createAlbum`, `createArtist`, `importMusicArtist`, `createTrack` without an album | none | none (`createTrack`'s `track_artists` inserts take only `KEY SHARE`) | none | none: a new record is not shown |
  | `deleteArtist`, `deleteTrack` | none | the deleted artist (the `DELETE`'s own lock) | the deleted track (the same) | none: the `RESTRICT` foreign keys decide (§ 9) |
  | An album journal's **confirmed save** | its album (`FOR SHARE`) | its credited artists (`FOR SHARE`) | the tracks its page renders: its edition's, and any a served reflection, or one this publication makes public, names (`FOR SHARE`) | its own entry (`FOR UPDATE`, ADR 0006). It changes no served state, address, or `published_at`, so share locks suffice |

- **Publications and confirmed saves lock what their fingerprint binds (amends L3; addresses R5).** Under its entry lock, a publication or confirmed save takes `FOR SHARE`, in § 10's order, on the catalog rows its catalog atoms are read from (§ 9): for an album journal, the tracks its page renders (its edition's tracks, and any track a served reflection, or one this publication makes public, names), and for its **confirmed save** also its album and credited artists (a **publication** takes those two `FOR NO KEY UPDATE` instead, below); for a memory, each linked album and track, the albums containing each linked track, the artists credited on the linked albums and tracks, and **the named albums' credited artists**, whose names its Studio review shows and binds (§ 17). It then computes the fingerprint.
  - **A confirmed save locks the links of its current and resulting states** (their union), so a save that removes a link still holds that link's rows and serializes with a publication that lists the memory: links it adds, their albums, the albums containing an added track, and their artists, all `FOR SHARE` before it computes the delta. Its `memory_music` inserts take only `KEY SHARE`, and a concurrent `updateTrack` share-locks only memories that already link the track. Without this lock, a rename of a track being newly linked would pass unrefused, and the save would commit wording the author never reviewed.
  - **After its track locks, a publication or confirmed save also re-reads the credited artists (`track_artists`) of each linked or added track,** and refuses `confirmation_stale` when that set differs from the artists it locked. Artists are locked before tracks, so a credit changed and changed back between its artist read and its track lock (an ABA) would otherwise leave a rendered artist unlocked, and a publication opening that artist's page could commit unseen.
  - **After its track locks, a publication or confirmed save re-reads the albums that contain each linked or added track.** If that set differs from **the set of albums containing those tracks that it read and locked before the track locks** (not the albums it links directly), it refuses `confirmation_stale` and writes nothing. This fails closed: it refuses even when the named album and every atom are unchanged, and the author then confirms an identical fresh disclosure. Albums are locked before tracks, so an album that gains the track while the save waits (through `addTrackToAlbum`, on an album the save did not lock) would otherwise go unlocked, and a later edit of that album could change the album the memory names.
  - `FOR SHARE` conflicts with every catalog write mode above. A catalog edit that holds a row makes the publication wait, and the publication then fails as stale. A publication that holds the rows makes the edit wait, and the edit then sees the record shown and refuses.
  - This narrows L3's "no entry command takes an explicit catalog lock" without changing its order: catalog locks still come after the entry lock, and catalog commands take entries before catalog rows, so the design forms no cycle (R6's tests must show it).
  - An entry created during a catalog command (A3's late-entry window) is now serialized too: its publication waits on the catalog rows.
  - **An album journal's publication, unpublication, and deletion, and unlisting or archiving an album, take that album's credited artists `FOR NO KEY UPDATE`** after the album row, as a listing does. A publication's review lists the served pages on which an artist credit will become a link (§ 9). A memory publication that renders one of those artists share-locks it, and another album journal's publication takes it `FOR NO KEY UPDATE`, so the two serialize, and whichever previewed before the other committed fails `confirmation_stale`. With share locks on both sides, two overlapping publications could each miss the other, and a memory credit could become a link that neither review showed. The reductions take the same lock so that an artist page cannot close and then reopen through a publication whose review counted it as already open (A5's "an artist page reappearing through a journal whose review did not list it"): journal J1 previews while artist A has a page through J2 or a listing; if J2 is unpublished, or the album unlisted, before J1 commits, J1 waits on A and then fails stale. The order is unchanged (entry, album, artists in ascending id order).
  - **Journals of one album serialize on the album row.** Publishing, unpublishing, or deleting an **album journal** takes its album row `FOR NO KEY UPDATE`, not `FOR SHARE`, after its entry lock. Two such transitions on journals of the same album (which together decide the collection page's journal links and sentence) therefore run one after the other, and each recomputes under the lock what the collection page will show. The order stays entry, then album, so the design forms no cycle (R6's tests must show it):
    - a catalog command waits on the entries before it takes the album, and the commands that take no entries (for example `unlistAlbumFromCollection`, `restoreAlbum`, `removeAlbumArtwork`, `removeArtistPhoto`, and `linkArtistToMusic`; every row of § 10's table with "none" in its entries column) never wait on an entry while holding a catalog row; unlisting then takes only the album's credited artists, later in the order;
    - listing waits on the album's journal entries first;
    - foreign-key `KEY SHARE` locks of new journals and memory links are not blocked.

  **Share-locking memory entries is new.** A3 and A5 lock album-journal entries only, and A3's note on L2 says that any other command holding several entry locks needs its own decision. **This is that decision:** several memory entries may be held `FOR SHARE`, in the same ascending id order, interleaved with the album journals in one sorted list. No entry command waits on a second entry, so no cycle is designed to form among them (R6's tests must show it).

  **L1 gains a narrow exception (not a reading), for the owner to approve at acceptance.** L1 says a transaction that reads a row owned by entry E in order to decide first locks E `FOR UPDATE`. A5's "a publication locks only its own entry" is the precedent for artist pages. This ADR adds a **closed list** of readers that decide from other entries' rows **without those entry locks**, each serialized through catalog rows instead:

  | Reader | Rows of other entries it reads | Serialized through | Window left |
  | --- | --- | --- | --- |
  | An album journal's publication | (a) served memories' `memory_music` and state (memories that name the album; memory pages on which a credit becomes a link) | the album row and its credited artists' rows (`FOR NO KEY UPDATE`), which every memory publication and confirmed save that could add to or remove from those lists locks first | § 17's C7 and R4: a memory's unpublication or deletion |
  | An album journal's publication | (b) the other served journals of the same album (which journal is presented, the collection page's links, where memory links lead) | the album row (`FOR NO KEY UPDATE`), which every journal transition of that album takes | none |
  | An album journal's publication | (c) other albums' served journals and listings (A5's artist pages that open and address changes, "Artist pages gaining a journal", credits that become links); A5 already records this read | its credited artists' rows (`FOR NO KEY UPDATE`), which every journal transition, listing, unlisting, and archive crediting them takes | namesakes (R2, R4) |
  | An album journal's confirmed save | other journals and listings that decide its credits' link presence and address, and its own album's listing (the collection link) | its album and credited artists' rows (`FOR SHARE`), which those transitions take in a write mode | namesakes (R2) |
  | A listing | (a) served memories' `memory_music` and state, and other albums' served journals (the artist pages it opens or changes, the existing artist pages that will list the album, and the pages on which a credit becomes a link) | its credited artists' rows (`FOR NO KEY UPDATE`), which every journal transition and memory publication rendering them locks | R4: the same memory reductions, and namesakes |
  | A listing | (b) journals of its own album created after its entry-lock statement | the album row (`FOR UPDATE`), which every album journal transition takes `FOR NO KEY UPDATE` | none |
  | Every guarded catalog command of § 9 | entries created, or links added, after its entry-lock statement (A3's late entries), and, for `updateTrack`, the journals and memories of an album that gained the track after it read its album set | the catalog rows it holds in a write mode, which every publication and confirmed save share-locks before deciding, and the track row, which `addTrackToAlbum` takes in a write mode | none, once R5's tests pass |
  | A memory's publication or confirmed save | (a) the named album's served journals (its link's presence and address, § 17) | the named album's row (`FOR SHARE`), which every album journal transition takes `FOR NO KEY UPDATE` | none |
  | A memory's publication or confirmed save | (b) served album journals and listings that decide each credited artist's link presence and address | the credited artists' rows (`FOR SHARE`), which every journal transition, listing, unlisting, and archive crediting them takes `FOR NO KEY UPDATE` | namesakes (R2, R4) |

  No other command may read another entry's rows to decide without that entry's lock; a static test is a tripwire that enumerates the rows above and flags other readers of entry-owned rows, as ADR 0006 § 9's scans are; the behavioural tests of § 15 and § 17 are the proof. **L6 is narrowed for these atoms only:** a reduction in the window column, or a namesake's transition on another artist row (an addition included), can commit between a reader's comparison and its write. The end state is then what the review showed, minus any reduction, except R2's derived artist addresses, which may change value (§ 7's recorded exception).

  Apart from the locks above (the share locks on fingerprinted catalog rows, and an album journal's own album row and credited artists `FOR NO KEY UPDATE`), no entry command takes an explicit catalog lock.

  **Where the album lock lives.** `publishAlbumJournalVersion` checks the kind before the engine opens its transaction, and ADR 0006 § 4 step 3 says the engine takes no kind. The album lock is therefore taken **inside the engine**: under the entry lock, it looks up `album_journals` for the entry and, when it finds a row, locks that album. **A memory's publication** takes its catalog locks in the engine too: under the entry lock, it reads the memory's `memory_music` and share-locks, in § 10's order, the linked albums, the containing albums, the artists credited on the links and on the named albums, and the linked tracks, then re-reads the containing albums (above). A memory's confirmed save takes the same locks in `saveMemory`, after `lockMemory`. **Unpublishing** takes the album lock in the engine too (`unpublishLanguageVersion` can learn the kind under its entry lock: it calls `lockLiveEntry`, which returns it), so every caller takes it. **Deleting** has no Publication command: `deleteAlbumJournal`, the only command that sets an album journal's `deleted_at`, takes the album row and then its credited artists after `lockAlbumJournal` ([`journals/commands.ts`](../../src/modules/journals/commands.ts)), or the deletion moves into a Publication command that does. `permanentlyDeleteEntry` acts only on an already-deleted, unserved entry and needs none. A test asserts that every album-journal unpublish and delete path takes the album and artist locks. For publications and confirmed saves, **the token's expiry and every atom are read after all of § 10's locks** (the album and its credited artists `FOR NO KEY UPDATE`, and the catalog share locks), as L6 requires. Unpublishing and deleting carry no token. **Listing share-locks the album's own journal entries first,** because the served-journal links it discloses depend on them. The artist pages it discloses can also depend on other albums' journals, whose transitions serialize with it on the artist rows. What remains is R4's: memory reductions and namesakes.
- **Publication against catalog edits.** A publication takes its entry `FOR UPDATE`, then, for an album journal, its album and then its credited artists `FOR NO KEY UPDATE`, and the other catalog rows `FOR SHARE`. A catalog edit holds the entry `FOR SHARE` and its catalog rows in a write mode before deciding. Either the edit commits first and the publication's fingerprint, which now binds catalog atoms, fails as stale; or the publication commits first and the edit then sees the record shown and refuses.
- **Listing against catalog edits.** Listing locks the album's journal entries `FOR SHARE`, the album `FOR UPDATE`, its credited artists `FOR NO KEY UPDATE`, then its reference edition's tracks `FOR SHARE`. The track lock is needed because `updateTrack` serializes with an album only through the album set it read before its locks: an album that gained the track meanwhile (through `addTrackToAlbum`) would otherwise be listed with the old title while the rename commits. The artists' `FOR NO KEY UPDATE` conflicts with the `FOR SHARE` that publications and confirmed saves take on the artists they render, so they serialize with the listing (R4), and it still allows foreign-key `KEY SHARE`. An edit that holds one of those rows makes the listing wait and then fail as stale. A listing that commits first is seen by the edit, which then refuses.
- **Residual windows** are not closed by this order. Each is listed in [Residual risks](#residual-risks) with its cause, consequence, mitigation, test evidence, and criterion: R4 (reductions and namesakes during a listing or a publication) and R6 (deadlocks). R5 (late entries) is addressed by the publication share locks above, which are not built, and stays open until its test passes. R1 (a memory's named album) is not a lock window: § 17 would remove its only input that no review covers (other journals' state, which an unpublication with no token could change). Its remaining inputs are catalog rows, which § 9 guards and the locks above serialize, and it stays open until § 17 is built and tested.
- **Isolation.** The default `READ COMMITTED` is enough, because every decision is made by a statement that runs after the locks.

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

    The sort name is not used (§ 9).
- **Navigation (decision 16):** the header's sections are unchanged. "Collection" is not added. The collection is reached from the Home section, collection and artist pages, and the journal page's link.
- **`/albums` archive:** unchanged. It lists served album journals only (decision 6).
- **Artist pages and `/artists`:** § 8.
- **Home:**
  - **This amends A4 and A6:** the Home may also show a discreet section, "Collection" / "Coleção", with **at most four** listed albums, each card a **closed list** (title, artists as credited, each linked only when the artist has a page, year, cover or fallback, collection address; **never** a rating, a journal date, an excerpt, or a count), newest `collection_listed_at` first, then album id, using the Home's existing album cards, and a "View the collection" / "Ver a coleção" link to `/collection` (decision 18) in the pattern of the other sections' links.
  - The Home's Artists section is unchanged: only artists related to served journals (decision 19).
  - A4's switch-off rule is unchanged: with reads off, the section is empty and the Home is identical whatever the database holds.
- **Headers and routing:** `/collection/:path*` and `/pt/collection/:path*` join [`next.config.ts`](../../next.config.ts)'s public header rules (the public headers, with a CSP that allows the cover hosts, as A7 item 6 requires per section) and the proxy's list of sections.
- **Metadata:** title, description, canonical address, language alternates and `og:locale` as [ADR 0008 § 7](0008-interface-localization.md#7-metadata-and-alternates) requires, and Open Graph tags from the § 3 atoms only. No Open Graph image is generated.
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
    - **The Studio's choosing screens** (the artwork chooser and the release review of M3.2): the author's browser fetches nothing from the Cover Art Archive; the server may still list candidates through its adapter. **Until the owner decides** ([Open decisions](#open-decisions)), they show the candidates as text (type and Image ID) and **offer no choice**: choosing an image the author cannot see is not a choice, so it fails closed and the stored cover is kept.
    - **The commands enforce it, not only the interface** (a hidden control is not a control): with the switch off, `setAlbumArtwork`, and `importMusicRelease` given a `coverImageId`, refuse `cover_display_disabled` and write nothing.
    - Removal stays allowed (§ 7). Local development may turn the switch on and choose there.
  - **On a hosted deployment,** the owner turns it on only after recording the deployment-gate item 6 review. Local development may turn it on.
  - **It can only hide.** Listing and publication disclosures bind the **stored** cover whatever the switch says (§ 6, § 9), so a cover shown after the switch is turned on is one that a review disclosed. **Limit:** journals published before § 9's fingerprint rule is implemented did not bind their cover (ADR 0006 kept covers out of the fingerprint). § 9's transition republishes every served entry through the new review, so after §§ 9, 10, and 17 deploy, no served journal has an unbound cover; the limit applies only if § 12 is deployed before § 9. The item 6 review covers every cover the deployment would show in either case.
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
  - refusals as in § 9;
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

**Delivery order.** Nothing merged may widen G8, even locally. **§§ 9, 10, and 17 merge as one change**, because several of § 10's lock sets (for example `importMusicRelease`'s, and C3) are justified only by § 17's rule. §§ 2 to 5 (schema, predicate fragment, addresses) and § 14 (Studio, writers, restore scripts) merge with or before § 6's listing command; the listing-dependent rows of §§ 9 and 10 and their tests are merge conditions of the change that adds § 2 and § 6. §§ 6 to 8, 11, 13, and 15 may follow in steps, but no listing command and no collection surface merges before the §§ 9/10/17 change and its tests. § 12's cover switch (it only hides) and § 16's `noindex` may merge before it. The transition records of § 9 and § 17 apply to its deploy. §§ 9, 10, and 17 **deploy together**, so each served entry is unpublished and republished once; deployed apart, it would go through two cycles and its `published_at` would move twice. Deployments are manual ([Hosted Launch](../hosted-launch.md)), so the transition record names the single deployed commit that contains all three. A local database that runs `main` follows the same records when that change reaches it. **§ 16** (site-wide `noindex`) merges before any collection surface, or the indexing tests of § 15 become merge conditions of whichever of the two lands second.

- **Schema:**
  - the constraints of § 2, including an out-of-process `archived_at` update on a listed album being refused;
  - the migration on fresh and populated databases;
  - every existing album stays unlisted.
- **Oracle:**
  - an independent implementation of § 3 and § 8, compared with every collection read over the state matrix (listed or not × archived or not × journal and memory states × artist archived × namesakes);
  - the existing oracles unchanged.
- **No inference (§ 4):** for each public collection surface, and for a memory page's music under § 17, in both languages and every request form, the whole response for a listed album with each kind of unpublished writing (draft, private, deleted, restored, unpublished translation, unflagged reflection) equals the response with no writing.
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
- **G8 (§ 9):**
  - each row refused while shown, with no row changed, and allowed while not shown;
  - the static coverage test over every catalog writer;
  - a catalog edit between a publication's preview and its confirmation makes it `confirmation_stale`, for an album journal and for a memory;
  - a rename of a track between a memory's `previewPublicChange` and its save, when the save adds or reorders that link, makes the save stale;
  - **containing albums:** while the memory is served, adding a memory-linked track to an album through the tracklist commands is refused; `importMusicRelease` is refused when the new album would precede the named one (including a tie on year and title decided by the new id, with everything rolled back), and allowed otherwise, after which the new album is guarded as a containing album; renaming or re-dating a containing album, and deleting one, are refused;
  - the edition's date and country, `sort_name`, and `kind` are not selected by any Publication read, and edits to them are allowed;
  - renaming an artist credited only on a memory-linked track is refused;
  - the Publication reads select no `sort_name` or `kind`;
  - the take-down, edit, republish path restores the pages with their slugs and history.
- **Artist pages (§ 8):**
  - restoring an artist credited only on a listed album is refused; setting a photograph, renaming, and archiving decide from the extended set; a credit change on an album with a served journal is refused by § 9;
  - a publication that gives a collection-only artist a journal page discloses it under "Artist pages gaining a journal" (not "Artist pages that will open"), with its stored photograph, and goes stale when that photograph changes;
  - addresses are equal across the artist page, the `/artists` archive, and the Home for namesakes split between the collection and journals;
  - an album appears once on an artist page; unpublishing a listed album's last served journal moves its link to the collection page and adds no atom; `/artists`' listed count does not move with journals;
  - a collection-only artist shows no photograph, and `setArtistPhoto` refuses for one;
  - a mutation that decides photograph display from the extended set instead of `journalArtists` fails;
  - a collection-only artist is absent from the sitemap's membership while a namesake's address there comes from the extended set. While § 16 holds, `/sitemap.xml` answers `404`, so this runs at the read function that builds the sitemap's list; a mutation that uses the extended set for sitemap membership fails;
  - the namesake exception of § 7 is the only non-subset outcome.
- **The album a memory names (§ 17):** every test listed in § 17, which are merge conditions like the rest of this list.
- **Concurrency (§ 10):**
  - over real connections, listing and publication each against a rename, a credit change, a tracklist change, an artwork change, and each other, seen waiting and then refusing or completing as described;
  - a memory's publication against an edit of a track it links;
  - a published memory's confirmed save that adds track T, against a concurrent `updateTrack(T)`: one waits, and the save is stale or the rename refused; a mutation that drops the lock on added links fails;
  - the three-transaction race: a save adding T waits on T while `addTrackToAlbum(B, T)` commits, then `updateAlbum(B)` runs; the save's re-read refuses it as stale; a mutation that drops the re-read fails;
  - a listing and a memory publication that render the same artist, run concurrently: seen to serialize on the artist row;
  - `deleteAlbumJournal` on a served journal of a listed album, against a concurrent publication of another journal of that album: they serialize on the album row;
  - two journals of one listed album published (or one published and one unpublished) concurrently: seen serializing on the album row: the collection page's links match the final served state, and a losing publication fails `confirmation_stale`;
  - unpublishing a journal's earliest visible version can reorder its link, and unpublishing the presented journal moves the single link to another served journal; the subset test, which compares atom sets, passes;
  - a memory's confirmed save adding track T, against two `updateTrack(T)` credit changes that restore the previewed credit (an ABA) while an album journal publication opens the restored artist's page: the save's `track_artists` re-read refuses it as stale; mutation: dropping that re-read fails;
  - `setAlbumArtwork` against a concurrent `listAlbumInCollection` of the same album: seen waiting, then refusing `public_page`; mutation: deciding before the album lock fails;
  - a listing against `updateTrack` of a track added to the album (by `addTrackToAlbum`) after the rename read its album set: seen waiting, then `confirmation_stale`; mutation: removing the listing's track lock fails;
  - unlisting, and archiving, an album against a publication of that album's own journal (whose fingerprint binds "Back to the collection"): seen serializing on the album row, the publication failing stale when the link went after its preview;
  - an album journal unpublication, and an unlisting, each against a publication of another journal crediting the same artist: seen serializing on the artist row, the publication failing stale when the artist's page closed after its preview;
  - static checks of the lock order in every guarded command, memory entries included.
- **Switches:**
  - the HTTP switch-off matrix over the new routes in both language forms;
  - the Home identical with reads off;
  - the cover switch off means no Cover Art Archive URL in any response, Studio included (the artwork chooser and the release review among them), and the fallback frame; with it off, the choosing screens offer no choice, and `setAlbumArtwork` and `importMusicRelease` with a `coverImageId` refuse `cover_display_disabled` with no row changed (integration tests).
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

### 17. The album a memory names (residual risk R1, owner decision 21)

The owner chose option (a) as the direction for [R1](#residual-risks) on 2026-11-13. This section specifies it against the owner's seven conditions. **It is not implemented.** Until it is built and its tests below pass, M3.7's rule holds, and R1 stays open and blocking.

**The rule.** For each recording a memory links, its page names exactly one album, **the named album**:

- chosen among **every** album that contains the recording (`album_tracks`), whether listed, archived, or neither;
- the earliest by `first_release_year` (unknown last), then `title` in code-point order (`COLLATE "C"` on UTF-8), then album id.

For an album link, the named album is the album itself, as today. A recording on no album names none.

- **Its inputs are catalog rows only:** `album_tracks`, and the containing albums' year, title, and id. **No entry's state is an input**: no journal's or memory's publication, unpublication, deletion, restore, draft, or private state, and no listing. Another album's journal therefore cannot change it (condition 4).
- **Code-point order on the title** makes the choice independent of the database's collation. Restoring into a server with another collation, or a collation-library upgrade, cannot change it. M3.7's query uses the default collation today.
- **Archived state is not an input**, as today. Archiving or restoring the named album changes nothing a memory shows. Excluding archived albums would make archiving replace the name with another album's, which is an addition, not a takedown.

**What the page renders for it.** The kinds of metadata are exactly today's (M3.7):

- the named album's title, as stored;
- a link **only when the named album has a served album journal**, to the journal presented for the album ([ADR 0002, D1.2](0002-domain-model-decisions.md); `presentedJournals`) at its served `/albums/<slug>` address. Otherwise it is plain text;
- nothing else of the album: no year, cover, credits, or collection link.

**No new product decision is needed (condition 7).** A public memory shows the same kinds of metadata as today: titles, credited artists, one album title per recording, and links only to pages already public. Only which album fills that slot changes. One visible consequence follows. A recording that is also on a later album with a served journal names the earlier album, as plain text when the earlier album has no served journal, where today it names the later album with a link. That is the cost of stability. **The owner's acknowledgement of this consequence is pending** ([Open decisions](#open-decisions)) and is not presumed.

A link from a memory to a **collection page** would be a new kind of link on a memory page. **It is not decided here.** It is recorded as pending in [Open decisions](#open-decisions), and until the owner decides it, a memory never links to a collection page.

**The identity is part of the memory's review (condition 3).**

- A memory's publication preview, and its confirmed save, disclose for each linked recording the named album's title, **its year and credited artists** (so that albums with the same title can be told apart), and whether and where it links (the journal's address).
- **Dialog content changes, for the Studio design review** (no new control and no public change):
  - the memory publication dialog lists each song's album and whether it links today (`memory-publish-dialog.tsx`). It gains the year, the credited artists, a mark when the named album is archived, a mark when its title is **not otherwise public** (the album is neither listed nor has a served journal), and the link's target;
  - the confirmed-save dialog (`memory-change-dialog.tsx`) lists changes without any album today. It gains the named album, as above, for each added or reordered link;
  - the album journal publication dialog gains the two lists of § 9: memories that name the album, and pages on which a credit becomes a link.
- The fingerprint binds the album's **id**, its title, year, and credited artists, and the link's presence and address (§ 9). The id is bound and not shown; the year and artists are shown in the Studio only. The "archived" and "not otherwise public" marks are informational and not bound: they help the author read the review, and neither changes what the page shows. "Not otherwise public" means the album is neither listed nor has a served journal; its title may still appear on another served memory that names it.
- **The atoms, for § 7's subset comparison:**
  - each link's atom: the recording's or album's title, its credits, and the named album's id and title;
  - each credited artist's link presence: an atom of its own, as in § 7. Its address is bound in the fingerprint; an address change is R2's;
  - the named album's link presence: an atom of its own, so a link that becomes plain text is a removal;
  - the link's target address: bound in the fingerprint, but, like the collection page's link order, not compared by the subset test, because it is derived from which journals are served.
- A change of any of them between the preview and the confirmation makes the publication or save `confirmation_stale`, with a fresh disclosure and no token.

**What can change what a served memory shows for its named album.**

| Operation | Effect on a served memory | Governed by |
| --- | --- | --- |
| Publishing, unpublishing, deleting, or restoring a journal of **another** album; listing or unlisting any album | None on the named album or its link. Artist credits on M can become links or plain text; those follow A5 and § 8 (an addition is disclosed by the publication or listing that causes it, a removal is a reduction, and an address change is R2) | The rule: no entry state and no listing is an input |
| Restoring a deleted journal of the named album | None: a restore never publishes ([ADR 0005](0005-restoring-deleted-journals.md)) | ADR 0005 |
| Publishing a journal of **the named album** | The album becomes a link, or its link now leads to the newly presented journal | That publication's review lists those served memories and binds them (§ 9) |
| Unpublishing or deleting a journal of the named album | The link becomes plain text, or leads to the album's remaining presented journal | A reduction (§ 7). Which served journal a link leads to is derived from atoms already public, like the collection page's link order (§ 7), so it is not an atom of its own |
| Adding the recording to an album that would precede the named one; changing the year or title of any album containing it; removing it from the named album; deleting the named album | Would change the named album or its title | **Refused** while the memory is served (§ 9, whose tracklist commands refuse adding the recording to any album, conservatively). While it is not served, the next publication or confirmed save discloses the result |
| Archiving or restoring the named album | None | Allowed (§ 7) |
| The memory's own confirmed save | What it reviewed | ADR 0006's confirmed save, with § 9's atoms |
| Unpublishing or deleting the memory | The page answers the identical `404` | ADR 0006 |

No command sets `album_journals.is_featured` today, and `changeEntrySlug` ([`publication/commands.ts`](../../src/modules/publication/commands.ts)) has no production caller. Either would change where a memory's link and a collection page's link lead. ADR 0006 § 5 lists featuring as needing no confirmation and an address change as exempt. **This ADR does not change those rows:** a caller of either would need its own decision. A link's target address is bound in the fingerprints of § 9 and § 17 for staleness only; it is not an atom for ADR 0006 § 5 or for § 7's subset comparison.

**Condition 6: what is preserved, and what changes.**

- **Unchanged by § 17's text:** § 17 adds no predicate fragment (§ 3 adds the collection's); every publication still needs ADR 0006's preview, token, and the author's act; every reduction stays tokenless; and the lock order (entries, then catalog rows) is kept.
- **To be shown, not claimed:** that no end state adds anything a review did not show (apart from R2's addresses), and that no cycle is introduced. These are R5's, R6's, and § 17's tests 5 to 7, none of which exists yet.
- **Changed, and stated for the owner:** § 17 relies on changes to ADR 0006's concurrency rules: L1's exception for the readers of § 10 (a memory's publication or confirmed save, and an album journal's publication, rows (a) and (b)), L1 read with A3 for `memory_music`, L2 (several memory entries held `FOR SHARE`, which C4 and C8 rely on), L6's narrowing (§ 17's C7), L3's catalog locks, and § 4 step 3's engine lookup, together with §§ 1, 2, and 5's new atoms. Each is in [Open decisions](#open-decisions) under explicit approvals.
- Condition 6 as the owner set it asks that ADR 0006's guarantees and concurrency protections be **preserved**. Whether these changes meet it is for the owner to say. It is **recorded as an acknowledgement still to be given** and is not presumed.

**No exposure (conditions 1, 2, and 5).**

- **Nothing becomes public through this rule.** It changes which catalog title a served memory displays. It publishes no entry, opens no page, lists no album, and adds no sitemap or archive row.
- **No automatic exposure of the private catalog.** A title from an album that is neither listed nor journaled appears only on a memory whose review disclosed it and whose author confirmed it. No catalog command can substitute another album while the memory is served (§ 9). The named album never gains a page, a collection entry, or an address through a memory.
- **Takedown reveals nothing.** Every takedown is a subset (§ 7): unpublishing the memory removes the page, unpublishing the named album's journal turns the link into plain text, and archiving changes nothing. None introduces another album's title. None creates an address, with one recorded exception, R2's: closing an artist page can move a namesake credited on M from its suffixed address to the bare one (§ 7, owner condition 5). Because the rule reads no entry state, a served memory's music is identical whatever drafts, private texts, deleted entries, or unpublished translations exist, which § 4's test extends to memory pages for this rule.
- **No unauthorized address.** A named album links only to an album journal that is already served, at its served address, never to a collection page (pending above) or to an artist page that is not already open.

**Concurrency.** The rule adds no lock. It relies on § 10's:

| Scenario | What happens |
| --- | --- |
| **C1.** Publishing a journal of the named album B, against a publication or confirmed save of a memory M naming B | M share-locks B; B's journal publication takes B `FOR NO KEY UPDATE`. They serialize. If the second one's preview came before the first one committed, its disclosure now differs (M gains a link, or B's list gains M) and it fails `confirmation_stale` |
| **C2.** Unpublishing B's journal, against M's publication | They serialize on B. If the unpublication commits first, after M's preview, M's link presence differs from that preview, so M's publication is stale. If M runs first, the unpublication is a reduction on M |
| **C3.** Publishing or unpublishing a journal of an album that contains the recording but is not named | No effect on M's named album or its link, whatever the order. Artist links follow A5 and § 8, as in the table above |
| **C4.** Adding the recording to an earlier album, against M's publication | `addTrackToAlbum` share-locks M's entry first (§ 10's table), so it and M's publication serialize on the entry: the addition sees M served and is refused, or M's publication fails stale when the new album precedes the named one (otherwise M's atoms are unchanged and it commits). For a memory that is newly linking the recording in a confirmed save, § 10's write-mode lock on the added track and the re-read of containing albums do the same |
| **C5.** Re-dating or renaming a containing album, against M's publication | M share-locks every containing album; the edit holds it in a write mode. Stale or refused, as in § 10 |
| **C6.** M's confirmed save adding a recording, against an edit of an album containing it | The save locks its resulting links' containing albums (§ 10) and serializes with the edit |
| **C7.** M unpublished while B's journal publication, which lists M as gaining a link, commits | Nothing serializes them: unpublishing is a reduction and locks no album. The end state is a subset of B's review (M absent). Recorded like R4's reductions, and tested |
| **C8.** `deleteAlbum` or `removeTrackFromAlbum` on a containing album, against M's publication | The command share-locks M's entry and holds the album in a write mode. If it commits first, M's publication sees different atoms and fails stale; if M commits first, the command sees M served and refuses |

**Transition.** The rule ships no earlier than, or together with, everything it relies on: § 9's fingerprints and refusals for containing albums, § 10's locks (including the album journal's artist and album locks), the album journal's new disclosure lists, and the dialog changes above. Shipped alone, a catalog command could change a served memory's named album with no review.

- **Before** that change is deployed on any database, every memory served there is **unpublished** (public reads may also stay off meanwhile, but that alone is not enough: a memory that stays published cannot be published again, and a confirmed save reviews only its delta). After the deploy, each is published again through § 17's review, and only then are reads turned on. Otherwise the deploy itself would change served memories' named albums with no review, widening G8. Comparing the two rules is not enough: the old rule's result drifted with other journals' states, and nothing bound what the author reviewed then, so a memory whose two results agree today may show an album its author never reviewed. Alternatively, the record shows that the database had no served memory at the deploy, **the expected path for both current databases**. Either is recorded as R1's evidence.
- **A visible side effect:** unpublishing clears `published_at` and republishing sets a new one ([`publication/commands.ts`](../../src/modules/publication/commands.ts)), so a republished memory shows a new date and moves in `/memories`, "Recently written", and the Home. `first_published_at` and the slugs are kept. It is recorded under Consequences.
- A read-only comparison of the two rules may still run, as a diagnostic only.
- On 2026-11-12, the local database had nothing published, and the hosted database holds only synthetic data. The record is still required.
- Confirmation tokens minted before the change fail as stale, because their fingerprints bind different atoms. That fails closed.

**Tests** (real PostgreSQL unless stated; each a merge condition, with each mutation seen to fail):

1. **The rule matrix:** a memory linking a recording on albums A (earliest) and B (credited with no artist of the recording, and no namesake of one, for the whole-response assertion), across each journal state of A and of B (none, draft, private, served, unpublished, deleted, restored, and served with an unpublished translation), each archived state, and each listing state. The named album is always A, and it links exactly when A has a served journal. Two assertions:
   - the named-album part of M's music is identical across every state of B's journals;
   - with that fixture, M's whole response (only the framework's per-request key masked) is identical across them too. Where B does credit one, the only differences are artist links, and they follow the extended `publicArtists` set (§ 8) exactly.

   Mutation: preferring an album with a served journal fails.
2. **Collation:** two containing albums with the same year, whose titles order differently in code-point order and in the test database's default collation. The test first asserts that the two orders differ, so the mutation stays observable. It therefore needs a test database whose default collation is not `"C"` (the disposable database's image today uses a UTF-8 locale; the assertion fails loudly if that changes). Mutation: dropping `COLLATE "C"` fails.
3. **The memory oracle**, updated to this rule and implemented independently, against `readMemoryMusic` and the public page. It compares titles by their UTF-8 bytes, not with JavaScript's `<`.
4. **The review binds the identity:** each of these between M's preview and its confirmation makes it stale: re-dating or renaming a containing album, adding the recording to an earlier album, and publishing or unpublishing B's journal when B is named. With two containing albums of the same title, the review shows each one's year and artists. Mutation: dropping the album id from the fingerprint fails.
5. **The album journal's review:** publishing the named album's journal lists the served memories that gain a link or whose link moves, and the pages on which a credit becomes a link, and binds them. A memory published between the preview and the confirmation makes it stale. Mutation: share-locking the credited artists instead of `FOR NO KEY UPDATE` fails the concurrent case of test 7. An album journal publication that opens artist A between a memory's preview and its confirmation makes the memory stale; mutation: dropping the artists' link presence and address from the memory's fingerprint fails.
6. **Takedown:** the subset property for each row of the table above. Deleting the named album, and removing the recording from it, are refused while M is served. Archiving and restoring it leave M's response identical.
7. **Concurrency:** C1 to C8 over real connections, seen waiting, then refusing or completing as described, plus an album journal publication that opens an artist's page against a memory publication crediting that artist.
8. **Transition:** on a fixture with two served memories, one whose two rules agree today and one whose rules differ, the procedure unpublishes both before the deploy and asserts that none is served at the deploy; the diagnostic reports the one whose rules differ.
9. **No collection link:** no memory response contains a `/collection` address, for a named album that is listed.
10. **Dialogs (browser):** the three dialog changes above, including the "not otherwise public" and archived marks, in English and Portuguese, at desktop width and 390px.

## Residual risks

Each risk stays open until its criterion is met. Documenting a risk does not resolve it. **R1 to R7 here are this ADR's residual risks,** not ADR 0006's owner decisions R1 to R5; every "R" label in this ADR means a residual risk unless it says "ADR 0006".

| # | Cause | Consequence | Mitigation | Test evidence required | Criterion |
| --- | --- | --- | --- | --- | --- |
| **R1. A memory's named album changes through another album's journal** | [`memory-music.ts`](../../src/modules/publication/memory-music.ts) names, for a linked track, the album with a served journal first, otherwise the earliest by year, title, and id. Another album's served state is therefore an input to a memory page. | Publishing or unpublishing album B's journal changes the album title and link a served memory M shows. Neither M's review nor B's discloses it, and unpublishing B asks for no token. This is catalog wording changing on a public page without confirmation (G8). It reveals nothing private: the album is catalog data, and a link goes only to a served page. | **Decided as a direction on 2026-11-13 (decision 21), specified in § 17, not implemented.** Option (a): the named album depends only on catalog rows (earliest containing album by year, code-point-ordered title, and id), its identity is bound into the memory's review, the named album's own journal publication discloses the memories it links from, and § 9 refuses, while the memory is served, every catalog change that would alter it. Option (b), disclosing affected memories in every publication review, was rejected: unpublishing is a reduction with no token, so it is not covered. A stored, author-chosen album per link would need a Studio design decision (see [Revisit when](#revisit-when)). | § 17's tests 1 to 10, including the rule matrix over every journal state of both albums, the collation test, the review-binding and takedown tests, C1 to C8 over real connections, and the transition check, each with its mutation seen failing | **Blocks the first hosted public page** until § 17 is implemented, its tests pass, the transition record (every served memory republished through § 17's review, or none served) exists for the target database, and the owner reviews them as G8 evidence. G8 cannot be waived, so it is never accepted under G7. The direction is chosen. **§ 17 does not proceed until the owner records all three acknowledgements** in [Open decisions](#open-decisions): § 17's visible consequence, condition 5 with R2's exception, and condition 6 with the rule changes. **It is not resolved by this document.** |
| **R2. Namesakes and derived artist addresses** | Artist addresses are derived from names over the visible set ([`artist-address.ts`](../../src/modules/publication/artist-address.ts)). A suffix depends on which namesakes are visible, and listing, unlisting, archiving, publishing, and unpublishing change that set. | An artist page's address can change without its own review. The old address answers the identical unknown-address `404` and inbound links break. **An address can also come to identify a different artist:** while two namesakes are visible neither has the bare name, so `/artists/x` can serve A1, then answer `404`, then serve A2 once A1's page closes, and an old link to A1 then shows another artist. Nothing private is revealed (the addresses come from public names). Additions disclose the change they cause (A5, § 6). Reductions (unlisting, archiving, unpublishing) do not. | Additions are bound by the listing and publication reviews. The definitive fix is a stored, retained artist slug (a migration and its own decision), the owner decision already open under G1 in the [hosted-launch plan](../hosted-launch.md) § 6 | The namesake matrix: addresses equal across the artist page, the `/artists` archive, and the Home; the old address answering a byte-identical `404` with no `308`; disclosures listing the address changes that listing and publication cause | **Blocks S4** until the owner records the G1 decision: either a stored artist slug, implemented and tested before S4, or the derived addresses accepted in writing in #47 with this evidence. It does not block accepting this ADR. |
| **R3. Slug reservation lost after restoring an older backup** | The reservation lives only in `albums.collection_slug`. The backup inventory carries no slugs (`ops/backup/inventory.sql`; [ADR 0007 § 3](0007-hosted-backups-and-retention.md#3-what-a-recovery-may-do)), so a backup taken before an album's first listing has no slug for it. | After such a restore, an address that was public is free. Another album could later be listed at it, and an old link would show a different album. Nothing private is revealed. Journal slugs published after a backup have the same limit today. | A restored copy starts with nothing listed (§ 14). **Proposed procedure:** on a restored database, no first listing is made until the owner has compared its collection slugs with those of the newest available state. Carrying collection slugs (public text) in the inventory would make this mechanical, but it needs an ADR 0007 amendment, because the inventory carries no slugs today. | `recovery-demote.sql` clears listings and keeps slugs; `recovery-check.sql` fails while any album is listed; if the inventory is amended, `reconcile` reports a collection slug missing from the candidate | **Blocks any first listing on a restored database** until the comparison is recorded, or the owner accepts the gap in writing for that recovery. It does not block S4 by itself: no hosted backup exists yet, and G6 is open. It does not block accepting this ADR. |
| **R4. Reductions and namesakes during a listing or a publication** | Under § 10 (not built), a listing, and an album journal's publication, unpublication, and deletion, and unlisting and archiving, lock the album's credited artists `FOR NO KEY UPDATE`. Any publication or confirmed save that renders one of those artists locks it too (`FOR SHARE`, or `FOR NO KEY UPDATE` for an album journal's publication), so it serializes, and so do journals of the same album (album row). What stays unserialized: a **memory's unpublication or deletion** (it locks no catalog row) during a listing or during an album journal publication whose review lists that memory (§ 17, C7), and **namesakes**, which are different artist rows. | A reduction during a listing can remove a page or a link that the listing's review showed as existing. The end state is a subset of what the review showed, plus the listing's own disclosed additions. Namesakes can end with addresses neither review disclosed: two namesakes, each disclosed with the bare address, can both end suffixed (A5 records the same). No undisclosed photograph and nothing private can appear. | The artist lock and the album-row lock (§ 10). The address effect is R2's, and so is its definitive fix. | Real-connection tests: a memory publication crediting a listed album's artist, concurrent with the listing, is seen to serialize; § 17's C7; with a concurrent memory unpublication, the end state is a subset of the listing's review plus its additions; addresses are equal across surfaces; a replaced address answers the identical `404` | The reduction part may be accepted in writing at G7, as a verified, bounded residual. The address part follows R2's criterion. |
| **R5. A catalog edit and a new entry's publication** | An entry created after a catalog command's locking statement is not locked by it (A3's class). Without § 10's publication share locks, its publication could commit between the command's decision and its commit. | A catalog edit would reach a just-published page that no review showed: a **G8** event, not a likelihood question | **Addressed by design (§ 10), not built; open until its tests pass:** publications and confirmed saves take `FOR SHARE` on the catalog rows their fingerprint binds, so they wait for the edit and then fail as stale. Catalog commands keep their write modes. | Real-connection tests: (1) a catalog command holds its rows; an entry is created, previewed, and published; the publication is seen waiting, then refused as `confirmation_stale`; (2) the same while `addTrackToAlbum`, `setAlbumTracklist`, and `importMusicRelease` add a memory-linked track to another album; (3) mutations that remove the publication's share lock, or the write-mode lock on added tracks, each fail | **Blocks the first hosted public page** until the test passes and the owner reviews it as G8 evidence. G8 cannot be waived, so this is never accepted under G7. |
| **R6. Deadlocks** | Any catalog command that takes a row outside § 10's order. A5's recorded three-way cycle comes from `createTrack` inserting before locking, which § 10 would forbid, so R6 would narrow to commands the static lock-order test has not caught. | One request aborts with `40P01` and writes nothing. Availability only, but **takedowns** (album journal unpublication and deletion, unlisting, archiving) now take album and artist write locks, so a takedown can wait on a catalog transaction or be the request aborted; it is retried. | § 10's single order, `createTrack` reordered, and the static lock-order test over every guarded command | A5's deadlock scenario re-run with `createTrack` reordered, now completing without `40P01`; an album journal publication against `updateTrack` on one of its edition's tracks, with `updateTrack` reordered, completing without `40P01`; the static lock-order test, which covers `createTrack`, `importMusicRelease`, and `updateTrack` | Accepted only in writing at G7, after the re-run shows A5's cycle closed |
| **R7. A provider replaces an image under the same Image ID** | The Cover Art Archive serves the image. Refrain stores only its address. | A reader could see an image the author never reviewed | The cover switch (§ 12), the always-allowed takedown (§ 7), and the item 6 review | The cover switch tests (§ 15) | Part of the deployment-gate item 6 review; covers stay hidden on a hosted surface until it is recorded |

## Effect on existing decisions

The texts below change in two steps, and none changes before acceptance. **Read every bullet below as both:** at acceptance, a pointer saying "decided by ADR 0009, not built"; at build, the rewrite described. Present tense in a bullet describes the text after the build.

- **At acceptance,** each one gains a pointer to this ADR marking the change as **decided, not built**. Text that records implemented behaviour or verified evidence (Security's implemented-controls and required-tests rows, the release gates' residuals, ADR 0006 § 14's G8 status, the evidence files) keeps its wording, with a note: "superseded by ADR 0009 once built and tested".
- **New requirement rows** (Security § Required tests) are added at acceptance, marked "not built". **Existing rows, and the predicate's closing sentence below,** change only in the build pull requests, as the next point says.
- **In the pull request that builds and tests each part,** that text is rewritten to describe the new behaviour, as listed below. For example, the memory-music row is rewritten only with § 17's code and tests, and G8's status only when the owner has reviewed the evidence.

The documents affected:

- **[Security § Publication predicate](../security.md#publication-predicate):** the closing sentence about catalog metadata becomes "…only in the context of publicly visible entries, **or of an album listed in the public collection** ([ADR 0009](0009-public-music-collection.md))". The required-tests list gains § 15's tests, at acceptance, as requirements marked "not built".
- **[Security § Implemented (M3.7)](../security.md#implemented-m37-on-its-branch-until-merged), the memory-music row:** a recording names the earliest album that contains it, whatever any entry's state (§ 17). Its mutation "an unserved album preferred" becomes "an album with a served journal preferred", and the row gains § 17's tests. § 17's tests also join [Security § Required tests](../security.md#required-tests) at acceptance, as requirements. [Evidence: M3.7](../evidence/m3-7.md) stays as the record of what was verified then.
- **[Security](../security.md), the M3.2 row "Artwork cannot change while a published journal shows the album":** removal becomes always allowed (§ 7); a change of cover stays refused.
- **[Security § Public page release gates](../security.md#public-page-release-gates), the G8 bullets of the M3.5, M3.7, M3.8a, and M3.8b residuals:** each points to §§ 9, 10, and 17. M3.5's photograph window is closed by the album journal's artist lock (§ 10, and R5), its renames and credit wording by § 9's refusals, and its "artist page reappearing through a journal whose review did not list it" by the reductions' artist lock (§ 10), each once tested. In particular, M3.7's "which album a recording names" and "Its links also appear and disappear as other journals are published or unpublished" become: the named album depends only on catalog rows that § 9 guards, and link additions are disclosed by the publication that causes them.
- **ADR 0006** (by a pointer under *Amendments*, not by editing its decisions):
  - §§ 1, 2, and 5: catalog atoms join the publication disclosure and fingerprint, and a memory link's atom gains its rendered wording and its named album's identity (§§ 9 and 17); an album journal's disclosure gains the served memories that name its album;
  - L5: "Both previews take no lock" covers three previews (§ 6);
  - § 3: "Only the two preview operations mint tokens" becomes three, and the signing functions gain the `list_collection` purpose and the `cc1` family (§ 6);
  - § 9: a third preview, `previewCollectionListing`, mints tokens. The token family `cc1` and the listing writers join the static scans. "The Journals module wraps; presentation never imports Publication" gains a second wrapper module: **Catalog wraps the listing commands** for the Studio (§ 14);
  - § 10: the new commands join its list;
  - § 12: the new error codes (§ 6's listing codes, and Catalog's `cover_display_disabled`) join its list of codes;
  - A3: cover removal is always allowed, also for an archived album; the refusal of a cover change extends to listed albums (§ 9); a cover choice is refused `cover_display_disabled` while the cover switch is off (§ 12); **and A3's lock procedure changes**: the decision moves after the album row lock, and `removeAlbumArtwork` takes no entry locks (§ 10);
  - L1 and L2, read with A3: catalog commands and the listing may read entry-owned rows (`memory_music`, album journals) under those entries' `FOR SHARE`, as A3 allows for album journals, and memory entries may be share-locked (§ 10);
  - **L1, a narrow exception for the owner to approve:** the closed list of readers in § 10's table (an album journal's publication and confirmed save, a listing, a memory's publication or confirmed save, and every guarded catalog command of § 9 for late entries) decides from other entries' rows without their entry locks, each serialized through named catalog rows, with the windows listed there (§ 17's C7, R4);
  - **L6, narrowed for those atoms only:** a listed reduction, or a namesake's transition on another artist row, can commit between the comparison and the write; the end state is the review minus any reduction, except R2's derived artist addresses, which may change value (§ 10);
  - § 4 step 3 ("the engine takes no kind"): the engine looks up `album_journals` for its entry to take the album and artist locks, and `memory_music` to take a memory's catalog share locks and re-read its containing albums (§ 10);
  - L3: publications and confirmed saves take `FOR SHARE` on the catalog rows their fingerprint binds, after the entry lock. Publishing, unpublishing, and deleting an album journal take its album row `FOR NO KEY UPDATE`, and those three transitions, listing, unlisting, and archiving an album take its credited artists `FOR NO KEY UPDATE` (§ 10). The order is unchanged. **A3 and A5 each carry a note** stating that no entry transaction takes an explicit catalog lock: each gains a pointer to this amendment.
  - A4 and A6: the Home's Collection section; A6, item 1: artist addresses over the extended set (§ 8);
  - A5: the public artist set grows; its disclosure is computed against its own set; edits to shown artist names and credits are refused; no photograph is chosen or shown for a collection-only artist; **and A5's lock table is replaced by § 10's**, with its new album and track locks (A5's wider entry set for credit changes is kept, below);
  - § 14, G8: resolved by §§ 9, 10, and 17 once their tests pass and the owner reviews the evidence (R1 and R5 are G8 items).
- **[Security § Deployment gate](../security.md#deployment-gate):**
  - item 6 gains the collection as a surface, with `REFRAIN_COVER_DISPLAY_ENABLED` as the switch it says does not exist yet. Its removal procedure no longer says "unpublish first", because removal becomes always allowed.
  - item 7 gains the collection-only rule of § 8;
  - item 2 (redirect status and indexing reviewed) gains § 16's requirements.
- **[Hosted Launch](../hosted-launch.md):**
  - stage S4 gains § 16's site-wide `noindex` as a precondition of its protection change;
  - S4 step 5 ("Verify publicly … the sitemap") expects the sitemap's identical `404` and `X-Robots-Tag: noindex` while § 16 holds;
  - § 6 records R1 and R2 as launch blockers under G8 and G1.
- **[ADR 0007 § 3](0007-hosted-backups-and-retention.md#3-what-a-recovery-may-do):** the recovery demotion also unlists. It changes an accepted recovery procedure, so it is also an explicit approval ([Open decisions](#open-decisions)).
- **[ADR 0003 § 3](0003-relational-schema-conventions.md#3-published-slugs-stay-reserved-after-permanent-deletion):** a pointer to a second, album-scoped slug reservation, `albums.collection_slug`, playing `was_published`'s role (§ 2).
- **[ADR 0008 § 2](0008-interface-localization.md#2-routes):** a pointer to the new `/collection` and `/pt/collection` routes (§ 5).
- **[Product](../product.md), [Data Model](../data-model.md), [Architecture](../architecture.md), [Design System](../design-system.md), [Roadmap](../roadmap.md):** each records what is decided and, separately, what is built.

## Consequences

- **Positive:**
  - Readers can browse the collection before any writing exists.
  - Every public listing is a recorded, reviewed act, and imports stay private.
  - G8 gets one testable resolution for every public surface, including the gap between a publication's preview and its confirmation.
  - The rights review of covers is decoupled from building pages, and a takedown is always possible.
  - No new service, cache, copy of the catalog, or component is added.
- **Negative:**
  - Correcting a typo in a shown record means taking down every surface that shows it, editing, and confirming each again.
  - The guard touches every catalog writer, and each needs tests.
  - A5's freedom to rename public artists and reorder credits is withdrawn.
  - Collection addresses are permanent: an album that was listed can be archived but never deleted.
  - A second token family, with its own key derivation, needs its own tests.
  - Publication fingerprints become sensitive to catalog edits, so a catalog change during an open publication dialog makes it ask again.
  - While a memory linking a recording is served (§ 17): every album containing the recording is guarded for its title and year, adding the recording to an album through the tracklist commands is refused, and a containing album cannot be deleted.
  - An archived album is still named on a memory; only unpublishing the memory, or a confirmed save that removes the link, removes its title.
  - `importMusicRelease` is refused when the new album would precede a served memory's named album.
  - With the cover switch off, a hosted Studio cannot choose covers until the owner decides otherwise (§ 12).
  - The switch is off by default **everywhere**, local development and tests included: covers approved for local development (M3.2, M3.4) disappear and local cover choices are refused until the developer sets it to `true`. The build pull request updates [Development](../development.md)'s local setup, the test environment, and the browser tests that expect a cover, which set the switch explicitly.
  - A memory whose recording is also on a later album with a served journal no longer links to that journal (pending the owner's acknowledgement).
  - At the transition, a memory that was served is republished, so its `published_at` and its place in date-ordered lists change (§ 17). None is expected on the current databases.
  - Album journal publications that share a credited artist, and memory publications crediting it, serialize on the artist row.
- **Unchanged:**
  - the publication predicate for writing;
  - every journal and memory route, slug, and `308`;
  - `/albums` and its archive;
  - INV-1 to INV-5;
  - the `ct1` token's form, claims, key, and expiry (§ 9 changes what its fingerprint binds);
  - L4, and L5's rule that previews take no lock (now three previews) (L1 gains the narrow exception above and is read with A3 for `memory_music`, L2 now allows several memory entries held `FOR SHARE`, L3 is amended, and L6 is narrowed for the listed atoms, as § 10 says);
  - gates G1 to G7, which still block any hosted public page, and G8, until §§ 9, 10, and 17 are built, tested, and reviewed by the owner.

  Accepting this ADR closes no gate and authorizes no deployment, data transfer, switch change, or lifting of `noindex`.

## Open decisions

Product decisions 1 to 21 are settled, with four acknowledgements still to be recorded:

- **Owner condition 6 and § 17's rule changes:** § 17 relies on changes to ADR 0006's rules: the L1 exception, L1 read with A3 for `memory_music`, L2, L3, L6, and § 4 step 3, together with §§ 1, 2, and 5's new atoms (§ 17, "Condition 6"). The owner records whether condition 6 is met with them. If not, § 17 does not proceed as written.
- **§ 17's visible consequence:** a memory whose recording is also on a later album with a served journal names the earlier album and loses today's link to that journal. The earlier album may be one that is neither listed nor journaled, so its title, from the private catalog, replaces a public, journaled album's title on that memory, shown only after the memory's review marks it "not otherwise public" (condition 2). The owner records whether this is accepted, at acceptance. If not, § 17 does not proceed as written, and R1 needs another approach that meets decision 21.
- **Decision 17's "artist's name":** § 11 reads it as the first credit as the page shows it (`credited_as`, or the artist's name). The owner confirms that reading at acceptance.
- **Owner condition 5 and R2:** § 17 creates no address for the named album. But an artist-page takedown (unlisting, archiving, unpublishing) can still move a namesake credited on a memory from its suffixed address to the bare one, A5's derived-address exception (R2), and a bare address can come to identify a different artist than an old link meant. The owner records, at acceptance, whether condition 5 is met with that exception until the G1 decision for R2, or whether a stored artist slug becomes a precondition of § 17.

Explicit approvals at acceptance, one for **each ADR 0006 item under [Effect on existing decisions](#effect-on-existing-decisions)**, and for ADR 0007 § 3, because each changes an accepted rule:

- §§ 1, 2, and 5: catalog atoms in the disclosure and fingerprint ("Informational lines are not part of the set" ends for catalog wording), the memory link atom's wording and named album, and the album journal disclosure's new lists (§§ 9, 17);
- § 3: a third minting preview, and the `list_collection` purpose and `cc1` family (§ 6);
- § 4 step 3: the engine looking up an entry's album journal row and memory links to take catalog locks (§ 10);
- § 9: `previewCollectionListing`, the static scans, and Catalog as a second wrapper module (§ 14);
- § 10: the new commands; § 12: the new error codes;
- § 14: G8's closure criterion (§§ 9, 10, and 17, once tested and reviewed);
- L1's narrow exception, as the closed list of readers in § 10;
- L1, read with A3: catalog commands and the listing reading entry-owned rows, now including `memory_music`, under those entries' `FOR SHARE` (A3 granted it for album journals only);
- L2: several memory entries held `FOR SHARE` (the decision A3 says such commands need);
- L5: "Both previews take no lock" becomes three, `previewCollectionListing` included;
- L3: entry commands taking explicit catalog locks (§ 10), with A3's and A5's notes gaining a pointer to this amendment;
- L6: narrowed for the listed readers' atoms (reductions, and namesakes' transitions);
- A3: cover removal always allowed, also for an archived album (§ 7); its refusal of a cover change extended to listed albums (§ 9); and `cover_display_disabled` while the cover switch is off (§ 12);
- A3's lock procedure: the decision after the album row lock, and no entry locks for `removeAlbumArtwork` (§ 10);
- A4 and A6: the Home's Collection section, and artist addresses over the extended set (§§ 8, 11);
- A5: the public artist set grows, its disclosure is computed against its own set, renames of shown artists and credit edits on shown albums are refused, and no photograph is chosen or shown for a collection-only artist (§§ 8, 9);
- A5's lock table replaced by § 10's, with its new album and track locks (§ 10).
- ADR 0007 § 3: the recovery demotion also unlists (§ 14).

Pending owner decision (Studio):

- **Choosing covers on a hosted Studio while the cover switch is off.** Until decided, the choosing screens show candidates as text and offer no choice (§ 12).

Pending Studio design review (AGENTS § 6: nothing the V4.4 design does not show is presumed approved):

- § 14's *Public collection* panel, its two dialogs, and the albums list's "listed" marker;
- § 14's cover remove control outside the chooser, and § 12's text-only candidate screen with the cover switch off;
- § 17's dialog content changes: the year, credits, archived and "not otherwise public" marks, and link targets in the memory publication dialog; the named album in the confirmed-save dialog; and the two new lists in the album journal publication dialog.

Pending public design and copy review (AGENTS § 6; decisions 9, 10, and 18 approve only the sentence, the Home section, and the three link labels):

- the collection page as the V4.4 album-journal layout without its writing (§ 11);
- the collection archive's card (§ 11) and the artist page's collection card (§ 8);
- `/artists`' second count and its label (§ 8);
- the Home's Collection card variant (§ 11), and the placement of "Read the journal" and "Back to the collection";
- the collection pages' metadata description copy (§ 11).

Pending copy decision:

- **How several "Read the journal" links on one collection page are told apart** (§ 11). Proposal: each version's published date beside the label. Until it is approved, a collection page shows one link, to the presented journal. Decision 11 (both directions) is then met only for the presented journal: another served journal links to the collection page, but the collection page does not link back to it.

Pending, and **not needed by § 17**:

- **Whether a memory links its named album's collection page** when the album is listed. It would be a new kind of link on a memory page. Until the owner decides it, a memory never links to a collection page (§ 17).

What remains for the owner is in [Residual risks](#residual-risks):

- the G1 decision for R2, before S4;
- the recovery procedure for R3, and whether to amend ADR 0007's inventory.

## Revisit when

- Taking pages down to fix a shown record proves too costly. The confirmed catalog change, or the published snapshot, is then decided in a new ADR.
- A bulk listing is wanted. It needs its own acknowledgement decision.
- Addresses need to change. That needs a `308` design that respects INV-5.
- Artist photographs are wanted for collection-only artists, after deployment-gate item 7.
- Indexing is to be enabled: § 16's conditions.
- § 17's refusals of edits to albums that contain a memory-linked recording prove too costly. Storing the named album with each link, chosen by the author and bound by a foreign key to `album_tracks`, would then narrow the guard to that one album. It needs a schema change and a Studio design decision.
