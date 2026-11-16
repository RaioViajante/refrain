# Evidence: v3 foundations, public pages, and the Studio shell

**Status: on branch `feat/v3-foundations`, stacked on the R0 decision pack (draft PR #103). Not merged.** It is assembled with the Music Story adapter (#105) into the v3 release candidate, verified as a whole, with the launch checklist: [Evidence: the v3 release candidate](v3-rc.md).

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
- **Home:** hero, recently written, sleeves, memory board, lined excerpt, voices. Every value on it is one of ADR 0006 A4 and A6's closed lists, read in the Home's one snapshot (see the adaptations).
- **Albums:** the orbit (8, 12, and 16 covers, as the reference's rings hold), and the list with four orders, each a link to `?sort=`.
- **Album journal:** sleeve, rating circle, margin note, native `<details>` track rows, the crate.
- **Artists:** featured strips, the cloud, A to Z (a link to `?view=az`).
- **Artist:** the torn portrait, labels, the shelf.
- **Memories:** the polaroid collage in the archive's order (newest publication first), with the year's margin empty.
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

### The Library

The v3 Library at `/studio/journals`, the sidebar's "Library" (`src/app/studio/journals/screen.tsx`). It reads the same queries as before, with no new read. It has:

- album journals and memories together, newest edit first;
- a title search, and type and status filters. They are links and a GET form, so the address is the only state and nothing needs JavaScript. Each value is validated with Zod, and an unknown value falls back to the default;
- the Bin link with its count;
- "N shown";
- the reference's table: title with artist or song, type, language, status, edited, and Edit;
- below the table, the Recently deleted note in the INV-4 wording ("not erased", "nothing removes it automatically").

The author's writing is not listed; an HTTP test now asserts that.

### The Bin and the loading placeholder

- **The Bin** (Recently deleted, `src/app/studio/journals/deleted/screen.tsx`) uses the reference's panels and lists, with its "In the bin" tag. Each row still says what a restore will do: each version's status (ADR 0005). It keeps the writing's first words, so the author knows what they restore, and the restore dialogs are unchanged.
- **The streaming placeholder** is on the v3 Studio's paper and in its face. It still shows no Studio furniture before authorization.

### The System catalogue

`/studio/system` and `/pt/studio/system` hold the reference's System screen (`src/app/studio/system/`), private to the author. It is:
- **Authorized first, private:** `no-store`, `noindex`, and the visitor's sign-in otherwise.
- **Drawn in the reference's own page frame**, with the same classes as the public pages.
- **Seven sections:** paper and ink, the four faces, the objects, motion (with "Play again"), sound, the rules, and the grid.
- **Without example content:**
  - the polaroid, the print, and the sleeve use the lined stand-in and the white label, not the reference's photographs or the Grace cover;
  - its sample words are catalogue words ("your hand", "refrain", "undated"), never names or the author's writing;
  - the reference's rule that unwritten fields "show as [brackets]" is replaced by this project's rule: a field not written is not shown.

An HTTP test holds the privacy, the titles in both languages, and the absence of brackets and of the reference's sample values. Axe passes at 1280 and 390 px.

### The editors' panels

The journal and memory editors are drawn in the reference's panels, styling only (`src/app/v3/studio-theme.css`):
- the record, the writing with Track by track under a rule, and the aside are white panels;
- the reference's 1fr + 320 px grid, with the aside sticky beside the writing;
- field labels in the reference's 13 px semibold.

Not changed:
- the document order, the controls, and what they do;
- the 760 px reading measure, which the layout test holds;
- the album rating's single line at 320 px. Below 360 px the writing panel drops its frame to keep it.

The panels the reference adds around unbuilt parts are not drawn: the record search, "Written in", the margin note, the Portuguese version, Publish with "Show in recently written", and Music Story.

### Sign-in

The reference's centred box (`src/app/studio/sign-in/`):
- the wordmark;
- "Sign in to write";
- the way back to the site and EN/PT;
- the existing email and password form, which is unchanged in behaviour.

## Adaptations, each with its reason

| Reference | Built | Why |
| --- | --- | --- |
| The Albums list's four sorts and the Artists view switch as `aria-pressed` buttons that change component state | Links to `?sort=` and `?view=`, the chosen one `aria-current` and circled; the values are a closed list (anything else is the default) and are never written back | They work without JavaScript, and a sorted list can be reloaded or shared. Same look and rings |
| The Home's sleeve back: the newest journal's tracklist with the favourite circled | The card's title and credits where the tracklist sits, the rating, "written track by track" | ADR 0006 A4 and A6 (accepted) allow the Home only the album card's fields, read in its one snapshot. The tracklist waits for an A6 amendment (ADR 0011, proposed) |
| The Home's board: kraft labels with years, the memories grouped by year | Each label is the memory's "when" exactly as written, one line, cut with an ellipsis; no grouping | A6: the "when" is shown as written and never read as a date |
| No count on the Home | No count (an earlier build had a hidden one) | A6, item 3: no section count |
| The Memories archive in year sections ("2026 so far", "2023 & 2022", "undated"), its lead "Kept by year…" | One section in the archive's order, the year's margin empty; the owner's lead "Memories and the music woven through them." | The "when" is free text and never read as a date (owner decision, Part II; M3.8a; ADR 0006 A6). The year sections wait for the structured year (ADR 0011 § 4.2, R6). An earlier build parsed a year from the text, and its 150 px "undated" ran over the captions at 1440 px |
| The memory page's "MEMORY · 2026" and "FIG. 01 · 2026" | "MEMORY" and "FIG. 01"; the "when" as written in the labels | The same rule |
| A record label's lines at their natural length | Cut with an ellipsis inside the label | Long catalogue names ran off the red circle |
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
| Desk: "On the site" | The reference's label over the **published status** | It counts what the author has published, not what is served: while `REFRAIN_PUBLIC_READS_ENABLED` is off nothing is served. The independent security review noted this (Low, wording only); the empty-list line says "published", never "on the site" |
| Desk: "Recently published" by publication time | Published entries by their last edit | No new query; the publication history is not read on the Desk yet |
| Desk: 30 to 36 px buttons and rows | 44 px targets (a title's target reaches into the row's padding, so the rhythm is the reference's) | The repository's 44 px rule |
| Sign-in: "We'll email you a link…", "Email me a sign-in link", "expires in 15 minutes" | The reference's box over the existing email and password form: "Only you have an account here." and "Sign in" | The emailed link is R10, blocked on the magic-link hazard (ADR 0012 § 3); the page must not promise an email |
| Library: "Artists" type filter, "Bin (2)" | No Artists filter; "Recently deleted (n)" | Artist journals are R7; the Studio's word for the bin is "Recently deleted" everywhere |
| Library: "Things stay in the bin for 30 days, then they are deleted for good." | The INV-4 note: kept, never removed automatically, no permanent deletion yet | No purge exists, and none may be promised (AGENTS.md § 4; ADR 0011 § 3, C2) |
| Library: Language "EN + PT" | The original language only | The list query gives the original version; translations have no authoring yet |
| Library: a "Private" status filter | Added beside Drafts and Published | The domain has a private state the reference does not show |
| Library and Desk: type, language, and date columns on a phone | Hidden below 1024 px, not only on a phone | Beside the sidebar there is too little room for them |
| Studio content padding 32 px (16 px on a phone) plus V4.4's 17.6 px inset | The reference's padding only | The inset doubled the gutter; at 320 px a rating row wrapped |

## The About route

`/about` and `/pt/about` are answered as the archives are: the proxy's identical unknown-address `404` while public reads are off, `GET` and `HEAD` only, `no-store`. They are classified in `src/app/public-surface.test.ts` and in the route-parity test. They read no journal. **HTTP tests** (`src/testing/public-archives.http.test.ts`): About is in the archives' tables (every request form, from `GET` to the router's segment files and a percent-encoded spelling, is the unknown address while reads are off, on four servers whose switch is off; every answer `no-store`; a trailing slash is the no-store `308`; build-file names and case variants are the generic `404`), and a test of its own checks `GET` and `HEAD` `200`, `405` with `Allow: GET, HEAD` for `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS`, and the Portuguese forms while reads are off. About is not in the sitemap.

## Review fixes after the independent audit (2026-11-15)

Three independent security reviews, each by a separate agent with read-only access, none told the others' conclusions:
1. of `cd0b9a8`: changes requested (S1 to S7 below);
2. of the fixes, `cd0b9a8..b422653`: **GO** (no Critical, High, or Medium finding), with two Low findings, fixed in `2dfb951` and `a2321a4`;
3. of those fixes and the last CSS change, `b422653..e7deaf7`: **GO**, with Low findings about the guards' strength, a test with a "when" that names a year, and this document's wording, fixed in `4171518` and here;
4. of `e7deaf7..c864b09` (the last test and document changes): **GO**, with Low findings (a guard comment that promised more than it checks, a year count that could meet a build hash, this document's wording and layout), fixed in the commit after it.

The reviewers read code and ran no tests; the test results below are from the runs recorded in Verification.

| Finding | Severity | Fix | Proof |
| --- | --- | --- | --- |
| S1: the Home read the newest journal's whole page outside A6's snapshot, carried a section count, and read the "when" as a year | Medium | One read, `getPublicHome`; the sleeve shows the card's fields; no count; each board label is the "when" as written | `public-surface.test.ts` ("has the Home read only getPublicHome and the switch"); `public-home.http.test.ts` ("shows only the album card's fields…", `/` and `/pt`) |
| S2: `/about` and `/pt/about` had no HTTP tests | Medium | Tests added (see The About route) | `public-archives.http.test.ts` |
| S3: the Home's G2 browser test had been removed | Medium | Ported to the v3 Home, through its prefetching links | `e2e/home.spec.ts` ("a change is seen on the next navigation, and a stale link leads nowhere"), 1440 and 390 |
| S4: the photograph guard no longer covered the artist page's own `<img>` | Low | A guard that only the artist page touches a `.photo` value | `public-surface.test.ts` ("draws an artist photograph only on the artist page", with a self-check) |
| S5: all of `src/app/v3/` (shared with the Studio) could import the reading entry point | Low | Only `v3/cover.tsx` | `studio/no-publishing.test.ts` |
| S6: the album page's previous and next had no HTTP test | Low | Test added: only served journals, each answering 200 | `public-album-journal.http.test.ts` |
| S7: a test title promised more than it checked | Low | Title corrected; the whole-writing check stays in HTTP | `e2e/archives.spec.ts` |
| Second review: the archive and the memory page still read the "when" as a year | Low | Removed (see the adaptations) | `public-surface.test.ts` ("never parses a memory's \"when\" on a public page"); `public-archives.http.test.ts` |
| Second review: no regression guard for S1 | Low | The two S1 tests above | — |
| Third review: the guards were regular expressions, easy to evade | Low | Both read the syntax tree: every `rememberedWhen` may only be rendered, tested for presence, or carried into a rendered property; the Home's own files (screen, view, both routes) import only `getPublicHome` and the switch, no namespace import, and calls it once | `public-surface.test.ts`, with a self-check for each evasion it names |
| Third review: no test used a "when" that names a year | Low | A published memory whose "when" is "[Test] The summer of 2019, more or less": the year appears only inside that text, on the archive and on its page | `public-archives.http.test.ts` ("a memory's \"when\" that names a year") |

**Coverage restored** (dropped with the V4.4 specs, now written for v3):
- G2 on the Home (above);
- no layout shift while the Home loads, with and without reduced motion (`< 0.01`);
- reflow at 320 px (200 % zoom of a 640 px window, 400 % of 1280 px) and with text at 200 %, on the Home and on the album page with a track open;
- forced colours: the navy sheets drop their texture, the pen rings take the system's colours, focus is a 2 px system outline;
- the pen ring drawn on a section link with keyboard focus;
- sound: no `AudioContext` before the toggle (after scrolling and hovering), one running context after it, suspended when it is turned off;
- entrances never flash: sampled every frame from the first paint, nothing on screen shows, vanishes, and returns;
- without JavaScript: the Albums orders and the Artists views, as links.

**Behaviour fixed:**
- The Albums orders and the Artists views are links (`?sort=`, `?view=`), so they work without JavaScript (see the adaptations); HTTP tests check the same rows in every order and that odd values are the default and never written back into the markup.
- **The reveal flash.** The runtime armed the entrances after hydration, so what was already on screen showed, vanished, and entered again. The page is now sent armed (`io`), with a `<noscript>` style (a static string, no data) that shows everything without JavaScript, and a CSS fail-safe that shows everything after three seconds if the runtime never marks the page ready. On a slow device whose runtime arrives after those three seconds, what is on screen may still blink once; not measured.
- **The orbit.** The reference's rings hold 8, 12, and 16 covers at 19, 31, and 43 % (read from its markup); the third ring held 18. Fixed. A fourth ring past 36 journals holds 20 (D20, proposed).
- Record labels cut long names with an ellipsis inside the label (they ran off it on a phone).
- A white label keeps its words on the sleeve; in the Albums orbit on a phone (covers about 35 px) it shows its ring only, as a blank label does, and the list below names every album. The title had run down over the neighbouring covers.

- The approved favicon and touch icon are linked from both roots and the global 404, as plain `<head>` links: `metadata.icons` streams a marker whose row order differed between two answers of the same page, which the A6 parity check caught.

**Measured after the fixes**, on the production build, at 1440 and 390 px:
- the four Albums orders and the two Artists views: every link 44 px tall, inside the viewport, the chosen one `aria-current`; no sideways scrolling; A to Z shows the dividers and hides the cloud;
- every record label's lines stay inside the label; a long one is cut, not spilled (these measurements were scripted locally; the committed tests that hold the same properties are the 44 px and sideways-scrolling checks in the archive, Home, and memory specs);
- the Home board's label (a long "when") is one line cut with an ellipsis, inside the viewport at 390 px;
- no orbit cover spills its text, at either width;
- the Memories archive has no year heading.

Side-by-sides of the corrected areas against the reference (Memories, the memory page on a phone, the Home's sleeve, the sorted Albums list on a phone) were inspected locally; the images are not committed.

The Artists view switch and the Home's board were also compared at 390 px: the switch matches the reference's control; the board's polaroids overlap as the reference's do (its second covers the end of the first one's song line), and the differences are its content (lined stand-ins, three memories on a board drawn for seven).

**Remaining differences from the reference**, each waiting on a decision or a later milestone:
- the Home's sleeve back shows the card, not the tracklist, and the board holds three memories (A6 amendment);
- no year sections, and no "MEMORY · year" (R6);
- photographs (R5, R6), album memories, translated-from (R2, R3), artist journals (R7), the About lines (R8);
- white-label covers wherever the cover switch is off.

## Visual comparison

Comparisons were made locally against the reference screenshots, at 1440 px and 390 px (2×), with reduced motion (the settled state):
- The harness lives outside the repository. It uses the existing production-server helper on the disposable test database, with the repository's synthetic `[Test]` seeds.
- Side-by-side captures were inspected for the 404, the album journal (desktop and phone), Home, Albums, Artists, Artist, Memories, and Memory.
- Structure, objects, typography, and colour match the reference.
- The differences come from the data: `[Test]` titles, no photographs, white-label covers while the cover switch is off.

### Per-band mismatch (2026-11-15)

A local, uncommitted script compared each public page with the reference screenshot. It ran at 1440 px and at 390 px (2×), with reduced motion and the same `[Test]` seeds, and computed the mismatch in a browser canvas, with no new dependency.

- **Method:** each image is scaled to the reference's width and cut into bands of 450 px (desktop) or 780 px (phone). A band's figure is the share of pixels whose largest channel differs by more than 48 of 255, after both images are scaled down 8× (structure rather than glyphs).
- **Reading the numbers:** the reference's own sample content (photographs, real covers, seven memories, long journals) is replaced by synthetic seeds, so mismatch is not zero by design. Where page heights differ, the later bands compare against different content.

| Page | Height, ours / reference (desktop) | Median band, desktop | Median band, phone |
| --- | --- | --- | --- |
| About | 1,938 / 1,901 | 4 % | 18 % |
| 404 | 1,424 / 1,398 | 4 % | 25 % |
| Album journal | 3,126 / 3,992 | 16 % | 22 % |
| Artist | 2,249 / 2,478 | 16 % | 25 % |
| Home | 7,421 / 7,344 | 19 % | 34 % |
| Artists | 2,175 / 2,516 | 19 % | 22 % |
| Albums | 2,567 / 2,950 | 20 % | 17 % |
| Memory | 2,045 / 2,077 | 21 % | 29 % |
| Memories | 2,203 / 5,443 | 28 % | 44 % |

The Studio screens built so far, measured the same way against their reference screens:

| Screen | Bands, desktop | Bands, phone |
| --- | --- | --- |
| Desk | 2–4 % | 6–15 % |
| Library | 3–5 % | 6–16 % |
| Sign-in | 1–5 % | 0–7 % |

The two public pages that depend least on data, About and the 404, also match closely. The mismatch fixed this way:

- On a phone, the memory's lined sheet kept the desktop's 680 px minimum; the reference fits it to the writing. The phone page went from 5,656 to 4,768 px against the reference's 4,560.
- A memory without a photograph had its lined stand-in grow with a long title and cover its neighbour on the Home's board. It now keeps the photograph's shape, and a board caption keeps to three lines.

**What remains is content.** The highest bands are:
- the memory photographs (R5, R6) against our lined stand-ins;
- the Home's three memories and three artists (ADR 0006 A6) against the reference's seven and its full cloud;
- white-label covers while the cover switch is off.

The comparison images and figures are local only; nothing from `reference/` is committed.

## Verification

Each check was run on the branch on 2026-11-15, at `4171518` (the review fixes; the next commit changes only this document), and its output was read. Database suites ran on a freshly reset disposable test database (`pnpm db:test:down && pnpm db:test:up`); no persistent or hosted database was touched.

| Check | Result |
| --- | --- |
| `pnpm lint` | Clean |
| `pnpm format:check` | Clean |
| `pnpm typecheck` | Clean |
| `pnpm test` | 57 files, 1,296 tests passed |
| `pnpm test:integration` | 37 files, 805 tests passed |
| `pnpm test:http` (production build) | 20 files, 783 tests passed |
| `pnpm test:e2e` (production build, every project) | **357 passed, 0 failed, 4 skipped** |
| Independent security reviews of the fixes (separate agents, read-only, no tests run) | **GO** twice (`cd0b9a8..b422653`, `b422653..e7deaf7`): no Critical, High, or Medium finding; their Low findings fixed in `2dfb951`, `a2321a4`, and `4171518` |

The 4 skips are conditional, and none hides a check:
- `public-artwork.spec.ts` "screenshots with the cover, when asked for", at 1440 and 390 px, and `ratings.spec.ts` "captures the studio's rating in the named states": screenshot jobs that run only with `E2E_SCREENSHOTS=1`;
- `memories.spec.ts` "shows an empty Memories page" at 390 px: it runs only at desktop width, on a database without memories.

**One intermittent browser failure, not reproduced.** While the review fixes were made, one combined run of the archives, memory-page, Home, and i18n-public specs answered `500` instead of `404` for a draft memory's address at 1440 px (`memory-page.spec.ts`, "answers the shared not-found view for a memory that is not public…"). The same test passed at 390 px in that run, in three runs of the spec alone, in two more combined runs, and in the full run above. The server's message was not kept. Three more combined runs, with `public-artwork.spec.ts` added and `E2E_KEEP_SERVER_LOG=1` to keep the server's output, passed (94 each); it has not recurred. If it does, keep `test-results/` and `test-results/server.log` before rerunning.

**A local visual run once left synthetic seed rows in the test database**, which broke 12 integration tests. Resetting it before each database suite avoids that.

**One intermittent HTTP failure, not reproduced since.** On 2026-11-15, one full `pnpm test:http` run failed one check in `src/testing/public-home.http.test.ts`: "with only hidden writing (A6) answers, with the switch on, exactly what the empty site answered, in every request form". Its detail was not captured. Since then, during the independent audit, the file passed 8 runs out of 8 and a full run passed (709 of 709). Two related facts:
- the one earlier failure of the same check whose detail was kept (during development) was a nondeterministic order of the Flight rows, fixed on this branch;
- while these review fixes were made, `metadata.icons` made the same check fail every time: the framework streams an `IconMark` row whose position, and so every later row's number, differed between the two answers. The icons are now plain `<link>` tags in the roots' `<head>`, and the check passes.

The cause of the single unexplained failure is **not proven**: the check is sensitive to any streamed row whose order varies, which fits it, but nothing was captured. If it recurs, capture the diff of the two responses first.

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
- Settings and States screens; share cards (R8). The Desk, Library, and Bin are built here over the existing queries.
- Catalog wording (R9); magic link (R10); hosting (R11).
- Music Story: blocked on access and licensing (MS-0, MS-1).

- **The rest of the v3 album and memory editors** (AlbumEdit, Memory). The panels are drawn; what they hold in the reference depends on parts that are not built:
  - the margin note and the Portuguese version (writers and translation authoring);
  - "Show in recently written" (R2);
  - one favourite (R2, blocked on ADR 0002);
  - "Update" with pending changes (R4);
  - the memory photograph (R5, R6);
  - the Music Story panel (MS-0, MS-1).

  Today's editors run on the v3 shell and theme, with their behaviour unchanged.
- **Settings and the About page's own lines** (`site_settings`, R8).
