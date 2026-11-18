---
name: refrain-design
description: Refrain's design rules for any UI work, including pages, components, styles, layout, typography, artwork, and responsive or accessibility changes. The visual direction is NOT approved yet. This skill holds the rules that bind now (accessibility, artwork handling, responsiveness, design references) and the empty structure the approved direction will fill. Use it before writing or reviewing any interface code.
argument-hint: "[the screen or component]"
---

# Refrain design

**Work:** $ARGUMENTS

## 1. Approved direction: not yet approved

The visual direction is being developed separately, in Claude Design, from Pinterest references. Until the owner approves it and it is recorded here:

- do not invent a palette, typefaces, a layout system, illustrations, or a visual identity;
- do not copy the archived music diary's v3 design (`archive/`). It is not this product's direction;
- build only neutral, unstyled structure, and only when a task needs it.

When the direction is approved, the owner fills in the sections below. The authority order will be: the approved screens, then the tokens, then this transcription.

### Direction
_Pending the owner's approval._

### Tokens (color, type, spacing, motion)
_Pending. Once approved, define them once, as CSS custom properties in a single file, with light and dark values if the direction has both._

### Typefaces
_Pending. Self-host them with `next/font`; no third-party font requests._

### Components and layouts
_Pending._

## 2. Rules that bind now

**Accessibility** (required on every screen):
- semantic HTML first;
- every control usable by keyboard, with a visible focus indicator;
- targets at least 44 × 44 px;
- WCAG AA contrast for text and essential graphics;
- motion respects `prefers-reduced-motion`;
- `lang` is correct on each page (`en` or `pt-BR`), and on any passage in the other language;
- decorative artwork is `aria-hidden` or has an empty `alt`;
- meaningful artwork has a real text alternative, in both languages.

**Responsive:**
- the layout works at 390 px, with no horizontal page scroll, and at desktop width;
- check both before reporting done.

**Artwork and references:**
- the owner's original artwork is never generated, traced, recolored, or altered;
- an approved asset is copied byte for byte into `public/` (or into managed storage, if the owner decides on that), with its licence recorded;
- `reference/` (including Pinterest captures and Claude Design exports) is local-only and read-only. It is never committed, imported, or linked from code or documentation;
- third-party images (Pinterest, album covers, photographs) are references, not assets: never ship them without verified rights.

**Public and private:**
- Studio controls never appear on public pages;
- every interface string exists in English and Brazilian Portuguese, never hard-coded in one language (the mechanism is an open decision, `docs/decisions/0001-rebuild-foundation.md`).
