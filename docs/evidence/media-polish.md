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
