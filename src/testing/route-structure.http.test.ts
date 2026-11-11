// The route tree after the move under `(en)`, over real HTTP (ADR 0008 §§ 2
// and 8; ADR 0006 A7). A route group changes no URL, so the group's name must
// not become an address of its own, and the address-level not-found view must
// keep its real status, its headers, and its words in every request form.
import { readFileSync } from "node:fs";

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

// An encoded spelling of the Studio's own name, in either tree. Before this
// was fixed the framework's router found the Studio's output by the decoded
// path, its renderer matched no route by the raw one, and the fallback was the
// prerendered not-found page from the build's cache: `404` with
// `s-maxage=31536000` and none of the Studio's headers, which a shared cache
// could keep for a year. The proxy now answers them as it answers the encoded
// Portuguese prefix above.
const ENCODED_STUDIO_NAME = [
  "/%73tudio",
  "/st%75dio",
  "/studi%6f",
  "/%73tudio/journals",
  "/st%75dio/artists/new",
  "/studi%6f/sign-in",
  // An encoded slash: the name is literal, but the address is a Studio
  // address only once decoded.
  "/studio%2Fjournals",
  "/%73tudio/journals/00000000-0000-4000-8000-000000000000",
  "/pt/%73tudio",
  "/pt/st%75dio/journals",
  "/pt/studi%6f/sign-in",
  "/pt/studio%2Fjournals",
  "/%70t/%73tudio",
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

  it.each([
    ["the router's request", "/%70t/studio", { rsc: true }],
    [
      "a prefetch",
      "/%70t/studio/journals",
      {
        rsc: true,
        headers: { "next-router-prefetch": "1", cookie: "" },
      },
    ],
    ["a transport file", "/%70t/studio.rsc", {}],
    ["a segment file", "/%70t/studio.segments/_tree.segment.rsc", {}],
    ["HEAD", "/%70t/studio", { method: "HEAD" }],
    ["POST", "/p%74/studio/sign-in", { method: "POST" }],
  ] as const)(
    "is never a Studio page in %s either: a 404, never stored, never a redirect",
    async (_form, path, init) => {
      for (const extra of [{}, { cookie }]) {
        const answer = await request(base, path, {
          ...init,
          headers: { ...("headers" in init ? init.headers : {}), ...extra },
        });
        expect(answer.status, path).toBe(404);
        expect(answer.headers["location"], path).toBeUndefined();
        expect(answer.headers["cache-control"], path).toMatch(/no-store/);
        expect(answer.headers["cache-control"], path).not.toMatch(
          /s-maxage|public/,
        );
        expect(answer.body, path).not.toContain("studio-header");
      }
    },
  );
});

describe("an encoded spelling of the Studio's name", () => {
  it.each(ENCODED_STUDIO_NAME)(
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
        expect(answer.headers["cache-control"], path).not.toMatch(
          /s-maxage|public/,
        );
        expect(answer.headers["x-frame-options"], path).toBe("DENY");
        expect(answer.headers["referrer-policy"], path).toBe("no-referrer");
        expect(answer.headers["x-content-type-options"], path).toBe("nosniff");
        // The public policy, which is stricter: no photograph host.
        expect(answer.headers["content-security-policy"], path).toBe(
          CONTENT_SECURITY_POLICY,
        );
      }
      expect(comparable(signedIn)).toEqual(comparable(anonymous));
    },
  );

  it.each([
    ["the router's request", "/%73tudio", { rsc: true }],
    ["the router's request", "/pt/st%75dio/journals", { rsc: true }],
    [
      "a prefetch",
      "/st%75dio/journals",
      { rsc: true, headers: { "next-router-prefetch": "1" } },
    ],
    [
      "a segment prefetch",
      "/%73tudio",
      {
        rsc: true,
        headers: {
          "next-router-prefetch": "1",
          "next-router-segment-prefetch": "/_tree",
        },
      },
    ],
    ["a transport file", "/%73tudio.rsc", {}],
    ["a transport file", "/studio%2Ersc", {}],
    ["a transport file", "/pt/%73tudio.rsc", {}],
    ["a segment file", "/%73tudio.segments/_tree.segment.rsc", {}],
    ["a nested transport file", "/st%75dio/journals.rsc", {}],
    ["a data file", "/_next/data/build/%73tudio.json", {}],
    ["HEAD", "/%73tudio", { method: "HEAD" }],
    ["HEAD", "/pt/studi%6f/sign-in", { method: "HEAD" }],
    ["POST", "/studi%6f/sign-in", { method: "POST" }],
    ["POST", "/pt/%73tudio/artists/new", { method: "POST" }],
    // Never the trailing slash's redirect, which would name the address.
    ["a trailing slash", "/%73tudio/", {}],
    ["a trailing slash", "/pt/st%75dio/journals/", {}],
  ] as const)(
    "is never a Studio page in %s (%s): a 404, never stored, never a redirect",
    async (_form, path, init) => {
      const extras: Record<string, string>[] = [{}, { cookie }];
      for (const extra of extras) {
        const headers: Record<string, string> = {
          ...("headers" in init ? init.headers : {}),
          ...extra,
        };
        const answer = await request(base, path, { ...init, headers });
        expect(answer.status, path).toBe(404);
        expect(answer.headers["location"], path).toBeUndefined();
        expect(answer.headers["cache-control"], path).toMatch(/no-store/);
        expect(answer.headers["cache-control"], path).not.toMatch(
          /s-maxage|public/,
        );
        expect(answer.headers["x-frame-options"], path).toBe("DENY");
        expect(answer.headers["referrer-policy"], path).toBe("no-referrer");
        expect(answer.body, path).not.toContain("studio-header");
      }
    },
  );

  it("answers a Server Action call as an unknown address does: the action's own refusal, never stored", async () => {
    // The framework accepts a Server Action's id at any address, `/` and an
    // unknown one included, and the action authorizes itself (Security §
    // Authorization contract): the address is never the control. At an
    // encoded Studio address the call gets what it gets at an unknown one,
    // and a visitor without a session writes nothing.
    const manifest = JSON.parse(
      readFileSync(".next/server/server-reference-manifest.json", "utf8"),
    ) as { node: Record<string, { exportedName: string }> };
    const id = Object.entries(manifest.node).find(
      ([, entry]) => entry.exportedName === "createArtistAction",
    )?.[0];
    expect(id).toBeDefined();
    const name = `[Test] Encoded address ${Date.now()}`;
    const call = async (path: string) => {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        redirect: "manual",
        headers: {
          origin: base,
          accept: "text/x-component",
          "content-type": "text/plain;charset=UTF-8",
          "next-action": id!,
        },
        body: JSON.stringify([{ name }]),
      });
      const body = await response.text();
      return {
        status: response.status,
        cacheControl: response.headers.get("cache-control"),
        code: body.match(/"code":"([a-z_]+)"/)?.[1],
      };
    };
    const unknown = await call("/no-such-address");
    expect(unknown.code).toBe("unauthorized");
    for (const path of [
      "/%73tudio/artists/new",
      "/st%75dio/artists/new",
      "/pt/studi%6f/artists/new",
    ]) {
      const answer = await call(path);
      expect(answer, path).toEqual(unknown);
      expect(answer.cacheControl, path).toMatch(/no-store/);
      expect(answer.cacheControl, path).not.toMatch(/s-maxage|public/);
    }
    const created = await db.query(
      "select count(*)::int as n from artists where name = $1",
      [name],
    );
    expect(created.rows[0].n).toBe(0);
  });

  it("leaves a literal Studio address to the framework and its own header rules", async () => {
    // An encoded character after the literal name is not this case: no route
    // serves it, and the Studio's rules in next.config.ts already match it.
    const extras: Record<string, string>[] = [{}, { cookie }];
    for (const extra of extras) {
      const answer = await request(base, "/studio/%6aournals", {
        headers: extra,
      });
      expect(answer.status).toBe(404);
      expect(answer.headers["cache-control"]).toBe(
        "private, no-store, max-age=0, must-revalidate",
      );
    }
    // The literal Desk still asks for a session, in its own language (the
    // redirect streams inside the page, as on every Studio page).
    const desk = await request(base, "/studio");
    expect(desk.body).toContain("NEXT_REDIRECT;replace;/studio/sign-in;307;");
    const mesa = await request(base, "/pt/studio");
    expect(mesa.body).toContain(
      "NEXT_REDIRECT;replace;/pt/studio/sign-in;307;",
    );
    // And serves the author.
    const signedIn = await request(base, "/studio", { headers: { cookie } });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body).toContain("studio-header");
  });
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
