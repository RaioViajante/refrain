# Owner packet: the smallest acceptance of ADR 0011 and ADR 0012

**Prepared for the owner on 2026-11-15. It accepts nothing.** ADR 0011, ADR 0012, and ADR 0006 A8–A12 stay **Proposed** until the owner records a decision in the ADRs themselves. It was drafted from `origin/release/v3-rc` (`5fc316f`), which the integration branch (#112) contains unchanged in these respects. Its cited headings, register entries, `HOME_RECENT_LIMIT = 5`, the Studio's half-step rating, and ADR 0008's proposed amendments were spot-checked against the repository. Items marked *unverified* were not.

Source: `origin/release/v3-rc` at `5fc316f`. Evidence: `docs/evidence/v3-public.md` (#104) and `docs/evidence/v3-rc.md`. Both ADRs are **Proposed**.

## 1. Decision register

A = the built v3 code depends on it. B = needed before public launch only. C = R2 to R12 or MS work; it can stay Proposed.

| ID | Summary | Class | Built dependency or reason |
| --- | --- | --- | --- |
| D1 | Accept 0011, 0012, and the amendments | A, partly | Only the parts in § 3 below |
| D2 | v3-styled confirmation dialog (C1) | C | Dialogs are "unchanged in behaviour"; accepted ADR 0006 already requires them |
| D3 | Bin kept until "Delete now"; copy (C2) | C | Built copy is the INV-4 note under accepted ADR 0005 ("Recently deleted (n)") |
| D4 | Pending changes, no history (A10) | C | R4, not built ("Desk: 'Everything saves on its own.' → not claimed"). It must land before real writing goes into v3 |
| D5 | Artist journal opens artist page (A11) | C | R7, not built |
| D6 | Media in PostgreSQL, grayscale public copy | C | R5, not built ("Memory photographs → Lined paper") |
| D7 | About "sources" row | **A** | Adaptations: "No sources row on About → A sources row" |
| D8 | Music Story token in an env var | **A** (if #105 merges) | `client.ts`: `process.env.MUSIC_STORY_API_TOKEN`; `.env.example` |
| D9 | "Follow their browser" not built | C | Already required by accepted ADR 0008 §§ 6 and 9. Nothing to accept |
| D10 | Grey `#67635C`; no grey text on kraft | **A** | "`#6E6A63` → `#67635C` … (D10, pending the owner's sign-off)". Also the Studio control borders `#8C877E`, "listed for the owner with D10" |
| D11 | Promote chrome assets byte for byte; `next/font` | **A** (first half) | `public/v3/` with SHA-256s; `src/app/v3/fonts.ts`. WebP texture re-encodings: not built (unverified) |
| D12 | Six newest plus flag; three featured artists | C | Home uses `HOME_RECENT_LIMIT = 5` under accepted A6 |
| D13 | "The album" and "the one": derived or authored | **A**, partly | `artist-view.tsx` derives "the album" when exactly one album is served. "The one" is not shown |
| D14 | One song; "when" becomes a year and month | C | Built shows "every song the memory names"; "when" is shown as written |
| D15 | Email provider; recovery path | C | R10. Launch needs only password sign-in (checklist #14) |
| D16 | Launch cover source | B | Checklist #11. Covers are off on every host |
| D17 | 24 untracked photographs | C | Not in the repository. Needed only for R5/R6 media (unverified that launch needs them) |
| D18 | PRs #98, #99, #102 | B | #99 is the G8 catalog wording (checklist #9). #102 is excluded from the candidate |
| D19 | Restart F-02 | B | Checklist #2 (G6) |
| D20 | Orbit beyond 36; merging thin years | **A** (orbit half) | "A fourth ring past 36 journals holds 20 (D20, proposed)". Year merging: not built |
| D21 | Sound not remembered; whole-step track ratings | **A** (sound half) | `sfx.ts`: "never persisted". `rating-field.tsx` still offers half steps |
| D22 | Verify Music Story access and licensing | C | MS-0 and MS-1. The adapter is "not wired", with "no live call made" |
| A9 | New public atoms | C | R2 |
| A10 | Pending changes and autosave | C | R4 |
| A11 | Artist journals open pages | C | R7 |
| A12 | One favourite | C | R2 |

The owner-approved requirements AR-1 to AR-8, and AR-9 for the Desk, Library, Bin, and Login, describe what is built. AR-11, AR-12, and AR-15 are not built. AR-13 is satisfied by the fallback, and AR-16 by the unwired adapter only.

## 2. Preferences to choose consciously

| Preference | Proposed | Alternative | Affects |
| --- | --- | --- | --- |
| v3 replaces V4.4 (ADR 0011 § 2) | v3 palette, four typefaces, no character, wordmark, EN/PT in the header | Keep V4.4 | Every surface; `AGENTS.md` § 6; ADR 0008 § 6 |
| Track-rating steps (D21) | Whole steps in the Studio; the database keeps halves | Keep half steps, as built | Studio editor; existing `.5` ratings |
| Songs per memory (D14, ADR 0002 amendment 3) | One song | Several, as built | `memory_music`; existing memories with several songs (resolution unverified) |
| Favourites (ADR 0002 amendment 1, AR-11, A12) | Exactly one | ADR 0002 D5, "no limit" | Migration; the author resolves rows with several favourites |
| Media storage (D6, ADR 0012 § 4) | PostgreSQL, grayscale public copy | Vercel Blob | Backups (G6), database size, `sharp` |
| Provider (AR-16, D16, D22) | Music Story, if licensed | MusicBrainz and the Cover Art Archive | Cost, licence, launch covers |
| Sign-in (AR-15, D15, ADR 0004 amendment) | Magic link after ADR 0012 § 3 | Password only | Email provider, DNS, the account-deletion hazard |
| Artist-page labels (D13) | Derived | Authored | A9 atoms |
| Contrast (D10) | `#67635C`, `#8C877E` | The reference's colours | Accessibility (WCAG AA) |

## 3. Smallest acceptance wording

**ADR 0011, Status line:**

> Partly accepted by the owner on <date>, only for the surfaces built in PR #104 as assembled in `release/v3-rc` (public pages, About, the 404, the Studio shell, Desk, Library, Bin, sign-in, `/studio/system`). Accepted:
> - § 1 "Authority";
> - § 2 "The V4.4 rules that v3 supersedes";
> - § 4 items 9 (motion and sound) and 10 (empty states);
> - § 5 "Security contracts preserved", as a binding condition;
> - in § 6, AR-1 to AR-8, AR-9 for the screens built, and the decisions D7, D10 (including the `#8C877E` control borders), D11 (byte-for-byte promotion and `next/font` only), D13 (derived "the album" only), D20 (orbit rings only), and D21 (sound only).
>
> Everything else remains Proposed, including § 3, the rest of § 4, D2 to D6, D8, D9, D12, D14 to D19, D22, and ADR 0006 A9 to A12. This acceptance authorizes no R2 to R12 milestone, no migration, and no deployment.

**ADR 0008:** accept proposed amendment 1 ("§ 6. The selector in the header and the footer"), adding "and the Studio's sidebar". Amendment 1 does not name the sidebar (unverified intent).

**ADR 0012, only if #105 merges:**

> § 1 items 1 to 3 and 8 accepted on <date> for the unwired adapter in `src/integrations/music-story/`. Items 4 to 7, § 2, § 3, and § 4 remain Proposed. Displaying Music Story images, making a live call, and changing the schema are not authorized.

The alternative is to leave #105 out of the merge and accept nothing in ADR 0012.

Anchors: `#1-authority`, `#2-the-v44-rules-that-v3-supersedes`, `#4-product-concepts-v3-introduces`, `#5-security-contracts-preserved`, `#6-decision-register`, and ADR 0012 `#1-music-story-is-the-preferred-provider-behind-a-licensing-gate`. They are derived from the headings by GitHub's slug rule. Only `#2-…` and ADR 0012 `#3-…` are confirmed as used in tracked links.

## 4. Conflicts with accepted text that the acceptance must resolve

1. **`AGENTS.md` § 6.** Five of its bullets are binding "until ADR 0011 is accepted": the V4.4 design, monochrome with Kalam and Alegreya Sans, the character only on the Home, no header wordmark with the selector only in the footer, and Rough.js. The built `v3.css`, `fonts.ts`, `frame.tsx` (wordmark, EN/PT in the header), `cur-rec.svg`, and the v3 404 break them. Fix: mark them "Superseded by ADR 0011 § 2", as § 2 itself requires. Rough.js is still used (`star-ink.tsx`, `src/design/strokes.ts`), so that rule retires later.
2. **ADR 0008 § 6.** It says "The selector is discreet and centered in the footer … a small island adds the arrow keys and Escape". Its Status line says the Studio's selector is in its footer. The built code has header and footer links, and the Studio's sidebar links "replace the V4.4 footer menu".
3. **Design System Part II.** It "governs every surface on `main`", including the Home character and the 404 artwork exception. Its status needs to say the surfaces have been replaced.
4. **`AGENTS.md` § 3 and the ADR 0012 Status line.** The Status line says "MusicBrainz, the Cover Art Archive, and Wikimedia Commons remain the only integrations". That conflicts with the merged adapter (#105) unless § 1 is accepted.
5. **Not conflicts, verified:**
   - The Home, archives, and memory follow the accepted ADR 0006 A4 and A6.
   - The Bin keeps the ADR 0005 wording.
   - Sign-in is unchanged (ADR 0004).
   - #44 (the album journal without JavaScript) and the local self-proxy `500` are launch issues, not ADR conflicts.
