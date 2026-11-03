# Design System

**Status:** visual identity approved (design V4.4, October 31, 2026). **Implemented for the Writing Studio** ([working specification](design/studio-visual-fidelity.md)), **since M3.1 for the first public page, the album journal** ([below](#public-album-journal-m31)), **since M3.4 for the Home** ([below](#public-home-m34)), **and since M3.5 for the artist page** ([below](#public-artist-page-m35)); the other public pages (lists, artist journals, memories) do not exist yet. This document summarizes the approved design for implementation. It does not redesign anything.

## Authority

In order of precedence:

1. **The approved screens:** the rendered V4.4 pages in `reference/refrain/pages/` and their captures in `reference/refrain/previews/`. These are the author's local design references and are not in the repository ([Assets](#assets)).
2. **The handoff's written rules** (`refrainV44-Handoff.dc.html`), where they agree with the screens. When the handoff text and the screens disagree, the screens win.
3. **Exported CSS and markup are not authoritative.** The `.dc.html` files contain legacy rules from earlier design iterations, such as unused font families and header brand classes. Do not port legacy rules into the implementation.

This document summarizes items 1 and 2. If it disagrees with them, correct this document. It is the tracked design specification: the implementation must be possible from this document and the tracked assets alone.

## Assets

| Location | Tracked | Contents |
| --- | --- | --- |
| `reference/` | No: local only, ignored by Git | The author's design references: mockups, screenshots, explorations, original working files. Inputs to the design process, never dependencies of the product. |
| `public/` | Yes | Production assets that the application serves. An asset is added only when the application uses it. |
| `docs/assets/` | Yes | Assets used only by documentation, such as the README |

| Tracked asset | Origin | Use |
| --- | --- | --- |
| `public/artwork/refrain-home-character.png` | Byte-identical copy of the local `reference/refrain-home-character.png` (SHA-256 `ad58315e79980337147ef11f30a0ed418a5c3bf509a0a77da81bce59290ba63c`) | The original character illustration (1536×1024): the README in both light and dark themes, and the source of the Home's production copy (next row). Kept unaltered |
| `public/artwork/refrain-home-character.webp` | Derived, with the owner's authorization (M3.4, issue #42), from the original above with the recipe of the approved 404 copy: `cwebp -q 90 -m 6 -sharp_yuv -alpha_q 100 -exact -metadata none` (libwebp 1.6.0). 312,852 bytes (16% of the original's 1,949,226), SHA-256 `e98f523f5bce1262c4e1b4fa525922356dc0acf31b09b4cfc0a69787948edeec`. Same dimensions. Its transparency is lossless: decoded, its alpha channel equals the original's for every one of 1,572,864 pixels, the corners are clear, and 68.5% of the picture is fully transparent. Its colour is lossy: composited on white it is 46.1 dB PSNR from the original, or 41.1 dB over the visible pixels alone; the largest difference is 15 of 255, and 99.97% of channel values differ by 9 or less. The original's C2PA provenance chunk (21,881 bytes) is not carried over | The character on the public Home only (see [Public Home](#public-home-m34)) |
| `public/artwork/refrain-404.webp` | Derived, with the owner's authorization (M3.1, PR #35), from the local original `reference/refrain-404.png` (1536×1024, 8-bit RGBA, 2,824,585 bytes, SHA-256 `7705f803a871cdd9e693dcf9ae2d222fe8545281c4e8b9975699f00ed96c4956`), which stays unaltered outside the repository. Made with `cwebp -q 90 -m 6 -sharp_yuv -alpha_q 100 -exact -metadata none` (libwebp 1.6.0): 467,460 bytes (17% of the original), SHA-256 `c3d879f0a9ad1ecb0ff33c1601abd34ce350c1ffefcaebed6ad5a1ca29fd4a96`. Same dimensions. Its transparency is lossless: decoded, its alpha channel equals the original's for every pixel, the corners are clear, and about 49% of the picture is fully transparent. Its colour is lossy: composited on white it differs from the original by 42.4 dB PSNR, or 39.2 dB over the visible pixels alone (the largest difference is 19 of 255, and 99.9% of channel values differ by 9 or less); a 3× side-by-side of the hair, the hatching, the map lettering, and the cassette shows no visible change. The C2PA provenance chunk of the original PNG is not carried over | The author's approved 404 artwork, on the shared not-found view only (see [Not found](#not-found-and-the-skip-link-m31)) |
| `docs/assets/refrain-home-character-dark.png` | Derived from the original, approved by the author | Not used. It was the README's dark-theme image until pull request #12; the README now shows the original in both themes. Kept in the repository. Same dimensions and transparency as the original, with tones remapped. |

The rules for `reference/` and for promoting assets are in [`AGENTS.md` § 6](../AGENTS.md#6-design-system-boundaries). The favicons and the pencil cursor are promoted into `public/` when the application first uses them.

## Local reference inventory

The author's local `reference/` directory holds the following. It is not in the repository, so these paths are descriptions, not links.

| Path | Contents |
| --- | --- |
| `reference/refrain/pages/` | Approved V4.4 screens as `.dc.html` files (1440 px desktop, plus `…Mobile` at 390 px). They open in a browser from that folder; `support.js` is their bundled runtime, and fonts load from Google Fonts. |
| `reference/refrain/pages/refrainV44-Handoff.dc.html` | Implementation guide: principles, typography, color, layout, components, responsive and interaction rules |
| `reference/refrain/previews/` | Full-page PNG captures of every screen: `1-site-desktop`, `2-site-mobile`, `3-admin-desktop`, `4-admin-mobile` |
| `reference/refrain/LEIA-ME.txt` | The original export notes (in Portuguese), preserved as delivered |
| `reference/refrain-home-character.png` | The original character illustration (1536×1024). Byte-identical to `reference/refrain/pages/refrain-character.png`, which the mockups load. |
| `reference/refrain-cursor/` | Pencil cursor: `refrain-pencil-48.png`, `refrain-pencil-32.png`, `refrain-pencil.svg` (master), `refrain-pencil.cur`, `preview.png`, `README.md` |
| `reference/refrain-favicon-kit/` | Favicons (16–512 px), `apple-touch-icon.png`, `favicon.ico`, preview. Drawn from the character's face. |

Reference files are not edited, renamed, recompressed, or deleted. Implementation promotes only the assets it uses, byte-for-byte, into `public/`.

## Principles

From the handoff:

1. **Black ink on white paper.** The only color on any page comes from album artwork and artist photographs, shown as they are: no filters, tints, or overlays.
2. **Two typefaces with distinct jobs.** Kalam carries identity. Alegreya Sans carries anything read for more than a line, plus metadata and controls.
3. **Strokes mean something.** Rough.js outlines mark what can be acted on (buttons, fields, dialogs) and a few meaningful annotations. Dividers are a single light ink stroke. Text itself is never drawn.
4. **Annotations are data.** A circled track is a recorded favourite; "still writing" is a real flag; a margin note exists only if it was written.
5. **Private stays private.** Drafts and private entries never render on public pages, and preview is visible only to the author.
6. **Two languages.** English and Português (Brasil). The interface switches; the writing stays in its own language unless the author wrote a translation.

## Typography

| Role | Font | Weight | Desktop | Mobile |
| --- | --- | --- | --- | --- |
| Page title | Kalam | 700 | 104px album/artist · 58px listings · 52px editors | 62 · 42 · 30px |
| Section title | Kalam | 700 | 27–31px | 24–25px |
| Opening sentence | Kalam | 300 (only at ≥ 26px) | 31px | 26px |
| Track, entry, album names | Kalam | 400 | 21–22px | 19.5–20px |
| Track numbers, notes | Kalam | 400 | 19–21px | 19–20px |
| Buttons | Kalam | 400 | 16.5–18px | same |
| Long-form reading | Alegreya Sans | 400 | 21px / 1.66, max 62ch | 19.5px |
| Metadata, dates, credits, hints | Alegreya Sans | 400 | 15.5–18px, never below 15px | 15–16.5px |
| Rating values | Alegreya Sans, tabular numerals | 400 | 16–18px | 15–16px |

Kalam and Alegreya Sans are the only approved typefaces. The pages load Kalam (300, 400, 700) and Alegreya Sans (400, 500, 700, italic 400). The exported CSS also declares *Atkinson Hyperlegible Next* and *Caveat*. Those are legacy rules: later rules override them and the fonts are never loaded, so they are not part of the design ([Authority](#authority)).

## Color tokens

| Token | Value | Use |
| --- | --- | --- |
| `ink` | `#111111` | Text, strokes, primary buttons, filled stars, published dot |
| `text-2` | `#3A3A3A` / `#4A4A4A` | Secondary text and metadata (≥ 7:1 on white) |
| `text-3` | `#5A5A5A` | Hints, "not written yet", credits (≈ 6.9:1) |
| `rule` | `#CFCFCF` | Light ink dividers |
| `frame` | `#BDBDBD` | The outline of an artwork frame on the Home (V4.4 `.artfb`): decorative, never a control boundary |
| `frame-quiet` | `#767676`, `#111111` on focus | Writing-surface outline and the opening sentence's line. The V4.4 mockups use `#ABABAB` (2.3:1 on white); the implementation darkens it to meet the 3:1 WCAG 2.2 asks of a control boundary ([Studio visual fidelity](design/studio-visual-fidelity.md#accessibility-notes)) |
| `paper` | `#FFFFFF` | Page background |
| `paper-2` | `#F4F4F2` · `#F6F6F4` · `#F7F7F5` | Image loading background · state panels · row hover |
| artwork | original | Covers and photographs only |

There is no other color anywhere, including status, error, and success states, which use words and ink.

## Layout

- **Studio:** the lateral contract of the RaioViajante sites: `width: min(100% - 35.2px, 1320px)`, centered, so 17.6px each side on a phone and a 1320px shell that stays centered on a wide monitor. Measured in their shared design package; see [Studio visual fidelity](design/studio-visual-fidelity.md#the-lateral-layout-contract-measured). It replaces the mockups' 64px/20px/16px page padding and 1312px width in the Studio; the reading measures below are unchanged.
- Mockup values for the public pages: page padding 64px desktop, 20px mobile, 16px at ≤ 370px; content max width 1312px. The built public pages (the album journal, the Home) use the lateral contract above instead.
- **Notebook layout** (listings, home, studio overview): a 220px margin column for section titles beside one writing column, 64px apart.
- **Album and artist journals:** two columns, 5fr / 7fr, 88px gap. Artwork on the left; title and writing on the right; the track list in the right column.
- **Studio editors:** a writing column (max 760px) and a 300px settings margin, 80px apart. On mobile, settings follow the writing.
- Reading width 62ch; paragraph spacing 1.25em; section spacing 96–104px desktop, 72px mobile; rows with 14–16px vertical padding and a 44px minimum touch height.

## Page furniture

- **Header (public):** minimal, centered navigation: Home, Albums, Artists, Memories. The Home link is the way back to the homepage. There is no logo, wordmark, or site name in the header. The current page has a drawn underline.
- **Header (studio):** "Writing studio" label, centered Desk and Catalog navigation, and a "Public pages" link (the Studio shows "Sign out" there until public pages exist). Exactly two destinations; one row on a wide screen, and the reference's centered vertical composition at 720px and below. Artists, Albums, and Tracks are the Catalog's own navigation, in the margin column ([Studio visual fidelity § Navigation structure](design/studio-visual-fidelity.md#navigation-structure)).
- **Character:** appears only on the public homepage, between the navigation and the introduction. Static, the original drawing served as its production copy (`public/artwork/refrain-home-character.webp`, made from `public/artwork/refrain-home-character.png` with its transparency kept bit for bit; [Assets](#assets)), with the approved alt text ("Ink drawing of a person with curly hair and headphones, sitting cross-legged on the floor and writing in a notebook while looking up, next to a stack of records, a mug, a cassette and a few crumpled pages."). It never appears on internal pages or as a header logo. The favicon kit and the Home's production copy (same drawing, same dimensions, re-encoded) are the only derived uses; the README uses the original file. **One narrow exception, approved by the owner (M3.1, PR #35):** the distinct, approved 404 artwork appears on the shared not-found view and nowhere else; it is a separate drawing, not this one, and it does not authorize the character on any other page.
- **Footer:** centered and understated. A single rule, then the closing line *some songs take you back.* in Kalam, then the language selector. The language selector exists **only** in the footer, opens upward, and offers English and Português (Brasil). Its note reads: "Changes the interface only. Writing stays in the language it was written in."

## Components

| Component | Rules |
| --- | --- |
| Button | Real `<button>` with a Rough.js outline behind the label (in the Studio, a generated CSS background: [Hand-drawn strokes](design/studio-visual-fidelity.md#hand-drawn-strokes)). The outline redraws on hover; focus thickens it, and the focus ring stays. Destructive actions are ink too, with a trash icon and a confirmation. |
| Status | Published: filled dot. Private: drawn circle. Draft: dotted circle. Always shown with the word. |
| Field | Labelled; quiet frame that turns ink on focus |
| Rating | Half steps, optional, "No rating" by default. Album and track ratings are independent. Keyboard-operable as a radio group; the row gets 44px of height. |
| Artwork | Fixed ratio (1:1 covers, 4:5 photos). A "no artwork yet" fallback sits underneath, and the image covers it with `object-fit: cover` once loaded. No layout shift. |
| Divider | One stroke, seeded so it never changes between renders |
| Favourite | A hand-drawn circle around the track name, rendered only from stored data |
| Placeholder text | Brackets mark the author's own words in mockups, such as `[Your opening sentence.]`. Bracketed text is never shipped as content and never machine-translated. |

## Rough.js implementation

- Generate paths once with fixed seeds and ship them as inline SVG. Never re-randomize on render.
- Outlines use `preserveAspectRatio="none"` with `vector-effect: non-scaling-stroke`, so one path fits any width.
- The SVG sits behind the label (`z-index: -1` inside an `isolation: isolate` parent), is `aria-hidden`, and does not intercept pointer events. Labels remain real, selectable text.

## Responsive behavior

- **≤ 720px:** one column everywhere. The footer stacks the closing line over the language selector. Track-list status moves under the title, album grids drop to two columns, and artist journals become a list.
- **≤ 370px:** page padding 16px, album title 54px, tighter album grid. The design was checked at 390px and 360px without horizontal overflow; the implementation must repeat that check.
- Touch targets are at least 44px. Star halves (14×28px) are the documented exception and sit inside a 44px-tall row.

## Interaction patterns

| Pattern | Behavior |
| --- | --- |
| Save | "Unsaved changes" → Save becomes primary → "Saving…" → "Saved just now". A failed save keeps the text on the device and offers "Try again". |
| Leaving with unsaved changes | Dialog: Save and leave / Stay here / Leave without saving |
| Publish / Unpublish | Always a confirmation that says what will happen. Unpublishing never deletes. |
| Delete | Confirmation, then Recently deleted with Restore. While automatic purge is disabled, interim copy replaces "gone in 30 days" (see [Recently deleted](#recently-deleted)). |
| Remove catalog record | Confirmation stating that writing stays and how many entries will show the link as plain text |
| Preview | Public layout with a private banner and "Back to editing" |
| Language selector | Footer only; arrow keys move through options; Escape closes and returns focus |
| Motion | Underlines draw in, outlines swap, and chevrons change shape on hover. Every transition stops under `prefers-reduced-motion: reduce`. |

## Pencil cursor

Optional. The approved page mockups do not use it. If it is used, only these assets from the local references may be promoted into `public/`:

| Asset | Size | Hotspot | Use |
| --- | --- | --- | --- |
| `reference/refrain-cursor/refrain-pencil-48.png` | 48×48 | `7 43` | Recommended web cursor |
| `reference/refrain-cursor/refrain-pencil-32.png` | 32×32 | `5 28` | Compact alternative |
| `reference/refrain-cursor/refrain-pencil.cur` | 32×32 | `5 28` | Windows cursor format |
| `reference/refrain-cursor/refrain-pencil.svg` | 64×64 viewBox | tip at about `9 56` | Editable master, not served directly |

The cursor applies only under `@media (hover: hover) and (pointer: fine)`. Links, buttons, and selects keep `pointer`; inputs, text areas, and the editor keep `text`. It never replaces the text cursor while editing, and a standard cursor is always declared as the fallback.

`reference/refrain-cursor/README.md` also lists a `refrain-pencil-64.png` that does not exist. Do not reference it. The reference README is preserved unedited.

### Not found, and the skip link (M3.1)

**Not found.** The shared view for every address that is not served shows the author's approved 404 artwork above the heading "Nothing here", the line "This page is not available.", and a link back to the start. It is the production copy (`public/artwork/refrain-404.webp`, above), centered, at most 560px wide and never wider than the page, with its own proportions and its width and height declared so that nothing shifts while it loads; its alternative text names what matters ("Ink drawing of a person with curly hair and headphones, scratching their head over a map marked 404."). It is the same for every address and says nothing about why. In forced-colors mode the drawing keeps its own white ground, since black ink on a dark system canvas would vanish. The V4.4 mockups include no 404 screen; the owner approved this composition (the drawing between the navigation and the text, as on the homepage) and the artwork as **a narrow exception** to the homepage-only rule for the character ([`AGENTS.md` § 6](../AGENTS.md#6-design-system-boundaries), and the Character bullet above): the exception covers this view only.

**Skip link.** The first tab stop of every public page is "Skip to content", in Kalam, ink on paper with the 2px focus outline. It is off screen at rest and, while it has focus, is drawn at the top left without changing the page's flow (a link that took space moved the content when activated, so the jump landed off by its height). At 390px it would sit on the navigation, so the navigation is drawn invisible, in place and still focusable, for as long as the skip link has focus; it never covers the writing. Activating it moves focus to the page's single `<main id="main">`, which has no ring of its own because it is not a control. It is hidden in print. This is an addition the V4.4 screens do not show and an accessibility requirement; the studio's skip link works the same way.

## Accessibility baseline

- Semantic HTML first: landmarks, headings in order, real buttons and links, labelled fields.
- A visible focus ring everywhere (`2px solid #111`, offset 4px). Never remove outlines without a replacement.
- Text contrast follows the color tokens above. Never use gray lighter than `text-3` for text.
- Every action is keyboard-operable: rating radio groups, the language menu, track expanders, and dialogs that trap and restore focus.
- Meaningful `alt` text for the character and for artwork ("Album artwork", plus the album title). Decorative SVG is `aria-hidden`.
- `lang` attributes: the document's `lang` follows the interface locale, and each entry body carries the `lang` of its written language.
- Reduced motion is respected, and nothing autoplays.

## Known reference inconsistencies

Each of these is resolved by the [Authority](#authority) rules. The reference files themselves are left unchanged.

1. The handoff typography table lists a "Site name" (Kalam 700, 20px), and its responsive notes say the header "stacks name over navigation". The handoff CSS also defines `.brand` and `.mark` header classes. Every approved public screen shows navigation only. **Resolution:** no logo, wordmark, or site name in the public header.
2. `reference/refrain-cursor/README.md` lists `refrain-pencil-64.png`, which does not exist. **Resolution:** reference only the assets listed in [Pencil cursor](#pencil-cursor).
3. Legacy font declarations (Atkinson Hyperlegible Next, Caveat) remain in the exported CSS. **Resolution:** not part of the design; see [Typography](#typography).

## Public album journal (M3.1)

The first public page follows the approved `Grace` screen (`refrainV44-Grace`, desktop and mobile): two columns (5fr and 7fr, 88px apart) on the RaioViajante lateral contract (`width: min(100% - 35.2px, 1320px)`), the album artwork frame, the kind label, the title in Kalam 700 at 104px (62px on a phone, 54px at 370px and below), the credit with the drawn underline, the facts line, the opening sentence in Kalam 300 at 31px (26px), "My rating" with half-step stars, the writing at 21px and 62 characters (19.5px), the "Track by track" section with one ruled row per track, the favourite circle, the "(still writing)" label, and the closing line. On a phone, the order is the artwork, the heading, the facts, and the writing. The page is implemented in [`src/app/(public)/`](../src/app/(public)/) and [`public.css`](../src/app/public.css), with the strokes of [`strokes.css`](../src/app/strokes.css) (one stroke added, the favourite loop).

Where the approved screen shows something that does not exist yet, or that the data cannot honestly supply, the page shows less, never something invented. Each is a decision recorded here:

| Approved screen | Public page | Why |
| --- | --- | --- |
| The header's four links (Home, Albums, Artists, Memories) | Home, and Albums as the current page (not a link) | No list page exists, and a link to one would be a broken promise. The other links arrive with their pages |
| The language selector in the footer | Not shown | It arrives with next-intl; the page is English, and each piece of writing carries its own `lang` |
| "Written [DATE] · edited [DATE]" | "Published <date>" and "Written in <language>" | The edit date is private editing metadata. The publication date is public by definition |
| The cover from the Cover Art Archive and its caption | **Since M3.2:** the cover the author chose, in the fixed 1:1 frame over the hatched fallback ("Album artwork / loads from Cover Art Archive"), with the caption "Cover: Cover Art Archive" hanging below the frame so the title still sits on its lower edge; without a chosen cover, the hatched frame "Album artwork / not available yet". The frame carries the accessible name ("Album artwork for <title>"); the image itself is decorative inside it | Shown as it is, without filters. The 500 px thumbnail with a 250/500/1200 `srcset`, so nothing moves while it loads, and the fallback remains if it fails. Approved for local development; a hosted page shows covers only after the rights review ([Security § Deployment gate](security.md#deployment-gate), item 6) |
| "Everything in brackets is a placeholder…" | Not shown | A mockup note, not content |
| The "All albums" and "More about <artist>" links | Not shown | Those pages do not exist |
| A track row opens by a button | A native `<details>` with a `<summary>` | Keyboard and screen-reader operation with no script; the reflection is in the page either way |
| Section headings as `h3` in the writing | `h2` in the writing, `h3` in a track's reflection | The outline stays in order under the `h1` and the "Track by track" `h2` |
| A track with no reflection says "not written yet" | The same, also for a track whose reflection is not public | The page never says that a private reflection exists |
| A track's credit under its name (a cover, for example) | Shown when the catalog has one | It is catalog metadata of a track in a public journal |
| Stars drawn with a sketchy double stroke | Geometric stars, filled or outlined, in half steps | Not yet drawn in the hand-drawn style; the rating reads correctly and its name is spoken as a sentence. Revisit with the visual refinement |
| The margin note is hidden at 720px and below | Shown on a phone, after the facts | The author's writing should not disappear on a small screen |
| Links in the writing are ordinary underlined words | A link mark shows its text and no link | No address allow-list exists yet; a link would be an unchecked outbound address |
| A track's panel starts "Written [DATE] · my rating" | The reflection's text only (the rating is in the row) | A reflection has no public date of its own, and the rating is already in the row |
| A hand line under a favourite ("[favourite — …]") | Not shown | It is a placeholder for the author's own words; the model has no favourite note |

The public pages are monochrome with the design's own paper tints, use only Kalam and Alegreya Sans, request nothing from another origin, and have no author control. A request for an address that is not served shows one view, "Nothing here", for every reason, so no case can be told from another. These properties are tested in a browser at 1440px and 390px (`e2e/public.spec.ts`).

## Public Home (M3.4)

The Home follows the approved `Home` screen (`refrainV44-Home`, desktop and mobile), on the RaioViajante lateral contract: the centered navigation with Home as the current page and its drawn underline; the original character, 380px wide (300px at 720px and below, 280px at 370px and below), between the navigation and the introduction; the introduction centered in Alegreya Sans at 23px (20.5px), at most 33em; "Most recent:" with the newest journal's title in Kalam at 21px, "Album journal", and its date; then the notebook layout, a 220px margin column for each section's title (Kalam 700, 27px) beside one writing column, 64px apart, with **Recently written** (one ruled row per journal: the date, the title in Kalam at 22px over "Album journal · <artist>", and a 48px artwork frame) and **Albums** (four to a row, each the square artwork frame, the title, "<artist> · <year>", and the rating as stars and `[4.5]` when one is set). On a phone, each section's title sits over its list, a row puts its date over its title with the frame beside both, and the albums are two to a row. The footer is the closing line. Implemented in [`src/app/page.tsx`](../src/app/page.tsx), [`home-view.tsx`](../src/app/(public)/_components/home-view.tsx), and [`public.css`](../src/app/public.css), with two strokes added to [`strokes.css`](../src/app/strokes.css): `frame` and `frame-small`, the outline of an artwork frame in the screen's `#BDBDBD`, the small one drawn at a 48px thumbnail's own scale so its wobble stays visible; decorative, never a control boundary. The header (22px above the navigation, 16px on a phone, the current page's underline at the foot of its 44px box) and the closing line (Kalam 21px, 19.5px on a phone) take the Home screen's measures; the album journal and the not-found view share them.

What the Home lists is read through the Publication module only: publicly visible album journals, at their current addresses. While public reads are off it is the Home of a site with nothing published ([ADR 0006, A4](decisions/0006-publication-decision-and-acknowledgement.md#a4-the-public-home-a-generic-page-that-lists-only-through-the-predicate)). Where the approved screen shows something that does not exist yet, or that the data cannot honestly supply, the Home shows less, never something invented:

| Approved screen | Public Home | Why |
| --- | --- | --- |
| "[Your introduction, in your own words. Two or three plain sentences: who writes here, and what this journal is for.]" | "A personal music journal about albums, songs, and the memories attached to them." | The author's own words are never generated. This neutral line, not in the first person and with nothing biographical, is interim by the owner's decision (M3.4) and is replaced when the author writes the introduction (`HOME_INTRODUCTION`). It is also the page's description |
| The header's four links (Home, Albums, Artists, Memories) | Home only, as the current page | No list page exists; a link to one would be a broken promise. The others arrive with their pages |
| "Recently written" mixes album journals, memories, and artist journals, each with its icon | Album journals only, with the record frame | Only album journals can be published. Memories and artist journals join the list when they exist |
| The date of a row, "[DATE]" | The publication date of the version a reader is shown | The date a piece was written is private editing metadata (as on the album journal); the publication date is public by definition. The heading stays "Recently written" |
| The **Artists** and **Memories** sections, and "All album journals", "All artists", "All memories" | Not shown | Those pages do not exist |
| The Albums section's four albums | Each album once, by the journal presented for it (the featured one if it is visible, otherwise the most recently published) | ADR 0002, D1.2. "Recently written" lists every published journal, so a second journal about an album is still reachable |
| A row's artwork, and the album card's cover, "no artwork yet" | The cover the author chose, from the Cover Art Archive, over the fallback "no artwork yet" with the record mark; the fallback stays if the image fails | Shown as it is, in a fixed square, so nothing moves while it loads. Decorative inside a link that the album's title names. As on the album journal, approved for local development only; a hosted Home shows covers only after the rights review ([Security § Deployment gate](security.md#deployment-gate), item 6) |
| The record and person icons drawn with a double stroke | The record mark of the album journal page | One mark for every public page. Revisit with the visual refinement, with the stars |
| The language selector in the footer | Not shown | It arrives with next-intl |
| Nothing for an empty journal | "Nothing published yet." under the introduction, and no sections | An intentional empty state, in the line's own place and style. It is also what the Home says while public reads are off, so that state cannot be told from an empty journal |
| Four albums to a row on a wide screen | Three to a row from 961px to 1100px, two from 721px to 960px | The approved screens show only 1440px and 390px; four albums beside the margin column were about 90px wide at 768px, too narrow for a title or a rating, and two at 1024px made covers half again as large as at 1440px |
| The introduction wraps where the line runs out | Balanced lines (`text-wrap: balance`) | A centered paragraph of two or three lines reads better without a single word on its last line. When the author writes the introduction, they can ask for it to be removed |
| A link in running text is underlined in `#A3A3A3` | `#767676`, darkening to ink on hover | The public pages' link style since M3.1 (`.public-link-inline`): the underline is the link's only mark, so it meets 3:1 |
| A row's link reads its date first | The title first, then the kind, then the date; the grid still shows the date first | A screen reader's list of links is scanned by title |
| Nothing for a database failure | "The latest writing could not be loaded just now." in place of the lists, only while public reads are on | The page stays a page; the sentence says nothing about why, or about what exists |

Rendering: the whole Home is rendered on the server per request, in one pass, and sent complete, so it reads the same without JavaScript: the lists, their links, and the footer are in the HTML (M3.4 owner review; an earlier version streamed the lists into hidden markup that only a script revealed). Nothing arrives later, so nothing on the screen moves as the page loads. The drawing has its width and height declared, so nothing shifts while it loads, and in forced colors it keeps its own white ground. Checked in a browser, also with JavaScript disabled, at 320, 390, 640 (which is also 200% zoom of a 1280px window: the sizes are in px, so zoom is what enlarges the text), 768, 960, 961, 1024, 1100, 1101, 1280, 1440, and 2560px, with axe (WCAG 2.2 A and AA), 44px targets (also with a one-letter and a very long title), keyboard and skip link, reduced motion, and forced colors (`e2e/home.spec.ts`).

## Public artist page (M3.5)

The artist page follows the approved `Artist` screen (`refrainV44-Artist`, desktop and mobile) at `/artists/<address>`, on the RaioViajante lateral contract and the album journal's two columns (5fr and 7fr, 88px apart): the photograph's **4:5 frame** on the left, at most 400px wide, with the hatched fallback underneath (the person mark, "Artist photograph", and "not available yet" when there is none); the kind label with the person mark and the name in Kalam 700 at 104px (62px on a phone, 54px at 370px and below) on the right, level with the middle of the frame; then **In this journal** (Kalam 700, 31px) in the left column beside **Album journals** (each album once, by its presented journal: a 120px artwork frame, the title in Kalam at 22px, and "<year> · <written> / <total> tracks") and **Tracks I wrote about** (one ruled row per track with a public reflection: the title in Kalam at 22px and "in <album> · <number>"). On a phone the order is the photograph, its credit, the name, and the lists, with 96px artwork frames. The header marks Artists as the current page (not a link), and the footer is the closing line. Implemented in [`src/app/(artists)/`](../src/app/(artists)/), [`artist-photograph.tsx`](../src/app/(public)/_components/artist-photograph.tsx), [`public-photo-image.tsx`](../src/app/(public)/_components/public-photo-image.tsx), [`person-icon.tsx`](../src/app/(public)/_components/person-icon.tsx), and [`public.css`](../src/app/public.css); no stroke was added. The album journal's credit now links each credited artist to their page; an archived artist's name stays plain text (below).

The photograph is shown as it is, with no filter, tint, or overlay: it and the album covers are the page's only color. It is the one the author chose in the studio (M3.3), never one picked automatically, and it covers its frame with `object-fit: cover`, so nothing moves while it loads. If it cannot be loaded, it is removed and the frame says "not available just now" (and its accessible name says so too), with no broken-image icon; without JavaScript a failed image draws nothing, so the fallback shows.

Where the approved screen shows something that does not exist yet, or that the data cannot honestly supply, the page shows less, never something invented:

| Approved screen | Public artist page | Why |
| --- | --- | --- |
| "Artist journal" as the kind | "Artist" | The page is not an artist journal: artist journals have no public reading contract yet, and their text is never read |
| A facts line ("Singer and songwriter · 1966–1997") | Not shown | The catalog holds no biography, and none is ever generated |
| "[Your opening sentence about him.]" and the essay | Not shown | The author's own words; they arrive with artist journals |
| "Last edited [DATE]" and "Written in English" under the photograph | Not shown | They describe an artist journal |
| The caption "Photo: Wikimedia Commons · [photographer, licence]" | Two short lines, "Photo: [credit]" and "[license, linked] · via Wikimedia Commons", then **Photo details**, a native disclosure marked with the tracks' chevron, with the work (linked to its file on Commons, which is the source), the credit, the source, the license (linked, with the share-alike condition when it applies), and the changes ("Resized, and cropped to fit the frame. No other changes.") | What the license asks for, from the stored provenance alone, kept discreet; the same wording as the studio's. Credits are 15px, the floor for credits. Each link and the summary sits on a line of its own that is a full 44px target (the share-alike condition goes on the line below the license), so no wrapping text can lie over a target, whatever the length of the credit; checked at the top and bottom edge of every target at 1440 and 390px |
| "Album journals: Grace, 1994 · 4 / 10 tracks" | The same form; read aloud as "4 of 10 tracks written about" | "4 / 10" is the count of tracks with a public reflection in the journal shown, out of the reference edition's tracks |
| "Tracks I wrote about" | The same, linking to the album journal's tracks | Only reflections that are public in the version a reader is shown, from the presented journal of each album |
| "Memories with his music: None yet." | Not shown | Memories have no public page; "None yet" would claim a feature that does not exist |
| "All artists" | Not shown | No artist list exists ([Evidence](evidence/m3-5.md#navigation-and-discovery)) |
| The language selector | Not shown | It arrives with next-intl |
| The header's four links | Home, and Artists as the current page | As on the album journal |
| A name that does not fit its column | It wraps between words. The title keeps its sizes (104, 62, and 54px) unless the name's longest word would not fit the column at that size; then it is set just small enough for that word to fit, never below 30px (the owner's visual review of M3.5). Only a word too long even at 30px is broken, with a hyphen where the browser hyphenates | Checked with a 99-character band name at 320, 360, 390, 721, 768, 1024, 1440, and 2560px: no word broken, no sideways scroll; "Jeff Buckley" keeps 104, 62, and 54px exactly, except from 721 to about 760px, where 104px used to break "Buckley" in the middle and it is now set a little smaller |

The page reads the same without JavaScript (it is rendered on the server per request in one pass, as the Home is); one limitation remains: without JavaScript, a photograph whose thumbnail fails keeps the name "Photograph of …" for a screen reader, because only a script can tell that it failed. It was checked in a browser for sideways scrolling at 320, 390, 768, 1024, 1440, and 2560px, and at 1440 and 390px with axe (WCAG 2.2 A and AA), 44px targets, keyboard and the skip link, a visible focus ring, reduced motion, forced colors (the frame and the rules keep real borders), and no layout shift while the photograph loads (`e2e/artist.spec.ts`).

On the album journal, a credited artist that has a page is a link. When a credit holds a link, the drawn underline moves from the whole credit to each linked name, so a name that is not a link (an archived artist) reads as plain text; a credit with no link keeps the line as before. Each link is a 44px target.

## Add music and artwork (M3.2)

**Add music** follows the approved `Search` screen (`refrainV44-Search`): the title and lead, the search field with its magnifier, the kinds to search for, "Already in your catalog" and "From MusicBrainz" as ruled rows with the record icon and an **Add** control (or "In catalog" with its filled dot), the source line ("Data from MusicBrainz. Artwork from Cover Art Archive, added only if you choose it."), and the three states ("Searching MusicBrainz…", "Nothing found for “…”." with its hint, "Couldn’t reach MusicBrainz." with its reassurance and **Try again**). Where it differs:

| Approved screen | Studio | Why |
| --- | --- | --- |
| Three kinds: Albums, Tracks, Artists | Albums and Artists | Tracks arrive with their album; a single-recording import is not in scope |
| **Add** adds the result | **Add** opens the album's editions, then a review, and only the review's **Add to catalog** writes | The author must choose the exact edition and approve what is written |
| The margin holds "Back to the catalog" | The Catalog's own navigation stays in the margin, and "← Back to the catalog" heads the page | The same frame as every Catalog page |
| The three states shown side by side as a sample | Each state shown when it happens | The sample is a mockup note |

The edition list, the review (facts, tracks, artists, the cover choice with **No artwork** selected first, the approval), the link-instead confirmation, and the album's artwork page reuse the studio's rows, panels, buttons, artwork frame, and confirmation dialog; no new component style was introduced beyond the search field, the choice grid, and the review's facts list.

## Artist photographs (M3.3)

The photograph follows the approved `ArtistEditor` and `Artist` screens: the **4:5 frame** (`.art.pt`) with the fallback underneath and the image over it with `object-fit: cover`, so nothing moves while it loads or if it fails; the editor's "Photo (optional)" block with its 150px frame, the hint "No photo. The page works without one.", and **Choose from Wikimedia Commons…**; and, from the `Artist` page, the small muted caption "Photo: … · licence". Color comes only from the photograph. The studio's artist page shows the block after the artist's form; the photograph page and the review reuse the Add music search field, the choice grid, the panels, the facts list, the buttons, and the confirmation dialog. Where it differs:

| Approved screen | Studio | Why |
| --- | --- | --- |
| A "Photo credit" text field ("Photographer, licence"), typed by the author | The credit is read-only, taken from the file's own metadata, with the license linked | The credit must be the one the license asks for; a typed credit could drift from it ([Security § External providers](security.md#external-providers)) |
| The caption "Photo: Wikimedia Commons · [photographer, licence]" | "Photo: [credit] · [license, linked] · via Wikimedia Commons", and a **Photo details** disclosure with the work, credit, source, license, and the changes Refrain makes | A license's conditions (title, creator, source, license link, changes) need more than one line; the disclosure keeps the caption discreet. A credit that already begins "Photo:" is not prefixed again |
| The editor's fallback: an icon, no words; the public page's "Artist photograph / freely licensed, credited" with a hatch | "no photograph yet", in the studio's own fallback style (as "no artwork yet"); "photograph not shown" under a photograph whose thumbnail did not load, and under a candidate | The studio's artwork frame already uses this form, and the words must stay true when a photograph exists but is not displayed; the public `Artist` page, with its hatch, is not built |
| The block inside the editor's form, titled "Photo (optional)" | Its own section after the artist's form, titled "Photograph (optional)", with "(optional)" in Alegreya Sans as in the reference | The studio's artist page is a catalog record, not the artist-journal editor, and the photograph is saved by its own review, not by the form's Save |
| **Choose from Wikimedia Commons…** opens a picker | It opens a page: suggestions through Wikidata, a search, the photograph on file and how it compares with Commons, then a review page with **Use this photograph** and **Cancel** | The author must see the license, the creator, and the rights notes before choosing, and a page survives a reload |
| A candidate shown as the artist | Candidates are named by their file ("Candidate: …"), with "A search finds words, not people." | Neither a search nor Wikidata proves who is in a photograph |

The frame and the attribution are presentational components with no administrative control ([`artist-photograph.tsx`](../src/app/studio/artist-photograph.tsx)). Since M3.5 the public artist page shows the photograph with its own components in the public style, sharing the caption rule ([below](#public-artist-page-m35)). A photograph whose thumbnail fails to load is removed from the frame, so only the fallback remains (no broken-image icon). Checked in a browser at 1280px and 390px with axe, 44px targets, and no sideways scrolling (`e2e/photos.spec.ts`).

## Writing Studio controls for ADR 0002

[ADR 0002](decisions/0002-domain-model-decisions.md) requires administrative controls that the V4.4 studio screens do not show. This section specifies their placement and behavior.

**Boundaries:**

- These controls exist **only in the Writing Studio**. No administrative control appears on public pages.
- The public V4.4 screens (Home, Albums, Grace, Artists, Artist, Memories, Memory) are unchanged.
- Each control reuses an existing V4.4 component: Rough.js button, checkbox, field, status mark (dot, circle, or dotted circle, always with the word), or confirmation dialog, in the existing layout regions. No new visual language is introduced.
- English copy is given below. Brazilian Portuguese strings are added with the rest of the interface catalog.

### Per-language publication

*Editors (AlbumEditor, ArtistEditor, MemoryEditor) and Desk.*

- The editor already has version tabs ("Original · English", "Author's translation · Português"). The **Visibility** panel in the settings margin applies to the **selected version**. Its heading names that version, for example "Visibility · English (original)".
- "Publish…" and "Unpublish…" act on the selected version only. The confirmation names the language: "Publish the English version?" The other version's state is shown beneath, read-only, for example "Português: Draft".
- "Publish…" is offered for a draft and for a private version alike, with the same confirmation. If what the author reviewed has changed when they confirm (another tab saved, a flag changed), the dialog stays open, shows what changed, and asks again; nothing is published.
- The status beside the title in the editor's top bar shows the selected version.
- Desk rows show one status mark per existing version, for example "Published · EN", "Draft · PT".
- A translation tab exists only after the author creates the translation. Nothing is generated (ADR 0002, D3).

**As built in M2.3 (the studio has no version tabs yet, because no translation can be authored):** each language version has its own *Visibility · English (original)* panel in the journal page's *Manage* column, with its status mark and word. For a draft or private version: *Draft*, *Private*, and **Publish…**; for a published one: **Unpublish…**, which asks first, offers to leave it *Private* or as *A draft*, and says that nothing is deleted. **Publish…** opens a review dialog (the confirmation named above): the opening sentence, the reflection, the address (the address itself, not a path, because no public route exists yet), the album rating, every track reflection that will be published with its track and language and a count, what stays private (written reflections that are not included when published, by track title only), and a plain sentence that no web page exists yet. The confirm button names the language ("Publish the English version"). **The review never saves anything** (owner decision on PR #32): closing it, by Cancel or Escape, leaves everything as it was. To change which reflections are included, a link takes the author to the track editor, where the ordinary save applies and a new review lists the set as it then stands. This replaces the spec's per-row unchecking inside the dialog, which [ADR 0006 § 2](decisions/0006-publication-decision-and-acknowledgement.md#2-the-disclosure) describes as an ordinary save that takes effect at once; ADR 0006 records the change as [amendment A1](decisions/0006-publication-decision-and-acknowledgement.md#amendments). Another language version's state is shown in its own panel.

**Artist pages in the review (M3.5).** When publishing would open public artist pages (an artist credited on the album that has no page yet), the review adds **Artist pages that will open (n)**: each artist's name, its address (`/artists/<address>`), and "With the photograph <title> (<credit>, <license>)" or "Without a photograph", with the hint that each credited artist gets a page and that the album's credits are where to leave one out. When a namesake's page would change address, **Artist pages whose address changes** says from what to what. Both use the review's existing rows, appear only when not empty, and are part of what the confirmation binds ([ADR 0006 A5](decisions/0006-publication-decision-and-acknowledgement.md#a5-artist-pages-open-only-through-a-confirmed-publication), approved by the owner on 2026-11-03).

### Per-track publication

*AlbumEditor, Track by track.*

- The expanded track panel gains a third checkbox, beside "Mark as favourite" and "Still writing": **"Include when published"**, with the hint "Publishes nothing by itself: it counts once this language version is published. Public web pages are not available yet." It is off by default. (Renamed from "Show on the public page" by the owner on PR #32, because no public page exists yet and the flag alone publishes nothing.)
- The track row's status area adds the visibility word after the writing state, for example "written · public" or "still writing · private". The two are never merged (INV-2). A reflection that is included when published but is not part of a published language version reads "included when published", so that "private" (not included), "included when published" (selected, not published yet), and "public" (part of a published version) are three different words. The open panel says in a sentence which one it is, and never describes the checkbox as enough on its own.
- The confirmation for publishing the journal **lists every reflection that will be published, each with its track and language**, for example "Track 3 · English", with the address and the album rating when one is set, and states how many. A count alone is not enough ([ADR 0005 § 5](decisions/0005-restoring-deleted-journals.md#5-required-condition-for-the-m2-publishing-interface), items 2 and 3). **The dialog changes nothing**: it has no control that saves a track's setting, and cancelling it leaves everything as it was. It carries a link to the track editor, where the author changes "Include when published" with the ordinary save, and then reviews again. The confirmation is required even when no reflection will be included, and then says so. Publishing never changes any track's setting.
- On the public page, nothing changes: published reflections render as in the Grace mockup, and any other track shows "not written yet".

### Changes to a published version

*Editors, settings margin and Save.* *Accepted in [ADR 0006 § 5](decisions/0006-publication-decision-and-acknowledgement.md#5-changes-after-publication).*

- While the selected version is published, the editor says so beside the title and above Save, in words and always visible: "This version is published. Saving changes the public page."
- Save on a published version first asks the server what would change. When anything in the published writing would change (any edit of the version's text, **including a shorter one** or clearing a field, and any reflection, rating, or link that appears or changes), the existing confirmation dialog names it and offers "Save and update published writing" and "Cancel" (titled "Update published writing?"). Cancelling writes nothing. Removing something from the public page (unflagging a reflection, clearing the rating, unpublishing) does not open this dialog; it keeps its ordinary confirmation.
- Turning on "Include when published" for a reflection, or adding text to a reflection that is already included when published, in a language that is published, asks the same way.
- There is no autosave of a published version. The text stays in the editor whatever happens.
- **Built in M2.3.** The change dialog ("Update published writing?") shows each change as "Published now" and "Published after saving", offers **Save and update published writing** and **Cancel**, and starts with focus on its title so that a keypress cannot confirm before anything was read. Cancelling writes nothing and leaves the text in the editor; a refusal (the review ran out, or something changed) says so and offers **Review it again**, which the author chooses. A save that changes nothing a reader sees, or only removes something, saves without the dialog. Until M3, no public page exists, and the dialog says that the change updates what is marked as published in the records.
- Changing the address of a published entry always asks: the dialog names the new address and says that the old one will redirect to it.
- Saving a draft, a private version, or a reflection that is not public never asks.

### Featured journal

*AlbumEditor and ArtistEditor settings margin, under "From your catalog".*

- A checkbox, **"Feature this journal"**, with the hint "This is the journal readers see for Grace."
- When another journal about the same album or artist is already featured, checking the box opens a confirmation: "Feature this journal instead of the one from [DATE]?" Accepting moves the feature in one transaction (INV-1).
- The Catalog shows how many journals an album or artist has, and which one is featured.
- **Public pages show only the resolved journal** (ADR 0002, D1.2), exactly as in the V4.4 album and artist pages. Non-featured published journals are reachable through their own URLs and through existing entry lists such as "Recently written". A public element listing other journals about the same album would be a public design change, and is not part of this specification.

### Slug changes and redirects

*Editors, settings margin.*

- An **Address** field shows the public path, for example `/albums/grace`.
- **Before first publication:** the address follows the title automatically until the author edits it. It is normalized as the author types (ADR 0002, D7.2), and collisions are reported inline with the suggested suffix.
- **After first publication:** the field is read-only, with a "Change address…" button. Its dialog takes the new address, shows the normalized result, and states: "The old address will keep working and will lead here." Confirming records the redirect (D7.4).
- Previous addresses are listed beneath the field, read-only. They cannot be deleted or reassigned (D7.5).

### Recently deleted

*Desk.*

- "Recently deleted (n)" on the Desk opens a list of deleted entries, newest first. Each row shows the title, kind, and "deleted [DATE]", with **Restore** and **"Delete now…"** actions.
- "Delete now…" opens a second confirmation: "Delete permanently? This can't be undone." It is the only permanent deletion while automatic purge is disabled.
- **Interim copy (INV-4).** Until a tested purge mechanism is enabled, the V4.4 strings are replaced:

  | V4.4 string | Interim English | Interim Brazilian Portuguese |
  | --- | --- | --- |
  | Delete dialog: "The writing moves to Recently deleted for 30 days, then it's gone. …" | "The writing moves to Recently deleted. You can restore it until you delete it permanently. Albums, artists and tracks stay in your catalog." | "O texto vai para Excluídos recentemente. Você pode restaurá-lo até excluí-lo de vez. Álbuns, artistas e faixas continuam no catálogo." |
  | Row meta: "deleted [DATE] · gone in 30 days" | "deleted [DATE] · can be restored" | "excluída em [DATE] · pode ser restaurada" |

  The V4.4 wording returns when automatic purge is enabled.
