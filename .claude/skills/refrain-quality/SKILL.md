---
name: refrain-quality
description: Refrain's verification, security-review, and deployment-readiness checklist. Use it before opening or approving a pull request, when reviewing a change that touches the Studio, authentication, public pages, Server Actions, route handlers, uploads, environment variables, dependencies, or CI, and before any discussion of deploying.
argument-hint: "[PR, branch, or area]"
---

# Refrain quality check

**Target:** $ARGUMENTS

## 1. Checks (run them, then report the actual output)

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm audit --audit-level=high
DATABASE_URL=postgres://unused:unused@127.0.0.1:5432/unused pnpm db:check
pnpm build
```

Then read the whole diff yourself. If a check cannot run, say so; never report it as passing.

## 2. Tests the change needs

- **Unit tests** for each domain rule and each validation.
- **Integration tests against real PostgreSQL** (a disposable database) for constraints, transactions, and queries. Never mock the database to prove them.
- **Privacy tests** for each visibility rule. Include negative cases: a draft or private record never appears on a public page, in metadata, in the sitemap, in an Open Graph image, or in a cached response.
- **Browser tests** (Playwright, added with the first UI flow) for critical flows at desktop width and at 390px, including keyboard use.

## 3. Security review

Assume the attacker has read all the code.

- **The Studio:** every Server Action and route handler authenticates and authorizes on the server, itself, before doing anything. Middleware or `proxy.ts` alone is not enough, and neither are hidden links or client checks.
- **Input:** validated with a schema at every server boundary (form data, params, search params, uploads), with length limits.
- **Public reads:** one server-side visibility predicate. Check every new public surface against it: pages, metadata, sitemap, feeds, images, and caches.
- **Secrets:** only server code reads secrets. Nothing secret is prefixed `NEXT_PUBLIC_`. Secrets never appear in logs or error messages, and no `.env` file is committed.
- **Rich text and uploads:** sanitized output, with type and size checked on the server. Uploaded files are never served from a path the user controls.
- **Headers:** the baseline in `next.config.ts` stays. A new external origin (images, fonts, embeds) needs an explicit CSP change.
- **Dependencies:** pinned exactly, with a reason; the lockfile committed; `pnpm audit` reviewed.
- **Authentication changes:** if Better Auth is chosen, read the magic-link hazard first. Its verification can delete an unverified user's account (see `archive/music-diary-v3/docs/decisions/0012-external-services-music-story-email-media.md` § 3, as background only).

Report each finding with its file and line, a concrete failure scenario, a severity, and the missing test.

## 4. Deployment readiness (nothing deploys without the owner's authorization)

- Hosting, the database provider, and backups are recorded as decisions (`docs/decisions/`) before anything is set up.
- **Never deploy the repository root to the archived music diary's Vercel project (`refrain`).** It still serves `refrain.raioviajante.com`. Moving the domain is a separate, explicit owner decision.
- Before the first hosted deployment:
  - authentication and authorization tests exist and pass;
  - privacy tests exist and pass;
  - environment variables are set per environment;
  - a backup has been taken and its restore tested;
  - the indexing policy has been decided.
