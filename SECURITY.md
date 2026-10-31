# Security Policy

Refrain is a single-author personal music journal. Its security goal is that the author's unpublished writing stays private and that nobody else can change it, **even someone who has read every line of this repository**. The source code is meant to become public, so Refrain's security never depends on keeping the code, the schema, or the route structure secret.

## Project status

Refrain is in early development and has not been released.

- **No deployment.** There is no hosted instance, public endpoint, or production database. Everything runs locally.
- **Implemented:** the database layer (M1.2). It has integrity constraints, the publication rules in SQL, transactional publication and deletion commands, and an isolated test database. Single-author authentication and the studio's authorization boundary (M1.3A): one account created by a local command, no public sign-up, database sessions, and a sign-in page with a placeholder studio.
- **Not implemented yet:** the Writing Studio's editing features, any route or server action that reads or writes writing, and the public journal pages.
- **Repository:** private for now, with a planned move to public.

The protections that exist today, and the ones that are still planned, are listed in [docs/security.md](docs/security.md#implemented-and-planned-protections).

## Supported versions

There are no releases, so no version is supported. Fixes reach `main` through pull requests. This section will name the supported versions once a deployed or released version exists.

| Version | Supported |
| --- | --- |
| `main` (unreleased) | Fixes land here through pull requests; it is not a supported release |

## Reporting a vulnerability

**Do not report a suspected vulnerability in a public issue, pull request, discussion, or commit message.** A public report reveals the weakness before a fix exists. For Refrain, that could expose someone's personal, unpublished writing.

### Current status of private reporting

**No private reporting channel for people outside the project exists yet.**

- GitHub's private vulnerability reporting is offered only for public repositories, and this repository is still private. On 2026-10-31 the repository's private-vulnerability-reporting API returned *Not Found*, so the feature is not enabled.
- There is no dedicated security email address.

While the repository is private, only its owner and invited collaborators can read it. A collaborator who finds a vulnerability should tell the repository owner, RaioViajante, directly and privately, not in an issue or a pull request.

**Before the repository becomes public, a working private channel must exist.** GitHub private vulnerability reporting will be enabled, and this section will be updated to explain how to use it. This is part of the [public-release gate](docs/security.md#public-release-gate).

### What to include

- the affected commit, file, and line, or the affected behavior;
- the steps to reproduce it on a local instance, with synthetic data;
- the impact: what an attacker could read, change, or learn;
- a suggested fix, if you have one.

## Responsible disclosure

- **Test only against your own local instance**, set up as described in [docs/development.md](docs/development.md#local-setup). There is no hosted instance, and you must never test against systems you do not own.
- **Use synthetic data only.** Never access, copy, keep, or share the author's writing or personal data. If you come across any, stop and tell the maintainer.
- **Do not attack third-party services**, such as MusicBrainz, the Cover Art Archive, Wikimedia Commons, or GitHub, and do not run automated scans against them.
- **Give the maintainer reasonable time to fix the problem** before you disclose it, and agree on a disclosure date together.
- There is no bug bounty.

## Scope

**In scope:** anything that would let someone:

- read unpublished writing: drafts, private entries, unpublished translations, unpublished track reflections and their ratings or favourite marks, or deleted entries;
- learn that such writing exists;
- act as the author;
- change or destroy writing;
- obtain secrets;
- make the integration tests reach a database whose contents matter;
- compromise this repository's dependencies or CI.

**Out of scope:**

- Findings whose only basis is that the source code is readable. The code is meant to be public.
- The local development credentials in `.env.example`, `compose.yaml`, and the CI workflow. They are placeholders for disposable local and CI databases, not secrets.
- Vulnerabilities in third-party packages that Refrain's use of them does not make exploitable. Report those to the package maintainers.

## How security is maintained

Refrain has one maintainer and is maintained on a best-effort basis. There is no committed response time.

- **Security never depends on secrecy of the source.** Protection comes from server-verified authorization, data isolation, least privilege, and tested behavior ([docs/security.md](docs/security.md)).
- **Security requirements** are written in [docs/security.md](docs/security.md) and in the accepted [architecture decisions](docs/decisions/). Each privacy rule needs an automated test before the feature it governs ships.
- **Reviews.** Changes reach `main` only through pull requests, and are reviewed independently where possible. Branch protection is not available on the repository's current plan, so this rule is followed by convention ([docs/development.md](docs/development.md#repository-protection)). Changes that touch a trust boundary are reviewed with the project's security review procedure ([`.claude/skills/refrain-security-review/SKILL.md`](.claude/skills/refrain-security-review/SKILL.md)).
- **Dependencies.** Versions are pinned exactly and the lockfile is committed. pnpm installs only versions published at least seven days earlier, and blocks dependency install scripts unless they are explicitly allowed. Advisories are evaluated with `pnpm audit`.
- **CI** has read-only permissions and no secrets, and its actions are pinned to full commit SHAs.
- **Fixes** are made on a branch, with a regression test where the problem can be tested. Once the repository is public, a confirmed vulnerability gets a GitHub security advisory.
