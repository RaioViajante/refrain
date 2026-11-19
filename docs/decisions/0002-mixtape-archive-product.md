# 0002. The mixtape archive: language, design, model, media, access, hosting

- **Status:** Accepted by the owner, 2026-11-19.
- **Supersedes:** in [0001](0001-rebuild-foundation.md), the bilingual scope (decided item 1) and the open items on the product model, Studio authentication, EN and PT-BR routing, media, and hosting. Indexing stays open.

## Decisions

1. **Brazilian Portuguese only.** No internationalization, no `/pt` or `/en` routes, no language switcher, no translations. Every page is `lang="pt-BR"`. Original titles of mixtapes and songs may stay in English.
2. **The visual direction is approved:** the owner's Claude Design reference of 2026-11-18 (`refrain-referencia`: public pages, Studio, system sheet, share images; desktop at 1440 px and mobile at 390 px). It is implemented with high fidelity and not redesigned. The reference stays local-only in `reference/` and is never committed; its rules are transcribed in `.claude/skills/refrain-design/`.
3. **The product model** (`src/db/schema.ts`):
   - **mixtapes**: catalogue number, slug, title, theme, description, reflection, pull quote, playlist link, year, cover and detail photographs, a place among the three featured on the home page, and a status, `draft` or `published`;
   - **songs**: title and artist, unique regardless of letter case;
   - **mixtape tracks**: a song's position on a tape and the owner's note for it there;
   - **site texts** and **site images**: the owner's writing and photographs on fixed pages (home, about, footer).

   A mixtape is public only when published, and a photograph only once the owner has confirmed the right to publish it. Both rules live in one server-side module (`src/server/visibility.ts`).
4. **Media:**
   - the identity marks and icons (four drawn stars, the tree engraving, the star mark, favicons, the two cursors) are committed byte for byte to `public/`, all rights reserved, with provenance in [`docs/assets.md`](../assets.md);
   - photographs are never committed. The owner uploads each one in the Studio (Vercel Blob) and confirms the right to publish it; until then it does not appear publicly;
   - the owner's texts live in the database and are edited in the Studio. Interface labels (menus, buttons, states) live in code.
5. **Content import:** the mixtapes, songs, and notes in the reference are the owner's own. A local script, never committed, imports them into the database as drafts; the owner publishes them.
6. **Studio authentication:** one owner, signing in with email and password. The password's hash (scrypt) and the email are server-side environment variables; sessions are random tokens stored hashed in PostgreSQL, sent as `HttpOnly`, `Secure`, `SameSite=Lax` cookies; failed attempts are throttled in the database. Every Studio page, Server Action, and route handler authorizes on the server itself. There is no authentication service, no sign-up, and no email sending.
7. **Hosting:** a new Vercel project and a new Neon database, both separate from the archived music diary (whose project, databases, deployments, environment variables, and domain stay untouched). A protected preview comes first. `refrain.raioviajante.com` moves to the new project only after the owner approves a written cutover procedure; a tested backup precedes it.

## Consequences

- `AGENTS.md`, `CLAUDE.md`, the README, and the `refrain-design` skill are updated to match.
- Drizzle Kit keeps refusing any non-local database. Applying migrations to the hosted database gets its own explicit, owner-approved procedure with the preview.
- Pages stay `noindex` until the owner decides on indexing.
