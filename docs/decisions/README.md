# Architecture Decision Records

Significant architectural, data, and workflow decisions are recorded here as short, numbered documents. An accepted ADR is not edited to change its decision. A new ADR supersedes it, and the old one's status is updated to point to it.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-modular-monolith.md) | Modular Monolith | Accepted |
| [0002](0002-domain-model-decisions.md) | Domain Model Decisions | Accepted |
| [0003](0003-relational-schema-conventions.md) | Relational Schema Conventions | Accepted |
| [0004](0004-single-author-identity.md) | Single-Author Identity and Access | Accepted |
| [0005](0005-restoring-deleted-journals.md) | Restoring Deleted Journals | Accepted |
| [0006](0006-publication-decision-and-acknowledgement.md) | Publication Decision and Acknowledgement | Accepted; amended through 2026-11-15 (A1 to A7, and A13 on 2026-11-15; A7's public surfaces are built, its Studio surfaces are not) |
| [0007](0007-hosted-backups-and-retention.md) | Hosted Backups, Retention, and Recovery | Accepted (2026-11-07); not provisioned yet |
| [0008](0008-interface-localization.md) | Interface Localization (English and Brazilian Portuguese) | Accepted (2026-11-10); built (public pages and Studio); amendment 1 accepted 2026-11-15 |
| [0011](0011-refrain-v3-identity-and-product.md) | Refrain v3: Visual Identity and Product Changes | **Partly accepted** (2026-11-15) for the built work; the rest Proposed (see its Status) |
| [0012](0012-external-services-music-story-email-media.md) | External Services: Music Story, Transactional Email, and Media Storage | **Partly accepted** (2026-11-15): § 1 items 1–3 and 8, for the unwired adapter only; the rest Proposed |
| [0013](0013-confirmed-catalog-changes-to-published-pages.md) | Confirmed Catalog Changes to Published Pages (G8) | **Proposed** (2026-11-16); not accepted. Replaces, for G8, the refusal rule of the proposed ADR 0010 (#99) |

ADR numbers 0009 and 0010 are used by proposals in open draft pull requests #98 and #99, which are not merged and not accepted.

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
