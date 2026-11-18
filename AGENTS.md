# AGENTS.md

Instructions for anyone, human or agent, changing this repository. Tool-specific files such as [`CLAUDE.md`](CLAUDE.md) add to these and never override them.

## 1. State

- **The root is a new application:** a personal mixtape archive, on Next.js, TypeScript, Drizzle, and PostgreSQL. **Its product is not defined yet.** Do not design tables, screens, or features until the owner defines it and authorizes the work.
- **The music diary (v3) is archived** in [`archive/music-diary-v3/`](archive/music-diary-v3/ARCHIVE.md), with its final state at the tag `music-diary-v3-final` and the branch `archive/music-diary-v3`. Its own `AGENTS.md` applies only to work on that branch.

## 2. The archive boundary

- `archive/` is read-only. Do not edit, move, reformat, or delete it, and do not rewrite its history.
- The new application never imports, loads, or links code from `archive/`. Root tooling (TypeScript, ESLint, Prettier) excludes it.
- Never deploy from the repository root to the archived application's Vercel project, and never touch its databases, environment variables, deployments, or domain.

## 3. Database and hosting

- The new application has **no hosted database and no hosting.** It uses only the local Compose database (`compose.yaml`, project `refrain-mixtapes`). Drizzle Kit refuses non-local hosts ([`src/db/env.ts`](src/db/env.ts)).
- Choosing hosting or a hosted database is an owner decision, recorded before it is set up.
- Migrations are generated, read, and committed (`pnpm db:generate`); never `drizzle-kit push`, and never applied automatically to a hosted database.
- Declare integrity in PostgreSQL (keys, `NOT NULL`, `UNIQUE`, `CHECK`), not only in TypeScript.

## 4. Privacy and security

- The repository is public. Security never depends on the code being secret.
- Never commit secrets, `.env` files, database dumps, or real personal writing.
- Never fabricate the owner's words, memories, ratings, dates, or biographical claims. Use synthetic fixtures labelled as tests (`[Test] …`).
- Report vulnerabilities privately ([SECURITY.md](SECURITY.md)).

## 5. Engineering

- TypeScript strict. Validate input at every server boundary. Keep business rules in server-only modules.
- Use pnpm with the committed lockfile. Add a dependency only when a task needs it, at a version you have verified.
- Repository text is in English. Conventional Commits, one concern per commit, a focused branch per change; never commit directly to `main`, and never merge your own work automatically.
- Destructive operations (deleting files or branches, rewriting history, dropping data) need the owner's explicit approval.
- Never report a check as passing unless you ran it and saw the output.

## 6. Handoff

End each session with: **State** (branch, last commit, PR, working tree), **Done**, **Verified** (commands and actual results), **Not verified / risks**, and **Next**.
