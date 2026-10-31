# ADR 0004: Single-Author Identity and Access

- **Status:** Proposed (M1.3A, issue #9). It becomes Accepted when the author approves the pull request.
- **Date:** 2026-10-31
- **Scope:** Authentication, sessions, the provisioning of the single author account, and the authorization boundary of the Writing Studio. It implements the access-control requirements of [Security](../security.md#access-control) with the planned authentication library, Better Auth ([Architecture](../architecture.md#target-technologies)).

## Context

Refrain has exactly one author and no reader accounts ([Product](../product.md)). The repository will become public, so authentication must hold against someone who has read all of it ([Security § Public code, private writing](../security.md#public-code-private-writing)). The owner's brief for M1.3A adds these requirements:

- public registration is disabled at all times, including while the first account is created;
- the account is created by an explicit local procedure, never by a public route or at startup;
- the password never appears in shell history or in process arguments;
- authorization is centralized, server-side, and fails closed.

Better Auth 1.7.12 is the newest stable release that the repository's seven-day `minimumReleaseAge` allows. Its peer ranges include the installed Next.js 16, React 19, Drizzle ORM 0.45, Drizzle Kit 0.31, and pg 8. Reading its installed source showed six behaviors that the configuration has to account for:

1. **Origin checks depend on the environment.** It skips its origin and CSRF checks when `NODE_ENV` is `test` unless `advanced.disableOriginCheck` is set (`context/create-context.mjs`). The tests would then pass against weaker behavior than production.
2. **Environment variables are read implicitly.** It reads `BETTER_AUTH_TRUSTED_ORIGINS`, `BETTER_AUTH_SECRETS`, and `BETTER_AUTH_TELEMETRY` from the environment, in addition to any explicit options. The first widens the trusted origins, the second replaces the secret, and the third enables telemetry.
3. **Rate-limit buckets trust a client-supplied header.** It keys rate limits by a client IP taken from `X-Forwarded-For` whenever the header holds a single valid address, and no proxy is configured. A client that changes the header on every request gets a fresh bucket each time. A test confirmed the bypass.
4. **Errors are logged with their messages.** It logs whole error objects. A failed Drizzle query's message contains its parameters, which for authentication queries are session tokens and password hashes. A test reproduced a session token in the log.
5. **Sign-up has three switches.** `emailAndPassword.disableSignUp` refuses sign-up both over HTTP and in server-side calls (`api.signUpEmail`). `disabledPaths` removes the route.
6. **No documented server-side path creates a user without sign-up.** The only documented path, `auth.api.createUser`, belongs to the Admin plugin. The plugin adds roles, bans, impersonation endpoints, and columns.

## Decision

### 1. Library and sessions

- **Library and method.** Better Auth **1.7.12**, pinned exactly, with email and password only. There are no plugins, no social providers, and no account linking. Telemetry is off.
- **Database sessions.** Sessions are rows in PostgreSQL, and the cookie carries an HMAC-signed session token. The cookie cache is disabled, so every check reads the session from the database, and a revoked session stops working at once.
- **Fixed lifetime.** A session lasts **seven days** from sign-in. Checking a session never extends it (`disableSessionRefresh`, and `disableRefresh` on every check). A check writes to the database only when it finds an expired session: Better Auth then deletes that row.
- **Cookies.**
  - The session cookie is `refrain.session_token`: `HttpOnly`, `SameSite=Strict`, and `Path=/`.
  - It is `Secure`, with the `__Secure-` prefix, whenever the base URL is HTTPS, which the configuration requires for anything but a loopback host.

### 2. Tables

- **Five tables.** Better Auth's core tables, plus database-backed rate limiting, form migration `0004_identity_authentication`: `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`, and `auth_rate_limits`.
- **Conventions.** They follow [ADR 0003](0003-relational-schema-conventions.md): explicit snake_case names, `uuid` keys, `timestamptz` columns, and named constraints. The Drizzle property names are Better Auth's field names, and a unit test runs Better Auth's own schema check against them.
- **Three database rules** that the library does not need but Refrain does:
  - `auth_users_single_author_idx`, a unique index over a constant, admits **at most one account**, whatever path tries to create a second;
  - `auth_users_email_lowercase_check`;
  - `auth_accounts_credential_only_check` allows only `provider_id = 'credential'` with a password, so no social or linked account can be stored.
- **Separation from the writing.** The only foreign keys are from sessions and accounts to `auth_users`, `ON DELETE CASCADE`. No domain table references an identity table, and no identity table references a domain table.

### 3. Provisioning outside HTTP

- **Commands.** The single account is created by `pnpm author:provision --target=<host>:<port>/<database>`. The password is reset by `pnpm author:reset-password` with the same option. Both run `src/modules/identity/cli.ts` locally and are never reachable over HTTP.
- **Explicit target.** The target must equal the effective target of `DATABASE_URL`, as node-postgres resolves it. Query parameters are refused, as in the test-database checks.
- **Password input.** The password is read from the terminal without echo, twice, or from standard input when that is not a terminal. Arguments and environment variables are never accepted.
- **Output.** Nothing secret is printed.
- **Configured identity.** The account's email is `REFRAIN_AUTHOR_EMAIL`.
- **One transaction.** Provisioning runs in one transaction that locks the identity tables. It refuses, and changes nothing, if any user, account, session, or verification row exists, so running it again never overwrites a password.
- **How the account is written.** It uses Better Auth's own password hasher and internal adapter, bound to that transaction:
  - `context.password.hash`, `internalAdapter.createUser`, and `internalAdapter.linkAccount`, which are the calls Better Auth's sign-up endpoint makes;
  - `context` is `auth.$context`, which is declared on Better Auth's typed `Auth` interface, and Better Auth's own test utilities create users the same way.
- **Password reset.** Reset updates the hash with `internalAdapter.updatePassword` and deletes every session in the same transaction.

**Risk:** `$context`, `linkAccount`, and `updatePassword` are typed but are not described in the documentation pages read on 2026-10-31. An upgrade could change them. The mitigations are:
- the exact version pin;
- an integration test that signs in, through the real handler, with an account created by `provisionAuthor`;
- the schema-check unit test;
- the HTTP test, which provisions through the real command.

An upgrade that changes the account format fails these tests.

### 4. Authorization

- **One boundary.** `src/modules/identity/authorization.ts` is the only authorization boundary.
- **Checks.** `authorizeAuthor(headers)` verifies two things:
  - a valid, unexpired database session for the signed cookie;
  - that the session's account email equals `REFRAIN_AUTHOR_EMAIL`.
- **Results.**
  - It returns `unauthenticated` or `not_author`.
  - It returns `unavailable` when the configuration or the database fails. That also denies access.
- **For mutations.** `requireAuthor(headers)` throws instead, and returns an `AuthorizedAuthor` value that only this module can create.
- **What it trusts.** Nothing the client sends other than the signed session cookie is used: no user ID, email, or role header.
- **Not controls.** A layout, a proxy, or the presence of a cookie never authorizes anything.

[Security § Authorization contract](../security.md#authorization-contract) states the rules every future administrative action follows.

### 5. The HTTP boundary

- **Allow-list.** `src/app/api/auth/[...all]/route.ts` hands requests to `handleAuthRequest`, which passes exactly three endpoints to Better Auth:
  - `POST /api/auth/sign-in/email`;
  - `POST /api/auth/sign-out`;
  - `GET /api/auth/get-session`.

  Every other path, method, or spelling gets the same bare 404 as an unknown URL: sign-up, password reset, user updates, session listing, and account linking.
- **Every POST** must carry `Origin` equal to the configured base URL. Bodies over 4 KiB are refused (413).
- **Every response** is `Cache-Control: no-store`.
- **Library settings.**
  - `disableSignUp` and `disabledPaths: ["/sign-up/email"]` keep sign-up refused even if the handler were bypassed.
  - The origin and CSRF checks are set on explicitly, so they apply in every environment.
- **Pages.** Studio pages and the auth endpoints are sent with `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, and `no-referrer`.

### 6. Rate limiting

- **Storage.** Counters are kept in PostgreSQL (`auth_rate_limits`), so they survive restarts and hold across instances.
- **Limits.** Sign-in allows **5 attempts per 60 seconds**. Sign-out is never limited.
- **One bucket for everyone.** No client-IP header is trusted yet (`ipAddressHeaders: []`), so all clients share one bucket per path. The limit then holds whatever a client claims to be.
- **Cost:** a stranger can keep the sign-in form throttled, so the author cannot sign in while they continue. Locking the author out is less harmful than letting someone guess the password. The trade-off is revisited when a deployment puts a known proxy in front of the application, which can then name the client.

### 7. Configuration and logging

- **Required variables.** `BETTER_AUTH_SECRET` (at least 32 characters of random data), `BETTER_AUTH_URL` (an origin, HTTPS unless loopback), and `REFRAIN_AUTHOR_EMAIL` are required. There are no defaults.
- **Refused variables.** The three implicit variables in the context are refused.
- **When it is read.** Configuration is validated when the first authentication request or studio check runs, so `next build` needs no secret. A failure answers 503, or denies access, without details.
- **Logging.** Everything Better Auth logs passes through a redacting logger. It writes only the first line of each message up to its first colon, error names, statuses, and codes. Better Auth and Drizzle put values after a colon (query parameters, a client's origin), so they are not written. This depends on the library's message format, which is re-checked on upgrade.

### 8. Recovery and rotation

- **Forgotten or exposed password.** The owner runs `pnpm author:reset-password` with direct database access. It replaces the hash and signs out every session. There is no email reset and no recovery over HTTP.
- **Exposed secret.** Replacing `BETTER_AUTH_SECRET` invalidates every session cookie at once.
- **Changing the email.** Update `REFRAIN_AUTHOR_EMAIL` and the `auth_users.email` row together, in one reviewed operation. No command exists for it yet.

## Alternatives considered

- **Enable sign-up temporarily, or in a separate process-local instance.** Rejected. The brief forbids enabling registration at any point, and a second configuration with sign-up enabled could end up mounted by mistake.
- **The Admin plugin's `createUser`.** Rejected. It adds roles, bans, impersonation, and extra endpoints and columns: a role framework that one account does not need.
- **SQL inserts written by hand.** Rejected. They would bypass Better Auth's hasher and field mapping, and be harder to keep correct across upgrades.
- **Authorizing by user ID in the environment.** Rejected. It needs a second step after provisioning. The email is known before provisioning, and the single-row index already prevents a second account.
- **Session refresh (sliding sessions).** Rejected for now. A fixed lifetime is simpler to reason about, and checks never extend a session.
- **Per-IP rate limits from `X-Forwarded-For`.** Rejected while no proxy is trusted, because a client can spoof the header.

## Consequences

**Positive**

- Sign-up cannot be reached by route, by library endpoint, or by server call. A second account cannot be stored at all.
- The account exists only after someone with database access runs a local command on purpose.
- Every studio check is a database lookup that ends with the session, and nothing the client claims can widen it.
- The session token reaches the browser only in the `HttpOnly` cookie: the handler removes it from the JSON of sign-in and get-session, where Better Auth would return it to scripts.
- Authentication state is never cached, framed, or logged with secrets.

**Negative**

- Provisioning relies on typed but undocumented Better Auth internals (§3), guarded by tests.
- A stranger can throttle sign-in for everyone (§6).
- The streaming studio page answers an unauthenticated request with HTTP 200, a static shell, and a streamed redirect to sign-in, not a 307. No studio content is sent, and the HTTP tests assert that. A future proxy redirect could add a 307 as a convenience, never as the control.
- There is no second factor. A stolen session cookie works for at most seven days, or until sign-out or a password reset.

## Revisit when

- the deployment target is chosen, especially if a reverse proxy can name the client for rate limiting (§6);
- Better Auth is upgraded (re-run the full test suite, re-read §3, and re-check the log messages reachable through the allowed endpoints, §7);
- the author wants a second factor (passkey or TOTP), which would be a new ADR.
