// Settings shared by playwright.config.ts, the global setup, and the specs.
//
// TEST-ONLY CREDENTIALS. The Studio email, password, and hash below exist only
// for the browser tests. They open nothing but the disposable database
// refrain_mixtapes_e2e_test on the postgres-test Compose service (or CI's
// service of the same name), which the global setup drops and rebuilds on
// every run. They are not, and must never become, the owner's credentials.
import { readTestDatabaseUrl } from "../../src/db/env";

export const E2E_PORT = 3300;
export const BASE_URL = `http://localhost:${E2E_PORT}`;

/**
 * The browser tests' own database, beside the integration tests'
 * (refrain_mixtapes_test), so both suites can run at once. The guard refuses
 * anything that is not local or not named *_test.
 */
export const E2E_DATABASE_URL = readTestDatabaseUrl({
  TEST_DATABASE_URL:
    "postgres://refrain_test:refrain_test@127.0.0.1:5443/refrain_mixtapes_e2e_test",
});

/** [Test] Studio sign-in, for the disposable e2e database only. */
export const TEST_STUDIO_EMAIL = "e2e@example.test";
export const TEST_STUDIO_PASSWORD = "e2e-test-only-password-not-a-secret";
/** hashPassword(TEST_STUDIO_PASSWORD, { N: 2 ** 14, r: 8, p: 1 }). */
export const TEST_STUDIO_PASSWORD_HASH =
  "scrypt:16384:8:1:pV_lC2nV5nGsq8-62vyohg:CxIn9dKpSuOSKbV655JCBybb9z8Uvl3KjOb5jBt3vZK62v6b_fY23hVh4xvJZ3CofY-ONamQMA1Dskoulr3hUw";
