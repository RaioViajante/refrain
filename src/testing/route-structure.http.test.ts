// The route tree after the move under `(en)`, over real HTTP (ADR 0008 §§ 2
// and 8; ADR 0006 A7). A route group changes no URL, so the group's name must
// not become an address of its own, and the address-level not-found view must
// keep its real status, its headers, and its words in every request form.
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import {
  mintAuthorSession,
  removeMintedSessions,
} from "@/testing/http-session";
import { CONTENT_SECURITY_POLICY } from "@/security-headers";
import { comparable, request, visibleText } from "@/testing/public-http";
import { assertDisposableTestDatabase } from "@/testing/test-database";

const base = inject("studioBaseURL");
const commandEnv = inject("studioCommandEnv");

// Addresses that must not exist. The Portuguese forms, `/pt`, its sections,
// and the encoded spellings of its prefix (`/%70t`), are held by
// src/testing/public-portuguese.http.test.ts (ADR 0006 A7).
const NOT_ROUTES = [
  "/(en)",
  "/(en)/albums",
  "/(en)/albums/some-address",
  "/(en)/studio",
  "/(en)/studio/journals",
  "/%28en%29",
  "/%28en%29/studio",
  "/(public)/albums/some-address",
  "/en",
  "/en/albums/some-address",
  "/en/studio",
  "/pt-BR",
  "/pt/pt",
  // The Portuguese Studio has the literal prefix only (ADR 0008 § 2). Its
  // encoded spellings (`/%70t/studio`) are held below.
  "/pt/pt/studio",
  "/pt/en/studio",
  "/pt-BR/studio",
  "/pt/(en)/studio",
];

// An encoded spelling of the prefix before the Studio (ADR 0006 A7, item 2).
// Before PR 3 no route matched it, and it answered as `/no-such-address`
// (this list was in NOT_ROUTES). Now the framework would match it, decoded, to
// the Portuguese Studio, so the proxy answers it: the unknown address's body
// and status, never stored, with the Studio's headers, the headers of the
// section it names (the public image policy, which is stricter).
const ENCODED_STUDIO = [
  "/%70t/studio",
  "/%70t/studio/journals",
  "/p%74/studio/sign-in",
  "/%70%74/studio/artists/new",
];

let db: Client;
let cookie = "";

beforeAll(async () => {
  db = new Client({
    connectionString: commandEnv.DATABASE_URL!,
    application_name: "refrain-http-route-structure",
  });
  await db.connect();
  await assertDisposableTestDatabase(db);
  cookie = (await mintAuthorSession(db, commandEnv.BETTER_AUTH_SECRET!)).cookie;
});

afterAll(async () => {
  await removeMintedSessions(db);
  await db.end();
});

describe("an address that no route serves", () => {
  it("is a real 404 in the English document, never stored, with the view's words", async () => {
    const answer = await request(base, "/no-such-address");
    expect(answer.status).toBe(404);
    expect(answer.headers["cache-control"]).toMatch(/no-store/);
    expect(answer.body).toMatch(/<html[^>]*\blang="en"/);
    expect(answer.body).toContain("<title>Not found · refrain</title>");
    const words = visibleText(answer.body);
    expect(words).toContain("Nothing here");
    expect(words).toContain("This page is not available.");
    expect(words).toContain("Back to the start");
  });

  it("answers the router with the same view and the same status", async () => {
    const answer = await request(base, "/no-such-address", { rsc: true });
    expect(answer.status).toBe(404);
    expect(answer.headers["cache-control"]).toMatch(/no-store/);
    expect(answer.body).toContain("Nothing here");
  });

  it.each(NOT_ROUTES)(
    "%s answers what an unknown address answers",
    async (path) => {
      const unknown = comparable(await request(base, "/no-such-address"));
      const answer = comparable(await request(base, path));
      expect(answer).toEqual(unknown);
    },
  );

  it.each(NOT_ROUTES)("%s shows the author nothing more", async (path) => {
    const unknown = comparable(await request(base, "/no-such-address"));
    const answer = comparable(
      await request(base, path, { headers: { cookie } }),
    );
    expect(answer).toEqual(unknown);
  });
});

describe("an encoded spelling of the Portuguese Studio's prefix", () => {
  it.each(ENCODED_STUDIO)(
    "%s is the unknown address, never stored, with the Studio's headers, and the same for the author",
    async (path) => {
      const unknown = await request(base, "/no-such-address");
      const anonymous = await request(base, path);
      const signedIn = await request(base, path, { headers: { cookie } });
      for (const answer of [anonymous, signedIn]) {
        expect(answer.status, path).toBe(404);
        expect(answer.body, path).toBe(unknown.body);
        expect(answer.headers["location"], path).toBeUndefined();
        expect(answer.headers["cache-control"], path).toMatch(
          /^private, .*no-store/,
        );
        expect(answer.headers["x-frame-options"], path).toBe("DENY");
        expect(answer.headers["referrer-policy"], path).toBe("no-referrer");
        // The public policy, which is stricter: no photograph host.
        expect(answer.headers["content-security-policy"], path).toBe(
          CONTENT_SECURITY_POLICY,
        );
      }
      expect(comparable(signedIn)).toEqual(comparable(anonymous));
    },
  );
});

describe("a Studio record that does not exist", () => {
  it("renders the shared view inside the Portuguese document from /pt, with the private headers", async () => {
    const answer = await request(
      base,
      "/pt/studio/artists/00000000-0000-4000-8000-000000000000",
      { headers: { cookie } },
    );
    expect(answer.headers["cache-control"]).toBe(
      "private, no-store, max-age=0, must-revalidate",
    );
    expect(answer.body).toMatch(/<html[^>]*\blang="pt-BR"/);
    // The shared view, in both languages, Portuguese first (ADR 0008 § 8).
    expect(answer.body).toContain("Nada aqui");
    expect(answer.body).toContain("Nothing here");
    expect(answer.body).not.toContain("00000000-0000-4000-8000-000000000000</");
  });

  it("renders the shared view inside the English document, with the private headers", async () => {
    const answer = await request(
      base,
      "/studio/artists/00000000-0000-4000-8000-000000000000",
      { headers: { cookie } },
    );
    expect(answer.headers["cache-control"]).toBe(
      "private, no-store, max-age=0, must-revalidate",
    );
    expect(answer.body).toMatch(/<html[^>]*\blang="en"/);
    expect(answer.body).toContain("Nothing here");
  });
});
