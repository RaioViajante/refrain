# Evidence: v3 foundations, public pages, and the Studio shell

**Status: on branch `feat/v3-foundations`, stacked on the R0 decision pack (draft PR #103). Not merged.**

The design is the owner-approved v3 reference. Its adoption is **proposed** in [ADR 0011](../decisions/0011-refrain-v3-identity-and-product.md) and is not accepted, so merging this work needs that acceptance.

This branch covers R1 (foundations) and the public-page part of R3 and R8, built on the existing read models with **no migration**. It also includes the Studio's v3 shell.

## What is built

### Foundations

- **Stylesheet.**
  - `src/app/v3/v3.css` is generated from the reference's page stylesheets, scoped under `.pp`.
  - Fonts come through `next/font` (`src/app/v3/fonts.ts`).
  - The pen circle is renamed `.penring`, because Tailwind generates a `.ring` utility.
  - Hand-written adaptations are in `src/app/v3/frame.css`.
- **Chrome assets.** Promoted byte for byte to `public/v3/`, with the SHA-256 of each source and copy equal:

  | File | SHA-256 |
  | --- | --- |
  | `paper.jpg` | `b3c9df0a…` |
  | `lined.jpg` | `cc0b4d54…` |
  | `navy.jpg` | `fa6f8784…` |
  | `torn-top.png` | `80766ad9…` |
  | `torn-bottom.png` | `10bbbe34…` |
  | `tape-a.png` | `9f88f756…` |
  | `tape-b.png` | `36f4299a…` |
  | `cur-rec.svg` | `8eaa0794…` |
  | `cur-link.svg` | `d5f440e0…` |
  | `favicon.svg` | `7cd83dc8…` |
  | `touch-icon.png` | `b4205619…` |
  | `portrait-ph.jpg` | `b1127cf7…` |

  No example cover or photograph is committed.
- **The frame** (`src/app/v3/frame.tsx`):
  - the Home and inner headers, with the pen circle;
  - EN/PT as links in the header and the footer;
  - the torn navy footer;
  - the skip link.
- **Runtime and sound.**
  - `src/app/v3/runtime.tsx` is the reveal observer, the pen scribble, the hero scroll, and the sound toggle.
  - `src/app/v3/sfx.ts` is a typed port of `sfx.js`. Sound is off until the footer toggle, never persisted, and never looping.
  - Under `prefers-reduced-motion`, nothing moves and nothing waits to be revealed.
- **Copy.**
  - EN/PT strings are extracted from the reference (`src/i18n/v3`), without its sample values: example names, titles, numbers, and bracketed placeholders.
  - Templates replace the reference's sample-bearing lines (`src/i18n/v3/templates.ts`).

### Public pages

All are drawn from the reference markup:
- **Home:** hero, recently written, sleeves, memory board, lined excerpt, voices.
- **Albums:** the orbit, and the list with four sorts.
- **Album journal:** sleeve, rating circle, margin note, native `<details>` track rows, the crate.
- **Artists:** featured strips, the cloud, A to Z.
- **Artist:** the torn portrait, labels, the shelf.
- **Memories:** grouped by year.
- **Memory:** print, lined sheet, the song record, labels, previous / all / next.
- **About:** the liner notes.
- **404:** the skipping record.

### Studio shell

The reference's sidebar, top bar, and thin-line controls (`src/app/v3/studio.css`, `src/app/v3/studio-theme.css`, `src/app/studio/frame.tsx`). Every existing screen, editor, dialog, and confirmation is unchanged in behaviour.

### The Desk

The v3 Desk (`src/app/studio/screen.tsx`), from the same queries as before and with no new read. It has:

- the greeting;
- three quick-create cards;
- **Keep writing:** every unpublished album journal and memory, most recently edited first, each opening its editor, with "x of y tracks written" kept;
- **On the site:** the published album journals and memories, as PostgreSQL counts them;
- **Recently published;**
- the Recently deleted link, "All memories", and the catalog line.

## Adaptations, each with its reason

| Reference | Built | Why |
| --- | --- | --- |
| Language as `<button>`s that switch component state | Links to the same page in the other language | ADR 0008 § 6: the URL is the only language state |
| `.ring` | `.penring` | A Tailwind utility collides with `.ring` |
| Track rows as buttons | Native `<details>` drawn the same way | They open with the keyboard and without JavaScript |
| One-click Publish, a 30-day purge, "follow their browser" | Not built | ADR 0011 § 3 (C1–C3) |
| The fine line "TRANSLATED FROM … · READ THE ORIGINAL" | Only the shown version's language | Naming another version would reveal one that may be private (INV-3) |
| "his albums here" | "the albums here" | No pronoun is assumed for an artist |
| One song per memory | Every song the memory names: the first on the record, the others listed under it | Limiting a memory to one song is open (D14); no author data is hidden |
| Artist photos as CSS background | Real images with `referrerPolicy="no-referrer"` and a credit with `noreferrer` links | No referrer reaches Wikimedia; attribution as the licence asks |
| Photos in the Artists archive strips | The kraft "no photo" strips | Photographs stay on each artist's page, by the owner's earlier decision |
| Memory photographs | Lined paper with the title | Media storage is proposed (ADR 0012 § 4), not built |
| The author's About lines, initials, thanks, "since" | Not shown | They have no storage yet; nothing is invented, and no bracket placeholder ever reaches HTML |
| No sources row on About | A sources row | Attribution (D7) |
| Album label (Columbia) on the page | Not shown | Not in the v3 design; catalog data only |
| Grey text `#6E6A63` on paper (4.44:1) | `#67635C` (4.93:1) | WCAG AA; axe found it (D10, pending the owner's sign-off) |
| "Not written yet" rows in `#9A958C` (about 2.8:1) | The page grey | WCAG AA; axe found it |
| The fine print's link at 15 px | A 44 px target, set on the line's middle | The repository's 44 px rule |
| Desk: "Everything saves on its own." | Only "Pick up a draft or start something new." | Autosave is R4, not built; the page must not claim it |
| Desk: "+ Album journal" hint "Find a record on Music Story…" | "Choose a record from your catalog…" | Music Story is not connected (MS-0, MS-1) |
| Desk: "+ Memory" hint "A photo, a song and what happened." | "A song and what happened." | Memory photographs are R5 and R6, not built |
| Desk: "+ Artist journal" card | "+ Add music" (the catalog's MusicBrainz search) | Artist journals are R7, not built; the card keeps the reference's three-card row with a screen that exists |
| Desk: "On the site" with three figures, and the Music Story usage panel | Two figures (album journals, memories); no usage panel | Public artist counts need a Publication read, and Music Story is not connected |
| Desk: "Recently published" by publication time | Published entries by their last edit | No new query; the publication history is not read on the Desk yet |
| Desk: 30 to 36 px buttons and rows | 44 px targets (a title's target reaches into the row's padding, so the rhythm is the reference's) | The repository's 44 px rule |
| Studio content padding 32 px (16 px on a phone) plus V4.4's 17.6 px inset | The reference's padding only | The inset doubled the gutter; at 320 px a rating row wrapped |

## The About route

`/about` and `/pt/about` are answered as the archives are: the proxy's identical unknown-address `404` while public reads are off, `GET` and `HEAD` only, `no-store`. They are classified in `src/app/public-surface.test.ts` and in the route-parity test. They read no journal.

## Visual comparison

Comparisons were made locally against the reference screenshots, at 1440 px and 390 px (2×), with reduced motion (the settled state):
- The harness lives outside the repository. It uses the existing production-server helper on the disposable test database, with the repository's synthetic `[Test]` seeds.
- Side-by-side captures were inspected for the 404, the album journal (desktop and phone), Home, Albums, Artists, Artist, Memories, and Memory.
- Structure, objects, typography, and colour match the reference.
- The differences come from the data: `[Test]` titles, no photographs, white-label covers while the cover switch is off.

**Not done:** the automated per-section pixel-diff report described in Design System, Part I.

## Verification

Each check was run on the branch on 2026-11-15, and its output was read. Database suites ran on a freshly reset disposable test database (`pnpm db:test:down && pnpm db:test:up`).

| Check | Result |
| --- | --- |
| `pnpm lint` | Clean |
| `pnpm format:check` | Clean |
| `pnpm typecheck` | Clean |
| `pnpm test` | 57 files, 1,284 tests passed |
| `pnpm test:integration` | 37 files, 805 tests passed |
| `pnpm test:http` (production build) | 20 files, 705 tests passed |
| `pnpm test:e2e` (production build, every project) | **343 passed, 0 failed, 4 skipped** |

The 4 skips are conditional:
- two screenshot-only tests, which run with `E2E_SCREENSHOTS=1`;
- the memories "empty" case, which runs only at desktop width on a database without memories.

**A local visual run once left synthetic seed rows in the test database**, which broke 12 integration tests. Resetting it before each database suite avoids that.

### What the browser tests found, and the fixes

Each rewritten spec states the properties it keeps; none was weakened. The changes the specs drove:

- **Targets and contrast:**
  - 44 px targets: the fine-print link, the language links (public and Studio), Studio buttons, sidebar links, the Desk's rows and cards, and the "Search for" tabs;
  - unwritten rows and grey text at AA;
  - Studio control boundaries at `#8C877E` (about 3.6:1) instead of the reference's `#E3DED5` (about 1.3:1), with a pen-blue border on focus (WCAG 1.4.11; listed for the owner with D10).
- **Layout stability:**
  - the journal editor's bar replaces the shell's own, and stays on one line at every width, so "Unsaved changes" never moves the page;
  - a track's state line keeps one line on a phone;
  - the track rating's row fills its line, so its words never move it;
  - the Studio's content padding is the reference's only. V4.4's inset doubled it, and at 320 px the album rating wrapped.
- **Measuring:**
  - axe and the cover's frame are measured on settled pages. On a slow CI runner the sleeve's entrance was once measured mid-slide;
  - the Studio's track titles use the v3 Studio's scale.

The Studio's language control is now the v3 sidebar's two links, which replace the V4.4 footer menu. The Portuguese Studio spec checks:
- the current language is marked;
- the other link opens the same page;
- keyboard operation;
- 44 px targets;
- the unsaved-writing guard;
- both links stay on screen at every width.

## Not built (later milestones)

- Album memories on the album journal; one favourite (R2).
- Pending changes and autosave (R4).
- Media (R5).
- Memory year, month, and photograph (R6).
- Public artist journals and stored artist slugs (R7).
- The Desk, Library, Settings, and States screens; share cards (R8).
- Catalog wording (R9); magic link (R10); hosting (R11).
- Music Story: blocked on access and licensing (MS-0, MS-1).
