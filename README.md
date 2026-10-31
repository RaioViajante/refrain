<p align="center">
  <img src="reference/refrain-home-character.png" width="320" alt="Ink drawing of a person with curly hair and headphones, sitting cross-legged on the floor and writing in a notebook while looking up, next to a stack of records, a mug, a cassette and a few crumpled pages." />
</p>

<h1 align="center">refrain</h1>

<p align="center"><em>Some songs take you back.</em></p>

A personal music journal for the songs, albums, artists, and memories that stay with me.

Refrain is where I write about what music means to me over time: a memory tied to a song, a long reflection on an artist, an album considered as a whole and then track by track. It is written by one person and read by anyone I choose to share it with.

## Index

- [01 — The Journal](#01--the-journal)
- [02 — The Experience](#02--the-experience)
- [03 — Technical Direction](#03--technical-direction)
- [04 — Academic Requirements](#04--academic-requirements)
- [05 — Documentation](#05--documentation)
- [06 — Current Status](#06--current-status)

## 01 — The Journal

Refrain holds three kinds of writing:

- **Memories** connected to one or more songs or albums.
- **Artist journals** about a musician or band.
- **Album journals** about a whole record, with an optional reflection, rating, and favourite mark for each track.

Album and track ratings are optional and independent of each other. Every entry starts as a draft, can stay private, and becomes public only when it is deliberately published. There is one author and no accounts for readers. It is not a streaming service, a social network, or a rating platform.

See [Product](docs/product.md).

## 02 — The Experience

The interface is black ink on white paper. Album artwork and artist photographs are the only color, shown as they are. Kalam carries the handwritten voice; Alegreya Sans carries the reading. A few hand-drawn strokes mark what can be acted on. The character above appears once, on the homepage.

The interface is available in English and Brazilian Portuguese. Writing stays in the language it was written in, unless I write a translation myself.

The approved designs are in [`reference/`](reference/). See [Design System](docs/design-system.md).

## 03 — Technical Direction

Planned as a modular monolith: one Next.js and TypeScript application backed by PostgreSQL through Drizzle ORM, with a public journal and a private writing studio in the same codebase. The stack is a target architecture: nothing has been installed yet.

See [Architecture](docs/architecture.md), [Data Model](docs/data-model.md), and [ADR 0001](docs/decisions/0001-modular-monolith.md).

## 04 — Academic Requirements

Refrain is also a university project, presented on **November 16, 2026**. The presentation must show a working application on a real database: related tables with primary and foreign keys, complete CRUD, a SQL `JOIN`, a subquery or aggregate, and real integration between frontend, backend, and database.

See [Requirements](docs/requirements.md) for how each requirement will be met and demonstrated.

## 05 — Documentation

| Document | Contents |
| --- | --- |
| [Product](docs/product.md) | Purpose, content types, rules, and exclusions |
| [Requirements](docs/requirements.md) | Academic requirements, traceability, and evidence |
| [Architecture](docs/architecture.md) | Modules, boundaries, and planned technologies |
| [Data Model](docs/data-model.md) | Preliminary relational model and SQL |
| [Design System](docs/design-system.md) | Visual language, tokens, components, and accessibility |
| [Security](docs/security.md) | Privacy, access control, and data protection |
| [Development](docs/development.md) | Workflow, conventions, and quality gates |
| [Roadmap](docs/roadmap.md) | Milestones toward the presentation and beyond |
| [Decisions](docs/decisions/) | Architecture decision records |

Contributors and coding agents start with [`AGENTS.md`](AGENTS.md).

## 06 — Current Status

**Milestone M0: documentation and repository foundations.** The product, architecture, data model, and design direction are documented, and the approved visual references are in `reference/`. The architecture ([ADR 0001](docs/decisions/0001-modular-monolith.md)) and the domain model ([ADR 0002](docs/decisions/0002-domain-model-decisions.md)) are accepted decisions. There is no application code yet, so there is nothing to install or run. Setup instructions will be added when they exist and have been verified.

See [Roadmap](docs/roadmap.md).
