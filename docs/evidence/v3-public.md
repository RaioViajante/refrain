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

Each check was run on the branch and its output was read:

| Check | Result |
| --- | --- |
| `pnpm lint` | Clean |
| `pnpm format:check` | Clean |
| `pnpm typecheck` | Clean |
| `pnpm test` | 57 files, 1,284 tests passed |
| `pnpm test:integration` | 37 files, 805 tests passed, on a freshly reset disposable test database |

**A local visual run had left synthetic seed rows in the test database.** That broke 12 integration tests. After `pnpm db:test:down && pnpm db:test:up`, every test passed.

The HTTP suite and the browser suite are reported in the pull request.

## Not built (later milestones)

- Album memories on the album journal; one favourite (R2).
- Pending changes and autosave (R4).
- Media (R5).
- Memory year, month, and photograph (R6).
- Public artist journals and stored artist slugs (R7).
- The Desk, Library, Settings, and States screens; share cards (R8).
- Catalog wording (R9); magic link (R10); hosting (R11).
- Music Story: blocked on access and licensing (MS-0, MS-1).
