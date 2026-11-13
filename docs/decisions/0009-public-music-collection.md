# ADR 0009: The Public Music Collection

- **Status:** **Proposed.** It is not accepted, and it changes nothing yet. Until the owner accepts it, the existing contract holds word for word: [Security § Publication predicate](../security.md#publication-predicate) ("Catalog metadata … public pages show it only in the context of publicly visible entries"), [ADR 0006](0006-publication-decision-and-acknowledgement.md) and its amendments A1 to A7, and gates G1 to G8. No code, schema, migration, data, hosting setting, or public surface changes because this file exists.
- **Date:** Proposed 2026-11-12. Revised the same day after the owner's review, which settled the product decisions recorded in [Owner decisions](#owner-decisions-2026-11-12).
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
12. **The first public opening uses `noindex`.** It is lifted later only after review and the owner's authorization.
13. No artist photograph is shown, **or can be chosen**, for an artist who is public only through the collection, in this first implementation.
14. The V4.4 design is not redesigned. The interface stays in English and Brazilian Portuguese, responsive, and readable without JavaScript.
15. No real data is imported into, or published on, the hosted database in this stage.

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
  - every album and track linked from a served memory, the artists credited on them (`album_artists` for a linked album, `track_artists` for a linked track), and **every album that contains a linked track**: a memory page names one of them for the track, namely the album with a served journal or else the earliest by year and title ([`memory-music.ts`](../../src/modules/publication/memory-music.ts)), so adding the track to an album, or renaming or re-dating any album that contains it, can change the memory page;
  - every artist with a public page.

  "Shown" is computed only from Publication fragments (§ 3).

### 2. Schema

One migration, through [`/refrain-db-change`](../development.md#database-changes), adds two nullable columns to `albums`:

| Column | Meaning | Constraints |
| --- | --- | --- |
| `collection_listed_at timestamptz NULL` | When the current listing was confirmed. `NULL` means not listed. | `CHECK (collection_listed_at IS NULL OR collection_slug IS NOT NULL)` |
| `collection_slug text NULL` | The collection address. It is set at the first confirmed listing, then **never changed or cleared**. | `UNIQUE (collection_slug)`; `CHECK (collection_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(collection_slug) <= 80)`, the same form as `entry_slugs` |

- **Both default to `NULL`.** Every existing album, and every future import, starts unlisted (decision 2). The migration sets no values: it lists nothing.
- **The application sets a slug only at the first listing,** so a slug is present exactly when the album was listed at least once. That plays the role of `was_published` in ADR 0003, without a history table. The database enforces only "listed ⇒ slug". The converse is the commands' rule, and an out-of-process writer is on G3's inventory (§ 14).
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
- either the approved sentence (decision 9) or the links to the album's served journals (§ 11).

**What it never shows or uses:**

- ratings, favourite marks, reflections, "still writing", margin notes, or excerpts;
- any count of entries;
- `collection_listed_at`;
- MBIDs, Image IDs, edition labels, countries, or any Studio-only value;
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
- the set of **served** entries.

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
- **Decided by the proxy.** [`src/proxy.ts`](../../src/proxy.ts) decides `404`, before any page renders, in every request form (document, `_rsc`, `.rsc`, `.segments`, `/_next/data`, percent-encoded spellings), as for the existing sections. **No collection address ever answers `308`.**

| Event | `collection_slug` | `collection_listed_at` | The address answers |
| --- | --- | --- | --- |
| **First listing** (slug `NULL`) | Proposed from the title by [`slug.ts`](../../src/modules/publication/slug.ts)'s normalization, with suffixes (`-2`, `-3`) for slugs that any album holds. A title that normalizes to nothing (for example, one written entirely in a non-Latin script) gets no proposal: the preview answers `slug_required`, and the author supplies one. **The author may replace a proposal** in the review (decision 7). It is validated (the `CHECK` form, at most 80 characters, not held by any album, listed or not, archived or not), shown in the disclosure, and bound into the token. Then it is written. | set | `200` |
| **Unlisting** | Kept | `NULL` | The identical unknown-address `404` |
| **Relisting** the same album | Kept. A slug input is refused (`slug_fixed`), and the review shows the existing address. | set | `200` at the **same** address |
| **Archiving** the album | Kept | Cleared in the same transaction | `404` |
| **Restoring** the album | Kept | Stays `NULL`. Restore never relists. | `404` until a confirmed relisting |
| **Renaming** the album | Kept: the slug does not follow the title | Unchanged (refused while shown, § 9) | Unchanged |
| **Deleting** the album | Refused (`collection_address_reserved`) while a slug exists. Archive instead. | n/a | n/a |
| **Collision** | The preview refuses a slug held by another album (`slug_taken`). A concurrent first listing of the same slug fails at commit on `UNIQUE` (`slug_taken`). Nothing is written, and the author previews again. | unchanged | unchanged |

- **Stable and never reused.** An album has one collection address for its whole life.
  - The application never changes or clears it.
  - `UNIQUE` keeps it from another album.
  - Refusing deletion keeps it reserved even after the album is no longer wanted.
- **No historical addresses.** Because a slug never changes, there are no previous addresses and no redirects to preserve. Changing an address would need its own decision, with `308` semantics that respect INV-5.
- **Out-of-process writers.** A deletion or edit through `psql`, a console, or a script could break these rules. They are on G3's inventory (§ 14).
- **A limit shared with journal slugs: restoring an older backup.** A backup taken before an album's first listing holds no slug for it. If such a copy were restored, that address would no longer be reserved, and another album could take it. The backup inventory deliberately carries no slugs ([ADR 0007 § 3](0007-hosted-backups-and-retention.md#3-what-a-recovery-may-do)), and journal slugs published after the backup have the same limit today. It is recorded here, not closed. Two mitigations:
  - a restored copy starts with nothing listed (§ 14);
  - the recovery review compares the restored albums with the newest available state before anything is listed again.

### 6. Listing: preview and confirmation

Listing follows ADR 0006's three-part model: a disclosure, a server-authenticated token, and the author's explicit act in the interface. **One album per confirmation** (decision 2). A bulk listing would need its own decision on how the acknowledgement is obtained ([ADR 0006 § 3](0006-publication-decision-and-acknowledgement.md#3-the-confirmation-token)).

- **`previewCollectionListing(db, author, { albumId, slug? })`** reads one consistent snapshot, takes no lock, and returns:
  - the album's state (never listed, unlisted, or listed);
  - the **collection address** that will be public: the existing slug, or for a first listing the proposed slug or the author's valid replacement;
  - every atom of § 3 exactly as the page will render it;
  - the **artist pages the listing would open** and the **public artist pages whose address would change**, as A5's review does;
  - the **stored cover**, or "none", **whatever the cover switch says** (§ 12), and separately whether the switch currently shows it;
  - the **served journal pages that will gain a link** to this collection page (§ 11);
  - a confirmation token.

  It refuses:
  - an archived album;
  - an album with no reference edition or no tracks (`nothing_to_list`);
  - an invalid or taken slug, or a missing one where none can be proposed (`slug_required`);
  - a slug input for an album that already has one.
- **The token** reuses ADR 0006's machinery: an HMAC over claims, a key derived from the application secret through the Identity module, binding to the author's user and session, a 15-minute expiry on the database clock, no storage, never logged or echoed, and a refusal carries none. It differs in four ways:
  - its own prefix, `cc1.`;
  - its own HKDF `info` string, `refrain/confirmation-token/collection1`, under ADR 0006's rule that "a new use of the secret gets a new `info` string";
  - its purpose, `list_collection`;
  - the album id in place of the entry id and locale.

  Its fingerprint is the SHA-256 of the canonical JSON of the album id, the operation, the slug, every atom of the disclosure, and the album's `updated_at` as the state stamp. The atoms are bound directly and are the primary guarantee.
- **`listAlbumInCollection(db, author, { albumId, slug?, confirmation })`** runs in one transaction:
  1. Zod, then the token's form, key, MAC, purpose, actor, and album binding, all **before** any lock.
  2. The locks of § 10.
  3. Refuse an archived album.
  4. The expiry, on `clock_timestamp()` after the locks.
  5. Recompute the disclosure from the locked rows, and refuse `confirmation_stale` (fresh disclosure, no token) on any difference.
  6. Write `collection_listed_at = clock_timestamp()`, and `collection_slug` if it was `NULL`.

  An already listed album with an unchanged disclosure is a no-op.
- **Error codes** are ADR 0006's (`invalid_input`, `unavailable`, `confirmation_required`, `confirmation_invalid`, `confirmation_expired`, `confirmation_stale`), plus:
  - `album_not_found`, `album_archived`, `nothing_to_list`;
  - `invalid_slug`, `slug_required`, `slug_taken`, `slug_fixed`;
  - `collection_address_reserved`.

  Every failure writes nothing.
- **The explicit acknowledgement is mandatory**, as in ADR 0006 § 3:
  - the token exists only in the dialog's state and leaves only from its confirm control;
  - no code mints and consumes a token in one operation;
  - no autosave, retry, script, migration, or import lists an album.

### 7. Unlisting and takedown

These operations only take something away. Each **needs no token** (ADR 0006, owner decision R4), the interface asks first, and each is always allowed, including while Cover Art Archive, Wikimedia Commons, or MusicBrainz is unreachable.

| Operation | Effect |
| --- | --- |
| `unlistAlbumFromCollection` | Clears `collection_listed_at` and keeps the slug (§ 5). Artist pages that existed only through this listing close. |
| Archive a listed album | Unlists it in the same transaction |
| Remove an album's cover | **Always allowed**, including while a journal is served, while the album is listed, and **while the album is archived** (archiving does not hide a served journal's page). **This amends A3**, which today refuses removal while a journal is public, and drops `removeAlbumArtwork`'s refusal of archived albums. Removal is the cover takedown path, and the fallback frame shows instead. |
| Remove an artist's photograph | Always allowed, as A5 already says |
| Unpublish or delete a journal or memory | Unchanged (ADR 0006) |

The atoms public after each operation are a subset of the atoms public before, with unchanged values (tested, § 15), with **one recorded exception**. Unlisting, or archiving an album or an artist, can remove a namesake from the visible set. The other artist's derived address then changes from its suffixed form to the bare one ([`artist-address.ts`](../../src/modules/publication/artist-address.ts)), and the old address answers the unknown-address `404`. It is the A5 residual for derived artist addresses: it reveals nothing private, and a stored artist slug would remove it.

### 8. Artist pages and photographs

- **The public artist set becomes A5's set plus the artists credited** (`album_artists`, never `track_artists`) on a listed album, while the artist is not archived.
- **Addresses** are still derived from names over the whole visible set ([`artist-address.ts`](../../src/modules/publication/artist-address.ts)). A listing can open pages and change a namesake's address, and both are in its disclosure and fingerprint (§ 6).
- **An artist page lists** the artist's served album journals (as today) and its listed albums, each linked to its collection page.
- **Lists of artists (amends A6, item 1):**
  - every read that derives artist addresses (the artist page, the `/artists` archive, and the Home's Artists section) computes them over the **whole** extended visible set, so a namesake gets the same address everywhere;
  - the `/artists` archive lists every artist with a page, with two counts: served album journals and listed albums;
  - **proposed** ([Open decisions](#open-decisions), item 4): the Home's Artists section keeps A6's choice, artists with served journals only.
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

| Command | While the record is shown |
| --- | --- |
| `updateAlbum`: title, year, credits (adding, removing, order, `credited_as`), and **reference-edition fields** (label, date, country) | Refused for a shown album, including an album that contains a memory-linked track (§ 1). **This narrows A5**, which allowed reordering, credit wording, and credit removal. |
| `setAlbumTracklist`, `addTrackToAlbum`, `removeTrackFromAlbum`, `moveTrackInAlbum` | Refused for a shown album, and whenever they would add a track linked from a served memory to any album (that can change the album the memory names) |
| `createTrack` **with an `albumId`** (it appends to that album's tracklist) | Refused for a shown album. Without an album, allowed: a new track is linked from nothing. |
| `importMusicRelease` reusing an existing recording | Refused when a reused recording is linked from a served memory and the new album would become the album that memory names (§ 1). Otherwise allowed. |
| `updateTrack`: title, length, credit, track artists | Refused for a track on a shown album or linked from a served memory |
| `archiveTrack`, `restoreTrack` | Allowed: no public read depends on a track's archived state, and the collection page lists the reference edition's tracks as they are |
| `updateArtist`: the **name** | Refused for an artist with a public page, credited on a shown album, or credited on a memory-linked track. **This narrows A5**, which allowed renames. |
| `updateArtist`: sort name, kind, identifier | Allowed: no public read uses them. A static test asserts that the Publication reads do not select these columns. |
| `archiveArtist` | Allowed (a reduction, as A5 says). The credit renders as plain text. |
| `restoreArtist` | Refused when it would open a page or change a shown credit's rendering |
| `setAlbumArtwork` | Refused for a shown album (A3, extended to listed albums) |
| `setArtistPhoto` | Refused while the artist has any public page (A5), and always for a collection-only artist (§ 8) |
| `removeAlbumArtwork`, `removeArtistPhoto`, unlist, archive album | Always allowed (§ 7) |
| `restoreAlbum` | Allowed: it never relists (§ 5). Among public reads, only the collection rule depends on `albums.archived_at`. |
| `linkAlbumToMusic`, `linkArtistToMusic` | Allowed when they fill identifiers only, which no page shows. Refused for a shown album if linking would create its reference edition. |
| `importMusicArtist`, `createAlbum`, `createArtist`, and `importMusicRelease` outside the refusal above | Allowed: a new record is not shown, and reused artists and recordings are not changed |
| `deleteAlbum`, `deleteArtist`, `deleteTrack` | A listed-once album is refused (§ 5). Otherwise the foreign keys already refuse a referenced record (`RESTRICT`). |

**Closing the gap at publication time (amends ADR 0006 § 2, and strengthens it).** Refusal alone leaves one window: while a journal is unpublished its album is not shown, so a catalog edit made **between a publication's preview and its confirmation** would reach the page unreviewed. Therefore:

- **the catalog atoms each page renders join the publication disclosure and fingerprint**, as A5 already did for artist pages:
  - for an album journal: title, year, edition label, credits as rendered, each track's title, credit, and order, the stored cover or none, and the presence and address of the collection link;
  - for a memory: each link's rendered title, its credited artists, and the album named for each linked track (title and address);
- **a catalog edit in that window makes the publication stale** (`confirmation_stale`, the fresh disclosure, no token);
- **the confirmed save (amends ADR 0006 §§ 1 and 5):** a memory link's atom gains its rendered wording (title, credits, named album). Today a link is bound by id only, so a track not yet linked could be renamed between `previewPublicChange` and the save. An added or reordered link's wording is now part of the delta, so such a rename makes the save stale.

ADR 0006's "Informational lines are not part of the set" therefore ends for catalog wording. That is the resolution G8 asks for.

**When a journal is also published.** Unlisting alone does not make the record editable while a served journal or memory still shows it.

- **The Studio's refusal names every kind of surface that shows the record**: the collection page, and each journal and memory by its Studio title. It is a private, authorized response.
- **The author unpublishes those** through ADR 0006's own unpublish, which asks first, edits, then republishes each through ADR 0006's full preview and confirmation. Each confirmation now binds the new catalog wording.
- **Nothing in ADR 0006 is weakened:**
  - there is no new way to publish;
  - every reappearance is reviewed;
  - unpublishing keeps the slugs, the publication history, `first_published_at`, and the reflection flags;
  - a previous address still answers as INV-5 says.
- **The cost** is that the pages are briefly absent and the author confirms each again. It is recorded as a consequence. If it proves too high, the confirmed catalog change in [Alternatives](#alternatives-considered) is the next step, through its own decision.

**What remains outside the guard, recorded rather than accepted as harmless:** what external providers serve (an image replaced at the Cover Art Archive under the same Image ID). § 12's cover switch and the takedown path bound it, and the rights review records it.

### 10. Locks and concurrency

- **Order, for every command in § 6 to § 9:**
  1. entries `FOR SHARE`, in ascending id order: every album journal of the albums involved, as A3 and A5 already do, and **every memory that links any album involved, any track involved, or any track on an album involved, whatever its state**. That includes the memories linking the recordings that `importMusicRelease` reuses, which therefore takes entry locks for the first time;
  2. then albums, in ascending id order (`FOR NO KEY UPDATE` for a write to the album, as A3 does, so that the foreign-key `KEY SHARE` locks of journal and memory inserts are not blocked; `FOR SHARE` otherwise);
  3. then artists, in ascending id order;
  4. then tracks.

  **Share-locking memory entries is new.** A3 and A5 lock album-journal entries only, and A3's note on L2 says that any other command holding several entry locks needs its own decision. **This is that decision:** several memory entries may be held `FOR SHARE`, in the same ascending id order, interleaved with the album journals in one sorted list. No entry command waits on a second entry, so no cycle forms among them.

  No entry command takes an explicit catalog lock (L3 unchanged). **Listing share-locks the album's own journal entries first,** because the served-journal links it discloses depend on them. The artist pages it discloses can also depend on other albums' journals, which it does not lock: that is the residual window below.
- **Publication against catalog edits.** A publication takes its entry `FOR UPDATE`. A catalog edit holds that entry `FOR SHARE` before deciding. Either the edit commits first and the publication's fingerprint, which now binds catalog atoms, fails as stale; or the publication commits first and the edit then sees the record shown and refuses.
- **Listing against catalog edits.** Listing locks the album's journal entries `FOR SHARE`, the album `FOR NO KEY UPDATE`, then its credited artists `FOR SHARE`. An edit that holds one of those rows makes the listing wait and then fail as stale. A listing that commits first is seen by the edit, which then refuses.
- **Residual windows, recorded and not closed:**
  - **Concurrent page openings.** A publication **of another album's journal** that opens or closes the same artist page, or changes a namesake's address, while a listing runs is not serialized with it. The page ends as one of the two reviews described (A5's class).
  - **Another album's journal changes a memory's named album.** A memory names, for a linked track, the album with a served journal, or else the earliest one. Publishing or unpublishing **another** album's journal can change which album a served memory names, and that publication's review does not show it. Recorded as A5's class: the named album is a catalog record already in the catalog, and nothing private is shown. Closing it would mean disclosing affected memories in the publication review, which is a follow-up.
  - **Late entries.** An entry created after a command's locking statement is not locked by it (A3's class).
  - **Deadlocks.** A command that takes rows outside this order (`createTrack`'s foreign-key locks, as A5 records) can deadlock. PostgreSQL aborts one request with `40P01`, and nothing is written.
- **Isolation.** The default `READ COMMITTED` is enough, because every decision is made by a statement that runs after the locks.

### 11. Public surfaces

Every surface reads only through the Publication module's reading entry point, is rendered per request in one pass (`instant = false`), is sent with `Cache-Control: no-store`, and prerenders nothing of the collection ([ADR 0006 § 11](0006-publication-decision-and-acknowledgement.md#11-public-reads-and-caches), A2). **The V4.4 design is not redesigned, and no new component is added:**

- **Collection page** (`/collection/<slug>`): the V4.4 album-journal layout without its writing.
  - It has the cover frame, title, artists, year, and the tracklist with durations.
  - It has no rating stars, favourite circles, or per-track "not written yet" labels (decision 8).
  - With no served journal, it shows the approved sentence (decision 9), once, in the place where the journal's writing would begin.
  - With served journals, the sentence is replaced by links to each one: the title of the version `versionPreference` selects, at its served `/albums/<slug>` address. There is no excerpt, no rating, and no `308` (decision 11).
- **Album journal page** (`/albums/<slug>`): unchanged, plus **one link to the album's collection page when the album is listed** (decision 11). The link's presence depends only on the listing, never on other writing.
- **Collection archive** (`/collection`): every listed album once, linked to its collection page, built from the existing album-archive components.
- **`/albums` archive:** unchanged. It lists served album journals only (decision 6).
- **Artist pages and `/artists`:** § 8.
- **Home:**
  - **This amends A4 and A6:** the Home may also show a discreet section, "Collection" / "Coleção", with **at most four** listed albums (title, artists, year, cover or fallback, collection address), newest `collection_listed_at` first, using the Home's existing album cards, and a link to `/collection` in the pattern of the other sections' "All …" links.
  - A4's switch-off rule is unchanged: with reads off, the section is empty and the Home is identical whatever the database holds.
- **Metadata:** title, description, canonical address, and Open Graph tags from the § 3 atoms only. No Open Graph image is generated.
- **Indexing at the first public opening** (decision 12):
  - every collection surface (`/collection`, `/collection/<slug>`, and their `/pt` forms) sends `<meta name="robots" content="noindex">` and an `X-Robots-Tag: noindex` header;
  - they are absent from the sitemap;
  - `robots.txt` does **not** disallow them, so that crawlers can read the `noindex`.

  `noindex` is fixed in code, not in an environment variable. Removing it is a reviewed pull request that needs the owner's written authorization.
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
  - **On a hosted deployment,** the owner turns it on only after recording the deployment-gate item 6 review. Local development may turn it on.
  - **It can only hide.** Listing and publication disclosures bind the **stored** cover whatever the switch says (§ 6, § 9), so a cover shown after the switch is turned on is one that a review disclosed. **Limit:** journals published before § 9's fingerprint rule is implemented did not bind their cover (ADR 0006 kept covers out of the fingerprint). The item 6 review therefore covers every cover the deployment would show, not only those that reviews disclosed.
- **An Image ID is not a licence.** Choosing an image in the Studio, or the Cover Art Archive serving it, says which image the author prefers. It grants no right to display it publicly. The Cover Art Archive states that its images are "copyrighted by their respective copyright owners".
  - Only the owner's recorded item 6 review authorizes hosted display. No document, test, or agent may treat an Image ID approval, a successful fetch, or this switch's existence as that authorization.
  - The same holds for photographs and item 7.

### 13. Languages

[ADR 0006 A7](0006-publication-decision-and-acknowledgement.md#a7-the-pt-surfaces) applies in full:

- `/collection…` and `/pt/collection…` get the same visibility decision, the same `404`, and the same headers per section.
- Interface strings come from `src/i18n/` and `src/i18n/studio/`, and a missing functional translation is a defect.
- The approved sentence ships in both languages (decision 9).
- Labels not yet approved (the section heading's link, the journal ↔ collection links) need the owner's wording in both languages before they ship ([Open decisions](#open-decisions)).
- Catalog metadata is shown as stored and never translated.
- The interface language never decides what is listed.

### 14. Authorization, the Studio, and writers outside the commands

- **Commands and actions.** Every new command takes the `AuthorizedAuthor`. Every Server Action awaits `authorizeAuthor`, runs through `perform` (the exact `Origin`), and validates with Zod inside the command. Each action joins the HTTP suite's table, and the static scans cover the new files.
- **The Studio**, in English and Portuguese, uses existing Studio components and the M2.3 dialog pattern:
  - on each album's page, a *Public collection* panel: never listed, listed, or unlisted, and the address;
  - **Add to the public collection…**, a review dialog listing every atom of § 6, with the slug field only on a first listing;
  - **Remove from the public collection…**, behind a confirmation;
  - refusals as in § 9;
  - a "listed" marker in the albums list;
  - no photograph control for collection-only artists.

  There is no bulk control. Administrative controls never appear on public pages.
- **Module ownership.** The listing, unlisting, and preview commands belong to the **Publication** module. It owns public state and the confirmation tokens, and it writes only `albums.collection_listed_at` and `albums.collection_slug`, as the one checked writer of listing state (ADR 0006 § 9).
  - `archiveAlbum` stays in Catalog and clears the listing through a Publication function, the way Catalog commands already ask [`catalog-exposure.ts`](../../src/modules/publication/catalog-exposure.ts) whether a record is shown.
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

- **Schema:**
  - the constraints of § 2;
  - the migration on fresh and populated databases;
  - every existing album stays unlisted.
- **Oracle:**
  - an independent implementation of § 3 and § 8, compared with every collection read over the state matrix (listed or not × archived or not × journal and memory states × artist archived × namesakes);
  - the existing oracles unchanged.
- **No inference (§ 4):** for each public collection surface, in both languages and every request form, the whole response for a listed album with each kind of unpublished writing (draft, private, deleted, restored, unpublished translation, unflagged reflection) equals the response with no writing.
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
  - cover removal allowed while a journal is served, for an archived album, and while the provider is down;
  - the subset property.
- **G8 (§ 9):**
  - each row refused while shown, with no row changed, and allowed while not shown;
  - the static coverage test over every catalog writer;
  - a catalog edit between a publication's preview and its confirmation makes it `confirmation_stale`, for an album journal and for a memory;
  - a rename of a track between a memory's `previewPublicChange` and its save, when the save adds or reorders that link, makes the save stale;
  - **memory-named albums:** adding a memory-linked track to an album (tracklist commands, `createTrack`, `importMusicRelease`), and renaming or re-dating an album that contains one, are refused while the memory is served;
  - renaming an artist credited only on a memory-linked track is refused;
  - the Publication reads select no `sort_name` or `kind`;
  - the take-down, edit, republish path restores the pages with their slugs and history.
- **Artist pages (§ 8):**
  - a publication that gives a collection-only artist a journal page discloses it as opening, with its stored photograph, and goes stale when that photograph changes;
  - addresses are equal across the artist page, the `/artists` archive, and the Home for namesakes split between the collection and journals;
  - a collection-only artist shows no photograph, and `setArtistPhoto` refuses for one;
  - the namesake exception of § 7 is the only non-subset outcome.
- **Concurrency (§ 10):**
  - over real connections, listing and publication each against a rename, a credit change, a tracklist change, an artwork change, and each other, seen waiting and then refusing or completing as described;
  - a memory's publication against an edit of a track it links;
  - static checks of the lock order in every guarded command, memory entries included.
- **Switches:**
  - the HTTP switch-off matrix over the new routes in both language forms;
  - the Home identical with reads off;
  - the cover switch off means no Cover Art Archive URL in any response, Studio included, and the fallback frame.
- **Indexing:**
  - `noindex` in the markup and the header on every collection surface;
  - absent from the sitemap;
  - not disallowed in `robots.txt`.
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

## Effect on existing decisions, on acceptance

These texts change in the same pull request that accepts this ADR. None changes before acceptance.

- **[Security § Publication predicate](../security.md#publication-predicate):** the closing sentence about catalog metadata becomes "…only in the context of publicly visible entries, **or of an album listed in the public collection** ([ADR 0009](0009-public-music-collection.md))". The required-tests list gains § 15.
- **ADR 0006** (by a pointer under *Amendments*, not by editing its decisions):
  - §§ 1, 2, and 5: catalog atoms join the publication disclosure and fingerprint, and a memory link's atom gains its rendered wording (§ 9);
  - § 9: a third preview, `previewCollectionListing`, mints tokens. The token family `cc1` and the listing writers join the static scans.
  - § 10: the new commands join its list;
  - A3: cover removal is always allowed, also for an archived album;
  - L2, read with A3: memory entries may be share-locked (§ 10);
  - A4 and A6: the Home's Collection section; A6, item 1: artist addresses over the extended set (§ 8);
  - A5: the public artist set grows; its disclosure is computed against its own set; edits to shown artist names and credits are refused; no photograph is chosen or shown for a collection-only artist;
  - § 14, G8: resolved by § 9, once its tests pass and the owner reviews the evidence.
- **[Security § Deployment gate](../security.md#deployment-gate):**
  - item 6 gains the collection as a surface, with `REFRAIN_COVER_DISPLAY_ENABLED` as the switch it says does not exist yet. Its removal procedure no longer says "unpublish first", because removal becomes always allowed.
  - item 7 gains the collection-only rule of § 8.
- **[ADR 0007 § 3](0007-hosted-backups-and-retention.md#3-what-a-recovery-may-do):** the recovery demotion also unlists.
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
- **Unchanged:**
  - the publication predicate for writing;
  - every journal and memory route, slug, and `308`;
  - `/albums` and its archive;
  - INV-1 to INV-5;
  - the `ct1` token;
  - L1 to L6;
  - gates G1 to G7, which still block any hosted public page.

  Accepting this ADR closes no gate and authorizes no deployment, data transfer, switch change, or lifting of `noindex`.

## Open decisions

Product decisions 1 to 15 are settled. These remain for the owner, and none blocks accepting the architecture:

1. **Navigation:** whether "Collection" joins the header's sections. Proposed: no. It is reached from the Home section, from artist pages, and from journal pages, which keeps the V4.4 header unchanged.
2. **Collection archive order.** Proposed: first credited artist's name as rendered, then year, then title. The sort name stays outside public reads (§ 9). Using it would put it under the G8 refusal.
3. **Labels in both languages:** the Home section's link to `/collection`, the collection page's heading for its journal links, and the journal page's link to the collection page.
4. **Artists on the Home:** proposed, the Home's Artists section keeps A6's journal-derived artists, and the `/artists` archive lists collection-only artists too (§ 8).
5. **Scope of `noindex` at the first public opening:** this ADR applies it to collection surfaces. Whether the rest of the public site also opens with `noindex` belongs to the [hosted-launch plan](../hosted-launch.md) and its stage S4.

## Revisit when

- Taking pages down to fix a shown record proves too costly. The confirmed catalog change, or the published snapshot, is then decided in a new ADR.
- A bulk listing is wanted. It needs its own acknowledgement decision.
- Addresses need to change. That needs a `308` design that respects INV-5.
- Artist photographs are wanted for collection-only artists, after deployment-gate item 7.
- Indexing is to be enabled: a reviewed change with the owner's written authorization.
