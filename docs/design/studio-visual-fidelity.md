# Studio visual fidelity

**Status:** implemented on branch `feat/studio-visual-fidelity` (issue #23), for the author's review. It covers the Writing Studio only. Nothing here changes behavior, data, authorization, or the public site, which does not exist yet.

This is the working specification behind the Studio's visual layer. [Design System](../design-system.md) stays the tracked design specification. This document records what was measured, what was built from it, which screens a reference covers, and what still needs the author's eyes. It does not claim pixel-perfect fidelity anywhere.

## Version note

The request that started this work calls the approved design "V4.3". The repository, its handoff, and the local references are all **V4.4** (October 31, 2026). The V4.4 screens contain the V4.3 studio rules, as the exported stylesheet's own section headings show ("V4.3 system: listings + studio"). V4.4 is used throughout.

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

All values come from the V4.4 stylesheet's final overrides or the rendered screens. Fonts are the two already loaded with `next/font` (Kalam 300/400/700, Alegreya Sans 400/500/700). No font was added.

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
| Buttons | Kalam 400 18px, min-height 46px, padding 0 22px |
| Color | `ink #111`, `text-2 #3A3A3A`, `text-3 #5A5A5A`, `rule #CFCFCF`, `frame-quiet #ABABAB`, `paper-2 #F4F4F2`, `paper-3 #F6F6F4`, hover `#F7F7F5`. No other color. Checkboxes use `accent-color: ink` |
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
| Header and footer | Every studio screen | Direct, with differences | Five sections instead of Desk and Catalog (the information architecture is preserved). "Sign out" stands where the reference has "Public pages", which does not exist yet. No language selector: the interface has one language until the i18n work |
| Desk | `Desk` | **Partial.** The header, title, lede, action buttons, row geometry, thumbnails, drawn dividers, and footer follow the screen | The body is different: the reference shows a searchable, filterable list of all writing (journals, memories, artist journals) with a status on each row. The Studio has only album journals, so the Desk shows statistics as sentences in margin-titled sections (the documented notebook layout) and the in-progress journals as rows. Search, filter chips, and mixed rows were not built |
| Catalog lists (artists, albums, tracks) | `Catalog`, `Albums`, `Artists` | Partial: thumbnails, Kalam titles, metadata, drawn rows | Margin tabs with counts, inline "Edit" and "Remove…" actions, "Add from MusicBrainz" (not built, by decision) |
| Journal editor (new, edit) | `MemoryEditor`, `AlbumEditor` | Partial: writing column up to 760px, 300px margin, opening sentence as a drawn line, quiet writing frame, word count | The top bar (breadcrumb, status, Preview, Publish…), version tabs, ratings, track-by-track (none are built) |
| Dialogs and states | `States` | Direct for dialog geometry and type, the empty panel, and loading. The generated strokes are lighter and less rough than the reference's. Copy keeps the interim wording required by INV-4 | "Leave without saving" uses the browser's own prompt, as before |
| Recently deleted | `States` (the last panel) | Direct for the row; extended into a list page | "Delete now…" is not built, by decision |
| Journal reading | `Grace` (public) | **Faithful extension**: the album journal composition (5fr / 7fr, 88px gap, Kalam opening sentence, 62ch reading) used privately | No public page exists to compare against |
| Album, artist, and track forms; tracklist; sign-in | None | **Faithful extension** through the shared controls | Everything |

## Navigation investigation (issue #23)

**Question.** Does clicking between Studio sections reload the page?

**Method.** `e2e/navigation.spec.ts` sets a marker on `window`, records every request of resource type `document`, and activates Artists, Albums, Tracks, Journals, and Desk in turn, in the production build. It was first run against the unmodified `main` build.

**Findings.**

1. **There is no full-document navigation.** (Kept as a regression test.) No `document` request was made and the `window` marker survived all five navigations. Moving between sections is a client-side navigation. Sign-out is a full navigation, on purpose, so that nothing rendered under the old session can be shown again.
2. **Why it can feel like a reload.** Measured in a temporary probe against the unmodified `main` build and **not kept as a test** (it would fail by design until the follow-up below): each page renders its own header, so the header is a *new DOM node* on every navigation, keyboard focus returns to the top of the page, and the scroll position resets. The link just activated is destroyed. On a server round trip that takes longer than a moment, the old page stays frozen until the new one is ready, with no sign that the click was received.
3. **Next keeps recent routes in the DOM, hidden** (three `<header>`s were found at once), so any test about "the header" must use the visible one.
4. **Not tested:** the development server (`next dev`), where compiling a route on first visit adds delay. That is a likely contributor on the author's machine and is not something the production build can show.

**What changed.** A small, safe addition: while a section loads, its link's underline draws in (`useLinkStatus`), a quiet acknowledgement that changes no boundary. The loading placeholder now shows quiet gray bars. Nothing else was changed.

**What did not, and why.** Moving the header into the shared layout would fix points 1 and 2, but a layout is rendered in the static shell, so an anonymous request would receive the studio's furniture, including "Sign out". [`studio.http.test.ts`](../../src/modules/identity/studio.http.test.ts) requires the opposite, and [Security § Authorization contract](../security.md#authorization-contract) treats the layout as presentation only. Changing that is a decision about the authorization boundary, so it is **a follow-up that needs the author's decision (and probably an ADR)**, not part of a visual task. One option is a layout that checks the session itself before it renders the header, accepting one more session lookup per request.

## Accessibility notes

Checked in the browser by tests, unless marked otherwise:

- No horizontal overflow on 16 Studio pages (every list, `new`, and detail page for artists, albums, tracks, and journals, the journal reading and editing pages, and Recently deleted, in its empty state) at 390, 768, 1280, 1440, and 2560px, with long names (`e2e/layout.spec.ts`). Sign-in at 390px is covered by `mobile.spec.ts`. Open dialogs and the album tracklist editor with many rows are not measured.
- The shell's width and centering match the contract at the same five widths, and the header, content, and footer share their edges.
- A skip link ("Skip to the content") is the first tab stop. After client-side navigation, activating it focuses the *visible* page's `<main>` (asserted; Next keeps earlier routes in the DOM, hidden, with the same id). The navigation links are at least 44px tall and show the 2px focus ring (asserted). Dialogs keep the native `<dialog>` focus trap and Escape handling (unchanged).
- `prefers-reduced-motion: reduce` removes every transition in the Studio (asserted on every visible link and button), and the underline simply appears.
- Status is always a word with a mark. Problems still begin with "Problem:" and are announced. Nothing relies on color.
- Text is no lighter than `#5A5A5A` (placeholders use it; hints `#4F4F4F`). Two non-text values are below the 3:1 WCAG asks of a control boundary: the writing surface's `frame-quiet` outline (`#ABABAB`, about 2.2:1, a documented token, and it turns ink on focus) and the disabled outline `#C8C8C8` (disabled controls are exempt). The first is an open decision below. **Not run: an automated contrast or axe audit.** No new dependency was added for it. This is a gap.
- Forced colors (Windows high contrast): the drawn outlines are background images, so under `forced-colors: active` real 1px borders in the system's colors replace them (primary buttons get 3px). **Written to the specification and reviewed, not tested in a forced-colors browser.**
- Not done: a screen reader pass.

## Open decisions for the author

1. **The layout.** The adopted margins differ by 2.4px at 390 and by 4px at 1440 from the V4.4 mockups, and at 768 the content is much wider than the mockups' 64px padding. Confirm that the ecosystem's contract is what is wanted, or whether the mockups' 64px margin should win above 1000px.
2. **Focus rings on drawn controls.** A conservative ring plus a thicker stroke, against the mockup's thicker stroke alone. Say if the ring looks too heavy.
3. **Header navigation.** Five items, as the studio already has, against the mockup's Desk and Catalog (with Artists, Albums, and Tracks as margin tabs). This is an information architecture change and was not made.
4. **The shared header** (see the investigation). Needs a decision about the authorization boundary.
5. **The writing surface's outline.** The design's `frame-quiet` (`#ABABAB`) is under the 3:1 contrast WCAG asks of a control boundary. It turns ink on focus. Say if it should be darker.
6. **The strokes' character.** They are generated, not copied. Compare the images and say whether the wobble, double line, and corner overshoot read as the same hand.

## Reproducing the review

```sh
pnpm db:test:up
pnpm review:screens        # builds, then captures 21 screens at 390, 768, 1280, 1440, 2560
```

The screens are written to `visual-review/` (ignored by Git, about 105 images). They show only synthetic `[Test] E2E …` text, created through the real forms against the disposable test database, which the global teardown removes. The side-by-side comparisons use the author's local `reference/previews` captures and are made by hand, outside the repository.
