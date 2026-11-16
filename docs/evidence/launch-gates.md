# Launch gates: the prioritized checklist, F-02, G3/G4, and G8

**Prepared on 2026-11-15 for the owner. It decides nothing, and nothing in it has been executed.** References are to `origin/release/v3-rc` (`5fc316f`), which `release/v3-integration` (draft PR #112) contains unchanged in these files. The F-02 and G3/G4 sections were drafted by a read-only research pass, and their key references were spot-checked: `ops/backup/`, `hosted-backups.md:368`, the `public_page` refusal in `music.ts`, and the backup step in `ci.yml`.

## Prioritized checklist

Who acts: **O** = the owner's decision or action; **E** = engineering, once authorized.

| # | Item | State | Next step | Who |
|---|---|---|---|---|
| 1 | **ADR 0011 / 0012 partial acceptance** | **Partly accepted** on 2026-11-15 (built work only) | Done for the built work (#113); the rest stays proposed, each part needing its own decision | O |
| 2 | **F-02 / G6 backups** | Toolchain built and tested; nothing provisioned | Below: billing check (0a), then the owner generates the key offline (step 1). The seven days start only after step 10 | O, then E |
| 3 | **G8 catalog wording** | Gap: catalog edits change published wording with no confirmation | Owner's direction: confirmation. Proposed in [ADR 0013](../decisions/0013-confirmed-catalog-changes-to-published-pages.md), awaiting acceptance; then the PRs of its § 7. G8 also needs R1 (the album a memory names) decided, as ADR 0013 § 7 says | O, then E |
| 4 | **G3 inventory, G4 enforcement** | Inventory below | Owner accepts G4 option 1 (`refrain_app` least-privilege role, plus an accepted-risk ADR); then the role is created on the hosted database through `/refrain-db-change` | O, then E |
| 5 | **Review and merge** #106 → #112 into `main` | Draft; CI and reviews in #112 | Owner review; merging needs ADR 0011's acceptance (item 1) | O |
| 6 | **S2 staged deployment** of the approved `main` | Production serves `4caf07b` | Hosted Launch's S2 sequence, protected, reads off | O approves, E executes |
| 7 | **G1 / G2 / G5 hosted evidence** | Local evidence only | On the staged deployment: identical 404s in every form (A13 for `.rsc` and `.segments`), `no-store` on every class (including the canonical 308 exception), indexing, the hosted role's predicate tests | E |
| 8 | **Authentication (#11)** | Per-client limits built, inactive (#110) | Accept them as an ADR 0004 § 6 amendment; check on the staged deployment that a forged `X-Forwarded-For` does not buy a fresh bucket; then set the variable | O, then E |
| 9 | **Covers (item 6) and photographs (item 7)** | Off on every host | A rights review, or launch with both off (the fallback) | O |
| 10 | **Canonical host** | Built, off (#109) | Set the variable at S4; check every hostname anonymously | O, then E |
| 11 | **G7 independent review** of the deployed public surface | Not done | After items 6 to 8 | E |
| 12 | **S4 public release** | — | Only with every gate closed by owner-reviewed evidence | O |

Not needed for launch: magic link (R10, blocked by ADR 0012 § 3), Music Story (MS-0, MS-1), media (R5), R2 to R12.


## 1. F-02 / G6 backups

**Built and tested.**
- Hosted toolchain `ops/backup/` (`Dockerfile`, `refrain-backup.sh` with `backup`, `check`, `drill`, `reconcile`; `backup-role.sql`, `backup-role-audit.sql`, `recovery-demote.sql`, `recovery-check.sql`), described in `docs/hosted-backups.md:45-76`. The doc says it was tested only on synthetic data against a disposable PG 18 (`:3`).
- Tests: `src/ops/hosted-backup.backup.test.ts`, run by `pnpm test:backup` (`package.json:20`) in CI against Compose `postgres-test-18` (`.github/workflows/ci.yml:213-226`).
- `db:backup` and `db:backup:verify` (`package.json:34-35`, `src/ops/cli-entry.ts`, `src/ops/backup.ts`) are the **local** development tool. `--target` must be loopback and match `DATABASE_URL`/`TEST_DATABASE_URL` (`backup.ts:140-160`). Verify restores only into a database carrying the disposable marker (`backup.ts:749-814`). They are not the hosted path.
- Workflow templates exist only as templates: `ops/backup/automation/.github/workflows/backup.yml` (cron `41 5 * * *`, `environment: production-backup`, `retention-days: 90`) and `freshness.yml` (cron `23 13 * * *`, 30 h window). `ops/backup/automation/.github/CODEOWNERS` contains `* @RaioViajante`. GitHub does not run them in this repo (`hosted-backups.md:203`).
- ADR 0007 was accepted on 2026-11-07 (`docs/decisions/0007-hosted-backups-and-retention.md:3`).

**Nothing is provisioned:** no `refrain_backup` role, no `refrain-backups` repo, no secrets, no key (`hosted-backups.md:3-7`).

**First operation needing owner authorization.** The provisioning table puts step **0a, the billing check**, first (`:357`). It is read-only unless the owner creates a budget. The first operation that creates anything is **step 1, generating the age key pair, owner only** (`:358`, § "Encryption and key custody" `:166-197`):
- Run it offline on the Mac. Build `refrain-backup-tools` from `ops/backup`, then run `age-keygen | age -p -a > /k/refrain-backup-identity.age` in `docker run --rm -it --network none` (`:172-177`).
- The public `age1…` recipient goes into the repo variable and Proton Pass.
- The identity is stored passphrase-encrypted in two places. The first is Proton Pass item "Refrain backup key" (public key, passphrase, `.age` attachment). The second is an encrypted USB drive plus a paper print, with the passphrase on paper kept somewhere else (`:183-187`).
- After that, `~/refrain-backup-key` is deleted.
- Never committed or copied into `refrain` (including issues and PRs): credentials, private key, bundles, real summaries, writing (`:205`).
- No agent generates, sees, or stores the key, the passphrase, or a DB password (`:350`).

**Prerequisites** (names only):
- **Neon role `refrain_backup`.** Read-only, `noinherit`, `connection limit 3`. Created via `/refrain-db-change`, with the password set by `\password`. Its audit must print `result|pass`. Connection uses the direct endpoint with `verify-full` (step 3, `:131-147`, `:360`).
- **Private repo `RaioViajante/refrain-backups`** with no collaborators. It contains:
  - `toolkit/` vendored from a reviewed commit, with `SHA256SUMS` and `SOURCE`;
  - environment `production-backup`, limited to `main`;
  - secrets `REFRAIN_BACKUP_SOURCE_SERVICE` and `REFRAIN_BACKUP_PGPASS`, entered through stdin or the UI;
  - variable `REFRAIN_BACKUP_AGE_RECIPIENT`;
  - protected `main` and CODEOWNERS;
  - fork PR workflows off.

  Workflows are first added **without** `schedule:` (steps 4-5, `:229-237`, `:361-362`; `backup.yml:78-82`).
- **Step 6:** one manual dispatch. This is the first export of production data.
- **Steps 7-8:** download, run `check`, and drill on `postgres-test-18` with the **offline** identity.
- **Step 9:** copies to iCloud Drive and the offline drive.
- **Step 10:** the owner commits the `schedule:` blocks (`:363-367`).

**Seven-day verification:**
- Provisioning step 11 requires "Seven consecutive successful scheduled runs, with freshness green … A failure or a missed day restarts the count" (`:368`).
- Step 12 is the timed recovery rehearsal into a new, non-serving database. Step 13 records the evidence (`:369-370`).

**Closing criteria** (§ "Closing F-02 and G6", `:379-389`):
1. ADR 0007 accepted. Met.
2. `refrain_backup` exists, its audit passes, and the automation uses neither the runtime nor the owner credentials.
3. At least 7 consecutive days of successful scheduled runs. Each restores into PG 18 and passes the comparison, with freshness green.
4. A real bundle downloaded, checked, decrypted from the **offline** key, and drilled to `drill passed`.
5. A copy outside GitHub, with `shasum -c` passing.
6. Logs, summaries, and artifacts inspected: no plaintext, credentials, or content.
7. The recovery rehearsed once into a new database, including the demotion to private, with the time recorded.

## 2. G3 writer inventory and G4

Public-state tables (scan list `src/testing/publication-scans.ts:83-92`):
- entries and their status: `entries`, `entry_texts`;
- journal content: `album_journals` (rating), `track_reflections`, `track_reflection_texts`;
- memories: `memories`, `memory_music`;
- `entry_slugs`;
- catalog wording: `artists`, `albums`, `album_artists`, `album_editions`, `tracks`, `track_artists`, `album_tracks`, `edition_tracks`;
- cover and photo columns on `albums` and `artists`.

There is no publication-history table: history is `first_published_at` and `was_published`. There is no site-settings table (`src/db/schema.ts` tables at `:144-862`).

Studio commands all take `AuthorizedAuthor`. Each Server Action calls `authorizeAuthor` first (`src/app/studio/perform.ts:15-18`; `src/modules/identity/authorization.ts:88`).

| Writer | file:function | Tables | Authorization | Changes public view without confirmation? |
|---|---|---|---|---|
| Publish | `publication/publish.ts:190 publishLanguageVersion` → `:246 markVersionPublished` | entry_texts, entries, entry_slugs | author + `ct1` token | No: it is the confirmation |
| Confirmed saves | `journals/commands.ts:194 saveAlbumJournal`, `reflections.ts:207 writeReflection`, `journals/memories.ts:353 saveMemory` | entry_texts, album_journals, track_reflection(_texts), entries, memories, memory_music | author + `change_public` token | Additions: no. Removals (unflag, clear) need no token by ADR 0006 § 5, but the UI asks |
| Unpublish / privacy | `publication/commands.ts:43`, via `journals/commands.ts:331`, `memories.ts:531` | entry_texts | author | Yes, but it only removes |
| Soft delete | `journals/commands.ts:370`, `memories.ts:568` | entries.deleted_at | author | Removes only |
| Restore | `publication/commands.ts:88 restoreDeletedEntry` (`journals/commands.ts:404`, `memories.ts:595`) | entries, entry_texts | author | No: published returns as private |
| Create | `journals/commands.ts:102`, `memories.ts:164`, `publication/commands.ts:208 reserveInitialSlug` | entries, entry_texts, album_journals, memories, memory_music, entry_slugs | author | No: draft |
| Slug change | `publication/commands.ts:127 changeEntrySlug` | entry_slugs | caller-supplied; **no caller in `src/app`** | Would change the public address. Currently unreachable |
| Permanent delete | `journals/commands.ts:467 permanentlyDeleteEntry`, `publication/commands.ts:244 retireEntrySlugs` | entries (cascade), entry_slugs | takes `DatabaseExecutor`; no UI | Removes only |
| Catalog edits | `catalog/commands.ts` `updateArtist:175`, `updateAlbum:443`, `updateTrack:637`, `setAlbumTracklist:889`, `addTrackToAlbum:920`, `removeTrackFromAlbum:944`, `moveTrackInAlbum:973`, `archiveArtist:207` | artists, albums, album_editions, album_artists, tracks, track_artists, album_tracks, edition_tracks | author | **Yes. This is the G8 gap.** Renames lock but are not refused (`:185-193`). Only newly exposed credits are refused (`:479`) |
| Catalog guarded | `restoreArtist:241` (`:258`), `music.ts setAlbumArtwork:1476` (`:1526`), `removeAlbumArtwork:1566` (`:1579`), `photos.ts setArtistPhoto:579` (`:610`) | artists, albums | author | No: `public_page` refusal |
| Catalog new rows / ids | `createArtist/Album/Track`, `music.ts importMusicRelease:904`, `importMusicArtist:1252`, `linkAlbumToMusic:1122`, `linkArtistToMusic:1293`, `removeArtistPhoto:645`, archive/restore/delete of album and track | catalog | author | Mostly no. New rows are not shown, and links fill identifiers only. `importMusicRelease` that reuses a recording can change a memory's named album (ADR 0010 R1). Unverified in code |
| Data migrations | `src/db/migrations/0002…sql:12,15`, `0003…sql:9,13` | entry_texts.first_published_at, entry_slugs.was_published, entries | `drizzle-kit migrate` as DB owner, applied manually | Changes redirect history only, not status |
| Restore of a backup | `pg_restore`, then `ops/backup/recovery-demote.sql` and `recovery-check.sql` (`hosted-backups.md:325-346`) | all | owner, manual, into a new database | Procedure demotes everything to private. Skippable, so it is bound only by procedure (`:343`) |
| Local backup verify | `src/ops/backup.ts:668 runVerify` | scratch database | CLI `--target`, loopback, marker | No |
| Identity CLI | `src/modules/identity/cli.ts`, `provisioning.ts` | auth_* only | CLI with env | No direct public state |
| Fixtures / e2e | `src/testing/public-*.ts`, `public-seed-cli.ts:109-200`, `e2e/global-setup.ts:240-267`, `e2e/{memories:605,recovery:234,tracks:271,public:327,academic:140,music:486}.spec.ts` | all; they set `status='published'` directly | test-only. `assertDisposableTestDatabase` (`src/testing/test-database.ts:174`; `e2e/support.ts:43`; `e2e/global-setup.ts:48,231`; `public-seed-cli.ts:68`) | Yes, but only on marked disposable databases |
| CI | `.github/workflows/ci.yml` | service-container test databases | no secrets | No hosted access |
| Manual access | Neon console, `psql`, Drizzle Studio with owner or runtime credentials | all | whoever holds the credentials | **Yes, unbound** |

The static scans cover in-process writers only. Out-of-process writers are explicitly uncovered until G3 and G4 close (`docs/security.md:262`, `:437`, `:439`).

**G4 options** (`docs/hosted-launch.md:133-134`; `docs/security.md:546-547`; ADR 0006 `:319-320`):

1. **Least-privilege runtime role plus an accepted-risk ADR with named controls (recommended, smallest).**
   - Create `refrain_app`: DML only on the application tables. No DDL, no `CREATE`, not the owner, no role membership, no `drizzle` access. The backup design already assumes this (`hosted-backups.md:163`).
   - Migrations and restore run only as `neondb_owner`, manually.
   - Named controls:
     - the static scans;
     - `REFRAIN_PUBLIC_READS_ENABLED` stays off during recovery;
     - the demote and check scripts;
     - owner credentials kept only in the password manager;
     - no Drizzle Studio or console writes against a serving database.
   - Tests:
     - an integration test that the runtime role cannot run DDL, `SET ROLE`, or read `drizzle`;
     - G5 privacy tests run as that role.

   **Unverified:** whether hosted `DATABASE_URL` currently uses `neondb_owner`. The Vercel Neon integration supplied it (`docs/evidence/v3-rc.md:135`), and no `refrain_app` creation exists in the repo.
2. **Trigger** on `entry_texts` that refuses `status → 'published'` unless a transaction-local GUC is set by `markVersionPublished`. Any role can set a GUC, so this is a tripwire against accidental writes, not against an attacker. It needs a migration.
3. **Column privilege plus a `SECURITY DEFINER` publish function**: revoke `UPDATE(status)` from the runtime role. This is stronger but larger: a new owner role and a function. The backup audit fails if the backup role can execute such a function (`hosted-backups.md:154`).
4. **RLS.** Largest. `pg_dump` then fails unless a deliberate `BYPASSRLS` decision is made (`hosted-backups.md:160`).

Option 1 closes the realistic out-of-process paths (credentials and procedure) with the least schema change. Options 2 and 3 can follow if the owner wants database-level proof.

## 3. G8: catalog changes that affect published writing

**The gap.**
- `docs/hosted-launch.md:138`; `docs/security.md:551`, with residuals at `:555`, `:562`, `:568`, `:574`.
- ADR 0006 A5 guards only credits that would open an artist page, artist restores, and photographs. Renames, track titles, credit wording, and edition details still change pages (ADR 0010 draft `:13`).

**Commands that change public wording today without confirmation:**
- `updateArtist` (name), at `catalog/commands.ts:175`;
- `updateAlbum` (title, year, edition label, credit order, `credited_as`, credit removal), at `:443`;
- `updateTrack` (title, credit, track artists), at `:637`;
- the tracklist commands (`:889`, `:920`, `:944`, `:973`);
- `createTrack` with an `albumId` (`:602`);
- `deleteAlbum` (`:557`) when it removes a memory's containing album;
- `importMusicRelease` (`music.ts:904`) when a reused recording changes a memory's named album.


**Recommendation (the owner's direction): catalog changes that affect published writing require the author's explicit confirmation.** An edit to a catalog record that a served page shows (name, title, year, credits, track titles, track order) goes through ADR 0006's mechanism, exactly as a published journal's change does:
1. a review that lists every served page whose wording would change, with each change shown;
2. a server-authenticated confirmation token that binds those exact changes, and is refused when anything changed meanwhile (`confirmation_stale`);
3. the edit and the record of the confirmation in one transaction, under the same locks.

It is larger to build than a refusal: a new token purpose, a cross-surface wording delta (album journal, memory, artist page, archives, Home), a dialog, and a design review. That is why proposed ADR 0010 chose refusal.

**Smaller interim, if launch must not wait for it: refuse while shown.** Catalog edits that would change a served page's wording answer `public_page`. The author unpublishes, edits, and republishes, and republishing is itself a confirmation. Whichever path is chosen, the publication and confirmed-save fingerprints must also bind the rendered catalog wording, so that an edit between a preview and its confirmation gives `confirmation_stale`. The details below are the proposed ADR 0010 analysis; they apply to both paths.

**Refusal while shown** (`public_page`), as proposed ADR 0010 § 2 chose (`origin/docs/adr-0010-catalog-publication-integrity:docs/decisions/0010-catalog-memory-publication-integrity.md:55-111`). It is smaller to build than a confirmed catalog change, and fails closed:
- It reuses the existing `public_page` code, the exposure locks in `publication/catalog-exposure.ts`, and the existing UI path: unpublish, edit, republish.
- It adds no new token purpose, cross-surface delta, or dialog.
- It fails closed.

The confirmed catalog change was considered and not chosen (`:38`). It needs a token-bound wording delta across album, memory, artist, archive, and Home surfaces, plus a design review.

Refusal alone leaves the window between preview and confirm. The smallest safe version therefore also binds the rendered catalog atoms into the publication and confirmed-save fingerprints, so an edit in that window gives `confirmation_stale` (`:90-98`). Before deployment, served entries are unpublished and republished, or the record shows none are served (`:100`).

**Code that would change:**
- Refusals in `updateArtist` (name), `updateAlbum` (title, year, label, all credit changes; this narrows A5), `updateTrack`, the four tracklist commands, `createTrack` with an album, `deleteAlbum`, and `importMusicRelease`.
- Fingerprint and disclosure: `publication/disclosure.ts`, `journals/publishing.ts`, `journals/memory-publishing.ts`, `publication/change.ts`.

**Tests that would change:**
- Tests asserting renames or credit wording are allowed while public: `catalog/artist-exposure.integration.test.ts:185`, `:363`, `catalog/commands.integration.test.ts`, `catalog/concurrency.integration.test.ts`, `studio-actions.http.test.ts`.
- New tests per ADR 0010 § 5 (`:368-379`):
  - each refusal, while shown and while not shown;
  - a static coverage test over every catalog writer;
  - a stale result for an edit between preview and confirm (journal and memory);
  - the real-connection races (`:381-397`).

ADR 0010 also ties §§ 2-4, including memory R1, into one merge (`:364`). Whether § 2 can ship alone is an owner decision. **Unverified.**
