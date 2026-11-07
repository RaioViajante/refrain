<img align="right" src="public/artwork/refrain-home-character.png" width="38%" alt="Ink drawing of a person with curly hair and headphones, sitting cross-legged on the floor and writing in a notebook while looking up, next to a stack of records, a mug, a cassette and a few crumpled pages." />

<p><em>some songs take you back.</em></p>

a place to remember what music felt like.<br>
songs, albums, artists, and the moments they stayed with me.

<br clear="right">

<pre>
00. <a href="#the-journal">journal</a> ·· songs, records, people, memories
01. <a href="#whats-inside">inside</a> ··· where everything lives
02. <a href="#run-it">run</a> ······ start it locally
03. <a href="#read-next">docs</a> ····· the longer version
04. <a href="#current-status">status</a> ··· a work in progress
05. <a href="#license">license</a> ·· code, artwork, contributing
</pre>

#### the journal

<pre>
memories ········· a moment and its music
artist journals ·· a musician or band
album journals ··· a record, track by track
</pre>

each track can have its own reflection, rating, and favourite mark. ratings are optional. every entry starts as a draft and stays private until it is published on purpose. one author, no reader accounts.

black ink on white paper; the only color comes from album art and photographs. the interface speaks english and brazilian portuguese, and writing stays in the language it was written in.

most of this is built and runs locally. the source code is public; the website is not yet. a private, sign-in-protected test deployment exists, no public page is online, and the interface is english only for now. what exists and what doesn't is under [status](#current-status). the approved design is written down in [design-system](docs/design-system.md).

#### what's inside

```
src/app/           routes · the studio, the home, one public journal page
src/modules/       catalog, journals, publication, identity
src/integrations/  musicbrainz, cover art archive
src/db/            database client, schema, migrations
src/ops/           local backup and restore check
ops/backup/        hosted-backup toolchain · not provisioned yet
e2e/               browser tests
docs/              the long version
public/            app assets · the illustration
compose.yaml       local postgresql 17, and 17 and 18 for tests
.github/           ci on every pull request
```

#### run it

needs node 24.22.2 (`.nvmrc`), pnpm 12, and docker.

```
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm dev
```

then open `http://localhost:3000`. the studio is at `/studio` and needs the author account first: see [development.md](docs/development.md#first-time-setup-of-the-author-account). checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:integration` after `pnpm db:test:up`. the rest is in [development.md](docs/development.md).

#### read next

<pre>
<a href="docs/product.md">product</a> ········ what it is, what it isn't
<a href="docs/requirements.md">requirements</a> ··· the academic requirements
<a href="docs/architecture.md">architecture</a> ··· modules and boundaries
<a href="docs/data-model.md">data-model</a> ····· tables and constraints
<a href="docs/design-system.md">design-system</a> ·· ink, paper, two typefaces
<a href="docs/security.md">security</a> ······· privacy and access
<a href="docs/development.md">development</a> ···· setup, checks, workflow
<a href="docs/roadmap.md">roadmap</a> ········ what comes next
<a href="docs/decisions/">decisions</a> ······ why it is built this way
<a href="AGENTS.md">agents</a> ········· how to change the code
</pre>

#### current status

built and merged, local only (through m3.5): the relational core on postgresql 17, single-author sign-in, and the writing studio: artists, albums, tracks, and album journals with track-by-track reflections, ratings, and favourites; recently deleted with restore; and publishing that shows what will become public and waits for the author's confirmation. add music searches musicbrainz and takes covers from the cover art archive. the first public page, an album journal at `/albums/<slug>`, stays behind a switch that is off by default. artist photographs come from wikimedia commons. the public home lists published album journals, and an artist has a public page while a published album journal credits them. backups with a restore check, unit, integration, http, and browser tests, and ci.

also merged, local only: m3.6, the memories studio: memories written privately, with their songs from the catalog.

also merged, local only: m3.7, public memories: a memory is published through the same review and confirmation as an album journal, a change to a published memory asks first, and a published memory has a page at `/memories/<slug>`, behind the same switch.

also merged, local only: m3.8a, public archives: `/albums`, `/artists`, and `/memories` list exactly what has a public page, and the header links all four sections; and m3.8b, the home's artists and memories sections.

in progress: m4.2, the academic demonstration kit, on its own branch.

planned: artist journals, the brazilian portuguese interface and its language selector, author translations, "delete now", and the academic release (m4).

also merged: postgresql 18 support (the hosted database's version, tested in ci alongside 17); a fix that keeps studio responses out of shared caches; and a hosted-backup toolchain with encrypted, restore-checked bundles and an owner's restore drill ([hosted-backups.md](docs/hosted-backups.md)), not provisioned yet. its retention policy, [adr 0007](docs/decisions/0007-hosted-backups-and-retention.md), was accepted on 2026-11-07.

hosting: one private test deployment, behind the hosting provider's sign-in on every request, with the public-reads switch off and synthetic data only. no real writing is hosted until backups are running and tested. public pages stay off until the [release gates](docs/security.md#public-page-release-gates) are closed. see [roadmap.md](docs/roadmap.md).

refrain is also a university project, presented on november 16, 2026. see [requirements.md](docs/requirements.md), and the demonstration kit in [evidence/m4.md](docs/evidence/m4.md).

#### license

the source code and documentation are under the [mit license](LICENSE). the original artwork is all rights reserved, and the design references in the history are not licensed: see [license-artwork](LICENSE-ARTWORK.md). to report a security problem, see [security](SECURITY.md); to contribute, see [contributing](CONTRIBUTING.md).
