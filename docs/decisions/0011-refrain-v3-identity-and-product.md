# ADR 0011: Refrain v3 — Visual Identity and Product Changes

- **Status:** **Proposed.** Not accepted. Nothing in this ADR binds code, tests, or other documents until the owner accepts it in writing. Until then, the accepted ADRs (0001 to 0008), [`AGENTS.md` § 6](../../AGENTS.md#6-design-system-boundaries), and the V4.4 specification in [Design System, Part II](../design-system.md#part-ii--v44-specification) still govern the merged code.
- **Date:** 2026-11-15
- **Scope:**
  - The visual identity of every public page and of the Writing Studio.
  - The product concepts that identity introduces.
  - How those concepts fit the accepted security and domain contracts.
  - The rebuild milestones R0 to R12 ([Roadmap](../roadmap.md#refrain-v3-rebuild-r-track)).
  - External services are decided separately in [ADR 0012](0012-external-services-music-story-email-media.md).

## Context

### The design

The owner commissioned and **approved as final** a complete new design for Refrain. It is called "v3" after the label its own reference folder carries. Its concept is *the booklet of a record that belongs to you*: an intimate, nostalgic music journal built from physical objects. Those objects are:

- record sleeves and vinyl;
- polaroids;
- kraft tape;
- lined notebook paper;
- developed photographs;
- torn navy paper;
- handwritten pen-blue annotations.

**On the name.** "v3" is newer than "V4.4", despite its number. V4.4 is the identity approved on 2026-10-31 and implemented in M1 to M3. v3 is the November 2026 redesign that replaces it. The two numbers come from different design files and are not a sequence. [Studio visual fidelity](../design/studio-visual-fidelity.md) records an earlier mistake about design versions, so this ADR names each identity by its date as well as its label.

**The owner's words.** The owner's approval, as given to the implementer on 2026-11-15:

> The entire design has been rebuilt from scratch and personally approved by the owner as final. The new `reference/` directory is the authoritative visual specification. It is not inspiration, a moodboard, or an exploratory design. [...] The old visual identity is superseded. [...] The complete design under reference/ is final and approved. It supersedes V4.4.

**The reference is local only.** It lives in the owner's `reference/` workspace, which Git ignores ([`AGENTS.md` § 6](../../AGENTS.md#6-design-system-boundaries)):

| Folder | Contents |
| --- | --- |
| `screens/` | 1440 px and 390 px captures |
| `source/` | Per-screen `.dc.html` files holding the HTML, CSS, copy, and logic |
| `assets/` | Textures, edges, tape, cursors, icon, and example images |
| `code/` | `tokens.css` and `sfx.js` |

This ADR and [Design System, Part I](../design-system.md#part-i--refrain-v3-specification) transcribe what the implementation needs, so the repository never depends on that folder.

### The backend

The backend built in M1 to M3 is solid, and it is kept:

- the publication predicate;
- the confirmation engine (ADR 0006);
- the proxy-decided statuses;
- per-language versions;
- slug history;
- soft delete and restore;
- the switches;
- about 3,200 tests.

The redesign changes the presentation. It also adds product concepts that the domain does not have yet. Some behaviours drawn in the reference conflict with accepted security contracts. **Those conflicts are resolved below in favour of the security contract, and the visual design is kept.** No contract is weakened silently.

### Alternatives considered

1. **Adapt V4.4 gradually toward v3.**
   - Rejected. The owner approved v3 as a replacement, not as an evolution.
2. **Many small amendments, one per concept.**
   - Rejected, because each would need its own review.
   - Instead, this ADR records the identity, the product concepts, and the decision register in one place.
   - It also proposes narrowly worded amendments only where an accepted ADR's binding text must change: [ADR 0002](0002-domain-model-decisions.md#proposed-amendments-adr-0011), [ADR 0004](0004-single-author-identity.md#proposed-amendment-adr-0011-magic-link-sign-in), [ADR 0005](0005-restoring-deleted-journals.md#proposed-amendment-adr-0011-the-bin-wording), [ADR 0006](0006-publication-decision-and-acknowledgement.md#proposed-amendments-a9-to-a12-adr-0011), and [ADR 0008](0008-interface-localization.md#proposed-amendments-adr-0011).
3. **A new database model shaped like the reference's prototype objects** (`AlbumJournal`, `ArtistJournal`, `Memory`, `SiteSettings`).
   - Rejected.
   - The existing entries, language versions, and catalog already carry most of these fields.
   - The gaps are closed by additive, reviewed migrations (§ 4).

## Decision

### 1. Authority

1. **The v3 design is the visual authority** for every surface, once this ADR is accepted.
2. **Order of precedence:**
   1. the rendered v3 screens;
   2. the v3 source files (HTML, CSS, copy, logic);
   3. `tokens.css` and `sfx.js`;
   4. the transcription in [Design System, Part I](../design-system.md#part-i--refrain-v3-specification).
   
   If the transcription disagrees with the screens or the source, the transcription is corrected.
3. **The implementation reproduces v3 faithfully.** It does not redesign, simplify into generic cards, substitute typefaces, or drop an interaction because it is costly. A genuine technical blocker is documented with evidence and decided by the owner.
4. **Where v3 conflicts with an accepted security or domain contract, the contract wins.** The visual treatment is kept and adapted (§ 3). Every such adaptation is listed in this ADR.

### 2. The V4.4 rules that v3 supersedes

On acceptance, these rules stop applying. Each is replaced as noted, and the text that states it is marked "Superseded by ADR 0011 § 2" rather than deleted.

| V4.4 rule, where it is stated | Replaced by |
| --- | --- |
| "Implement the approved V4.4 design. Do not redesign it" ([`AGENTS.md` § 6](../../AGENTS.md#6-design-system-boundaries)); "Status: visual identity approved (design V4.4 …). It does not redesign anything" (Design System) | Implement the approved v3 design (§ 1) |
| "Monochrome interface: color comes only from artwork and photographs" (`AGENTS.md` § 6); "Black ink on white paper" (Design System, Principles) | The v3 palette: paper, ink, record red, pen blue, navy, kraft, sleeve, grey, lined |
| "Typefaces are Kalam and Alegreya Sans, nothing else" (`AGENTS.md` § 6) | Archivo, Instrument Serif, Silkscreen, and La Belle Aurore, each with one job |
| "The original character illustration appears only on the public homepage" (`AGENTS.md` § 6) | v3 does not use the character anywhere. **Its files stay in the repository byte for byte** (`public/artwork/refrain-home-character.png` and `.webp`), unused by the pages. Removing them needs a separate owner decision |
| The approved 404 artwork exception (`public/artwork/refrain-404.webp`) | The v3 404, a scratched skipping record. The file stays byte for byte until the owner decides |
| "The public header has no logo or wordmark" (`AGENTS.md` § 6) | Inner pages carry the "refrain" wordmark in record red. The Home has no wordmark; its hero is the name |
| "The language selector (`en`, `pt-BR` only) lives only in the footer" (`AGENTS.md` § 6) | EN/PT in the header **and** the footer, still only `en` and `pt-BR`, still URL-only state ([ADR 0008, proposed amendment](0008-interface-localization.md#proposed-amendments-adr-0011)) |
| "Rough.js strokes are pre-generated with fixed seeds" (`AGENTS.md` § 6); Rough.js implementation (Design System) | Hand-drawn SVG paths copied from the v3 source (pen rings, arrows, stars), `aria-hidden`, behind semantic elements. Rough.js is retired once no page uses it |
| The pencil cursor (Design System) | A record cursor, which becomes a pen circle over controls (`pointer: fine` only) |

**Unchanged** in `AGENTS.md` § 6:
- the rules for `reference/` (local only, read-only, never loaded or linked by code or documentation, assets promoted deliberately and byte for byte);
- "administrative controls never appear on public pages";
- the accessibility rule (keyboard, visible focus, 44 px targets, `prefers-reduced-motion`, correct `lang`).

### 3. Conflicts between the drawn design and accepted contracts

| # | The reference draws | The contract | Resolution (the visual design is kept) |
| --- | --- | --- | --- |
| C1 | One-click **Publish** and **Update**, with a toast | ADR 0006: a publication or a change to a public version needs the review and a server-authenticated confirmation, and this cannot be waived | Publish and Update open a review dialog drawn in the v3 language. It follows the reference's own States rule: *"Always confirm, always say what happens on the site."* The toast appears only after the confirmed command returns |
| C2 | The Bin: "Things stay in the bin for 30 days, then they are deleted for good" | `AGENTS.md` § 4: no automatic purge until backups, a tested restore, and a tested purge exist | No automatic purge. The copy becomes "kept until you delete it for good". "Delete now" stays an explicit, confirmed author action, enabled only under ADR 0005 and ADR 0007 ([ADR 0005, proposed amendment](0005-restoring-deleted-journals.md#proposed-amendment-adr-0011-the-bin-wording)) |
| C3 | Settings: "Language a visitor sees first: Follow their browser" | ADR 0008 § 6 and § 9: the URL is the only language state; no `Accept-Language` | The option is not built (D9) |
| C4 | Artist journals with a public page | ADR 0006 A5: an artist page opens only through a confirmed album-journal publication, "never because of … an artist journal" | Proposed ADR 0006 A11: a confirmed artist-journal publication may also open the page. Its review discloses and binds that page |
| C5 | Settings: an API token field for Music Story | Security § Secrets: secrets live only in environment variables | The token is an environment variable. Settings shows "configured" or "not configured", the usage, and a test. No token field (D8, [ADR 0012](0012-external-services-music-story-email-media.md)) |
| C6 | "Everything saves on its own"; "Changes not on the site yet — the site still shows the version from 14 Nov" | ADR 0006 § 5: no background save of a public version | Proposed ADR 0006 A10: autosave writes **pending changes** that the public never reads. **Update** applies them through the confirmed save |
| C7 | A magic-link sign-in | ADR 0004: email and password, no plugins | Proposed ADR 0004 amendment. **Blocked by the account-deletion hazard** documented there and in ADR 0012 until its fix is merged and tested |
| C8 | Offline editing ("kept on this device and saved when you're back") | ADR 0006 tokens; ADR 0004 sessions | Deferred to after launch (R track, "Post"). It is a local buffer that never holds a token, never publishes, and replays as ordinary saves |

### 4. Product concepts v3 introduces

Each concept is implemented in its own milestone, with the migration procedure of [Development § Database changes](../development.md#database-changes) and its privacy tests.

1. **Exactly one favourite track per album journal** ([ADR 0002, proposed amendment](0002-domain-model-decisions.md#proposed-amendments-adr-0011)). The pen circle marks "the one". It shows only on a published reflection that has text in the shown language (INV-3).
2. **Memories:**
   - a year and an optional month, or "undated", replacing free-text "when" by a data migration;
   - a photograph, pinned or taped, with alt text per language;
   - **one** song. `memory_music` is kept and limited to one row.
3. **Public artist journals:**
   - three are featured on `/artists`;
   - the name cloud is weighted by served appearances;
   - an A–Z view;
   - the artist page shows the torn photograph and the journal;
   - **stored artist slugs with history** replace name-derived addresses (G1).
4. **An About page** (`/about`, `/pt/about`): the "liner notes". Its authored text is an entry of a new singleton kind `about`, published through the ADR 0006 engine. Configuration such as "since", initials, and the home mode lives in a `site_settings` row.
5. **"Show in recently written"** on the Home: a per-entry flag that is a public atom of the disclosure.
6. **The original and its translation.** The interface follows the visitor. A public translation shows "translated from … · read the original", linking to the other language's address, and only when that version is public. Author-written translations get their Studio interface.
7. **Pending changes and autosave** (proposed ADR 0006 A10).
8. **Media:** memory photographs and the author's own artist photographs. They are stored and served as [ADR 0012](0012-external-services-music-story-email-media.md) decides, through a route that checks the predicate.
9. **Motion and sound:**
   - entrance animations on scroll;
   - a hero record turned by scrolling;
   - the orbit of covers;
   - the torn photograph;
   - handwriting drawn over three seconds;
   - synthesized Web Audio effects, **off by default**, switched on only by the footer control, never looping.
   
   Under `prefers-reduced-motion` nothing moves, and the content is complete without JavaScript.
10. **Empty states as physical objects:**
    - a white-label sleeve for a missing cover (also the look when the cover display switch is off);
    - lined paper for a memory without a photograph;
    - kraft with the name in handwriting for an artist without one;
    - an empty board.
    
    Bracketed text in the reference marks the author's words before they exist. **On real pages an empty field is not rendered, and bracketed text never reaches public HTML.**

### 5. Security contracts preserved

v3 changes none of these. Every milestone shows they still hold with the existing tests, extended to every new surface:

- the publication predicate (once, in the Publication module), read only through `src/modules/publication/public.ts`;
- the identical `404` for every hidden or unknown address, `308` only for a visible entry's previous address, decided in `src/proxy.ts`;
- `no-store` on every public response;
- per-language visibility (INV-3) and per-reflection publication;
- ADR 0006 confirmations, the version rule, the lock order, and "no unchecked path";
- restore never publishes (ADR 0005);
- soft delete and no automatic purge;
- the single author and Studio authorization in every action;
- `REFRAIN_PUBLIC_READS_ENABLED` and `REFRAIN_COVER_DISPLAY_ENABLED` (off unless exactly `true`);
- the noindex constant;
- the release gates G1 to G8 (ADR 0006 § 14);
- the Deployment gate items 6 and 7;
- ADR 0007 backups before real writing is hosted.

### 6. Decision register

**Owner-approved design requirements.** These come from the approved reference. They are requirements, not open questions. How each is implemented is recorded in [Design System, Part I](../design-system.md#part-i--refrain-v3-specification).

| ID | Requirement |
| --- | --- |
| AR-1 | The palette, the four typefaces with their jobs, and the 12-column grid: content 1200 px inside a 1280 px maximum, 24 px gutters, 40 px desktop and 20 px phone margins, one 720 px breakpoint |
| AR-2 | The physical objects (vinyl, sleeve front with the disc emerging, sleeve back with tracklist, polaroid, pin, tape, kraft label, print, lined sheet, torn navy sheet, torn photo strip, pen ring), built as drawn, never as generic cards |
| AR-3 | The motion: the entrance set in 110 ms delay steps; handwriting over about three seconds; reduced motion shows everything in place |
| AR-4 | Sound: synthesized, short, off until the footer toggle, never looping or ambient |
| AR-5 | Navigation: never underlined; hover draws a pen circle; the current page and language stay circled; the record cursor |
| AR-6 | The public page set: Home, Albums, the album journal, Artists, the artist journal, Memories, the memory, About, the 404 |
| AR-7 | The empty states listed in § 4.10 |
| AR-8 | The record favicon and the share cards (1200×630 link preview, 1000×1500 pin) |
| AR-9 | The Studio information architecture: Desk, Library and Bin, the album, memory, and artist journal editors, Settings, Login, States |
| AR-10 | Two interface languages, and the original and translation display of § 4.6 |
| AR-11 | Exactly one favourite track per album journal |
| AR-12 | Memories grouped by year, with a photograph and one song |
| AR-13 | Real album artwork is part of the finished product. The fallback is only for a missing, failed, or withheld cover |
| AR-14 | Never lyrics |
| AR-15 | Magic-link sign-in (single use, 15 minutes), implemented only after the hazard in [ADR 0004's proposed amendment](0004-single-author-identity.md#proposed-amendment-adr-0011-magic-link-sign-in) is closed |
| AR-16 | Music Story is the preferred unified source of musical metadata and artwork ([ADR 0012](0012-external-services-music-story-email-media.md)) |

**Unresolved decisions.** Each needs the owner's answer, and the implementer's recommendation is given. None is treated as decided.

| ID | Decision | Recommendation |
| --- | --- | --- |
| D1 | Accept this ADR, ADR 0012, and the proposed amendments | Accept |
| D2 | Publish and Update use a v3-styled confirmation dialog (C1) | Yes. ADR 0006 cannot be waived |
| D3 | The Bin keeps entries until "Delete now"; the copy changes (C2) | Yes |
| D4 | Pending changes for edits to published entries, with no revisions history (A10) | Yes |
| D5 | An artist-journal publication may open the artist page (A11, C4) | Yes, with disclosure binding |
| D6 | Media stored in PostgreSQL, the public copy a grayscale derivative with EXIF and GPS removed ([ADR 0012](0012-external-services-music-story-email-media.md)) | Yes |
| D7 | About gains a "sources" row for the credits that licences require (the reference has none) | Yes |
| D8 | The Music Story token is an environment variable; Settings shows only status and usage (C5) | Yes |
| D9 | "Follow their browser" is not built (C3) | Yes |
| D10 | The grey `#6E6A63` on paper is 4.44:1, below WCAG AA for small text, and on kraft it is 3.08:1. Use `#67635C` (4.93:1) for small grey text, and never set grey text on kraft | Yes |
| D11 | Promote the v3 chrome assets byte for byte, plus WebP re-encodings of the large textures. Load the typefaces with `next/font` unless La Belle Aurore differs from the reference's self-hosted file | Yes |
| D12 | "Recently written": the six newest of any kind plus the per-entry flag. Featured artists: the three latest published artist journals | Yes |
| D13 | "The album" and "the one" on an artist page: derived (the artist's only or highest-rated served journal, and its favourite track), shown only when they exist, or chosen by the author | Derived |
| D14 | Memories: one song; migrate "when" to a year and month, or undated | Yes |
| D15 | The email provider for magic links, and a kept recovery path (password, or a CLI-printed link) | Keep a recovery path |
| D16 | The launch cover source: Music Story under a licence that covers it, or the Cover Art Archive after the Deployment gate item 6 review, or white labels | Music Story if licensed; otherwise stop for this decision |
| D17 | The 24 untracked Brazilian photographs: recover each one's provenance or replace them with images whose licence is recorded | Replace unless provenance is found |
| D18 | Pull requests #98 (ADR 0009, never accepted), #99 (ADR 0010), and #102 (A8) | Withdraw #98; rework #99 for the v3 surfaces; review and land #102 |
| D19 | When F-02 (hosted backups) restarts, and the redeploy, S3, and S4 authorizations; the noindex constant stays | Restart F-02 now, in parallel |
| D20 | Rules the reference implies but does not draw: orbit rings beyond 36 journals (+4 covers per ring, the same spacing); years with fewer than three memories merged with the neighbouring year | Yes |
| D21 | The sound setting is not remembered between visits; track ratings are offered in whole steps in the Studio (the database keeps half steps) | Yes |
| D22 | Music Story: verify API access and the licensing terms now, in parallel with R1 ([Roadmap, MS track](../roadmap.md#music-story-evaluation-ms-track)). If licensing is not available, stop for the owner's decision; never change providers silently | Yes |

### 7. Milestones

The rebuild is the R track in [Roadmap](../roadmap.md#refrain-v3-rebuild-r-track), R0 to R12, with the parallel MS track. Every milestone:

- is a vertical slice on its own branch with one pull request;
- changes its documents and evidence in the same pull request ([`AGENTS.md` § 9](../../AGENTS.md#9-documentation));
- runs every check;
- passes an independent security review where it touches a trust boundary.

No milestone deploys, changes hosted data, or merges itself.

## Consequences

**Positive**
- Refrain gets the identity the owner approved, on the backend already proven.
- The conflicts are named once, with a resolution that keeps both the design and the contracts.
- One register holds every open decision.

**Negative**
- Most public CSS and components are rewritten.
- V4.4 visual tests are replaced milestone by milestone.
- New migrations, new public surfaces (artist journals, About, media, the home flag), and a pending-changes store each widen what the privacy tests must cover.
- Rough.js, Kalam, and Alegreya are retired once nothing uses them.

**Risks**
- Real artwork depends on licensing that is not yet verified (D16, ADR 0012).
- The photographs need provenance (D17).
- Magic links carry the hazard in ADR 0004's proposed amendment.

## Revisit when

- The owner changes or extends the approved design.
- A drawn behaviour proves technically impossible as specified.
- Licensing makes real artwork unavailable.
