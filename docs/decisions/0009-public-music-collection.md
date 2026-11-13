# ADR 0009: The Public Music Collection

- **Status:** **Proposed.** It is not accepted, and it changes nothing yet. Until the owner accepts it, the existing contract holds word for word: [Security § Publication predicate](../security.md#publication-predicate) ("Catalog metadata … public pages show it only in the context of publicly visible entries"), [ADR 0006](0006-publication-decision-and-acknowledgement.md) and its amendments A1 to A7, and gates G1 to G8. No code, schema, migration, data, hosting setting, or public surface changes because this file exists.
- **Date:** Proposed 2026-11-12, after the owner approved the product direction (a public music collection kept apart from the author's writing, with explicit visibility controls) and asked for this decision to be written first.
- **Scope:** Letting a reader browse selected catalog metadata (an album's title, artists, year, cover or fallback, tracklist, and durations) when no journal about the album is published, through an explicit, reviewed, confirmed listing by the author. It covers the schema, the visibility rule, the addresses, listing and removal, artist pages, the catalog-wording gate G8, locks, public surfaces in both languages, the switches, and the tests. It does **not** cover publishing writing, hosting, data transfer, or enabling public reads anywhere.

## Context

**What exists** (`main` at `fd65134`):

- **Catalog metadata is public only beside published writing.** The predicate's closing rule says so, and every public read follows it: an album appears only through a served album journal, an artist page only while a served album journal credits the artist ([ADR 0006 A5](0006-publication-decision-and-acknowledgement.md#a5-artist-pages-open-only-through-a-confirmed-publication)), and memory pages show only the music they link.
- **Adding to the catalog never publishes anything** ([Product § Music catalog](../product.md#music-catalog)). Imports from MusicBrainz create private catalog records.
- **Gate G8 (C11) is open.** Catalog edits (an album or artist name, a track title, credits, tracklist order) change the wording of a public page without a confirmation. A3 guards artwork, and A5 guards photographs, credits that would open an artist page, and artist restores. Renames, track titles, and credit wording are still unguarded. G8 cannot be waived ([ADR 0006 § 14](0006-publication-decision-and-acknowledgement.md#14-public-page-release-gates)).
- **Rights.** Covers ([Security § Deployment gate](../security.md#deployment-gate), item 6, read by the owner on 2026-11-08 to cover every hosted surface, including the private Studio, issue #82) and photographs (item 7) may not be shown on a hosted surface until the owner records the reviews. No switch enforces item 6 today.
- **#44.** The public album journal is not fully readable without JavaScript, and its footer language selector is hidden without it.
- **The local catalog** (read-only counts, 2026-11-12): 22 albums, 21 artists, 219 track positions, 20 covers, and no artist photograph. Nothing is published.

**The owner's product decisions (2026-11-12):**

1. An album may be listed publicly with no published journal.
2. Being in the private catalog never authorizes automatic publication.
3. Every public listing requires the author's explicit review and confirmation.
4. Drafts, private texts, ratings, favourites, and reflections stay under the current rules.
5. A catalog-only page shows only authorized music metadata.
6. When a journal is published, the catalog page and the authored writing stay clearly distinct, with no automatic `308`.
7. No artist photographs in this first stage.
8. The V4.4 design and the English and Brazilian Portuguese interface are preserved.
9. Public pages work without JavaScript.
10. No real data is imported into, or published on, the hosted database in this stage.

**Forces.**

- A reader should be able to browse the collection before the author has written about it.
- Listing must be a deliberate act, never a side effect of an import, a journal publication, a restore, or a script.
- A collection page that changes its wording without a confirmation would widen G8, which this ADR must close rather than widen.
- A catalog-only page must not reveal that unpublished writing exists (ADR 0002, INV-3).
- The smallest change is preferred: no new service, no cache, no snapshot store.

### Alternatives considered

| Alternative | Verdict |
| --- | --- |
| **Status quo:** catalog only beside published writing | Rejected. It does not meet decision 1. |
| **Implicit visibility:** every catalog album that is not archived is public | Rejected. It breaks decisions 2 and 3. Every import would publish, and nothing records the author's choice. |
| **A published snapshot:** a `collection_publications` table holding a frozen JSON copy of what was reviewed; public pages read only the snapshot | Not chosen. It closes G8 by construction for the collection, but it adds a second copy of the catalog, a second rendering path, and a staleness problem. It also does nothing for journal and memory pages, whose catalog wording G8 also covers. It remains the fallback if the guard below proves too restrictive in use. |
| **A separate `catalog_listings` table** (album id, slug, listed time) | Not chosen. It is equivalent to two columns, with one more join and one more foreign key. It would help only if listings needed history rows, which they do not (see § 2). |
| **Addresses in the `/albums/<slug>` namespace** | Not chosen. Journal slugs live in `entry_slugs`, keyed by `(kind, slug)` and retained after deletion ([ADR 0003 § 3](0003-relational-schema-conventions.md#3-published-slugs-stay-reserved-after-permanent-deletion)). Sharing `/albums/` would need uniqueness across two tables, which PostgreSQL cannot declare without a trigger, and it would change M3.1's slug resolution, `308`s, and G1 evidence. |
| **Chosen: two columns on `albums`, a confirmed listing, a separate address section, and a refusal guard for shown catalog records** | The smallest change that meets decisions 1 to 10, keeps uniqueness declared in PostgreSQL, leaves the journal routes untouched, and closes G8 by refusal, which is verifiable by tests. |

## Decision

### 1. Terms

- **The collection:** the albums the author has listed.
- **A listed album:** `albums.collection_listed_at IS NOT NULL` and `albums.archived_at IS NULL`.
- **A collection page:** the public page of a listed album at its collection address (§ 4). It shows catalog metadata only.
- **A shown catalog record:** any catalog row whose wording a public surface renders while public reads are on. That means:
  - a listed album, its credited artists, its reference edition, and that edition's tracks;
  - an album with a served album journal, and its credits, edition, and tracks;
  - every album and track linked from a served memory, and their credited artists;
  - every artist with a public page.

  It is computed only from Publication fragments (§ 3).

### 2. Schema

One migration, through [`/refrain-db-change`](../development.md#database-changes), adds two nullable columns to `albums`:

| Column | Meaning | Constraints |
| --- | --- | --- |
| `collection_listed_at timestamptz NULL` | When the current listing was confirmed. `NULL` means not listed. | `CHECK (collection_listed_at IS NULL OR collection_slug IS NOT NULL)` |
| `collection_slug text NULL` | The collection address. It is set at the first confirmed listing, then **never changed or cleared** by the application. | `UNIQUE (collection_slug)` (several `NULL`s allowed); `CHECK (collection_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(collection_slug) <= 80)`, the same form as `entry_slugs` |

- **Both default to `NULL`**, so every existing album, and every future import, starts unlisted (decision 2). The migration sets no values: it lists nothing.
- **A slug is present exactly when the album was listed at least once.** That plays the role of `was_published` in ADR 0003, without a history table.
- **No other column.** Listing does not touch `updated_at` semantics, foreign keys, or any authored table.
- **The smaller alternative was examined.** A single `collection_slug` whose presence means "listed" cannot keep the address stable after the album is unlisted, so the second column is needed.

### 3. The visibility rule

The publication predicate gains one fragment, implemented once in [`predicate.ts`](../../src/modules/publication/predicate.ts) and used by every collection read:

> An album is **in the public collection** when `collection_listed_at IS NOT NULL`, `collection_slug IS NOT NULL`, and `archived_at IS NULL`.

**What a collection page may show** (a closed list):

- the album's title and `first_release_year`;
- its credited artists, in credit order, as `credited_as` or the artist's name;
- each one linked only when that artist has a public page;
- the reference edition's tracklist: disc, position, title, and `length_ms` formatted as minutes and seconds (nothing when the length is unknown, never an invented value);
- the cover, under § 11, or the existing fallback frame;
- the source line for the cover;
- links to the album's **served** album journals (§ 10).

**What it never shows or uses:**

- ratings, favourite marks, reflections, "still writing", or margin notes;
- any count of entries ("used in n entries");
- MBIDs, Image IDs, edition labels, countries, or any Studio-only value;
- anything about an entry that is not served.

**No unpublished writing can be inferred (INV-3).** A collection page's response is a function of the catalog atoms and the set of served journals only. A listed album with a draft, private, deleted, or unpublished-translation journal answers byte for byte what the same album with no journal answers.

**The rule is additive and independent.**

- It does not change when an entry, a language version, a reflection, or a rating is public.
- Listing an album publishes no writing.
- Publishing a journal does not list its album.
- An album with a served journal and no listing keeps exactly today's behaviour.

### 4. Addresses

- **The collection page is `/collection/<collection_slug>`**, and `/pt/collection/<collection_slug>` in Portuguese ([ADR 0008 § 2](0008-interface-localization.md#2-routes)). It is a new section path, not an item in the four-section navigation: the page belongs visually to *Albums*, which is marked as the current section.
- **Generation.** At the first listing, the slug is proposed from the title by [`slug.ts`](../../src/modules/publication/slug.ts)'s normalization, with the collision suffixes (`-2`, `-3`) checked against `albums.collection_slug`. The proposed slug is an atom of the disclosure (§ 5), so the author confirms the exact address. A title that normalizes to nothing requires the author to supply one.
- **Uniqueness** is declared by the `UNIQUE` constraint. A concurrent claim of the same slug fails one listing with a refusal and writes nothing, and the author previews again.
- **Stability.** The slug is never changed by the application. Unlisting keeps it, and listing again reuses it. Renaming the album does not change it. Changing an address is not part of this ADR, and would need its own decision (with `308` semantics like INV-5).
- **Retention.** An album that has a `collection_slug` is never permanently deleted by the application. `deleteAlbum` refuses it, and the author archives it instead (the catalog's own rule for referenced records). An address that was public is therefore never reassigned. An out-of-process deletion is on G3's inventory (§ 14).
- **Not listed, archived, unknown, or never listed:** the identical unknown-address `404` (status, body, headers), decided in [`src/proxy.ts`](../../src/proxy.ts) before any page renders, in every request form, as for the existing sections. There is no `308` from a collection address to anything.

### 5. Listing: preview and confirmation

Listing follows ADR 0006's three-part model: a disclosure, a server-authenticated token, and the author's explicit act in the interface. **One album per confirmation.** A bulk listing would need its own decision on how the acknowledgement is obtained ([ADR 0006 § 3](0006-publication-decision-and-acknowledgement.md#3-the-confirmation-token)).

- **`previewCollectionListing(db, author, { albumId })`** reads one consistent snapshot, takes no lock, and returns:
  - the album's state (not listed, or listed already);
  - the **collection address** that will be public;
  - every atom of § 3 exactly as the page will render it;
  - the **artist pages the listing would open** and the **public artist pages whose address would change**, as A5's review does;
  - the cover the page would show, or "fallback", and whether cover display is currently enabled (§ 11);
  - a confirmation token.

  It refuses an archived album, an album with no reference edition, and an album with no tracks.
- **The token** reuses ADR 0006's machinery: an HMAC over claims, a key derived from the application secret through the Identity module, binding to the author's user and session, a 15-minute expiry on the database clock, no storage, never logged or echoed, and a refusal carries none. It differs in four ways:
  - it has its own prefix, `cc1.`;
  - it has its own HKDF `info` string, `refrain/confirmation-token/collection1` ("a new use of the secret gets a new `info` string");
  - its purpose is `list_collection`;
  - it carries the album id in place of the entry id and locale.

  Its fingerprint is the SHA-256 of the canonical JSON of the album id, the operation, every atom of the disclosure, and the album's `updated_at` as the state stamp. The atoms are bound directly and are the primary guarantee.
- **`listAlbumInCollection(db, author, { albumId, confirmation })`** runs in one transaction:
  1. Zod, then the token's form, key, MAC, purpose, actor, and album binding, all **before** any lock.
  2. The locks of § 9.
  3. Refuse an archived album.
  4. The expiry, on `clock_timestamp()` after the locks.
  5. Recompute the disclosure from the locked rows, and refuse `confirmation_stale` (fresh disclosure, no token) on any difference.
  6. Write `collection_listed_at = clock_timestamp()`, and `collection_slug` if it was `NULL`.

  An already listed album with an unchanged disclosure is a no-op.
- **Error codes** are ADR 0006's (`invalid_input`, `unavailable`, `confirmation_required`, `confirmation_invalid`, `confirmation_expired`, `confirmation_stale`), plus `album_not_found`, `album_archived`, `nothing_to_list`, and `slug_taken`. Every failure writes nothing.
- **The explicit acknowledgement is mandatory**, as in ADR 0006 § 3:
  - the token exists only in the dialog's state and leaves only from its confirm control;
  - no code mints and consumes a token in one operation;
  - no autosave, retry, script, or import lists an album.

### 6. Unlisting and takedown

These operations only take something away. Each **needs no token** (ADR 0006, owner decision R4), the interface asks first, and each is always allowed, including while Cover Art Archive, Wikimedia Commons, or MusicBrainz is unreachable.

| Operation | Effect |
| --- | --- |
| `unlistAlbumFromCollection` | Clears `collection_listed_at` and keeps `collection_slug`. The next request to the address answers the identical `404`. Artist pages that existed only through this listing close. |
| Archive a listed album | **Unlists it in the same transaction**, so restoring the album later exposes nothing. |
| Remove an album's cover | **Always allowed**, including while a journal is served. This **amends A3**, which today refuses removal while a journal is public. Removal is the cover takedown path, and the fallback frame shows instead. |
| Remove an artist's photograph | Always allowed, as A5 already says. |
| Unpublish or delete a journal | Unchanged (ADR 0006). |

Restoring an archived album never relists it. Listing again always goes through § 5.

### 7. Artist pages

- **The public artist set becomes A5's set plus the artists credited** (`album_artists`, never `track_artists`) on a listed album, while the artist is not archived.
- **Addresses** are still derived from names over the whole visible set ([`artist-address.ts`](../../src/modules/publication/artist-address.ts)), so a listing can open pages and change a namesake's address. Both are in the listing's disclosure and fingerprint (§ 5).
- **An artist page lists** the artist's served album journals (as today) and its listed albums, linking each to its collection page.
- **No photograph on a page that exists only through the collection** (decision 7). A page opened by a served journal keeps A5's behaviour, which stays local-only until deployment-gate item 7 is recorded.
- **The photograph guard counts collection pages as pages.** `setArtistPhoto` refuses (`public_page`) while the artist has any public page. This is conservative: a photograph chosen privately could otherwise appear later without a review that lists it.
- **Restoring an artist** who would gain a page is refused, as in A5, now also when the page would come from a listed album.

### 8. Gate G8: shown catalog records are not edited in place

While a catalog record is **shown** (§ 1), a command that would change what a public page says about it is **refused** with `public_page`, writing nothing. The way to change it is:

1. unlist the album, or unpublish the journal or memory;
2. edit;
3. list or publish again through the review, which discloses the new wording.

This resolves G8 for every public surface (collection pages, album journals, memories, artist pages, the archives, and the Home) by refusal, the "independently verified safe alternative" that ADR 0006 § 14 allows, provided the tests in § 15 verify it.

| Command | While the record is shown |
| --- | --- |
| `updateAlbum` (title, year, credits, their order, `credited_as`) | Refused. **This narrows A5**, which allowed reordering, credit wording, and credit removal. |
| `setAlbumTracklist`, `addTrackToAlbum`, `removeTrackFromAlbum`, `moveTrackInAlbum` | Refused for a shown album |
| `updateTrack` (title, length, credit) | Refused for a track on a shown album or linked from a served memory |
| `archiveTrack` | Refused for a track on a shown album's reference edition or linked from a served memory |
| `updateArtist` (name, kind) | Refused for an artist with a public page, or credited on a shown album. **This narrows A5**, which allowed renames. |
| `archiveArtist` | Allowed (a reduction, as A5 says). The credit renders as plain text. |
| `restoreArtist` | Refused when it would open a page or change a shown credit's rendering |
| `setAlbumArtwork` | Refused for a shown album (A3, extended to listed albums) |
| `removeAlbumArtwork`, `removeArtistPhoto`, unlist, archive album | Always allowed (§ 6) |
| `linkAlbumToMusic`, `linkArtistToMusic` | Allowed: they fill identifiers only, which no public page shows |
| `importMusicRelease`, `createAlbum`, `createArtist`, `createTrack` | Allowed: a new record is not shown, and reused records are not changed |
| `deleteAlbum` | Refused for any album with a `collection_slug` (§ 4); otherwise unchanged |

**What remains outside the guard, recorded rather than accepted as harmless:** what external providers serve (a cover image replaced at the Cover Art Archive under the same Image ID). § 11's cover switch and the takedown path bound it, and the rights review records it.

### 9. Locks and concurrency

- **Order, for every command in § 5 to § 8:**
  1. entries `FOR SHARE`, in ascending id order: the journals and memories whose served state decides "shown", as A3 and A5 already do;
  2. then albums, in ascending id order (`FOR UPDATE` for a write to the album, `FOR SHARE` otherwise);
  3. then artists, in ascending id order;
  4. then tracks.

  No entry command takes an explicit catalog lock (L3 unchanged), and listing takes no entry lock.
- **Listing against catalog edits.** Listing locks the album `FOR UPDATE`, then its credited artists `FOR SHARE`. A rename holds the artist row, so a listing waits for it and then fails as stale. A listing that commits first is seen by the rename, which then refuses.
- **Listing against publication.** A publication that opens the same artist page between the listing's preview and its commit leaves that page open, as both reviews said. This is the A5 residual class, recorded and not closed.
- **Deadlocks.** A catalog command that takes rows outside this order (`createTrack`'s foreign-key locks, as A5 records) can deadlock with them. PostgreSQL aborts one request with `40P01`, and nothing is written. This is an availability issue only.
- **Isolation.** The default `READ COMMITTED` is enough, because every decision is made by a statement that runs after the locks.

### 10. Public surfaces

Every surface reads only through the Publication module's reading entry point, is rendered per request, is sent with `Cache-Control: no-store`, and prerenders nothing of the collection ([ADR 0006 § 11](0006-publication-decision-and-acknowledgement.md#11-public-reads-and-caches), A2).

- **Collection page:** the V4.4 album-journal layout without its writing.
  - It has the cover frame, title, artists, year, and the tracklist with durations.
  - It has no rating stars, favourite circles, or per-track "not written yet" labels.
  - When the album has no served journal, it shows one discreet line of copy. The owner proposed "Some words are still waiting to be written." / "Algumas palavras ainda esperam para ser escritas." **That copy is pending the owner's editorial approval and is not authorized by this ADR.**
  - When the album has served journals, the line is replaced by a separate section that links each one: the title of the version `versionPreference` selects, at its served `/albums/<slug>` address. The section shows no text excerpt and no rating, and there is no `308` (decision 6).
- **Album journal page:** unchanged, except for one optional link back to the album's collection page when the album is listed (owner decision pending, § Pending decisions).
- **`/albums` archive:**
  - Each listed album appears once, linked to its collection page, with its served journals linked under it.
  - An album with a served journal and no listing appears as today.
  - The order and grouping follow the approved archive.
- **`/artists` archive and artist pages:** § 7.
- **Home:** a discreet collection presence.
  - It is an **amendment to A4 and A6**: the Home may also list listed albums (title, artists, year, cover or fallback, collection address), at most a fixed number, newest `collection_listed_at` first.
  - Whether this reuses the Home's existing album cards or adds a separate section is an owner design decision. No new component is added without the owner's approval of the design.
  - A4's switch-off rule is unchanged: with reads off, the Home is identical whatever the database holds.
- **Sitemap:** each collection address and its `/pt` form, under the switch. Whether collection pages are indexed at first, or sent with `noindex`, is an owner decision for the launch.
- **Metadata:** title, description, canonical address, and Open Graph tags from the § 3 atoms only. No Open Graph image is generated.
- **Without JavaScript (decision 9):** the page is complete in the first response, with `instant = false`, no content inside a Suspense boundary that only a script reveals, and the footer language selector visible. A browser test with JavaScript disabled is required. The album journal's own gap (#44) is fixed separately and stays a launch condition.

### 11. Switches

- **Public reads (D4) are unchanged and cover every new surface.** With `REFRAIN_PUBLIC_READS_ENABLED` anything other than exactly `true`:
  - `/collection/<slug>` and `/pt/collection/<slug>` answer the identical unknown-address `404` in every request form;
  - the archives and the sitemap answer as today;
  - the Home lists nothing.

  The static guard test and the HTTP switch-off matrix are extended to the new routes. The switch hides and never reveals.
- **Cover display, a new server-only switch, off by default.** This separates the rights review from the interface work (deployment-gate item 6 already allows "a switch is built first").
  - `REFRAIN_COVER_DISPLAY_ENABLED` follows D4's form: server-only, read per request, enabled only by exactly `true`.
  - While it is off, every hosted surface (public pages, and, by the owner's 2026-11-08 reading in #82, the Studio) renders the fallback frame. No request is made to the Cover Art Archive.
  - Stored `cover_url` values and their Image IDs are **kept**, not cleared, so approved choices survive.
  - The owner turns it on for a deployment only after recording the item 6 review. Local development may turn it on.
  - It can only hide covers. A cover shown after the switch is turned on is one that the listing or publication review disclosed.

### 12. Languages

[ADR 0006 A7](0006-publication-decision-and-acknowledgement.md#a7-the-pt-surfaces) applies in full:

- `/collection/<slug>` and `/pt/collection/<slug>` get the same visibility decision, the same `404`, and the same headers per section.
- Interface strings come from `src/i18n/` and `src/i18n/studio/`, and a missing functional translation is a defect.
- Catalog metadata is shown as stored, in either language, and is never translated.
- The pending sentence of § 10 is owner copy: until both versions are approved, nothing ships with it.
- The interface language never decides what is listed.

### 13. Authorization and the Studio

- **Commands and actions.** Every new command takes the `AuthorizedAuthor`. Every Server Action awaits `authorizeAuthor`, runs through `perform` (the exact `Origin`), and validates with Zod inside the command. Each action joins the HTTP suite's table, and the static scans cover the new files.
- **Studio, on each album's page, in English and Portuguese:**
  - a *Public collection* panel: not listed or listed, and the address;
  - **Add to the public collection…**, which opens the review dialog in the M2.3 pattern and lists every atom of § 5;
  - **Remove from the public collection…**, behind a confirmation;
  - each `public_page` refusal, which says which page shows the record and how to proceed;
  - a "listed" marker in the albums list.

  No bulk control. The Studio is never public, and administrative controls never appear on public pages.

### 14. Writers outside the commands

- **The new writers** of `collection_listed_at` and `collection_slug` (the listing, unlisting, and album-archive commands, and the migration that adds the columns) join ADR 0006 § 9's static writer scan by call target. Any other writer fails it.
- **G3's inventory** gains both columns: scripts, migrations, fixtures (confined to `src/testing/` and the disposable database), manual access, CI, and restore.
- **Restoring a backup makes nothing public ([ADR 0007 § 3](0007-hosted-backups-and-retention.md#3-what-a-recovery-may-do)):**
  - `ops/backup/recovery-demote.sql` must also set `collection_listed_at = NULL` on every album, keeping the slugs;
  - `recovery-check.sql` must fail while any album is listed;
  - both changes are tested.
- **No transfer lists anything.** Listing state is never copied between databases. A hosted database gets listings only through its own Studio's confirmed listing, after the gates allow it.

### 15. Required tests

On real PostgreSQL unless stated. Each one is a merge condition of the change that builds the rule.

- **Schema:**
  - the constraints of § 2 (format, `UNIQUE`, the pairing `CHECK`);
  - the migration on fresh and populated databases;
  - every existing album stays unlisted.
- **Oracle:**
  - an independent implementation of § 3 and § 7, compared with every collection read over the state matrix (listed or not × archived or not × journal states × memory links × artist archived × namesakes);
  - the existing oracles unchanged.
- **INV-3:**
  - a listed album with a draft, private, deleted, or unpublished-translation journal answers byte for byte what it answers with no journal, in both languages;
  - no rating, favourite, or reflection on a collection page in any state.
- **Listing:**
  - disclosure equals the page;
  - token binding, purpose separation from `ct1`, expiry, and staleness after each kind of catalog edit and after another publication opens an artist page;
  - no mint-and-consume, and no listing without the dialog's confirm control (static and browser);
  - one album per confirmation.
- **Unlisting and takedown:**
  - the next request answers `404`;
  - the slug is kept;
  - relisting reuses it;
  - archive unlists;
  - restore relists nothing;
  - cover removal is allowed while a journal is served and while a provider is down;
  - the public atoms after each of these are a subset of the atoms before.
- **G8:**
  - each row of § 8 is refused while shown, with no row changed, and allowed while not shown;
  - a mutation that removes each guard fails a test.
- **Concurrency:**
  - over real connections, listing against a rename, a credit change, an artwork change, and a publication, each seen waiting and then refusing or completing as § 9 says;
  - a mutation that decides before locking fails.
- **Switches:**
  - the HTTP switch-off matrix over the new routes in both language forms and every request form;
  - the Home identical with reads off;
  - the cover switch off means no Cover Art Archive request from any page, Studio included, and the fallback frame shown.
- **HTTP:**
  - `no-store` on every response class;
  - the identical `404` for unknown, unlisted, archived, and never-listed addresses;
  - no `308` from a collection address;
  - the build output contains no collection data.
- **Browser:**
  - at desktop width and 390px, in English and Portuguese: the collection page, the archive, an artist page, and the Studio's listing and unlisting dialogs;
  - axe, keyboard, 44px targets, and no sideways scroll;
  - the collection page with JavaScript disabled.
- **Restore:** demote and check scripts clear and detect listings.

## Effect on existing decisions, on acceptance

These texts change in the same pull request that accepts this ADR. None changes before acceptance.

- **[Security § Publication predicate](../security.md#publication-predicate):** the closing sentence about catalog metadata becomes "…only in the context of publicly visible entries, **or of an album listed in the public collection** ([ADR 0009](0009-public-music-collection.md))". The required-tests list gains § 15.
- **ADR 0006** (by a pointer under *Amendments*, not by editing its decisions):
  - A3: cover removal is always allowed;
  - A4 and A6: the Home may list listed albums;
  - A5: the public artist set grows, and renames and credit-wording changes of shown records are refused;
  - § 14, G8: resolved by § 8's refusal once its tests pass.
- **[ADR 0007 § 3](0007-hosted-backups-and-retention.md#3-what-a-recovery-may-do):** the recovery demotion also unlists.
- **[Product](../product.md), [Data Model](../data-model.md), [Architecture](../architecture.md), [Design System](../design-system.md), [Roadmap](../roadmap.md):** each records what is decided and, separately, what is built.

## Consequences

- **Positive:**
  - Readers can browse the collection before any writing exists.
  - Every public listing is a recorded, reviewed act.
  - Imports stay private.
  - G8 gets a single, testable resolution for every public surface.
  - The rights review of covers is decoupled from building pages.
  - No new service, cache, or copy of the catalog is added.
- **Negative:**
  - Correcting a typo in a listed album's title takes three steps (unlist, edit, list again), and the page is briefly absent in between.
  - The refusal guard touches about a dozen catalog commands, each needing tests.
  - A5's freedom to rename public artists and reorder credits is withdrawn.
  - Collection addresses are permanent: an album that was listed can be archived but never deleted.
  - The listing token is a second token family, with its own key derivation and tests.
- **Unchanged:**
  - the publication predicate for writing;
  - every journal and memory route, slug, and `308`;
  - INV-1 to INV-5;
  - the `ct1` token;
  - L1 to L6;
  - gates G1 to G7, which still block any hosted public page.

  Accepting this ADR closes no gate and authorizes no deployment, data transfer, or switch change.

## Pending owner decisions

1. The section path: `/collection/<slug>` (proposed) or another word, the same in both languages.
2. Whether the author may edit the proposed slug in the first listing's review.
3. Whether the collection page has no per-track "not written yet" labels (proposed) or keeps them.
4. The copy of § 10, in English and Portuguese.
5. The Home: reuse the existing album cards, or a separate discreet section, and how many albums.
6. The `/albums` archive: one combined list (proposed), or the collection separately.
7. Whether the album journal page links back to the collection page.
8. Indexing at launch: sitemap and normal indexing, or `noindex` at first.
9. Whether `setArtistPhoto` refusing for collection-only artists (§ 7) is acceptable, or photographs may be chosen privately for them.

## Revisit when

- The unlist, edit, and relist cycle proves too costly in use. The published snapshot alternative is then reconsidered.
- A bulk listing is wanted. It needs its own acknowledgement decision.
- Addresses need to change. That needs a `308` design that respects INV-5.
- Artist photographs are wanted on collection-only pages, after deployment-gate item 7.
