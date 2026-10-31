# Design System

**Status:** visual identity approved (design V4.4, October 31, 2026). Not yet implemented. This document summarizes the approved design for implementation. It does not redesign anything.

## Authority

In order of precedence:

1. **The approved screens:** the rendered V4.4 pages in `reference/refrain/pages/` and their captures in `reference/refrain/previews/`.
2. **The handoff's written rules** (`refrainV44-Handoff.dc.html`), where they agree with the screens. When the handoff text and the screens disagree, the screens win.
3. **Exported CSS and markup are not authoritative.** The `.dc.html` files contain legacy rules from earlier design iterations, such as unused font families and header brand classes. Do not port legacy rules into the implementation.

This document summarizes items 1 and 2. If it disagrees with them, correct this document.

## Reference inventory

| Path | Contents |
| --- | --- |
| `reference/refrain/pages/` | Approved V4.4 screens as `.dc.html` files (1440 px desktop, plus `…Mobile` at 390 px). They open in a browser from that folder; `support.js` is their bundled runtime, and fonts load from Google Fonts. |
| `reference/refrain/pages/refrainV44-Handoff.dc.html` | Implementation guide: principles, typography, color, layout, components, responsive and interaction rules |
| `reference/refrain/previews/` | Full-page PNG captures of every screen: `1-site-desktop`, `2-site-mobile`, `3-admin-desktop`, `4-admin-mobile` |
| `reference/refrain/LEIA-ME.txt` | The original export notes (in Portuguese), preserved as delivered |
| `reference/refrain-home-character.png` | The original character illustration (1536×1024). Byte-identical to `reference/refrain/pages/refrain-character.png`, which the mockups load. |
| `reference/refrain-cursor/` | Pencil cursor: `refrain-pencil-48.png`, `refrain-pencil-32.png`, `refrain-pencil.svg` (master), `refrain-pencil.cur`, `preview.png`, `README.md` |
| `reference/refrain-favicon-kit/` | Favicons (16–512 px), `apple-touch-icon.png`, `favicon.ico`, preview. Drawn from the character's face. |

Reference files are not edited, renamed, recompressed, or deleted. Implementation copies the assets it needs into the application's public assets.

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
| `frame-quiet` | `#ABABAB`, `#111111` on focus | Writing-surface outline |
| `paper` | `#FFFFFF` | Page background |
| `paper-2` | `#F4F4F2` · `#F6F6F4` · `#F7F7F5` | Image loading background · state panels · row hover |
| artwork | original | Covers and photographs only |

There is no other color anywhere, including status, error, and success states, which use words and ink.

## Layout

- Page padding: 64px desktop, 20px mobile, 16px at ≤ 370px. Content max width: 1312px.
- **Notebook layout** (listings, home, studio overview): a 220px margin column for section titles beside one writing column, 64px apart.
- **Album and artist journals:** two columns, 5fr / 7fr, 88px gap. Artwork on the left; title and writing on the right; the track list in the right column.
- **Studio editors:** a writing column (max 760px) and a 300px settings margin, 80px apart. On mobile, settings follow the writing.
- Reading width 62ch; paragraph spacing 1.25em; section spacing 96–104px desktop, 72px mobile; rows with 14–16px vertical padding and a 44px minimum touch height.

## Page furniture

- **Header (public):** minimal, centered navigation: Home, Albums, Artists, Memories. The Home link is the way back to the homepage. There is no logo, wordmark, or site name in the header. The current page has a drawn underline.
- **Header (studio):** "Writing studio" label, centered Desk and Catalog navigation, and a "Public pages" link.
- **Character:** appears only on the public homepage, between the navigation and the introduction. Static, using the original asset, with the approved alt text ("Ink drawing of a person with curly hair and headphones, sitting cross-legged on the floor and writing in a notebook while looking up, next to a stack of records, a mug, a cassette and a few crumpled pages."). It never appears on internal pages or as a header logo. The favicon kit is the only derived use.
- **Footer:** centered and understated. A single rule, then the closing line *some songs take you back.* in Kalam, then the language selector. The language selector exists **only** in the footer, opens upward, and offers English and Português (Brasil). Its note reads: "Changes the interface only. Writing stays in the language it was written in."

## Components

| Component | Rules |
| --- | --- |
| Button | Real `<button>` with a Rough.js outline behind the label. The outline redraws on hover; focus traces it twice. Destructive actions are ink too, with a trash icon and a confirmation. |
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
| Delete | Confirmation, then Recently deleted with Restore. While automatic purge is disabled, the V4.4 copy "gone in 30 days" is inaccurate (see [Design gaps](#design-gaps-from-adr-0002)). |
| Remove catalog record | Confirmation stating that writing stays and how many entries will show the link as plain text |
| Preview | Public layout with a private banner and "Back to editing" |
| Language selector | Footer only; arrow keys move through options; Escape closes and returns focus |
| Motion | Underlines draw in, outlines swap, and chevrons change shape on hover. Every transition stops under `prefers-reduced-motion: reduce`. |

## Pencil cursor

Optional. The approved page mockups do not use it. If it is used, only these existing assets may be referenced:

| Asset | Size | Hotspot | Use |
| --- | --- | --- | --- |
| `reference/refrain-cursor/refrain-pencil-48.png` | 48×48 | `7 43` | Recommended web cursor |
| `reference/refrain-cursor/refrain-pencil-32.png` | 32×32 | `5 28` | Compact alternative |
| `reference/refrain-cursor/refrain-pencil.cur` | 32×32 | `5 28` | Windows cursor format |
| `reference/refrain-cursor/refrain-pencil.svg` | 64×64 viewBox | tip at about `9 56` | Editable master, not served directly |

The cursor applies only under `@media (hover: hover) and (pointer: fine)`. Links, buttons, and selects keep `pointer`; inputs, text areas, and the editor keep `text`. It never replaces the text cursor while editing, and a standard cursor is always declared as the fallback.

`reference/refrain-cursor/README.md` also lists a `refrain-pencil-64.png` that does not exist. Do not reference it. The reference README is preserved unedited.

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

## Design gaps from ADR 0002

[ADR 0002](decisions/0002-domain-model-decisions.md) (Proposed) introduces behavior that the approved V4.4 screens do not show. These gaps need the owner's design approval before the affected screens are built. M0 does not redesign them.

| Gap | Affected screens | What is missing |
| --- | --- | --- |
| Per-track publication | AlbumEditor, Grace | A control to publish an individual track reflection. The V4.4 editor offers only "Mark as favourite" and "Still writing". |
| Per-language visibility | AlbumEditor, ArtistEditor, MemoryEditor, Desk | Visibility shown and changed per language version. V4.4 shows one visibility per entry. |
| Several journals per album or artist | AlbumEditor, ArtistEditor, Grace, Artist, Albums, Artists | Featuring a journal, and how non-featured journals are reached publicly |
| Automatic purge disabled | States, Desk (Recently deleted), delete dialogs | V4.4 copy promises "then it's gone" and "gone in 30 days". It must match actual behavior until purge is enabled. |
| Explicit slug change | Editors | Where a published URL is changed deliberately, and how the redirect is communicated |
