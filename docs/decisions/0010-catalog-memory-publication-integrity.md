# ADR 0010: Catalog, Memory, and Publication Integrity

- **Status:** **Proposed.** It is not accepted, and it changes nothing yet. Until the owner accepts it, the existing contract holds word for word: [ADR 0006](0006-publication-decision-and-acknowledgement.md) with its amendments A1 to A7, the [publication predicate](../security.md#publication-predicate), and gates G1 to G8. No code, schema, migration, data, hosting setting, or public surface changes because this file exists.
- **Date:** Proposed 2026-11-13, when the owner split the earlier ADR 0009 proposal in two (owner decision 22). The content below that came from that proposal was reviewed there over twenty-one independent rounds (draft PR #98, up to `78388c0`); it is moved here by responsibility, not re-decided.
- **Scope:** keeping catalog wording on public pages under review, and keeping catalog commands and publications consistent under concurrency. That is gate G8's resolution (the C11 gap), the lock model, stale-state checks, indirect changes to public data, the album a memory names (residual risk R1), late entries (R5), and the amendments to ADR 0006 they need. It covers every public surface: album journals, memories, artist pages, and, once [ADR 0009](https://github.com/RaioViajante/refrain/pull/98) is accepted and built, the collection.
- **Relation to ADR 0009** (the public music collection, proposed in draft PR #98): ADR 0009 decides what the collection is, its addresses, listing, and surfaces. It **depends on this ADR**: a listed album is a shown catalog record (§ 1), and the collection may not open to the public until this ADR is implemented and validated. This ADR does not depend on ADR 0009 for album journals and memories; its listing-specific rows apply once ADR 0009 is built. "ADR 0009 § N" below refers to that proposal; the link becomes relative when it merges. Residual risks R2, R3, and R7 are ADR 0009's.

## Context

**What is accepted** (unchanged by this file):

- **ADR 0006** decides how writing becomes public: a disclosure, a `ct1` token, the author's explicit act, the confirmed save, locks L1 to L6, and the release gates. Its § 2 keeps catalog wording out of the fingerprint as "informational lines" (C11).
- **Gate G8 is open and cannot be waived** ([ADR 0006 § 14](0006-publication-decision-and-acknowledgement.md#14-public-page-release-gates)). A3 guards artwork, and A5 guards photographs, credits that would open an artist page, and artist restores. Renames, track titles, credit wording, and edition details still change public pages without a confirmation.
- **M3.7's named-album rule** is built: [`memory-music.ts`](../../src/modules/publication/memory-music.ts) names, for a recording a memory links, the album with a served journal first, otherwise the earliest. So another album's journal state is an input to a memory page (R1).
- A3's and A5's residual windows, including late entries (R5) and the reappearance of an artist page through a review that did not list it, are recorded in [Security § Public page release gates](../security.md#public-page-release-gates).

**What this ADR proposes** (§§ 1 to 5), **what stays pending** ([Open decisions](#open-decisions)), and **what stays at risk** ([Residual risks](#residual-risks)) are kept apart below. Nothing here is built.

### Owner decisions

21. **(2026-11-13, moved from ADR 0009) Residual risk R1: option (a), as a direction.** The album a public memory names must not depend on publishing or unpublishing other journals, and must stay stable and predictable. The owner set seven conditions:
    1. no private memory or draft becomes public through this change;
    2. no album of the private catalog is exposed automatically;
    3. the named album's identity is part of the published memory's explicit review;
    4. another journal's publication cannot silently change the named album;
    5. taking public content down reveals nothing private and creates no unauthorized public address;
    6. ADR 0006's guarantees, the publication predicates, and the protections against concurrent changes are preserved;
    7. if option (a) needed a new product decision about which metadata a public memory may show, it would be recorded as pending, and the work would stop before presuming authorization.

    G8 is not weakened to resolve R1.
22. **(2026-11-13) Split and direction.** The earlier proposal is split: the collection stays in ADR 0009, and catalog–publication integrity moves here. **Storing the named album's identity explicitly (§ 4, option B) is to be investigated as the preferred direction.** It is **not authorized as a database change**: no migration is written until the owner approves it.

### Alternatives considered

| Alternative | Verdict |
| --- | --- |
| **A published snapshot:** a frozen JSON copy of what was reviewed, which public pages read | Not chosen. It would close G8 by construction and remove most catalog–publication locks, but it adds a second copy of the catalog and a second rendering path. It remains the fallback if § 2's refusals or § 3's locks prove too costly ([Revisit when](#revisit-when)). |
| **A confirmed catalog change:** a token-bound preview of the wording delta across every page that shows a record, then the edit | Not chosen for now. It would let a typo be fixed without taking pages down, but needs a delta over every surface kind, its own token purpose, and its own tests. It is the next step if § 2's cost is too high. |
| **Disclosing affected memories in every publication review** (R1's earlier option (b)) | Rejected: unpublishing is a reduction with no token, so it is not covered. |
| **Chosen:** refuse edits to shown records (§ 2), bind catalog atoms into publication fingerprints (§ 2), one lock order with share locks on fingerprinted rows (§ 3), and a stable named album (§ 4) | It closes G8 in a way tests can verify, once built and tested, without a new store. |

## Decision

### 1. Terms

- **A shown catalog record:** any catalog row whose wording a public surface **would render if public reads were on**. Whether a record is shown never depends on the public-reads switch or the cover switch: the switches hide, and the guards below hold with them off. That means:
  - an album with a served album journal, its credits, its reference edition (including the label the journal page shows), and its tracks;
  - every album and track linked from a served memory, the artists credited on them (`album_artists` for a linked album, `track_artists` for a linked track), and the album the memory names for each linked track (§ 4). Under option A, that is **every album that contains a linked track**, called a **containing album** of that memory, because any of them can become the named album;
  - every artist with a public page;
  - once ADR 0009 is built, a listed album, its credited artists, its reference edition, and that edition's tracks.

  "Shown" is computed only from Publication fragments.
- R2, R3, and R7 are ADR 0009's residual risks; R1, R4, R5, and R6 are this ADR's. ADR 0006's owner decisions R1 to R5 are always written "ADR 0006's".

### 2. Gate G8: shown catalog records are not edited in place

**The rule.** While a catalog record is shown (§ 1), every command that would change what a public page says about it is **refused** with `public_page`, writing nothing. To change it, the author:

1. takes down every surface that shows the record (unlist the album, unpublish the journals and memories that show it);
2. edits;
3. lists and publishes again, each through its review, which discloses the new wording.

**Coverage.** Every writer of a catalog table in `src/modules/catalog` is listed below. A static test fails when a new writer is not on this list.

**Only rendered atoms are guarded.** An album shown **only as a containing album** of a served memory (§ 1) is guarded only for what decides or renders that memory's named album (§ 4): its title, its year, the linked track's membership, and its deletion. Its credits, its other tracks, its edition label, its cover, and its artists' names are not guarded on that account. They are guarded only when some page renders them. Every row below that refuses for "a shown album" applies this exception, and names it. Other refusals are **conservative**: an album a served memory links directly, or a listed album, is refused for some atoms its page does not render (for example its artwork or tracklist on a memory page, or its edition label on a collection page). Narrowing them is possible later and not needed for G8.

| Command | While the record is shown |
| --- | --- |
| `updateAlbum`: title, year, credits (adding, removing, order, `credited_as`), and the reference edition's **label** | Refused for a shown album. **This narrows A5**, which allowed reordering, credit wording, and credit removal. For an album shown **only as a containing album**, only the title and year are refused: they decide which album is named, and the named one's title is rendered. |
| `updateAlbum`: the reference edition's date and country | Allowed when the reference edition exists: no public read selects them. The static column test of the `updateArtist` row covers them too. When none exists, `updateAlbum` creates one, which is refused for an album with a served journal, as for `linkAlbumToMusic`. |
| `setAlbumTracklist`, `addTrackToAlbum`, `removeTrackFromAlbum`, `moveTrackInAlbum` | Refused for a shown album, and whenever they would add a track linked from a served memory to any album. That is conservative: under § 4 only an album that would precede the named one changes what the memory shows. For an album shown only as a containing album, only adding or removing the linked track is refused. |
| `createTrack` **with an `albumId`** (it appends to that album's tracklist) | Refused for a shown album, except an album shown only as a containing album (a new track is linked from nothing, so it changes no memory). Without an album, allowed. |
| `importMusicRelease` reusing an existing recording | Refused when a reused recording is linked from a served memory and the new album would become the album that memory names (§ 1). A tie with the named album on year and code-point title is refused too, whatever the new id (conservative and deterministic), so the check runs before the insert. Otherwise allowed. |
| `updateTrack`: title, length, credit, track artists | Refused for a track linked from a served memory, or on a shown album other than one shown only as a containing album |
| `updateAlbum`: `mbReleaseGroupId`; `updateTrack`: `mbRecordingId` | Allowed: no Publication read selects them; included in the static column test |
| `archiveTrack`, `restoreTrack` | Allowed: no public read depends on a track's archived state, and the collection page lists the reference edition's tracks as they are |
| `updateArtist`: the **name** | Refused for an artist with a public page, credited on a shown album other than one shown only as a containing album, or credited on a track linked from a served memory. **This narrows A5**, which allowed renames. |
| `updateArtist`: sort name, kind, identifier | Allowed: no public read uses them. A static test asserts that the Publication reads do not select these columns. |
| `archiveArtist` | Allowed (a reduction, as A5 says). The credit renders as plain text. |
| `restoreArtist` | Refused when it would open a page or change a shown credit's rendering |
| `setAlbumArtwork` | Refused for a shown album other than one shown only as a containing album, which no memory renders with a cover (A3, extended to listed albums) |
| `setArtistPhoto` | Refused while the artist has any public page (A5), and always for a collection-only artist (ADR 0009 § 8) |
| `removeAlbumArtwork`, `removeArtistPhoto`, unlist, archive album | Always allowed (ADR 0009 § 7), apart from `removeAlbumArtwork`'s and `removeArtistPhoto`'s `review_stale`, which writes nothing |
| `restoreAlbum` | Allowed: it never relists (ADR 0009 § 5). Among public reads, only the collection rule depends on `albums.archived_at`. |
| `linkAlbumToMusic`, `linkArtistToMusic` | Allowed when they fill identifiers only, which no page shows. `linkAlbumToMusic` is refused for an album with a served journal if linking would create its reference edition. A listed album always has one, and a memory page never renders the edition. |
| `importMusicArtist`, `createAlbum`, `createArtist`, and `importMusicRelease` outside the refusal above | Allowed: a new record is not shown, and reused artists and recordings are not changed |
| `deleteAlbum` | Refused for a listed-once album (ADR 0009 § 5), and with `public_page` while the album contains a track linked from a served memory. `album_tracks` cascades from the album, so no foreign key protects the album a memory names (§ 1). A journal about the album, or a memory's album link, already makes it `RESTRICT`. |
| `deleteArtist`, `deleteTrack` | The foreign keys already refuse a credited artist or a linked or tracklisted track (`RESTRICT`) |

**Closing the gap at publication time (amends ADR 0006 § 2, and strengthens it).** Refusal alone leaves one window: while a journal is unpublished its album is not shown, so a catalog edit made **between a publication's preview and its confirmation** would reach the page unreviewed. Therefore:

- **the catalog atoms each page renders join the publication disclosure and fingerprint**, as A5 already did for artist pages:
  - for an album journal: title, year, edition label, credits as rendered (each with its link presence and address), each rendered track's title, credit, and order (the edition's tracks, and any track a served reflection, or one this publication makes public, names), the stored cover or none, and the presence and address of the collection link; when the album is listed (ADR 0009), **the collection page's change**: its approved sentence (ADR 0009 decision 9) replaced by a "Read the journal" link, or the link moved to this journal or added beside the others (ADR 0009 § 11); **the served memories that name the album** (§ 4) **on which it will become a link, or whose link will lead to this journal**, bound by entry id (the Studio title shown beside each is informational, because it can come from an unserved version); and **the served album journal and memory pages on which an artist credit will become a link**, because the publication opens that artist's page (A5), as a listing already discloses them (ADR 0009 § 6; in practice memory pages);
  - for a memory: each link's rendered title, its credited artists **with each one's link presence and address**, and the album named for each linked track: **its identity (the album id), its title, and whether and where it links** (§ 4). So that two albums with the same title can be told apart, the Studio review also shows, and the fingerprint binds, the named album's year and credited artists. Neither reaches the public page;
- **a catalog edit in that window makes the publication stale** (`confirmation_stale`, the fresh disclosure, no token);
- **the confirmed save (amends ADR 0006 §§ 1 and 5):** a memory link's atom gains its rendered wording (title, credits, named album). Today a link is bound by id only, so a track not yet linked could be renamed between `previewPublicChange` and the save. An added or reordered link's wording is now part of the delta, so such a rename makes the save stale. **An album journal's confirmed save** binds the catalog atoms its own page renders (title, year, label, credits with their link presence and address, track wording, cover, and the collection link), not the publication's transition lists (memories and pages gaining links), because a save changes no served state, so a catalog edit between `previewPublicChange` and the save makes it stale; its locks are taken in `saveAlbumJournal` ([`journals/commands.ts`](../../src/modules/journals/commands.ts)), the only album-journal caller of the confirmed-save gate, after `lockAlbumJournal` and before `prepareChange` and `requirePublicChangeConfirmation` compute the delta.

ADR 0006's "Informational lines are not part of the set" therefore ends for catalog wording. That is the resolution proposed for G8, effective once §§ 2, 3, and 4 are built, tested, and reviewed by the owner.

**Pages served before § 2 ships.** Today's fingerprints bind no catalog wording, and A5 allowed renames, credit wording, and track titles after publication. A page served when § 2 is deployed may therefore show wording no review bound, which § 2 would then freeze. So, as for memories in § 4: **before** § 2 is deployed on a database, every served entry there (album journals and memories) is unpublished, and after the deploy each is published again through the new review, before public reads are turned on; or the record shows that none was served, the expected path for both current databases. The record is G8 evidence, beside R1's. Republishing sets a new `published_at` (§ 4). Before anything is unpublished, each served **language version**'s `published_at` is recorded (unpublishing clears it); only the versions recorded as served are then republished, one by one, each through the author's own preview and confirmation in the Studio (ADR 0006 § 3: no script supplies that act), in ascending former `published_at` (ties by descending entry id, then locale, so that `presentedJournals`' lowest-id tie-break picks the same journal), so presentation and order are kept (Consequences).

**When a journal is also published.** Unlisting alone does not make the record editable while a served journal or memory still shows it.

- **The Studio's refusal names every kind of surface that shows the record**: the collection page, and each journal and memory by its Studio title. It is a private, authorized response.
- **The author unpublishes those** through ADR 0006's own unpublish, which asks first, edits, then republishes each through ADR 0006's full preview and confirmation. Each confirmation now binds the new catalog wording.
- **This take-down, edit, and republish path adds no way to publish** (the rule changes this ADR makes elsewhere are in § 3 and [Open decisions](#open-decisions)):
  - there is no new way to publish;
  - every reappearance is reviewed;
  - unpublishing keeps the slugs, the publication history, `first_published_at`, and the reflection flags;
  - a previous address still answers as INV-5 says.
- **The cost** is that the pages are briefly absent and the author confirms each again. Republishing also sets a new `published_at`, so a routine take-down, edit, and republish changes reader-visible dates and order, and can change which journal is presented; the author republishes in the order of the former `published_at` values when that matters, or accepts the change. It is recorded as a consequence. If it proves too high, the confirmed catalog change in [Alternatives](#alternatives-considered) is the next step, through its own decision.

**What remains outside the guard, recorded rather than accepted as harmless:** what external providers serve (an image replaced at the Cover Art Archive under the same Image ID). ADR 0009 § 12's cover switch and the takedown path bound it, and the rights review records it.

### 3. Locks and concurrency

- **Order, for every command in ADR 0009 § 6 and in ADR 0009 § 2:**
  1. entries `FOR SHARE`, in ascending id order: every album journal of the albums involved, as A3 and A5 already do, and **every memory that links any album involved, any track involved, or any track on an album involved, whatever its state**, **except where the table below lists fewer, with its reason**. That includes the memories linking the recordings that `importMusicRelease` reuses, which therefore takes entry locks for the first time;
  2. then albums, in ascending id order: for a write, the mode each command already uses (`FOR UPDATE` in `updateAlbum`, the tracklist commands, and linking; A3's `FOR NO KEY UPDATE` for artwork); `FOR SHARE` otherwise, except as below (an album journal's publication, unpublication, and deletion, and listing, unlisting, and archiving, take the album in a write mode);
  3. then artists, in ascending id order;
  4. then tracks, in ascending id order: **in a write mode (`FOR NO KEY UPDATE`, or `FOR UPDATE` where the command already uses it, as `updateTrack` does) for every track the command changes, adds to an album, or reuses**, before it decides; `FOR SHARE` otherwise.

     Adding a track to an album writes an `album_tracks` row (and, through `rewriteTracklist`, `edition_tracks` rows, whose foreign keys point at `album_tracks` and `album_editions`, not at `tracks`). Its foreign key to the track takes `KEY SHARE`, which does not conflict with a publication's `FOR SHARE`. Today `addTrackToAlbum`, `setAlbumTracklist`, and `importMusicRelease` read the added or reused track with a plain `select`. Without this write-mode lock, a memory published meanwhile would not see the new album and would not wait. `FOR NO KEY UPDATE` conflicts with `FOR SHARE` and still allows foreign-key `KEY SHARE`.

     **Every command whose lock set comes from a read taken before its locks decides from statements run after its last lock**, never from that earlier read (as `updateTrack` does below); a mutation that reuses the earlier set must fail a test. This applies to `importMusicRelease`, the tracklist commands, `updateArtist`, and every row of the table below.

     **`createTrack` with an album follows the order too.** Today it inserts the track and its `track_artists` rows, taking `KEY SHARE` on the artists, before it locks the album ([`commands.ts`](../../src/modules/catalog/commands.ts)). It must lock the entries, the album, and the named artists (`FOR SHARE`) **before** inserting anything. Otherwise, under this order, a rename that changes an artist's identifier and a `createTrack` naming that artist could deadlock with only two transactions. **`importMusicRelease` must do the same:** today it inserts the album, its `album_artists` rows (taking `KEY SHARE` on reused artists), and the tracks before any lock ([`music.ts`](../../src/modules/catalog/music.ts)). It is also the command that takes entry locks for the first time. **`updateTrack` is reordered too:** today its first statement locks the track `FOR UPDATE` ([`commands.ts`](../../src/modules/catalog/commands.ts)). Kept first, with the album locks added after it, it would deadlock with an album journal publication that holds the album and waits for the track. It must take the entries, the albums, and the artists before the track. **`setAlbumArtwork`, and every caller of `lockAlbumPublicExposure` or `lockArtistPublicExposure`, decides only after its album or artist row lock:** today `setAlbumArtwork` decides whether the album is shown and only then locks the album ([`music.ts`](../../src/modules/catalog/music.ts)), so a listing holding the album could commit between the decision and the write. Any other catalog command that inserts or locks rows, or decides, before taking § 3's earlier locks is reordered the same way.

  **What "involved" means, per command** (lock modes as in the order above):

  | Command | Albums | Artists | Tracks | Entries share-locked |
  | --- | --- | --- | --- | --- |
  | `updateAlbum`, the tracklist commands, `createTrack` with an album, `setAlbumArtwork`, `deleteAlbum` (which takes `FOR UPDATE` on the album, then decides `collection_slug IS NULL` and the served-memory refusal in a new statement; never inside the `DELETE`'s own `WHERE`, whose subquery would use a snapshot taken before a waiting confirmed save committed) | that album (write) | the artists it names (share) | its tracks (share); **the tracks added (write)** | the album's journals; memories linking the album or any of its tracks or the added track; for `updateAlbum`'s credit changes, also the journals of every album crediting the named artists (A5's set, kept because `artistsNewlyExposedByCredit` reads them) |
  | `archiveTrack`, `restoreTrack` | none | none | that track (the `UPDATE`'s own lock) | none: allowed with no decision (§ 2) |
  | `updateTrack` (it decides in a fresh statement after its track lock, never from the album set it read before locking) | every album containing the track (share) | the track's stored and new artists (share), for lock-order hygiene: the track's credit rows are read and written under them (the track's own write lock already serializes it with publications) | that track (write) | journals of those albums; memories linking the track or those albums. Not memories linking other tracks on those albums: a track edit changes only that track's atoms, and no other track's named album depends on it |
  | `updateArtist`, `restoreArtist`, `setArtistPhoto`, `archiveArtist` | albums crediting the artist, and albums of tracks crediting it (share) | that artist (write) | tracks crediting it (share) | journals of those albums; memories linking those albums or tracks. Not memories linking other tracks on those albums: a memory renders an artist only through the track or album it links directly |
  | `importMusicRelease` | the albums already containing each reused recording (share) | reused artists (share) | **reused recordings (write)** | memories linking the reused recordings only: under § 4 no journal decides the named album, and the new album has no journal (§§ 2, 3, and 4 merge as one change, so this lock set never runs under M3.7's rule) |
  | `linkAlbumToMusic` | that album (write) | none | none | the album's journals only: it changes only identifiers, which no memory renders |
  | `archiveAlbum` (with its listing clear) | that album (write) | its credited artists (**write**, `FOR NO KEY UPDATE`) | none | none, as for `unlistAlbumFromCollection`: both are reductions serialized on the album row, and a memory sees the listing only through its artist links (ADR 0009 § 7; addresses: R2) |
  | `listAlbumInCollection` | that album (write) | its credited artists (**write**, `FOR NO KEY UPDATE`) | its reference edition's tracks (`FOR SHARE`), whose titles and lengths it binds | the album's journals only: a memory sees a listing only through its artist links, and memory publications serialize with it on the artist rows |
  | `unlistAlbumFromCollection` | that album (write) | its credited artists (**write**, `FOR NO KEY UPDATE`) | none | none: a reduction, and every publication that renders the album already locks its row (album journal publications `FOR NO KEY UPDATE`; their confirmed saves and memories `FOR SHARE`) |
  | `removeAlbumArtwork` | that album (write, A3's `FOR NO KEY UPDATE`) | none | none | none: always allowed (ADR 0009 § 7). The album row serializes it with every publication and listing that binds the cover |
  | `restoreAlbum` | that album (write) | none | none | none: it never relists, and no public read other than the collection rule depends on the archived state (§ 2) |
  | `removeArtistPhoto` | none | that artist (write) | none | none: always allowed (A5). The artist row serializes it with the publications that bind the photograph |
  | `linkArtistToMusic` | none | that artist (write) | none | none: identifiers only, which no page shows |
  | `createAlbum`, `createArtist`, `importMusicArtist`, `createTrack` without an album | none | none (`createTrack`'s `track_artists` inserts take only `KEY SHARE`) | none | none: a new record is not shown |
  | `deleteArtist`, `deleteTrack` | none | the deleted artist (the `DELETE`'s own lock) | the deleted track (the same) | none: the `RESTRICT` foreign keys decide (§ 2) |
  | An album journal's **confirmed save** | its album (`FOR SHARE`) | its credited artists (`FOR SHARE`) | the tracks its page renders: its edition's, and any a served reflection, or one this save makes public, names (`FOR SHARE`) | its own entry (`FOR UPDATE`, ADR 0006). It changes no served state, address, or `published_at`, so share locks suffice |

- **The entry commands** (an album journal's publication, unpublication, and deletion; a memory's publication and confirmed save) take the locks described in the points below, not in the table above; the static lock-order test uses the table and these points together.
- **Publications and confirmed saves lock what their fingerprint binds (amends L3; addresses R5).** Under its entry lock, a publication or confirmed save takes `FOR SHARE`, in § 3's order, on the catalog rows its catalog atoms are read from (§ 2): for an album journal, the tracks its page renders (its edition's tracks, and any track a served reflection, or one this publication makes public, names), and for its **confirmed save** also its album and credited artists (a **publication** takes those two `FOR NO KEY UPDATE` instead, below); for a memory, each linked album and track, the albums containing each linked track, the artists credited on the linked albums and tracks, and **the named albums' credited artists**, whose names its Studio review shows and binds (§ 4). It then computes the fingerprint.
  - **A confirmed save locks the links of its current and resulting states** (their union), so a save that removes a link still holds that link's rows and serializes with a publication that lists the memory: links it adds, their albums, the albums containing an added track, and their artists, all `FOR SHARE` before it computes the delta. Its `memory_music` inserts take only `KEY SHARE`, and a concurrent `updateTrack` share-locks only memories that already link the track. Without this lock, a rename of a track being newly linked would pass unrefused, and the save would commit wording the author never reviewed.
  - **After its track locks, a publication or confirmed save also re-reads the credited artists (`track_artists`) of each linked or added track,** and refuses `confirmation_stale` when that set differs from the artists it locked. Artists are locked before tracks, so a credit changed and changed back between its artist read and its track lock (an ABA) would otherwise leave a rendered artist unlocked, and a publication opening that artist's page could commit unseen.
  - **After its track locks, a publication or confirmed save re-reads the albums that contain each linked or added track.** If that set differs from **the set of albums containing those tracks that it read and locked before the track locks** (not the albums it links directly), it refuses `confirmation_stale` and writes nothing. This fails closed: it refuses even when the named album and every atom are unchanged, and the author then confirms an identical fresh disclosure. Albums are locked before tracks, so an album that gains the track while the save waits (through `addTrackToAlbum`, on an album the save did not lock) would otherwise go unlocked, and a later edit of that album could change the album the memory names.
  - `FOR SHARE` conflicts with every catalog write mode above. A catalog edit that holds a row makes the publication wait, and the publication then fails as stale. A publication that holds the rows makes the edit wait, and the edit then sees the record shown and refuses.
  - This narrows L3's "no entry command takes an explicit catalog lock" without changing its order: catalog locks still come after the entry lock, and catalog commands take entries before catalog rows, so the design forms no cycle (R6's tests must show it).
  - An entry created during a catalog command (A3's late-entry window) is now serialized too: its publication waits on the catalog rows.
  - **An album journal's publication, unpublication, and deletion, and unlisting or archiving an album, take that album's credited artists `FOR NO KEY UPDATE`** after the album row, as a listing does. A publication's review lists the served pages on which an artist credit will become a link (§ 2). A memory publication that renders one of those artists share-locks it, and another album journal's publication takes it `FOR NO KEY UPDATE`, so the two serialize, and whichever previewed before the other committed fails `confirmation_stale`. With share locks on both sides, two overlapping publications could each miss the other, and a memory credit could become a link that neither review showed. The reductions take the same lock so that an artist page cannot close and then reopen through a publication whose review counted it as already open (A5's "an artist page reappearing through a journal whose review did not list it"): journal J1 previews while artist A has a page through J2 or a listing; if J2 is unpublished, or the album unlisted, before J1 commits, J1 waits on A and then fails stale. The order is unchanged (entry, album, artists in ascending id order).
  - **Journals of one album serialize on the album row.** Publishing, unpublishing, or deleting an **album journal** takes its album row `FOR NO KEY UPDATE`, not `FOR SHARE`, after its entry lock. Two such transitions on journals of the same album (which together decide the collection page's journal links and sentence) therefore run one after the other, and each recomputes under the lock what the collection page will show. The order stays entry, then album, so the design forms no cycle (R6's tests must show it):
    - a catalog command waits on the entries before it takes the album, and the commands that take no entries (for example `unlistAlbumFromCollection`, `restoreAlbum`, `removeAlbumArtwork`, `removeArtistPhoto`, and `linkArtistToMusic`; every row of § 3's table with "none" in its entries column) never wait on an entry while holding a catalog row; unlisting then takes only the album's credited artists, later in the order;
    - listing waits on the album's journal entries first;
    - foreign-key `KEY SHARE` locks of new journals and memory links are not blocked by these modes. A listing takes the album `FOR UPDATE` (a first listing changes the unique `collection_slug`), so a new journal or memory link of that album waits for the listing to commit; it holds nothing the listing needs, so no cycle is designed to form.

  **Holding several entry locks is new for most of these commands.** A3 and A5 lock album-journal entries only, for the commands they list, and A3's note on L2 says that any other command holding several entry locks needs its own decision. **This ADR proposes that decision for the owner's approval:** every command in § 3's table whose entries column is not "none" (the tracklist commands, `createTrack` with an album, `updateAlbum`, `updateTrack`, `setAlbumArtwork`, `deleteAlbum`, `importMusicRelease`, `linkAlbumToMusic`, `updateArtist`, `restoreArtist`, `setArtistPhoto`, `archiveArtist`, and `listAlbumInCollection`) may hold several entries, album journals and memories, `FOR SHARE`, in one ascending id list. The album journal's confirmed save is not among them: it holds only its own entry. No entry command waits on a second entry, so no cycle is designed to form among them (R6's tests must show it).

  **L1 gains a narrow exception (not a reading), for the owner to approve at acceptance.** L1 says a transaction that reads a row owned by entry E in order to decide first locks E `FOR UPDATE`. A5's "a publication locks only its own entry" is the precedent for artist pages. This ADR adds a **closed list** of readers that decide from other entries' rows **without those entry locks**, each serialized through catalog rows instead:

  | Reader | Rows of other entries it reads | Serialized through | Window left |
  | --- | --- | --- | --- |
  | An album journal's publication | (a) served memories' `memory_music` and state (memories that name the album; memory pages on which a credit becomes a link) | the album row and its credited artists' rows (`FOR NO KEY UPDATE`), which every memory publication and confirmed save that could add to or remove from those lists locks first | § 4's C7 and R4: a memory's unpublication or deletion |
  | An album journal's publication | (b) the other served journals of the same album (which journal is presented, the collection page's links, where memory links lead) | the album row (`FOR NO KEY UPDATE`), which every journal transition of that album takes | none |
  | An album journal's publication | (c) other albums' served journals and listings (A5's artist pages that open and address changes, "Artist pages gaining a journal", credits that become links); A5 already records this read | its credited artists' rows (`FOR NO KEY UPDATE`), which every journal transition, listing, unlisting, and archive crediting them takes | namesakes (R2, R4) |
  | An album journal's confirmed save | other journals and listings that decide its credits' link presence and address, (its own album's listing, the collection link, is a catalog row, read under its album lock) | its album and credited artists' rows (`FOR SHARE`), which those transitions take in a write mode | namesakes (R2) |
  | A listing | (a) served memories' `memory_music` and state, and other albums' served journals (the artist pages it opens or changes, the existing artist pages that will list the album, and the pages on which a credit becomes a link) | its credited artists' rows (`FOR NO KEY UPDATE`), which every journal transition and memory publication rendering them locks | R4: the same memory reductions, and namesakes |
  | A listing | (b) journals of its own album created after its entry-lock statement | the album row (`FOR UPDATE`), which every album journal transition takes `FOR NO KEY UPDATE` | none |
  | Every guarded catalog command of § 2 | entries created, or links added, after its entry-lock statement (A3's late entries), and, for `updateTrack`, the journals and memories of an album that gained the track after it read its album set | the catalog rows it holds in a write mode, which every publication and confirmed save share-locks before deciding, and the track row, which `addTrackToAlbum` takes in a write mode | none, once R5's tests pass |
  | A memory's publication or confirmed save | (a) the named album's served journals (its link's presence and address, § 4) | the named album's row (`FOR SHARE`), which every album journal transition takes `FOR NO KEY UPDATE` | none |
  | A memory's publication or confirmed save | (b) served album journals and listings that decide each credited artist's link presence and address | the credited artists' rows (`FOR SHARE`), which every journal transition, listing, unlisting, and archive crediting them takes `FOR NO KEY UPDATE` | namesakes (R2, R4) |

  Apart from L4's slug uniqueness reads, L5's lock-free previews, and PostgreSQL's own foreign-key enforcement (as L3 exempts foreign-key locks), no other command may read another entry's rows to decide without that entry's lock; a static test is a tripwire that enumerates the rows above and flags other readers of entry-owned rows, as ADR 0006 § 9's scans are; the behavioural tests of § 5 and § 4 are the proof. **L6 is narrowed for these atoms only:** a reduction in the window column, or a namesake's transition on another artist row (an addition included), can commit between a reader's comparison and its write. The end state is then what the review showed, minus any reduction, except R2's derived artist addresses, which may change value (ADR 0009 § 7's recorded exception).

  Apart from the locks above (the share locks on fingerprinted catalog rows, and an album journal's own album row and credited artists `FOR NO KEY UPDATE`), no entry command takes an explicit catalog lock.

  **Where the album lock lives.** `publishAlbumJournalVersion` checks the kind before the engine opens its transaction, and ADR 0006 § 4 step 3 says the engine takes no kind. The album lock is therefore taken **inside the engine**: under the entry lock, it looks up `album_journals` for the entry and, when it finds a row, locks that album. **A memory's publication** takes its catalog locks in the engine too: under the entry lock, it reads the memory's `memory_music` and share-locks, in § 3's order, the linked albums, the containing albums, the artists credited on the links and on the named albums, and the linked tracks, then re-reads the containing albums (above). A memory's confirmed save takes the same locks in `saveMemory`, after `lockMemory`. **Unpublishing** takes the album lock in the engine too (`unpublishLanguageVersion` can learn the kind under its entry lock: it calls `lockLiveEntry`, which returns it), so every caller takes it. **Deleting** has no Publication command: `deleteAlbumJournal`, the only command that sets an album journal's `deleted_at`, takes the album row and then its credited artists after `lockAlbumJournal` ([`journals/commands.ts`](../../src/modules/journals/commands.ts)), or the deletion moves into a Publication command that does. `permanentlyDeleteEntry` acts only on an already-deleted, unserved entry and needs none. A test asserts that every album-journal unpublish and delete path takes the album and artist locks. For publications and confirmed saves, **the token's expiry and every atom are read after all of § 3's locks** (for a publication, the album and its credited artists `FOR NO KEY UPDATE`; for a confirmed save, `FOR SHARE`; and the catalog share locks), as L6 requires. Unpublishing and deleting carry no token. **Listing share-locks the album's own journal entries first,** because the served-journal links it discloses depend on them. The artist pages it discloses can also depend on other albums' journals, whose transitions serialize with it on the artist rows. What remains is R4's: memory reductions and namesakes.
- **Publication against catalog edits.** A publication takes its entry `FOR UPDATE`, then, for an album journal, its album and then its credited artists `FOR NO KEY UPDATE`, and the other catalog rows `FOR SHARE`. A catalog edit holds the entry `FOR SHARE` and its catalog rows in a write mode before deciding. Either the edit commits first and the publication's fingerprint, which now binds catalog atoms, fails as stale; or the publication commits first and the edit then sees the record shown and refuses.
- **Listing against catalog edits.** Listing locks the album's journal entries `FOR SHARE`, the album `FOR UPDATE`, its credited artists `FOR NO KEY UPDATE`, then its reference edition's tracks `FOR SHARE`. The track lock is needed because `updateTrack` serializes with an album only through the album set it read before its locks: an album that gained the track meanwhile (through `addTrackToAlbum`) would otherwise be listed with the old title while the rename commits. The artists' `FOR NO KEY UPDATE` conflicts with the `FOR SHARE` that publications and confirmed saves take on the artists they render, so they serialize with the listing (R4), and it still allows foreign-key `KEY SHARE`. An edit that holds one of those rows makes the listing wait and then fail as stale. A listing that commits first is seen by the edit, which then refuses.
- **Residual windows** are not closed by this order. Each is listed in [Residual risks](#residual-risks) with its cause, consequence, mitigation, test evidence, and criterion: R4 (reductions and namesakes during a listing or a publication) and R6 (deadlocks). R5 (late entries) is addressed by the publication share locks above, which are not built, and stays open until its test passes. R1 (a memory's named album) is not a lock window: § 4 would remove its only input that no review covers (other journals' state, which an unpublication with no token could change). Its remaining inputs are catalog rows, which § 2 guards and the locks above serialize, and it stays open until § 4 is built and tested.
- **Isolation.** The default `READ COMMITTED` is enough, because every decision is made by a statement that runs after the locks.

### 4. The album a memory names (residual risk R1)

A memory page names, for each recording it links, one album (M3.7). Today that choice prefers an album with a served journal, so publishing or unpublishing **another** album's journal can change what a served memory shows with no review: [R1](#residual-risks), a G8 item. Decision 21 asks for a named album that does not depend on other journals and stays stable and predictable, under seven conditions. Two designs meet the direction; decision 22 makes the second the preferred direction **to investigate**, without authorizing its migration.

| | **Option A: dynamic, deterministic selection** (the previous proposal) | **Option B: a stored, explicit association** (preferred direction, not authorized) |
| --- | --- | --- |
| Identity | Recomputed on every read: the earliest containing album by year, code-point title, and id | Stored on the memory's link row: `memory_music.named_album_id`, chosen when the link is saved |
| What can change it | Any catalog edit to **any** containing album (a new album with the recording, a year or title change), so § 2 refuses those while the memory is served | Only the memory's own save, under its entry lock, through the confirmed save once published |
| Catalog guard needed | Every containing album, for title, year, membership, deletion | Only the named album, for its title (rendered) and its membership and deletion (enforced by a foreign key) |
| Locks needed beyond § 3's common core | Write-mode locks on added and reused tracks, the re-read of containing albums, `importMusicRelease` taking memory entry locks and refusing ties, code-point collation | None beyond the share lock on the named album's row |
| Schema | None | One nullable column and one composite foreign key (a migration) |
| Product effect | A recording on a later journaled album loses its link; any catalog edit to a containing album can be refused | Removing the recording from the named album, or deleting that album, is refused while any memory names it (any state); a recording on no album names none until the memory is saved again |

#### Option B: a stored, explicit association (evaluation)

**Which row carries the identity.** The identity is a property of one link in one memory, so it lives on `memory_music`, the entry-owned row the memory's lock already covers.

- **It points at the recording on that album, not at the album alone.** A composite foreign key `(named_album_id, track_id)` references `album_tracks (album_id, track_id)`, the existing primary key. It guarantees that the named album really contains the linked recording, which a key to `albums` alone would not. It is the same pattern as `track_reflections_album_track_fk`, which references `album_tracks` with `RESTRICT` ([`schema.ts`](../../src/db/schema.ts)).
- **Not an edition track.** `edition_tracks` describes the reference edition's order and disc. A memory names an album, not a position in one edition, and an edition's tracklist can be rewritten (`rewriteTracklist` deletes and re-inserts `edition_tracks` rows) without the album losing the recording.
- **Only for recording links.** `named_album_id` is `NULL` for an album link (`memory_music.album_id` is the album itself) and may be `NULL` for a recording that is on no album. A `CHECK` keeps it `NULL` when `track_id` is `NULL`.
- **`ON DELETE RESTRICT`**, never `CASCADE` (AGENTS § 4: no cascade from catalog to authored content).

**Behaviour.**

| Event | Effect |
| --- | --- |
| Deleting the named album | `album_tracks` cascades from the album, and the foreign key then refuses: the delete fails with `in_use` (blocked by memories), as it does today for reflections. Archive instead. |
| Removing the recording from the named album (`removeTrackFromAlbum`, `setAlbumTracklist`) | Refused `in_use` by the foreign key, **for any memory in any state** (draft, private, deleted, served), like today's reflection rule in `rewriteTracklist`. This is a product effect (below). |
| Archiving or restoring the named album | No effect on the identity, as today; the link to a served journal stays (archiving does not hide a journal). |
| Adding the recording to other albums, importing a release that reuses it | No effect on any memory. No refusal, no memory entry lock. |
| Renaming the named album | Its title is rendered, so § 2 refuses it while a memory naming it is served (only that album, not every containing one). Its year is not rendered and no longer decides anything, so it is not guarded on that account. |
| Publishing or unpublishing **another** album's journal | No effect (condition 4). |
| Publishing the named album's journal | The name becomes a link; that publication's review lists the served memories gaining it (§ 2), serialized on the album row (§ 3), as in option A's C1 and C2. |
| The memory's save | Sets or changes `named_album_id` under the entry lock. For a published memory it goes through the confirmed save, whose delta shows the old and new album (condition 3). |

**Recordings on several albums.** The memory names exactly the album stored for that link. Two memories may name different albums for the same recording, which is the point: each author choice was reviewed.

**Choosing the value in the Studio.** Two variants, a product decision ([Open decisions](#open-decisions)):

- **B1, filled automatically:** when a recording is linked, the save stores option A's rule evaluated at that moment (the earliest containing album). The editor and the review show it. No new control.
- **B2, chosen by the author:** the editor offers the albums that contain the recording, defaulting to B1's value. It needs a control the V4.4 design does not show, so a design review.

Either way, the publication preview and the confirmed save disclose the album's title, year, credited artists, archived and "not otherwise public" marks, and link target (as option A describes), and the fingerprint binds `named_album_id`.

**Preserving published memories and migrating data.**

- The migration (through `/refrain-db-change`, when authorized) adds the nullable column, the `CHECK`, and the composite foreign key, and backfills each recording link with the album the page shows **at that moment** under M3.7's rule, so no served page changes at the migration.
- The backfill is not a review. As for option A, every memory served when the change is deployed is unpublished before it and republished through the new review after it (the transition of § 2), or the record shows none was served. On 2026-11-12 the author's local database had nothing published, and the hosted database holds only synthetic data.
- The migration is tested on fresh and populated databases, including memories linking a recording on zero, one, and several albums, and album links.

**Translations.** Catalog titles are never translated. The Studio's new labels (the album line in the reviews, the B2 control if chosen, the `in_use` message naming memories) ship in English and Brazilian Portuguese (ADR 0008).

**Fewer locks and races.** Compared with option A, option B removes from §§ 2 and 3: the guards on containing albums other than the named one, the write-mode locks on tracks added to or reused by other albums for memory purposes, the re-read of containing albums, `importMusicRelease`'s memory entry locks and refusal, the code-point collation, and C3 to C5 of option A. What remains: the share lock on the named album's row (C1, C2), the confirmed save locking its links, and the `track_artists` re-read (credits are still rendered). The foreign key turns a class of decide-before-lock races (deleting the album, removing the recording) into constraint failures that PostgreSQL enforces.

**Against the owner's conditions** (proposed arguments, for the owner's judgement): conditions 1 and 4 hold by construction (nothing is published; no journal state is an input); condition 2's private-title question is the same as option A's (a title appears only after a review discloses it); condition 3 is met by the review and the fingerprint; condition 5 still carries R2 for artist addresses; condition 6 needs fewer ADR 0006 changes than option A, but still those of § 3; condition 7: B1 adds no new kind of metadata, B2 adds a Studio control, and both change the catalog behaviour in the table above, so **the owner decides** (Open decisions).

**Tests (real PostgreSQL), if chosen:** the constraint and its `RESTRICT` on delete and removal for every memory state; the backfill on a populated database; the review binding (`named_album_id` dropped from the fingerprint fails); a memory's confirmed save changing the named album against a rename of the old or new album (one waits, the other is stale or refused); publishing the named album's journal against the memory's publication (C1); another album's journal state never changing the memory's response; the B2 control in both languages at desktop and 390px, if chosen.

**Not decided by option A or B:** whether a memory links a listed named album's collection page. That is a new kind of link, pending in [Open decisions](#open-decisions); until decided, a memory never links to a collection page.

#### Option A: dynamic, deterministic selection (specification kept from the earlier proposal)

This was the proposal reviewed under ADR 0009. It stays as specified, for comparison and as the fallback if option B is not approved.

**The rule.** For each recording a memory links, its page names exactly one album, **the named album**:

- chosen among **every** album that contains the recording (`album_tracks`), whether listed, archived, or neither;
- the earliest by `first_release_year` (unknown last), then `title` in code-point order (`COLLATE "C"` on UTF-8), then album id.

For an album link, the named album is the album itself, as today. A recording on no album names none.

- **Its inputs are catalog rows only:** `album_tracks`, and the containing albums' year, title, and id. **No entry's state is an input**: no journal's or memory's publication, unpublication, deletion, restore, draft, or private state, and no listing. Another album's journal therefore cannot change it (condition 4).
- **Code-point order on the title** makes the choice independent of the database's collation. Restoring into a server with another collation, or a collation-library upgrade, cannot change it. M3.7's query uses the default collation today.
- **Archived state is not an input**, as today. Archiving or restoring the named album changes nothing a memory shows. Excluding archived albums would make archiving replace the name with another album's, which is an addition, not a takedown. [Product](../product.md) rule 6 ("Links to it become plain text") is read here as it is today in `memory-music.ts`: the album's link is to its journal, which archiving does not hide, so the link stays. That reading is part of condition 7's acknowledgement.

**What the page renders for it.** The kinds of metadata are exactly today's (M3.7):

- the named album's title, as stored;
- a link **only when the named album has a served album journal**, to the journal presented for the album ([ADR 0002, D1.2](0002-domain-model-decisions.md); `presentedJournals`) at its served `/albums/<slug>` address. Otherwise it is plain text;
- nothing else of the album: no year, cover, credits, or collection link.

**This ADR's proposal on condition 7, for the owner's judgement: no new kind of metadata is shown.** Whether changing which album fills the slot (including a private-catalog title marked "not otherwise public") is a new product decision is the owner's call, recorded as its own acknowledgement in [Open decisions](#open-decisions); until it is given, § 4 stops. A public memory shows the same kinds of metadata as today: titles, credited artists, one album title per recording, and links only to pages already public. Only which album fills that slot changes. One visible consequence follows. A recording that is also on a later album with a served journal names the earlier album, as plain text when the earlier album has no served journal, where today it names the later album with a link. That is the cost of stability. **The owner's acknowledgement of this consequence is pending** ([Open decisions](#open-decisions)) and is not presumed.

A link from a memory to a **collection page** would be a new kind of link on a memory page. **It is not decided here.** It is recorded as pending in [Open decisions](#open-decisions), and until the owner decides it, a memory never links to a collection page.

**The identity is part of the memory's review (condition 3).**

- A memory's publication preview, and its confirmed save, disclose for each linked recording the named album's title, **its year and credited artists** (so that albums with the same title can be told apart), and whether and where it links (the journal's address).
- **Dialog content changes, for the Studio design review** (no new control and no public change):
  - the memory publication dialog lists each song's album and whether it links today (`memory-publish-dialog.tsx`). It gains the year, the credited artists, a mark when the named album is archived, a mark when its title is **not otherwise public** (the album is neither listed nor has a served journal), and the link's target;
  - the confirmed-save dialog (`memory-change-dialog.tsx`) lists changes without any album today. It gains the named album, as above, for each added or reordered link;
  - the album journal publication dialog gains the two lists of § 2: memories that name the album, and pages on which a credit becomes a link.
- The fingerprint binds the album's **id**, its title, year, and credited artists, and the link's presence and address (§ 2). The id is bound and not shown; the year and artists are shown in the Studio only. The "archived" and "not otherwise public" marks are informational and not bound: they help the author read the review, and neither changes what the page shows. "Not otherwise public" means the album is neither listed nor has a served journal; its title may still appear on another served memory that names it.
- **The atoms, for ADR 0009 § 7's subset comparison:**
  - each link's atom: the recording's or album's title, its credits, and the named album's id and title;
  - each credited artist's link presence: an atom of its own, as in ADR 0009 § 7. Its address is bound in the fingerprint; an address change is R2's;
  - the named album's link presence: an atom of its own, so a link that becomes plain text is a removal;
  - the link's target address: bound in the fingerprint, but, like the collection page's link order, not compared by the subset test, because it is derived from which journals are served.
- A change of any of them between the preview and the confirmation makes the publication or save `confirmation_stale`, with a fresh disclosure and no token.

**What can change what a served memory shows for its named album.**

| Operation | Effect on a served memory | Governed by |
| --- | --- | --- |
| Publishing, unpublishing, deleting, or restoring a journal of **another** album; listing or unlisting any album | None on the named album or its link. Artist credits on M can become links or plain text; those follow A5 and ADR 0009 § 8 (an addition is disclosed by the publication or listing that causes it, a removal is a reduction, and an address change is R2) | The rule: no entry state and no listing is an input |
| Restoring a deleted journal of the named album | None: a restore never publishes ([ADR 0005](0005-restoring-deleted-journals.md)) | ADR 0005 |
| Publishing a journal of **the named album** | The album becomes a link, or its link now leads to the newly presented journal | That publication's review lists those served memories and binds them (§ 2) |
| Unpublishing or deleting a journal of the named album | The link becomes plain text, or leads to the album's remaining presented journal | A reduction (ADR 0009 § 7). Which served journal a link leads to is derived from atoms already public, like the collection page's link order (ADR 0009 § 7), so it is not an atom of its own |
| Adding the recording to an album that would precede the named one; changing the year or title of any album containing it; removing it from the named album; deleting the named album | Would change the named album or its title | **Refused** while the memory is served (§ 2, whose tracklist commands refuse adding the recording to any album, conservatively). While it is not served, the next publication or confirmed save discloses the result |
| Archiving or restoring the named album | None on the named album or its link; artist credits on M follow ADR 0009 § 7 when archiving also unlists (a reduction; addresses: R2) | Allowed (ADR 0009 § 7 for archiving; § 2's `restoreAlbum` row) |
| The memory's own confirmed save | What it reviewed | ADR 0006's confirmed save, with § 2's atoms |
| Unpublishing or deleting the memory | The page answers the identical `404` | ADR 0006 |

No command sets `album_journals.is_featured` today, and `changeEntrySlug` ([`publication/commands.ts`](../../src/modules/publication/commands.ts)) has no production caller. Either would change where a memory's link and a collection page's link lead. ADR 0006 § 5 lists featuring as needing no confirmation and an address change as exempt. **This ADR does not change those rows:** a caller of either would need its own decision. A link's target address is bound in the fingerprints of § 2 and § 4 for staleness only; it is not an atom for ADR 0006 § 5 or for ADR 0009 § 7's subset comparison.

**Condition 6: what is preserved, and what changes.**

- **Unchanged by § 4's text:** § 4 adds no predicate fragment (ADR 0009 § 3 adds the collection's); every publication still needs ADR 0006's preview, token, and the author's act; every reduction stays tokenless; and the lock order (entries, then catalog rows) is kept.
- **To be shown, not claimed:** that no end state adds anything a review did not show (apart from R2's addresses), and that no cycle is introduced. These are R5's, R6's, and § 4's tests 5 to 7, none of which exists yet.
- **Changed, and stated for the owner:** § 4 relies on changes to ADR 0006's concurrency rules: the whole of L1's exception for the readers of § 3 (every row of its table, its late-entry row included), L1 read with A3 for `memory_music`, L2 (several entries, album journals and memories, held `FOR SHARE` by every command in § 3's table with entries, which C4, C5, and C8 rely on), L6's narrowing (§ 4's C7), L3's catalog locks, ADR 0006 § 4 step 3's engine lookup, **A3's lock procedure** (the decision after the album row lock; no entry locks for `removeAlbumArtwork`), and **the lock order in A5's operation table superseded by § 3's, and A5's operation rules narrowed** (§ 2, including the import refusal; C4, C5, and C8 rely on the new lock sets), **ADR 0006 § 6's version rule** (atoms another transition can change bound by the fingerprint instead of `entries.version`), together with ADR 0006 §§ 1, 2, and 5's new atoms. **Changes to the publication predicates** also reach § 4's memory pages: ADR 0009 § 3's new collection fragment, and ADR 0009 § 8's extension of A5's artist set, which memory credit links follow. They come from the collection, not from § 4, but the owner judges them under condition 6 too. So are **ADR 0006 § 14's G8 closure criterion** (R1 is a G8 item) and **ADR 0006 § 5's subset rule**, as ADR 0009 § 7 evaluates it (derived values and link targets are not atoms; R2's address change is an exception). Each is in [Open decisions](#open-decisions) under explicit approvals.
- Condition 6 as the owner set it asks that ADR 0006's guarantees and concurrency protections be **preserved**. Whether these changes meet it is for the owner to say. It is **recorded as an acknowledgement still to be given** and is not presumed.

**Against conditions 1, 2, and 5 (for the owner's judgement).**

- **Proposed argument on condition 1 (for the owner's judgement).** No entry, page, listing, or address becomes public through this rule: it publishes no entry, opens no page, lists no album, and adds no sitemap or archive row. It changes which catalog title a served memory displays, and a private-catalog album title can appear on a memory, only after that memory's review discloses it (the visible consequence in [Open decisions](#open-decisions)).
- **Proposed argument on condition 2 (for the owner's judgement).** A title from an album that is neither listed nor journaled appears only on a memory whose review disclosed it and whose author confirmed it. Once § 2 is built, no catalog command could substitute another album while the memory is served. The named album never gains a page, a collection entry, or an address through a memory.
- **Takedown (proposed argument, to be tested).** Every takedown is designed to be a subset (ADR 0009 § 7): unpublishing the memory removes the page, unpublishing the named album's journal turns the link into plain text, and archiving changes nothing on the named album (an unlisting it causes can turn artist credits into plain text, a reduction). None introduces another album's title. None creates an address, with one recorded exception, R2's: closing an artist page can move a namesake credited on M from its suffixed address to the bare one (ADR 0009 § 7, owner condition 5). Because the rule reads no entry state, a served memory's music is identical whatever drafts, private texts, deleted entries, or unpublished translations exist, which ADR 0009 § 4's test, once built, extends to memory pages for this rule.
- Conditions 2 and 5 are recorded as acknowledgements still to be given ([Open decisions](#open-decisions)): condition 2 within the acknowledgement of § 4's visible consequence, condition 5 in its own.
- **Addresses the named album can lead to.** A named album never links to an address that is not already served: only to an album journal already served, at its served address, never to a collection page (pending above) or to an artist page that is not already open. Whether condition 5 is met, given R2, is the owner's acknowledgement in [Open decisions](#open-decisions).

**Concurrency.** The rule adds no lock. It relies on § 3's:

| Scenario | What happens |
| --- | --- |
| **C1.** Publishing a journal of the named album B, against a publication or confirmed save of a memory M naming B | M share-locks B; B's journal publication takes B `FOR NO KEY UPDATE`. They serialize. If the second one's preview came before the first one committed, its disclosure now differs (M gains a link, or B's list gains M) and it fails `confirmation_stale` |
| **C2.** Unpublishing B's journal, against M's publication | They serialize on B. If the unpublication commits first, after M's preview, M's link presence differs from that preview, so M's publication is stale. If M runs first, the unpublication is a reduction on M |
| **C3.** Publishing or unpublishing a journal of an album that contains the recording but is not named | No effect on M's named album or its link, whatever the order. Artist links follow A5 and ADR 0009 § 8, as in the table above |
| **C4.** Adding the recording to an earlier album, against M's publication | `addTrackToAlbum` share-locks M's entry first (§ 3's table), so it and M's publication serialize on the entry: the addition sees M served and is refused, or M's publication fails stale when the new album precedes the named one (otherwise M's atoms are unchanged and it commits). For a memory that is newly linking the recording in a confirmed save, the catalog command's write-mode lock on the track it adds, and the save's re-read of containing albums, do the same |
| **C5.** Re-dating or renaming a containing album, against M's publication | M share-locks every containing album; the edit holds it in a write mode. Stale or refused, as in § 3 |
| **C6.** M's confirmed save adding a recording, against an edit of an album containing it | The save locks its resulting links' containing albums (§ 3) and serializes with the edit |
| **C7.** M unpublished while B's journal publication, which lists M as gaining a link, commits | Nothing serializes them: unpublishing is a reduction and locks no album. The end state is a subset of B's review (M absent). Recorded like R4's reductions, and to be tested |
| **C8.** `deleteAlbum` or `removeTrackFromAlbum` on a containing album, against M's publication | The command share-locks M's entry and holds the album in a write mode. If it commits first and the album was the named one M's publication fails stale; otherwise M's atoms are unchanged and it commits, as in C4; if M commits first, the command sees M served and refuses |

**Transition.** The rule ships no earlier than, or together with, everything it relies on: § 2's fingerprints and refusals for containing albums, § 3's locks (including the album journal's artist and album locks), the album journal's new disclosure lists, and the dialog changes above. Shipped alone, a catalog command could change a served memory's named album with no review.

- **Before** that change is deployed on any database, every memory served there is **unpublished** (public reads may also stay off meanwhile, but that alone is not enough: a memory that stays published cannot be published again, and a confirmed save reviews only its delta). After the deploy, each language version recorded as served (and no other) is published again through § 4's review, by the author's own act in the Studio, and only then are reads turned on. Otherwise the deploy itself would change served memories' named albums with no review, widening G8. Comparing the two rules is not enough: the old rule's result drifted with other journals' states, and nothing bound what the author reviewed then, so a memory whose two results agree today may show an album its author never reviewed. Alternatively, the record shows that the database had no served memory at the deploy, **the expected path for both current databases**. Either is recorded as R1's evidence. The record holds entry ids and `published_at` values from a real database, so it is kept outside the repository, with only counts in committed evidence.
- **A visible side effect:** unpublishing clears `published_at` and republishing sets a new one ([`publication/commands.ts`](../../src/modules/publication/commands.ts)), so a republished memory shows a new date and moves in `/memories`, "Recently written", and the Home. `first_published_at` and the slugs are kept. It is recorded under Consequences.
- A read-only comparison of the two rules may still run, as a diagnostic only.
- On 2026-11-12, the local database had nothing published, and the hosted database holds only synthetic data. The record is still required.
- Confirmation tokens minted before the change fail as stale, because their fingerprints bind different atoms. That fails closed.

**Tests** (real PostgreSQL unless stated; each a merge condition, with each mutation seen to fail). Letters: in tests 1 and 2, A is the named album and B another containing album; in test 4 and in C1 to C8, B is the named album, as in the tables above.

1. **The rule matrix:** a memory linking a recording on albums A (earliest) and B (credited with no artist of the recording, and no namesake of one, for the whole-response assertion), across each journal state of A and of B (none, draft, private, served, unpublished, deleted, restored, and served with an unpublished translation), each archived state, and each listing state. The named album is always A, and it links exactly when A has a served journal. Two assertions:
   - the named-album part of M's music is identical across every state of B's journals;
   - with that fixture, M's whole response (only the framework's per-request key masked) is identical across them too. Where B does credit one, the only differences are artist links, and they follow the public artist set in force (A5's, or ADR 0009 § 8's extended set once ADR 0009 § 8 merges) exactly.

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

### 5. Required tests

On real PostgreSQL unless stated. Each one is a merge condition of the change that builds the rule, and each guard has a mutation that is seen to fail.

**Delivery order.** Nothing merged may widen G8, even locally.

- §§ 2, 3, and 4 merge as one change, and deploy together, so each served entry is unpublished and republished once (the transition of § 2). Under option A, several of § 3's lock sets are justified only by § 4's rule; under option B, the migration is part of that change once authorized.
- Rows that concern listed albums are merge conditions of the change that adds ADR 0009's listing command (ADR 0009 § 15's delivery order). No listing command and no collection surface merges before this ADR's change and its tests.
- If the owner refuses § 4's acknowledgements, §§ 2 to 4 and the collection are re-planned in a revision, and nothing from them merges meanwhile.

- **G8 (§ 2):**
  - each row refused while shown, with no row changed, and allowed while not shown;
  - the static coverage test over every catalog writer;
  - a catalog edit between a publication's preview and its confirmation makes it `confirmation_stale`, for an album journal and for a memory;
  - an album journal's confirmed save goes stale when, between `previewPublicChange` and `saveAlbumJournal`, the album is listed or unlisted, or a credited artist's page opens or closes; with the matching real-connection test showing the save and the listing or publication serializing on the album and artist rows;
  - a rename of a track between a memory's `previewPublicChange` and its save, when the save adds or reorders that link, makes the save stale;
  - **containing albums:** while the memory is served, adding a memory-linked track to an album through the tracklist commands is refused; `importMusicRelease` is refused when the new album would precede the named one (including any tie on year and code-point title, refused before anything is inserted), and allowed otherwise, after which the new album is guarded as a containing album; renaming or re-dating a containing album, and deleting one, are refused;
  - the edition's date and country, `sort_name`, and `kind` are not selected by any Publication read, and edits to them are allowed;
  - renaming an artist credited only on a memory-linked track is refused;
  - the Publication reads select no `sort_name` or `kind`;
  - the take-down, edit, republish path restores the pages with their slugs and history;
  - **the transition procedure (§ 2):** a fixture with two journals of one album tied on `published_at`, one with a translation, and served memories; after recording, unpublishing, and republishing version by version, the presented journal and the order of every date-ordered list are the same as before, except exact ties in lists whose tie-break is not the entry id, which the record lists.
- **The album a memory names (§ 4):** every test listed in § 4 for the option chosen.
- **Concurrency (§ 3):**
  - over real connections, listing and publication each against a rename, a credit change, a tracklist change, an artwork change, and each other, seen waiting and then refusing or completing as described;
  - a memory's publication against an edit of a track it links;
  - a published memory's confirmed save that adds track T, against a concurrent `updateTrack(T)`: one waits, and the save is stale or the rename refused; a mutation that drops the lock on added links fails;
  - the three-transaction race: a save adding T waits on T while `addTrackToAlbum(B, T)` commits, then `updateAlbum(B)` runs; the save's re-read refuses it as stale; a mutation that drops the re-read fails;
  - a listing and a memory publication that render the same artist, run concurrently: seen to serialize on the artist row;
  - `deleteAlbumJournal` on a served journal of a listed album, against a concurrent publication of another journal of that album: they serialize on the album row;
  - two journals of one listed album published (or one published and one unpublished) concurrently: seen serializing on the album row: the collection page's links match the final served state, and a losing publication fails `confirmation_stale`;
  - unpublishing a journal's earliest visible version can reorder its link, and unpublishing the presented journal moves the single link to another served journal; the subset test, which compares atom sets, passes;
  - a memory's confirmed save adding track T, against two `updateTrack(T)` credit changes that restore the previewed credit (an ABA) while an album journal publication opens the restored artist's page: the save's `track_artists` re-read refuses it as stale; mutation: dropping that re-read fails;
  - `deleteAlbum(X)` while a published memory's confirmed save adds a track on X: the save waits on X and its containing-album re-read refuses it as stale, or the delete sees the memory served and refuses; mutation: moving the decision into the `DELETE`'s `WHERE` fails;
  - `deleteAlbum` against a concurrent first listing of the same album: the delete refuses `collection_address_reserved` or the listing fails `album_not_found`, never a deleted listed album; mutation: checking the slug before the album lock fails;
  - `setAlbumArtwork` against a concurrent `listAlbumInCollection` of the same album: seen waiting, then refusing `public_page`; mutation: deciding before the album lock fails;
  - a listing against `updateTrack` of a track added to the album (by `addTrackToAlbum`) after the rename read its album set: seen waiting, then `confirmation_stale`; mutation: removing the listing's track lock fails;
  - unlisting, and archiving, an album against a publication of that album's own journal (whose fingerprint binds "Back to the collection"): seen serializing on the album row, the publication failing stale when the link went after its preview;
  - an album journal unpublication, and an unlisting, each against a publication of another journal crediting the same artist: seen serializing on the artist row, the publication failing stale when the artist's page closed after its preview;
  - static checks of the lock order in every guarded command, memory entries included.

## Residual risks

Each risk stays open until its criterion is met. Documenting a risk does not resolve it.

| # | Cause | Consequence | Mitigation | Test evidence required | Criterion |
| --- | --- | --- | --- | --- | --- |
| **R1. A memory's named album changes through another album's journal** | [`memory-music.ts`](../../src/modules/publication/memory-music.ts) names, for a linked track, the album with a served journal first, otherwise the earliest by year, title, and id. Another album's served state is therefore an input to a memory page. | Publishing or unpublishing album B's journal changes the album title and link a served memory M shows. Neither M's review nor B's discloses it, and unpublishing B asks for no token. This is catalog wording changing on a public page without confirmation (G8). It reveals nothing private. | **Direction decided (decision 21); design open (§ 4):** option B (stored association, preferred, decision 22) or option A (dynamic selection). Neither is built, and option B's migration is not authorized. | § 4's tests for the option chosen, each with its mutation seen failing, and the transition record | **Blocks the first hosted public page** until § 4 is built under the chosen option, its tests pass, the transition record exists for the target database, the four acknowledgements in [Open decisions](#open-decisions) are recorded, and the owner reviews the evidence for G8. G8 cannot be waived. **It is not resolved by this document.** |
| **R4. Reductions and namesakes during a listing or a publication** | Under § 3 (not built), a listing, and an album journal's publication, unpublication, and deletion, and unlisting and archiving, lock the album's credited artists `FOR NO KEY UPDATE`. Any publication or confirmed save that renders one of those artists locks it too (`FOR SHARE`, or `FOR NO KEY UPDATE` for an album journal's publication), so it serializes, and so do journals of the same album (album row). What stays unserialized: a **memory's unpublication or deletion** (it locks no catalog row) during a listing or during an album journal publication whose review lists that memory (§ 4, C7), and **namesakes**, which are different artist rows. | A reduction during a listing can remove a page or a link that the listing's review showed as existing. The end state is a subset of what the review showed, plus the listing's own disclosed additions. Namesakes can end with addresses neither review disclosed: two namesakes, each disclosed with the bare address, can both end suffixed (A5 records the same). No undisclosed photograph and nothing private can appear. | The artist lock and the album-row lock (§ 3). The address effect is R2's, and so is its definitive fix. | Real-connection tests: a memory publication crediting a listed album's artist, concurrent with the listing, is seen to serialize; § 4's C7; with a concurrent memory unpublication, the end state is a subset of the listing's review plus its additions; addresses are equal across surfaces; a replaced address answers the identical `404` | The reduction part may be accepted in writing at G7, as a verified, bounded residual. The address part follows R2's criterion. |
| **R5. A catalog edit and a new entry's publication** | An entry created after a catalog command's locking statement is not locked by it (A3's class). Without § 3's publication share locks, its publication could commit between the command's decision and its commit. | A catalog edit would reach a just-published page that no review showed: a **G8** event, not a likelihood question | **Addressed by design (§ 3), not built; open until its tests pass:** publications and confirmed saves take `FOR SHARE` on the catalog rows their fingerprint binds, so they wait for the edit and then fail as stale. Catalog commands keep their write modes. | Real-connection tests: (1) a catalog command holds its rows (`setAlbumArtwork`, `updateTrack`, or `updateArtist`, or memory entries; a command holding the album `FOR UPDATE` already blocks a new journal of that album at its foreign-key check); an entry is created, previewed, and published; the publication is seen waiting, then refused as `confirmation_stale`; (2) the same while `addTrackToAlbum`, `setAlbumTracklist`, and `importMusicRelease` add a memory-linked track to another album; (3) mutations that remove the publication's share lock, or the write-mode lock on added tracks, each fail | **Blocks the first hosted public page** until the test passes and the owner reviews it as G8 evidence. G8 cannot be waived, so this is never accepted under G7. |
| **R6. Deadlocks** | Any catalog command that takes a row outside § 3's order. A5's recorded three-way cycle comes from `createTrack` inserting before locking, which § 3 would forbid, so R6 would narrow to commands the static lock-order test has not caught. | One request aborts with `40P01` and writes nothing. Availability only, but **takedowns** (album journal unpublication and deletion, unlisting, archiving) now take album and artist write locks, so a takedown can wait on a catalog transaction or be the request aborted; the author retries it (ADR 0006 § 12: nothing is retried automatically). | § 3's single order, `createTrack` reordered, and the static lock-order test over every guarded command | A5's deadlock scenario re-run with `createTrack` reordered, now completing without `40P01`; an album journal publication against `updateTrack` on one of its edition's tracks, with `updateTrack` reordered, completing without `40P01`; the static lock-order test, which covers `createTrack`, `importMusicRelease`, and `updateTrack` | Accepted only in writing at G7, after the re-run shows A5's cycle closed |

## Effect on existing decisions

None of these texts changes before acceptance. **At acceptance,** each gains a pointer marking the change as decided, not built; text that records implemented behaviour or verified evidence keeps its wording, with a note "superseded by ADR 0010 once built and tested". **In the pull request that builds and tests each part,** the text is rewritten; for ADRs, the build step adds amendment text under their *Amendments* and never rewrites their decisions.

- **ADR 0006** (by a pointer under *Amendments*):
  - §§ 1, 2, and 5: catalog atoms join the publication disclosure and fingerprint ("Informational lines are not part of the set" ends for catalog wording); a memory link's atom gains its rendered wording and named album; an album journal's disclosure gains the served memories that name its album, and the pages on which a credit becomes a link (§ 2);
  - § 4 step 3 ("the engine takes no kind"): the engine looks up `album_journals` and `memory_music` for its entry to take catalog locks (§ 3);
  - § 6 (the version rule): atoms another entry's transition, a listing, or a catalog command can change are bound by the fingerprint instead of `entries.version`, as the address already is (§§ 2, 4);
  - § 14, G8: resolved by §§ 2, 3, and 4 once their tests pass and the owner reviews the evidence (R1 and R5 are G8 items). **G8 is not narrowed:** derived artist addresses that change on a reduction stay where [Security](../security.md#public-page-release-gates) files them today (M3.8a's and M3.8b's G8 bullets, A5's G1 bullet). Closing that part of G8 needs ADR 0009's R2 resolved (a stored artist slug) or a separate owner decision; this ADR proposes no reclassification;
  - L1: a narrow exception, the closed list of readers in § 3; read with A3, catalog commands may read `memory_music` under memory entries' `FOR SHARE`;
  - L2: several entries, album journals and memories, held `FOR SHARE` by the commands of § 3's table;
  - L3: entry commands take explicit catalog locks (share locks on fingerprinted rows; an album journal's album and credited artists `FOR NO KEY UPDATE`); A3's and A5's notes gain a pointer;
  - L6: narrowed for the listed readers' atoms;
  - A3's lock procedure: the decision after the album row lock;
  - A5: the lock order of its operation table superseded by § 3, and its operation rules narrowed (§ 2: renames of shown artists, credit edits on shown albums, and, under option A, imports that would change a served memory's named album).
- **[ADR 0005 § 5](0005-restoring-deleted-journals.md):** unaffected. L6's narrowing covers only atoms read from other entries and the catalog; the reflection set is entry-owned and still compared under the entry lock.
- **[Security](../security.md):** the M3.7 memory-music row (the named album's rule and its mutation), and the G8 bullets of the M3.5, M3.7, M3.8a, and M3.8b residuals, point to §§ 2 to 4.
- **[Hosted Launch](../hosted-launch.md) § 6:** R1 and R5 recorded as launch blockers under G8.
- **Under option B only:** [Data Model](../data-model.md) gains `memory_music.named_album_id` and its foreign key, through `/refrain-db-change`, once authorized.

## Consequences

- **Positive:** G8 gets one testable resolution for every public surface, including the gap between a publication's preview and its confirmation; a memory's named album stops depending on other journals; late entries are serialized.
- **Negative:**
  - Correcting a typo in a shown record means taking down every surface that shows it, editing, and confirming each again, which also moves `published_at` (§ 2).
  - The guard touches every catalog writer, and each needs tests.
  - A5's freedom to rename public artists and reorder credits is withdrawn.
  - Publication fingerprints become sensitive to catalog edits, so a catalog change during an open publication dialog makes it ask again.
  - Takedowns now take album and artist write locks, so they can wait on catalog transactions (R6).
  - Under option A: every album containing a memory-linked recording is guarded while the memory is served, and imports can be refused. Under option B: removing a recording from, or deleting, an album that any memory names is refused.
  - At the transition, every served entry is republished and gets a new `published_at` (§ 2).
- **Unchanged:** the publication predicate; every route, slug, and `308`; INV-1 to INV-5; the `ct1` token's form, claims, key, and expiry; L4 and L5. Accepting this ADR closes no gate and authorizes no deployment, migration, or switch change.

## Open decisions

**Choice for § 4:** option B (preferred direction, decision 22) or option A, and, for option B:

- **B1 or B2:** filled automatically, or chosen by the author with a new Studio control (design review);
- **the catalog effect:** removing a recording from, or deleting, an album any memory names (any state) is refused `in_use`, as for reflections today;
- **a recording on no album** names none until the memory is saved again;
- **the migration's authorization** (none is written now).

**Acknowledgements still to be given** (none is presumed), each gating § 4:

- **condition 7:** whether the change of which album fills the slot (including a private-catalog title marked "not otherwise public", and Product rule 6 read for an archived named album as option A reads it) is a new product decision;
- **§ 4's visible consequence:** under B1 or option A, a recording also on a later journaled album names the earlier album, as plain text if that has no served journal; this also records **condition 2**;
- **condition 5 with R2:** artist-page takedowns can still move a namesake's address (ADR 0009's R2);
- **condition 6:** whether ADR 0006's guarantees and concurrency protections are preserved with the changes listed under Effect (L1, L2, L3, L6, § 4 step 3, § 6, A3's and A5's lock procedures, and ADR 0006 § 5's subset rule as ADR 0009 § 7 evaluates it).

**Explicit approvals at acceptance:** one for each ADR 0006 item under [Effect on existing decisions](#effect-on-existing-decisions).

**Pending Studio design review:** the album journal publication dialog's new content (catalog atoms, "Artist pages gaining a journal", memories and pages gaining links); the memory publication and confirmed-save dialogs' album line (year, credits, archived and "not otherwise public" marks, link target); the Studio's § 2 refusal naming every surface; and B2's control, if chosen.

**Pending, not needed by § 4:** whether a memory links a listed named album's collection page (ADR 0009).

## Revisit when

- Taking pages down to fix a shown record proves too costly: the confirmed catalog change, or the published snapshot ([Alternatives](#alternatives-considered)), in a new ADR.
- Option B's refusals on catalog edits prove too costly, or option A's do.
- Addresses of artists need to stop changing on reductions: ADR 0009's R2 (a stored artist slug).
