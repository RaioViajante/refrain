# Third-Party Notices

Refrain vendors no third-party code in its current tree. Its dependencies are downloaded by `pnpm install` under their own licences ([LICENSE-ARTWORK.md § Material Refrain fetches](LICENSE-ARTWORK.md#material-refrain-fetches-but-does-not-contain)).

The repository's **history**, however, contains one file with third-party code: `reference/refrain/pages/support.js`, added in `24ccad7` and removed from the tracked tree in `fa9c2ba`. It is the runtime that Claude Design included in its downloadable export of the V4.4 mockups. It bundles the open-source components below, and their headers in that file point to licence texts that the historical tree never included. Those texts are reproduced here, so every copy of the repository carries them.

The file **also contains Claude Design's own runtime, with no licence notice.**
- It is not this project's, and nothing here licenses it.
- The MIT License in [LICENSE](LICENSE) does not apply to it.
- No licence text for it is known, so none is reproduced.

The owner accepts that it stays in the public history as a redistribution uncertainty, not a verified licence. See [LICENSE-ARTWORK.md](LICENSE-ARTWORK.md#historical-design-references-not-licensed) and [Evidence: public release](docs/evidence/public-release.md#historical-design-references).

## React and ReactDOM 18 (`react.production.min.js`, `react-dom.production.min.js`)

The licence file of React v18.3.1 (https://raw.githubusercontent.com/facebook/react/v18.3.1/LICENSE). The `react-dom@18.3.1` package ships the same text as its only licence file. Read 2026-11-06.

```
MIT License

Copyright (c) Facebook, Inc. and its affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Modernizr 3.0.0pre, custom build, embedded in ReactDOM

ReactDOM's production build contains a small Modernizr build, introduced by the comment "Modernizr 3.0.0pre (Custom Build) | MIT", which the historical file keeps. ReactDOM's publisher distributes it within `react-dom` under the React licence above, together with that comment, and these notices reproduce the same set.

Modernizr's own licence page (https://modernizr.com/license, read 2026-11-06) states the MIT License with the line "Copyright © 2009-2018" and the permission notice above. It names no copyright holder, and the licence file in Modernizr's repository could not be retrieved. No holder is named here beyond what those sources state.
