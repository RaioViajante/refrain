import "server-only";

// Shared plumbing for the external providers (MusicBrainz and the Cover Art
// Archive). Everything a provider sends is untrusted: a response is read with
// a size limit, parsed as JSON, and validated by the adapter with Zod before
// anything uses it. Nothing here touches the database, and nothing here ever
// sends the author's writing anywhere: a request carries only a provider
// identifier or the words typed into the Add music search.
//
// docs/architecture.md § External providers; docs/security.md § External
// providers.

export type ProviderName = "musicbrainz" | "cover_art_archive";

/**
 * Why a provider call did not produce data. A fixed code: never the provider's
 * message, the URL, or the response body.
 *
 * - `unavailable`: unreachable, too slow, rate limited past the retries, or an
 *   unexpected status. The catalog and the writing keep working.
 * - `not_found`: the provider has no such record (or refused the identifier).
 * - `invalid_response`: the response was not what the documented contract
 *   says, so nothing from it is used.
 * - `not_configured`: the server's provider setting is not an allowed value.
 */
export type ProviderFailure =
  "unavailable" | "not_found" | "invalid_response" | "not_configured";

export class ProviderError extends Error {
  override name = "ProviderError";

  constructor(
    readonly provider: ProviderName,
    readonly failure: ProviderFailure,
  ) {
    super(`Provider ${provider}: ${failure}`);
  }
}

/** The parts of the platform a provider client uses, so tests can fake them. */
export interface ProviderRuntime {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Milliseconds, monotonic enough for spacing requests. */
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}

export const systemRuntime: ProviderRuntime = {
  fetch: (url, init) => fetch(url, init),
  now: () => performance.now(),
  sleep: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

/**
 * Spaces the start of each request at least `minIntervalMs` after the start
 * of the previous one, for the whole process: requests wait in order instead
 * of running together. MusicBrainz asks for no more than one call per second
 * per application (https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).
 * One server process has one limiter; several processes would each have
 * their own, which is why nothing is deployed with more than one.
 */
export function createLimiter(
  minIntervalMs: number,
  runtime: Pick<ProviderRuntime, "now" | "sleep">,
) {
  let nextStart = Number.NEGATIVE_INFINITY;
  let queue: Promise<unknown> = Promise.resolve();

  return function schedule<Result>(work: () => Promise<Result>) {
    const slot = queue.then(async () => {
      const wait = nextStart - runtime.now();
      if (wait > 0) {
        await runtime.sleep(wait);
      }
      nextStart = runtime.now() + minIntervalMs;
    });
    // The next request waits for this one's slot, not for its response.
    queue = slot.catch(() => undefined);
    return slot.then(work);
  };
}

export type Limiter = ReturnType<typeof createLimiter>;

/**
 * A small in-memory cache with a time to live and a fixed size (the oldest
 * entry is dropped first). It holds validated provider data only, never
 * anything of the author's, and lives as long as the server process.
 */
export class TtlCache<Value> {
  private readonly entries = new Map<
    string,
    { value: Value; expires: number }
  >();

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number,
  ) {}

  get(key: string): Value | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expires <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Most recently used last.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: Value, ttlMs: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The provider's base URL. Unset means the real service (`fallback`). The
 * setting exists so the tests can point the server at a local mock, so the
 * only other value accepted is plain HTTP on this machine's loopback address;
 * anything else (another host, credentials, a query) is refused, and the
 * provider then reports `not_configured` instead of being called.
 */
export function resolveBaseUrl(
  configured: string | undefined,
  fallback: string,
): URL | null {
  const value = configured?.trim() ? configured.trim() : fallback;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) {
    return null;
  }
  const isFallback = value === fallback;
  const isLoopback =
    url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (!isFallback && !isLoopback) {
    return null;
  }
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

export interface JsonRequest {
  provider: ProviderName;
  url: URL;
  userAgent: string;
  runtime: ProviderRuntime;
  /** Spaces the first request of each attempt; redirects are not counted. */
  limiter: Limiter;
  /** Per attempt, including redirects. */
  timeoutMs: number;
  /** Total time, including waits between attempts. */
  deadlineMs: number;
  /** Further attempts after the first, on 503, 429, 502, 504, or a network error. */
  retries: number;
  /** Largest response body accepted, in bytes. */
  maxBytes: number;
  /** Whether a redirect may be followed to this URL (never by default). */
  allowRedirect?: (target: URL) => boolean;
  maxRedirects?: number;
}

const RETRYABLE = new Set([429, 502, 503, 504]);

/** Seconds from a `Retry-After` header (delta-seconds form only). */
function retryAfterMs(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value || !/^\d{1,4}$/.test(value.trim())) {
    return null;
  }
  return Number(value.trim()) * 1000;
}

/**
 * GETs JSON from a provider. It sends no cookie, no referrer, and no
 * credentials, follows a redirect only to an allowed URL, times out each
 * attempt, retries only transient failures (honouring `Retry-After`), and
 * never waits past the deadline. The body is returned as `unknown`; the
 * adapter validates it.
 */
export async function requestJson(request: JsonRequest): Promise<unknown> {
  const { runtime, provider } = request;
  const started = runtime.now();
  let attempt = 0;

  for (;;) {
    let retryAfter: number | null = null;
    try {
      const response = await request.limiter(() => fetchFollowing(request));
      if (response.status === 200) {
        return await readJson(response, request);
      }
      // MusicBrainz answers 400 for an identifier it cannot parse and the
      // Cover Art Archive 400 for an invalid MBID: no such record either way.
      if (response.status === 404 || response.status === 400) {
        await discard(response);
        throw new ProviderError(provider, "not_found");
      }
      if (!RETRYABLE.has(response.status)) {
        await discard(response);
        throw new ProviderError(provider, "unavailable");
      }
      retryAfter = retryAfterMs(response);
      await discard(response);
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      // A network failure or a timeout: transient, retried below.
    }

    attempt += 1;
    if (attempt > request.retries) {
      throw new ProviderError(provider, "unavailable");
    }
    const backoff = Math.max(retryAfter ?? 0, 1500 * 2 ** (attempt - 1));
    const remaining = request.deadlineMs - (runtime.now() - started);
    if (backoff + request.timeoutMs > remaining) {
      throw new ProviderError(provider, "unavailable");
    }
    await runtime.sleep(backoff);
  }
}

async function fetchFollowing(request: JsonRequest): Promise<Response> {
  const signal = AbortSignal.timeout(request.timeoutMs);
  let url = request.url;
  for (let hop = 0; ; hop += 1) {
    const response = await request.runtime.fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": request.userAgent,
      },
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal,
    });
    if (response.status < 300 || response.status >= 400) {
      return response;
    }
    const location = response.headers.get("location");
    await discard(response);
    if (!location || hop >= (request.maxRedirects ?? 0)) {
      throw new ProviderError(request.provider, "unavailable");
    }
    let target: URL;
    try {
      target = new URL(location, url);
    } catch {
      throw new ProviderError(request.provider, "invalid_response");
    }
    if (
      target.username ||
      target.password ||
      !request.allowRedirect?.(target)
    ) {
      throw new ProviderError(request.provider, "invalid_response");
    }
    url = target;
  }
}

async function readJson(
  response: Response,
  request: JsonRequest,
): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > request.maxBytes) {
    await discard(response);
    throw new ProviderError(request.provider, "invalid_response");
  }
  if (!response.body) {
    throw new ProviderError(request.provider, "invalid_response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > request.maxBytes) {
      await reader.cancel();
      throw new ProviderError(request.provider, "invalid_response");
    }
    chunks.push(value);
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(
    Buffer.concat(chunks),
  );
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError(request.provider, "invalid_response");
  }
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing to release.
  }
}
