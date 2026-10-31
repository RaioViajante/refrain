# Security and Privacy

**Status:** requirements for implementation. The application foundation (M1.1) implements the baseline: the database client is server-only and its configuration is server-side, logs carry no connection details, and the build needs no database. The remaining controls arrive with the features they protect. The publication rules implement [ADR 0002](decisions/0002-domain-model-decisions.md) and its implementation invariants (INV-1 to INV-5).

Refrain's most valuable asset is the author's writing: personal, unpublished, and irreplaceable. The two failures that matter most are **private writing becoming public** and **writing being lost**. Every control below protects against one of them.

## Trust model

| Actor | Trust | Access |
| --- | --- | --- |
| Author | Authenticated, single account | Full Writing Studio |
| Reader | Anonymous | Publicly visible content only, read-only |
| External providers | Untrusted input | Responses are validated before use |
| Coding agents and contributors | Repository access only | No access to production data or secrets |

## Publication predicate

This section is the **single authoritative definition** of what a reader may see. Every public read uses it: pages, listings, metadata (`<title>`, Open Graph), sitemaps, any future feeds or search, and cache population. It is implemented once, in the Publication module, and is never re-implemented elsewhere.

A **language version** of an entry is publicly visible when:

- `entries.deleted_at IS NULL`, and
- that version's `entry_texts.status = 'published'`.

An **entry** is publicly visible when at least one of its language versions is publicly visible.

A **track reflection** is publicly visible in a language when:

- the parent journal's language version is publicly visible, and
- `track_reflections.is_published` is true (explicit per-track authorization, ADR 0002, D5), and
- a reflection text exists in that language.

A **link to an author's translation**, or any mention that one exists, appears only when that translation is itself publicly visible (ADR 0002, INV-3).

The "still writing" flag plays no part in visibility (INV-2). A published reflection that is still in progress is shown with the "still writing" label; an unpublished one is not shown at all. The same applies to its rating and favourite mark.

Catalog metadata (albums, artists, tracks) is not personal, but public pages show it only in the context of publicly visible entries.

## Access control

- **Single author.** The author account is created by a one-off setup command that reads credentials from the environment, not through a web form. Public sign-up is disabled in the authentication configuration, and a test asserts the sign-up endpoint is unavailable.
- **Authorization at every entry point.** Every studio server action and route handler verifies the session itself. Middleware or proxy redirects are a convenience, not the control.
- **Hiding something in the UI is not authorization.** Only the publication predicate decides public visibility.
- **Preview** renders inside the authenticated studio route and is never served from a cacheable public URL.
- **URLs.** Entries are addressed publicly by slug (ADR 0002, D7). A slug, current or previous, that resolves to an entry that is not publicly visible returns **404**, not 403 and not a redirect, so its existence is not revealed. Previous slugs of a visible entry redirect (308) to the current slug.

## Caching

- Studio responses use `Cache-Control: no-store` and are never statically generated.
- Public pages may be cached or statically generated only from data that satisfies the publication predicate.
- Any change that affects the predicate revalidates the affected public pages and listings: a visibility change, deletion or restore, a change to a track's publication flag, featuring a journal, or a slug change.
- Verify that no private content is rendered at build time.

## Input and output

- Validate all input with Zod at the server boundary: lengths, enums, rating range, locale values, and slug format.
- Rich text is stored as Tiptap JSON and rendered through an allow-listed node and mark schema. Raw HTML from the editor is never rendered.
- Limit request body sizes. Rate-limit sign-in attempts.
- Use the CSRF and cookie protections of the authentication library and of Next.js server actions. Session cookies are `HttpOnly`, `Secure` in production, and `SameSite=Lax` or stricter.
- Image hosts are allow-listed: Cover Art Archive, Wikimedia Commons, and the application's own assets.

## Secrets

- Secrets live only in environment variables. `.env*` files are ignored by Git, except `.env.example`, which holds variable names with non-secret placeholder values for a local, disposable development database. Real or production credentials never appear in it.
- Secrets never reach client bundles. Only intentionally public variables use the framework's public prefix.
- CI uses scoped GitHub secrets and minimal workflow `permissions`.
- If a secret is committed, rotate it first and then remove it from history. Deleting the file is not enough.

## Data protection

- **No cascade from catalog to writing.** Catalog records referenced by writing are archived, never deleted ([Data Model](data-model.md#deletion-and-recovery)).
- **Recoverable deletion.** Deleted entries stay in Recently deleted for at least 30 days. **Automatic permanent deletion stays disabled** until backups exist, a restore has been performed successfully, and the purge job is designed and covered by tests (ADR 0002, D4.4).
- **Optimistic concurrency** on saves, so a stale browser tab cannot silently overwrite newer writing.
- **Unsaved text survives a failed save** on the author's device, as the design requires, and never in a shared or server-side log.
- **Backups.** Before real writing is stored in any hosted database, scheduled `pg_dump` backups must exist, stored outside the database host, and a restore into a scratch database must have been performed. The procedure is recorded in [Development](development.md) once it exists.
- **Export.** A portable export, Markdown with front matter plus the original JSON (ADR 0002, D6), is part of long-term ownership.
- **Migrations** that touch authored tables are reviewed for data loss, include a recovery plan, and are never applied automatically to production.

## Logging

Logs record events and identifiers. They never contain entry titles or bodies, session tokens, passwords, or full request bodies. Error reports scrub the same fields.

## Repository hygiene

- Never commit real journal writing, personal ratings, database dumps, `.env` files, or screenshots that contain private entries.
- Test fixtures and seed data are synthetic and labeled as such (for example `[Test] Album`). Public catalog metadata, such as Grace by Jeff Buckley, may be used, but the author's opinions about it may not be invented.
- The local `reference/` mockups contain only bracketed placeholders, not personal writing. `reference/` is ignored by Git. Local mockups, screenshots, and design experiments are never committed without the author's explicit authorization.

## Required tests

These must exist before the public journal ships (M3):

1. Unauthenticated requests to every studio action and route are rejected.
2. Draft, private, and deleted content returns 404 from every public route. This is checked per language version, including a published original with a private translation: the translation is not served, not linked, and not mentioned (INV-3).
3. Track reflections without `is_published` are absent from public pages, whatever their "still writing" state. Their ratings and favourite marks are absent too (INV-2, INV-3).
4. Visibility changes, deletions, and per-track publication changes take effect on public pages immediately, and revalidation is verified.
5. Previous slugs redirect only for publicly visible entries. Otherwise the response is identical to an unknown slug's 404 (INV-5).
6. Featured resolution returns the same journal for the same data in every interface language, and falls back as defined in ADR 0002, D1.2 (INV-1).
7. The sign-up endpoint is unavailable.
8. Hard-deleting a catalog record that writing references is refused by the database.

## Deployment gate

The application must not be reachable from the public internet until authentication and the tests above are in place. Until then, academic demonstrations run locally.
