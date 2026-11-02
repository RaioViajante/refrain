# ADR 0006: Publication Decision and Acknowledgement

- **Status:** **Accepted** by the project owner on 2026-11-01 (issue #25, pull request #26). Acceptance makes this design binding on later work. **It does not mean any of it exists:** no command, token, scan, switch, gate evidence, or test described here is implemented, and nothing in the repository may claim otherwise until the milestone that builds it has merged ([Deferred implementation obligations](#deferred-implementation-obligations)).
- **Date:** 2026-11-01. Proposed and revised the same day after the owner's reviews, and accepted by the owner the same day. Amended 2026-11-02 ([A1](#amendments)).
- **Scope:** What it means to publish, republish, and change a journal that is public; how the author's decision is represented, authenticated, validated, and bound to what the reader will see; how that holds under concurrency, deletion, restoration, and translations; how public reads and caches stay inside the publication predicate; and the gates that block the first hosted public page. It **implements** [ADR 0005 § 5](0005-restoring-deleted-journals.md#5-required-condition-for-the-m2-publishing-interface), which it does not weaken, and extends it to the album rating and to changes made after publication. It changes no accepted ADR: [conflicts and clarifications](#conflicts-and-clarifications) lists every place where existing text needed care.

## Context

What exists (checked in the repository at `894aacd`):

- The schema is complete. Visibility is per language version (`entry_texts.status`, with `published_at` and `first_published_at`), a reflection has its own `is_published`, and an album journal has a `rating_half_steps`. No migration is needed for anything below.
- `publishLanguageVersion(db, entryId, locale)` takes no author, no version, no confirmation, and does not check that there is anything to publish. It is exported from the Publication module and tested. No studio code can reach it (`no-publishing.test.ts`), so nothing is exposed today.
- `saveAlbumJournal` has no status check. It would change the text of a *published* version at once.
- No command writes a track reflection, a translation, or an album rating. Public queries exist and are tested, but no route calls them.
- The Identity module already owns a validated server secret (`BETTER_AUTH_SECRET`, at least 32 characters, fail-closed: a configuration failure denies every studio request).
- ADR 0005 § 5 requires the M2 publishing system to disclose, and have the author acknowledge, the exact set of reflections that publication would make public, and to enforce that at the Publication command boundary, atomically, for every caller. It fixes no signature.

The owner's decisions for this ADR:

1. Confirmations are stateless where feasible, with no new persistence table unless proven necessary.
2. Publication is explicitly authorized and bound to the current entry version, locale, and effective disclosure set.
3. Changing a reflection's visible text or publication flag while its parent language version is public must not expose additional content without explicit confirmation.
4. Editing already published text is allowed, but the interface discloses that saving changes the public page and requires explicit confirmation.
5. The album rating is covered by explicit publication disclosure, using the existing schema.
6. Publishing directly from Draft is allowed, with exactly the validation and confirmation of publishing from Private.
7. Author-written EN/PT-BR translations stay on the roadmap and do not block the first English public-page demonstration.

Decisions from the owner's review of the first draft (PR #26):

- **R1.** A version is publishable when its opening sentence **or** its body contains non-whitespace content.
- **R2.** No database trigger is introduced in M2.0. Before any hosted public exposure, the out-of-process database writers are reviewed explicitly and the necessary database-layer controls are decided ([§ 14](#14-public-page-release-gates)).
- **R3.** The album rating becomes visible with its published journal and is disclosed in the publication confirmation. There is no separate rating switch for now.
- **R4.** Unpublishing or unflagging a reflection needs no command-level confirmation, provided it strictly reduces public exposure.
- **R5.** Translations do not block the first English public-page demonstration.
- **A.** The confirmation must be a server-authenticated token (a MAC under a server-only key), not an unkeyed digest, and must not be described as proof of the author's acknowledgement.
- **B.** Any actual textual edit to an already published language version needs explicit confirmation before the changed content becomes public, even if the replacement is shorter.
- **C.** The gates before the first hosted public page are defined, and an unresolved gate **blocks** deployment.

Decisions at acceptance (PR #26, final owner review):

- **D1.** The confirmation key is a purpose-separated HKDF key derived from the existing `BETTER_AUTH_SECRET`. No separate secret is introduced unless implementation evidence later requires it.
- **D2.** Confirmation tokens expire after 15 minutes, measured with the database clock. An expired token requires a new preview and a new explicit acknowledgement.
- **D3.** Restoring a database backup fails closed: never directly into a database serving public content, and public reads stay disabled until the checks of gate G3 pass. The detailed procedure belongs to G3.
- **D4.** Public reads are protected by a server-only, default-disabled switch, `REFRAIN_PUBLIC_READS_ENABLED`, covering every public content-serving surface. It is defense in depth and never replaces the publication predicate. Its implementation is an M3.1 deliverable.
- **D5.** Catalog edits that change public-facing wording remain a documented gap (C11). It must be resolved, or an independently verified safe alternative recorded, before the first hosted public exposure (gate G8).

## Decision

### 1. Three operations, and one definition of "what the reader will see"

- **Preview** (`previewPublication`) reads the *disclosure* for one language version of one entry and returns it with a *confirmation token*. It writes nothing and holds no lock.
- **Publish** (`publishLanguageVersion`) makes that version public if, under the entry lock, the token is authentic, current, and still matches the disclosure computed *then*. It is the only way to make a version `published` ([§ 9](#9-there-is-no-unchecked-path)).
- **Confirmed save** is a save that changes the public page of a journal that is public. `previewPublicChange` shows the author the exact change and returns a token; the save is applied only with a matching token ([§ 5](#5-changes-after-publication)).

All three use one function that describes the **public surface** of an entry, derived from the same SQL fragments as the [publication predicate](../security.md#publication-predicate) ([`predicate.ts`](../../src/modules/publication/predicate.ts)), never from a second copy of the rules. The public surface contains these *items*, each made of *atoms*, the individual values a reader can see:

| Item | Public when | Atoms |
| --- | --- | --- |
| **Version** `(locale)` | the entry is not deleted and that version's status is `published` | title, opening, margin note, and body (the canonical `jsonb` text, not only `body_text`, so a formatting-only edit is caught) |
| **Address** | at least one version is public | the current slug |
| **Album rating** (album journals) | at least one version is public (the rating belongs to the journal, not to a language) | the value |
| **Memory details** (memories) | at least one version is public | the remembered-when text; each music link (track or album id); the order of the links |
| **Reflection** `(track reflection, locale)` | its `is_published` is set, it has text in that locale, and that locale's version is public | text, favourite mark, rating, still-writing label |

"Has text in that locale" means a `track_reflection_texts` row exists for it, as the predicate already requires. Writers must not leave a row for an empty text (an M2.2 rule, tested), so a row means text.

### 2. The disclosure

`previewPublication(db, author, { entryId, locale })` returns, for the target locale `L`:

- the entry, its kind, `L`, `entries.version`, and the version's current status (`draft`, `private`, or `published`);
- the **address** that will be public (the current slug) and whether it was ever public;
- the **album rating** when the entry is an album journal and one is set. It is always listed, and marked `alreadyPublic` when another language version is already public;
- the **reflection set**: every pair `(track reflection, L)` that will be public once `L` is: `is_published` set and text in `L`. Each item identifies the reflection, the track, and its language, and carries its favourite mark, rating, and still-writing label as they will appear. Items are ordered by track reflection id.

Rules:

- **Per language, and only that language.** The disclosure for `L` never contains a pair of another language. The studio is private, so it may say that the rating is already public through another version (`alreadyPublic`) and may show other versions' states, read-only, as the design specifies. Nothing public ever mentions an unpublished language (INV-3; § 13, test 11).
- **Complete by construction.** It is derived from the predicate fragments for the hypothetical state "`L` is published", so it cannot disagree with what the public queries will return. Today [`predicate.ts`](../../src/modules/publication/predicate.ts) hard-codes `status = 'published'`, so M2.1 parameterizes the fragments (the live public queries pass `'published'`). That edits a security-critical file, so it is its own commit with its own review, and the parity test (§ 13, test 2) is the guard.
- **Informational lines are not part of the set.** Reflections that are flagged but have no text in `L` are not public in `L` (they may be public in another language that is published), and appear only as a count the studio may show. Catalog metadata (track and album titles) is displayed but is not part of the fingerprint: a catalog edit changes how something is labelled, not what writing is exposed. That is the documented gap C11: it is closed by gate G8, not accepted as harmless.
- **The author can review and change the set** (ADR 0005 § 5.3). The dialog lists each disclosed reflection with its language. Unflagging a row is the ordinary save: a removal (§ 5) that takes effect at once and bumps `entries.version`, after which the dialog asks for a new preview. The author confirms only the set as it then stands. *(Amended by [A1](#amendments): the change is made in the track editor, not in the dialog; everything else here holds.)*
- **The same disclosure for Draft and Private.** The status being left is shown, and changes nothing else (owner decision 6).
- **Other kinds.** Memories and artist journals have no reflections and no rating, and go through the same operation. A memory's disclosure adds its remembered-when text and its ordered music links; an artist journal's has only the version and the address (the related writing its page will list, per [Product](../product.md), is a planned M3 query that must use the predicate; it is not built). A kind that gains a public field adds it to the table in § 1 before its studio screen ships.

### 3. The confirmation token

Three different things are easy to confuse. This ADR keeps them apart.

| | What it is | What it proves | What it does not prove |
| --- | --- | --- | --- |
| **State fingerprint** | An unkeyed SHA-256 of the canonical disclosure (below) | That two states are the same or different. Anyone can compute it; it is used to compare states, to show the author what changed, and inside the token | Who produced it, or that anyone saw anything |
| **Confirmation token** | Authenticated claims (a MAC under a server-only key) that include the fingerprint | That **this server** issued **to this authorized author's session**, for **this operation** and within a bounded time, a token for a disclosure it computed from **this exact state**. The server knows nothing about what was displayed | That the author read it or chose to proceed |
| **Explicit acknowledgement** | The author's act in the interface: opening the dialog, reading the disclosure, pressing the confirm control | Nothing on the server: it is an interface fact | It cannot be proved by the server. It is ensured by procedure: § 9 and § 5 (the token reaches only the dialog and leaves only from its confirm control), no autosave, no mint-and-consume, and browser tests 18 to 21 |

The token is therefore **evidence of a server-issued disclosure, never proof of acknowledgement**. Nothing in this ADR, the code, or the interface may describe it as proof that the author acknowledged anything.

**The explicit acknowledgement is mandatory.** Publishing, republishing, and any change to the public page of a published journal may complete only as the result of the author's explicit act in the interface, after the disclosure was shown to them: opening the dialog, reading the disclosure, and pressing its confirm control. The token is necessary and not sufficient. No script, wrapper, background process, retry, autosave, or default may supply that act. An invalid, expired, or stale token requires a new preview and a new explicit acknowledgement, never an automatic one. A caller that cannot show the disclosure to the author and obtain this act (a bulk operation, an API, a script) cannot publish until its own ADR says how it obtains it.

**The fingerprint** is the base64url SHA-256 of the canonical JSON (keys sorted, UTF-8, arrays in the order of § 2) of: the entry id, the operation, the locale `L`, `entries.version`, every atom of the disclosure (§ 1) with its value, and the **state stamp**: `entries.updated_at`, the target version's `updated_at`, and the target version's status, each read as UTC text with microseconds (`to_char(x AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`, so the connection's `TimeZone` setting cannot change the value, and never a JavaScript `Date`, which loses microseconds). The address is an atom, so it is bound directly. For a confirmed save the fingerprint is the canonical JSON of the entry, the operation, `entries.version`, the stamp (the status and `updated_at` of each version in the delta, and `entries.updated_at`), and the exposure delta of § 5 as atoms with their old and new values. A different input with the same delta validates; that is harmless, because what is bound is what becomes public, and a removal bundled into the same save only reduces exposure.

**The token** is `ct1.` followed by the base64url of a JSON object with these claims, a dot, and the base64url of the MAC of everything before that dot:

| Claim | Value |
| --- | --- |
| `p` | the purpose: `publish` or `change_public`; a token is accepted only for the operation it names |
| `u`, `s` | the authorized author's `userId` and `sessionId`: signing out, or another session, invalidates it |
| `e`, `l`, `n` | the entry id, the locale `L` (a `publish` token only; a `change_public` token has no `l`, and every locale it touches is inside the fingerprint), and `entries.version` |
| `f` | the state fingerprint |
| `i`, `x` | the issue time and the expiry, read with `clock_timestamp()` on the **database** (one clock for every instance, so no skew; never `now()`, which is the transaction's start time), `x − i` = 15 minutes, a constant (§ 3, Expiry) |

The MAC is HMAC-SHA-256 under a key derived by HKDF-SHA-256 from the application secret with a fixed purpose string (`refrain/confirmation-token/ct1`), both from Node's built-in `crypto`: no dependency. The key is used for nothing else, so a session cookie cannot be passed off as a token or the reverse.

**Revalidation.** The consuming command checks, in this order, and a failure at any step writes nothing (§ 12):

1. The form (Zod): `ct1.` prefix, two base64url parts, at most 1024 characters. A token that is present but not of this form is `invalid_input`. An *absent* token is not an input error; it is `confirmation_required` (§ 4, step 8).
2. The key is available (the configuration is valid). Otherwise the call fails closed as `unavailable`, exactly as a studio request does when the configuration is invalid. There is no fallback to an unkeyed check.
3. The MAC is valid (constant-time comparison), the version is `ct1`, the purpose is the operation being called, `u` and `s` equal the current `AuthorizedAuthor`, and `e`, `n` (and `l`, for `publish`) equal the request's entry, `expectedVersion`, and locale. Otherwise `confirmation_invalid`, which returns nothing.
4. *(Under the entry lock, after the deleted and version checks.)* `i` ≤ now < `x`, with now read as `clock_timestamp()` on the database after the lock was granted (not the transaction's start time, which a long lock wait would make stale). Otherwise `confirmation_expired`.
5. The fingerprint is recomputed from the locked rows and equals `f`. Otherwise `confirmation_stale`.

**Expiry (D2).** The validity is 15 minutes, a constant in code and not configurable, measured on the database clock (`clock_timestamp()`), so every instance agrees. An expired token is `confirmation_expired`: the studio shows the fresh disclosure and the author must request a new preview and acknowledge it again.

Nothing is stored. A token cannot be replayed across a change: any save, publication, unpublication, deletion, or restoration moves the stamp or the version, so the fingerprint no longer matches. A token is consumed by any operation that changes the state it describes; repeating a publish of an already public version with an unchanged disclosure is a no-op that leaves the token valid until it expires. A restore sets `entries.updated_at` (ADR 0005, decision 11), deleting sets it through the ORM, and publishing and unpublishing set the version's `updated_at` explicitly, so a token from before a deletion cannot republish a restored journal ([§ 8](#8-deleted-and-restored-entries)). The stamp is a second layer: the atoms and the version are bound directly and are the primary guarantee. Timestamps are not trigger-maintained (ADR 0003), and `now()` is the transaction's start time and not monotonic, so only *inequality* is ever compared. M2.1 must test that **every** command that saves, publishes, unpublishes, deletes, or restores moves the stamp, and a command that forgets fails that test. Unpublishing sets only the version's `updated_at`, which is enough because the target version's stamp is in the fingerprint. `changeEntrySlug` sets no `updated_at` today; the address is bound as an atom instead.

**Where tokens come from.** Only the two preview operations mint tokens. A refusal (`confirmation_required`, `confirmation_expired`, `confirmation_stale`) returns the fresh disclosure or delta and **no token**, so the code that receives a refusal has nothing to retry with: it has to ask for a new preview, which is a separate request that shows the author the new state. Tokens are never logged and never echoed.

**Key management (D1).**

- **Derivation.** HKDF (RFC 5869) with SHA-256. The input keying material is the value of `BETTER_AUTH_SECRET` as the Identity module has validated it (UTF-8 bytes). The salt is omitted (the RFC's zero-filled default; the input is a random secret, so a salt adds nothing). The `info` string is the fixed ASCII text `refrain/confirmation-token/ct1`, and the output is 32 bytes. The MAC is HMAC-SHA-256, compared with `timingSafeEqual`. All of it is in Node's built-in `crypto`: no dependency. The Identity module exposes two functions, to sign and to verify claims for a named purpose, so that no other module reads the secret or holds key bytes.
- **Cryptographic domain separation.** HKDF with a distinct `info` string yields a key that is independent of the raw secret and of any key derived with another `info`. Better Auth's use of the secret for session cookies (ADR 0004) is therefore a different key: a cookie signature cannot be a valid token MAC, and a token MAC cannot be a valid cookie signature. The MAC input also begins with the fixed `ct1.` prefix and the purpose claim, so a `publish` token is not a `change_public` token. The `info` string is fixed in code; **a new use of the secret gets a new `info` string and its own test, and an `info` string is never reused.**
- **Required entropy.** HKDF adds no entropy: a token is exactly as hard to forge as the secret is to guess. The existing validation (at least 32 characters and at least 12 distinct characters) is a rough floor, not a measurement. The deployed secret must be generated randomly with at least 256 bits (`openssl rand -base64 32`, as [Development](../development.md#authentication) already documents), and gate G5 records how it was generated. A memorable phrase would make sessions and tokens guessable alike, and no derivation repairs that. M2.1 does not weaken the validation and may tighten it.
- **Rotation effects.** Replacing the secret already signs the author out (ADR 0004). It also invalidates every outstanding confirmation token, so a dialog that is open fails as `confirmation_invalid` and asks for a new preview. That costs nothing: a token lives 15 minutes and no stored data depends on the key, so losing the key loses no writing. The same secret must be set on every instance; there is no overlap of two keys (the configuration refuses `BETTER_AUTH_SECRETS`), so a rolling rotation can refuse some requests and nothing else.
- **No separate secret.** None is introduced unless implementation evidence later requires it, for example a need to rotate the two uses independently, or evidence that sharing the secret is unsafe. That would be recorded in a new ADR.
- **Exposure.** The key never leaves the server process, is never logged, and is never in a client bundle (`server-only`, as the Identity module is). A test asserts that a missing or short secret fails closed and that no log line or response contains the token, the key, or the secret.
- **Compromise.** Whoever holds the secret can already forge session cookies, so the token adds no new class of exposure. A compromised server can mint tokens; this control does not defend against that, and does not claim to.
- **A hijacked session.** A client that holds the author's session (a stolen cookie, a malicious script in the author's browser) can call the preview and then the publish as two ordinary requests. The token does not prevent that and cannot: it binds a publication to a state, a session, and a time, not to a human act. Session, origin, and cookie controls (ADR 0004, [Security § Authentication and sessions](../security.md#authentication-and-sessions)) are what protect against it.
- **Same-process limit.** The key lives in the same process as the application, so code that can call the signing function can mint a token. The defense is structural and enforced by tests: only the two preview operations call it, nothing consumes a token it just minted (§ 9), and refusals carry none. It is not a cryptographic guarantee against code inside the application, and the ADR does not present it as one.
- **Agility.** The `ct1` version is part of the token. A new version is added beside the old and the old is rejected, never silently accepted.

### 4. Publishing

`publishLanguageVersion(db, author, { entryId, locale, expectedVersion, confirmation })` runs in one transaction, in this order. The first failing step ends it with that failure, and **nothing is written** by a failed call:

1. Validate the input (Zod): the id, the locale, a positive integer version, and, **when a token is present**, its form (§ 3, step 1). The input is never echoed.
2. Check the key and the token's authenticity, purpose, actor, and request binding (§ 3, steps 2 and 3): `unavailable`, `confirmation_invalid`. Steps 1 and 2 are pure computations: the Journals wrapper runs them **before it opens its transaction and locks the entry**, so a forged token never holds the lock, and the engine repeats them under the lock. The confirmed save does the same.
3. Lock the entry row (`FOR UPDATE`, § 7). `entry_not_found` for an unknown entry or a version that does not exist. The kind check belongs to the Journals wrapper, whose own lock admits only album journals (as `restoreAlbumJournal` does); the engine takes no kind.
4. Refuse a deleted entry: `entry_deleted`.
5. Refuse a stale editor: `entries.version` differs from `expectedVersion` → `version_conflict`.
6. Refuse a version with nothing to publish: `nothing_to_publish`. A version is publishable when its opening sentence **or** its body contains non-whitespace content (owner decision R1). It is evaluated on the opening sentence and on `body_text` after the same normalization the save applies; Unicode white space only is empty, for a version and for a reflection's text alike. Memories will also need their title, which their Zod schema will require when they get a studio screen.
7. Refuse an entry without a current slug: `no_current_slug`.
8. Compute the disclosure and fingerprint **now**, in this transaction. A missing token is `confirmation_required`. An expired token (§ 3, step 4) is `confirmation_expired`. A fingerprint that differs (§ 3, step 5) is `confirmation_stale`. Each of these three returns the fresh disclosure and no token; nothing was written.
9. Only now write: status and `published_at`, `first_published_at` (set once, never overwritten), `entries.first_published_at`, `updated_at`, and the current slug's `was_published` mark, as today (ADR 0003).

Further semantics:

- **From Draft or Private**, steps 1 to 9 are identical. There is no shorter path.
- **An empty set is confirmed too.** The token of a disclosure with no reflections is still required. This keeps one rule for every caller, and a later flag cannot be slipped in without it.
- **Already published and the token matches:** no row is written (today's code rewrites `updated_at` on an already published version; M2.1 must skip that, or the token would die on a no-op) and the call reports `changed: false`. A mismatch is refused as above.
- **Publishing does not change a reflection's flag, text, or rating**, and creating or changing a translation never publishes it (ADR 0002, D3 and D5.2).
- **Unpublishing** (`unpublishLanguageVersion(db, author, …)`) moves a version to `draft` or `private`, clears `published_at`, and keeps the history, as today. It can only reduce exposure, so it needs no token (owner decision R4). The interface still asks first (Product, rule 1).

### 5. Changes after publication

Every atom of § 1 is either public or not at a given moment. Comparing the public atoms before a write with the public atoms after it classifies the write:

- **Addition.** An atom is public after the write and was not public before: a reflection flagged, text added in a language that is public, a rating set, a link added. This is a **change to the public page**.
- **Edit.** An atom is public before and after with a different value. This is a **change to the public page** whatever the direction: a longer text, a **shorter** one, a different rating, a reordered list. Any difference in the canonical stored text counts, including whitespace and formatting. A save whose canonical text is identical to the stored text changes nothing and asks nothing. For the version's own text fields (title, opening, margin note, body), **clearing a field is an edit** too (owner decision B).
- **Removal.** An atom was public before and is not public after, and it is not one of the version's own text fields: a reflection unflagged or its text deleted in a language, the rating cleared, remembered-when cleared, a link removed, a version unpublished. A removal strictly reduces what the public sees and is **not** a change to the public page (owner decisions B and R4). A test proves "strictly": for every removal command, the public atoms after are a subset of the public atoms before, with unchanged values. A music link is the atom (link id, relative rank), so removing a link from the middle and renumbering the positions is still a subset. The test uses an independent `publicAtoms(state)` function in `src/testing/`, the same one the oracle (test 13) uses.
- **Mixed.** A write that contains any addition or edit is a change to the public page, whatever else it removes.
- **Address.** Changing the address is exempt, for the reason in the table below.
- A public version must stay publishable (§ 4, step 6): a save that would leave both its opening and its body without non-whitespace content is refused as `nothing_to_publish`. To blank a public version the author unpublishes it first.

The **exposure delta** is the set of atoms added or edited. The flow has two steps, so a token is minted by one request and consumed by another:

1. **`previewPublicChange(db, author, input)`** takes the same input as the save and applies the same pre-checks and refusals as the save (`entry_deleted`, `version_conflict` against `expectedVersion`, `nothing_to_publish`), so it never mints a token for a request the save would refuse. It computes the delta from the current rows and the proposed values **without writing** and without a lock. If the delta is empty it says so and returns no token; the author saves without a dialog. Otherwise it returns the delta and a `change_public` token whose fingerprint covers the delta with its new values.
2. **The save** takes the same input, plus the token if there is a delta. Under the entry lock it recomputes the delta from the locked rows. No delta: the write proceeds, and a token that was supplied is ignored unread. A delta and no token: `confirmation_required`, nothing written, the delta returned, no token. A token that is invalid, expired, or stale: refused as in § 3, nothing written. A valid token: the write is applied and `entries.version` is bumped, which also kills the token.

| Change while its language version is public | Classification |
| --- | --- |
| Save the version's text, longer or shorter (owner decision B) | edit of the version's text atoms |
| Clear one field of the version's text (the opening, say) | edit |
| Add text in a language to a reflection that is already flagged and whose version in that language is public | addition |
| Create a reflection that is already flagged and has text, while its language is public | addition |
| Flag a reflection (`is_published` on) (decision 3) | addition |
| Change a public reflection's text (shorter or longer), rating, favourite mark, or still-writing label | edit |
| Set the album rating while any version is public (decision 5) | addition |
| Change the album rating to a different value | edit |
| Change a memory's remembered-when text, add a music link, or reorder the links | addition or edit |
| Change the address while a version is public | **exempt.** It exposes no writing of the entry and keeps the old address as a redirect (ADR 0002, D7.4 and D7.5). It is always an explicit author action: [Design System](../design-system.md#changes-to-a-published-version) requires that changing the address asks, naming the new address and that the old one will redirect. The new address is bound into the publication fingerprint, not here |
| Feature or unfeature a journal | none. Featuring chooses among journals that are already public and never exposes unpublished writing (ADR 0002, D1.2 and INV-1) |
| Change a reflection that is not flagged, or whose language is not public | none: it is not public |
| Unflag a reflection, delete a reflection's text in a language, clear the rating, clear remembered-when, remove a music link | removal, no command-level confirmation; the interface asks first |
| Unpublish a version | removal (§ 4) |

The second row of additions is the case ADR 0005 § 5 does not reach, because no version is being published: a reflection that was flagged earlier appears publicly as soon as its text exists in a language that is already public. ADR 0002 D5.2 makes it public by its own flag and the version's state; this ADR requires that the author sees it first.

Interface requirements (specified in [Design System](../design-system.md#writing-studio-controls-for-adr-0002); no new component):

- An editor showing a public version states it plainly and keeps showing it: "This version is published. Saving changes the public page."
- Save on a public version asks the preview first. When there is a delta the confirmation names what will change publicly, and only the author's explicit control sends the token. The token exists only in the dialog's state and leaves only from its confirm control. The text stays in the editor whatever happens (the editor's existing guarantee).
- There is **no autosave and no background save** of a public version, and nothing else sends a request that carries a token.

### 6. The version rule

**Every command that changes anything on the public surface bumps `entries.version` and checks the version it was given**, except commands that change only publication state (publish, unpublish, delete, restore), which are covered by the stamp, and the address, which the fingerprint binds as an atom (§ 3). This extends the Revisit item of ADR 0005 (§ 3, "any future operation that changes text must preserve an equivalent version and concurrency check") to reflections, the album rating, flags, and translations, and it is what lets § 3 and § 5 rely on the version. A restore still does not bump it (ADR 0005, decision 9). A test lists the commands that write authored content and shows that each bumps the version, so a new command that does not is caught.

### 7. Transactions and lock order

- **L1. The entry row is the lock for everything the entry owns.** A transaction that reads in order to decide, or writes, any row owned by entry `E` (`entries`, `entry_texts`, the subtype row, `track_reflections` and their texts, `memory_music`, `entry_slugs` of `E`) first runs `SELECT … FROM entries WHERE id = E FOR UPDATE`. No command writes those rows without it, except the transaction that creates the entry, whose rows no other transaction can see before it commits. Reflection rows need no lock of their own.
- **L2. One entry per transaction.** A command never holds two entry locks. A future command that must touch two entries (moving the featured mark, boundary 5) takes the locks in ascending id order; this ADR adds no such command.
- **L3. Catalog locks come after the entry lock**, never before it. No command takes both today, and **no entry command takes an explicit lock on a catalog row**: the catalog foreign-key checks that an insert triggers are the only catalog locks an entry transaction may hold. Otherwise a reflection insert (entry lock, then a share lock on its `album_tracks` row) could meet a tracklist rewrite (album lock, then that row) in a cycle.
- **L4. The slug claim can wait but cannot cycle.** `ON CONFLICT` on `entry_slugs` waits for another transaction's uncommitted claim of the same slug. That transaction holds only its own entry lock and never waits for ours, so no cycle exists (L2).
- **L5. Both previews take no lock.** Each reads one consistent snapshot (one statement or a read-only `REPEATABLE READ` transaction) and reads the database clock in it. Its staleness is harmless: the token is verified under the lock, so a flag flipped, a text saved, or a journal deleted between preview and consumption makes the fingerprint fail.
- **L6. Check and write are one transaction, behind one lock.** Steps 3 to 9 of § 4 and the compare-and-write of § 5 run under the entry lock in one transaction. Every writer of the rows in L1 takes that lock first, so nothing can commit between the comparison and the write (ADR 0005 § 5.7). The default `READ COMMITTED` isolation is enough because writers are serialized, and a test removes the lock to show it matters. The expiry is read from the database clock **after** the lock is granted.
- **Boundaries** (listed in [Data Model](../data-model.md#transaction-boundaries) as planned): 11, previews (read only); 12, publish; 3, extended by the confirmed save.

### 8. Deleted and restored entries

- A deleted entry is never public (the predicate), and no preview or publish is possible for it: `entry_deleted`. Address changes and unpublishing are refused as today.
- A restore is unchanged (ADR 0005): `published` returns as `private`, flags and history are kept, `entries.version` is not bumped, `updated_at` moves. Nothing is public afterwards.
- To make a restored journal public again the author must preview and publish, which discloses the effective set *as it is after the restore*, including every reflection flagged before. A token issued before the deletion fails on the stamp; a token from before any edit fails on the fingerprint; and a token that is merely old fails on its expiry.
- The restore dialog's promise ("nothing is published again until you choose to publish it") becomes exact for reflections once § 4 exists. M2.3 must verify its wording against the built flow.

### 9. There is no unchecked path

- **One checked writer.** The Publication module exports no function that makes a version `published` except `publishLanguageVersion`, which verifies the token itself. The current unchecked signature is **removed**, not wrapped, and the write of the status is a function that is not exported from `commands.ts` or from the index. A static test of the export surface fails if any exported function of the module (other than the publish command) can reach a write of `published`. Tests that need a published version call preview and publish through a helper in `src/testing/`, which uses the same code.
- **One writer of the status in the source.** A static test allowlists by **call target**, not by key, because the repository builds some writes in a variable (`saveAlbumJournal` passes `.set(changes)`) and because the Journals module legitimately inserts `status: "draft"` (`createAlbumJournal`). It flags, in production code, any `update`, `insert`, `delete`, or `onConflictDoUpdate` on `schema.entryTexts`, and any SQL text (including `sql.raw` and `sql.identifier` forms) that updates, inserts into, or deletes from `entry_texts`, unless the function is on a named allowlist. For an allowlisted function it requires the written value to be an object literal, or a variable whose declared type has no `status` or `publishedAt` property; an insert of a literal `'draft'` is the only status value allowed outside the Publication commands. Migrations, `src/testing/`, and test files (`*.test.ts`, `*.spec.ts`) may set anything; "production code" means everything else under `src/`. The scan also flags any `sql.raw` call in production code outside the allowlist, because dynamic SQL text cannot be resolved by reading it.
- **Every writer of the rest of the public surface is named, too.** The status is not the only way to change what a reader sees. A second static test, by the same call-target rule, fails if production code outside the Publication commands, the confirmed-save functions of the Journals module, and `restoreDeletedEntry` writes (inserts, updates, or deletes) `entries.deleted_at` to `NULL` (an un-delete would make a published version public), the text columns of `entry_texts` (`title`, `opening`, `body`, `body_text`, `margin_note`), `track_reflections` (`is_published`, rating, favourite, still-writing), `track_reflection_texts`, `album_journals.rating_half_steps`, `memories`, `memory_music`, or `entry_slugs` (`slug`, `was_published`, `is_current`). A new writer of any of these is therefore a visible, reviewed change, and it must use the confirmed-save path.
- **The allowlist is explicit, and adding a name needs review.** Both scans use the same list: the Publication commands; `createAlbumJournal` (it writes a new draft entry that no other transaction can see, per L1); `saveAlbumJournal`, which becomes the confirmed save when M2.2 adds the confirmation step (until then it is the one writer of the text columns without it, and no public version can be reached from the studio); `restoreDeletedEntry`; and `permanentlyDeleteEntry`, whose `delete from entries` removes the entry's other rows through the foreign-key cascade, which the scans cannot see as writes to those tables (it is an explicit, author-only deletion). "Confirmed-save functions" in the second scan means the functions named on this list. The two columns that choose which album or artist page a journal appears on (`album_journals.album_id`, `artist_journals.artist_id`) are written by no command today; a command that writes them is added to the second scan when it is written.
- **No application code mints and consumes a token in one operation.** This covers both tokens. Only `previewPublication` and `previewPublicChange` mint (§ 3), and a refusal returns none. The publish and save wrappers and actions take a token only from the request body, which only the confirmation dialog sends after the author has seen the disclosure or the delta. No code catches a `confirmation_*` refusal and retries. Only the Publication module's token functions construct a token. Without this rule a wrapper could preview and publish, in one request, which would be an unchecked path built from the checked one. The rule applies to production code under `src/`, excluding `src/testing/`, whose helper calls both on purpose. A static test (on the syntax tree, following calls one level into local helpers) enforces it: each preview may be imported only by its own action's file, no function may call a preview and its consuming command, and no function may catch a refusal and call the same command again. The scan is a tripwire (it follows one level of indirection), not a proof; the behavioral tests are the proof. The mutations "the wrapper previews, then publishes" and "the save action catches `confirmation_required` and retries with a token it obtained" must each fail it. The Identity module exports a signing and a verifying function. A further static test requires that only `src/modules/publication/` imports the **signing** one, and that no production file imports `@/testing` (the test helper that mints tokens with chosen timestamps). The Publication module exports a check function that verifies a token's authenticity but cannot mint one, so the Journals wrappers never import Identity's functions. What the command can prove is the second row of the table in § 3; that the decision was a human one rests on this rule and on browser tests 18 to 21.
- **The Journals module wraps; presentation never imports Publication.** A studio action calls a Journals wrapper that checks the entry's kind and calls the Publication engine, as `restoreAlbumJournal` does. `no-publishing.test.ts` keeps forbidding presentation from naming the Publication commands.
- **Out-of-process writers are not bound by any of this.** A script with raw SQL, `psql`, a migration, a database console, or the restore of a backup can set a status without the token. By owner decision R2, no trigger is added now. [Gates G3 and G4](#14-public-page-release-gates) require these writers to be inventoried and the database-layer controls to be decided, and they block any hosted public exposure until then.

### 10. Authorization

- Every new command (`previewPublication`, `previewPublicChange`, `publishLanguageVersion`, `unpublishLanguageVersion`, the confirmed save, and the Journals wrappers) takes the `AuthorizedAuthor` as its second parameter. So do `changeEntrySlug` and `permanentlyDeleteEntry` when a studio screen first binds them (M2.4 for the second). The type is a compile-time signal (the commands do not inspect it), so it is not the control; the token's `u` and `s` claims are compared with it, which makes a token usable only by the session it was issued to.
- Every new Server Action starts with an awaited `authorizeAuthor`, then runs through `perform` (the application's own `Origin`), then validates with Zod inside the command. A static test requires the first and the HTTP suite proves the rest. Both previews are actions too: they return private writing.
- A failure is a fixed code. The disclosure and delta that some failures carry go only to a request that passed authorization, are `no-store`, and are never logged. The token is never logged or echoed.
- Each action is added to the HTTP test's table, which fails if one is missing.

### 11. Public reads and caches

- **Only Publication queries.** Public routes read through `@/modules/publication`. Presentation already cannot import the database client (lint); a static test additionally requires that public routes import nothing from Journals, Catalog's studio functions, or Publication's commands. Every public query is built from `predicate.ts` and returns a projection without status, deletion state, or an unpublished language. A route never decides visibility itself.
- **New public queries are Publication's.** The queries M3 needs (listings, the sitemap, the album rating) are defined in the Publication module from the same fragments, not in a route. The album rating is public only through the "at least one version is public" rule in § 1, and a test shows it is absent otherwise.
- **An oracle test.** An independent TypeScript implementation of the predicate is compared with every public query over the whole state matrix (§ 13). A query that is wrong in any cell fails.
- **Initial public release: no shared cache.** Journal pages, listings, metadata, `sitemap`, `robots`, and every `308` and `404` from slug resolution are rendered per request and sent with `Cache-Control: no-store`. There is no static generation or incremental regeneration of journal data, no `use cache` of it, and no `generateStaticParams` for journal routes. A `308` is cacheable by default, so it carries `no-store` explicitly: a cached redirect would keep revealing the current address of an entry that has since been unpublished or deleted (INV-5), and a cached `404` would hide a newly published one. Nothing journal-related is rendered at build time; the build needs no database, which CI already proves.
- **How a route sends a real `308` or `404` with `no-store` is an open implementation question.** The studio's pattern (`cacheComponents`, data read behind `Suspense` after `connection()`) answers HTTP 200 with a prerendered shell and a streamed redirect ([Security § Deployment gate](../security.md#deployment-gate), item 2). Journal routes cannot use it as it stands: a streamed redirect is not a `308` (INV-5), a shell is not a per-request `404`, and a prerendered shell is not `no-store` per request. The address must be resolved, and the status and headers chosen, before any response byte is sent, for example in a route handler or before any `Suspense` boundary. **M3.1 starts with a spike** that proves, on the production build, real `308` and `404` statuses, `no-store` on `200`, `308`, and `404`, and no static shell or journal data in the build output. Gates G1 and G2 then repeat the proof on the hosted configuration.
- **What this guarantees, once the spike has passed and gates G1 and G2 are closed:** there is no cache that can keep a stale page, so unpublishing, deleting, restoring, unflagging, rating changes, and address changes take effect on the next request. That Next.js and the host honor the header and the statuses is proved by tests and evidence; it is not assumed.
- **Introducing any cache later needs its own ADR**, which defines the invalidation for every event in this section and the tests that show a stale page cannot be served. Nothing in M2 builds the invalidation, because nothing is cached.

### 12. Error codes and recovery

| Code | When | Writes | What the caller gets and the studio does |
| --- | --- | --- | --- |
| `invalid_input` | malformed id, locale, version, or a token that is present but not of the `ct1` form | none | field codes only; nothing echoed |
| `unavailable` | the application secret is missing or invalid | none | fail closed, as the studio already does |
| `entry_not_found` | unknown entry or missing version (the Journals wrapper also uses it for the wrong kind) | none | not found |
| `entry_deleted` | the entry is in Recently deleted | none | "restore it first"; restoring never publishes |
| `version_conflict` | `expectedVersion` is stale | none | reload; the text stays in the editor |
| `nothing_to_publish` | no non-whitespace opening or body, on publish or on a save of a public version | none | write something first, or unpublish first |
| `no_current_slug` | no current address | none | an invariant failure; reported, not retried |
| `confirmation_required` | a publication, or a change to the public page, without a token | none | the fresh disclosure or delta, **no token**; the studio shows the dialog, which asks for a new preview |
| `confirmation_invalid` | the token is not authentic, or is for another purpose, author, session, entry, locale, or version | none | nothing; the studio asks for a new preview |
| `confirmation_expired` | the token is older than its validity | none | the fresh disclosure or delta, no token; ask again |
| `confirmation_stale` | the token is authentic and current but the state it described has changed | none | the fresh disclosure or delta, no token; show what changed and ask again |

Every failure leaves the database as it was (one transaction), and none loses the author's text: the editor keeps it. A failure is never retried automatically, and a token is never reused by the client after any failure. The existing codes (`entry_not_deleted`, `slug_taken`, `invalid_slug`, `invalid_status`, `unsupported_content`) are unchanged. The Publication engine's `version_not_found` reaches the Journals layer as `entry_not_found`, as it does today.

### 13. Required tests

All are required before the code they cover ships. A privacy rule is not tested through the interface alone: each is also tested at the command boundary. Test data is synthetic and labelled `[Test]`.

**Token (unit and PostgreSQL).**

1. **Authentication.** A token with any claim altered, the MAC altered or truncated, signed under a different key or purpose string, or with an unknown version is `confirmation_invalid`; a token presented for another purpose, author, session, entry, locale, or version is `confirmation_invalid`; the unkeyed fingerprint alone is never accepted. A test helper (in `src/testing/`) mints tokens with chosen timestamps so that expiry and an issue time in the future are exercised, and each is refused. A missing or short secret fails closed as `unavailable` and nothing is written. No log line, response, or error contains a token, the key, or the secret. The comparison is constant-time (a static check).

**PostgreSQL (real database).**

2. **Disclosure parity.** Over the full matrix of {entry deleted or not} × {each language: draft, private, published} × {flag} × {text present per language} × {album rating set or not} × {the other language already public or not}: the disclosure for `L` equals the pairs the public queries return for `L` after `L` is published, minus those returned before. No pair of another language ever appears.
3. **No publication without a valid token:** an absent token is `confirmation_required`, a malformed or empty-string one is `invalid_input`, a forged or misbound one is `confirmation_invalid`, an old one is `confirmation_expired`, and a stale one is `confirmation_stale`; each leaves a row checksum of every table unchanged, and none of the refusals contains a token. An empty set still needs its token.
4. **Each invalidator separately** makes a previously valid token fail as `confirmation_stale`: a flag on and off; text added or removed in `L`; a reflection text, rating, favourite, or still-writing change; the album rating; a text save; the address; publishing and unpublishing `L`; delete and restore; a second use of the same token. Changes to another language's reflection do not alter `L`'s set. Save, publish, unpublish, delete, and restore each move the stamp; the address change is caught as an atom. Signing out invalidates the token (the session claim).
5. **ADR 0005 scenario:** flag a reflection, publish, delete, restore (private, nothing public), then publish without a token, with the token from before the deletion, and with a fresh token; only the last succeeds, and exactly the flagged set becomes public.
6. **Concurrency over real connections** (no sleeps; the entry lock held by a controlled transaction): publish against a flag flip, a text save, a rating change, a delete, a restore, an address change, and another publish; eight simultaneous publishes; a flag flipped between preview and publish; a catalog tracklist rewrite against a reflection insert; no `deadlock_detected` over repeated runs; only domain failures (no raw foreign-key error); every outcome is a state that was valid. The lock is removed once and the test must fail.
7. **Draft equals Private:** the same checks and the same refusals from both.
8. **Refusals:** deleted, wrong kind, missing locale, no slug, nothing to publish (including a whitespace-only opening and body), stale version. Each writes nothing. A failing step in the middle of a publish (forced by a temporary trigger created only by the test on the disposable database, never in a migration) rolls everything back.
9. **Post-publication changes (owner decision B):** every row of the § 5 table, with no token, with a valid token, with an expired, stale, and misbound token, and with a token minted for an input with a different delta (refused). A token minted for an input with the same delta but a different bundled removal is accepted. In particular: a **shorter** replacement of a public text needs confirmation; clearing the opening of a public version needs confirmation; a whitespace-only edit needs confirmation; a save whose canonical text is identical asks nothing; reordering links asks; deleting a reflection's text, unflagging, clearing the rating, and removing a link ask nothing. A save that would blank a public version is `nothing_to_publish`. A refusal changes no row and not `entries.version`. A save of a non-public item never asks. `still-writing` never changes whether a reflection is public (INV-2). **Strict reduction:** for every removal command, the public atoms after are a subset of the public atoms before.
10. **Version rule:** every command that writes authored content bumps `entries.version` or is listed as exempt.
11. **Translations (INV-3):** the disclosure, the public queries, `listPublicLanguageVersions`, and slug resolution never expose or mention an unpublished language, in every state combination.
12. **Previews** are authorized, read-only (a row checksum), and take no lock.
13. **Oracle:** the independent predicate against every public query over the same matrix; the album rating is public only when some version is.
14. **Static scans:** the one-writer scan, the export-surface scan, and the no-mint-and-consume scan of § 9, each with probes showing that it catches each form it is meant to catch (a status written in SQL text, through Drizzle, through a variable; a re-export of a writer; a function calling a preview and its consumer; a catch-and-retry).

**HTTP (the production build).**

15. Every new action, with no cookie, a forged cookie, a wrong signature, an expired and a revoked session, a non-author session, no `Origin`, a trailing-slash `Origin`, and a foreign `Origin`; malformed and oversized bodies; a token minted in another session; against a journal in a state where a call that got through would change the database. A checksum proves nothing was written, and no response contains SQL, a constraint name, a stack, the token, or the input.
16. The disclosure and delta appear only in responses to an authorized request, with `no-store`. Refusals contain no token.
17. Public routes (M3): for every state of the matrix, a request for an unpublished, private, deleted, or unknown address returns the same status, the same body, and the same headers; a `308` appears only for the previous address of a public entry; `Cache-Control: no-store` is on every `200`, `308`, `404`, the metadata, the sitemap, and `robots`; a synthetic private marker never appears in any public response, including the sitemap and the language links.

**Browser (Playwright, desktop and 390 px, the disposable database).**

18. The publish dialog lists each reflection with its language, lets the author change the selection *(read with [A1](#amendments): through a link to the track editor, and a new preview)*, and cannot be confirmed without the explicit control; keyboard operation, visible focus, 44 px targets, reduced motion. The token is not present in the page outside the dialog's state and is sent only by the confirm control.
19. Two contexts: a flag flipped in one makes the other's dialog fail and show the change; the text stays in the editor.
20. A public version shows the persistent notice; Save on a shorter text opens the confirmation naming the change; cancelling writes nothing; confirming publishes the new text.
21. Delete, restore, and the restored journal is private; publishing again shows the full set; the public page then shows exactly the disclosed set and nothing else.
22. Unpublish: the next request to the public address is the same `404` as an unknown one.

**Mutation checks** (each is made once by hand, must fail at least one test, and is recorded in the pull request that adds the code): accept the unkeyed fingerprint as a token; skip the MAC check; ignore the expiry, the purpose, the actor, the session, or the locale claim; derive the key without the purpose string; return a token in a refusal; compare the count instead of the set; omit a locale, the flag, the rating, the version, the stamp, or the address from the fingerprint; accept a missing token; skip the comparison for Draft or for an empty set; treat a shorter edit as a removal; remove the entry lock; compare before taking the lock; write before comparing; read the expiry before the lock; re-export the unchecked publish; make the wrapper preview and then publish; make the save action catch `confirmation_required` and retry; make a preview write; skip the delta for the album rating or for a reflection's text; remove `no-store` from the `308`.

### 14. Public page release gates

These gates apply before the **first hosted public page**. "Hosted public exposure" means any deployment that anyone other than the author can reach from a network: a production site, a preview deployment, a tunnel, or an unlisted address (unlinked URLs are not controls). A local demonstration on the disposable database with synthetic data is not hosted exposure.

**A gate is closed only by recorded evidence that the owner has reviewed.** An unresolved gate **blocks** deployment. It is not a warning, and the implementer cannot waive it. The gates are tracked as one checklist in an issue opened when M3.1 starts, and the [Security § Deployment gate](../security.md#deployment-gate) lists them as conditions. [Waivers](#waivers) says what the owner may and may not accept.

| Gate | Must be shown, with evidence |
| --- | --- |
| **G1. Status and redirect semantics** | On the production build **and on the hosted configuration**: the M3.1 spike's result; an unknown, draft, private, deleted, unpublished-translation, and retired address all return the identical `404` (status, body, headers); a `308` only for a previous address of a publicly visible entry; `HEAD` and `GET`, trailing-slash and case variants; no streamed `200` standing in for a redirect or a `404` (§ 11) |
| **G2. Cache behavior** | Through the real public URL, including any CDN or proxy in front: after unpublishing, deleting, restoring (which stays private), unflagging, clearing the rating, changing the address, and editing a public text, the **next request** shows the new state, never the old content, a stale redirect, or a stale `404`. `Cache-Control: no-store` is present on every response class, and no response carries a cache-hit indicator. The sitemap, the metadata, and a back/forward navigation are checked. A search of the build output finds no journal data |
| **G3. Audit of every writer of what the public sees** | An inventory of every writer of any column or row in § 1 (the status, `deleted_at`, the reflection flags and texts, the rating, memory details, and the slugs), with the way each is bound or accepted: application code (the static scans); scripts and command-line tools (`package.json`, `src/ops`, the identity CLI); every migration that touches `entries`, `entry_texts`, `track_reflections`, or their texts; test fixtures (confined to `src/testing/` and the disposable database); **restoring a backup** (into a new database, never the serving one; see the requirements under the table), which brings back older publication states **and writing that was permanently deleted since** (restoration fails closed, as the requirements under the table say); manual access (`psql`, a provider console, Drizzle Studio); and CI |
| **G4. Database-layer enforcement decided** | From G3's results the owner decides, in a recorded ADR, whether a trigger, row-level security, least-privilege roles (the runtime role without DDL and without the right to set a status directly), or accepted risk with named compensating controls is required. Whatever is decided is implemented and tested through `/refrain-db-change` **before** deployment. Not deciding is not closing the gate |
| **G5. Predicate and deployment configuration verified** | The oracle test and the privacy matrix (tests 13 and 17) pass against the production build **using the hosted database role**; `BETTER_AUTH_SECRET` is set, generated randomly with at least 256 bits (the generation method recorded), and identical on every instance; `BETTER_AUTH_URL` is HTTPS; the other conditions of the Deployment gate (client-aware sign-in protection, redirect and indexing review, real-HTTPS browser run) are closed; the studio is unreachable without a session and `noindex`; no debug or preview route is public; error pages leak nothing; `robots`, the sitemap, any feed, any Open Graph image, and every public route added after this ADR contain or serve only public content |
| **G6. Backups** | Scheduled off-device backups and a tested restore exist before any hosted database holds real writing (the existing requirement in [Security § Data protection](../security.md#data-protection)) |
| **G7. Independent review** | A read-only security review of the public surface by someone who did not write it (`/refrain-security-review` in a separate context supplements, and does not replace, the owner's own reading); every finding of Medium severity or higher is closed, or accepted in writing only as a verified, bounded, documented residual risk (a finding that private, unpublished, or deleted content can be served or cached is a G1 or G2 failure and cannot be accepted) |
| **G8. Catalog wording (C11)** | Catalog edits (an album or artist name, a track title, credits, tracklist order) change the wording of a public page without a confirmation. Before the first hosted public page, either the gap is resolved, so that a public page cannot change its wording without the author's explicit confirmation, or an independently verified safe alternative is recorded with its evidence. "We believe it is harmless" is not verification |

**Restoring a database fails closed (D3).** A backup is never restored directly into a database that is serving public content. The data is restored into a **new** database, and the application is pointed at it only when all of the following hold. Until then public reads stay disabled (the switch below is off).

1. **Restoration verified.** The backup's checksum and the restore check ([Development § Backup and restore](../development.md#backup-and-restore)) pass.
2. **Publication state checked.** A backup holds older states and writing that was permanently deleted since. Every entry's deletion state and every version's status in the restored data are inspected, and every version that is `published` is made `private` (as ADR 0005 does for a restored entry), so nothing is public until the author republishes through the ordinary preview and acknowledgement. The check records what it changed. That demotion is itself an out-of-process write of the status, so it is on G3's inventory. G3 may refine this only toward more caution.
3. **Sessions and tokens invalidated.** No session survives the restore (the backup tool excludes `auth_sessions`; the check verifies the restored database has none). Every confirmation token is bound to a session, so every outstanding token is invalid, and the author signs in again. If compromise is suspected, the application secret is rotated as well.
4. **Caches invalidated.** The application caches nothing by design (§ 11); any CDN or proxy in front is purged or its behavior verified, and G2's checks are repeated after the cut-over.
5. **Gates satisfied.** G1, G2, and the applicable parts of G5 are re-run against the restored database before public reads are enabled.

The detailed procedure is written, tested on the disposable database, and documented in Development as part of gate G3. Until it exists, no backup is restored into a hosted database.

**The public-reads switch (D4; an M3.1 deliverable).** `REFRAIN_PUBLIC_READS_ENABLED` is a server-only setting, never a public-prefixed variable and never in a client bundle. It is **disabled by default**: unset, empty, or any value other than exactly `true` means disabled. When it is disabled, every public content-serving surface answers the same status, body, and headers as an unknown address: public routes, per-page and per-language metadata, Open Graph images, the sitemap, any feed, and any associated endpoint. A static test requires every public route file and route handler to apply the guard (as the studio's entry-point test does for authorization), and an HTTP test calls every public surface with the switch off. The switch is **defense in depth and never replaces the publication predicate**: when it is enabled, every read still goes through the Publication queries, so the switch can hide content and can never reveal it, and the privacy matrix (test 17) runs with it enabled so that no privacy case passes because of it. Backup restoration keeps it disabled (above). The exact implementation is decided in M3.1. Until it exists, **blocking is procedural**: the author and the owner are the same person, so the gates rest on the process in this section. Enabling the switch on a reachable host before the gates are closed violates the Deployment gate.

#### Waivers

The owner alone may accept a **specific, verified, documented residual risk**, in writing, in the tracking issue. The record names the deployment, the evidence of the risk's size, and the compensating controls, and it lapses with that deployment. **A waiver never turns an unverified privacy guarantee into an optional one.** These cannot be waived, because waiving them would mean serving content on an assumption: G1 and G2 (the verification that unpublished, private, deleted, and removed content is neither served nor cached), the inventory of G3 (an unknown writer cannot be accepted), the predicate and privacy-matrix tests of G5, G8 (the catalog-wording gap), and the explicit acknowledgement of § 3. These may be accepted as a residual risk: the choice of control under G4, once G3's inventory is complete; the owner's own risk of data loss under G6; and the form of G7's reviewer. A G7 finding may be accepted only if it is verified, bounded, and documented as a residual risk; a finding that private, unpublished, or deleted content can be served or cached is a G1 or G2 failure and cannot be accepted. The implementer cannot waive anything.

## How ADR 0005 § 5 is met

| § 5 | Requirement | Where it is met |
| --- | --- | --- |
| 1 | Determine the exact set, per language | § 2: pairs `(reflection, L)` with the flag and text in `L`, derived from the predicate fragments; test 2 |
| 2 | Disclose it, identifying each reflection and language | § 2 (each item identifies reflection, track, and language), [Design System](../design-system.md#per-track-publication) (the dialog lists them; conflict C6) |
| 3 | Let the author review or change selections | The dialog edits flags with the ordinary save, which bumps the version; a new preview follows, so the author always confirms what is then effective (§ 3, § 6). *Amended by [A1](#amendments): the ordinary save is made in the track editor, which the dialog links to; the dialog saves nothing* |
| 4 | Require explicit acknowledgement | The command requires an authentic token for this exact state, operation, and session, even for an empty set (§ 3, § 4). **The token is not proof of acknowledgement, and the acknowledgement is mandatory** (§ 3): that the author acted is ensured by § 5 and § 9 (the token reaches only the dialog and leaves only from its confirm control, nothing mints and consumes in one operation) and by browser tests 18 to 21 |
| 5 | Enforce it at the Publication command boundary | § 4 (inside the command) and § 9 (no other way to publish) |
| 6 | Reject missing, outdated, or mismatched acknowledgements | § 3 revalidation and § 4 steps 2 and 8, § 12: `confirmation_required`, `confirmation_invalid`, `confirmation_expired`, `confirmation_stale`; tests 3 and 4 |
| 7 | Check atomically with the visibility change | § 7, L6: one transaction under the entry lock; test 6 |
| 8 | Apply to every caller | Met for every caller that uses application code: § 4 (one path for Draft, Private, and an empty set) and § 9 (the unchecked signature is removed, one writer, static tests). **Not met for out-of-process writers** (a script with raw SQL, `psql`, a migration, a backup restore) until gates G3 and G4 are closed; they block any hosted public exposure |
| 9 | Never expose a flagged reflection as an undisclosed side effect | § 2 (complete by construction), § 5 (the same rule after publication), § 8 (restored entries); tests 2, 5, and 9 |

## Conflicts and clarifications

No accepted text is edited. Where this ADR depends on an earlier statement, or reads one narrowly, it is listed here.

| # | Existing text | This ADR |
| --- | --- | --- |
| C1 | ADR 0005, decision 9: a restore does not bump `entries.version`. | Kept. The version alone cannot invalidate a token across a delete and a restore, so the **state stamp** does it (§ 3). Bumping the version on restore, or on publish, is not proposed: it would conflict an open editor. |
| C2 | ADR 0005 § 5.1 defines the set as `is_published` and text in the language. | Kept and implemented exactly. The album rating and the address are **added** to the disclosure; nothing is removed. |
| C3 | ADR 0005 § 5 covers publishing and republishing. | Kept. The case where a flagged reflection becomes public because text is added to an already public language (§ 5) is outside its letter and inside its purpose; it is handled by § 5 here, as a stricter rule, not a different one. |
| C4 | ADR 0002 D5.3: favourite, track rating, still-writing, and the album rating are independent of each other. | Kept. The album rating is public with the journal (owner decision R3) and is not derived from another value. |
| C5 | [Security § Publication predicate](../security.md#publication-predicate) does not mention the album rating. | Extended there by one line (§ 1 here), in the same change. No query exposes the rating today. |
| C6 | [Design System § Per-track publication](../design-system.md#per-track-publication): the dialog states a count ("4 of 10 track reflections are set to show"). | A count does not satisfy ADR 0005 § 5.2 and 5.3, which require identifying each reflection and language and letting the author review them. The design-system text replaces the count with the list, as this ADR's acceptance requires (the control itself is built in M2.3). |
| C7 | Product, rule 2: "Saving is not publishing"; saving never changes visibility. | Still true: a save never changes any status. It can change the *content* of a public version, and then only after confirmation (decisions 4 and B). |
| C8 | [Security § Planned](../security.md#implemented-and-planned-protections): the publication commands take no `AuthorizedAuthor` until bound. | They take it when this is built (§ 10). |
| C9 | `no-publishing.test.ts` forbids presentation from reaching the Publication commands. | It stays. The Journals wrapper is the way in, so the guard is not relaxed, only extended to the new names. |
| C10 | ADR 0003 § 4: the transitions are `publishLanguageVersion` and `unpublishLanguageVersion`. | The names stay; the signature of the first changes (§ 4). That is an implementation detail of an accepted decision, not a change to it. |
| C11 | [Roadmap § Catalog edit concurrency](../roadmap.md#catalog-edit-concurrency-last-write-wins): catalog edits are last-write-wins and take no entry lock. | Kept, and **recorded as a gap, not as a decision that it is harmless** (D5). Catalog metadata (titles, credits, tracklist order) changes how a public page is labelled and is not in the fingerprint, so such an edit changes a public page without a confirmation. Gate G8 requires it to be resolved, or an independently verified safe alternative recorded, before the first hosted public page. A test covers a catalog rewrite racing a reflection insert (§ 13, test 6). |
| C13 | ADR 0005 § 5.4 and 5.5: "require explicit acknowledgement", enforced "at the Publication domain-command boundary". | Read as follows, and said so in § 3: the command enforces an authentic, current token for the exact disclosure; that the author acted is ensured by procedure and tests, because a server cannot prove a click. Nothing is relaxed: without the token nothing is published. |
| C14 | ADR 0005 § 5.8: "apply to every caller … no caller-specific path around it", and the [Roadmap](../roadmap.md#adr-0005-condition-for-the-m2-publishing-interface) M2 acceptance. | Met for every caller that uses application code in M2. For out-of-process writers it is met only when gates G3 and G4 close. Until then M2 is accepted for local use only, and the roadmap says so. |
| C12 | [ADR 0004](0004-single-author-identity.md): `BETTER_AUTH_SECRET` signs session cookies, and replacing it signs everyone out. | Kept. A second, domain-separated use of the same secret (§ 3) is added through the Identity module; replacing the secret additionally invalidates outstanding confirmation tokens, which is harmless. ADR 0004 is not edited; a separate secret is introduced only if implementation evidence requires it (D1). |

## Alternatives considered

- **An unkeyed digest as the token (the first draft).** Rejected on the owner's review. It binds a decision to a state but does not authenticate the issuer, so any code that knows the rule could build a valid one, and it invites being described as proof of acknowledgement. It survives as the *fingerprint* inside the authenticated token.
- **A stored confirmation (a table or a column).** Rejected by owner decision 1, and unnecessary: the MAC makes the token self-authenticating, and every other input is recomputable from the locked rows. Revisit only if the stamp proves unreliable.
- **An explicit list of pairs instead of a fingerprint.** Simpler to read, but it cannot also bind the content, the rating, the address, and the state without a larger structure, and it needs a different mechanism for § 5. The studio still shows the list; the fingerprint is what the command compares.
- **A dedicated key variable.** Independent rotation, at the price of one more secret to provision and validate. Not adopted (D1); revisited only on implementation evidence.
- **Persisting each issued token to make it single-use.** Rejected: the stamp and the version already kill a token the moment its operation succeeds, without storage.
- **Bumping `entries.version` on publication, deletion, and restore.** The simplest invalidation, rejected because ADR 0005 decided otherwise for restore, and because publishing would otherwise make an open editor conflict with its own journal.
- **A boolean "I confirm" flag.** Rejected: it does not bind to what was shown, so a change between the refusal and the retry would be accepted (a time-of-check gap).
- **Returning a fresh token with every refusal.** Rejected: it gives code that receives a refusal a ready token to retry with. Refusals return the disclosure only.
- **Requiring a confirmation for every save of a public version, even with no change to the surface, or treating shorter edits as removals.** The first is rejected because it makes the confirmation routine and therefore meaningless; the second by owner decision B.
- **A database trigger now.** Not adopted (owner decision R2). It is a decision with gates G3 and G4 in front of it.
- **Restoring a backup into the live database and demoting afterwards.** Rejected (D3): there is a window in which older published states are served.

## Consequences

**Positive** (once built; see [Deferred implementation obligations](#deferred-implementation-obligations))

- No application caller can publish without an authentic confirmation about the exact set that will become public, and the set cannot change between the confirmation and the publication. Writers outside application code are bound only once gates G3 and G4 are closed.
- A restored or reopened journal cannot go public through an old token, and no reflection, rating, or address is exposed as a side effect. A token is bound to the author's session and dies in 15 minutes.
- Any edit of public text, longer or shorter, is shown to the author first; only true removals pass freely.
- No migration, no table, no new dependency, and no new configuration. The token is one module that the tests can attack.
- Public deployment is blocked by gates with recorded evidence, not by good intentions.

**Negative and costs**

- The unchecked publish signature disappears. About thirty test call sites of `publishLanguageVersion` (`src/modules/publication`, `journals`, and the restore tests), and the `unpublishLanguageVersion` ones if it gains the author, change.
- The Identity module gains a second use of its secret and two exported functions. Rotating the secret now also invalidates outstanding confirmations.
- Any save, in any language, invalidates every outstanding preview of the entry, because the version is per entry. That is conservative and cheap: the author previews again.
- A save that changes the public page takes a preview and a save, two requests.
- The author sees a confirmation for any edit of public text, however small.
- Catalog edits (a track title, the tracklist order, which orders the public reflections) still change a public page without a confirmation. That is a documented gap (C11) and the one place where public wording can change that way; gate G8 requires it to be resolved, or an independently verified safe alternative recorded, before hosted exposure.
- The album rating is public whenever the journal is public and a rating exists. An author who wants a rating kept private on a public journal has to clear it until a switch exists (owner decision R3).
- Out-of-process writers can still set a status until G3 and G4 are closed.
- The stamp depends on `updated_at` being set by every command that saves, publishes, unpublishes, deletes, or restores (the address is bound as an atom instead). The tests enforce that, but it is a convention (ADR 0003).
- The previews add reads to the publish and save paths, bounded by one entry's rows.
- If the spike passes, per-request rendering with `no-store` gives up CDN caching for the first public release, which is acceptable for a single author's journal.

## Deferred implementation obligations

Everything below is required by this ADR and **does not exist yet**. Each item is built and reviewed in the milestone named, each milestone needs the author's separate authorization, and no document may describe an item as implemented before its pull request has merged.

- **M2.1 (command boundary).** The Identity module's signing and verifying functions with the HKDF key (D1) and their tests; `previewPublication`; the checked `publishLanguageVersion` with the 15-minute expiry (D2); removal of the unchecked signature; parameterizing the predicate fragments in their own reviewed commit; the stamp tests; the one-writer, export-surface, and no-mint-and-consume scans with their explicit allowlist; the publication tests and mutation checks of § 13.
- **M2.2 (reflections).** The commands for reflection text, flags, ratings, and the album rating; the version rule; `previewPublicChange` and the confirmed save; the rule that a text row means text; the removal-subset test.
- **M2.3 (studio).** The publish and change dialogs, the Server Actions with the full HTTP table, and the browser tests.
- **M2.4.** "Delete now" bound to the author.
- **M3.1 (first public slice).** The route-mechanism spike (§ 11); public routes through the Publication queries only; `no-store` on every response class; the `REFRAIN_PUBLIC_READS_ENABLED` switch and its tests (D4); the oracle and privacy-matrix tests.
- **Before the first hosted public page.** Gates G1 to G8 closed with recorded evidence, including the restore procedure under G3 (D3), the database-layer decision under G4, and the catalog-wording gap under G8 (D5).

## Revisit when

- any cache of public pages is proposed (a new ADR is required, § 11);
- a second caller of the publishing command appears (a bulk operation, a script, an API): it uses the same function and needs its own ADR on how it obtains the explicit acknowledgement (§ 3);
- translations, memories, or artist journals get studio screens: each needs a wrapper and the version rule;
- `updated_at` stops being set by a command that changes these rows, or the stamp is found unreliable;
- the application secret's handling changes (ADR 0004), or implementation evidence shows that deriving the confirmation key from it is not enough (D1);
- gate G3 finds a writer that the application does not control.

## Amendments

An amendment clarifies how a decision is carried out. It does not change what the decision binds, so the status stays Accepted, as with the owner's clarification of [ADR 0005](0005-restoring-deleted-journals.md) on 2026-11-01. The original text above is left as it was written; each place that an amendment touches carries a pointer to it.

### A1. The publication review is read-only; selections are changed in the track editor

- **Date and approval:** 2026-11-02. Approved by the project owner in the review of pull request #32 (M2.3, issue #31). The implementation is the M2.3 branch.
- **Effect on the original text.** By the owner's decision this **overrides one sentence of § 2**: the one that has the dialog perform the unflag (and its echoes in browser test 18 and in row 3 of the table above). It does so as a clarification of the mechanism, not of the decision, for the reasons below; every other sentence of the ADR stands as written.
- **What the text said.** § 2 ("The author can review and change the set"), browser test 18, and row 3 of [How ADR 0005 § 5 is met](#how-adr-0005--5-is-met) describe the dialog as the place where the author unflags a reflection: "Unflagging a row is the ordinary save … that takes effect at once", after which the dialog asks for a new preview. [Design System](../design-system.md#per-track-publication) carried the same sentence ("each row can be unchecked").
- **What holds now.** The publication review **changes nothing**. It has no control that saves. Opening it, closing it with Cancel or Escape, and reopening it leave every reflection flag, `entries.version`, status, and row as it was, and a token that was issued is still valid. To change which reflections appear, the author follows the dialog's link to the track editor, makes an explicit edit, and saves with the ordinary save command; that save bumps `entries.version` exactly as § 6 requires, which invalidates any earlier token, and the author then asks for a new preview and confirms only the set as it then stands.
- **Why.** A review dialog whose Cancel leaves a change behind makes "Cancel" untrue and makes an act of reading into an act of writing. The acknowledgement of § 3 is mandatory precisely because it must be a deliberate act, separate from a save; an immediate removal inside the review blurred that line. The owner prefers that a preview is something the author can open and dismiss without consequence.
- **Compatibility with ADR 0005 § 5.** § 5.3 requires only that the system "let the author review or change individual publication selections before publishing"; it names no surface, and § 5 says it fixes no command or API. The review lists every reflection with its language (§ 5.1 and 5.2); the editor changes the selection (§ 5.3); publication still needs an acknowledgement of the effective set (§ 5.4), enforced at the Publication command boundary (§ 5.5), refused when missing, outdated, or mismatched (§ 5.6), and checked atomically with the visibility change (§ 5.7), for every caller (§ 5.8), and nothing is exposed silently (§ 5.9). None of those depends on where the selection is edited.
- **What is unchanged in this ADR.** The ordinary save as the only way a flag changes; the version rule (§ 6); that any change to the set kills the outstanding token; that the author confirms only the set as it then stands; the token, its binding, and its expiry; and § 5 (changes after publication), including that a removal needs no command-level confirmation (R4).
- **Where it is built and tested.** M2.3: the dialog's link, and the absence of any save in the dialog, which a static scan enforces; an integration test (a review opened and closed leaves every row, flag, version, and status as it was, and its token still works) and a browser test (Cancel, Escape, and the link change nothing; the editor's save and a new review do).
- **If the owner later wants changes staged inside the dialog**, that needs a new ADR: it would have to say how a staged change is persisted only by an explicit, named confirmation, and how that confirmation relates to the publication token.

