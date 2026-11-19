# Artwork: shipped and pending

Every artwork file published by this application must be listed under **Shipped**, with evidence of the right to publish it: the owner's documented authorship, or a licence that can be verified. The owner's permission to publish a file is necessary but is not, by itself, evidence of that right.

Photographs are never committed. They are uploaded in the Studio, and each appears publicly only once the owner confirms the right to publish it ([decision 0002](decisions/0002-mixtape-archive-product.md)).

## Shipped

None.

<!-- Format for each shipped file (src/assets.test.ts reads this table):
| `public/<path>` | <source> | <author> | <licence or authorship evidence> | `<sha256>` |
-->

| File | Source | Author | Evidence of right to publish | SHA-256 |
| --- | --- | --- | --- | --- |

## Pending: not published

The approved design reference (`refrain-referencia.zip`, exported from Claude Design on 2026-11-18, local-only in `reference/`) contains the identity artwork below. The owner authorized publishing it on 2026-11-19, but **its authorship and licence are not verified**: the reference does not say who made the stars or the tree engraving, and an engraving in particular may be a third party's work. Until the owner documents each file's origin, none is published, and the application renders without them:

- the stars and the tree engraving render nothing (`MARKS_CLEARED` in `src/components/marks.tsx`);
- the header's home link shows a typographic star (✦) instead of the star mark;
- the system cursor and the browser's default icon are used.

These files were committed by mistake in pull request #135 (commit `bcd88ac`) and removed in a later commit of the same pull request, before merge. They remain reachable in the repository's history at that commit; removing them from history would require rewriting it, which is the owner's decision.

| Reference file | What it is | SHA-256 |
| --- | --- | --- |
| `assets/marcas/sparkle1.png` | drawn star | `f670d2687a3b83ef30758f9a8551fab247cd2b634c3d8dfa2977223dade5d6f1` |
| `assets/marcas/sparkle2.png` | drawn star | `c0e5486fc0dcb5750e72e907f5d8399f1aa5302a40eb1499973bf4fe2d849e23` |
| `assets/marcas/sparkle3.png` | drawn star | `59901c3bb5a9474d229ecb8780d1dc4bcdba1a9b0477f20c6a451cf1b6acece1` |
| `assets/marcas/sparkle4.png` | drawn star | `94ba7aaf156e250f35e56e07ec8214442c3c7170276bfc217159cbeb79daf083` |
| `assets/marcas/eng_trees_r.png` | engraving of trees | `ecde91b0ce602f8e6f21e1276d09fe603e11d4b12091a536baaabc90836ad4dc` |
| `assets/icones/mark_600.png` | star mark (header) | `b509741c332168d125cacfb75e0a305f8d717347269a1a39d5702f2368847e6a` |
| `assets/icones/favicon.svg` | favicon | `133dbcf5846ce6ffbfc0cac3b36550350d9e3e7948cf4ed4f5a5a4c999617f73` |
| `assets/icones/favicon-16.png` | favicon | `a53f1ea855ac791e0778c3e8dad8a8fb01c138de2e89777de5ebc787a3be0aa5` |
| `assets/icones/favicon-32.png` | favicon | `854052b65fa91747b131ffe39cbe1cef43663940ff3ef84d8783524a37b0921d` |
| `assets/icones/apple-touch-icon.png` | home-screen icon | `ba4834756afa32622b4dcb1fd01621ccb02b645eda227714285ab1b367d39cb5` |
| `assets/icones/cursor-dot.png` | cursor | `527267841dd5fd1009bcc18346ec551fe79266b413eed94627091025e58e6b55` |
| `assets/icones/cursor-dot@2x.png` | cursor | `e3e28aded98b900f4e3a5c08bdd530a05ed7c8f6916941e573fb4b14038dd489` |
| `assets/icones/cursor-ring.png` | cursor over links | `87ae2c448576a76247ed2955b1e3189bf06a8592aaa66f0ee93bd1707d895e6b` |
| `assets/icones/cursor-ring@2x.png` | cursor over links | `e74f02547bc7558d5bd93bc063c17f65f4883dbe9c06b5eff40f7d77cfc6fe0c` |

**To clear a file:** the owner states its origin (made by the owner, made for the owner under terms that grant the right, or a named licence with its source), that evidence is recorded in the Shipped table, and the file is copied byte for byte into `public/`.
