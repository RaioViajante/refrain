# Evidence: issue #54, asking before a removal from a published album journal

## Scope

Issue #54, **required before any hosted launch** (#47). Inherited from M2.3 and found in the M3.7 security review (PR #53): the album-journal editor saved a change that only takes something away from a published journal without asking. The owner did not accept that as an exception to ADR 0006 § 5, and the ADR was not to be changed to fit it.

- **The fix:** pull request #95, head `622e891100874b92d752086bebb24273cf2d1d22`, merged into `main` by the owner's authorization as the merge commit `0103dd9171982c9c505780db6819c6ed00d9385c` (parents `6b8e80b` and `622e891`, tree identical to the head's). `main` CI on `0103dd9` passed: Verify and Database tests (PostgreSQL 18).
- **The follow-up:** a pull request of browser tests and documentation only, authorized by the owner on 2026-11-11. It adds browser tests for the paths of the issue's regression list that #95 did not cover, records this evidence, and corrects the documents that still described the fix as on its branch. It changes no production code.

ADR 0006 is unchanged. No token was introduced for removals, and the Publication engine, the token, the fingerprint, and the predicate are unchanged. No migration and no dependency.

## The rule (ADR 0006 § 5)

A save of a journal whose language version is published is classified by what it does to the public page:

| Change while its language version is public | Classification | What the save needs |
| --- | --- | --- |
| Text edited (longer or shorter) or a field cleared; a track rating, favourite, or "still writing" changed; a reflection included; text added to an included reflection; the album rating set or changed | addition or edit | the `change_public` token from the preview, checked under the entry lock |
| A reflection no longer included, or its text cleared, in a published language; the album rating cleared | removal | **no token on the server; the interface asks first** |
| Both in one save | a change | the token, and the dialog also lists what is taken away |
| Anything while no version is published; a reflection that is not public | nothing public | nothing: the save never asks |

A removal-only save therefore needs no server-side confirmation token, but the Studio must present a confirmation before it saves. A removal can never expose anything, so the token, which protects what readers would newly see, does not apply to it; the question protects the author from taking something away by accident.

## Behaviour as built

- **Removal only.** "Take this away from the published journal?" ("Tirar isto do diário publicado?") names each item: "Your rating for the album", or "Reflection on the track · <track> · <language>". **Save and take it away** saves without a token; **Cancel** writes nothing and leaves every edit in the editor.
- **A change and a removal together.** "Update published writing?" lists the changes before and after and, under "Taken away from the published writing", what the same save removes. Nothing is written before the author has seen everything that changes.
- **Drafts, private journals, and reflections that are not public** save without either dialog.
- **Languages stay separate.** Clearing the English text of a reflection takes nothing from a published Portuguese version; no longer including a reflection takes it from every published language where it has text.
- **Derived on the client, never from the server's delta.** `src/app/studio/journals/removals.ts` computes the list from the editor's saved state and what the save sends, because the server's change preview lists only additions and edits, by design. It mirrors the Publication module's public atoms: a reflection is seen in a language when it is included, has text in that language, and that language version is published.
- **"No text" is the server's own test.** `isBlankText` (`src/validation.ts`: control characters removed, then white space and invisible characters only) is used by the save's schema and by the editor, so a text the server would store as nothing (for example U+0001 followed by U+200B) is a removal and asks.

### Why the save carries `expectedPublished`

Publishing does not move a journal's version, so a tab opened before another tab published the journal still shows it as unpublished, computes no removals, and would save a removal without asking. The album-journal save and its preview therefore accept one optional field, `expectedPublished`: the language versions the editor showed as published. Under the entry lock (and in the preview's read-only snapshot), a set that differs from the stored one is refused as `status_changed`; nothing is written, the editor refreshes, and the next save asks. It is the guard the memory editor already has (M3.7, `expectedStatus`).

The issue asked that "the command boundary does not change". This field is the one difference: it adds a refusal for a stale view, and it changes neither the token rule nor any classification above. A caller that omits it is weighed exactly as before. The owner approved keeping it on 2026-11-11.

## Tests

| Level | File | What it proves |
| --- | --- | --- |
| Unit | `src/app/studio/journals/removals.test.ts` | removals from an unflag, a cleared text, a blank or control-character text, and a cleared album rating; edits that are not removals; drafts and private journals; both languages; text the plain editor cannot show |
| Unit | `src/modules/journals/input.test.ts` | the save's schema and `isBlankText` agree on controls, DEL, white space, zero-width characters, and kept text; `expectedPublished` accepts only a list of distinct known languages |
| Integration (PostgreSQL) | `src/modules/journals/confirmed-save.integration.test.ts`, "the published versions the editor showed" | a stale editor, in three directions, is refused in the save and the preview with nothing written; after another tab publishes; a draft-to-private change does not refuse; the field is optional; a mixed save without a token writes nothing |
| HTTP | `src/testing/studio-actions.http.test.ts`, "publishing from the studio" | the same through the real Server Actions: a mixed save without a token is `confirmation_required`; a token used for another edit is `confirmation_stale`; a stale `expectedPublished` is `status_changed` in save and preview; a malformed one is `invalid_input`; a removal with the right set saves; a spent token is refused |
| Browser | `e2e/publication.spec.ts` (desktop and 390 px) | see below |
| Browser | `e2e/tracks.spec.ts`, "a published journal asks before a change to the public page" | unflagging a public reflection asks, and confirming saves |
| Browser | `e2e/i18n-studio.spec.ts` | the Portuguese dialog at 320, 360, 390, 768, and 1440 px, axe at 320 and 1440 px, **Cancelar** and **Salvar e tirar** |

The issue's browser regression list, against `e2e/publication.spec.ts`:

| Required | Test |
| --- | --- |
| Unflag a public reflection: listed; Cancel keeps the flag in the database and the edit in the editor; confirming clears it | "a change that only takes something away asks first…" (confirm); "a tab that still shows the journal unpublished…" (Cancel) |
| Clear a public reflection's text: listed; Cancel; confirming clears it | "a change that only takes something away asks first…" (Cancel, also with a control-character text); **"clearing a public reflection's text asks first, and confirming takes the text away"** (confirm: the text row is gone, the setting and the published version are kept, no token is sent, and after a reload the editor shows the track as empty) |
| Clear the album rating: listed; Cancel; confirming clears it | **"clearing only the album rating asks first, and Cancel writes nothing and keeps it cleared in the editor"** (Cancel: the rating, the journal row, and every reflection are unchanged in the database, the editor still shows "No rating" with unsaved changes, and saving again asks again); "a conflict keeps the unsaved writing…" (confirm: the rating is cleared) |
| A mixed save shows both before anything is written | "a save that edits and takes away shows both…" |
| A private journal's removal saves without a dialog | **"a private journal's removal saves without asking"** (the journal unpublished to private through the Studio, an included reflection no longer included: saved with neither dialog, the reflection no longer included in the database, the journal still private); `e2e/tracks.spec.ts`, "clearing a reflection removes its text and keeps the track" (a draft) |
| Every new screen passes axe, with 44 px targets | the removal dialog and the mixed dialog in English; the Portuguese dialog at five widths |

The three tests in bold are the follow-up's. The issue's list named the first two as missing; the third was found while writing this record: the existing tests covered a draft journal and a reflection included while nothing was published, but no removal on a journal whose status is private.

### The tests fail without the fix

- **PR #95.** The seven production files were reverted to `main` before the fix, with the new tests kept: 5 integration cases and 1 HTTP test failed, and in the browser `publication.spec.ts` "a change that only takes something away asks first…" and `tracks.spec.ts`'s published-journal test failed (the serial suite stops at the first failure). The unit tests import a module that did not exist before.
- **The follow-up.** The production code was reverted to `6b8e80b` (before #95), the application rebuilt, and the two new tests run in a temporary, uncommitted copy of the spec in which the earlier removal test (which fails first on that code, and stops the serial suite) was replaced by the database state it leaves, written to the disposable test database. Both new tests were otherwise unchanged. Both failed: no "Take this away from the published journal?" dialog appeared (expected one list item, received none). The production code was restored afterwards; it is identical to `main`. The third test guards the other direction (a removal that must **not** ask); the code before the fix never asked, so it passes there by design.

## Checks run

**PR #95**, locally on its final head `622e891` (Node 24.22.2, disposable test database, synthetic data): format, lint, typecheck, and build passed; unit 1,242 passed; integration (PostgreSQL) 797 passed; HTTP 680 passed; Playwright 388 passed and 17 skipped (the same 17 as `main`); 1,173 relative documentation links, none broken. CI on that head: Verify and Database tests (PostgreSQL 18) passed. CI on `main` after the merge: both passed.

**The follow-up**, locally:

| Check | Result |
| --- | --- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm audit --audit-level=high` | pass |
| `pnpm test` (unit) | 1,242 passed |
| `pnpm test:integration` (PostgreSQL, the test database recreated first) | 797 passed |
| `pnpm test:http` (production build) | 680 passed |
| `pnpm exec playwright test` | 394 passed, 17 skipped (the same 17 as `main`): the 388 of PR #95 and the three new tests at desktop and 390 px |

The production code is identical to `main` (`0103dd9`), so the unit, integration, and HTTP counts are unchanged.

## Independent reviews

- **PR #95, round 1** (Codex, read-only, at `3444531`): one Important finding, fixed: the editor's blank test did not remove control characters first, so a text of U+0001 or DEL could remove a public reflection without the dialog (now `isBlankText`, shared, with unit and browser tests). Two Minor findings, fixed: the language of each removal is marked (`lang`), and an outdated M2.3 sentence in the design system.
- **PR #95, round 2** (at `622e891`): no Blocker, Important, or Minor finding. The reviewer confirmed that the blank test matches the server's by comparing every Unicode scalar value in context; it could not run the suites in its sandbox, so they ran locally (above).
- **The follow-up:** an independent read-only review of its final head, recorded in its pull request (recording it here would change the head it reviewed).

## Known limitations

- **A direct call can remove without a question.** A removal-only Server Action call without `expectedPublished` saves without any dialog. That is ADR 0006 § 5 ("no command-level confirmation"): the dialog is an interface safeguard for the single signed-in author, not an authorization control, and every action still authorizes first. Additions and edits always need their token.
- **`expectedPublished` watches the published set only.** A change between draft and private in another tab does not refuse the save; neither state is public, so no removal can be missed.
- **One item per reflection.** The removal list names a reflection once per language, not each of its parts (text, rating, favourite, "still writing"), which leave the page together.
- **Two definitions to keep aligned.** `removals.ts` mirrors the Publication module's public atoms for album journals. A future change to those atoms must update it; its unit tests describe the current set.
- **Accessibility** is checked with axe, 44 px targets, and no horizontal overflow; no manual screen-reader pass was made.

## Not verified

- Nothing was deployed and nothing is hosted; no public page was involved. Gates G1 to G8 stay open.
- Unrelated intermittent tests seen during this work, not caused by it: `src/testing/public-home.http.test.ts` once differed only in the order of one streamed RSC chunk and passed on reruns; `e2e/public.spec.ts:283` (the public language selector) is recorded separately.
