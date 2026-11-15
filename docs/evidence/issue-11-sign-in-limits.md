# Evidence: client-aware sign-in limits (issue #11)

**Status: on branch `feat/client-aware-sign-in-limit`, a draft pull request stacked on the v3 release candidate. Not merged, not deployed. Inactive until the owner sets one variable on a hosted deployment.** Recorded on 2026-11-15. Deployment gate, item 1 ([Security](../security.md#deployment-gate)); ADR 0004 § 6.

## The problem

Every client shared one bucket of five sign-in attempts a minute, because no request header could be trusted to name the client. That held whatever a client claimed. But on a public site, anyone could keep sign-in throttled and lock the author out. ADR 0004 § 6 accepts this "for local development only". It requires that, before a public deployment, abuse protection "recognize clients through a trustworthy network identity". It names no mechanism, because no deployment target had been chosen.

## The mechanism (proposed for the owner's acceptance as an amendment to ADR 0004 § 6)

- **The identity.** Vercel documents, for `x-forwarded-for`: "we currently overwrite the X-Forwarded-For header and do not forward external IPs. This restriction is in place to prevent IP spoofing." It says nothing similar for `x-real-ip` or `x-vercel-forwarded-for`, so only `x-forwarded-for` is accepted.
- **Opt-in, and only on the platform.** `REFRAIN_TRUSTED_CLIENT_IP_HEADER=x-forwarded-for` is honoured only with `VERCEL=1` **and** `VERCEL_ENV` set to `production` or `preview`, the platform's runtime variables. A pulled `.env.local` carries `VERCEL=1` without either value. Any other value, or the header set anywhere else, is a configuration error, and sign-in answers `503`: there, a client chooses its own headers. Unset (the default everywhere today), every client is the same `unknown` client, the one shared bucket of before.
- **Per client: five attempts a minute.** A client is one IPv4 address, or one IPv6 `/64` (the block one network usually holds, so rotating addresses inside it gains nothing). A missing header, a list of addresses, or anything that is not an address is the `unknown` client, never a fresh bucket. An IPv4 address written as IPv6 is that IPv4 client.
- **Globally: three hundred attempts a minute, for every client together.** Only an attempt that passed its own client's bucket counts here, so one client cannot use up the ceiling. Locking every client out takes sixty clients rotating, by design: a pause in sign-in is less harmful than unbounded guessing (ADR 0004 § 6). Three hundred a minute is about 430,000 guesses a day, hopeless against a password of at least 15 characters. (The first version had thirty a minute, which six clients could fill; the review raised that as Medium.)
- **Where.** `src/modules/identity/sign-in-limits.ts`, called by the authentication handler for `POST /api/auth/sign-in/email` only. It runs after the exact-origin and body-size checks, and before Better Auth. Better Auth's own limiter still runs after it, keyed by the same trusted header (`advanced.ipAddress.ipAddressHeaders`), or by its shared bucket when none is trusted.
- **Storage.** `auth_rate_limits`, beside Better Auth's rows, under keys no address can be (`refrain-client:…`, `refrain-global|…`). Each count is a single `insert … on conflict … returning`, so it is atomic across instances, in fixed windows that refusals never extend. No migration.
- **Failure.** If the counters cannot be read, the attempt is refused (`503 AUTH_UNAVAILABLE`), never allowed.
- **Clean-up.** When the global window restarts, which happens at most once a window while sign-ins arrive, this module deletes its own per-client rows whose window has ended. A client that never returns leaves no row behind.

Sign-out is still never limited.

## Tests

| Layer | File | What it holds |
| --- | --- | --- |
| Unit | `config.test.ts` | Trusted only as exactly `x-forwarded-for` with `VERCEL=1`. Refused off Vercel (five values of `VERCEL`), for five other headers, and for a list. Nothing trusted when unset, even on Vercel |
| Unit | `sign-in-limits.test.ts` | No header trusted: everyone is `unknown`, whatever they claim. IPv4 by address; IPv6 by `/64` (two addresses in one `/64` are one client, the next `/64` another); IPv4-mapped IPv6. Ten malformed values (lists, ports, brackets, names, partial addresses, a counter-key look-alike) are `unknown` |
| Unit | `auth.test.ts` | Counters that cannot be read: `503`, never passed to Better Auth |
| Integration (PostgreSQL) | `sign-in-limits.integration.test.ts` | Exactly the limit per window, refusals don't move the window, a new window after it. **40 simultaneous attempts on 8 connections: exactly 7 of 7 allowed.** Untrusted: one shared bucket whatever the addresses. Trusted: one client's lockout doesn't reach another; one client's refused attempts never use up the global ceiling; many clients reach it, then everyone waits for the window; malformed headers share the `unknown` bucket |
| HTTP (production build) | `sign-in-limits.http.test.ts` | Configured as on the platform: one client `401` ×5 then `429`, another client still `401` (heard); an IPv6 `/64` throttled together, the next `/64` heard. Configured off the platform: `503`, whatever the header says |
| HTTP | `studio.http.test.ts` (unchanged) | With no trusted header, every client is throttled together, whatever `X-Forwarded-For` or `X-Real-IP` claims |

| Check | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | Clean |
| `pnpm test` (after the review's fixes) | 59 files, **1,340 passed** |
| `pnpm test:integration` (database reset first) | 38 files, **812 passed**; after the review's fixes, the identity files again: **76 passed** (PostgreSQL 18 disposable database) |
| `pnpm build` | Succeeded |
| `pnpm test:http` (database reset first) | 21 files, **786 passed**; after the review's fixes, `sign-in-limits.http.test.ts` and `studio.http.test.ts`: **29 passed** |

## Not verified, and the owner's steps

1. **The platform's overwrite, on a real deployment.** The tests simulate the platform (`VERCEL=1` with `next start`). Vercel's documentation is the only evidence that a client-supplied `X-Forwarded-For` is replaced. Before relying on it, on a protected deployment of this change with the variable set:
   - send `X-Forwarded-For: 192.0.2.1` from one machine, six wrong sign-ins; the sixth is `429`;
   - send six more with a *different* forged value from the same machine. If they are refused at once (`429`), the platform replaced the header, as documented. If they get `401`, the forged value was used: **unset the variable**, and the shared bucket returns.
2. **Accept the mechanism** as an amendment to ADR 0004 § 6, or ask for a change (for example other numbers).
3. **Set `REFRAIN_TRUSTED_CLIENT_IP_HEADER=x-forwarded-for`** in Production, with a new deployment. Then repeat step 1 on the canonical domain.

The `#11` items other than this one (the unauthorized `/studio` answer and its indexing, malformed Server Action bodies, cookies over real HTTPS, browser tests over HTTPS) are unchanged by this pull request.

## Independent review

One review, in a separate context, read-only: **GO for the release candidate as an inactive opt-in.** It confirmed:
- this is not an authentication-method change, so the ADR 0012 § 3 hazard is untouched;
- spoofing in every configuration falls back to the `unknown` client: lists, repeated headers, leading zeros, mapped forms, and look-alikes;
- Better Auth groups clients the same way;
- the SQL is parameterised and atomic, and every failure refuses;
- the limits run after the method and path allow-list and the origin and size checks, and sign-out is never limited;
- no test was weakened.

| Finding | What was done |
| --- | --- |
| **Medium:** six clients fill a global ceiling of thirty a minute, and lock the author out | Raised to three hundred a minute: sixty clients rotating. The owner may choose more, or a signed device cookie, after a successful sign-in, that skips the global ceiling but never the per-client bucket. That is a follow-up, not built |
| **Low:** per-client rows accumulate, one per new client | Pruned when the global window restarts; tested |
| **Low:** `VERCEL=1` also arrives in a pulled `.env.local` | `VERCEL_ENV` must be `production` or `preview` as well; tested (four refused values) |
| **Info:** an IPv6 zone (`fe80::1%eth0`) answered `503` | It is the `unknown` client now; tested |
| **Info:** with the header trusted, Better Auth records the author's address in `auth_sessions.ip_address` | To be stated in the privacy notice before the variable is set |
| **Missing tests:** the global ceiling over HTTP, and sign-out while it is reached | Integration covers the ceiling. Over HTTP the suite's servers share one database, so filling the ceiling there would throttle other files' sign-ins; left out on purpose. Sign-out is never routed through the limits (handler test) |
