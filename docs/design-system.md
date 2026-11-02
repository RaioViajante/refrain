# Design System

**Status:** visual identity approved (design V4.4, October 31, 2026). **Implemented for the Writing Studio only** (branch `feat/studio-visual-fidelity`, [working specification](design/studio-visual-fidelity.md)); the public pages do not exist yet. This document summarizes the approved design for implementation. It does not redesign anything.

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
| `public/artwork/refrain-home-character.png` | Byte-identical copy of the local `reference/refrain-home-character.png` (SHA-256 `ad58315e79980337147ef11f30a0ed418a5c3bf509a0a77da81bce59290ba63c`) | The original character illustration (1536×1024): the public homepage, and the README in both light and dark themes |
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
| `frame-quiet` | `#767676`, `#111111` on focus | Writing-surface outline and the opening sentence's line. The V4.4 mockups use `#ABABAB` (2.3:1 on white); the implementation darkens it to meet the 3:1 WCAG 2.2 asks of a control boundary ([Studio visual fidelity](design/studio-visual-fidelity.md#accessibility-notes)) |
| `paper` | `#FFFFFF` | Page background |
| `paper-2` | `#F4F4F2` · `#F6F6F4` · `#F7F7F5` | Image loading background · state panels · row hover |
| artwork | original | Covers and photographs only |

There is no other color anywhere, including status, error, and success states, which use words and ink.

## Layout

- **Studio:** the lateral contract of the RaioViajante sites: `width: min(100% - 35.2px, 1320px)`, centered, so 17.6px each side on a phone and a 1320px shell that stays centered on a wide monitor. Measured in their shared design package; see [Studio visual fidelity](design/studio-visual-fidelity.md#the-lateral-layout-contract-measured). It replaces the mockups' 64px/20px/16px page padding and 1312px width in the Studio; the reading measures below are unchanged.
- Mockup values, kept for the public pages until they are built: page padding 64px desktop, 20px mobile, 16px at ≤ 370px; content max width 1312px.
- **Notebook layout** (listings, home, studio overview): a 220px margin column for section titles beside one writing column, 64px apart.
- **Album and artist journals:** two columns, 5fr / 7fr, 88px gap. Artwork on the left; title and writing on the right; the track list in the right column.
- **Studio editors:** a writing column (max 760px) and a 300px settings margin, 80px apart. On mobile, settings follow the writing.
- Reading width 62ch; paragraph spacing 1.25em; section spacing 96–104px desktop, 72px mobile; rows with 14–16px vertical padding and a 44px minimum touch height.

## Page furniture

- **Header (public):** minimal, centered navigation: Home, Albums, Artists, Memories. The Home link is the way back to the homepage. There is no logo, wordmark, or site name in the header. The current page has a drawn underline.
- **Header (studio):** "Writing studio" label, centered Desk and Catalog navigation, and a "Public pages" link (the Studio shows "Sign out" there until public pages exist). Exactly two destinations; one row on a wide screen, and the reference's centered vertical composition at 720px and below. Artists, Albums, and Tracks are the Catalog's own navigation, in the margin column ([Studio visual fidelity § Navigation structure](design/studio-visual-fidelity.md#navigation-structure)).
- **Character:** appears only on the public homepage, between the navigation and the introduction. Static, using the original asset (`public/artwork/refrain-home-character.png`), with the approved alt text ("Ink drawing of a person with curly hair and headphones, sitting cross-legged on the floor and writing in a notebook while looking up, next to a stack of records, a mug, a cassette and a few crumpled pages."). It never appears on internal pages or as a header logo. The favicon kit is the only derived use. The application and the README use only the original.
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

**As built in M2.3 (the studio has no version tabs yet, because no translation can be authored):** each language version has its own *Visibility · English (original)* panel in the journal page's *Manage* column, with its status mark and word. For a draft or private version: *Draft*, *Private*, and **Publish…**; for a published one: **Unpublish…**, which asks first, offers to leave it *Private* or as *A draft*, and says that nothing is deleted. **Publish…** opens a review dialog (the confirmation named above): the opening sentence, the reflection, the address (the address itself, not a path, because no public route exists yet), the album rating, every track reflection that will be public with its track and language and a count, what stays private (written reflections that are not set to show, by track title only), and a plain sentence that no web page exists yet. The confirm button names the language ("Publish the English version"). **The review never saves anything** (owner decision on PR #32): closing it, by Cancel or Escape, leaves everything as it was. To change which reflections are shown, a link takes the author to the track editor, where the ordinary save applies and a new review lists the set as it then stands. This replaces the spec's per-row unchecking inside the dialog, which [ADR 0006 § 2](decisions/0006-publication-decision-and-acknowledgement.md#2-the-disclosure) describes as an ordinary save that takes effect at once; the ADR is not edited here. Another language version's state is shown in its own panel.

### Per-track publication

*AlbumEditor, Track by track.*

- The expanded track panel gains a third checkbox, beside "Mark as favourite" and "Still writing": **"Include when published"**, with the hint "Publishes nothing by itself: it counts once this language version is published. Public web pages are not available yet." It is off by default. (Renamed from "Show on the public page" by the owner on PR #32, because no public page exists yet and the flag alone publishes nothing.)
- The track row's status area adds the visibility word after the writing state, for example "written · public" or "still writing · private". The two are never merged (INV-2). A reflection that is included when published but is not part of a published language version reads "included when published", so that "private" (not included), "included when published" (selected, not published yet), and "public" (part of a published version) are three different words. The open panel says in a sentence which one it is, and never describes the checkbox as enough on its own.
- The confirmation for publishing the journal **lists every reflection that will be shown, each with its track and language**, for example "Track 3 · English", with the address and the album rating when one is set, and states how many. A count alone is not enough ([ADR 0005 § 5](decisions/0005-restoring-deleted-journals.md#5-required-condition-for-the-m2-publishing-interface), items 2 and 3). **The dialog changes nothing**: it has no control that saves a track's setting, and cancelling it leaves everything as it was. It carries a link to the track editor, where the author changes "Show on the public page" with the ordinary save, and then reviews again. The confirmation is required even when no reflection will be shown, and then says so. Publishing never changes any track's setting.
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
