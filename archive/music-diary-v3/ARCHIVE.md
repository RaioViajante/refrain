# Archive: Refrain music diary v3

**Status: retired from active development on 2026-11-17. Not deleted. Read-only.**

This directory holds the complete Refrain music diary (v3): a single-author journal of memories and album journals, with a private Writing Studio and public pages behind a switch. The repository root now holds a new application, a personal mixtape archive, which shares nothing with this one: no code, no database, no hosting.

## What is preserved, and where

| What | Where |
| --- | --- |
| The exact final tree, at the repository root as it was | tag **`music-diary-v3-final`** → `e467a056a29bf9c1727084a1d9c5811acaeb6c35` (merge of PR #132, CI green) |
| The same commit, as a branch | **`archive/music-diary-v3`** |
| Every tracked file, moved unchanged by `git mv` | this directory, `archive/music-diary-v3/` |
| History | intact: `git log --follow -- archive/music-diary-v3/<path>` reaches each file's earlier commits |

The move changed no file's content. Only `.gitleaksignore` stayed at the repository root, because its fingerprint names a historical commit. `ARCHIVE.md` (this file) is the only file added here. The application's own documentation starts at [README.md](README.md) and [AGENTS.md](AGENTS.md) in this directory. Paths and links in it are relative to this directory, which was the repository root.

## What is not in the repository

None of these was changed by the archive:

- **Hosting.** The Vercel project `refrain`, its environment variables, its deployments, and the domain `refrain.raioviajante.com`. At archiving, Production served `dpl_2BNyqPYT7Xqu8VhTQLbDV31JcEVM`, built from `908957f`, an ancestor of the tagged commit, behind Vercel Authentication, with public reads off. Git deployments are disabled on that project; Production deployments were CLI uploads of a clean checkout.
- **Databases.** The Neon Production and staging databases, and the local development volume of the Compose project `refrain`.
- **Local files.** `.env`, `.env.development.local`, `reference/`, and other ignored files in existing checkouts.

## How to restore it

- **Read or run the exact final state:** check out the tag, `git switch --detach music-diary-v3-final`, or the branch `archive/music-diary-v3`. The application is back at the root with its CI workflow active, and it follows its own [Development](docs/development.md) guide.
- **Run it from this directory:** it is self-contained, with its own lockfile, `pnpm-workspace.yaml`, and configuration. From `archive/music-diary-v3/`, `pnpm install --frozen-lockfile`, then the commands in its `package.json`. Lint, format, types, the unit and integration tests, `drizzle-kit check`, and the production build were run from here on 2026-11-17, before the rebuild PR was opened. Its CI workflow, `.github/workflows/ci.yml` here, does not run from this location: GitHub only runs workflows at the repository root.

**Hazard: never deploy from the repository root to the `refrain` Vercel project.** After the rebuild, the root is a different application. A deployment from it would replace the music diary in that project. Any redeployment of v3 must come from a clean checkout of the tag or the archive branch, and only by the owner's decision.

## Rules that still bind

The archived code and documentation are read-only. Do not edit, reformat, or delete them, or change their history. A fix to the archived application, if the owner ever wants one, goes on a branch from `archive/music-diary-v3`, not into this directory. Its private-writing, security, and licensing rules still apply to this directory and to the repository's history: see [SECURITY.md](SECURITY.md), [LICENSE-ARTWORK.md](LICENSE-ARTWORK.md), and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) here.
