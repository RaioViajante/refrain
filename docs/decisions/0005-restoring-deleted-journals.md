# ADR 0005: Restoring Deleted Journals

- **Status:** Accepted. The owner accepted the policy in § 1 at the M1.3B merge (PR #16), and accepted the implementation decisions in §§ 2 and 3, the interface, and the M2 condition in § 5 in the M1.3C review of PR #19 (see [the table](#what-the-owner-approved)).
- **Date:** 2026-11-01. Proposed with M1.3C (issue #18, pull request #19) and accepted the same day.
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
- **`entries.version` is not changed.** The writing did not change, so an editor that was open when the journal was deleted and is saved after the restore does not conflict. This holds under the current, verified contract: only `saveAlbumJournal` changes text, and it locks the entry and checks the version. **Any future operation that changes text must preserve an equivalent version and concurrency check** (§ 5 of this ADR and the Revisit list). `updated_at` is set, as every command does.
- **Track-reflection flags are not changed.** `track_reflections.is_published`, the favourite mark, the rating, and "still writing" are kept. They are public only while the parent language version is public ([ADR 0002 D5](0002-domain-model-decisions.md)), and the restore leaves that version private, so none of them is reachable. The owner accepted this preservation, **on the condition in § 5**: publishing the version again must never expose such a reflection through an undisclosed side effect. A test documents the behavior of the data layer.
- **Featured journals keep `is_featured`.** Featuring never changes visibility, and the predicate hides a private journal from featured resolution (INV-1).
- **No schema change.** The existing fields carry everything; no migration.
- **Interface.** A private *Recently deleted* page lists the deleted journals with the status each language version has, which of them will return as private, and a *Restore…* control that asks first and says what the restore does. Afterwards the studio opens the restored journal with a notice chosen by a fixed word in the query string (never echoed). There is no permanent-delete control.

### 4. Alternatives considered

- **Restore every version as a draft.** Simpler to explain, but it discards the author's decision that a version was finished (`private`) and is not the owner's policy.
- **Restore versions as they were, including `published`.** Rejected by the owner: a restore would republish.
- **Bump `entries.version` on restore.** It would turn an unchanged text into a conflict for an open editor. A restore changes who can see a version, never the text, and the version guards the text. This was tested rather than assumed: a deleted journal refuses every save, so nothing can change the text between the delete and the restore; an editor opened before the delete saves what it loaded and is accepted (the save changes no visibility); and an editor that is stale because of a save made before or after the delete and restore is refused as a conflict, with the newer writing untouched. The tests are in `restore.integration.test.ts` ("an editor that was open before the journal was deleted and restored") and `recovery.spec.ts` (two tabs across a delete and a restore).
- **Put the visibility change in the Journals module.** The Publication module already owns `unpublishLanguageVersion`, slugs, and the invariants that only its commands keep (ADR 0003); a second place that writes `entry_texts.status` would make them harder to hold.

### 5. Required condition for the M2 publishing interface

This is a safety condition on a **future** interface. It is not implemented, and M1.3C has no publishing control. It extends ADR 0002 D5 (a reflection is public only when its own flag is set *and* its parent version is public) without changing it, and it applies whenever a parent language version is published again after having been unpublished, deleted, or restored.

Before the publication interface lets the author publish a language version of a journal that has track reflections, it must:

1. determine which individual track reflections would become publicly visible as a result (those whose `is_published` is set);
2. clearly disclose those reflections to the author;
3. require explicit confirmation that includes them;
4. let the author review or change their individual publication selections before completing the publication;
5. never expose a previously published reflection silently, as an undisclosed side effect of publishing the parent version.

The condition is tracked in the [Roadmap (M2)](../roadmap.md#adr-0005-condition-for-the-m2-publishing-interface) and in [Security § Planned](../security.md#implemented-and-planned-protections).

## What the owner approved

| # | Decision | Source |
| --- | --- | --- |
| 1 | Draft returns as draft, private as private, published as **private** | Owner policy (PR #16) |
| 2 | A restore never publishes anything | Owner policy (PR #16) |
| 3 | Content and publication history (`first_published_at`, version and entry) are preserved | Owner policy (PR #16) |
| 4 | All slug rules stay in force; a published slug stays reserved and current | Owner policy (PR #16) |
| 5 | The predicate and INV-1 to INV-5 are unchanged; no purge, no permanent-delete control | Owner policy (PR #16) |
| 6 | `published_at` is cleared on a version restored from `published` (a database check requires it: a version that is not `published` has none) | Accepted in the M1.3C review |
| 7 | The visibility change lives in the Publication module (`restoreDeletedEntry`); the Journals module enforces the author and the entry kind | Accepted in the M1.3C review |
| 8 | Restoring a journal that is not deleted is refused (`entry_not_deleted`); repeated and concurrent restores fail safely with that code | Accepted in the M1.3C review |
| 9 | `entries.version` is not incremented by a restore, under the verified text-versioning contract; future text-changing operations must preserve appropriate version and concurrency checks | Accepted in the M1.3C review |
| 10 | Track-reflection flags and `is_featured` are preserved, **subject to the M2 condition in § 5** | Accepted in the M1.3C review |
| 11 | `updated_at` reflects the restoration | Accepted in the M1.3C review |
| 12 | The private *Recently deleted* page with a confirmed *Restore…* and a notice chosen from a fixed query-string value; no pagination for this single-author implementation | Accepted in the M1.3C review |
| 13 | No schema change and no migration | Accepted in the M1.3C review |
| 14 | Automatic purge and permanent-delete controls stay disabled | Owner policy; confirmed in the M1.3C review |
| 15 | The M2 publishing interface must satisfy the five-part condition in § 5 | Required by the owner in the M1.3C review |

Remaining trade-offs and risks: until the M2 condition is built, nothing in the studio can set a reflection's flag or publish a version, so the exposure cannot occur. The restore dialog's promise ("nothing is published again until you choose to publish it") is exact for the language version; § 5 is what makes it exact for reflections too. Restore exists for album journals only.

## Consequences

**Positive**

- Deleted writing can be recovered from the studio, with its text, history, and address intact, and a restore cannot publish.
- One locked transaction makes the outcome of any race a valid state.
- No migration, no new dependency.

**Negative and costs**

- A journal that was published and is restored is private, and the author has to publish it again on purpose. That is the policy.
- Restore exists for album journals only. Memories and artist journals have no studio screen yet; `restoreDeletedEntry` is ready for them, and each needs its own wrapper that checks its kind (as `restoreAlbumJournal` does).
- The *Recently deleted* page is not paginated. It lists every deleted journal; the owner accepted that for a single author.
- The M2 publication interface carries a required safety condition (§ 5).

## Revisit when

- the first publishing control is built (M2): it must satisfy § 5, and the restore dialog's wording about published writing becomes reachable and needs a check;
- any operation other than `saveAlbumJournal` changes a journal's text (translations, the editor, revisions): it must keep a version and concurrency check, because a restore deliberately does not bump `entries.version`;
- memories and artist journals get studio screens;
- automatic purge is designed, which must not remove anything a restore could still recover without an explicit rule.
