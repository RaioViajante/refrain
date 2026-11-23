# 0003. A 30-day trash and text history for the Studio

- **Status:** Accepted by the owner, 2026-11-23, with the decisions in [Owner decisions of 2026-11-23](#owner-decisions-of-2026-11-23). Accepting it authorizes the PRs of § 7 only. A hosted migration, any change on Neon or Vercel, and any deploy each still need the owner's explicit approval.
- **Builds on:** [0002](0002-mixtape-archive-product.md) (the product model, visibility, and hosting). It changes none of it.

## Context

Every deletion in the Studio is permanent today:

| Action | What is lost | Code |
| --- | --- | --- |
| delete a tape | the tape, its tracklist, and every track note | `deleteMixtape` (`src/server/studio/mixtapes.ts`) |
| delete a song | the song, plus its track and note on every tape (positions close up) | `deleteSong` (`src/server/studio/songs.ts`) |
| remove a track | the track and its note | `removeTrack` (`src/server/studio/mixtapes.ts`) |
| untick a tape in a song's form | that song's track and note on the tape | `saveSongAction` → `removeSongFromMixtape` → `removeTrack` |
| delete a photo | the photo and its bytes (already refused while it is in use) | `deleteImage` (`src/server/studio/images.ts`) |
| save a text | the previous wording: page texts, reflection, description, quote, caption, track note | `saveSiteText`, `updateMixtape`, `updateTrackNote` |
| empty a page text | the text (its row is deleted) | `saveSiteText` |

The owner asked for a trash that keeps deleted items for 30 days, and a history of replaced texts. The owner decided on 2026-11-22:

1. a restored tape always comes back as a **draft**, with its tracks, notes, and reflection, and with whatever links can still be restored. Restoring a tape never publishes it. Restoring a song or a track onto a tape that is *already* published does change that tape's public page, and only after an explicit confirmation (owner decision of 2026-11-23, item 2; § 3);
2. a photo (and later a drawing) **cannot be deleted while anything uses it**, including an item that can still be restored from the trash. No reference may break;
3. history covers the home and about texts, reflections, track notes, descriptions, quotes, and captions. **Every saved version is kept**, with no merging of saves made close together. Restoring an old version keeps the current one, so it can be recovered too;
4. retention is **30 days**, purged by a daily **Vercel Cron** job authenticated with `CRON_SECRET`. The purge is idempotent. **An expired item cannot be restored even before the purge has run**;
5. the Studio explains unsaved changes, previews, live edits, and drafts in featured places (done in PR #144).

Preview and Production share one Neon database today. **Two gates are mandatory before any hosted migration** (§ 6):

- the two environments are isolated and the isolation is verified;
- a backup restores verifiably, and a copy off this computer has a validated SHA-256.

## Decision

### 1. Snapshots in separate tables; live tables unchanged

A deleted item **leaves its live table**, and a snapshot of it goes into new trash tables. The alternative, a `deleted_at` column on every live table, was rejected for three reasons:

- **Public reads stay exactly as they are.** Public pages read only live tables, through `src/server/visibility.ts`. A soft-delete column would need a new condition in every public and Studio query, and one forgotten condition would publish a deleted item. With snapshots, a deleted item cannot be public, because it is no longer where public pages look.
- **Unique values are freed at once.** A deleted tape gives up its number, its slug (its address), and its featured place, so a new tape can take them. With a soft-delete column, a deleted tape would keep holding them.
- **The migration only adds tables.** No existing column or constraint changes. The code running in Production today keeps working against the migrated database. The migration can therefore land before the code that uses it, and rolling the code back needs no schema rollback.

The price of this choice is that restoring has to handle conflicts (§ 3). References from a snapshot to rows that are still live are declared as foreign keys (§ 2), so PostgreSQL enforces them. They do not live only inside the snapshot's JSON.

### 2. Data model (additive migration `0004`)

```
trash_items
  id              uuid primary key
  kind            text      check in ('mixtape', 'song', 'track', 'image')
  subject_id      uuid      the deleted row's original id
  label           text      what the Lixeira shows ("core", "Creep — Radiohead")
  payload         jsonb     the snapshot (below)
  payload_version smallint  check > 0; restore refuses a version it does not know
  deleted_at      timestamptz not null default now()
  purge_after     timestamptz not null default now() + interval '30 days',
                  check (purge_after > deleted_at)
  index (purge_after), unique (kind, subject_id)

trash_files                       bytes of a deleted photo
  trash_item_id   uuid primary key → trash_items on delete cascade
  content_type, byte_size, bytes  the same checks as image_files

trash_image_refs                  photos a restorable item still uses
  trash_item_id   uuid → trash_items on delete cascade
  image_id        uuid → images on delete restrict
  primary key (trash_item_id, image_id)

text_versions                     replaced wording
  id              uuid primary key
  subject         text      check in ('site_text', 'mixtape', 'track')
  subject_key     text      the site-text key, or the tape's or track's id
  field           text      check in ('body', 'reflection', 'description',
                            'pull_quote', 'pull_quote_credit',
                            'detail_caption', 'note')
  label           text      the field's name when it was replaced
  body            text      check char_length <= 20000
  replaced_at     timestamptz not null default now()
  purge_after     timestamptz not null default now() + interval '30 days',
                  check (purge_after > replaced_at)
  index (subject, subject_key, field, replaced_at), index (purge_after)
```

- **`purge_after` comes from the database's clock,** as a column default, never from the application's. The only explicit value is a carried-over one (§ 3, "nothing is consumed that was not applied"): a `track` item or a note version written during a restore copies the original item's expiry (and, for a `track` item, its `deleted_at`), so carrying over never extends the 30 days.
- **Expired items do not count.** Every read and every restore requires `purge_after > now()`, so an expired item is gone for the owner even if the purge has not run yet.
- **What each snapshot holds**, validated with zod on the way in and on the way out:
  - **mixtape:** every column, plus the tracklist in order. Each track carries its id, the song's id, the song's title and artist, its note, and the note's side;
  - **song:** the song, plus every track it was removed from (the track's id, the tape's id and title, position, note, side);
  - **track:** the tape's id and title, the song's id, title, and artist, the position, the note, and the side;
  - **image:** the `images` row. Its bytes go to `trash_files`.
- **Trash rows are owner-only.** They are written and read only by a new `server-only` module, `src/server/studio/trash.ts`, called from Studio actions that call `requireStudio()`. No public query touches these tables, and a test asserts that the public modules never import the trash module.
- **New kinds plug in.** Each kind has one snapshot handler and one restore handler. A future drawing adds its own kind and its own references, the way `trash_image_refs` does for photos.
- **The hosted-migration guard learns the new tables.** `scripts/migrate-hosted.mts` refuses any database that holds a table it does not know, so the four new tables join its `OWN_TABLES` in the same PR as the migration.

### 3. Deleting and restoring, kind by kind

Each deletion becomes a single transaction: it writes the snapshot, then deletes the live rows. The Studio's messages change from "excluída" to "movida para a lixeira". A restore is also a single transaction:

1. it locks the trash item with `select … for update where purge_after > now()`;
2. it writes the live rows back;
3. it deletes the trash item.

A second click, or a purge that runs at the same moment, finds nothing left and reports "esse item não está mais na lixeira". A restore ends with a short report saying what changed, for example "voltou como rascunho, com o endereço `core-2`".

Three rules hold for every kind:

- **Nothing is consumed that was not applied.** If part of an item cannot go back (its tape is in the trash and not expired, or a song collides), that part stays in the trash as its own `track` item, with the original deletion date and expiry, and the report says so. A note that cannot be reapplied is recorded as a `text_versions` row: on the live track when that track already has its own note, or under the tape's last name when the tape is gone for good. So a restore never drops a note's wording, even when its track cannot come back.
- **Shelf changes are serialized.** Restoring a tape or a track takes the same `share row exclusive` lock on `mixtapes` that `createMixtape` and `moveMixtape` take, so the checks for a free number, address, or featured place hold until the insert.
- **Constraint errors become messages.** A unique (23505), foreign-key (23503), deadlock (40P01), or serialization (40001) error from a concurrent change rolls the restore back and keeps the item in the trash, with "algo mudou enquanto restaurava; tente de novo" in place of a server error.

**Tape**
- **Always comes back as a draft**, with no publication date (the database requires that a draft has none). The original publication date stays in the snapshot. Publishing again later records a new date.
- **id:** the same id, so its history (§ 4) and Studio links work again.
- **address (slug):** the same one if it is free. Otherwise a suffix is added (`core-2`), and the report says so. The base is shortened first so that the address plus its suffix stays within the 80 characters the database allows.
- **number:** the same one if it is free; numbers do not shift when a tape is deleted. Otherwise it goes to the end of the shelf. If the shelf is full (999), the restore is refused and the trash keeps the item.
- **featured place:** the same place if it is free, otherwise none. A draft in a featured place does not appear on the home page, and the editor already says so.
- **cover and support photos:** always still there. `trash_image_refs` keeps them from being deleted while the tape is in the trash.
- **tracks:** written back in their original order, with their notes and their original ids. For each song, in this order:
  1. the same song, if it still exists;
  2. otherwise, the song with the same title and artist (letter case ignored), which is how the catalogue already identifies a song;
  3. otherwise, the song is recreated from the title and artist kept in the snapshot.

  Every song is resolved before anything is written. If two tracks resolve to the same song (one was deleted, and the other was later renamed to its title), the first keeps its place and the second stays in the trash as its own `track` item. The report names every song that was merged, recreated, or held back, and says that a held-back track can be restored once one of the two songs is renamed. No track is lost.

**Song**
- **Comes back** with the same id. If a song with the same title and artist exists by then, the restore merges into that one.
- **Its tracks** go back onto tapes that exist, with their ids and notes, at their original position, clamped to the end if the tape got shorter (the following tracks move down). Three cases differ:
  - a tape that already has the song again keeps its own track. The old note is recorded as a version of that track's note (above);
  - a tape that is itself in the trash: that track stays in the trash as its own `track` item, so it can be restored once the tape is back;
  - a tape that was purged or has expired: the track cannot come back, because its tape is gone for good. Its note is kept as a version (above), and the report says so.
- **A song on a published tape changes the site as soon as it is restored.** So the restore needs an explicit confirmation (owner decision 2):
  - it names every affected published tape and its public page (`/mixtapes/<slug>`);
  - it says the change is public at once;
  - nothing is written until the owner presses a separate confirm button, never the first click.

  If no affected tape is published, the usual confirmation is enough.

**Track** (one track removed from a tape)
- **Comes back** onto its tape, with its id and note, at its original position, clamped to the end if the tape got shorter.
- **Is refused, and stays in the trash,** when its tape is in the trash, or when the tape already has that song again. The message says which. When its tape was purged or has expired, the Lixeira shows it as impossible to restore until it expires; its note can still be read and copied.
- **The song** is resolved the same way as for a tape. If the tape is published, the restore needs the same explicit confirmation as a song: it names the tape's public page and says the change is public at once (owner decision 2).

**Photo**
- **Can be deleted only when nothing uses it:** a tape's cover or support photo, a page slot, or an unexpired item in the trash (through `trash_image_refs`). That last case is new, and the error message names the item in the trash that still uses the photo. An expired item no longer counts: the delete transaction first purges the expired items that reference the photo, then checks.
- **Its bytes move to `trash_files` byte for byte,** so nothing is re-encoded.
- **Comes back** with the same id, the same rights flags, and the same bytes. It is public again only once something public uses it, as `photoIsPublic` already decides.
- **While in the trash it is served to nobody.** `/fotos/<id>` answers 404 even to the owner. The Lixeira shows its thumbnail through a separate owner-only route, with the same headers as `/fotos` for private photos (`private, no-store`, no CDN caching, `Vary: Cookie`).

**Purge and photos:** when a tape's snapshot expires, its photos stay in the library, unused. Deleting them then sends them to the trash for another 30 days. No photo is ever lost because of a cascade.

**Not a deletion:** taking a photo out of a page slot (`setSiteImage` with no photo) only unassigns it; the photo stays in the library. It does not go to the trash.

### 4. Text history

- **What creates a version.** Every save that actually changes a text records the previous wording as a `text_versions` row, in the same transaction as the save. The save first locks the row (`select … for update`), so two saves from two tabs each record the wording they actually replaced. "Changes" means the new text differs from the old one compared the way the server stores it (`normalizeText`), and the old text was not empty.
- **Which texts.** Page texts (`body`, in `saveSiteText`), a tape's `reflection`, `description`, `pull_quote`, `pull_quote_credit`, and `detail_caption` (in `updateMixtape`), and track notes (`note`, in `updateTrackNote`). Erasing a note ("anotação apagada") records it as well.
- **No merging.** Each save is its own version; nothing is merged by time, per decision 3.
- **Emptying a page text** records its wording as a version before the row is deleted.
- **Where history appears.** Each field gets a "versões anteriores (n)" link, which lists its versions newest first, each with its date and the first lines.
- **Restoring a version loads the old wording into the field without saving it** (owner decision 3). The field then shows as "alterado" and the unsaved-changes guard applies. When the owner presses "salvar", the wording being replaced becomes a version in its turn, so it can be recovered (decision 3). The owner sees the text before it reaches the site, and the existing save path and messages stay the same. On a published text, saving still means the change goes live at once, as the page already says.
- **A version is never consumed by a restore.** It lasts until its own `purge_after`, 30 days for now (owner decision 5).
- **History starts with the implementation.** Versions are captured only from the deployment that ships § 4 onwards, and the trash holds only what is deleted from the deployment that ships § 3 onwards. Wording replaced or deleted before then is not in the database, and the system cannot recover it. The pre-launch backup holds only the state of that date.
- **When the subject is deleted,** its versions stay. If the tape or track is restored (with the same id), its history is still there. While the subject is in the trash, or after it was purged, its versions are listed in the Lixeira under its last name ("fita excluída: core"); they can be read and copied, but not loaded into a field that no longer exists.

### 5. The Lixeira page and the purge

- **`/studio/lixeira`**, an owner-only page in the Studio menu, has two lists, both newest first:
  - **items:** tapes, songs, tracks, and photos, each with its kind, name, deletion date, and "apagado de vez em N dias", plus a "restaurar" button with a confirmation;
  - **replaced texts:** grouped by field, each linking to that field's history.
- **No reference screen exists for this page.** Before it is implemented, the owner reviews a sketch built from the existing Studio patterns (list rows, buttons, dates). Nothing is redesigned.
- **No "apagar agora" button.** Deleting something permanently before its 30 days was not asked for, and it would be a second destructive action to get right. It is left out.
- **The purge** is a `GET /api/cron/purge-trash` route:
  - it answers 401 unless `CRON_SECRET` is set and non-empty and `Authorization` equals `Bearer <CRON_SECRET>`, compared in constant time. So on Preview, where the variable does not exist, it always answers 401;
  - it runs `delete … where purge_after <= now()` on `trash_items` (which also removes their files and photo references) and on `text_versions`;
  - it returns only counts. Running it twice deletes nothing the second time.
- **Its schedule** is one entry in `vercel.json`: `crons: [{ "path": "/api/cron/purge-trash", "schedule": "0 6 * * *" }]`, which is 03:00 in Brasília.
- **Checked on 2026-11-23,** read-only:
  - the account is on the Hobby plan. Vercel documents Hobby cron jobs as running at most once a day and only roughly on time (within the hour); PR 6 re-checks the current limits. That suits a daily purge;
  - cron jobs run only on Production deployments;
  - `CRON_SECRET` does not exist yet. The owner creates it as a sensitive Production variable;
  - the schedule takes effect only with a Production deploy, which the owner authorizes;
  - PR 6 confirms that the cron request reaches Production under the project's Deployment Protection setting (`all_except_custom_domains`).
- **The purge matters only for storage.** Correctness never depends on it: expired items are already invisible and cannot be restored. A late or skipped run just keeps bytes a little longer.
- **The page itself never purges.** A purge inside a page render would run on prefetch too. The Lixeira shows how much space the trash uses. The dashboard's counts stay right without change, because trashed rows leave the live tables.

### 6. Isolating Preview and Production; backup; hosted rollout

**Isolation is a mandatory gate.** It is done before the migration, as its own owner-approved step, and verified. No step of the rollout below starts until it is.

Three checks come **before** the branch is created (owner decision 4):

- **Access protection.** Every Preview deployment URL sits behind Vercel Authentication, and no Preview alias is public. Who holds the project's automation bypass secret is known, and whether to revoke it is decided (a pending item from the launch).
- **Credential isolation.** A Neon branch inherits its parent's roles and passwords. So the `preview` branch's role gets a new password, or a dedicated role, so that Preview's credential cannot open `main`. Production's `DATABASE_URL` is not present in Preview's variables.
- **No exposure of private content.** The branch holds the same drafts, unpublished texts, and private photos as Production. They stay reachable only through the Studio sign-in or behind Vercel Authentication. Preview never sets `SITE_INDEXABLE`, and no Preview log prints content.

Then:


- **Production keeps the Neon `main` branch** and its data as they are. Nothing moves.
- **A Neon branch `preview` is created from `main`** (owner decision 4). It is a copy-on-write copy, so creating it does not modify `main`.
- **Preview's `DATABASE_URL` points to that branch.** This is a Vercel configuration change, so it is done by the owner or with the owner's explicit authorization. First check whether the Neon integration (now connected to Preview only) rewrites that variable. If it does, set the variable by hand and disable the integration's per-deployment branching.
- **Verified afterwards with read-only reports,** with no data read and no writes:
  - Preview's host differs from Production's;
  - running `scripts/migrate-hosted.mts` without `--apply` against each URL reports the expected host and the applied migrations.
- **Destructive tests still run only on the local, disposable databases.**
- **The Neon integration and passwords.** Production's variable was set by hand. If Neon rotates the `main` password, it must be updated by hand, as the cutover runbook already warns. Before creating the branch, confirm that a second branch fits the plan's compute and storage limits.

**Backup**, immediately before the migration:

- **Where the credentials come from.** Production's `DATABASE_URL` is a sensitive Vercel variable and cannot be pulled. After isolation, Preview's variables point at the `preview` branch, not at Production. So the owner copies the `main` branch's connection details from the Neon console into an env file outside the repository, deleted afterwards. The backup taken now, before isolation, can still use Preview's variables, because both point at the same database.
- `scripts/backup-database.sh` dumps Production read-only. It then restores the dump into a throwaway container and compares every table's rows and checksums, photos byte for byte, ending with "restore verified".
- The dump and its SHA-256 are kept in `backups/`.
- **An external copy is mandatory.** The owner copies the dump to a medium off this computer (an external disk, or the owner's own cloud storage). The SHA-256 is then computed again on that copy and must match. No hosted migration runs until this is done. It is still open from the launch, where the second copy stayed on the same machine.
- Neon's own point-in-time restore is a second line of defence, not the only one. Its window depends on the plan and is checked first.

**Rollout**, each step with the owner's approval, and only once both gates above are met (isolation verified; backup restored, with a validated external copy):

1. **Rehearsal:** create a throwaway branch from `main`, run `migrate-hosted.mts --expect-host <its host>` (first the report, then `--apply`), check the four new tables and their constraints, then delete the branch.
2. **Apply the migration** to the `preview` branch. Deploy a Preview build and test the trash there.
3. **The owner creates `CRON_SECRET` in Production.**
4. **Apply the migration to Production.** It only adds tables, so the running deployment is unaffected.
5. **Deploy Production** from `git archive` of the approved commit (runbook § 3). Smoke-test it. The next day, check that the cron ran in Vercel's logs.

**Deploy gate:** once the trash code is on `main` (PR 3), no Production deploy may happen before step 4. Without the new tables, every deletion would fail: safely, since the transaction aborts and nothing is deleted, but it would still be an outage. The runbook and the PR descriptions state this gate.

**Recovery:**

- **Code:** roll back to the previous Production deployment. The old code ignores the new tables. Only the old `scripts/migrate-hosted.mts` notices them: it refuses a database that holds tables it does not know. Use the script from the commit that added them.
- **Schema:** the new tables can stay. If they must go, the four `drop table` statements are reviewed and run only after a backup.
- **Data:** restore the dump onto a new Neon branch and repoint, after checking the result.

### 7. Work split, after acceptance

Each item is its own PR, with tests on Node 24 and an independent review. None merges without the owner.

1. **This record.** Documentation only.
2. **Schema and migration `0004`,** plus `OWN_TABLES` and database tests for every constraint. No change in behaviour.
3. **Trash module.** Deleting moves to the trash, with a restore handler for each kind. Photo deletion also checks `trash_image_refs`. Integration tests cover every conflict above: address, number, featured place, merged or recreated song, tape in the trash, full shelf, expired item, double restore.
4. **Text history:** recording versions, listing them, and loading one into the field.
5. **Lixeira page,** after the owner approves its sketch. Playwright at 390 and 1440 px.
6. **Purge route, `vercel.json` cron, and a runbook** for § 6.

Then the hosted rollout of § 6, run with the owner.

## Owner decisions of 2026-11-23

1. **Every removed track goes to the trash,** with or without a note.
2. **Songs and tracks can be restored onto published tapes,** only after an explicit confirmation that names the affected pages and warns that the change is public at once (§ 3). Restoring a tape never publishes it.
3. **Restoring a text version loads it into the editor** without saving it (§ 4).
4. **Preview gets an isolated Neon branch created from Production,** but only after access protection, credential isolation, and the absence of any exposure of private content are verified (§ 6).
5. **Text history is kept 30 days,** to begin with.

The owner also made two things mandatory before any hosted migration: the external backup copy with a validated checksum, and the Preview/Production separation (§ 6).

## Consequences

- **Storage:** deleted photos keep their bytes in Neon for 30 days (up to 4 MB each). The Lixeira shows the total.
- **The migration only adds tables,** and `OWN_TABLES` grows to match.
- **Studio wording changes** from "excluir" to "mover para a lixeira", and its messages say how to restore. That includes unticking a tape in a song's form, which today only says the song "foi atualizada".
- **History and trash start empty.** They hold only what is replaced or deleted after their deployment (§ 4).
- **Out of scope:** Spotify, the drawing editor, a "delete now" button, and any public change beyond restoring tracks onto published tapes after confirmation.
