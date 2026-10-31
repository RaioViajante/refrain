<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/refrain-home-character-dark.png">
    <img src="public/artwork/refrain-home-character.png" width="320" alt="Ink drawing of a person with curly hair and headphones, sitting cross-legged on the floor and writing in a notebook while looking up, next to a stack of records, a mug, a cassette and a few crumpled pages." />
  </picture>
</p>

<h3 align="center">refrain</h3>

<p align="center"><em>some songs take you back.</em></p>

a place to remember what music felt like.<br>
songs, albums, artists, and the moments they stayed with me.

<pre>
00. <a href="#the-journal">journal</a> ·· songs, records, people, memories
01. <a href="#whats-inside">inside</a> ··· where everything lives
02. <a href="#run-it">run</a> ······ start it locally
03. <a href="#read-next">docs</a> ····· the longer version
04. <a href="#current-status">status</a> ··· a work in progress
</pre>

#### the journal

<pre>
memories ········· a moment and its music
artist journals ·· a musician or band
album journals ··· a record, track by track
</pre>

each track can have its own reflection, rating, and favourite mark. ratings are optional. every entry starts as a draft and stays private until it is published on purpose. one author, no reader accounts.

black ink on white paper; the only color comes from album art and photographs. the interface speaks english and brazilian portuguese, and writing stays in the language it was written in.

none of this is built yet. the approved design is written down in [design-system](docs/design-system.md).

#### what's inside

```
src/app/      routes · a dev page for now
src/db/       database client and schema
docs/         the long version
public/       app assets · the illustration
compose.yaml  local postgresql 17
.github/      ci on every pull request
```

#### run it

needs node 24.22.2 (`.nvmrc`), pnpm 12, and docker.

```
pnpm install
cp .env.example .env
pnpm db:up
pnpm dev
```

then open `http://localhost:3000`. checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`. the rest is in [development.md](docs/development.md).

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

m1.1, the application foundation: the app runs locally against postgresql 17, with tests and ci. there is no schema, writing studio, or journal page yet. see [roadmap.md](docs/roadmap.md).

refrain is also a university project, presented on november 16, 2026. see [requirements.md](docs/requirements.md).
