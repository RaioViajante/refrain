# Evidence: media polish (PR #80)

The first increment of the final visual polish for the November 16 presentation: a chosen album cover in every frame the approved V4.4 Studio screens draw for an album. Studio presentation only. It changes no public page, visibility rule, cache directive, proxy rule, Content-Security-Policy, schema, or release gate. This file records the checks that are not visible in the diff.

## Regression tests: a new image after a failed one

A frame that had failed to load kept that failure when its source changed. The fix keys the shared image component by its source.

| Test | What it does | Without the React key | With it |
| --- | --- | --- | --- |
| `e2e/music.spec.ts`, "a new cover replaces one that failed to load" | The stored cover fails, the frame says "artwork not shown" with no image in it, the author chooses another cover on the same page, and the new one loads in the same frame | Fails: the image is not found | Passes |
| `e2e/photos.spec.ts`, "a new photograph replaces one that failed to load" | The photograph on file fails, the frame says "photograph not shown", another tab approves a different photograph through the Studio's review, this page refreshes in place, and the new one loads | Fails: the image is not found | Passes |

Both run at desktop width and at 390px. Each key was removed, the application rebuilt, and the test run, to show that it detects the defect. A first version of the photograph test went through the review page in the same tab and passed without the key, because that navigation remounts the frame, so it was rewritten.

## The Add to catalog stall

One real import added nothing during the audit, on a build of `main` from before this pull request. It was not reproduced in 13 later real imports, and every injected provider failure produced a visible message in 5 to 18 seconds with nothing written. This pull request changes no file on the import path. Recorded with its evidence in issue #81.

## Independent security review

Procedure: `/refrain-security-review`, run by a review agent in a context separate from the one that wrote the change, on 2026-11-08, against `b3074639197452821a160713ab2b4b79f4606bec` (base `3e94eeb1413df42b546e7f6662c6c39ca2feed2a`). **Recommendation: approve with notes.** No exploitable vulnerability was found. A passing review is evidence, not approval.

| Severity | Findings |
| --- | --- |
| Critical | None |
| High | None |
| Medium | None |
| Low | L1 and L2, below |
| Info | I1 to I5, below |

- **L1 (theoretical).** Row thumbnails make the author's browser request covers from the Cover Art Archive and `archive.org`, including for albums behind draft, private, and deleted journals. Someone with those hosts' logs could infer which albums the author writes about. The request carries the release identifier, the image identifier, and the size; no writing, title, entry identifier, status, Refrain cookie, or page address leaves. Recorded with the privacy-notice follow-up in [Security § Deployment gate](../security.md#deployment-gate), item 6. `loading="lazy"` on row thumbnails, or an image proxy, would reduce it.
- **L2 (test gap).** No committed test requests the changed pages with a stored cover in place. Access control on those pages is tested with fixtures that have no cover; the review's temporary probe covered this case and passed.
- **I1.** Item 6 of the deployment gate is written about public pages, yet says a hosted deployment must not show covers. Whether a private hosted Studio is in scope is the owner's to state.
- **I2.** The author check on the new queries is enforced by the compiler through the `AuthorizedAuthor` brand, as for the module's other queries.
- **I3.** The test that scans Studio pages checks that a page authorizes, not that it does so first. The order was checked by hand. This predates the pull request.
- **I4.** The Content-Security-Policy's `*.archive.org` allowance predates the pull request and is already a listed hosted follow-up.
- **I5.** `listAlbumCovers` reads every album with a cover. This is a small, author-only read in a single-author catalog, so it is a performance note.

| Area | Verdict | Evidence |
| --- | --- | --- |
| Authorization of the new queries | Pass | Exported only through `src/modules/catalog/studio.ts` (`server-only`); each of the eight pages authorizes before reading; `public-surface.test.ts` forbids the Catalog in public files; anonymous, forged-cookie, and wrong-author requests, as documents and as RSC, returned nothing of a stored cover |
| Malformed stored artwork | Pass | Strict parser, addresses rebuilt from two validated parts; 45 hostile inputs in a temporary probe accepted none, with no slow input; a tampered row never reached a page |
| Remote image handling | Pass, unchanged | `src` and `srcSet` use the archive's origin only; the server does not fetch them; `img-src` unchanged; `no-referrer` by header and attribute |
| Private data exposure | Pass, with L1 | Only the release identifier, image identifier, and size reach the third party |
| Client-side image loading | Pass | The client component receives `src`, `srcSet`, `sizes`, `width`, and `height` only |
| Public-read and cache boundaries | Pass, unchanged | The diff over the proxy, headers, Publication, public routes, Identity, sitemap, schema, dependencies, and CI is empty; every changed Studio address answered `private, no-store` |

The review ran the unit suite (905 passed), the HTTP suite (561 passed), the changed integration file (6 passed), `tsc`, ESLint, Prettier, and `gitleaks` with redaction (no leaks), plus the temporary probes above, which were removed. It did not run Playwright, the full integration suite, or anything hosted. The full suites were run on the final commit separately, as the pull request records.

**Missing negative tests, as follow-ups:** the changed pages requested anonymously, with a forged cookie, and as another author with a stored cover in place; a rendered-page test that a tampered row never reaches HTML; `referrerpolicy` on the new thumbnails and frames; a browser test of the hosts Studio cover pages request; and `/studio/journals/<id>/edit`, `/studio/journals/new`, and `/studio/catalog/add` in the private-cache HTTP test.

## Visual polish 2

PR #84: the chosen photograph in the Studio's Artists list, the closing links of the public reading pages, and the Studio's "published" wording. No proxy rule, predicate, sitemap, cache directive, schema, or gate changes.

**Independent security review.** `/refrain-security-review`, by a review agent in a separate context, on 2026-11-08, against `f3352eef37b707f5fcb154b241f2a9268673c609` (base `bde9bee913a7ea4b2e63ae89dc3e432ed8101673`). **Recommendation: approve with notes.** No Critical, High, or Medium finding, and no exploitable vulnerability. A passing review is evidence, not approval.

- **L1 (theoretical).** The Artists list requests every chosen photograph from Wikimedia at once, and Commons file names often contain an artist's name, so someone with Wikimedia's logs could infer who is in the private catalog. No writing, Refrain identifier, status, cookie, or page address leaves. Recorded in [Security § Deployment gate](../security.md#deployment-gate), item 7, with the thumbnails' lack of attribution.
- **L2 (test gap).** Coverage of the new query is indirect, because no committed test requests `/studio/artists` with a stored photograph in place. The review's temporary test covered it and passed.
- **I1.** A wording error in the design document, corrected. **I2.** A stale comment in `src/integrations/wikimedia-commons/photo.ts`, older than this change. **I3.** "More about <name>" uses the credited name, as the credit link has since M3.5.

| Area | Verdict | Evidence |
| --- | --- | --- |
| Authorization of `listArtistPhotos` | Pass | Called only by `src/app/studio/artists/page.tsx`, after `authorizeAuthor`; exported only through the server-only `studio.ts`; anonymous, tampered, and unrelated-cookie requests returned no thumbnail address or artist name |
| Malformed stored photographs | Pass | `artistPhotoOf` requires every column to be exactly what Refrain writes, and addresses are rebuilt; foreign, attribute-injection, unknown-license, and markup rows reached no document or RSC payload |
| Remote image handling | Pass | `thumb.wikimedia.org` only; `img-src` unchanged; `no-referrer` by header and attribute; the client component receives `src`, `srcSet`, `sizes`, `width`, and `height` only |
| Public visibility of the new links | Pass | "More about" comes only from `credit.artistAddress` in the Publication read model, the same value and condition as the credit link since M3.5; the archive links are the header's own addresses |
| Public-read and cache boundaries | Pass, unchanged | No diff over the proxy, headers, Publication, sitemap, or schema; the switch-off HTTP suites passed |
| Private data exposure | Pass, with L1 | Only the viewer's address and browser metadata and the file name reach Wikimedia |

The review ran the unit suite (906 passed), the HTTP suite (565 passed), the affected integration files (91 passed), `tsc`, a production build, and `gitleaks` with redaction (no leaks), and removed its temporary test. It did not run Playwright or contact any provider. The browser suite was run separately, as the pull request records.

**Missing negative tests, as follow-ups:** `/studio/artists` requested anonymously, tampered, and as another author with a stored photograph in place; a rendered-page test that a tampered row never reaches its HTML; the exact shape of `listArtistPhotos`; and `referrerpolicy` and requested hosts on the list thumbnail.

## Add music polish

**Why "Jeff Buckley Live" came first.** MusicBrainz ranks it first. Refrain sends `(terms) OR artist:(terms)` and, until this change, kept the provider's order unchanged, so neither the query nor the presentation moved it. For "grace jeff buckley", MusicBrainz scored "Jeff Buckley Live" 100, and Grace's single and album 94 or 95 (2026-11-08 and 09): a release titled with the artist's name matches every word of the query.

**The rule, and how it was tested.** A result is a complete match when the words typed are its title plus words of its credited artists. Complete matches come first, then a studio album before an EP, an EP before a single, and a release with a secondary type (a live album, a compilation) after those. Everything else keeps the provider's order. Nothing is hidden or relabelled, and the code names no album or artist. It was measured on 17 real searches before being built:

| Search | The expected album's position: provider | With the rule |
| --- | --- | --- |
| grace jeff buckley | 3 | 1 |
| blue joni mitchell | 3 | 1 |
| abbey road beatles | 2 | 1 |
| the wall pink floyd | 2 | 1 |
| kid a | 12 | 1 |
| pink moon nick drake, ok computer radiohead, thriller michael jackson, nevermind nirvana, grace, carrie & lowell sufjan stevens, cleopatra the lumineers, jeff buckley live, lemonade beyonce | 1 | 1 |
| in rainbows radiohead | 2 | 2 |
| twin fantasy car seat headrest, grace ziggy marley | none in the top 25 fits the test's "plain studio album" | Unchanged |

**Edition covers.** MusicBrainz's `cover-art-archive.front` already said which editions have a front cover. A row asks for a preview only when it is `true`, from the archive's `/release/<id>/front-250` address, built from the validated identifier and never stored. There are at most 100 rows and the images are lazy, so the browser requests only what is near the viewport; the server makes no extra provider call. Of Grace's 26 editions, 22 show a cover and 4 keep the record mark. Choosing a cover is unchanged: the review, with a real image identifier, chosen by the author.

**Independent security review.** `/refrain-security-review`, by a review agent in a separate context, on 2026-11-09, against `edb88982f59cf07b5191fa691b77cef9ff7f3dbe` (base `264411df37d7ea3e8a340fb5f871d71a6768b435`). **Recommendation: approve with notes.** No Critical, High, or Medium finding, and no exploitable vulnerability. A passing review is evidence, not approval.

| Finding | Outcome |
| --- | --- |
| L1: `editionPlace` read a plain object, so a hostile `country` such as `constructor` returned a function, which could break one review page | Fixed with a `Map`, and tested |
| L2: the same pattern in the ranking's type table could only disturb the order | Fixed with a `Map`, and tested |
| L3: the per-word wildcard test could not fail | A bare `%`, a bare `_`, and a quote are now tested |
| L4: two statements said an image address always has an image id | Corrected |
| I4: an impossible date such as `1994-13-40` read as a nearby date | Fixed: shown as sent |
| I1: opening an edition list tells the archives which album is being browsed. No writing or Refrain identifier is sent. I2: lazy loading limits cost, not disclosure; the bound is 100 images. I5: gate item 6 applies to previews as to any hosted cover | Recorded |

The review found every verdict a pass: authorization, the per-word SQL (bound parameters, escaped wildcards), provider data, remote images, ranking, and public-read and cache boundaries. A cover cannot be chosen through a preview: `cover_url` is written only after a digits-only image identifier matches a fresh archive listing. The review ran the unit suite (926 passed), the catalog integration file and the music HTTP file, a build, and `gitleaks` (no leaks), and it did not run Playwright or contact a provider. The fixes above were reviewed separately by Codex, which also found an eight-word limit that dropped later search words, now removed; the 200-character input limit is the bound.

