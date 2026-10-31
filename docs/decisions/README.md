# Architecture Decision Records

Significant architectural, data, and workflow decisions are recorded here as short, numbered documents. An accepted ADR is not edited to change its decision. A new ADR supersedes it, and the old one's status is updated to point to it.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-modular-monolith.md) | Modular Monolith | Accepted |
| [0002](0002-domain-model-decisions.md) | Domain Model Decisions | Accepted |

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

- Enum representation in PostgreSQL.
- Restore behavior for published language versions.
- Slug release after permanent deletion.
- The mechanism for automatic purge, once its preconditions are met.
