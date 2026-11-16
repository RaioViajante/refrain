# ADR 0013: Confirmed Catalog Changes to Published Pages (G8)

- **Status:** **Proposed.** Not accepted, and nothing in it is built. It binds nothing until the owner accepts it in writing. It adds no migration.
- **Date:** 2026-11-16
- **Scope:** Gate G8 only: how a catalog edit (an artist's name, an album's title or credits, a track's title, a tracklist) may change the wording of a page the public can read. It replaces one choice of the proposed [ADR 0010](https://github.com/RaioViajante/refrain/pull/99) (PR #99), and reuses that ADR's analysis everywhere else ([Relationship to ADR 0010](#relationship-to-adr-0010-pr-99)).

## Context

[ADR 0006](0006-publication-decision-and-acknowledgement.md) makes publication a confirmed act. Its fingerprint deliberately leaves catalog wording out (§ 2, "documented gap C11: closed by gate G8, not accepted as harmless"). Gate G8 requires either that "a public page cannot change its wording without the author's explicit confirmation", or an independently verified safe alternative, with no waiver (ADR 0006, the public page release gates).

**Today, on `main`:**
- these change a served page's wording with no confirmation:
  - `updateArtist` (name);
  - `updateAlbum` (title, year, the reference edition's label, a credit's order, `credited_as`, or its removal);
  - `updateTrack` (title, credit, track artists);
  - the tracklist commands (`addTrackToAlbum`, `removeTrackFromAlbum`, `moveTrackInAlbum`, `setAlbumTracklist`);
  - `createTrack` with an album.
- Only these are refused while public (`public_page`): `restoreArtist`, a credit that would open an artist page (A5), `setAlbumArtwork` and `removeAlbumArtwork` (A3), and `setArtistPhoto` (A5).
- "Shown" today counts album journals only (`src/modules/publication/catalog-exposure.ts`), never memories.

**Proposed ADR 0010 (#99)** chose to **refuse** such edits while a page shows the record. The author takes the pages down, edits, and publishes again (its § 2). It considered the confirmed catalog change and set it aside **"for now"**, because it "needs a delta over every surface kind, its own token purpose, and its own tests", and named it "the next step if § 2's cost is too high … through its own decision". The cost it records: a typo fix takes pages down, needs every page confirmed again, and moves each `published_at`.

**The owner's direction (2026-11-16):** explicit author confirmation, not mandatory unpublishing before every edit, and edits to unpublished content keep working as they do now. This ADR is that "own decision".

## Decision

### 1. Which catalog changes affect served pages

1. **"Shown" is ADR 0010 § 1's set, with its rule that switches never matter.** It is computed from the Publication module's fragments only, and covers:
   - every album with a **served** album journal: its title, year, reference-edition label, credits, and rendered tracks;
   - every album and track that a **served** memory links, with their credited artists, and the album the memory names under the current rule;
   - every artist with a **public page**.

   It counts memories, which `catalog-exposure.ts` does not do today. A record is shown whatever the value of `REFRAIN_PUBLIC_READS_ENABLED` or the cover switch. Turning reads on must never reveal wording no one confirmed.
2. **The affected pages** of a change are every served page whose rendered catalog wording would differ after it. They follow from the reads the pages already use:
   - the album journal and its metadata title;
   - the memory and its song record;
   - the artist page and its metadata;
   - the album, artist, and memory archives;
   - the Home's lists;
   - for an artist rename, the artist's address, which is derived from the name (`artist-address.ts`).

   Each served **language version** is a separate page (EN and `/pt`). The wording is language-neutral, so one change lists both.
3. **Classification.** Starting from ADR 0010 § 2's inventory, every row it would **refuse while shown** becomes **confirmed while shown**, except these, which stay refused:
   - `deleteAlbum` while it contains a track a served memory links;
   - `importMusicRelease` when a reused recording would change the album a served memory names;
   - the existing artwork and photo refusals (A3, A5);
   - a credit that would **open** an artist page. Under A5, that page opens only through a confirmed publication.

   Every row ADR 0010 **allows** stays allowed, unchanged: edition date and country, MusicBrainz identifiers, sort name, kind, archive and restore where allowed, and new records. A static coverage test fails on any catalog writer not classified ([§ 7](#7-implementation-in-small-reviewable-pull-requests)).
4. **Not shown means unchanged behaviour.** An edit that affects no served page needs no confirmation and shows no dialog, exactly as today.

### 2. What the Studio shows

1. A catalog edit form (album, artist, track, tracklist) saves as now. Before it writes, the server computes the change's **public impact** (§ 1.2).
2. **No affected page:** the edit is applied, as today.
3. **Affected pages:** nothing is written. The form opens **"Update the published pages?"**, which lists:
   - **each affected page, by kind and address** (EN and `/pt` separately), linking to the page;
   - **for each page, the exact before and after wording** of every changed atom, rendered as the page renders it. For example, a credit line "A, B" → "A & B", a track's title, a track's position in the list, the metadata title. It reuses the confirmed-save dialog's before-and-after presentation (`ReviewedValueView`);
   - **an artist rename's address change.** The old address answers the unknown address's `404` afterwards, because artist addresses are not stored (G1's open artist-slug question; stored slugs are R7). The dialog says so in plain words;
   - what does **not** change: the publication dates, "Recently written", and every entry's writing and status.
4. Focus starts on the title, so no key press confirms before reading. **Confirm** applies the change, and **Cancel** keeps the form as typed. The dialog is in English and Portuguese from the Studio dictionaries (ADR 0008), with 44 px targets.
5. The impact shows only **served** pages and catalog wording, which the author already sees in the Studio. No private writing, rating, or hidden entry is listed.

### 3. The confirmation token

1. **Same engine.** ADR 0006 § 3's signed token (`ct1`, HKDF key, 15-minute validity, no stored state, minted only by a preview) gains a third purpose, **`catalog_change`**. The purpose is a signed claim and is checked on verify, so a `catalog_change` token is never accepted for `publish` or `change_public`, nor the reverse. Whether a new purpose under `ct1` needs its own HKDF `info` string (ADR 0006 § 3: "an `info` string is never reused") is [open decision 1](#open-decisions).
2. **What it binds:**
   - the author's user and session, as today;
   - the **catalog subject**, `album:<id>`, `artist:<id>`, or `track:<id>`, in `e`;
   - the **fingerprint `f`** of:
     - the operation and its exact requested values;
     - the current rendered catalog atoms of every bound row;
     - the set of affected pages, with each page's entry id, `entries.version`, and publication stamp;
     - the before and after wording shown.
3. **No version column.** Catalog tables have none, and this ADR adds no migration. `n` carries a fixed constant, `1`, for this purpose: the claims schema requires a positive integer (`src/modules/identity/confirmation.ts`), and `n` has no catalog meaning. **Freshness comes from recomputing `f`** inside the confirming transaction, under its locks, from the current rows (§ 4). Any difference in a bound row, a served page, an entry version, or the requested values makes it stale.
4. **Minted only by the preview,** `previewCatalogChange`, which authorizes first, computes the impact, and signs with the database clock, as `previewPublication` does. ADR 0006 § 9's static scan gains it in the closed list of previews that may mint.
5. **Single use without storage.** Once the change is applied, the bound "before" atoms no longer exist, so a replay recomputes a different `f` and is refused as stale. An expired token answers `confirmation_expired`.
6. **Never leaves the dialog.** The token lives in the dialog's state, is sent only with the confirm action, and is never written to the page, a log, or a URL (as ADR 0006 requires today).

### 4. Concurrency and stale confirmations

1. **ADR 0010 § 3 is adopted for the G8 commands, unchanged:**
   - the lock order: entries `FOR SHARE` in ascending id, then albums, then artists, then tracks, each in ascending id, with write mode for the rows written;
   - the per-command lock table;
   - the required reorders (`createTrack` and `importMusicRelease` insert after locking; `updateTrack` takes its entry locks first);
   - **deciding only from statements after the last lock**;
   - the ABA re-reads (`track_artists`, containing albums);
   - its L1, L2, and L6 decisions.
2. **The confirm path,** one transaction:
   - verify the token's signature, purpose, subject, author, and expiry (before the transaction, as today);
   - take the locks in that order;
   - recompute the impact and `f`;
   - **if it differs: `confirmation_stale`**, nothing written, and the dialog reopens with the current impact;
   - otherwise apply the change and return.
3. **No token, but the record is now shown.** The command recomputes the impact after its locks, even when the preview found none. If any page is now affected, it answers **`confirmation_required`** and writes nothing (fail closed). A publication racing an unconfirmed edit therefore never leaves an unconfirmed wording served.
4. **Against publication.** Publications and confirmed saves share-lock the catalog rows their fingerprint binds (ADR 0010 § 3, "amends L3; addresses R5"). A publication and a catalog change on the same rows serialize, and whichever confirms second sees a different fingerprint and is stale.
5. **Deadlocks** (`40P01`) answer the existing generic retry error and write nothing. ADR 0010's R6 note applies: the remaining takedown paths take album and artist write locks, and are re-tested.
6. **Residual windows:** ADR 0010's R4 (reductions and namesakes, whose end state is a subset of what was confirmed) is recorded for the owner's review under G7. R5 is closed by item 4, not accepted. R6 is item 5.

### 5. Publication fingerprints include catalog wording

ADR 0010 § 2's binding is adopted as written:
- the catalog atoms each page renders join the publication **disclosure and fingerprint**;
- the confirmed save binds its own page's catalog atoms, and the memory link atom gains its rendered wording;
- a catalog edit between a publication's preview and its confirmation answers `confirmation_stale`;
- ADR 0006 § 2's "informational lines are not part of the set" ends for catalog wording. **This closes C11.**

Tokens issued before deployment fail as stale, which costs at most one re-review within 15 minutes.

### 6. Contracts that stay as they are

- **The publication predicate** is unchanged and still the only visibility rule. The impact is computed from the same Publication fragments the public reads use, so it can name only pages that are served.
- **ADR 0006:**
  - every confirmed act stays confirmed: publish, `change_public`, and unpublish;
  - removals keep § 5's ask-first rule;
  - A3's artwork rules and A5's rule that an artist page opens only through a confirmed publication are unchanged;
  - A13 is unrelated.
- **Languages** (ADR 0008, A7): no token input differs by interface language. A catalog change binds every served language version at once, and the `/pt` and EN pages are listed separately.
- **Privacy:** the dialog and the token carry no private writing or hidden entry. Catalog edits to records that nothing served shows stay free.
- **Publication history:** a confirmed catalog change is not a publication. It sets no `published_at`, and it moves nothing in "Recently written" or the archives' order.
- **Deletion and slugs:** recoverable deletion, slug retention, and redirects are unchanged. An artist rename's address change is disclosed and confirmed, not hidden (§ 2.3).
- **No migration,** and no change to ADR 0002's invariants.

### 7. Implementation in small, reviewable pull requests

Each step is one pull request with its own tests and an independent security review. Until steps 3 and 4 land, today's behaviour is unchanged: no step makes a page change silently in a new way.

1. **Impact computation (read-only).** `catalogPublicImpact(change)` in the Publication module, built on its fragments, with the "shown" set including memories. It has unit and integration tests over every state (served, hidden, deleted, unpublished, each language), with no command wired.
2. **Fingerprints bind catalog wording (§ 5)** for publications and confirmed saves, with the share locks of § 4.4. This closes C11 on its own: catalog edits between a preview and a confirmation become stale. It adds the race tests from ADR 0010 § 5 for publications.
3. **Token purpose, preview, and gate for the renames:** `catalog_change`, `previewCatalogChange`, and `confirmation_required`, `stale`, and `expired` for `updateArtist`, `updateAlbum`, and `updateTrack`. It adds the Studio dialog for those three forms, in EN and PT. Tests:
   - HTTP: refused without a token, stale after a change, and not replayable;
   - browser: the dialog at 1440 and 390 px;
   - concurrency: a rename against a publication.
4. **Tracklists and creation:** the tracklist commands and `createTrack` with an album, plus the refusals that stay (§ 1.3), with the dialog for the tracklist editor. Adds the **static coverage test** over every catalog writer.
5. **Evidence and gate review.** `docs/evidence/` records each step's checks. The owner reviews G8 on that evidence (G8 cannot be waived).

## Relationship to ADR 0010 (PR #99)

- **Replaced, for G8:** ADR 0010 § 2's rule "refused while shown" becomes "confirmed while shown" for the rows in § 1.3. The refusals listed there remain.
- **Reused as written:**
  - ADR 0010 § 1's terms ("shown");
  - § 2's writer inventory and its binding of catalog atoms into fingerprints;
  - § 3's locks and concurrency analysis;
  - § 5's G8 and concurrency tests, adapted from "refused" to "confirmed";
  - its pre-deployment record: every served entry's catalog wording was confirmed, or the record shows none was served, the expected path for both current databases.
- **Not decided here, left to ADR 0010 or later decisions:**
  - **R1**, the album a memory names (ADR 0010 § 4, with its option B migration, which is not authorized);
  - the listing rows of ADR 0009 (R2, R3, R7);
  - the published-snapshot alternative;
  - `removeAlbumArtwork` always allowed (A8, PR #102).
- **No contradiction:** both ADRs are proposed. If both are accepted, this ADR governs catalog edits that change served wording, and ADR 0010 is reworked to point its § 2 here (as ADR 0011's D18 already asks for #99). If ADR 0010 is never accepted, this ADR stands on its own, citing #99's analysis for the record.

## Alternatives considered

- **Refuse while shown (ADR 0010 § 2).** It is smaller to build and fails closed. It makes every typo fix a takedown, edit, and republish, which moves `published_at` and empties pages meanwhile. Not chosen, by the owner's direction. It stays the fallback if step 3 slips: shipping § 1.3's rows as refusals first is allowed, and closes G8 on its own.
- **A published snapshot of catalog wording** (ADR 0010, Alternatives): a second copy of the catalog and a second rendering path. Not chosen.
- **Confirm with a new `ct2` key.** Possible, if open decision 1 is answered that way. It changes the key derivation only.

## Consequences

**Positive:**
- G8 can close with typo fixes possible on published pages, and C11 closes.
- Unpublished catalog work is unchanged.
- The dialog shows exactly what readers will see.

**Negative:**
- A third token purpose, an impact computation over every surface kind, and a new dialog, each needing tests.
- Catalog commands take entry share locks, with ADR 0010's deadlock residuals.
- An artist rename still breaks the old artist address until stored slugs (R7).

## Open decisions

1. **The token's key:** a third purpose under the `ct1` key, which is enough because the purpose is a signed and checked claim (recommended), or a new HKDF `info` string (`ct2`).
2. **Renaming a public artist:** allow it with the address change disclosed and confirmed (recommended), or refuse it until stored artist slugs (R7, a migration).
3. **The refusals that remain** (§ 1.3): `deleteAlbum` with a served-memory track, and the `importMusicRelease` reuse case. Keep them refused (recommended), or make them confirmable later.
4. **Order of delivery:** steps 1 to 4 as above (recommended), or ship ADR 0010's refusals first as an interim G8 closure, then replace them with confirmation.
5. **Pre-deployment record:** confirm that both current databases serve no real writing, so the record path applies without unpublishing anything.

## Revisit when

- Stored artist slugs (R7) land: § 2.3's address-change disclosure becomes a `308`.
- A catalog surface is added (for example, ADR 0009's listing): it joins § 1.2 and the coverage test.
