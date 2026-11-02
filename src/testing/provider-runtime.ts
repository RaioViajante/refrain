import { createCoverArtArchiveClient } from "@/integrations/cover-art-archive";
import { createMusicBrainzClient } from "@/integrations/musicbrainz";
import type { ProviderRuntime } from "@/integrations/provider";

import { providerResponse } from "./provider-mock";

// A virtual clock: `sleep` advances time at once, so spacing, backoff, and
// deadlines are exact and the tests take no real time.
export function virtualRuntime(
  respond: (
    url: string,
    init: RequestInit,
    time: number,
  ) => Response | Promise<Response>,
) {
  let time = 0;
  const calls: { url: string; init: RequestInit; time: number }[] = [];
  const runtime: ProviderRuntime = {
    now: () => time,
    sleep: async (milliseconds) => {
      time += milliseconds;
    },
    fetch: async (url, init) => {
      calls.push({ url, init, time });
      return respond(url, init, time);
    },
  };
  return { runtime, calls, advance: (ms: number) => (time += ms) };
}

export const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

/**
 * The real adapters, answering from the fixtures with no network and no
 * waiting: what the integration tests give the catalog's commands.
 */
export function fixtureProviders(
  respond: (url: string) => Response = (url) => providerResponse(url),
) {
  const fake = virtualRuntime((url) => respond(url));
  return {
    calls: fake.calls,
    providers: {
      musicBrainz: createMusicBrainzClient({
        baseUrl: "http://127.0.0.1:1/ws/2/",
        runtime: fake.runtime,
        minIntervalMs: 0,
      }),
      coverArt: createCoverArtArchiveClient({
        baseUrl: "http://127.0.0.1:1/caa/",
        runtime: fake.runtime,
        minIntervalMs: 0,
      }),
    },
  };
}
