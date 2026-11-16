// The sign-in limits over HTTP, on the production build (issue #11). One server
// is configured as on the hosting platform (VERCEL=1, which overwrites
// X-Forwarded-For there, and the header trusted); another sets the header off
// the platform, which must fail closed. Every address is from the
// documentation ranges, and no attempt here uses the shared `unknown` bucket,
// which src/modules/identity/studio.http.test.ts counts exactly.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startProductionServer,
  SYNTHETIC_AUTHOR_EMAIL,
  type ProductionServer,
} from "@/testing/production-server";

let platform: ProductionServer;
let offPlatform: ProductionServer;

beforeAll(async () => {
  platform = await startProductionServer({
    withAuthor: false,
    env: {
      VERCEL: "1",
      VERCEL_ENV: "preview",
      REFRAIN_TRUSTED_CLIENT_IP_HEADER: "x-forwarded-for",
    },
  });
  offPlatform = await startProductionServer({
    withAuthor: false,
    env: {
      VERCEL: undefined,
      REFRAIN_TRUSTED_CLIENT_IP_HEADER: "x-forwarded-for",
    },
  });
});

afterAll(async () => {
  await platform?.stop();
  await offPlatform?.stop();
});

async function attempt(
  server: ProductionServer,
  client: string,
): Promise<number> {
  const response = await fetch(`${server.baseURL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      origin: server.baseURL,
      "content-type": "application/json",
      "x-forwarded-for": client,
    },
    body: JSON.stringify({
      email: SYNTHETIC_AUTHOR_EMAIL,
      password: "[Test] a wrong password for the limits",
    }),
  });
  await response.body?.cancel();
  return response.status;
}

describe("sign-in limits where the platform names the client", () => {
  it("throttles one client after five attempts, while another client is still heard", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push(await attempt(platform, "192.0.2.71"));
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429]);
    // A different client, as the author signing in from elsewhere: refused
    // only for the wrong password, never for the other client's attempts.
    expect(await attempt(platform, "198.51.100.72")).toBe(401);
  });

  it("groups an IPv6 network by its /64, so rotating addresses inside it gains nothing", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(await attempt(platform, `2001:db8:71:1::${i + 1}`));
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect(await attempt(platform, "2001:db8:71:2::1")).toBe(401);
  });
});

describe("the refusals themselves", () => {
  it("are never stored, never indexed, and say nothing but their code", async () => {
    const client = "192.0.2.91";
    let refused: Response | undefined;
    for (let i = 0; i < 7 && !refused; i++) {
      const response = await fetch(
        `${platform.baseURL}/api/auth/sign-in/email`,
        {
          method: "POST",
          headers: {
            origin: platform.baseURL,
            "content-type": "application/json",
            "x-forwarded-for": client,
            cookie: "probe=refrain-private-cookie-value",
          },
          body: JSON.stringify({
            email: SYNTHETIC_AUTHOR_EMAIL,
            password: "[Test] a wrong password for the limits",
          }),
        },
      );
      if (response.status === 429) {
        refused = response;
      } else {
        await response.body?.cancel();
      }
    }
    expect(refused?.status).toBe(429);
    expect(refused!.headers.get("cache-control")).toContain("no-store");
    expect(refused!.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const text = await refused!.text();
    expect(JSON.parse(text)).toEqual({ code: "TOO_MANY_REQUESTS" });
    for (const value of [client, "refrain-private-cookie-value", "refrain-"]) {
      expect(text.includes(value), value).toBe(false);
      expect(JSON.stringify([...refused!.headers]).includes(value), value).toBe(
        false,
      );
    }

    const unavailable = await fetch(
      `${offPlatform.baseURL}/api/auth/sign-in/email`,
      {
        method: "POST",
        headers: {
          origin: offPlatform.baseURL,
          "content-type": "application/json",
          "x-forwarded-for": client,
        },
        body: JSON.stringify({
          email: SYNTHETIC_AUTHOR_EMAIL,
          password: "[Test] a wrong password for the limits",
        }),
      },
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toContain("no-store");
    expect(unavailable.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await unavailable.json()).toEqual({ code: "AUTH_UNAVAILABLE" });
  });
});

describe("the header configured off the platform", () => {
  it("fails closed: no sign-in is attempted, and no client chooses its bucket", async () => {
    for (const client of ["192.0.2.81", "192.0.2.82"]) {
      const response = await fetch(
        `${offPlatform.baseURL}/api/auth/sign-in/email`,
        {
          method: "POST",
          headers: {
            origin: offPlatform.baseURL,
            "content-type": "application/json",
            "x-forwarded-for": client,
          },
          body: JSON.stringify({
            email: SYNTHETIC_AUTHOR_EMAIL,
            password: "[Test] a wrong password for the limits",
          }),
        },
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ code: "AUTH_UNAVAILABLE" });
    }
  });
});
