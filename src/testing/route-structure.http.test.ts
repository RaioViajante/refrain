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
import { comparable, request, visibleText } from "@/testing/public-http";
import { assertDisposableTestDatabase } from "@/testing/test-database";

const base = inject("studioBaseURL");
const commandEnv = inject("studioCommandEnv");

// Addresses that must not exist. `/%70t` is not the Portuguese prefix, and
// neither form of it is served yet.
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
  "/pt",
  "/pt/albums/some-address",
  "/pt/studio",
  "/pt-BR",
  "/pt/pt",
  "/%70t",
  "/%70t/albums/some-address",
  "/%70t/studio",
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

describe("a Studio record that does not exist", () => {
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
