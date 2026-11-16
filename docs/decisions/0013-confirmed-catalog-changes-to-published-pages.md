# ADR 0013: Confirmed Catalog Changes to Published Pages (G8)

- **Status:** **Accepted** by the owner on 2026-11-16 (PR #115), with the decisions recorded in [Owner decisions](#owner-decisions-2026-11-16). **Acceptance does not mean it is built:** steps 1 and 2 of § 7 are in draft pull requests ([step 1](../evidence/g8-step-1-catalog-impact.md), [step 2](../evidence/g8-step-2-locks-fingerprints.md)), and until steps 3 and 4 merge, catalog edits still change served wording as described in [Context](#context). **G8 stays open** until those steps and R1 are done (§ 7). It adds no migration. The proposed ADR 0010 (#99) **stays Proposed as a whole**: the G8 rules this ADR takes from it are restated here, so they bind through this ADR alone.
- **Date:** 2026-11-16
- **Scope:** Gate G8 only: how a catalog edit (an artist's name, an album's title or credits, a track's title, a tracklist) may change the wording of a page the public can read. It replaces one choice of the proposed [ADR 0010](https://github.com/RaioViajante/refrain/pull/99) (PR #99), and restates the parts of that ADR's analysis that G8 needs ([Relationship to ADR 0010](#relationship-to-adr-0010-pr-99)).

## Context

[ADR 0006](0006-publication-decision-and-acknowledgement.md) makes publication a confirmed act. Its fingerprint deliberately leaves catalog wording out (§ 2, "documented gap C11: closed by gate G8, not accepted as harmless"). Gate G8 requires either that "a public page cannot change its wording without the author's explicit confirmation", or an independently verified safe alternative, with no waiver (ADR 0006, the public page release gates).

**Today, on `main`:**
- these change a served page's wording with no confirmation:
  - `updateArtist` (name);
  - `updateAlbum` (title, year, the reference edition's label, a credit's order, `credited_as`, or its removal);
  - `updateTrack` (title, credit, track artists);
  - the tracklist commands (`addTrackToAlbum`, `removeTrackFromAlbum`, `moveTrackInAlbum`, `setAlbumTracklist`);
  - `createTrack` with an album;
  - `deleteAlbum` (no lock) and `importMusicRelease` when a reused recording changes the album a served memory names.
- Only these are refused while public (`public_page`): `restoreArtist`, a credit that would open an artist page (A5), `setAlbumArtwork` and `removeAlbumArtwork` (A3), and `setArtistPhoto` (A5).
- "Shown" today counts album journals only (`src/modules/publication/catalog-exposure.ts`), never memories.

**Proposed ADR 0010 (#99)** chose to **refuse** such edits while a page shows the record. The author takes the pages down, edits, and publishes again (its § 2). It considered the confirmed catalog change and set it aside **"for now"**, because it "needs a delta over every surface kind, its own token purpose, and its own tests", and named it "the next step if § 2's cost is too high … through its own decision". The cost it records: a typo fix takes pages down, needs every page confirmed again, and moves each `published_at`.

**The owner's direction (2026-11-16):** explicit author confirmation, not mandatory unpublishing before every edit, and edits to unpublished content keep working as they do now. This ADR is that "own decision".

## Decision

### 1. Which catalog changes affect served pages

1. **"Shown"** (the set ADR 0010 § 1 defines, restated) is computed from the Publication module's fragments only, and covers:
   - every album with a **served** album journal: its title, year, reference-edition label, credits, and rendered tracks;
   - every album and track that a **served** memory links, with their credited artists, and **every album that contains a linked track** (ADR 0010 § 1's option A set). The album a memory names is derived from those albums (`memory-music.ts`), so an edit to any of them can change which album it names;
   - every artist with a **public page**.

   It counts memories, which `catalog-exposure.ts` does not do today. A record is shown whatever the value of `REFRAIN_PUBLIC_READS_ENABLED` or the cover switch. Turning reads on must never reveal wording no one confirmed.
2. **The affected pages** of a change are found by **rendering before and after**. For every served page, the catalog atoms it renders are computed with and without the change, and the page is affected when any of them differ. This includes the **link targets** it renders, not only its words. The pages are those the reads already serve:
   - the album journal and its metadata title;
   - the memory and its song record;
   - the artist page and its metadata;
   - the album, artist, and memory archives;
   - the Home's lists;
   - the sitemap;
   - **every public artist's address.** Addresses are derived from names across all visible artists (`artist-address.ts`): a namesake gains or loses its suffix when another artist with the same name appears, disappears, or is renamed. So the impact compares **every** public artist address before and after, not only the edited artist's. Every page that links a moved address is affected, as is the sitemap.

   Pages are **served entries × interface languages** (each served entry's address under EN and under `/pt`), because a served entry is readable in both interfaces. The catalog wording is language-neutral, so one change lists both forms of each page.
3. **Classification.** These catalog changes are **confirmed while shown** (each needs the confirmation of § 3 when its impact is not empty):
   - `updateArtist`: the name (sort name and kind are never rendered and stay free);
   - `updateAlbum`: the title, the year, the reference edition's label, the credits' artists, order, and `credited_as`, and the removal of a credit;
   - `updateAlbum` or `linkAlbumToMusic` when it would create the album's reference edition;
   - `updateTrack`: the title, the length, the credit, and the track's artists;
   - the tracklist commands (`addTrackToAlbum`, `removeTrackFromAlbum`, `moveTrackInAlbum`, `setAlbumTracklist`) and `createTrack` with an album;
   - `restoreArtist`, when it changes a served page without opening an artist page (for example, a namesake's address).

   The impact is computed from what pages render (§ 1.2), so an album shown only as a containing album of a memory needs a confirmation only for what changes that memory's page: its title, its year, the linked track's membership (which decide the album the memory names), and its deletion.

   These stay **refused** while shown (the owner's decision 3), whatever is confirmed:
   - **any change that would open an artist page.** Under A5, a page opens only through a confirmed publication, never through a catalog confirmation. This covers `restoreArtist` when it would open a page, and a credit that would expose an artist;
   - **the existing artwork and photo refusals:** `setAlbumArtwork` and `removeAlbumArtwork` (A3; A8 is separate, #102) and `setArtistPhoto` (A5);
   - `deleteAlbum` while it contains a track a served memory links;
   - `importMusicRelease` when a reused recording would change the album a served memory names.

   These stay **allowed** with no confirmation, as ADR 0010 § 2 and A5 have them:
   - an existing reference edition's date and country, MusicBrainz identifiers, and an artist's sort name and kind, which no public read selects;
   - `archiveTrack` and `restoreTrack`, and `archiveAlbum` and `restoreAlbum`: no built public read depends on their archived state;
   - `archiveArtist`: a reduction under A5 (the credit renders as plain text and the artist's page closes). The impact still reports it to the Studio, for information;
   - `removeArtistPhoto`;
   - new records (`createAlbum`, `createArtist`, `importMusicArtist`, `createTrack` without an album, and `importMusicRelease` outside its refusal);
   - `deleteArtist` and `deleteTrack`, which the `RESTRICT` foreign keys already refuse while anything uses the record. A static coverage test fails on any catalog writer not classified ([§ 7](#7-implementation-in-small-reviewable-pull-requests)).
4. **Not shown means unchanged behaviour.** An edit that affects no served page needs no confirmation and shows no dialog, exactly as today.

### 2. What the Studio shows

1. A catalog edit form (album, artist, track, tracklist) saves as now. Before it writes, the server computes the change's **public impact** (§ 1.2).
2. **No affected page:** the edit is applied, as today.
3. **Affected pages:** nothing is written. The form opens **"Update the published pages?"**, which lists:
   - **each affected page, by kind and address** (EN and `/pt` separately), linking to the page;
   - **for each page, the exact before and after wording** of every changed atom, rendered as the page renders it. For example, a credit line "A, B" → "A & B", a track's title, a track's position in the list, the metadata title. It reuses the confirmed-save dialog's before-and-after presentation (`ReviewedValueView`);
   - **every artist address that moves,** the edited artist's and any namesake's (§ 1.2), with the pages that link it. The old address answers the unknown address's `404` afterwards, because artist addresses are not stored (G1's open artist-slug question; stored slugs are R7). The dialog says so in plain words;
   - what does **not** change: the publication dates, "Recently written", and every entry's writing and status.
4. Focus starts on the title, so no key press confirms before reading. **Confirm** applies the change, and **Cancel** keeps the form as typed. The dialog is in English and Portuguese from the Studio dictionaries (ADR 0008), with 44 px targets.
5. The impact shows only **served** pages and catalog wording, which the author already sees in the Studio. No private writing, rating, or hidden entry is listed.

### 3. The confirmation token

1. **Same engine.** ADR 0006 § 3's signed token (`ct1`, HKDF key, 15-minute validity, no stored state, minted only by a preview) gains a third purpose, **`catalog_change`**. The purpose is a signed claim and is checked on verify, so a `catalog_change` token is never accepted for `publish` or `change_public`, nor the reverse. `publish` and `change_public` already share the `ct1` key, separated by this claim (ADR 0006 § 3: "a publish token is not a change_public token"). That is the precedent for a third purpose, and the owner chose it over a new HKDF `info` string ([decision 1](#owner-decisions-2026-11-16)). Every existing property of the token is kept.
2. **What it binds:**
   - the author's user and session, as today;
   - the **catalog subject**, `album:<id>`, `artist:<id>`, or `track:<id>`, in `e`;
   - the **fingerprint `f`** of:
     - the operation and its exact requested values;
     - the current rendered catalog atoms of every bound row;
     - the set of affected pages, with each page's entry id, `entries.version`, and publication stamp;
     - the before and after wording shown, and the before and after map of **every** public artist address;
     - the subject row's `updated_at` (artists, albums, and tracks have one).
3. **No version column.** Catalog tables have none, and this ADR adds no migration. Every guarded writer sets the subject row's `updated_at` explicitly in its transaction, including writes that touch only credit or tracklist rows, whose album's `updated_at` they set, and raw-SQL writes. `n` carries a fixed constant, `1`, for this purpose: the claims schema requires a positive integer (`src/modules/identity/confirmation.ts`), and `n` has no catalog meaning. **Freshness comes from recomputing `f`** inside the confirming transaction, under its locks, from the current rows (§ 4). Any difference in a bound row, a served page, an entry version, or the requested values makes it stale.
4. **Minted only by the preview,** `previewCatalogChange`, in the Publication module (ADR 0006 § 9 lets only that module call the signing function), which authorizes first, computes the impact, and signs with the database clock, as `previewPublication` does. ADR 0006 § 9's static scan gains it in the closed list of previews that may mint.
5. **Single use without storage.** Once the change is applied, the subject's `updated_at` has moved, so a replay recomputes a different `f` and is refused as stale. That holds even if a later edit restores the earlier wording (A → B → A), because the timestamp is part of `f`. An expired token answers `confirmation_expired`. Two rules make the timestamp a reliable counter (the owner's decision 1):
   - **It strictly increases.** A guarded writer sets it to `greatest(clock_timestamp(), updated_at + interval '1 microsecond')` in SQL, never from the application's clock, so two edits in the same microsecond, or under a clock that steps back, still differ.
   - **It is read at full precision.** The fingerprint reads it as PostgreSQL text (microseconds), never through a JavaScript `Date`, whose milliseconds would hide two edits made within one millisecond.

   Tests: A → B → A replayed within one millisecond, a replay after the change, and the same token on another subject and purpose.
6. **Never leaves the dialog.** The token lives in the dialog's state, is sent only with the confirm action, and is never written to the page, a log, or a URL (as ADR 0006 requires today).

### 4. Concurrency and stale confirmations

1. **Lock order** (restated from ADR 0010 § 3; its listing rows, which belong to ADR 0009, are left out). Every command of § 1.3, confirmed or refused, takes these locks **before it decides**, in this order:
   1. **entries `FOR SHARE`, in ascending id:** every album journal of the albums involved, and every memory that links any album involved, any track involved, or any track on an album involved, whatever its state, except where the table lists fewer;
   2. **then albums, in ascending id:** a write mode for the album the command writes (`FOR UPDATE` in `updateAlbum`, the tracklist commands, and `deleteAlbum`; A3's `FOR NO KEY UPDATE` for artwork), `FOR SHARE` otherwise;
   3. **then artists, in ascending id;**
   4. **then tracks, in ascending id:** a write mode (`FOR NO KEY UPDATE`, or `FOR UPDATE` where the command already uses it) for every track the command changes, adds to an album, or reuses; `FOR SHARE` otherwise.

   | Command | Entries `FOR SHARE` | Albums | Artists | Tracks |
   | --- | --- | --- | --- | --- |
   | `updateAlbum`, the tracklist commands, `createTrack` with an album, `setAlbumArtwork`, `deleteAlbum` | the album's journals; memories linking the album, any of its tracks, or an added track; for a credit change, also the journals of every album crediting the named artists (A5's set) | that album (write) | the artists it names (share) | its tracks (share); added tracks (write) |
   | `updateTrack` | the journals of every album containing the track; memories linking the track or those albums | those albums (share) | the track's stored and new artists (share) | that track (write) |
   | `updateArtist`, `restoreArtist`, `setArtistPhoto`, `archiveArtist` | the journals of albums crediting the artist, or containing a track crediting it; memories linking those albums or tracks | those albums (share) | that artist (write) | tracks crediting it (share) |
   | `linkAlbumToMusic` | the album's journals only (it changes identifiers, or creates the reference edition, which no memory renders) | that album (write) | none | none |
   | `importMusicRelease` | memories linking the reused recordings | albums already containing each reused recording (share) | reused artists (share) | reused recordings (write) |

   The allowed commands of § 1.3 decide nothing and keep their own locks: `archiveAlbum`, `restoreAlbum`, `archiveTrack`, and `restoreTrack` lock only their row, and `removeArtistPhoto` only its artist.

   Rules that go with the order:
   - **Decide only from statements run after the last lock,** never from a read taken before it (for example, the album set `updateTrack` reads to know what to lock). `deleteAlbum` decides in a new statement after its album lock, never inside the `DELETE`'s own `WHERE`.
   - **Reorders:** `createTrack` with an album and `importMusicRelease` lock before inserting anything; `updateTrack` takes entries, albums, and artists before its track; `setAlbumArtwork`, and every caller of `lockAlbumPublicExposure` or `lockArtistPublicExposure`, decides only after its album or artist row lock.
   - **Several entry locks** in one ascending list are allowed for the commands in the table (ADR 0006 L2, as amended in [Effect on existing decisions](#effect-on-existing-decisions)). No entry command waits on a second entry, so no cycle is designed to form; the static lock-order test and the deadlock re-run show it.
   - `READ COMMITTED` is enough, because every decision is made by a statement after the locks.
2. **The confirm path,** one transaction:
   - verify the token's signature, purpose, subject, and author (before the transaction);
   - take the locks in that order;
   - **then** check expiry against the database clock, as publication does today (ADR 0006 L6), and recompute the impact and `f`;
   - **if it differs: `confirmation_stale`**, nothing written, and the dialog reopens with the current impact;
   - otherwise apply the change and return.
3. **No token, but the record is now shown.** The command recomputes the impact after its locks, even when the preview found none. If any page is now affected, it answers **`confirmation_required`** and writes nothing (fail closed). A publication racing an unconfirmed edit therefore never leaves an unconfirmed wording served.
4. **Against publication** (restated from ADR 0010 § 3; amends L3). Under its entry lock, a publication or a confirmed save takes, in the order of item 1, the catalog rows its catalog atoms (§ 5) are read from, then computes its fingerprint:
   - **an album journal's publication, unpublication, and deletion:** its album, then its credited artists, `FOR NO KEY UPDATE` (so two journal transitions crediting one artist serialize, and a credit cannot become a link that neither review showed), and the tracks its page renders `FOR SHARE`;
   - **an album journal's confirmed save:** its album, its credited artists, and the tracks its page renders, `FOR SHARE`;
   - **a memory's publication or confirmed save:** each linked album and track, every album containing a linked track, the artists credited on the links, and the named albums' credited artists, `FOR SHARE`. A confirmed save locks the links of its current and resulting states. **After its track locks it re-reads** each linked track's `track_artists` and its containing albums, and answers `confirmation_stale` if either set differs from what it locked (an edit made and undone between its reads cannot leave a rendered row unlocked).

   A publication and a catalog change on the same rows therefore serialize: whichever commits second sees a different fingerprint and is stale, or sees the record shown and needs a confirmation. An entry created during a catalog command is serialized too: its publication waits on the catalog rows.
5. **Deadlocks** (`40P01`) roll the transaction back and write nothing. Today they surface as an unmapped database error; step 3 maps them to a fixed retry code with the gate's other codes. The takedown paths take album and artist write locks (item 4), and a deadlock re-run is part of step 2's tests.
6. **Residual windows**, recorded for the owner's review under G7, not accepted by this ADR:
   - **reductions:** an unpublication, deletion, or archive that commits between a reader's comparison and its write leaves an end state that is what was confirmed minus that reduction;
   - **namesakes:** another artist's transition on a namesake row can change a derived artist address (§ 1.2) after the comparison. The address map shown is then out of date by that one change.
   
   Late entries (an entry created during a catalog command) are closed by item 4, not accepted.

### 5. Publication fingerprints include catalog wording

Restated from ADR 0010 § 2 (amends ADR 0006 §§ 1, 2, and 5). **The catalog atoms each page renders join the publication disclosure and fingerprint:**
- **for an album journal:**
  - the title, year, and edition label;
  - the credits as rendered, each with its link presence and address;
  - each rendered track's title, credit, and order: the edition's tracks, and any track a served reflection (or one this publication makes public) names;
  - the stored cover or none;
  - the served memories on which the album becomes a link, or whose link will lead to this journal, bound by entry id;
  - the served pages on which an artist credit becomes a link, because the publication opens that artist's page (A5);
- **for a memory:**
  - each link's rendered title;
  - its credited artists, each with its link presence and address;
  - for each linked track, the album it names: its id, title, and whether and where it links. The Studio review also shows and binds that album's year and credited artists, so two albums with the same title can be told apart; neither reaches the public page;
- **the confirmed save (ADR 0006 §§ 1 and 5):**
  - a memory link's atom gains its rendered wording (title, credits, named album), so a track renamed between the preview and the save makes the save stale;
  - an album journal's confirmed save binds the catalog atoms its own page renders (not the publication's transition lists, since a save changes no served state). Its locks are taken in `saveAlbumJournal`, after `lockAlbumJournal` and before the delta is computed.

**A catalog edit between a preview and its confirmation answers `confirmation_stale`** with the fresh disclosure. ADR 0006 § 2's "informational lines are not part of the set" ends for catalog wording. **This closes C11.** Tokens issued before deployment fail as stale, which costs at most one re-review within 15 minutes.

**Pages served before step 2 ships** (restated from ADR 0010 § 2; the owner's decision 6). Today's fingerprints bind no catalog wording, so a page served when step 2 is deployed may show wording no review bound. **No database is assumed to hold no real writing.** Before step 2 is deployed on a database, an **inventory** records every served language version and its `published_at`. It is G8 evidence, and it is mandatory:
- if nothing is served, the inventory says so, and nothing else is needed;
- otherwise each served version is unpublished before the deploy and, after it, published again by the author through the new review, one by one, in ascending former `published_at` (ties by descending entry id, then locale), before public reads are turned on. Republishing sets a new `published_at`.

Taking that inventory on a hosted database needs the owner's separate authorization: this ADR authorizes no hosted access, write, migration, or settings change.

### 6. Contracts that stay as they are

- **The publication predicate** is unchanged and still the only visibility rule. The impact is computed from the same Publication fragments the public reads use, so it can name only pages that are served.
- **ADR 0006:**
  - every confirmed act stays confirmed: publish, `change_public`, and unpublish;
  - removals keep § 5's ask-first rule;
  - A3's artwork refusals and A5's rule that an artist page opens only through a confirmed publication are unchanged. Their **lock procedures** and A5's operation table change, as listed in [Effect on existing decisions](#effect-on-existing-decisions);
  - A13 is unrelated.
- **Languages** (ADR 0008, A7): no token input differs by interface language. A catalog change binds every served language version at once, and the `/pt` and EN pages are listed separately.
- **Privacy:** the dialog and the token carry no private writing or hidden entry. Catalog edits to records that nothing served shows stay free.
- **Publication history:** a confirmed catalog change is not a publication. It sets no `published_at`, and it moves nothing in "Recently written" or the archives' order.
- **Deletion and slugs:** recoverable deletion, slug retention, and redirects are unchanged. An artist rename's address change is disclosed and confirmed, not hidden (§ 2.3).
- **ADR 0006 A13** and every publication, privacy, and caching guarantee stay binding, unchanged.
- **No migration,** and no change to ADR 0002's invariants.

### 7. Implementation in small, reviewable pull requests

Each step is one pull request with its own tests and an independent security review. ADR 0010 asks for its §§ 2 to 4 to merge as one change, because its refusals, its locks, and R1 depend on each other. Here the split is safe for two reasons:
- **Each step only narrows.** Step 1 is read-only. Step 2 adds locks and fingerprint atoms, so more confirmations become stale, never fewer. Steps 3 and 4 move unguarded writes to confirmed ones. No step lets a page change silently in a way it could not before.
- **The locks come first.** The lock reorders that later steps depend on land in step 2, before any gate.

1. **Impact computation (read-only).** `catalogPublicImpact(change)` in the Publication module, built on its fragments, with the "shown" set including memories. It has unit and integration tests over every state (served, hidden, deleted, unpublished, each language, the switch off), with no command wired. It renders every served page with the public reads, then again over transaction-scoped temporary copies of the catalog tables with the change applied, and compares their catalog atoms; it writes no permanent table ([evidence](../evidence/g8-step-1-catalog-impact.md)).
2. **Locks and fingerprints.**
   - § 4.1's lock reorders (`createTrack`, `importMusicRelease`, `updateTrack`, `setAlbumArtwork`), with the **static lock-order test**.
   - Then fingerprints bind catalog wording (§ 5) for publications and confirmed saves, with the share locks of § 4.4. Catalog edits between a preview and its confirmation become stale, which closes C11.
   - race tests: a catalog edit between a publication's preview and its confirmation, a publication racing an unconfirmed edit, a late entry, the re-reads of § 4.4, and a deadlock re-run.
   - the pre-deployment inventory of § 5 is a precondition of deploying this step anywhere.
3. **Token purpose, preview, and gate for the renames:** `catalog_change`, `previewCatalogChange`, and `confirmation_required`, `stale`, and `expired` for `updateArtist`, `updateAlbum`, and `updateTrack`. It adds the Studio dialog for those three forms, in EN and PT. Tests:
   - HTTP: refused without a token, stale after a change, and not replayable;
   - browser: the dialog at 1440 and 390 px;
   - concurrency: a rename against a publication.
4. **Tracklists and creation:** the tracklist commands and `createTrack` with an album, plus the refusals that stay (§ 1.3), with the dialog for the tracklist editor. Adds the **static coverage test** over every catalog writer.
5. **Evidence.** `docs/evidence/` records each step's checks.

**Step 4's named-album refusals are best-effort until R1.** The `deleteAlbum` and `importMusicRelease` refusals decide on the journal state of containing albums. § 4.1's table does not lock those journals under today's rule (M3.7), so a concurrent publication can race that decision. That is no wider than today, where nothing is refused, and it stays inside R1.

**ADR 0010's refusal-first alternative is not built** (the owner's decision 4): no step ships "refused while shown" for the confirmable rows of § 1.3.

**G8 does not close with these steps alone.** **R1** (the album a memory names can change, with no token, when another album's journal is published or unpublished) is a G8 item, and this ADR does not decide it. G8 closes only when R1 is resolved by its own decision (ADR 0010 § 4 or a successor, prepared separately for the owner; no migration without the owner's explicit authorization), and the owner reviews the evidence of both.

## Effect on existing decisions

**Accepted by the owner on 2026-11-16, item by item** (the owner's decision 5: "only the specific amendments to ADR 0006 explicitly enumerated in ADR 0013"). Each takes effect when the step that builds it merges; until then ADR 0006's text applies. ADR 0006 records them as [A14](0006-publication-decision-and-acknowledgement.md#a14-confirmed-catalog-changes-adr-0013).

| Decision | Change |
| --- | --- |
| ADR 0006 §§ 1 and 5 | The memory link atom gains its rendered wording, and the album journal's confirmed save binds its page's catalog atoms (§ 5) |
| ADR 0006 § 2 | Catalog wording joins the disclosure and fingerprint (§ 5). "Informational lines are not part of the set" ends for catalog wording. **C11 closes** |
| ADR 0006 § 3 | A third purpose, `catalog_change`. For it, `e` is a catalog subject and `n` is the constant `1`; freshness comes from `f` |
| ADR 0006 § 6 | The version rule is unchanged for entries. A catalog change is not an entry version and moves no `published_at` |
| ADR 0006 § 9 | `previewCatalogChange`, in the Publication module, joins the closed list of previews that may mint. The Studio reaches it only through its own Server Action file, which imports it through the Publication module's entry point, as the existing preview actions do. Presentation code never imports the database or signing code |
| ADR 0006 L1 | A closed list of readers may decide from other entries' rows without those entries' locks, each serialized through catalog rows instead (§ 4.4): an album journal's publication (served memories naming its album, other journals crediting its artists), its confirmed save (the journals deciding its credits' links), a memory's publication or confirmed save (the named album's journals, the journals deciding each credit's link), and every command of § 1.3 (entries created after its entry locks). No other reader is added |
| ADR 0006 L2 | The commands of § 4.1's table may hold several entries `FOR SHARE`, album journals and memories, in one ascending list |
| ADR 0006 L3 | Publications and confirmed saves share-lock the catalog rows they bind, after the entry lock (§ 4.4); an album journal's transitions take its album and credited artists `FOR NO KEY UPDATE` |
| ADR 0006 L6 | Every decision, and the token's expiry, is read after the last lock (§ 4.1, § 4.2) |
| ADR 0006 A3 | Its refusals are unchanged. `setAlbumArtwork` decides after the album lock (§ 4.1) |
| ADR 0006 A5 | Its rule that a page opens only through a confirmed publication is unchanged. Its operation table changes: "Rename an artist: allowed without a confirmation (C11 and G8)" becomes **confirmed while shown**, and so does credit wording. Its lock order is replaced by § 4.1's |
| ADR 0006 G8, C11 | C11 closes with step 2. G8 also needs R1 (§ 7) |

## Relationship to ADR 0010 (PR #99)

- **ADR 0010 stays Proposed as a whole** (the owner's decision 5). Nothing in it binds through its own text.
- **Restated here, and binding through this ADR only:** its terms for "shown" (§ 1.1), its writer inventory (§ 1.3), its lock order, lock table, and publication share locks (§ 4.1, § 4.4), its binding of catalog atoms into fingerprints (§ 5), and its pre-deployment record, strengthened by an inventory that never assumes an empty database (§ 5).
- **Replaced, for G8:** ADR 0010 § 2's rule "refused while shown" becomes "confirmed while shown" for the rows in § 1.3. Its refusal-first delivery is not built.
- **Not decided here, and not accepted:**
  - **R1**, the album a memory names (ADR 0010 § 4, with its option B migration, which is not authorized). It is prepared separately as an owner decision;
  - the listing rows of ADR 0009 (R2, R3, R7), and the collection page;
  - ADR 0010's residual-risk acceptances and its published-snapshot alternative;
  - `removeAlbumArtwork` always allowed (A8, PR #102).
- If ADR 0010 is later accepted in part, its § 2 is reworked to point here (as ADR 0011's D18 already asks for #99).

## Alternatives considered

- **Refuse while shown (ADR 0010 § 2).** It is smaller to build and fails closed. It makes every typo fix a takedown, edit, and republish, which moves `published_at` and empties pages meanwhile. Not chosen, and not to be built as an interim step (the owner's decision 4).
- **A published snapshot of catalog wording** (ADR 0010, Alternatives): a second copy of the catalog and a second rendering path. Not chosen.
- **Confirm with a new `ct2` key.** Not chosen (the owner's decision 1): the purpose claim already separates the uses of `ct1`.

## Consequences

**Positive:**
- Catalog wording on served pages changes only with the author's confirmation, typo fixes stay possible on published pages, and C11 closes. G8 itself still needs R1 (§ 7).
- Unpublished catalog work is unchanged.
- The dialog shows exactly what readers will see.

**Negative:**
- A third token purpose, an impact computation over every surface kind, and a new dialog, each needing tests.
- Catalog commands take entry share locks, with ADR 0010's deadlock residuals.
- An artist rename still breaks the old artist address until stored slugs (R7).

## Owner decisions (2026-11-16)

The owner approved this ADR on 2026-11-16 with these decisions (summarized; the full text is in PR #115):

1. **Token:** the existing `ct1` signing with a third, strictly separated purpose, `catalog_change`. Every existing token property is kept. Replay resistance is verified, including timestamp precision and A → B → A (§ 3.5).
2. **Public artist renames:** allowed only after an explicit confirmation of the affected pages and every address change, namesakes included. Until stored artist slugs exist, the old address may answer `404`, and the Studio discloses it (§ 2.3).
3. **Permanent refusals:** deleting an album containing a track a served memory uses; a reimport that could change the album a served memory names; and every operation ADR 0006 A3 and A5 forbid, including an artist page opening outside a confirmed publication (§ 1.3).
4. **Delivery:** the four steps of § 7, as separate pull requests, each with an independent security review. ADR 0010's refusal-first alternative is not built.
5. **Existing contracts:** only the ADR 0006 amendments enumerated in [Effect on existing decisions](#effect-on-existing-decisions), and the G8 lock and fingerprint rules restated here, are accepted. ADR 0010 stays Proposed. ADR 0006 A13 and every publication and privacy guarantee stay binding.
6. **Hosted data:** no database is assumed to hold no real writing. The pre-deployment inventory and its evidence are mandatory (§ 5). The approval authorizes no hosted database access, write, migration, or production setting.
7. **R1** stays unresolved and is required before G8 closes. ADR 0010 § 4 is investigated separately, comparing the stable named-album approaches for an owner decision. No migration without explicit authorization.

**Authorized now: step 1 only** (§ 7). Steps 2 to 4 each need the owner's go-ahead.

## Revisit when

- Stored artist slugs (R7) land: § 2.3's address-change disclosure becomes a `308`.
- A catalog surface is added (for example, ADR 0009's listing): it joins § 1.2 and the coverage test.

## Review record

- **First independent review** (architecture and security, read-only, at `fe647b2`): NO-GO as written. It found the design sound but raised three High findings (A5 openings, namesake addresses, R1 and the shown set) and four Medium ones (expiry after the locks, single use, the effect on ADR 0006, delivery order). All were fixed in the text (`2913d72`).
- **Re-review** (at `2913d72`): **GO**, fit for the owner to consider. It confirmed every High and Medium finding resolved, and the token design sound. Its four Low notes are fixed: §§ 1 and 5 and the § 9 action path in the effect table, step 4's named-album refusals stated as best-effort until R1, and two stale index and checklist rows.
