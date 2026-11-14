# Evidence: the cover display switch

The owner authorized this change on 2026-11-14 as the second of three independent hosting improvements, on its own. It builds the switch that [Security § Deployment gate](../security.md#deployment-gate), item 6, names as one way to keep unreviewed covers off a hosted site. It also applies the owner's reading of that item from 2026-11-08 ([#82](https://github.com/RaioViajante/refrain/issues/82)): the restriction covers every hosted surface, including the private Studio behind Vercel Authentication. Its design follows § 12 of the proposed ADR 0009 (PR #98). That ADR is **not accepted**, and nothing else in it is built. **Local only:** nothing is deployed, no environment variable changes on any host, public reads stay off on every reachable host, and item 6 stays open until the owner records the review.

## The direction

**Real covers are the intended state of the product** (owner, 2026-11-14). The V4.4 interface is monochrome so that the covers and photographs bring the color.
- The Home, the album pages, any public collection, and the Studio show the real covers once their display is authorized.
- The fallback frame is the exception: no cover, an image that fails, or a display that is blocked.
- The switch is the operational control over that display: it authorizes covers on a server, or takes them all down at once.
- Turning it off never deletes a cover's metadata (`cover_url`, `cover_source`, the image id).
- Turning it on publishes nothing: no journal, memory, album, or artist page becomes public because of it.

## The policy

| | Behavior |
| --- | --- |
| The variable | `REFRAIN_COVER_DISPLAY_ENABLED`, server-only, read per request (never at build time), never `NEXT_PUBLIC_` |
| Values | On only for exactly `true`. Unset, empty, `false`, `TRUE`, `True`, `1`, `yes`, `on`, a padded or quoted value: off |
| Default | **Off unless set.** No environment is told apart from another, and none needs to be: a server where the variable is unset (or anything but `true`) hides covers until they are authorized there. |
| A hosted deployment | Unset there today, so every surface, the Studio included, shows the fallback frame from the first deployment of this code. The owner sets it to `true` only after recording the item 6 review. This change sets it nowhere. |
| Local development | Set to `true` in `.env.development.local`, which only `next dev` reads ([Development](../development.md#configuration)). Not in `.env` or `.env.local`: the tests' `next start` reads those. The author's local catalog is unchanged either way: its covers show as they were. |
| Tests | The HTTP and browser test servers set it to the empty string (off) unless the test sets it ([`production-server.ts`](../../src/testing/production-server.ts)). It is not deleted, because `@next/env` 16.4.3 fills a missing variable from `.env` and `.env.local`, but never replaces one that is set. A test that shows or chooses covers sets it to `true` itself. |

## Surfaces

Every cover image source is built in [`artwork.ts`](../../src/integrations/cover-art-archive/artwork.ts). The integration's entry point exports no other builder than the ones gated by the switch ([`display.ts`](../../src/integrations/cover-art-archive/display.ts)), so each surface below reads one of them. `canonicalCoverUrl`, also exported, builds the canonical address the catalog stores for a chosen image. It never builds an image source, only the artwork commands call it on the server, and it never reaches a page.

| Surface | Reader | Off |
| --- | --- | --- |
| Album journal, Home, album archive, artist page (EN and PT, every request form) | `publicArtworkOf` ([`public-album-journal.ts`](../../src/modules/publication/public-album-journal.ts)), used by the Home, archive, and artist readers | Fallback frame |
| Memory pages | — | Never showed a cover |
| Studio: Desk, Albums, Journals, Recently deleted, Add music's catalog list, a new journal | `listAlbumCovers` | Fallback frame |
| Studio: a journal, the editor | `getAlbumCover` | Fallback frame; the margin says a cover is chosen but not shown |
| Studio: an album | `getAlbum` | Fallback frame; "A cover is chosen; covers are turned off here." |
| Studio: the artwork page | `listAlbumArtworkChoices` | Fallback frame; a notice; the archive's candidates as text (number, image id, type), with no choice; removal still offered where it was |
| Add music: the edition list | `listMusicEditions` | No previews |
| Add music: the release review | `reviewMusicRelease` | The candidates as text; no choice; the album is added without a cover |
| Metadata and social previews | — | No `og:image` or other image metadata exists for covers |
| Image optimization | — | Covers never go through `/_next/image`: they are plain `<img>` with `no-referrer` |
| Endpoints | — | There is no artwork API or route. `/artwork/*` serves only the application's own two illustrations |

## Commands

| Command | Off |
| --- | --- |
| `setAlbumArtwork` | `cover_display_disabled`, before any provider request; nothing written |
| `importMusicRelease` with `coverImageId` | `cover_display_disabled`, before any provider request; nothing written |
| `importMusicRelease` without one | Unchanged |
| `removeAlbumArtwork` | Allowed, under its existing conditions (ADR 0006 A3 unchanged) |

Both artwork commands now take `expectedCover`: a SHA-256 fingerprint of the stored cover address, or `null`. They no longer take the address itself (`expectedCoverUrl`). The address never reaches a page's HTML or RSC payload, with the switch on or off. A stale fingerprint is `review_stale`. A malformed one, or an address, is `invalid_input`.

## Not changed

Not changed by this PR:
- the publication predicate, ADR 0006, and what is public;
- authentication, authorization, and the Server Actions' checks;
- the schema and migrations, so no stored cover changes;
- the indexing policy;
- the Content-Security-Policy, which still allows the cover hosts (`next.config.ts` fixes it at build time, and it is not the control here);
- cover removal while a journal is public or the album is archived, still refused (that is PR 3, not authorized);
- no provider is called on a normal read.

## Tests

| Layer | File | What it shows |
| --- | --- | --- |
| Unit | [`display.test.ts`](../../src/integrations/cover-art-archive/display.test.ts) | Every value above. The builders return nothing when off and image sources only when on. No module reaches the builders' file directly, no page imports the integration, no module reads the variable or a `NEXT_PUBLIC_` twin, and only three files name the image host. |
| Unit | [`public-surface.test.ts`](../../src/app/public-surface.test.ts) | The public reading module imports only the gated builder. |
| Integration (disposable PostgreSQL) | [`cover-display.integration.test.ts`](../../src/modules/catalog/cover-display.integration.test.ts) | Off, for seven values, every Studio read returns no image, says a cover is stored, and lists the candidates without images. Both choices are refused before any provider request, and every catalog table is byte-identical before and after. Removal and an import without a cover work. The token is checked. |
| Integration | `queries.integration.test.ts`, `public-album-journal.integration.test.ts` (EN and PT), `public-home.integration.test.ts` | The same readers, off and on |
| HTTP (production build) | [`cover-display.http.test.ts`](../../src/testing/cover-display.http.test.ts) | One build served unset, `false`, `TRUE`, and `true`, with public reads on, and with `true` and reads off. **Off:** no response names an image host or a stored cover's address. A stored cover's release and image id appear nowhere either, except as text in the choosing screens, which list the candidates and mark the chosen one, with no image. A case where the stored cover is one of the candidates checks this. This holds on the public pages (EN and PT, document, RSC, and the 14 transport forms) and on 28 Studio pages (EN and PT, document and RSC) with the author's session. The choosing screens show text with no control, and the action refuses `cover_display_disabled` with nothing written. **On:** the covers show and a stale view is refused. **Reads off:** still `404` with no cover. A visitor is still sent to sign-in and refused the action. `X-Robots-Tag` is on every response. |
| HTTP | `music.http.test.ts`, `public-album-journal.http.test.ts` | Unchanged behavior with the switch on. The album journal shows the fallback with it unset. |
| Browser | [`e2e/cover-display.spec.ts`](../../e2e/cover-display.spec.ts) | With the switch unset, neither a reader's nor the author's browser makes any request to a cover host, at 1280 px and at 390 px, in both languages. The same page on a server with it on does request one. |
| Mutation | — | Forcing the switch on made 4 of the 8 HTTP tests fail |

## Recommended configuration

| Environment | `REFRAIN_COVER_DISPLAY_ENABLED` | Result |
| --- | --- | --- |
| Local and private (`pnpm dev`, the author's catalog) | `true` in `.env.development.local` | Real covers in the Studio and in the local public pages; choosing and removing work |
| Tests (HTTP, browser, CI) | Set by each test; the empty string otherwise | Independent of the developer's environment |
| Protected preview (Vercel Authentication, synthetic data) | Unset until the owner records the item 6 review | Fallback frame everywhere, the Studio included (#82) |
| Public launch (production) | `true` after the owner records the item 6 review | Real covers on every public surface; the fallback only for a missing or failed cover |

Changing it on a hosted deployment takes a new deployment, since an environment change reaches only new deployments. This change sets it on no host.

## Not covered

- **The hosted site.** Nothing is deployed. Before S4, S4 step 1 checks that the variable is unset there and that the Studio shows the fallback frame ([hosted-launch](../hosted-launch.md#public-release-sequence-stage-s4)).
- **Turning it on for a hosted deployment** needs the owner's recorded item 6 review. Journals published before a fingerprint binds their cover (the proposed ADR 0010 § 2) did not bind it. The item 6 review covers every cover the deployment would show.
- **The Content-Security-Policy** still allows the cover hosts.
- **Cover removal while a journal is public, or for an archived album,** is refused as before (A3). Its relaxation is a separate, unauthorized change.
