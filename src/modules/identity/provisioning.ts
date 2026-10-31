import "server-only";

import { count, eq, sql } from "drizzle-orm";

import { schema, type DatabaseExecutor } from "@/db";

import { createAuth, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./auth";
import type { AuthConfig } from "./config";

// Creating the single author account, and changing its password, outside any
// HTTP route (ADR 0004). Only the local command in ./cli.ts calls these
// functions; they are deliberately absent from the module's public entry
// point, so no page, action, or route can import them.
//
// Public sign-up stays disabled throughout. The account is written by Better
// Auth's own internal adapter and password hasher, exactly as its sign-up
// endpoint would write it (Better Auth 1.7.12, api/routes/sign-up), inside one
// transaction. An integration test signs in with the result, so a library
// upgrade that changed the account format fails the tests.

export type ProvisioningFailure =
  | "account_exists"
  | "identity_state_not_empty"
  | "no_author_account"
  | "unexpected_account_state"
  | "password_too_short"
  | "password_too_long"
  | "password_contains_email";

export class ProvisioningError extends Error {
  override name = "ProvisioningError";

  constructor(
    readonly reason: ProvisioningFailure,
    message: string,
  ) {
    super(message);
  }
}

/** Shown as the account's display name. Not personal data. */
const AUTHOR_DISPLAY_NAME = "Author";

/** Refuses a password that does not meet the policy. Never echoes it. */
export function assertAcceptablePassword(
  password: string,
  email: string,
): void {
  // Length is counted in code points, so a passphrase in any script counts
  // what the author typed.
  const length = [...password].length;
  if (length < MIN_PASSWORD_LENGTH) {
    throw new ProvisioningError(
      "password_too_short",
      `The password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new ProvisioningError(
      "password_too_long",
      `The password must be at most ${MAX_PASSWORD_LENGTH} characters long.`,
    );
  }
  if (password.toLowerCase().includes(email.toLowerCase())) {
    throw new ProvisioningError(
      "password_contains_email",
      "The password must not contain the email address.",
    );
  }
}

// Serializes provisioning and rotation, and blocks concurrent sign-ups (there
// are none) and account changes until the transaction ends.
async function lockIdentityTables(tx: DatabaseExecutor): Promise<void> {
  await tx.execute(
    sql`lock table ${schema.authUsers}, ${schema.authAccounts}, ${schema.authSessions} in exclusive mode`,
  );
}

async function rowCount(
  tx: DatabaseExecutor,
  table:
    | typeof schema.authUsers
    | typeof schema.authAccounts
    | typeof schema.authSessions
    | typeof schema.authVerifications,
): Promise<number> {
  const [row] = await tx.select({ value: count() }).from(table);
  return row?.value ?? 0;
}

export interface ProvisionedAuthor {
  userId: string;
  email: string;
}

/**
 * Creates the author account for `config.authorEmail` with `password`.
 *
 * Refuses, and writes nothing, unless the identity tables are empty: an
 * existing account is never replaced and its password never overwritten.
 * Running it again therefore always fails with `account_exists`.
 */
export async function provisionAuthor(
  database: DatabaseExecutor,
  config: AuthConfig,
  password: string,
): Promise<ProvisionedAuthor> {
  const email = config.authorEmail;
  assertAcceptablePassword(password, email);

  return database.transaction(async (tx) => {
    await lockIdentityTables(tx);
    if ((await rowCount(tx, schema.authUsers)) > 0) {
      throw new ProvisioningError(
        "account_exists",
        "An account already exists. Nothing was changed. To change its password, use `pnpm author:reset-password`.",
      );
    }
    if (
      (await rowCount(tx, schema.authAccounts)) > 0 ||
      (await rowCount(tx, schema.authSessions)) > 0 ||
      (await rowCount(tx, schema.authVerifications)) > 0
    ) {
      throw new ProvisioningError(
        "identity_state_not_empty",
        "The identity tables are not empty although no account exists. Nothing was changed; inspect the database.",
      );
    }

    // Bound to this transaction, so the user and its credential are written
    // together or not at all.
    const context = await createAuth(tx, config).$context;
    const hash = await context.password.hash(password);
    const user = await context.internalAdapter.createUser(
      { email, name: AUTHOR_DISPLAY_NAME, emailVerified: false },
      { method: "email-password" },
    );
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: hash,
    });
    return { userId: user.id, email: user.email };
  });
}

export interface PasswordChange {
  userId: string;
  /** How many sessions were signed out. */
  revokedSessions: number;
}

/**
 * Replaces the author's password and signs out every session, in one
 * transaction. This is the recovery path for a forgotten or exposed password;
 * it needs direct access to the database, never an HTTP request.
 */
export async function resetAuthorPassword(
  database: DatabaseExecutor,
  config: AuthConfig,
  password: string,
): Promise<PasswordChange> {
  const email = config.authorEmail;
  assertAcceptablePassword(password, email);

  return database.transaction(async (tx) => {
    await lockIdentityTables(tx);
    const users = await tx
      .select({ id: schema.authUsers.id, email: schema.authUsers.email })
      .from(schema.authUsers);
    const author = users[0];
    if (users.length !== 1 || !author || author.email !== email) {
      throw new ProvisioningError(
        "no_author_account",
        "No account exists for REFRAIN_AUTHOR_EMAIL. Nothing was changed. To create it, use `pnpm author:provision`.",
      );
    }

    const accounts = await tx
      .select({
        providerId: schema.authAccounts.providerId,
        accountId: schema.authAccounts.accountId,
      })
      .from(schema.authAccounts)
      .where(eq(schema.authAccounts.userId, author.id));
    if (
      accounts.length !== 1 ||
      accounts[0]?.providerId !== "credential" ||
      accounts[0]?.accountId !== author.id
    ) {
      throw new ProvisioningError(
        "unexpected_account_state",
        "The author does not have exactly one password credential. Nothing was changed; inspect the database.",
      );
    }

    const revokedSessions = await rowCount(tx, schema.authSessions);
    const context = await createAuth(tx, config).$context;
    await context.internalAdapter.updatePassword(
      author.id,
      await context.password.hash(password),
    );
    await context.internalAdapter.deleteUserSessions(author.id);
    return { userId: author.id, revokedSessions };
  });
}
