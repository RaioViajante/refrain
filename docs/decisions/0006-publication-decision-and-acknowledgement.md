# ADR 0006: Publication Decision and Acknowledgement

- **Status:** Proposed. For the owner's review (issue #25). It is **not Accepted**, and nothing in it is implemented.
- **Date:** 2026-11-01
- **Scope:** What it means to publish, republish, and change a journal that is public; how the author's decision is represented, validated, and bound to what the reader will see; how that holds under concurrency, deletion, restoration, and translations; how public reads and caches stay inside the publication predicate. It **implements** [ADR 0005 § 5](0005-restoring-deleted-journals.md#5-required-condition-for-the-m2-publishing-interface), which it does not weaken, and extends it to the album rating and to changes made after publication. It changes no accepted ADR: [conflicts and clarifications](#conflicts-and-clarifications) lists every place where existing text needed care.

## Context

What exists (checked in the repository at `894aacd`):

- The schema is complete. Visibility is per language version (`entry_texts.status`, with `published_at` and `first_published_at`), a reflection has its own `is_published`, and an album journal has a `rating_half_steps`. No migration is needed for anything below.
- `publishLanguageVersion(db, entryId, locale)` takes no author, no version, no acknowledgement, and does not check that there is anything to publish. It is exported from the Publication module and tested. No studio code can reach it (`no-publishing.test.ts`), so nothing is exposed today.
- `saveAlbumJournal` has no status check. It would change the text of a *published* version at once.
- No command writes a track reflection, a translation, or an album rating. Public queries exist and are tested, but no route calls them.
- ADR 0005 § 5 requires the M2 publishing system to disclose, and have the author acknowledge, the exact set of reflections that publication would make public, and to enforce that at the Publication command boundary, atomically, for every caller. It fixes no signature.

The owner's decisions for this ADR (issue #25):

1. Acknowledgements are stateless where feasible, with no new persistence table unless proven necessary.
2. Publication is explicitly authorized and bound to the current entry version, locale, and effective disclosure set.
3. Changing a reflection's visible text or publication flag while its parent language version is public must not expose additional content without explicit confirmation.
4. Editing already published text is allowed, but the interface discloses that saving changes the public page and requires explicit confirmation.
5. The album rating is covered by explicit publication disclosure, using the existing schema if it keeps the privacy guarantees.
6. Publishing directly from Draft is allowed, with exactly the validation and acknowledgement of publishing from Private.
7. Author-written EN/PT-BR translations stay on the roadmap and do not block the first minimal public demonstration before 2026-11-16.

## Decision

### 1. Three operations, and one definition of "what the reader will see"

- **Preview** (`previewPublication`) reads the *disclosure* for one language version of one entry and returns it with an *acknowledgement token*. It writes nothing and holds no lock.
- **Publish** (`publishLanguageVersion`) makes that version public if, under the entry lock, the token still matches the disclosure computed *then*. It is the only way to make a version `published` ([§ 9](#9-there-is-no-unchecked-path)).
- **Confirmed save** is a save of a journal that is public. It is applied only if the author confirmed the exact change to the public page ([§ 5](#5-changes-after-publication)).

All three use one function that describes the **public surface** of an entry, derived from the same SQL fragments as the [publication predicate](../security.md#publication-predicate) ([`predicate.ts`](../../src/modules/publication/predicate.ts)), never from a second copy of the rules. The public surface contains these *items*:

| Item | Public when | Digest covers |
| --- | --- | --- |
| **Version** `(locale)` | the entry is not deleted and that version's status is `published` | title, opening, margin note, and the body as its canonical `jsonb` text (not only `body_text`, so a formatting-only edit is caught) |
| **Address** | at least one version is public | the current slug |
| **Album rating** (album journals) | at least one version is public (the rating belongs to the journal, not to a language) | the value, or its absence |
| **Memory details** (memories) | at least one version is public | the remembered-when text and the ordered music links (track or album ids) |
| **Reflection** `(track reflection, locale)` | its `is_published` is set, it has text in that locale, and that locale's version is public | text, favourite, rating, still-writing |

"Has text in that locale" means a `track_reflection_texts` row exists for it, as the predicate already requires. Writers must not leave a row for an empty text (an M2.2 rule, tested), so a row means text.

### 2. The disclosure

`previewPublication(db, author, { entryId, locale })` returns, for the target locale `L`:

- the entry, its kind, `L`, `entries.version`, and the version's current status (`draft`, `private`, or `published`);
- the **address** that will be public (the current slug) and whether it was ever public;
- the **album rating** when the entry is an album journal and one is set. It is always listed, and marked `alreadyPublic` when another language version is already public;
- the **reflection set**: every pair `(track reflection, L)` that will be public once `L` is: `is_published` set and text in `L`. Each item identifies the reflection and the track and its language, and carries its favourite mark, rating, and still-writing label as they will appear. Items are ordered by track reflection id.

Rules:

- **Per language, and only that language.** The disclosure for `L` never contains a pair of another language. The studio is private, so it may say that the rating is already public through another version (`alreadyPublic`) and may show other versions' states, read-only, as the design specifies. Nothing public ever mentions an unpublished language (INV-3; § 13, test 10).
- **Complete by construction.** It is derived from the predicate fragments for the hypothetical state "`L` is published", so it cannot disagree with what the public queries will return. Today [`predicate.ts`](../../src/modules/publication/predicate.ts) hard-codes `status = 'published'`, so M2.1 parameterizes the fragments (the live public queries pass `'published'`). That edits a security-critical file, so it is its own commit with its own review, and the parity test (§ 13, test 1) is the guard.
- **Informational lines are not part of the set.** Reflections that are flagged but have no text in `L` are not public in `L` (they may be public in another language that is published), and appear only as a count the studio may show. They are outside the digest. Catalog metadata (track and album titles) is displayed but not digested: a catalog edit changes how something is labelled, not what writing is exposed.
- **The same disclosure for Draft and Private.** The status being left is shown, and changes nothing else (owner decision 6).
- **Other kinds.** Memories and artist journals have no reflections and no rating, and go through the same operation. A memory's disclosure adds its remembered-when text and its ordered music links; an artist journal's has only the version and the address (the related writing its page lists is selected from other entries by the predicate). A kind that gains a public field adds it to the table in § 1 before its studio screen ships.

### 3. The acknowledgement token

The token is `v1.` followed by the base64url SHA-256 digest of the canonical JSON (keys sorted, UTF-8, arrays in the order above) of:

- the entry id, the locale `L`, and `entries.version`;
- the disclosure's items with their content digests (§ 1);
- the **state stamp**: `entries.updated_at`, the target version's `updated_at`, and the target version's status, each exactly as PostgreSQL returns it as text (never a JavaScript `Date`, which loses microseconds).

How each requirement of owner decision 2 and ADR 0005 § 5 holds:

- **Stateless.** Nothing is stored. The command recomputes the token under the lock and compares. No table, no column, no migration, no secret.
- **Bound to the version.** Any change to the text bumps `entries.version` (§ 6) and changes the digest.
- **Bound to the locale.** `L` is in the digest and the command acts on `L` only.
- **Bound to the effective set.** A flag, a text, a rating, a favourite mark, a still-writing mark, the album rating, or the address that changes the disclosure changes the digest (ADR 0005 § 5.6).
- **Not replayable across a lifecycle change.** The stamp changes when the entry or the version is saved, published, unpublished, deleted, or restored. A restore sets `entries.updated_at` (ADR 0005, decision 11), deleting sets it through the ORM, and publishing and unpublishing set the version's `updated_at` explicitly. So an acknowledgement from before a deletion cannot republish a restored journal ([§ 8](#8-deleted-and-restored-entries)). The stamp is a second layer: the content and the set are bound directly, and are the primary guarantee. Timestamps are not a trigger-maintained column (ADR 0003), and `now()` is the transaction's start time, not its commit time and not monotonic, so only *inequality* is ever compared. M2.1 must test that **every** command that saves, publishes, unpublishes, deletes, or restores moves the stamp, and a command that forgets fails that test. Unpublishing sets only the version's `updated_at`, which is enough because the target version's stamp is in the token. The address is not in the stamp: it is bound by the digest directly, and `changeEntrySlug` sets no `updated_at` today.

**What the token is and is not.** It binds a decision to a state; it is not a credential. Anyone who may call the command can compute a matching token, because the rule is public and the repository is intended to be public. That is deliberate. The control makes it impossible to publish *without* a decision about the current disclosed set, for any caller (ADR 0005 § 8), and impossible to publish a different set from the one decided. It does not try to stop an authorized author who deliberately scripts the acknowledgement, which no design can. Authorization is a separate check ([§ 10](#10-authorization)).

### 4. Publishing

`publishLanguageVersion(db, author, { entryId, locale, expectedVersion, acknowledgement })` runs in one transaction, in this order. The first failing step ends it with that failure, and **nothing is written** by a failed call:

1. Validate the input (Zod): the id, the locale, a positive integer version, and, **when a token is present**, its form: `v1.` plus 43 base64url characters. Anything else is `invalid_input`; the input is never echoed. An *absent* token is not an input error: it reaches step 7.
2. Lock the entry row (`FOR UPDATE`, § 7). `entry_not_found` for an unknown entry or a version that does not exist. The kind check belongs to the Journals wrapper, whose own lock admits only album journals (as `restoreAlbumJournal` does); the engine takes no kind.
3. Refuse a deleted entry: `entry_deleted`.
4. Refuse a stale editor: `entries.version` differs from `expectedVersion` → `version_conflict`.
5. Refuse a version with nothing to publish: `nothing_to_publish` (default rule: the version has a non-blank opening or body; see [Undecided](#undecided-questions)).
6. Refuse an entry without a current slug: `no_current_slug`.
7. Compute the disclosure and token **now**, in this transaction. A missing token is `acknowledgement_required`; a token that differs is `acknowledgement_mismatch`. Both carry the fresh disclosure and token, so the studio can show what changed and ask again. Nothing was written.
8. Only now write: status and `published_at`, `first_published_at` (set once, never overwritten), `entries.first_published_at`, `updated_at`, and the current slug's `was_published` mark, as today (ADR 0003).

Further semantics:

- **From Draft or Private**, steps 1 to 8 are identical. There is no shorter path.
- **An empty set is acknowledged too.** The token of a disclosure with no reflections is still required. This keeps one rule for every caller, and a later flag cannot be slipped in without it.
- **Already published and the token matches:** nothing changes (`published_at` is kept, as today) and the call reports `changed: false`. A mismatch is refused as above.
- **Publishing does not change a reflection's flag, text, or rating**, and creating or changing a translation never publishes it (ADR 0002, D3 and D5.2).
- **Unpublishing** (`unpublishLanguageVersion(db, author, …)`) moves a version to `draft` or `private`, clears `published_at`, and keeps the history, as today. It can only reduce exposure, so it needs no acknowledgement. The interface still asks first (Product, rule 1).

### 5. Changes after publication

A *change to a public item* is a write that makes an item of § 1 public with a content digest that was not public before: new, or different. Removing an item from the public surface is not one. The command that makes the write computes the **exposure delta** (the new or different public items) inside the same transaction.

- **No delta:** the write proceeds as today. Saving a draft, a private version, or a reflection that is not public never asks.
- **A delta and no valid confirmation:** the transaction is rolled back, nothing is written, and the call fails with `confirmation_required` (or `confirmation_mismatch` when a confirmation was supplied but does not match). The failure carries the delta and the confirmation token that would be accepted for exactly this input.
- **The confirmation token** is the digest of: `v1`, the entry id, `entries.version`, and the delta's items with their content digests. The caller sends the same input again with the token. The command recomputes it under the lock and applies the write only if it matches.

This one rule covers the owner's decisions:

| Change while its language version is public | Delta |
| --- | --- |
| Save the version's text (decision 4) | the version item (its new digest) |
| Add text in a language to a reflection that is already flagged and whose version in that language is public | the new reflection item |
| Flag a reflection (`is_published` on) (decision 3) | the reflection item |
| Change a public reflection's text, rating, favourite mark, or still-writing label | the reflection item |
| Create a reflection that is already flagged and has text, while its language is public | the reflection item |
| Set or change the album rating while any version is public (decision 5) | the rating item |
| Change a memory's remembered-when text or its music links while a version is public | the memory-details item |
| Change the address while a version is public | none for new writing: it exposes no writing, is an explicit author action with its own dialog and keeps the old address as a redirect (ADR 0002, D7.4 and D7.5) |
| Change a reflection that is not flagged, or whose language is not public | none |
| Unflag a reflection, clear the album rating, or clear text | none (a removal), but the interface asks first |

The case in the second row is the one ADR 0005 § 5 does not reach, because no version is being published: a reflection that was flagged earlier appears publicly as soon as its text exists in a language that is already public. ADR 0002 D5.2 makes it public by its own flag and the version's state; this ADR requires that the author sees it first.

Interface requirements (specified in [Design System](../design-system.md#writing-studio-controls-for-adr-0002); no new component):

- An editor showing a public version states it plainly and keeps showing it: "This version is published. Saving changes the public page."
- Save on a public version always opens the confirmation that names what will change publicly, and only the author's explicit answer sends the token. The text stays in the editor whatever happens (the editor's existing guarantee).
- There is **no autosave and no background save** of a public version. A request that carries a confirmation token is only ever sent from that dialog.

### 6. The version rule

**Every command that changes anything on the public surface bumps `entries.version` and checks the version it was given**, except commands that change only publication state (publish, unpublish, delete, restore), which are covered by the stamp, and the address, which the digest binds directly (§ 3). This extends the Revisit item of ADR 0005 (§ 3, "any future operation that changes text must preserve an equivalent version and concurrency check") to reflections, the album rating, flags, and translations, and it is what lets § 3 and § 5 rely on the version. A restore still does not bump it (ADR 0005, decision 9). A test lists the commands that write authored content and shows that each bumps the version, so a new command that does not is caught.

### 7. Transactions and lock order

- **L1. The entry row is the lock for everything the entry owns.** A transaction that reads in order to decide, or writes, any row owned by entry `E` (`entries`, `entry_texts`, the subtype row, `track_reflections` and their texts, `memory_music`, `entry_slugs` of `E`) first runs `SELECT … FROM entries WHERE id = E FOR UPDATE`. No command writes those rows without it, except the transaction that creates the entry, whose rows no other transaction can see before it commits. Reflection rows need no lock of their own.
- **L2. One entry per transaction.** A command never holds two entry locks. A future command that must touch two entries (moving the featured mark, boundary 5) takes the locks in ascending id order; this ADR adds no such command.
- **L3. Catalog locks come after the entry lock**, never before it. No command takes both today.
- **L4. The slug claim can wait but cannot cycle.** `ON CONFLICT` on `entry_slugs` waits for another transaction's uncommitted claim of the same slug. That transaction holds only its own entry lock and never waits for ours, so no cycle exists (L2).
- **L5. Preview takes no lock.** It reads one consistent snapshot (one statement or a read-only `REPEATABLE READ` transaction). Its staleness is harmless: the token is verified under the lock, so a flag flipped, a text saved, or a journal deleted between preview and publish makes the token fail.
- **L6. Check and write are one transaction, behind one lock.** Steps 2 to 8 of § 4 and the compare-and-write of § 5 run under the entry lock in one transaction. Every writer of the rows in L1 takes that lock first, so nothing can commit between the comparison and the write (ADR 0005 § 5.7). The default `READ COMMITTED` isolation is enough because writers are serialized, and a test removes the lock to show it matters.
- **Boundaries** (listed in [Data Model](../data-model.md#transaction-boundaries) as planned): 11, preview (read only); 12, publish; 3, extended by the confirmed save.

### 8. Deleted and restored entries

- A deleted entry is never public (the predicate), and no preview or publish is possible for it: `entry_deleted`. Address changes and unpublishing are refused as today.
- A restore is unchanged (ADR 0005): `published` returns as `private`, flags and history are kept, `entries.version` is not bumped, `updated_at` moves. Nothing is public afterwards.
- To make a restored journal public again the author must preview and publish, which discloses the effective set *as it is after the restore*, including every reflection flagged before. A token issued before the deletion fails on the stamp, and a token from before any edit fails on the digest.
- The restore dialog's promise ("nothing is published again until you choose to publish it") becomes exact for reflections once § 4 exists. M2.3 must verify its wording against the built flow.

### 9. There is no unchecked path

- The Publication module exports no function that makes a version `published` except the checked `publishLanguageVersion`. The current unchecked signature is **removed**, not wrapped. Tests that need a published version call preview and publish through a helper in `src/testing/`, which uses the same code.
- **One writer.** A static test fails if any file other than the Publication command writes `status = 'published'` to `entry_texts` (SQL text, Drizzle `set`/`values`, or a status variable) in production code. Migrations and `src/testing/` are the only places that may set it.
- **No application code obtains a token and submits it in the same call.** `previewPublication` is called only by the preview action. The publish wrapper and the publish action take the token only from the request body, which only the review dialog submits after the author has seen the disclosure. A failure's fresh token is shown to the author and is sent only by a new explicit action. No function calls both preview and publish, and none constructs a token. Without this rule a wrapper could preview and then publish in one request, which would be an unchecked path built from the checked one. A static test (on the syntax tree) enforces it, and the mutation "the wrapper previews, then publishes" must fail it. What the command itself can prove is that a decision about *this exact state* was submitted; that the decision was a human one is guaranteed by this rule and by browser test 17. A script that deliberately previews and publishes is outside application code ([Undecided](#undecided-questions), question 2).
- **The Journals module wraps; presentation never imports Publication.** A studio action calls a Journals wrapper that checks the entry's kind and calls the Publication engine, as `restoreAlbumJournal` does. `no-publishing.test.ts` keeps forbidding presentation from naming the Publication commands.
- **The database role and a trigger are not relied on yet.** A trigger that rejects a transition to `published` made outside the command would be a second lock. It would be a migration, so it is not part of this ADR ([Undecided](#undecided-questions)).

### 10. Authorization

- Every new command (`previewPublication`, `publishLanguageVersion`, `unpublishLanguageVersion`, the confirmed save, and the Journals wrappers) takes the `AuthorizedAuthor` as its second parameter. So do `changeEntrySlug` and `permanentlyDeleteEntry` when a studio screen first binds them (M2.4 for the second). The type is a compile-time signal (the commands do not inspect it), so it is not the control.
- Every new Server Action starts with an awaited `authorizeAuthor`, then runs through `perform` (the application's own `Origin`), then validates with Zod inside the command. A static test requires the first and the HTTP suite proves the rest. Preview is an action too: it returns private writing.
- A failure is a fixed code. The disclosure and delta that some failures carry go only to a request that passed authorization, are `no-store`, and are never logged. The token is never logged or echoed.
- Each action is added to the HTTP test's table, which fails if one is missing.

### 11. Public reads and caches

- **Only Publication queries.** Public routes read through `@/modules/publication`. Presentation already cannot import the database client (lint); a static test additionally requires that public routes import nothing from Journals, Catalog's studio functions, or Publication's commands. Every public query is built from `predicate.ts` and returns a projection without status, deletion state, or an unpublished language. A route never decides visibility itself.
- **New public queries are Publication's.** The queries M3 needs (listings, the sitemap, the album rating) are defined in the Publication module from the same fragments, not in a route. The album rating is public only through the "at least one version is public" rule in § 1, and a test shows it is absent otherwise.
- **An oracle test.** An independent TypeScript implementation of the predicate is compared with every public query over the whole state matrix (§ 13). A query that is wrong in any cell fails.
- **Initial public release: no shared cache.** Journal pages, listings, metadata, `sitemap`, `robots`, and every `308` and `404` from slug resolution are rendered per request and sent with `Cache-Control: no-store`. There is no static generation or incremental regeneration of journal data, no `use cache` of it, and no `generateStaticParams` for journal routes. A `308` is cacheable by default, so it carries `no-store` explicitly: a cached redirect would keep revealing the current address of an entry that has since been unpublished or deleted (INV-5), and a cached `404` would hide a newly published one. Nothing journal-related is rendered at build time; the build needs no database, which CI already proves.
- **How a route sends a real `308` or `404` with `no-store` is an open implementation question.** The studio's pattern (`cacheComponents`, data read behind `Suspense` after `connection()`) answers HTTP 200 with a prerendered shell and a streamed redirect ([Security § Deployment gate](../security.md#deployment-gate), item 2). Journal routes cannot use it as it stands: a streamed redirect is not a `308` (INV-5), a shell is not a per-request `404`, and a prerendered shell is not `no-store` per request. The address must be resolved, and the status and headers chosen, before any response byte is sent, for example in a route handler or before any `Suspense` boundary. **M3.1 starts with a spike** that proves, on the production build, real `308` and `404` statuses, `no-store` on `200`, `308`, and `404`, and no static shell or journal data in the build output. If it fails, this strategy is revisited before any public route ships.
- **What this guarantees, once the spike has passed:** there is no cache that can keep a stale page, so unpublishing, deleting, restoring, unflagging, rating changes, and address changes take effect on the next request. An HTTP test against the production build asserts the header on every public response class. That Next.js and the host honor the header and the statuses is verified by that test and again at deployment ([Security § Deployment gate](../security.md#deployment-gate)); it is not assumed.
- **Introducing any cache later needs its own ADR**, which defines the invalidation for every event in this section and the tests that show a stale page cannot be served. Nothing in M2 builds the invalidation, because nothing is cached.

### 12. Error codes and recovery

| Code | When | Writes | What the caller gets and the studio does |
| --- | --- | --- | --- |
| `invalid_input` | malformed id, locale, version, or token | none | field codes only; nothing echoed |
| `entry_not_found` | unknown entry, missing version, or wrong kind | none | not found |
| `entry_deleted` | the entry is in Recently deleted | none | "restore it first"; restoring never publishes |
| `version_conflict` | `expectedVersion` is stale | none | reload; the text stays in the editor |
| `nothing_to_publish` | the version has no content | none | write something first |
| `no_current_slug` | no current address | none | an invariant failure; reported, not retried |
| `acknowledgement_required` | no token | none | fresh disclosure and token; show the review dialog |
| `acknowledgement_mismatch` | the token no longer matches | none | fresh disclosure and token; show what changed and ask again |
| `confirmation_required` | a change to the public page without a token | none | the delta and token; show the confirmation |
| `confirmation_mismatch` | the confirmation no longer matches | none | the fresh delta and token; ask again |

Every failure leaves the database as it was (one transaction), and none loses the author's text: the editor keeps it. A failure is never retried automatically, and a token is never reused by the client after any failure. The existing codes (`entry_not_deleted`, `slug_taken`, `invalid_slug`, `invalid_status`, `unsupported_content`) are unchanged. The Publication engine's `version_not_found` reaches the Journals layer as `entry_not_found`, as it does today.

### 13. Required tests

All are required before the code they cover ships. A privacy rule is not tested through the interface alone: each is also tested at the command boundary. Test data is synthetic and labelled `[Test]`.

**PostgreSQL (real database).**

1. **Disclosure parity.** Over the full matrix of {entry deleted or not} × {each language: draft, private, published} × {flag} × {text present per language} × {album rating set or not} × {the other language already public or not}: the disclosure for `L` equals the pairs the public queries return for `L` after `L` is published, minus those returned before. No pair of another language ever appears.
2. **No publication without a matching token:** an absent token is `acknowledgement_required`, a malformed or empty-string one is `invalid_input`, and a well-formed wrong one is `acknowledgement_mismatch`; each leaves a row checksum of every table unchanged. An empty set still needs its token.
3. **Each invalidator separately** makes a previously valid token fail: a flag on and off; text added or removed in `L`; a reflection text, rating, favourite, or still-writing change; the album rating; a text save; the address; publishing and unpublishing `L`; delete and restore; a second use of the same token. Changes to another language's reflection do not alter `L`'s set. Save, publish, unpublish, delete, and restore each move the stamp; the address change is caught by the digest.
4. **ADR 0005 scenario:** flag a reflection, publish, delete, restore (private, nothing public), then publish without a token, with the token from before the deletion, and with a fresh token; only the last succeeds, and exactly the flagged set becomes public.
5. **Concurrency over real connections** (no sleeps; the entry lock held by a controlled transaction): publish against a flag flip, a text save, a rating change, a delete, a restore, an address change, and another publish; eight simultaneous publishes; a flag flipped between preview and publish; a catalog tracklist rewrite against a reflection insert; no `deadlock_detected` over repeated runs; only domain failures (no raw foreign-key error); every outcome is a state that was valid. The lock is removed once and the test must fail.
6. **Draft equals Private:** the same checks and the same refusals from both.
7. **Refusals:** deleted, wrong kind, missing locale, no slug, nothing to publish, stale version. Each writes nothing. A failing step in the middle of a publish (a trigger) rolls everything back.
8. **Post-publication changes:** every row of the § 5 table, with and without a token, with a stale token, and with a token for a different input. A refusal changes no row and not `entries.version`. A save of a non-public item never asks. `still-writing` never changes whether a reflection is public (INV-2).
9. **Version rule:** every command that writes authored content bumps `entries.version` or is listed as exempt.
10. **Translations (INV-3):** the disclosure, the public queries, `listPublicLanguageVersions`, and slug resolution never expose or mention an unpublished language, in every state combination.
11. **Preview** is authorized, read-only (a row checksum), and takes no lock.
12. **Oracle:** the independent predicate against every public query over the same matrix; the album rating is public only when some version is.
13. **One writer and no self-minted token:** the static scans of § 9, with probes showing they catch each form of the write and a function that calls both preview and publish.

**HTTP (the production build).**

14. Every new action, with no cookie, a forged cookie, a wrong signature, an expired and a revoked session, a non-author session, no `Origin`, a trailing-slash `Origin`, and a foreign `Origin`; malformed and oversized bodies; against a journal in a state where a call that got through would change the database. A checksum proves nothing was written, and no response contains SQL, a constraint name, a stack, the token, or the input.
15. The disclosure and delta appear only in responses to an authorized request, with `no-store`.
16. Public routes (M3): for every state of the matrix, a request for an unpublished, private, deleted, or unknown address returns the same status, the same body, and the same headers; a `308` appears only for the previous address of a public entry; `Cache-Control: no-store` is on every `200`, `308`, `404`, the metadata, the sitemap, and `robots`; a synthetic private marker never appears in any public response, including the sitemap and the language links.

**Browser (Playwright, desktop and 390 px, the disposable database).**

17. The publish dialog lists each reflection with its language, lets the author change the selection, and cannot be confirmed without acknowledgement; keyboard operation, visible focus, 44 px targets, reduced motion.
18. Two contexts: a flag flipped in one makes the other's dialog fail and show the change; the text stays in the editor.
19. A public version shows the persistent notice, Save opens the confirmation naming the change, and cancelling writes nothing.
20. Delete, restore, and the restored journal is private; publishing again shows the full set; the public page then shows exactly the disclosed set and nothing else.
21. Unpublish: the next request to the public address is the same `404` as an unknown one.

**Mutation checks** (each is made once by hand, must fail at least one test, and is recorded in the pull request that adds the code): compare the count instead of the set; omit the locale, the flag, the rating, the version, the stamp, or the address from the digest; accept a missing token; skip the comparison for Draft or for an empty set; remove the entry lock; compare before taking the lock; write before comparing; re-export the unchecked publish; make the wrapper preview and then publish; make preview write; skip the delta for the album rating or for a reflection's text; remove `no-store` from the `308`.

## How ADR 0005 § 5 is met

| § 5 | Requirement | Where it is met |
| --- | --- | --- |
| 1 | Determine the exact set, per language | § 2: pairs `(reflection, L)` with the flag and text in `L`, derived from the predicate fragments; test 1 |
| 2 | Disclose it, identifying each reflection and language | § 2 (each item identifies reflection, track, and language), [Design System](../design-system.md#per-track-publication) (the dialog lists them; conflict C6) |
| 3 | Let the author review or change selections | The dialog edits flags with the ordinary save, which bumps the version; a new preview follows, so the author always acknowledges what is then effective (§ 3, § 6) |
| 4 | Require explicit acknowledgement | § 3 and § 4: the command requires a token for this exact state, even for an empty set. That the acknowledgement is a human act is guaranteed by § 9 (no application code mints and submits its own token) and browser test 17; the command alone proves only that a decision about this state was submitted |
| 5 | Enforce it at the Publication command boundary | § 4 (inside the command) and § 9 (no other way to publish) |
| 6 | Reject missing, outdated, or mismatched acknowledgements | § 4 step 7 and § 12: `acknowledgement_required`, `acknowledgement_mismatch`; tests 2 and 3 |
| 7 | Check atomically with the visibility change | § 7, L6: one transaction under the entry lock; test 5 |
| 8 | Apply to every caller | Met for every caller that uses application code: § 4 (one path for Draft, Private, and an empty set) and § 9 (the unchecked signature is removed, one writer, static tests). **Not met for out-of-process writers** (a script with raw SQL, `psql`, a migration) until [question 2](#undecided-questions) is decided |
| 9 | Never expose a flagged reflection as an undisclosed side effect | § 2 (complete by construction), § 5 (the same rule after publication), § 8 (restored entries); tests 1, 4, and 8 |

## Conflicts and clarifications

No accepted text is edited. Where this ADR depends on an earlier statement, or reads one narrowly, it is listed here.

| # | Existing text | This ADR |
| --- | --- | --- |
| C1 | ADR 0005, decision 9: a restore does not bump `entries.version`. | Kept. The version alone cannot invalidate an acknowledgement across a delete and a restore, so the **state stamp** does it (§ 3). Bumping the version on restore, or on publish, is not proposed: it would conflict an open editor. |
| C2 | ADR 0005 § 5.1 defines the set as `is_published` and text in the language. | Kept and implemented exactly. The album rating and the address are **added** to the disclosure; nothing is removed. |
| C3 | ADR 0005 § 5 covers publishing and republishing. | Kept. The case where a flagged reflection becomes public because text is added to an already public language (§ 5) is outside its letter and inside its purpose; it is handled by § 5 here, as a stricter rule, not a different one. |
| C4 | ADR 0002 D5.3: favourite, track rating, still-writing, and the album rating are independent of each other. | Kept. The album rating is public with the journal and is not derived from another value. If the owner reads D5.3 as also requiring an independent publication switch for the album rating, that needs a flag and a migration ([Undecided](#undecided-questions)). |
| C5 | [Security § Publication predicate](../security.md#publication-predicate) does not mention the album rating. | Extended there by one line (§ 1 here), in the same change. No query exposes the rating today. |
| C6 | [Design System § Per-track publication](../design-system.md#per-track-publication): the dialog states a count ("4 of 10 track reflections are set to show"). | A count does not satisfy ADR 0005 § 5.2 and 5.3, which require identifying each reflection and language and letting the author review them. The design-system text is updated in this change to require the list. |
| C7 | Product, rule 2: "Saving is not publishing"; saving never changes visibility. | Still true: a save never changes any status. It can change the *content* of a public version, and then only after confirmation (decision 4). |
| C8 | [Security § Planned](../security.md#implemented-and-planned-protections): the publication commands take no `AuthorizedAuthor` until bound. | They take it when this is built (§ 10). |
| C9 | `no-publishing.test.ts` forbids presentation from reaching the Publication commands. | It stays. The Journals wrapper is the way in, so the guard is not relaxed, only extended to the new names. |
| C11 | [Roadmap § Catalog edit concurrency](../roadmap.md#catalog-edit-concurrency-last-write-wins): catalog edits are last-write-wins and take no entry lock. | Kept. Catalog metadata (titles, credits, tracklist order) changes how a public page is labelled, not what writing is exposed, so it is not digested and needs no confirmation. A test covers a catalog rewrite racing a reflection insert (§ 13, test 5). |
| C10 | ADR 0003 § 4: the transitions are `publishLanguageVersion` and `unpublishLanguageVersion`. | The names stay; the signature of the first changes (§ 4). That is an implementation detail of an accepted decision, not a change to it. |

## Alternatives considered

- **A stored acknowledgement (a table or a column).** Rejected by owner decision 1, and unnecessary: every input to the check is recomputable from the locked rows. Revisit only if the stamp proves unreliable.
- **An explicit list of pairs instead of a digest.** Simpler to read, but it cannot also bind the content, the rating, the address, and the state without a larger structure, and it needs a different mechanism for § 5. The studio still shows the list; the digest is what the command compares.
- **A keyed token (HMAC) with an expiry.** It adds a secret, its rotation, and a clock to the failure modes, and gives no protection against an authorized caller, who can always ask for a preview. It also does not tie the token to a lifecycle change, which the stamp does.
- **Bumping `entries.version` on publication, deletion, and restore.** The simplest invalidation, rejected because ADR 0005 decided otherwise for restore, and because publishing would otherwise make an open editor conflict with its own journal.
- **A boolean "I confirm" flag.** Rejected: it does not bind to what was shown, so a change between the refusal and the retry would be accepted (a time-of-check gap).
- **Requiring a confirmation for every save of a public version, even with no change to the surface.** Rejected: it makes the confirmation routine and therefore meaningless. The delta asks only when the page changes.
- **A database trigger as the second lock.** Not adopted here: it needs a migration and a design of its own ([Undecided](#undecided-questions)).

## Consequences

**Positive**

- No caller can publish without a decision about the exact set that will become public, and the set cannot change between the decision and the publication.
- A restored or reopened journal cannot go public through an old acknowledgement, and no reflection, rating, or address is exposed as a side effect.
- No migration, no table, no secret, no new dependency. The acknowledgement is one function that the tests can attack.
- The initial public release has no cache to go stale.

**Negative and costs**

- The unchecked publish signature disappears. About forty test call sites (`src/modules/publication`, `journals`, and the restore tests) change to a helper.
- Any save, in any language, invalidates every outstanding preview of the entry, because the version is per entry. That is conservative and cheap: the author previews again.
- A save of a public version takes two round trips when it changes the page.
- The album rating is public whenever the journal is public and a rating exists. An author who wants a rating kept private on a public journal has to clear it until a flag exists.
- Out-of-process writers (a script, `psql`, a migration) can still set a status; only application code is bound until the trigger question is decided.
- The stamp depends on `updated_at` being set by every command that changes these rows. The tests enforce that, but it is a convention (ADR 0003).
- The disclosure and delta computations add reads to the publish and save paths. They are bounded by one entry's rows.
- Per-request rendering with `no-store` gives up CDN caching for the first public release. For a single author's journal that is acceptable, and caching can return behind an ADR.

## Undecided questions

These are the open points. Each has a stated default, which the implementation follows unless the owner decides otherwise.

1. **What counts as publishable.** Default: the version has a non-blank opening or body (memories also need their title, as Zod already requires). An album journal with only track reflections and no essay would then need an opening sentence. The alternative is to count a non-empty disclosed reflection.
2. **A database trigger as a second lock** against any writer that bypasses the command (a script, a future tool, a migration). Default: not now, which leaves out-of-process writers unconstrained (mapping row 8). Recommended before any hosted deployment; it needs `/refrain-db-change`.
3. **A separate publication switch for the album rating** (an additive `album_journals` column). Default: not now. The rating is disclosed and confirmed with the journal.
4. **Whether unflagging a public reflection needs a command-level confirmation.** Default: no, because it reduces exposure; the interface asks first, as Product rule 1 requires for unpublishing.
5. **How public routes send real `308` and `404` responses with `no-store` under Cache Components** (§ 11). Default: resolve the address before any streamed output; the M3.1 spike decides, before any public route ships.

## Revisit when

- any cache of public pages is proposed (a new ADR is required, § 11);
- a second caller of the publishing command appears (a bulk operation, a script, an API): it uses the same function;
- translations, memories, or artist journals get studio screens: each needs a wrapper and the version rule;
- `updated_at` stops being set by a command that changes these rows, or the stamp is found unreliable;
- the repository is prepared for a hosted deployment (undecided questions 2 and 3).
