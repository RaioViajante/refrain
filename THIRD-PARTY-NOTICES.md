# Third-Party Notices

Refrain vendors no third-party code in its current tree. Its dependencies are downloaded by `pnpm install` under their own licences ([LICENSE-ARTWORK.md § Material Refrain fetches](LICENSE-ARTWORK.md#material-refrain-fetches-but-does-not-contain)).

The repository's **history**, however, contains one file with third-party code: `reference/refrain/pages/support.js`, added in `24ccad7` and removed from the tracked tree in `fa9c2ba`. It is the runtime that a design tool exported with the V4.4 mockups. It bundles the open-source components below, and their headers in that file point to licence texts that the historical tree never included. Those texts are reproduced here, so every copy of the repository carries them.

The file **also contains a design-tool runtime with no licence notice.** Nothing here licenses it. See [LICENSE-ARTWORK.md](LICENSE-ARTWORK.md#historical-design-references-not-licensed) and the open question in [Evidence: public release](docs/evidence/public-release.md#historical-design-references).

## React and ReactDOM 18 (`react.production.min.js`, `react-dom.production.min.js`)

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

The file's header reads "Modernizr 3.0.0pre (Custom Build) | MIT". Modernizr is distributed under the MIT License by the Modernizr project (https://modernizr.com). The copyright holders are the Modernizr authors, as their own licence names them. The permission notice is the MIT text above.
