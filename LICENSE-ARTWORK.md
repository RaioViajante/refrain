# Artwork and other material not covered by the MIT License

**Status: confirmed by the owner on 2026-11-06** ([Security § Public-release gate](docs/security.md#public-release-gate), item 10).

The [MIT License](LICENSE), copyright RaioViajante, covers Refrain's original source code and documentation. It does **not** cover the material below. Third-party components keep their own licences, or their own unverified status where no licence is stated (see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)). Nothing in this repository grants rights over them.

## Original artwork: all rights reserved

Copyright © 2026 RaioViajante. All rights reserved.

This covers all original artwork the owner creates for Refrain, wherever it appears in this repository or its history:

- **the home character** and its likeness;
- **the illustrations**, such as the home and not-found drawings, in every size, format, colour treatment, and derived copy;
- **Refrain's visual identity**: any mark, favicon, cursor, or other identifying artwork;
- **any other original artwork by the owner**, including the owner's designs among the historical design references below.

The code that implements the interface is source code under the MIT License. That includes the components, the CSS, and the stroke generator with its generated output. That licence does not extend to the artwork the code displays.

In the current tree, these files are artwork:

| File | What it is |
| --- | --- |
| `public/artwork/refrain-home-character.png` | The original home illustration, byte for byte |
| `public/artwork/refrain-home-character.webp` | Its production copy for the Home |
| `public/artwork/refrain-404.webp` | The not-found illustration |
| `docs/assets/refrain-home-character-dark.png` | The home illustration for the README's dark theme |

They are not licensed for reuse. You may view them here and run the application unmodified for your own evaluation. You may not copy, adapt, or redistribute them, and you may not use them in another project or to represent another product. If you fork Refrain, replace them with your own artwork.

## Historical design references: not licensed

The repository's history contains a `reference/` directory: the V4.4 design mockups made with Claude Design and exported from it, their screen captures, a favicon kit, a cursor kit, and design notes. It was added in `24ccad7` and removed from the tracked tree in `fa9c2ba`. It stays in the history by the owner's decision ([Security § Public-release gate](docs/security.md#public-release-gate)). **No licence is granted for anything in it**, at any commit.

- **The owner's designs** in it are all rights reserved, as above.
- **It also holds material that is not the owner's.** The owner claims no rights over that material, and this repository grants none:
  - `reference/refrain/pages/support.js` is the runtime that Claude Design included in its downloadable export of the mockups.
    - Most of it is React and ReactDOM 18, which embed a Modernizr build, all under the MIT License. The file keeps their short headers. Their full licence texts, which the historical tree lacked, are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
    - The rest is Claude Design's own runtime (`__dcBoot` and related code), with no licence notice. It is Anthropic's, not the owner's. It is not licensed here, and the MIT License does not apply to it. The owner accepts that it stays in the public history as an unverified redistribution, not as a licensed one ([Evidence: public release](docs/evidence/public-release.md#historical-design-references)).
  - The mockups name real albums, artists, tracks, and record labels as sample content, and load fonts and libraries from third-party servers. Those names, fonts, and libraries belong to their owners.

## Material Refrain fetches but does not contain

- **Fonts.** Kalam and Alegreya Sans are downloaded from Google Fonts when the site is built, under the SIL Open Font License 1.1. No font file is in this repository.
- **Album artwork and artist photographs.** These come from the Cover Art Archive and Wikimedia Commons at runtime, under their own terms. A photograph is shown only with the credit and licence its file states ([Security § External providers](docs/security.md#external-providers)). None is in this repository.
- **Dependencies.** The npm packages that `pnpm install` downloads are under their own licences, almost all permissive (MIT, Apache-2.0, BSD, ISC; also MPL-2.0, and LGPL-3.0 for the `sharp` image library's native binary). None is vendored in this repository.

## Writing

The author's journal writing is not in this repository, and no licence here covers it. Every name and text in the tests and fixtures is synthetic and labeled `[Test]`.
