---
name: refrain-design
description: Refrain's design rules for any UI work, including pages, components, styles, layout, typography, artwork, photographs, motion, and responsive or accessibility changes. Holds the approved visual direction (decision 0002), how to port a screen from the local reference with high fidelity, and the accessibility, artwork, and privacy rules. Use it before writing or reviewing any interface code.
argument-hint: "[the screen or component]"
---

# Refrain design

**Work:** $ARGUMENTS

## 1. Approved direction (decision 0002)

The owner approved the Claude Design reference of 2026-11-18. **Implement it; do not redesign it.** No generic layouts, dashboard kits, or component libraries that change its character.

**Authority order:** the reference screens (`reference/refrain-referencia/paginas/**.dc.html`, local-only), then the tokens in `src/app/globals.css`, then this transcription. When they disagree, the screen wins; record the difference here.

### Direction
A personal mixtape archive as an editorial zine: paper, ink, one typeface, faded colour photographs, a few hand-drawn stars. Four principles from the system sheet: **paper** (much white space, nothing touches), **silence** (one figure per section, none near the end), **memory** (faded photographs, never too happy), **voice** (lower case, no full stop in titles).

### Tokens (`src/app/globals.css`, `:root`)
- **Colour:** paper `#FBFBF8` · ink `#141414` · soft text `#2F2C27` · mid `#4F4B44` (artists, link hover) · meta `#6B675F` · faint `#77736B` (lightest grey allowed in text) · soft rule `#E4E2DC`. No accent colour: colour comes from the photographs. Paper only; there is no dark theme.
- **Type scale** (desktop / mobile): page title 136 / 58 px (−0.04em, 0.95) · section 96 / 44 (−0.035em, 1) · word 72 / 36 (−0.04em, 0.95) · subsection 60 / 32 (−0.03em, 1.05) · lede italic 24 / 19 (1.3) · body 17–18 / 15–17 (1.55) · track bold 20 · meta 13 / 12 · label 11 / 10.5, upper case, 600, 0.08em · section number 12 / 10.5, 600. **No text below 10.5 px.**
- **Motion:** easing `cubic-bezier(.16, 1, .3, 1)` (`--out`) and `cubic-bezier(.22, .61, .36, 1)` (`--ease`). Page fades in 0.8 s; titles rise 0.4em in 1.2 s; photographs develop in 2.4 s; titles, tracks, and photographs enter on scroll; quotes come out of blur; stars breathe in 7 s, out of step; constellation lines march in 30 s. **All of it is off under `prefers-reduced-motion`.**
- **Photographic treatment:** `saturate(.62) brightness(.93) contrast(.86) sepia(.1)` (`.mood`); covers warm up on hover.

### Typefaces
**Inter only**, self-hosted by `next/font` (`src/app/layout.tsx`), with italics and the optical-size axis. Titles at weight 400, lower case, no full stop. Bold only for track names, primary links, and signatures. Italic for voice: phrases, notes, long captions. The owner's handwriting font is not used.

### Components and layouts
- **Shared classes** keep the reference's names so screens can be compared rule by rule: `rf` (cursor), `pg` (page fade), `nl` (line link), `pl` (▶ link), `hm` (home star), `cv`/`tape` (cover lift), `mood`, `trk` (track hover), `tw` (star breath), `t-in`/`t-in2`, `dev-in`, `rv`, `q`, `ph`, `march`.
- **Components** (`src/components/`): `SiteHeader` (star home link, absent on the home page; centred menu; current page underlined with `aria-current`; never the word "refrain"), `SiteFooter` (the road photograph on every public page, `~ refrain ~`, menu, `vol. I · 2026`), `Sparkle` and `Trees` (marks), `PlayLink` and `LineLink`, `Photo` (owner photographs with treatment and focal point).
- **Title rules:** a title over a photograph starts half its font size above the photograph's foot (68 px at 136, 29 px at 58). A two-line title's second line starts 0.375 × the size before the first line ends (51 px at 136); on mobile, always 75 px after the first line's start.
- **Marks:** at most one star per section; the tree engraving only opens inner pages; nothing right before the footer; 22 px stars mark track notes.
- **Studio:** same paper and type; the primary action is a black, square-cornered button.

### Porting a screen
1. Read its `.dc.html`: CSS in `<style>`, markup in `<x-dc>`, texts in `const t = { pt: … }` (ignore `en`), data in `renderVals()`.
2. Desktop boards are 1440 px wide. A full-width composition (`aspect-ratio` + `container-type: inline-size`, children in `%` and `cqw`) ports directly. A `<main>` with `max-width: 1360px; padding: 0 40px` is content-box: its coordinates span **1440**, so convert px to `cqw` over 1440. Clamp small text with `max(<min px>, <n>cqw)`.
3. Mobile boards (`…Mobile.dc.html`) are separate compositions at 390 px, below `47.99rem`.
4. Interface strings come from the reference's `pt` texts; the owner's writing comes from the database (decision 0002), never hard-coded.
5. Compare screenshots of the page and the reference at 1440 and 390 before reporting done.

## 2. Rules that always bind

**Accessibility:**
- semantic HTML first;
- every control usable by keyboard, with a visible focus indicator (1 px dashed, offset 4 px);
- targets at least 44 × 44 px (pad the reference's links when needed, keeping their look);
- WCAG AA contrast for text and essential graphics (nothing lighter than `#77736B` for text);
- motion respects `prefers-reduced-motion`;
- `lang="pt-BR"`; mark a passage in another language with its own `lang` when it is more than a title;
- decorative artwork is `aria-hidden` with an empty `alt`;
- meaningful photographs have a real text alternative, written by the owner in the Studio.

**Responsive:**
- the layout works at 390 px, with no horizontal page scroll, and at desktop width;
- check both before reporting done.

**Artwork and photographs:**
- preserve originals: never generate the owner's artwork, and never edit an asset without the owner's explicit authorization for that edit;
- authorized edits produce a new file; the original stays intact, byte for byte;
- every committed artwork file is listed in `docs/assets.md` with its source and SHA-256 (`src/assets.test.ts` enforces it), under `LICENSE-ARTWORK.md`;
- photographs are never committed. They are uploaded in the Studio and appear publicly only once the owner confirms the right to publish them;
- editing a file, by hand or with AI, does not grant copyright or publication rights.

**References:**
- Pinterest pins and other references are inspiration, not licensed assets;
- `reference/` (the Claude Design export and its ZIP) is local-only and read-only: never committed, imported, or linked from code, documentation, CI, builds, or deployments.

**Public and private:**
- Studio controls never appear on public pages;
- interface strings are in Brazilian Portuguese, in code; there is no i18n layer.
