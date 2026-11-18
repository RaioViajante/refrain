# Refrain

Refrain is being rebuilt as a **personal mixtape archive**. The product is not defined yet: the repository root holds only a basic scaffold (Next.js, TypeScript, Drizzle, and PostgreSQL), with no features, no tables, and no hosting.

The previous application, the Refrain **music diary (v3)**, is retired, not deleted. It lives in [`archive/music-diary-v3/`](archive/music-diary-v3/), and its final state is the tag `music-diary-v3-final`. See [`archive/music-diary-v3/ARCHIVE.md`](archive/music-diary-v3/ARCHIVE.md).

## Boundaries

| | New application (root) | Archived music diary |
| --- | --- | --- |
| Code | `src/`, root configuration | `archive/music-diary-v3/`, read-only |
| Database | local Compose only (`refrain-mixtapes`, port 5442); no hosted database | its own Neon databases and local Compose project `refrain`, untouched |
| Hosting | none; not linked to any Vercel project | Vercel project `refrain` and its domain, untouched |
| CI | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | not run; its workflow is kept, inert, in the archive |

The new application never imports from the archive, never shares its database, and is never deployed to the archived application's Vercel project.

## Local setup

Requires Node.js 24 (`.nvmrc`), pnpm (version in `package.json`), and Docker.

```sh
pnpm install
cp .env.example .env    # then change POSTGRES_PASSWORD and DATABASE_URL to match
pnpm db:up              # local PostgreSQL 17 on 127.0.0.1:5442
pnpm dev
```

Checks: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm db:check`, `pnpm build`. Drizzle Kit (`pnpm db:generate`, `pnpm db:migrate`) refuses any `DATABASE_URL` whose host is not this machine.

## Licence

The source code and documentation are under the [MIT License](LICENSE). The archived application's original artwork is all rights reserved, and the design references in the repository's history are not licensed: see [`archive/music-diary-v3/LICENSE-ARTWORK.md`](archive/music-diary-v3/LICENSE-ARTWORK.md). To report a security problem, see [SECURITY.md](SECURITY.md).
