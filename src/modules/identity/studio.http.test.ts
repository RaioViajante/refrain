// The Writing Studio and its authentication over real HTTP, against the
// production build (`next start`) and the disposable test database. Setup:
// src/testing/http-global-setup.ts.
//
// The tests run in order and share one server. Sign-in is limited to five
// attempts a minute for all clients together, so the attempts are counted:
// this file makes three before the rate-limit test.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, inject, it } from "vitest";

const base = inject("studioBaseURL");
const email = inject("studioAuthorEmail");
const password = inject("studioAuthorPassword");

// Text that only the signed-in Desk contains (its introduction).
const SIGNED_IN = "Everything you are writing";
const SIGN_IN_REDIRECT = "NEXT_REDIRECT;replace;/studio/sign-in;307;";

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: base, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function get(path: string, cookie?: string) {
  return fetch(`${base}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
}

function sessionSetCookie(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("refrain.session_token="));
}

async function expectNoStudio(response: Response): Promise<void> {
  const body = await response.text();
  expect(body).not.toContain(SIGNED_IN);
  expect(body).not.toContain("Sign out");
  // Cache Components streams the redirect into the static shell.
  expect(body).toContain(SIGN_IN_REDIRECT);
  expect(response.headers.get("cache-control")).toContain("no-store");
}

function runAuthorCommand(args: string[], stdin: string) {
  return new Promise<{ code: number | null; output: string }>(
    (resolve, reject) => {
      const child = spawn("pnpm", ["--silent", ...args], {
        env: {
          ...process.env,
          ...inject("studioCommandEnv"),
          NODE_ENV: "production",
        },
        stdio: "pipe",
      });
      let output = "";
      child.stdout.on("data", (chunk) => (output += String(chunk)));
      child.stderr.on("data", (chunk) => (output += String(chunk)));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, output }));
      child.stdin.end(stdin);
    },
  );
}

let signedOutCookie = "";
let liveCookie = "";

describe("studio access without a valid session", () => {
  it("never renders the studio for an anonymous request", async () => {
    await expectNoStudio(await get("/studio"));
  });

  it.each([
    "refrain.session_token=forged.value",
    "refrain.session_token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA%3D",
    "better-auth.session_token=forged",
    "__Secure-refrain.session_token=forged",
  ])(
    "never renders the studio for a fabricated cookie (%s)",
    async (cookie) => {
      await expectNoStudio(await get("/studio", cookie));
    },
  );

  it("serves the studio pages unframeable and uncached", async () => {
    for (const path of ["/studio", "/studio/sign-in"]) {
      const response = await get(path);
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("content-security-policy")).toBe(
        "frame-ancestors 'none'",
      );
      expect(response.headers.get("cache-control")).toContain("no-store");
      await response.body?.cancel();
    }
  });
});

describe("authentication endpoints", () => {
  it("has no sign-up endpoint", async () => {
    const response = await post("/api/auth/sign-up/email", {
      email: "someone@example.com",
      password: "[Test] a long enough password",
      name: "[Test] Someone",
    });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("refuses a cross-origin sign-in", async () => {
    const response = await post(
      "/api/auth/sign-in/email",
      { email, password },
      { origin: "https://attacker.example" },
    );
    expect(response.status).toBe(403);
    expect(sessionSetCookie(response)).toBeUndefined();
  });

  it("answers malformed input without internal details", async () => {
    // Sign-out, which is not rate limited: every sign-in attempt counts,
    // even one Better Auth cannot parse.
    const response = await post("/api/auth/sign-out", "{not json");
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).not.toMatch(/\s+at\s/);
    expect(body).not.toContain("node_modules");
  });
});

describe("sign-in, the studio, and sign-out", () => {
  it("signs in, renders the studio, and signs out for good", async () => {
    // Attempt 1.
    const signIn = await post("/api/auth/sign-in/email", { email, password });
    expect(signIn.status).toBe(200);
    expect(signIn.headers.get("cache-control")).toBe("no-store");
    const setCookie = sessionSetCookie(signIn);
    expect(setCookie).toMatch(/; HttpOnly/i);
    expect(setCookie).toMatch(/; SameSite=Strict/i);
    expect(setCookie).toMatch(/; Path=\//);
    const cookie = (setCookie ?? "").split(";", 1)[0] ?? "";
    // The raw token is only in the HttpOnly cookie, never in JSON.
    const token = decodeURIComponent(cookie.split("=")[1] ?? "").split(".")[0];
    expect(token).toBeTruthy();
    expect(await signIn.text()).not.toContain(token);
    const current = await get("/api/auth/get-session", cookie);
    expect(current.status).toBe(200);
    expect(await current.text()).not.toContain(token);

    const studio = await get("/studio", cookie);
    expect(studio.status).toBe(200);
    expect(studio.headers.get("cache-control")).toContain("no-store");
    expect(studio.headers.get("cache-control")).toContain("private");
    const html = await studio.text();
    expect(html).toContain(SIGNED_IN);
    expect(html).not.toContain(SIGN_IN_REDIRECT);

    // The sign-in page sends the signed-in author on to the studio.
    const signInPage = await (await get("/studio/sign-in", cookie)).text();
    expect(signInPage).toContain("NEXT_REDIRECT;replace;/studio;307;");

    const signOut = await post("/api/auth/sign-out", {}, { cookie });
    expect(signOut.status).toBe(200);
    expect(
      signOut.headers
        .getSetCookie()
        .find((c) => c.startsWith("refrain.session_token=")),
    ).toMatch(/Max-Age=0/);

    // The same cookie, replayed after sign-out, grants nothing.
    await expectNoStudio(await get("/studio", cookie));
    signedOutCookie = cookie;
  });

  it("rejects a wrong password and an unknown email alike", async () => {
    // Attempts 2 and 3.
    const wrong = await post("/api/auth/sign-in/email", {
      email,
      password: "[Test] not the password at all",
    });
    const unknown = await post("/api/auth/sign-in/email", {
      email: "nobody@example.com",
      password,
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(sessionSetCookie(wrong)).toBeUndefined();
    expect(sessionSetCookie(unknown)).toBeUndefined();
    expect(await wrong.json()).toEqual(await unknown.json());
  });
});

describe("sign-in rate limit", () => {
  it("throttles every client together, whatever address it claims", async () => {
    // Attempt 4, which succeeds and keeps a session for the reset test.
    const signIn = await post("/api/auth/sign-in/email", { email, password });
    expect(signIn.status).toBe(200);
    liveCookie = (sessionSetCookie(signIn) ?? "").split(";", 1)[0] ?? "";

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await post(
        "/api/auth/sign-in/email",
        { email, password: "[Test] guessing the password" },
        {
          "x-forwarded-for": `203.0.113.${attempt + 1}`,
          "x-real-ip": "198.51.100.7",
        },
      );
      statuses.push(response.status);
      await response.body?.cancel();
    }
    // Attempt 5 is still allowed; 6 and later are refused.
    expect(statuses).toEqual([401, 429, 429]);

    const correct = await post("/api/auth/sign-in/email", { email, password });
    expect(correct.status).toBe(429);
    expect(sessionSetCookie(correct)).toBeUndefined();
  });
});

describe("the author command", () => {
  const target = inject("studioDatabaseTarget");

  it("refuses to provision a second time, and prints no password", async () => {
    const result = await runAuthorCommand(
      ["author:provision", `--target=${target}`],
      "[Test] yet another long password\n",
    );
    expect(result.code).toBe(1);
    expect(result.output).toContain(
      "An account already exists. Nothing was changed.",
    );
    expect(result.output).not.toContain("[Test] yet another long password");
  });

  it("refuses a target that is not DATABASE_URL's", async () => {
    const result = await runAuthorCommand(
      ["author:provision", "--target=127.0.0.1:5432/refrain"],
      `${password}\n`,
    );
    expect(result.code).toBe(1);
    expect(result.output).toContain("not to the --target given");
  });

  it("refuses a password given as an argument", async () => {
    const result = await runAuthorCommand(
      ["author:provision", `--target=${target}`, "--password=hunter2-hunter2"],
      "",
    );
    expect(result.code).toBe(1);
    expect(result.output).not.toContain("hunter2-hunter2");
  });

  it("resets the password and ends every session", async () => {
    await expectNoStudio(await get("/studio", signedOutCookie));
    const live = await (await get("/studio", liveCookie)).text();
    expect(live).toContain(SIGNED_IN);

    const result = await runAuthorCommand(
      ["author:reset-password", `--target=${target}`],
      "[Test] the replacement passphrase\n",
    );
    expect(result.code).toBe(0);
    expect(result.output).toContain("signed out 1 session(s)");
    expect(result.output).not.toContain("[Test] the replacement passphrase");

    await expectNoStudio(await get("/studio", liveCookie));
  });
});

describe("server log", () => {
  it("contains no password, session token, or secret", async () => {
    // Give the server a moment to flush what it wrote.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const log = readFileSync(inject("studioServerLog"), "utf8");
    const token = decodeURIComponent(liveCookie.split("=")[1] ?? "").split(
      ".",
    )[0];
    for (const secret of [
      password,
      "[Test] the replacement passphrase",
      inject("studioCommandEnv").BETTER_AUTH_SECRET,
      token,
      decodeURIComponent(signedOutCookie.split("=")[1] ?? "").split(".")[0],
    ]) {
      expect(secret).toBeTruthy();
      expect(log).not.toContain(secret);
    }
  });
});
