# ADR 0007: Hosted Backups, Retention, and Recovery

- **Status:** **Proposed.** It is waiting for the owner's decision. Nothing here is in force until the owner accepts it, and no backup of the hosted database exists yet.
- **Date:** 2026-11-06. Proposed with F-02 (issue [#65](https://github.com/RaioViajante/refrain/issues/65)), for gate G6 ([#47](https://github.com/RaioViajante/refrain/issues/47)).
- **Scope:** How long backups of the hosted database keep writing, including writing deleted later; what a restore from a backup may and may not do to publication and sessions; and where backups live. The mechanics are in [Hosted Backups](../hosted-backups.md).

## Context

[Security § Data protection](../security.md#data-protection) requires scheduled `pg_dump` backups, stored outside the database host, and a tested restore, before real writing is stored in a hosted database. A backup is a copy of everything:
- private writing and drafts;
- Recently deleted entries;
- the publication state;
- the author's password hash.

Three existing decisions meet it:

- **[ADR 0003 § 3](0003-relational-schema-conventions.md#3-published-slugs-stay-reserved-after-permanent-deletion), minimal retention:** "permanent deletion keeps nothing of the writing except slugs that were already public." The [product promise](../product.md) is that permanent deletion happens only on the author's explicit "Delete now". A backup taken before a "Delete now" still holds the writing. Retaining backups therefore **conflicts with the letter of ADR 0003** unless their retention is bounded and stated. This ADR does not change ADR 0003. It proposes the stated exception, for the owner to accept or refuse.
- **[ADR 0005](0005-restoring-deleted-journals.md):** restoring a deleted journal never republishes. Its published versions return as private.
- **[ADR 0006](0006-publication-decision-and-acknowledgement.md):** writing becomes public only through a reviewed, confirmed publication.

Restoring a whole database from a backup is a far larger restore than ADR 0005's, and it is a writer of public state outside the command boundary (G3). Without a rule, it could:
- republish writing that was unpublished or deleted after the backup;
- bring back writing that was permanently deleted after the backup;
- bring back sessions.

**Alternatives considered for retention:**
- **Keep everything forever.** Simplest, but it silently turns "Delete now" into "delete from the live site", and it contradicts minimal retention.
- **Keep only 7 days.** Too short to notice slow damage, such as a bad migration found weeks later.
- **Purge deleted writing from old backups.** Not possible with encrypted, immutable archives without re-encrypting history.

## Decision (proposed)

### 1. Where backups live

1. **Daily encrypted bundles** are stored as GitHub Actions artifacts of a private, single-owner repository, which is independent of Neon (database) and Vercel (hosting).
2. **Monthly copies are made by the owner** outside GitHub: iCloud Drive plus an offline encrypted drive. GitHub is never the only durable location.
3. Each bundle is encrypted with age to the owner's public key before it is stored. The private key exists only in Proton Pass and in an offline copy, never in GitHub.

### 2. Retention, explicit and bounded

1. **Daily bundles:** 90 days (`retention-days: 90`), then GitHub deletes them.
2. **Monthly owner copies:** 12 months. The owner deletes older copies from every place at the monthly drill.
3. **Nothing is kept indefinitely.** A longer-lived archive (for example, a yearly copy) needs a new, explicit decision.
4. **Stated exception to ADR 0003's minimal retention:** writing that the author permanently deletes can survive in encrypted backups for up to **90 days** in daily bundles and **12 months** in monthly copies, readable only with the owner's key. Writing that must disappear sooner needs a manual step: delete the bundles and copies made since that writing existed.
5. **Truthful copy (as INV-4 requires for purge):** when the Studio gets its "Delete now" control (M2.4), its confirmation must say that encrypted backups keep the writing for up to the retention above. No text may say that permanent deletion also removes it from backups.

### 3. What a recovery may do

A restore from a backup:

1. **Never targets the serving database.** It goes into a new database or branch. The switch to it is a separate, deliberate step.
2. **Never restores sessions, verification values, or rate-limit counters.** Their rows are not in a backup. The `BETTER_AUTH_SECRET` is rotated as part of a recovery, so no earlier cookie or confirmation token is valid.
3. **Never makes anything public.** Before the application uses the restored copy, every `published` language version becomes `private`, and its `published_at` is cleared, in one transaction. Publication history and slugs are kept, as ADR 0005 does for a single journal. `REFRAIN_PUBLIC_READS_ENABLED` stays `false` until the release gates are re-run. The author republishes through the confirmed workflow of ADR 0006.
4. **Never silently brings back permanently deleted writing.** Each bundle carries an inventory of entry identifiers and states, never content. The restored inventory is compared with the newest inventory available. An entry missing from a later backup was permanently deleted after this backup: the owner reviews each one and deletes it again before the copy is used. If no later inventory exists, the owner reviews every restored entry, all of which are private by rule 3.

### 4. What the automation may hold

1. A dedicated, read-only `refrain_backup` role is used, never the runtime role or the owner role.
2. Its credential is held only as a secret of the private repository.
3. Only the public encryption key reaches GitHub.
4. The plaintext exists only in the job's temporary storage.

## Consequences

- **Positive:**
  - Writing survives the loss of Neon, of Vercel, of the Mac, or of the GitHub account, with at most a day lost in the first three cases and at most a month in the last.
  - Every daily backup is proven restorable on the day it is made, and the owner proves decryption monthly.
  - A recovery cannot publish, cannot revive a session, and cannot quietly revive deleted writing.
- **Negative:**
  - "Delete now" is not immediate for backups. The exception above must be disclosed in the Studio's copy.
  - A recovery costs the author a re-publication of every public entry.
  - The owner must do the monthly drill: a missed month widens the gap outside GitHub.
  - Losing both copies of the key loses every backup.
- **Not decided here:**
  - Automatic purge (ADR 0002 D4.4 stays: disabled).
  - Whether G4 adds row-level security. If it does, the backup role needs a deliberate `BYPASSRLS` decision, and backups fail loudly until then.

## Revisit when

- The database grows beyond what a daily full dump handles comfortably (minutes, or more than a few hundred MB).
- The author wants deleted writing removed from backups sooner.
- GitHub's free allowance or retention rules change.
- The project moves to another database provider.
