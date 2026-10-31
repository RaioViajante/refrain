# Security and Privacy

**Status:** requirements for implementation. No controls exist yet, because no application exists.

Refrain's most valuable asset is the author's writing: personal, unpublished, and irreplaceable. The two failures that matter most are **private writing becoming public** and **writing being lost**. Every control below protects against one of them.

## Trust model

| Actor | Trust | Access |
| --- | --- | --- |
| Author | Authenticated, single account | Full Writing Studio |
| Reader | Anonymous | Published entries only, read-only |
| External providers | Untrusted input | Their responses are validated before use |
| Coding agents and contributors | Repository access only | No access to production data or secrets |

## Access control

- **Single author.** The author account is created by a one-off setup command that reads credentials from the environment, not through a web form. Public sign-up is disabled in the authentication configuration, and a test asserts that the sign-up endpoint is unavailable.
- **Authorization at every entry point.** Every studio server action and route handler verifies the session itself. Middleware or proxy redirects are a convenience, not the control.
- **Public reads go through Publication.** Public pages, metadata (`<title>`, Open Graph), sitemaps, any future feeds, and search use the published-only query path (`status = 'published' AND deleted_at IS NULL`). Hiding something in the UI is not authorization.
- **Preview** renders inside the authenticated studio route and is never served from a cacheable public URL.
- **Identifiers.** Entries use UUIDs. Public URLs use slugs that resolve only for published entries; any other entry returns 404, not 403, so its existence is not revealed.

## Caching

- Studio responses: `Cache-Control: no-store`. They are never statically generated.
- Public pages may be cached or statically generated only from published data. Any visibility change, deletion, or edit to a published entry revalidates the affected public pages.
- Verify that no private entry is rendered at build time.

## Input and output

- Validate all input with Zod at the server boundary: lengths, enums, rating range, and locale values.
- Rich text is stored as structured JSON and rendered through an allow-listed node and mark schema. Raw HTML from the editor is never rendered.
- Limit request body sizes. Rate-limit sign-in attempts.
- Use the CSRF and cookie protections of the authentication library and of Next.js server actions. Session cookies are `HttpOnly`, `Secure` in production, and `SameSite=Lax` or stricter.
- Image hosts are allow-listed: Cover Art Archive and Wikimedia Commons, plus the application's own assets.

## Secrets

- Secrets live only in environment variables. `.env*` files are ignored by Git, except `.env.example`, which lists variable names without values.
- Secrets never reach client bundles. Only intentionally public variables use the framework's public prefix.
- CI uses scoped GitHub secrets with minimal workflow `permissions`.
- If a secret is committed, rotate it first and then remove it from history. Deleting the file is not enough.

## Data protection

- **No cascade from catalog to writing**, and recoverable deletion for entries ([Data Model](data-model.md#deletion-and-recovery)).
- **Optimistic concurrency** on saves, so a stale tab cannot silently overwrite newer writing.
- **Unsaved text survives a failed save** on the device (per the design), and never in a shared or server-side log.
- **Backups:** before real writing is stored in any hosted database, there must be scheduled `pg_dump` backups kept outside the database host, and a restore performed at least once into a scratch database. Record the procedure in [Development](development.md) when it exists.
- **Export:** a complete export of the author's writing (planned after the academic milestone) is part of long-term ownership.
- **Migrations** that touch authored tables are reviewed for data loss, include a recovery plan, and are never applied automatically to production.

## Logging

Logs record events and identifiers, never entry titles or bodies, session tokens, passwords, or full request bodies. Error reports scrub the same fields.

## Repository hygiene

- Never commit real journal writing, personal ratings, database dumps, `.env` files, or screenshots containing private entries.
- Test fixtures and seed data are synthetic and labeled as such (for example `[Test] Album`). Public catalog metadata such as Grace by Jeff Buckley may be used; the author's opinions about it may not be invented.
- The `reference/` mockups contain only bracketed placeholders, not personal writing.

## Required tests

These must exist before the public journal ships (M3):

1. Unauthenticated requests to every studio action and route are rejected.
2. Draft, private, and deleted entries return 404 from every public route, and are absent from public listings, metadata, and the sitemap.
3. Publishing and unpublishing change public visibility immediately, and revalidation is verified.
4. The sign-up endpoint is unavailable.
5. Deleting a catalog record that writing references is refused by the database.

## Deployment gate

The application must not be reachable from the public internet until authentication and the tests above are in place. Before then, academic demonstrations run locally.
