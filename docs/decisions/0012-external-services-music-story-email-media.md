# ADR 0012: External Services — Music Story, Transactional Email, and Media Storage

- **Status:** **Proposed.** Not accepted. Until the owner accepts it, MusicBrainz, the Cover Art Archive, and Wikimedia Commons remain the only integrations, sign-in stays email and password, and no media is stored.
- **Date:** 2026-11-15
- **Scope:** The music-data provider, the email service that magic-link sign-in needs, and where photographs are stored and how they are served. It supports [ADR 0011](0011-refrain-v3-identity-and-product.md). [`AGENTS.md` § 3](../../AGENTS.md#3-architecture-constraints) requires an ADR for any new external service.

## Context

### Music Story

The approved v3 design builds the Studio around **Music Story**. Its intended architecture is a chain:

```text
Music Story → Refrain server → PostgreSQL → public site / Studio
```

The owner prefers it as the **single provider** of musical metadata and artwork, instead of a chain of separate APIs (MusicBrainz, the Cover Art Archive, Wikimedia Commons). **The owner created a Music Story account on or before 2026-11-15. API token access and commercial artwork licensing are not verified.**

The public documentation was read on 2026-11-15: [API reference](https://doc.music-story.com/api/reference) and [offer](https://music-story.com/en/our-offer). It describes:

- **Access:**
  - base URL `https://api.v2.music-story.com`;
  - a Bearer token created in the Metadata Monitor.
- **Endpoints:**
  - album search and details;
  - `/coverart`, with `path`, `path_400`, `copyright`, and `source`;
  - `/releases`, then `/release/{id}/tracks`, with disc, track number, and the recording.
- **Recordings:** duration (`HH:MM:SS`), ISRC.
- **Releases:**
  - format `ALBUM`, `EP`, `SINGLE` …;
  - type `ORIGINAL`, `LIVE`, `COMPILATION` …;
  - label and barcode.
- **External identifiers:** MusicBrainz, Spotify, Deezer, Apple, Discogs, and others.
- **Artist pictures:** each carries `credit_line`, `license_model`, and `allowed_use`.
- **Usage:**
  - `/user/api/status`;
  - a picture change log.
- **Trial:** 15 days, "limited to 200 calls per day", and `429` beyond that.
- **Rights:** the offer states "Editorial use only by default". Licensed content such as cover art and artist images is "cleared for use inside your app or service" under an agreement built "around your actual use case". **It publishes no terms for caching, rehosting, or attribution.**

### Email and media

- **Email.** The reference specifies magic-link sign-in. The application has no email provider ([ADR 0004](0004-single-author-identity.md)).
- **Media.** The reference shows a photograph on every memory and the author's own artist photographs. The application stores no images. Covers are stored only as a provider URL.

## Decision

### 1. Music Story is the preferred provider, behind a licensing gate

1. **The adapter.** It lives in `src/integrations/music-story/` and follows the rules of the existing adapters:
   - server only;
   - called only for an authenticated author;
   - bounded in time and size;
   - every response validated with Zod;
   - never inside a database transaction;
   - its failure never blocks catalog edits or writing.
2. **Only search words and identifiers are sent.** The author's writing, ratings, memories, and notes are **never** sent to Music Story. No lyrics are requested or stored, even though the API offers them.
3. **The token is an environment variable** (server only, a Vercel sensitive variable when hosted). Settings shows:
   - "configured" or "not configured";
   - the day's usage, from the response headers and our own counter;
   - a single counted "Test the connection".
   
   The token is never sent to the browser, logged, or stored in the database.
4. **Rate limits and caching:**
   - the catalog rows the author imports are the lasting cache;
   - search results are cached briefly, per the terms;
   - usage is counted in our own table, so the daily quota is visible before a `429`;
   - a `429` or an outage stops search only, and writing continues (the reference's States screen).
5. **Mapping existing records, with no duplicates and no lost links:**
   - Nullable unique columns are added for the Music Story identifiers of albums, releases, recordings, and artists, through `/refrain-db-change`.
   - **MusicBrainz identifiers are kept, never deleted.**
   - Linking an existing album is a review the author approves. The match comes from Music Story's MusicBrainz externals, otherwise from search.
   - Linking fills **identifiers only**. Any change to a shown catalog field (a title, a year, a credit) follows the rules for catalog wording on public pages (gate G8).
   - A unique index and the review (which shows any album that already carries the same identifier) prevent duplicate albums.
   - Journals keep pointing at the same album rows.
6. **Artwork and photographs.**
   - **Displaying Music Story artwork or artist pictures on any hosted page needs a written licence** that covers display, caching or rehosting, and attribution, recorded like Deployment gate items 6 and 7.
   - Until then, Music Story images may appear only in local development.
   - The image hosts join `img-src` only in the change that uses them.
7. **Evaluation now, in parallel** ([Roadmap, MS track](../roadmap.md#music-story-evaluation-ms-track)):
   - verify API access with the owner's account;
   - request the licensing terms;
   - then build the adapter against sanitized responses captured during the trial, if the terms allow.
   
   **If licensing that covers the product is unavailable, the work stops for the owner's decision** (ADR 0011, D16 and D22). The provider is never changed silently.
8. **Until Music Story is licensed and built,** MusicBrainz and the Cover Art Archive stay the live providers, and the Studio's states work the same way.

### 2. Transactional email for magic links

1. **A provider is chosen by the owner** (ADR 0011, D15). Its secret is an environment variable, and its sending domain gets SPF and DKIM records. That is a hosted DNS change that needs the owner's authorization.
2. **Mail goes only to `REFRAIN_AUTHOR_EMAIL`.** A request for any other address gets the identical response and sends nothing.
3. **A daily cap** limits sends, independent of the shared sign-in rate limit.
4. **Development** uses a local sink that never writes a token to a log outside development.
5. **Mandatory blocker.** No authentication change is made before the hazard below is fixed and tested.

### 3. The Better Auth magic-link account-deletion hazard: a mandatory blocker

Verified on 2026-11-15 in the installed Better Auth 1.7.12:

- The magic-link verify step calls `revokeUnprovenAccountAccess` for any user whose `emailVerified` is false (`node_modules/better-auth/dist/plugins/magic-link/index.mjs`).
- That function **deletes every account and every session of the user**, then sets `emailVerified` to true (`dist/db/revoke-unproven-account-access.mjs`).
- `pnpm author:provision` creates the author with `emailVerified: false` (`src/modules/identity/provisioning.ts`).

**Enabling the plugin as it is would delete the author's password account on the first magic-link sign-in.** The CLI password reset would then have no account to update.

The plugin's defaults are also unsafe for Refrain:

| Default | Required value |
| --- | --- |
| Tokens stored in plain text (`storeToken: "plain"`) | `"hashed"` |
| A 300-second lifetime | 900 seconds |
| Sign-up enabled (`disableSignUp` defaults to false) | `true` |
| Verification by a `GET` with the token in the query string | See requirement 3 below |

Before any authentication change merges, all of these hold, each with a test against real PostgreSQL:

1. **The `emailVerified` fix.** Provisioning creates the author verified, and a reviewed data fix updates the existing author row on every database that has one. The fix is applied to a hosted database only with the owner's authorization.
2. **The plugin configuration:** `disableSignUp: true`, `storeToken: "hashed"`, `expiresIn: 900`. Single use is kept.
3. **No GET verification.** The email links to a page on Refrain's own origin, and its button `POST`s the token. This is needed because:
   - the `SameSite=Strict` session cookie does not survive a cross-site `GET`;
   - link scanners would consume a single-use token;
   - the token must not appear in request logs.
   
   The authentication allow-list gains only the send endpoint and the `POST` verify.
4. **A recovery path stays:** password sign-in, or a CLI that prints a one-time link.
5. **Tests prove four things:**
   - the author's credential account and sessions survive a magic-link sign-in;
   - an unknown email sends nothing and receives the identical response;
   - a token works once and expires after 15 minutes;
   - sign-up is impossible.

This blocker is also stated in [ADR 0004's proposed amendment](0004-single-author-identity.md#proposed-amendment-adr-0011-magic-link-sign-in) and in [`AGENTS.md` § 5](../../AGENTS.md#5-privacy-and-security).

### 4. Media is stored in PostgreSQL and served through the predicate

1. **Storage.** A `media_assets` table holds the image bytes, a SHA-256, the type, the dimensions, and the size. It records the provenance:
   - source URL;
   - author;
   - licence and licence URL;
   - whether it is the author's own photograph or an atmosphere image;
   - alt text per language.
   
   Foreign keys to it are `RESTRICT`. A row is removed only by "Delete now". **Media therefore lives inside the ADR 0007 backups**, and no new service is added.
2. **Processing.** `sharp` becomes a direct dependency, with its version recorded when it is added:
   - rotate by EXIF, then remove EXIF and GPS data;
   - limit the input pixels;
   - re-encode at about 1,600 px on the long edge and under about 1 MB.
   
   The public copy of a memory or artist photograph is a grayscale derivative. The colour original stays private.
3. **Upload** goes through an authorized route handler. Server Actions accept 1 MB by default, and the host caps a request at 4.5 MB.
4. **Serving:**
   - **Public:** a route that answers an image only while a served page uses it, and otherwise the identical `404`. It is `no-store` and behind `REFRAIN_PUBLIC_READS_ENABLED`.
   - **Studio:** a separate route that requires the author.
5. **Atmosphere images.** Stock or freely licensed images are credited and are **never presented as the author's own photographs**. No memory text is ever generated to accompany an image.

## Alternatives considered

- **Keep MusicBrainz and the Cover Art Archive permanently.**
  - Possible, and they remain the fallback.
  - The owner prefers one licensed provider for coherent metadata and artwork rights.
- **Vercel Blob for media.**
  - A new service.
  - Private blobs would still need a route that checks the predicate.
  - Blob contents sit outside the ADR 0007 `pg_dump` backups, which would leave G6 uncovered.
- **A token field in Settings.**
  - Rejected: it would put a secret in the database, against Security § Secrets.

## Consequences

**Positive**
- One provider for metadata and artwork, once licensed.
- Photographs are inside the existing backups and the existing privacy model.
- The authentication change has a clear, tested path that keeps the author's account.

**Negative**
- Real artwork on the hosted site depends on a licence that may cost money or be refused.
- PostgreSQL storage grows with photographs; the hosted plan's limit is to be checked.
- One more provider to operate (email), and DNS changes.

## Revisit when

- Music Story's terms are known.
- Media volume outgrows PostgreSQL.
- Better Auth changes the magic-link plugin's behaviour.
