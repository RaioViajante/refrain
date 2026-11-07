# ADR 0007: Hosted Backups, Retention, and Recovery

- **Status:** **Accepted** by the owner on 2026-11-07, including the retention exception to ADR 0003 in § 2a ([Acceptance](#acceptance)). Acceptance sets the policy only. **No backup of the hosted database exists yet:** nothing is provisioned, and F-02 (#65) and gate G6 stay open until their [closing criteria](../hosted-backups.md#closing-f-02-and-g6) are met.
- **Date:** Proposed 2026-11-06; accepted 2026-11-07. Proposed with F-02 (issue [#65](https://github.com/RaioViajante/refrain/issues/65)), for gate G6 ([#47](https://github.com/RaioViajante/refrain/issues/47)).
- **Scope:** How long backups of the hosted database keep writing, including writing deleted later; what a restore from a backup may and may not do to publication and sessions; and where backups live. The mechanics are in [Hosted Backups](../hosted-backups.md).

## Context

[Security § Data protection](../security.md#data-protection) requires scheduled `pg_dump` backups, stored outside the database host, and a tested restore, before real writing is stored in a hosted database. A backup is a copy of everything:
- private writing and drafts;
- Recently deleted entries;
- the publication state;
- the author's password hash.

Three existing decisions meet it:

- **[ADR 0003 § 3](0003-relational-schema-conventions.md#3-published-slugs-stay-reserved-after-permanent-deletion), minimal retention:** "permanent deletion keeps nothing of the writing except slugs that were already public." The [product promise](../product.md) is that permanent deletion happens only on the author's explicit "Delete now". A backup taken before a "Delete now" still holds the writing. Retaining backups therefore **conflicts with the letter of ADR 0003** unless their retention is bounded and stated. This ADR does not change ADR 0003's decision. It states a bounded exception for backups, which the owner accepted on 2026-11-07.
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

## Decision

### 1. Where backups live

1. **Daily encrypted bundles** are stored as GitHub Actions artifacts of a private, single-owner repository, which is independent of Neon (database) and Vercel (hosting).
2. **Monthly copies are made by the owner** outside GitHub: iCloud Drive plus an offline encrypted drive. GitHub is never the only durable location.
3. Each bundle is encrypted with age to the owner's public key before it is stored. The private key exists only in Proton Pass and in an offline copy, never in GitHub.

### 2. Retention, explicit and bounded

1. **Daily bundles** expire after **90 days** (`retention-days: 90`). GitHub then deletes them, and a deleted artifact "cannot be restored".
2. **Monthly owner copies** expire after **12 months**. At each monthly drill, the owner deletes copies older than that from every place they were kept: iCloud Drive and the offline drive.
3. **Nothing is retained indefinitely by policy.** A longer-lived archive, such as a yearly copy, needs a new, explicit decision.

### 2a. The retention exception to ADR 0003 (stated, not silent)

ADR 0003 promises that permanent deletion keeps nothing of the writing except slugs that were already public. Backups change what "permanent" means. **The owner accepted this exception on 2026-11-07.** The promise now reads:

1. **"Delete now" removes the writing from the serving application at once.** That is the database the Studio and the public pages read. Nothing changes there: `permanentlyDeleteEntry` behaves as ADR 0003 says.
2. **Historical encrypted backups made while the writing existed can still hold it,** until they expire:
   - at most **90 days** in daily bundles;
   - at most **12 months** in monthly owner copies.

   Only the owner's private key can read them.
3. **After that, nothing of it remains anywhere**, by policy, except the reserved slugs of ADR 0003.
4. **Writing that must disappear sooner** needs a manual step: delete every bundle and copy made while it existed. Doing so also removes those days from the backup history.
5. **A recovery never brings it back silently:** see § 3.4.

On acceptance, ADR 0003's status line gained a note pointing to this section. Its decision is not edited. The same exception is stated in [Security § Data protection](../security.md#data-protection), [Data Model § Retention after permanent deletion](../data-model.md), and [Product](../product.md) item 7.

### 2b. Truthful copy for the future "Delete now" control

INV-4 requires truthful recovery wording, and the same rule applies here. The Studio has no "Delete now" control yet (M2.4), and no interface text today says that deleted writing is erased. When the control is built, its confirmation must state the backup retention, and no text may say that permanent deletion also removes writing from backups. **Proposed** wording, for the owner's approval with M2.4 (it changes nothing now):

- **en:** "Delete permanently? This removes the journal and everything in it from Refrain now. It cannot be restored from Recently deleted. Encrypted backups made while it existed keep a copy until they expire: up to 90 days, and up to 12 months in monthly copies."
- **pt-BR:** "Excluir permanentemente? Isto remove agora o diário e tudo o que ele contém do Refrain. Não será possível restaurá-lo de Excluídos recentemente. Os backups criptografados feitos enquanto ele existia guardam uma cópia até expirarem: até 90 dias, e até 12 meses nas cópias mensais."

The pt-BR wording must use the Studio's existing name for *Recently deleted* when M2.4 is built.

### 3. What a recovery may do

A restore from a backup:

1. **Never targets the serving database.** It goes into a new database or branch. The switch to it is a separate, deliberate step.
2. **Never restores sessions, verification values, or rate-limit counters.** Their rows are not in a backup. The `BETTER_AUTH_SECRET` is rotated as part of a recovery, so no earlier cookie or confirmation token is valid.
3. **Makes nothing public.** Before the application uses the restored copy, every `published` language version becomes `private`, and its `published_at` is cleared, in one transaction (`ops/backup/recovery-demote.sql`). A read-only check (`ops/backup/recovery-check.sql`) fails while any version is published, and is run immediately before the switch. Both are tested, but they are steps of the owner's procedure, not something the application enforces. Publication history and slugs are kept, as ADR 0005 does for a single journal. `REFRAIN_PUBLIC_READS_ENABLED` stays `false` until the release gates are re-run. The author republishes through the confirmed workflow of ADR 0006.
4. **Never silently brings back permanently deleted writing.** Each bundle carries an inventory of entry identifiers and states, never content. `refrain-backup reconcile <candidate> <newer>` compares the restored candidate's inventory with the newest one available (tested). An entry missing from a later backup was permanently deleted after this backup: the owner reviews each one and deletes it again before the copy is used. If no later inventory exists, the owner reviews every restored entry, all of which are private by rule 3.

### 4. What the automation may hold

1. A dedicated, read-only `refrain_backup` role is used, never the runtime role or the owner role.
2. Its credential is held only as a secret of the private repository.
3. Only the public encryption key reaches GitHub.
4. The plaintext exists only in the job's temporary storage.

## Consequences

- **Positive:**
  - Writing survives the loss of Neon, of Vercel, of the Mac, or of the GitHub account, with at most a day lost in the first three cases and at most a month in the last.
  - Every daily backup is proven restorable on the day it is made, and the owner proves decryption monthly.
  - A recovery that follows the procedure publishes nothing, revives no session, and revives no deleted writing without the owner's review. The demotion and the check are tested SQL. Skipping them remains possible, and only the procedure and the public-reads switch stand in the way.
- **Negative:**
  - "Delete now" is not immediate for backups. The exception above must be disclosed in the Studio's copy.
  - A recovery costs the author a re-publication of every public entry.
  - The owner must do the monthly drill: a missed month widens the gap outside GitHub.
  - Losing both copies of the key loses every backup.
- **Not decided here:**
  - Automatic purge (ADR 0002 D4.4 stays: disabled).
  - Whether G4 adds row-level security. If it does, the backup role needs a deliberate `BYPASSRLS` decision, and backups fail loudly until then.

## Acceptance

On 2026-11-07 the owner accepted this decision as written:

1. Daily encrypted PostgreSQL 18 backups, encrypted with age before they are uploaded, kept **90 days**.
2. Monthly owner copies outside GitHub, kept **12 months**.
3. The private key is held by the owner only, in Proton Pass and in an independent offline copy, never in GitHub.
4. A dedicated, read-only Neon role, `refrain_backup`.
5. A restore and integrity comparison on every daily run, and a monthly decryption and restore drill by the owner.
6. Recovery only into a new database, never into the serving one. Everything published is demoted to private before a recovered copy is used. Writing permanently deleted after the backup is reconciled and reviewed. Sessions and verification values are not in backups. `BETTER_AUTH_SECRET` is rotated during an actual recovery.
7. **The retention exception to ADR 0003 (§ 2a):** writing permanently deleted from the serving application can remain in encrypted backups until they expire, for up to 90 days in daily bundles and up to 12 months in monthly copies.

**What acceptance does not do:**
- It provisions nothing. No key pair, `refrain_backup` role, private repository, secret, schedule, or export exists. Each step in [Hosted Backups § Provisioning](../hosted-backups.md#provisioning-each-step-needs-the-owners-explicit-authorization) needs the owner's separate authorization.
- It does not close F-02 (#65) or G6 (#47). Until they close, the hosted database holds only synthetic `[Test]` records.
- It does not approve the interface wording in § 2b. That wording is approved with M2.4, when "Delete now" is built.
- It does not change ADR 0002 D4.4: automatic purge stays disabled.

## Revisit when

- The database grows beyond what a daily full dump handles comfortably (minutes, or more than a few hundred MB).
- The author wants deleted writing removed from backups sooner.
- GitHub's included Actions allowance, budget enforcement, or retention rules change.
- The project moves to another database provider.
