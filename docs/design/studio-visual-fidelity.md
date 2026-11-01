# Studio visual fidelity

**Status:** implemented on branch `feat/studio-visual-fidelity` (issue #23), for the author's review. It covers the Writing Studio only. Nothing here changes behavior, data, authorization, or the public site, which does not exist yet.

This is the working specification behind the Studio's visual layer. [Design System](../design-system.md) stays the tracked design specification. This document records what was measured, what was built from it, which screens a reference covers, and what still needs the author's eyes. It does not claim pixel-perfect fidelity anywhere.

## Reference versions: V4.3 and V4.4

The request that started this work asked for fidelity to **V4.3**. The repository and the references are **V4.4**. The first pass used V4.4 without checking, which was a mistake of process. This section records what the source material does and does not establish. **The final decision belongs to the author.**

**Is V4.3 available?** No. The only export on this machine is V4.4: the 29 pages in `reference/refrain/pages/` (every page `<title>` says "(v4.4)", and the Handoff's says "refrain v4.4"), their previews, and the Handoff ("refrain v4.4 — design handoff … How the approved V4.4 language is built"). `LEIA-ME.txt` says "design final (V4.4), 31 out. 2026". The author's own backup, `~/refrain-reference-backup-20261031-164328`, is byte-identical to it. A search of the home folder for names containing "v4.3" or "v43" found only that backup's V4.4 files. The text "V4.3" appears inside every V4.4 page, but only as comment headings in its CSS.

**Is V4.4 documented as an approved replacement?** The repository says so: commit `24ccad7` (October 31, 2026) is titled "add approved design references" and describes them as "the approved V4.4 Refrain design"; `AGENTS.md` says "Implement the approved V4.4 design"; this project's design system says "visual identity approved (design V4.4, October 31, 2026)". Those commits are under the author's git identity but were written with AI co-authorship, so they are **statements in the repository, not independent proof** that the author chose V4.4 over V4.3. Nothing in the material records V4.3 being rejected or replaced.

**What changed between them.** Each V4.4 page carries its own layered stylesheet: "V4.2 refinements", then "V4.3 polish" (type scale, contrast, a notebook layout, the footer), then "V4.3 system: listings + studio" (the 58px page title, the lede, filters, status marks, the editor bar, the 760px + 300px studio layout, dialogs, rows), then a final "V4.4" block. That block contains **three groups of rules, plus one mobile rule**:

1. a centered public header without a brand or wordmark (`.hdr4`, replacing the older `.hdr` with `.brand`);
2. the homepage's centered character illustration (`.opening`);
3. a centered footer with the closing line and the language selector (`.ft4`);

and a single mobile rule that centers the right-hand link of the *Studio's* header (`.hdr>a.ink`, "Public pages") below 720px.

Everything else the Studio uses is V4.3-era CSS carried into V4.4 unchanged, including the Studio's header (`.hdr`, which no `.hdr4` replaced; V4.4 only adds that one mobile rule for its right-hand link, and the Studio has "Sign out" there).

**Do any implementation decisions conflict with V4.3?**

- **Header, titles, controls, rows, dialogs, editor layout:** no conflict. They come from the V4.3-era rules.
- **The footer: one possible conflict.** The Studio footer follows V4.4: a drawn line and the closing line, centered (the language selector is not built). V4.3's footer was a different arrangement ("the last line of the page, aligned to the margins", `.ft3`, a signature and the language control on a row). Its CSS is still in the files, but no page uses it, so **its content and markup cannot be recovered** from what is on this machine. If the author wants V4.3's footer, the V4.3 export is needed.
- **The public pages** (not built) are where V4.3 and V4.4 really differ: the header, the homepage character, and the footer. No decision about them was made here.

**Decided by the author (PR #24 review):** V4.4 is the working visual source, because it keeps the V4.3-era Studio rules and adds only the items listed above. The footer question stays open in one respect: V4.3's footer cannot be recovered, so the Studio uses V4.4's. No Studio screen is described as matching "V4.3" except where the carried-over rules are the same in both.

## Sources inspected

| Source | Used for |
| --- | --- |
| `reference/refrain/pages/refrainV44-{Desk,Catalog,MemoryEditor,AlbumEditor,ArtistEditor,States,Handoff}.dc.html` (local) | CSS values: sizes, padding, strokes, colors; markup structure |
| `reference/refrain/previews/3-admin-desktop/*.png`, `4-admin-mobile/*.png` (local) | The rendered screens, which outrank the exported CSS ([Authority](../design-system.md#authority)) |
| `RaioViajante/web`: `packages/design/styles/{tokens,base}.css`, `packages/design/components/Shell.tsx`, `docs/design-system.md`, `docs/browser-checks.md` (local checkout, `main` at `41ad44e`) | The lateral layout contract |
| [Design System](../design-system.md), the five accepted ADRs, [Security](../security.md), the existing Playwright and HTTP tests | Boundaries and what must not change |

`reference/` was only read. Nothing in the application, the tests, or this document loads it. The side-by-side images described below are generated locally and are not committed.

## The lateral layout contract (measured)

The four RaioViajante sites (root, dump, docs, lab) do not each have their own container. All four load one stylesheet from `packages/design`, and no app overrides it. Searching every app for `rv-shell`, `--shell`, `--gutter`, and `--measure` finds the definitions in `packages/design/styles/` and one use, `Shell.tsx`, and nothing else. So there are no differences between the sites to reconcile.

| Value | Real implementation | Source |
| --- | --- | --- |
| Shell width | `width: min(calc(100% - 35.2px), 1320px)` | `base.css` `.rv-shell` |
| Alignment | `margin: 0 auto`: centered, at every width | `.rv-shell` |
| Horizontal padding by breakpoint | None. The 35.2px (2.2rem) is subtracted from the width, so each side gets **17.6px** at every width until the shell reaches its maximum | `.rv-shell` |
| Maximum width | **1320px** (`--shell`). Beyond it the shell stays centered and the margins grow | `tokens.css` |
| Content column inside the shell | 739.2px (`--measure`, 42rem), centered; sidebar 228.8px; gutter 61.6px (3.5rem) | `tokens.css`, `.rv-column` |
| Small screens | Below 760px the shell becomes a single block. There is no breakpoint that changes the side margins | `base.css` |
| Header and content alignment | Header, content, and footer sit inside the same shell, so they share left and right edges | `Shell.tsx` |
| Ultrawide | No special rule. The shell stops growing at 1320px and the page centers | `.rv-shell` |

At the widths the Studio is verified at, that gives:

| Viewport | Shell width | Side margin |
| --- | --- | --- |
| 390 | 354.8 | 17.6 |
| 768 | 732.8 | 17.6 |
| 1280 | 1244.8 | 17.6 |
| 1440 | 1320 | 60 |
| 2560 | 1320 | 620 |

**Adopted for the Studio:** `.studio-shell` and `.studio-main` use exactly this formula (`--studio-shell: 1320px`, `--studio-gutter: 35.2px`). It matches the author's stated intent: the Studio lines up with the rest of the ecosystem, and the visual identity stays its own. Only the spacing behavior is reused. No other stylesheet, color, or typeface comes from those sites.

**Where it differs from the approved Refrain reference.** The V4.4 pages use `padding: 0 64px` inside `max-width: 1312px` (20px below 720px, 16px at 370px and below). The contract above is a few pixels different at the two widths the references were drawn at, and different at tablet widths:

| Viewport | V4.4 reference | Adopted (ecosystem) |
| --- | --- | --- |
| 390 | 20px | 17.6px |
| 768 | 64px (the 720px breakpoint has passed) | 17.6px |
| 1440 | 64px, content 1312px | 60px, content 1320px |

The author asked for the ecosystem behavior, so it wins. The notebook layout's own measurements, taken from the reference, are unchanged: margin column 220px, gap 64px, writing column up to 860px, so the title begins 284px from the shell edge, as in the Desk capture.

## Typography, color, and geometry

All values come from the V4.4 pages' final CSS overrides (which, for the Studio, are the V4.3-era rules) or the rendered screens. Fonts are the two already loaded with `next/font` (Kalam 300/400/700, Alegreya Sans 400/500/700). No font was added.

| Role | Value |
| --- | --- |
| Page title | Kalam 700, 58px / 1.05, −0.005em (42px ≤ 720px, 36px ≤ 370px). Editors 52px (30px mobile) |
| Section title | Kalam 700 27px (25px mobile). In side panels, Kalam 400 21px |
| Lede | Alegreya Sans 19px / 1.55, `#3A3A3A`, 46ch |
| Field label | Kalam 400 20px |
| Row title | Kalam 400 22px / 1.3 (20px mobile) |
| Metadata | Alegreya Sans 16px, `#4A4A4A`; hints 15.5px, `#4F4F4F` |
| Reading | Alegreya Sans 21px / 1.66, 62ch (19.5px mobile) |
| Opening sentence | Kalam 300 31px / 1.38 reading, 30px as the editor field (26px mobile) |
| Buttons | Kalam 400 18px, min-height 46px, padding 0 20px |
| Color | `ink #111`, `text-2 #3A3A3A`, `text-3 #5A5A5A`, `rule #CFCFCF`, `frame-quiet #767676` (the mockups' `#ABABAB` is below 3:1), `paper-2 #F4F4F2`, `paper-3 #F6F6F4`, hover `#F7F7F5`. No other color. Checkboxes use `accent-color: ink` |
| Vertical rhythm | Section spacing 48px (36px mobile); rows 14px padding, 44px minimum; page padding 64px top, 96px bottom (40/72 mobile) |
| Breakpoints | ≤ 1099px: one column (the 284px offset no longer fits). ≤ 960px: editor and journal stack, header becomes two rows. ≤ 720px: mobile type and 44px thumbnails. ≤ 370px: smaller title |

### Hand-drawn strokes

The reference draws every control outline with Rough.js, pre-generated with fixed seeds, as inline SVG with `preserveAspectRatio="none"` and `vector-effect: non-scaling-stroke` ([Design System § Rough.js implementation](../design-system.md#roughjs-implementation)). The Studio does the same, as CSS:

- `src/design/strokes.ts` generates the drawings with Rough.js 4.6.6 (a dev dependency, never in the application's bundle) and fixed seeds. `pnpm design:strokes` writes `src/app/strokes.css`, which holds them as custom properties (`--stroke-button`, `--stroke-field`, and so on).
- A unit test fails if the committed CSS differs from what the generator writes, so the drawings are reproducible and never change between renders.
- Controls use them as `background` images behind real elements: buttons, fields, the writing surface, dialogs, dividers, and the current page's underline. No markup, no `z-index` trick, and no script is involved, so semantics, selection, and hit targets are the native element's own.
- The drawings are original to this repository. They were generated with the same technique, not copied from the reference files, so they are close to the reference's character but are not its exact paths.
- Hover swaps to a second seeded drawing. Focus thickens the stroke **and keeps the 2px focus ring**: the reference removes the outline on controls, but the design system's accessibility baseline says never to remove one without a replacement, and a slightly thicker line is not a sufficient one. This is a deliberate difference from the mockup.

## Screen coverage

"Direct" means a V4.4 screen shows this composition and the implementation follows it. "Faithful extension" means no screen shows it, so it applies the same components and tokens, and must not be called 1:1.

| Studio screen | Reference | Coverage | What is not in the reference's image |
| --- | --- | --- | --- |
| Header and footer | Every studio screen | **Direct** for the arrangement: label left, **Desk and Catalog** centered with the drawn underline, the session control at the right edge, the footer's closing line | "Sign out" stands where the reference has "Public pages", which does not exist yet. No language selector: the interface has one language until the i18n work |
| Desk | `Desk` | **Partial to direct.** Header, title ("Desk"), lede, primary action, rows (thumbnail, Kalam title, metadata, a status mark, an Edit link), dividers, "Recently deleted", and the footer follow the screen | The reference has three create buttons (memory, album journal, artist journal), a search field, filter chips, memories and artist journals, and a language selector. Only the album journal exists, so there is one "Write a journal" button and no search, filters, or filter chips; a plain count line stands where the chips are. The catalog is a quiet line at the bottom |
| Catalog (overview and the artist, album, and track lists) | `Catalog`, `Albums`, `Artists` | **Direct** for the margin navigation (Overview, Artists, Albums, Tracks, with a drawn underline on the current one) and the page heading. **Partial** for the lists: thumbnails, Kalam titles, metadata, drawn rows | Counts in the margin tabs, a filter field, inline "Edit" and "Remove…" on each row, "Add from MusicBrainz" (not built, by decision). The overview page has no reference of its own |
| Journal editor (new, edit) | `MemoryEditor`, `AlbumEditor` | **Design-language extension, partial for the album editor.** Writing column up to 760px, 300px margin, the album and artists as quiet context above, the opening sentence as a drawn line, a quiet writing frame, the journal's status and the save state in the margin | The reference's top bar (breadcrumb, status, Preview, Save, Publish…), version tabs, ratings, and track by track are not built. The reference edits a memory with its own title; the Studio's journal has no title of its own, so its heading is the album |
| Dialogs and states | `States` | Direct for dialog geometry and type, the empty panel, and loading. The generated strokes are lighter and less rough than the reference's. Copy keeps the interim wording required by INV-4 | "Leave without saving" uses the browser's own prompt, as before |
| Recently deleted | `States` (the last panel) | Direct for the row; extended into a list page | "Delete now…" is not built, by decision |
| Journal reading | `Grace` (public) | **Faithful extension**: the album journal composition (5fr / 7fr, 88px gap, Kalam opening sentence, 62ch reading) used privately | No public page exists to compare against |
| Album, artist, and track forms; tracklist; sign-in | None | **Faithful extension** through the shared controls | Everything |

## Observable differences from the references

From the numbered comparisons (`visual-review/owner-review/`, local, synthetic data). The reference is V4.4. "Not built" means the feature does not exist in the Studio, not that the styling is missing.

| Area | Reference | Studio, PR #24 |
| --- | --- | --- |
| Typography | Kalam title 58px (editors 52px) and Alegreya Sans body | Same families, sizes and weights. The editor title says "Edit: <album>", in black, where the reference shows a gray placeholder title for a memory |
| Header alignment | Label left, navigation centered, "Public pages →" right, all at the 64px page edge | Same arrangement, **the same two destinations (Desk, Catalog)**, and the same vertical position. The edge is 60px at 1440 (the ecosystem contract), and the right item is "Sign out" |
| Spacing | Writing column offset 284px from the edge, rows about 92px | Same 284px offset and row structure. Rows are about 84px |
| Component dimensions | Buttons 46px high, 20px side padding; fields 50px | Same |
| Hand-drawn strokes | A heavier, more irregular double line with visible corner overshoot, on every outline | A lighter, straighter double line (generated, not the mockups' paths). The writing frame is darker gray than the mockup's (`#767676` against `#ABABAB`, for contrast) |
| Responsiveness (390px) | The header stacks three short centered rows: the label, the two-item navigation, "Public pages →" | One row: the label (an icon below 480px, its words kept for assistive technology), Desk and Catalog, and Sign out. It is shorter than the reference's three rows |
| Visual hierarchy | The Desk is one list of all writing; the buttons lead into it | One button, then the journals as the dominant list, each with its status mark and an Edit link, then Recently deleted and a quiet catalog line |
| Editor | Top bar (breadcrumb, status, Preview, Save, Publish…), version tabs, settings blocks | Writing column and a small margin (Written in, Save, status). The Save button is in the margin, not a top bar |

**Implemented:** the header and footer, the notebook layout, the Desk (the journals, with status), the Catalog overview and its navigation, artist, album and track lists and forms, journal reading, editing, deleting and restoring, dialogs, loading and empty states, and the hand-drawn controls.

**In the mockups, not built (by decision or because the feature does not exist):** search and filter chips on the Desk, memories and artist journals, the entry rows' status marks, Preview, Publish… and Unpublish…, version tabs, ratings, track by track, "Add from MusicBrainz", the language selector, "Public pages", Edit and Remove… on catalog rows, and "Delete now…".

## Navigation structure

The header has **exactly two destinations: Desk and Catalog**, the same in the desktop and phone layouts, as in the V4.4 reference (decided by the author). The Studio's other sections are reached from them. Nothing depends on hover, and there is no menu to open.

| Route | Header shows as current | What it is |
| --- | --- | --- |
| `/studio` | Desk | The Desk: the journals, Write a journal, Recently deleted |
| `/studio/journals`, `/studio/journals/new`, `/studio/journals/[id]`, `/studio/journals/[id]/edit`, `/studio/journals/deleted` | Desk | The writing workflows (unchanged URLs) |
| `/studio/catalog` | Catalog | **New:** the Catalog overview, with Overview, Artists, Albums, Tracks in the margin |
| `/studio/artists`, `/studio/artists/new`, `/studio/artists/[id]` | Catalog | Unchanged URLs, now under the Catalog |
| `/studio/albums`, `/studio/albums/new`, `/studio/albums/[id]` | Catalog | Unchanged URLs, now under the Catalog |
| `/studio/tracks`, `/studio/tracks/new`, `/studio/tracks/[id]` | Catalog | Unchanged URLs, now under the Catalog |

On the Catalog's pages, a second navigation, labelled "Catalog sections", lists Overview, Artists, Albums, and Tracks as plain links in the margin column (a row above the page on a narrow screen), and marks the current one with `aria-current` and the drawn underline. The Desk links to its journals, their editors, "All journals", and "Recently deleted (n)", and, quietly, to the catalog. The header is a single row at every width from 360px up; below 480px the label shows only its icon (its words stay for assistive technology), so the two destinations never wrap.

**The authentication boundary is unchanged.** The header, the Catalog navigation, "Sign out", and the footer are rendered by `StudioFrame`, which each page renders only after its own `authorizeAuthor` succeeds; the new `/studio/catalog` page follows the same rule (the source-scanning test `studio-entry-points.test.ts` includes it). The loading placeholder, which is part of the static shell, still contains no studio furniture. The HTTP tests that require an anonymous response to contain no "Sign out", no studio text, and the sign-in redirect pass unchanged, except that the string they look for is now one that only the signed-in Desk contains ("Everything you are writing", the Desk's introduction, replacing "Your desk", the old heading).

## Stroke fidelity

The strokes are generated from the same technique as the reference's (Rough.js double-stroke outlines with fixed seeds), measured against its paths in the V4.4 Desk, Field, and States pages (read only):

| Aspect | Reference | PR #24 | Assessment |
| --- | --- | --- | --- |
| Outline construction | 8 sub-paths per rectangle (two passes per edge) | 8 sub-paths | Same |
| Stroke weight | 1.15 (buttons), 1.3 (fields), 1.6–1.9 (focus) | 1.15, 1.3, 1.6–1.9 | Same |
| Reach | Runs to the box edge (x from −0.2 to 159.9 in a 160-unit box) | Now 0.8 from the edge (was 3: the outlines looked smaller and quieter) | Close |
| Edge irregularity | Per-edge spread about 0.6–1.5 units | About 1–4 units (larger, because the same seed gives different roughness at a different size) | Rougher in places; not the same hand |
| Navigation underline | A swoosh 2.8–6.7 units tall, clear of the word | A seeded swoosh 2.9–7.3, clear of the word (was a flat line hugging the text) | Close |
| Divider rule | A single curve with about 2.0 of sag | About 2.2 of sag | Close |
| Writing frame | `#ABABAB`, double line | `#767676` (for contrast), double line | **Deliberately darker** |
| Dialog | Heavier, with visible corner overshoot | Same weight, less overshoot | Close, lighter at the corners |

**Assessment:** the same technique, weights, and construction, and now close in size, underline, and rule. Not the same hand: the reference's corners overshoot and its edges skew more deliberately than a seeded generator produces, and the writing frame is darker for contrast. The close-ups are in `visual-review/stroke-comparison.png` (local). Determinism is unchanged: the drawings are generated once with fixed seeds, committed as CSS, and checked by a unit test, so nothing is re-randomized between server and client.

## Navigation investigation (issue #23)

**Question.** Does clicking between Studio sections reload the page?

**Method.** `e2e/navigation.spec.ts` sets a marker on `window`, records every request of resource type `document`, and activates the sections in turn, in the production build. It was first run against the unmodified `main` build, when the header had five items; it now follows Desk, Catalog and the Catalog's sections.

**Findings.**

1. **There is no full-document navigation.** (Kept as a regression test.) No `document` request was made and the `window` marker survived all five navigations. Moving between sections is a client-side navigation. Sign-out is a full navigation, on purpose, so that nothing rendered under the old session can be shown again.
2. **Why it can feel like a reload.** Measured in a temporary probe against the unmodified `main` build and **not kept as a test** (it would fail by design until the follow-up below): each page renders its own header, so the header is a *new DOM node* on every navigation, keyboard focus returns to the top of the page, and the scroll position resets. The link just activated is destroyed. On a server round trip that takes longer than a moment, the old page stays frozen until the new one is ready, with no sign that the click was received.
3. **Next keeps recent routes in the DOM, hidden** (three `<header>`s were found at once), so any test about "the header" must use the visible one.
4. **Not tested:** the development server (`next dev`), where compiling a route on first visit adds delay. That is a likely contributor on the author's machine and is not something the production build can show.

**What changed.** A small, safe addition: while a section loads, its link's underline draws in (`useLinkStatus`), a quiet acknowledgement that changes no boundary. The loading placeholder now shows quiet gray bars. Nothing else was changed.

**What did not, and why.** Moving the header into the shared layout would fix points 1 and 2, but a layout is rendered in the static shell, so an anonymous request would receive the studio's furniture, including "Sign out". [`studio.http.test.ts`](../../src/modules/identity/studio.http.test.ts) requires the opposite, and [Security § Authorization contract](../security.md#authorization-contract) treats the layout as presentation only. Changing that is a decision about the authorization boundary, so it is **a follow-up that needs the author's decision (and probably an ADR)**, not part of a visual task. One option is a layout that checks the session itself before it renders the header, accepting one more session lookup per request.

### A shared, authenticated header (future, not built)

The fix for the remount and the lost focus is a header that persists across sections. It was **not** implemented, and must not be done by moving "Sign out" and the navigation into `app/studio/layout.tsx` as it is today. If it is built later, these protections are required:

- The layout renders the studio's furniture only inside a dynamic part of its tree that has asked Identity whether the request is the author's (`authorizeAuthor`), under `<Suspense fallback={null}>`. The static shell must contain no navigation, no "Sign out", and no label that is not already public.
- That lookup is for presentation only. Every page, route handler, and Server Action keeps its own `authorizeAuthor` (the source-scanning test `studio-entry-points.test.ts` stays as it is). A layout does not re-run on a soft navigation, so a session that ends while the author browses is noticed by the next page's own check, which redirects; nothing may rely on the layout.
- The sign-in page stays outside the authenticated layout, and sign-out stays a full navigation.
- `studio.http.test.ts` (an anonymous response contains no "Sign out", no studio words, and the sign-in redirect) is unchanged and must pass. New tests: an anonymous request's body has no header; a session revoked while browsing ends at sign-in with no header left; and the known-limitation test in `e2e/navigation.spec.ts` flips to assert that focus stays on the activated link.
- Responses that include the furniture keep `Cache-Control: no-store` (the HTTP test asserts it), and the lookup uses `headers()`, so nothing is cached across sessions.
- Cost: one more session lookup per full request. This is a change to the authorization boundary's presentation and needs the author's decision and, probably, an ADR.

## Accessibility notes

Checked in the browser by tests, unless marked otherwise:

- No horizontal overflow on 16 Studio pages (every list, `new`, and detail page for artists, albums, tracks, and journals, the journal reading and editing pages, and Recently deleted, in its empty state) at 390, 768, 1280, 1440, and 2560px, with long names (`e2e/layout.spec.ts`). Sign-in at 390px is covered by `mobile.spec.ts`. Open dialogs and the album tracklist editor with many rows are not measured.
- The shell's width and centering match the contract at the same five widths, and the header, content, and footer share their edges.
- A skip link ("Skip to the content") is the first tab stop. After client-side navigation, activating it focuses the *visible* page's `<main>` (asserted; Next keeps earlier routes in the DOM, hidden, with the same id). The navigation links are at least 44px tall and show the 2px focus ring (asserted). Dialogs keep the native `<dialog>` focus trap and Escape handling (unchanged).
- `prefers-reduced-motion: reduce` removes every transition in the Studio (asserted on every visible link and button), and the underline simply appears.
- Status is always a word with a mark. Problems still begin with "Problem:" and are announced. Nothing relies on color.
- Text is no lighter than `#5A5A5A` (placeholders use it; hints `#4F4F4F`).
- **Control boundaries (WCAG 2.2, 1.4.11, 3:1 against white).** The writing surface's quiet outline and the opening sentence's resting line were `#ABABAB` (2.3:1) and `#CFCFCF` (1.6:1). Both are now `#767676` (4.54:1, which leaves room for a thin, anti-aliased line), and the `frame-quiet` token in the design system says so. Inputs, selects, the dialog and buttons are drawn in ink. The remaining light grays are not control boundaries: row dividers (decorative), the disabled outline `#C8C8C8` (disabled controls are exempt), and the artwork placeholder's box. A unit test fails if any stroke that is a control boundary falls below 3:1 (`src/design/strokes.test.ts`, shown to fail with the old color), and a browser test reads the drawn boundary of the journal editor's three inputs (opening sentence, reflection, language) at rest, on hover and in focus, and its Save button (`e2e/accessibility.spec.ts`); the unit test is what covers every stroke.
- **axe-core 4.14.0** (`@axe-core/playwright`, a dev dependency) runs WCAG 2.0/2.1/2.2 A and AA on 16 Studio pages at 1280 and 390px, on the open delete dialog, and on sign-in, with no violation. A canary test proves the scanner reports a deliberately broken element. Only the delete dialog is scanned (not the restore or the album archive and delete dialogs), and validation-error states are not. axe also does not evaluate text drawn over a background image (the white label on the ink primary button is reported as "incomplete", which the test does not read); that contrast, white on `#111`, was calculated by hand at about 18:1. axe is a floor: it cannot judge reading order or meaning, it cannot measure a boundary drawn as a background image (hence the check above), and it did not run in forced-colors mode (the check above did).
- Forced colors (Windows high contrast): the drawn outlines are background images, so under `forced-colors: active` real 1px borders in the system's colors replace them (primary buttons get 3px), and the drawn images never return on hover, focus, or disabled (an `!important` system-mode override; a plain selector lost to the hover rules, which a test caught). **Tested in Chromium's forced-colors emulation**, at rest, on hover and in focus, on the editor's three inputs and its primary button (`e2e/accessibility.spec.ts`). Not tested: the dialogs, the navigation, the album forms, disabled and invalid states, or Windows itself.
- Not done: a screen reader pass.

## Open decisions for the author

1. **The layout.** The adopted margins differ by 2.4px at 390 and by 4px at 1440 from the V4.4 mockups, and at 768 the content is much wider than the mockups' 64px padding. Confirm that the ecosystem's contract is what is wanted, or whether the mockups' 64px margin should win above 1000px.
2. **Focus rings on drawn controls.** A conservative ring plus a thicker stroke, against the mockup's thicker stroke alone. Say if the ring looks too heavy.
3. ~~Header navigation~~ **Decided by the owner:** exactly two destinations, Desk and Catalog, as in the reference. Artists, Albums and Tracks are reached from the Catalog (its margin navigation), and the journals, the editor and Recently deleted from the Desk. See "Navigation structure".
4. **The shared header** (see the investigation). Needs a decision about the authorization boundary.
5. **The writing surface's outline.** Darkened from the mockups' `#ABABAB` to `#767676` to meet WCAG 2.2 1.4.11. It is a visible departure from the mockup (a quiet gray that is no longer as quiet). Say if the contrast or the look should change.
6. **The reference version** (see above).
7. **The strokes' character.** They are generated, not copied. Compare the images and say whether the wobble, double line, and corner overshoot read as the same hand.

## Reproducing the review

```sh
pnpm db:test:up
pnpm review:screens        # builds, then captures 21 screens at 390, 768, 1280, 1440, 2560
```

The screens are written to `visual-review/` (ignored by Git, about 105 images). They show only synthetic `[Test] E2E …` text, created through the real forms against the disposable test database, which the global teardown removes. The numbered side-by-side comparisons (`visual-review/owner-review/`) use the author's local `reference/previews` captures, so they are made by a local script outside the repository (the repository's tests and tools never read `reference/`) and are not committed.
