# Architecture Decision Records

Significant architectural, data, and workflow decisions are recorded here as short, numbered documents. An accepted ADR is not edited to change its decision. A new ADR supersedes it, and the old one's status is updated to point to it.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-modular-monolith.md) | Modular Monolith | Accepted |

## Format

File name: `NNNN-short-title.md`. Sections:

- **Status:** Proposed, Accepted, or Superseded by NNNN.
- **Date**
- **Context:** the forces at play and the alternatives considered.
- **Decision**
- **Consequences:** positive and negative.
- **Revisit when** (optional)

## Expected next decisions

These come from the open questions in [Data Model](../data-model.md#open-questions):

- Catalog removal: archive vs. detach.
- One journal per album and per artist.
- Rich-text storage and export format.
- Enum representation in PostgreSQL.
