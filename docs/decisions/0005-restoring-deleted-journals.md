# ADR 0005: Restoring Deleted Journals

- **Status:** Proposed. The policy in § 1 is the owner's decision, accepted at the M1.3B merge (PR #16) and recorded in the [Roadmap](../roadmap.md#follow-ups-from-the-m13b-review). Sections 2 to 4 are the implementation choices made in M1.3C (issue #18) and wait for the owner's review.
- **Date:** 2026-11-01
- **Scope:** What it means to restore an album journal from Recently deleted, and how the restore is built. It settles the open question in [ADR 0003 § 5](0003-relational-schema-conventions.md#5-deferred-restore-behavior-and-purge) and [ADR 0002](0002-domain-model-decisions.md#still-open-after-this-adr) ("whether published language versions return as private when a deleted entry is restored"). It changes none of ADR 0002's decisions or invariants.

## Context

Deleting a journal sets `entries.deleted_at` and keeps everything it owns ([ADR 0002 D4](0002-domain-model-decisions.md)). Until M1.3C, recovery meant SQL only. The owner wants to store important writing in the studio, so a restore must exist first, and it must not become a way to publish.

A deleted entry can hold language versions in any state, including `published` (the studio cannot publish yet, but the commands exist, and a later milestone will). The public predicate hides an entry while it is deleted. Clearing `deleted_at` alone would therefore make a published version public again at the moment of the restore, without any act of the author's. That is what the policy forbids.

## Decision

### 1. The policy (the owner's)

- A language version that was **draft** is restored as **draft**; **private** as **private**; **published** as **private**.
- Restoring **never publishes**: a restored entry and each of its language versions is never made publicly visible by the restore. It becomes public again only when the author explicitly publishes it.
- Restoring **preserves** the authored content and the publication history (`first_published_at` on each version and on the entry), and **all slug rules** of ADR 0002 and ADR 0003 stay in force: a published slug stays reserved and a current slug stays current.
- The [publication predicate](../security.md#publication-predicate) and **INV-1 to INV-5** stay in force. Automatic permanent deletion stays disabled.

### 2. The command

- **`restoreDeletedEntry(tx, entryId)`** in the Publication module, because the Publication module owns visibility and the slugs. It locks the entry row, refuses an entry that is not deleted (`entry_not_deleted`), sets every `published` version to `private` with `published_at = NULL`, then clears `deleted_at`, all in the caller's transaction. It returns the locales that were published, so the studio can say so. It authorizes nothing and knows no entry kind.
- **`restoreAlbumJournal(db, author, entryId)`** in the Journals module takes the `AuthorizedAuthor`, validates the id (Zod), locks the album journal's entry row (which also admits only album journals, so a deleted memory or artist journal is `entry_not_found`), and calls `restoreDeletedEntry` in one transaction. It is the only way the studio restores.
- **`restoreJournalAction`** is the Server Action. Like every action it starts with `authorizeAuthor`, then runs the command through `perform`, which also requires the application's own `Origin`.

### 3. Choices that the policy leaves open

- **Repeated and concurrent restores.** The entry row lock serializes them. Exactly one finds the entry deleted and succeeds; every other receives the fixed failure `entry_not_deleted` (shown in words: it may already have been restored) and changes nothing. A restore racing a save, a publication, or "Delete now" ends in one consistent state, never a live entry with a version that the restore left published.
- **Not a quiet no-op.** Restoring a live journal is refused rather than ignored, so a restore can never be used to unpublish a live, published journal.
- **`entries.version` is not changed.** The writing did not change, so an editor that was open when the journal was deleted and is saved after the restore does not conflict. `updated_at` is set, as every command does.
- **Track-reflection flags are not changed.** `track_reflections.is_published`, the favourite mark, the rating, and "still writing" are kept. They are public only while the parent language version is public ([ADR 0002 D5](0002-domain-model-decisions.md)), and the restore leaves that version private, so none of them is reachable. When the author later publishes the journal, each reflection that was authorized keeps that authorization and goes public with it, exactly as after an unpublish and a republish today. The restore dialog's promise that nothing is published again until the author chooses is therefore true of the language version, and a reflection flagged for publication follows its version. When M2 adds the publishing control, it must list the reflections that are still flagged. A test documents this.
- **Featured journals keep `is_featured`.** Featuring never changes visibility, and the predicate hides a private journal from featured resolution (INV-1).
- **No schema change.** The existing fields carry everything; no migration.
- **Interface.** A private *Recently deleted* page lists the deleted journals with the status each language version has, which of them will return as private, and a *Restore…* control that asks first and says what the restore does. Afterwards the studio opens the restored journal with a notice chosen by a fixed word in the query string (never echoed). There is no permanent-delete control.

### 4. Alternatives considered

- **Restore every version as a draft.** Simpler to explain, but it discards the author's decision that a version was finished (`private`) and is not the owner's policy.
- **Restore versions as they were, including `published`.** Rejected by the owner: a restore would republish.
- **Bump `entries.version` on restore.** It would turn an unchanged text into a conflict for an open editor. A restore changes who can see a version, never the text, and the version guards the text.
- **Put the visibility change in the Journals module.** The Publication module already owns `unpublishLanguageVersion`, slugs, and the invariants that only its commands keep (ADR 0003); a second place that writes `entry_texts.status` would make them harder to hold.

## Consequences

**Positive**

- Deleted writing can be recovered from the studio, with its text, history, and address intact, and a restore cannot publish.
- One locked transaction makes the outcome of any race a valid state.
- No migration, no new dependency.

**Negative and costs**

- A journal that was published and is restored is private, and the author has to publish it again on purpose. That is the policy.
- Restore exists for album journals only. Memories and artist journals have no studio screen yet; `restoreDeletedEntry` is ready for them, and each needs its own wrapper that checks its kind (as `restoreAlbumJournal` does).
- The *Recently deleted* page is not paginated. It lists every deleted journal; that is fine for one author and revisited if the list grows.

## Revisit when

- the first publishing control exists (M2): the restore dialog's wording about published writing becomes reachable and needs a check;
- memories and artist journals get studio screens;
- automatic purge is designed, which must not remove anything a restore could still recover without an explicit rule.
