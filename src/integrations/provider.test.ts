import { describe, expect, it } from "vitest";

import { json, virtualRuntime } from "@/testing/provider-runtime";

import {
  createLimiter,
  ProviderError,
  requestJson,
  resolveBaseUrl,
  TtlCache,
  type JsonRequest,
  type ProviderRuntime,
} from "./provider";

function baseRequest(runtime: ProviderRuntime): JsonRequest {
  return {
    provider: "musicbrainz",
    url: new URL("https://musicbrainz.org/ws/2/artist/x"),
    userAgent: "Refrain/0.1.0 ( https://github.com/RaioViajante/refrain )",
    runtime,
    limiter: createLimiter(1100, runtime),
    timeoutMs: 8000,
    deadlineMs: 20000,
    retries: 2,
    maxBytes: 1024,
  };
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProviderError) {
      return error.failure;
    }
    throw error;
  }
  throw new Error("expected a ProviderError");
}

describe("createLimiter", () => {
  it("spaces the start of each request, in order, for the whole process", async () => {
    const { runtime } = virtualRuntime(() => json({}));
    const schedule = createLimiter(1100, runtime);
    const starts: number[] = [];
    await Promise.all(
      [1, 2, 3].map(() =>
        schedule(async () => {
          starts.push(runtime.now());
        }),
      ),
    );
    expect(starts).toEqual([0, 1100, 2200]);
  });

  it("keeps the spacing after a failed request", async () => {
    const { runtime } = virtualRuntime(() => json({}));
    const schedule = createLimiter(1000, runtime);
    await expect(
      schedule(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    let started = -1;
    await schedule(async () => {
      started = runtime.now();
    });
    expect(started).toBe(1000);
  });
});

describe("a bounded queue", () => {
  it("refuses at once a request that would wait longer than it may", async () => {
    const { runtime } = virtualRuntime(() => json({}));
    const schedule = createLimiter(1000, runtime);
    const started: number[] = [];
    const outcomes = await Promise.allSettled(
      [0, 1, 2, 3].map(() =>
        schedule(async () => {
          started.push(runtime.now());
        }, 2500),
      ),
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
      "rejected",
    ]);
    expect(started).toEqual([0, 1000, 2000]);
  });

  it("counts the wait in the queue against the deadline", async () => {
    const { runtime, calls } = virtualRuntime(() => json({ ok: true }));
    const limiter = createLimiter(1100, runtime);
    const requests = Array.from({ length: 13 }, () =>
      requestJson({ ...baseRequest(runtime), limiter }).then(
        () => "ok",
        (error: unknown) =>
          error instanceof ProviderError ? error.failure : "other",
      ),
    );
    // 20 s deadline, 8 s per attempt: at most 12 s in the queue, so the
    // twelfth and thirteenth requests (12.1 s and 13.2 s away) are refused.
    expect(await Promise.all(requests)).toEqual([
      ...Array.from({ length: 11 }, () => "ok"),
      "unavailable",
      "unavailable",
    ]);
    expect(calls).toHaveLength(11);
  });
});

describe("TtlCache", () => {
  it("expires entries and keeps a fixed size, dropping the oldest", () => {
    let time = 0;
    const cache = new TtlCache<number>(2, () => time);
    cache.set("a", 1, 100);
    cache.set("b", 2, 100);
    expect(cache.get("a")).toBe(1); // a is now the most recent
    cache.set("c", 3, 100);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    time = 100;
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(1);
  });
});

describe("resolveBaseUrl", () => {
  const real = "https://musicbrainz.org/ws/2/";

  it("uses the real service when nothing is set", () => {
    expect(resolveBaseUrl(undefined, real)?.toString()).toBe(real);
    expect(resolveBaseUrl("  ", real)?.toString()).toBe(real);
  });

  it("accepts only plain HTTP on the loopback address as an override", () => {
    expect(resolveBaseUrl("http://127.0.0.1:9999/ws/2", real)?.toString()).toBe(
      "http://127.0.0.1:9999/ws/2/",
    );
    expect(resolveBaseUrl("http://localhost:1/x/", real)).not.toBeNull();
    for (const refused of [
      "https://example.com/ws/2/",
      "http://musicbrainz.org/ws/2/",
      "http://10.0.0.1/ws/2/",
      "http://169.254.169.254/latest/",
      "http://user:pass@127.0.0.1/ws/2/",
      "http://127.0.0.1/ws/2/?x=1",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expect(resolveBaseUrl(refused, real), refused).toBeNull();
    }
  });
});

describe("requestJson", () => {
  it("identifies itself and sends no credentials or referrer", async () => {
    const { runtime, calls } = virtualRuntime(() => json({ ok: true }));
    await expect(requestJson(baseRequest(runtime))).resolves.toEqual({
      ok: true,
    });
    const init = calls[0]!.init;
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(
      "Refrain/0.1.0 ( https://github.com/RaioViajante/refrain )",
    );
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.redirect).toBe("manual");
    expect(init.method).toBe("GET");
  });

  it("retries a 503 after Retry-After or the backoff, then succeeds", async () => {
    let count = 0;
    const { runtime, calls } = virtualRuntime(() =>
      ++count === 1
        ? json({ error: "busy" }, 503, { "retry-after": "3" })
        : json({ ok: true }),
    );
    await expect(requestJson(baseRequest(runtime))).resolves.toEqual({
      ok: true,
    });
    expect(calls.map((call) => call.time)).toEqual([0, 3000]);
  });

  it("gives up as unavailable after the retries, never past the deadline", async () => {
    const { runtime, calls } = virtualRuntime(() => json({}, 503));
    expect(await failureOf(requestJson(baseRequest(runtime)))).toBe(
      "unavailable",
    );
    // First attempt, then 1.5 s and 3 s of backoff: three calls in all.
    expect(calls.map((call) => call.time)).toEqual([0, 1500, 4500]);

    const tight = virtualRuntime(() => json({}, 503));
    expect(
      await failureOf(
        requestJson({ ...baseRequest(tight.runtime), deadlineMs: 9000 }),
      ),
    ).toBe("unavailable");
    expect(tight.calls).toHaveLength(1);
  });

  it("does not wait for a Retry-After it cannot honour in time", async () => {
    const { runtime, calls } = virtualRuntime(() =>
      json({}, 503, { "retry-after": "60" }),
    );
    expect(await failureOf(requestJson(baseRequest(runtime)))).toBe(
      "unavailable",
    );
    expect(calls).toHaveLength(1);
  });

  it("retries a network failure", async () => {
    let count = 0;
    const { runtime, calls } = virtualRuntime(() => {
      if (++count === 1) {
        throw new TypeError("fetch failed");
      }
      return json({ ok: true });
    });
    await expect(requestJson(baseRequest(runtime))).resolves.toEqual({
      ok: true,
    });
    expect(calls).toHaveLength(2);
  });

  it("answers not_found for 404 and 400 without retrying", async () => {
    for (const status of [404, 400]) {
      const { runtime, calls } = virtualRuntime(() => json({}, status));
      expect(await failureOf(requestJson(baseRequest(runtime)))).toBe(
        "not_found",
      );
      expect(calls).toHaveLength(1);
    }
  });

  it("does not retry other statuses", async () => {
    const { runtime, calls } = virtualRuntime(() => json({}, 500));
    expect(await failureOf(requestJson(baseRequest(runtime)))).toBe(
      "unavailable",
    );
    expect(calls).toHaveLength(1);
  });

  it("refuses a body over the size limit and one that is not JSON", async () => {
    const big = virtualRuntime(() => new Response("x".repeat(2048)));
    expect(await failureOf(requestJson(baseRequest(big.runtime)))).toBe(
      "invalid_response",
    );
    const declared = virtualRuntime(
      () => new Response("{}", { headers: { "content-length": "99999" } }),
    );
    expect(await failureOf(requestJson(baseRequest(declared.runtime)))).toBe(
      "invalid_response",
    );
    const html = virtualRuntime(() => new Response("<html>"));
    expect(await failureOf(requestJson(baseRequest(html.runtime)))).toBe(
      "invalid_response",
    );
  });

  it("follows a redirect only where it is allowed", async () => {
    const redirect = (location: string) =>
      new Response(null, { status: 307, headers: { location } });

    const none = virtualRuntime(() => redirect("https://archive.org/x"));
    expect(await failureOf(requestJson(baseRequest(none.runtime)))).toBe(
      "unavailable",
    );

    const allowed = virtualRuntime((url) =>
      url.startsWith("https://archive.org/")
        ? json({ ok: true })
        : redirect("https://archive.org/download/x/index.json"),
    );
    await expect(
      requestJson({
        ...baseRequest(allowed.runtime),
        maxRedirects: 2,
        allowRedirect: (target) => target.hostname === "archive.org",
      }),
    ).resolves.toEqual({ ok: true });

    for (const location of [
      "https://evil.example/index.json",
      "https://user:pw@archive.org/x",
      "http://archive.org/x",
    ]) {
      const refused = virtualRuntime(() => redirect(location));
      expect(
        await failureOf(
          requestJson({
            ...baseRequest(refused.runtime),
            maxRedirects: 2,
            allowRedirect: (target) =>
              target.protocol === "https:" && target.hostname === "archive.org",
          }),
        ),
        location,
      ).toBe("invalid_response");
    }

    const loop = virtualRuntime(() => redirect("https://archive.org/again"));
    expect(
      await failureOf(
        requestJson({
          ...baseRequest(loop.runtime),
          maxRedirects: 3,
          allowRedirect: () => true,
        }),
      ),
    ).toBe("unavailable");
    // A redirect loop is not retried: four hops, then it stops.
    expect(loop.calls).toHaveLength(4);
  });
});
