import { createHmac, randomBytes } from "node:crypto";

import type { Client } from "pg";

// Session cookies for HTTP tests, minted without signing in. Sign-in is rate
// limited for all clients together and the authentication tests count their
// attempts exactly, so these tests must not use it. A session is a row in
// `auth_sessions`, and its cookie carries the token with an HMAC-SHA256
// signature under BETTER_AUTH_SECRET (Better Auth's cookie scheme, ADR 0004).
// The test that renders the studio with a minted cookie proves the production
// server accepts it. Test database only: callers pass a verified client.

export const SESSION_COOKIE = "refrain.session_token";

function sign(token: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return encodeURIComponent(`${token}.${signature}`);
}

export interface MintedSession {
  /** `name=value`, as a browser sends it. */
  cookie: string;
  token: string;
}

/** Inserts a session for the single author and returns its cookie. */
export async function mintAuthorSession(
  client: Client,
  secret: string,
  expiresInSeconds = 3600,
): Promise<MintedSession> {
  const user = await client.query<{ id: string }>(
    "select id from auth_users limit 1",
  );
  const userId = user.rows[0]?.id;
  if (!userId) {
    throw new Error("The test author does not exist.");
  }
  const token = randomBytes(24).toString("base64url");
  await client.query(
    `insert into auth_sessions (token, user_id, expires_at, user_agent)
     values ($1, $2, now() + make_interval(secs => $3), 'refrain-http-tests')`,
    [token, userId, expiresInSeconds],
  );
  return { cookie: `${SESSION_COOKIE}=${sign(token, secret)}`, token };
}

/** A cookie whose token is real but whose signature is not. */
export function tamperedCookie(session: MintedSession): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(`${session.token}.${Buffer.from("not the signature").toString("base64")}`)}`;
}

/** Removes the sessions that tests minted, and only those. */
export async function removeMintedSessions(client: Client): Promise<void> {
  await client.query(
    "delete from auth_sessions where user_agent = 'refrain-http-tests'",
  );
}
