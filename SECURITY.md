# Security Policy

Refrain is a single-author personal music journal. Its security goal is that the author's unpublished writing stays private and that nobody else can change it, **even someone who has read every line of this repository**. The source code is meant to become public, so Refrain's security never depends on keeping the code, the schema, or the route structure secret.

## Project status

Refrain is in development and has not been released.

- **Implemented and tested locally:**
  - the relational domain with its integrity constraints and the publication rules;
  - single-author authentication and the studio's authorization boundary;
  - the Writing Studio: catalog, album journals with track reflections, memories, Recently deleted with restore, and publication through a reviewed, confirmed workflow;
  - the public pages (album journals, artists, memories, archives, the Home), behind a switch that is off by default;
  - a local backup tool and a hosted-backup toolchain that is not provisioned yet.

  The full list, with what is still planned, is in [README.md](README.md#current-status) and [docs/roadmap.md](docs/roadmap.md).
- **Hosting:** one private test deployment exists. Every request to it needs the owner's hosting-account authentication, its public-reads switch is off, and it holds synthetic data only. **It is not a target:** do not probe it (see [Responsible disclosure](#responsible-disclosure)). No public instance exists.
- **Repository:** public, once the owner completes the [public-release gate](docs/security.md#public-release-gate), with its complete development history. That history includes design references that are not licensed for reuse ([LICENSE-ARTWORK.md](LICENSE-ARTWORK.md)).

The protections that exist today, and the ones that are still planned, are listed in [docs/security.md](docs/security.md#implemented-and-planned-protections).

## Supported versions

There are no releases, so no version is supported. Fixes reach `main` through pull requests. This section will name the supported versions once a released version exists.

| Version | Supported |
| --- | --- |
| `main` (unreleased) | Fixes land here through pull requests; it is not a supported release |

## Reporting a vulnerability

**Do not report a suspected vulnerability in a public issue, pull request, discussion, or commit message.** A public report reveals the weakness before a fix exists. For Refrain, that could expose someone's personal, unpublished writing.

### How to report privately

Use **GitHub's private vulnerability reporting**:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Fill in the form.

Only the maintainer and you can see the report. The maintainer is notified, and the fix can be prepared in a private fork and published as a GitHub security advisory.

The owner enables this feature as part of making the repository public ([public-release gate](docs/security.md#public-release-gate), item 9). If the **Report a vulnerability** button is ever missing, do not describe the problem anywhere public. Open an issue titled "Security contact request", with no details, and the maintainer will reply with a private channel. There is no dedicated security email address.

### What to include

- the affected commit, file, and line, or the affected behavior;
- the steps to reproduce it on a local instance, with synthetic data;
- the impact: what an attacker could read, change, or learn;
- a suggested fix, if you have one.

## Responsible disclosure

- **Test only against your own local instance**, set up as described in [docs/development.md](docs/development.md#local-setup). Never test against systems you do not own, including the project's private test deployment and its hosting and database providers.
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
- **Reviews.** Changes reach `main` only through pull requests, and are reviewed independently where possible. Once the repository is public, branch protection enforces this on `main` ([docs/development.md](docs/development.md#repository-protection)); before that, the rule is followed by convention. Changes that touch a trust boundary are reviewed with the project's security review procedure ([`.claude/skills/refrain-security-review/SKILL.md`](.claude/skills/refrain-security-review/SKILL.md)).
- **Dependencies.** Versions are pinned exactly and the lockfile is committed. pnpm installs only versions published at least seven days earlier, and blocks dependency install scripts unless they are explicitly allowed. Advisories are evaluated with `pnpm audit`.
- **CI** has read-only permissions and no secrets, and its actions are pinned to full commit SHAs. It runs on `pull_request`, never `pull_request_target`, so a pull request from a fork gets no secret and no write token, and its workflows run only after the maintainer approves them.
- **Fixes** are made on a branch, with a regression test where the problem can be tested. Once the repository is public, a confirmed vulnerability gets a GitHub security advisory.
