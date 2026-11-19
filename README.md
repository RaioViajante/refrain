# Refrain

Refrain is a **public, artistic, personal mixtape archive**, with a private Studio for its owner, in Brazilian Portuguese. It is built with Next.js, TypeScript, Drizzle, and PostgreSQL. The product, design, media, authentication, and hosting are decided in [decision 0002](docs/decisions/0002-mixtape-archive-product.md); it is not hosted yet.

The previous application, the Refrain **music diary (v3)**, is retired, not deleted. It lives in [`archive/music-diary-v3/`](archive/music-diary-v3/), and its final state is the tag `music-diary-v3-final`. See [`archive/music-diary-v3/ARCHIVE.md`](archive/music-diary-v3/ARCHIVE.md).

## Boundaries

| | New application (root) | Archived music diary |
| --- | --- | --- |
| Code | `src/`, root configuration | `archive/music-diary-v3/`, read-only |
| Database | local Compose only (`refrain-mixtapes`: port 5442, and a disposable test database on 5443); a new Neon database is planned | its own Neon databases and local Compose project `refrain`, untouched |
| Hosting | none yet; a new Vercel project is planned | Vercel project `refrain` and `refrain.raioviajante.com`, untouched |
| CI | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | not run; its workflow is kept, inert, in the archive |

The new application never imports from the archive (ESLint refuses it), never shares its database (Drizzle Kit refuses it), and is never deployed to the archived application's Vercel project.

## Local setup

Requires Node.js 24 (`.nvmrc`), pnpm (version in `package.json`), and Docker.

```sh
pnpm install
cp .env.example .env    # then change POSTGRES_PASSWORD and DATABASE_URL to match
pnpm db:up              # local PostgreSQL 17 on 127.0.0.1:5442
pnpm db:migrate         # apply the committed migrations
pnpm studio:hash        # prints STUDIO_PASSWORD_HASH for a password you type
pnpm dev
```

To sign in to the Studio (`/studio`), set `STUDIO_EMAIL` and `STUDIO_PASSWORD_HASH` in `.env`. Without them, sign-in is closed. In development, uploaded photographs are written to `.media/` (git-ignored); in production they go to Vercel Blob (`BLOB_READ_WRITE_TOKEN`).

Use a checkout of this application with its own `.env`. A directory that still holds the music diary's `.env` points `DATABASE_URL` at that application's data; Drizzle Kit refuses it, but the file is still the wrong one.

Checks (CI runs the same): `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:db` (after `pnpm db:test:up`, a disposable in-memory database), `pnpm audit --audit-level=high`, `pnpm db:check`, `pnpm build`.

Design references live in `reference/`, which is local-only and never committed (see `refrain-design`).

## Licence

The source code and documentation are under the [MIT License](LICENSE). It does not cover any artwork, photograph, or text the application displays ([`LICENSE-ARTWORK.md`](LICENSE-ARTWORK.md), [`docs/assets.md`](docs/assets.md)). The archived application's original artwork is all rights reserved, and the design references in the repository's history are not licensed: see [`archive/music-diary-v3/LICENSE-ARTWORK.md`](archive/music-diary-v3/LICENSE-ARTWORK.md). To report a security problem, see [SECURITY.md](SECURITY.md).
