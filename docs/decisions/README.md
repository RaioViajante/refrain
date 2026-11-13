# Architecture Decision Records

Significant architectural, data, and workflow decisions are recorded here as short, numbered documents. An accepted ADR is not edited to change its decision. A new ADR supersedes it, and the old one's status is updated to point to it.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-modular-monolith.md) | Modular Monolith | Accepted |
| [0002](0002-domain-model-decisions.md) | Domain Model Decisions | Accepted |
| [0003](0003-relational-schema-conventions.md) | Relational Schema Conventions | Accepted |
| [0004](0004-single-author-identity.md) | Single-Author Identity and Access | Accepted |
| [0005](0005-restoring-deleted-journals.md) | Restoring Deleted Journals | Accepted |
| [0006](0006-publication-decision-and-acknowledgement.md) | Publication Decision and Acknowledgement | Accepted; amended through 2026-11-10 (A1 to A7; A7's public surfaces are built, its Studio surfaces are not) |
| [0007](0007-hosted-backups-and-retention.md) | Hosted Backups, Retention, and Recovery | Accepted (2026-11-07); not provisioned yet |
| [0008](0008-interface-localization.md) | Interface Localization (English and Brazilian Portuguese) | Accepted (2026-11-10); not implemented |
| [0009](0009-public-music-collection.md) | The Public Music Collection | Proposed (2026-11-12, revised 2026-11-13); not accepted, nothing built |

## Format

File name: `NNNN-short-title.md`. Sections:

- **Status:** Proposed, Accepted, or Superseded by NNNN.
- **Date**
- **Context:** the forces at play and the alternatives considered.
- **Decision**
- **Consequences:** positive and negative.
- **Revisit when** (optional)

## Expected next decisions

These come from the open questions in [Data Model](../data-model.md#open-questions). ADR 0003 settles enum representation, publication history, and slug retention.

- The mechanism for automatic purge, once its preconditions are met.
