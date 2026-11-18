# 0001. Rebuild foundation

- **Status:** Accepted by the owner, 2026-11-17 and 2026-11-18.
- **Scope:** what the new application is, what it is built on, and what is still open. No feature is specified here.

## Decided

1. **Refrain is rebuilt as a public, artistic, personal mixtape archive**, with a private, authenticated Studio for its single owner. The public pages are in English and Brazilian Portuguese (`en`, `pt-BR`).
2. **The music diary (v3) is retired, not deleted.** It is preserved as follows:
   - the tag `music-diary-v3-final` and the branch `archive/music-diary-v3`, both at `e467a05`;
   - the directory `archive/music-diary-v3/`, which is read-only.

   It still runs, unchanged, on its own Vercel project and domain until the owner authorizes its replacement.
3. **The stack:** one Next.js (App Router) and TypeScript application with one PostgreSQL database, through Drizzle ORM and Drizzle Kit, managed with pnpm and tested with Vitest. There are no extra services. Versions are pinned in `package.json`.
4. **Until hosting is decided, the database is local only.** It runs in Compose, and the schema tooling refuses any other host and the archive's databases.
5. **The visual direction is developed separately** (Claude Design, from Pinterest references), and is applied only once the owner approves it (`.claude/skills/refrain-design/`).

## Open (each needs the owner's decision before its first use)

- **The product model:** what a mixtape, a track, and their writing are; what is public; and the publication rules.
- **Authentication for the Studio:** the library and the sign-in method. If Better Auth is chosen, the magic-link account-deletion hazard must be handled first: `archive/music-diary-v3/docs/decisions/0012-external-services-music-story-email-media.md` § 3, which is background, not a binding decision for this application.
- **EN and PT-BR routing:** for example, English at the root and Portuguese under `/pt`, as the archive did. This also covers how authored content is written and published per language.
- **Media:** where the original artwork, covers, and audio (if any) are stored and served, under what licence, and from which origins.
- **Hosting and the domain:** a new Vercel project, or a replacement of the archive's; the moment `refrain.raioviajante.com` moves; the database provider; and backups with a tested restore.
- **Indexing:** when, and whether, public pages stop sending `noindex`.

Record each answer as a new numbered file in this directory: its context, the decision, and its consequences.
