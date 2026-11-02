import "server-only";

import { z } from "zod";

import {
  createLimiter,
  ProviderError,
  requestJson,
  resolveBaseUrl,
  systemRuntime,
  TtlCache,
  type ProviderRuntime,
} from "@/integrations/provider";
import { USER_AGENT } from "@/integrations/musicbrainz";

import {
  COVER_ART_ARCHIVE_ORIGIN,
  IMAGE_ID_PATTERN,
  MBID_PATTERN,
} from "./artwork";

// Reads the Cover Art Archive's image listing for a release or a release
// group (https://musicbrainz.org/doc/Cover_Art_Archive/API). Server-only, used
// only in the Writing Studio, and only for an identifier the author chose.
// Nothing about the author's writing is sent: the request is a fixed path
// with an MBID. The listing is answered through redirects (checked live:
// coverartarchive.org → archive.org → a varying *.archive.org host), so
// redirects are followed only over HTTPS and only to those hosts. The
// archive states no rate limit; requests are still spaced a quarter of a
// second apart and cached for an hour (an empty listing for ten minutes).

const TIMEOUT_MS = 8_000;
const DEADLINE_MS = 15_000;
const RETRIES = 1;
const MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 4;
const LISTING_TTL_MS = 60 * 60 * 1000;
const EMPTY_TTL_MS = 10 * 60 * 1000;

const imageId = z
  .union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string()])
  .transform((value) => String(value))
  .pipe(z.string().regex(IMAGE_ID_PATTERN));

const listing = z.object({
  images: z
    .array(
      z.object({
        id: imageId,
        front: z.boolean().nullish(),
        back: z.boolean().nullish(),
        approved: z.boolean().nullish(),
        types: z.array(z.string().max(100)).max(20).nullish(),
        comment: z.string().max(1000).nullish(),
      }),
    )
    .max(500),
  // The release the images belong to, as a MusicBrainz URL.
  release: z.string().max(500),
});

/** One image in a listing. Nothing here is an address to load. */
export interface ArtworkImage {
  releaseId: string;
  imageId: string;
  front: boolean;
  back: boolean;
  approved: boolean;
  types: string[];
  comment: string;
}

export interface CoverArtArchiveClient {
  /** A release's images; empty when it has none. */
  listReleaseImages(releaseId: string): Promise<ArtworkImage[]>;
  /** The images of the release the archive uses for a release group. */
  listReleaseGroupImages(releaseGroupId: string): Promise<ArtworkImage[]>;
}

function releaseIdOf(releaseUrl: string): string | null {
  const match = /\/release\/([0-9a-f-]{36})\/?$/.exec(releaseUrl);
  return match && MBID_PATTERN.test(match[1]!) ? match[1]! : null;
}

export interface CoverArtArchiveOptions {
  baseUrl?: string;
  runtime?: ProviderRuntime;
  minIntervalMs?: number;
}

export function createCoverArtArchiveClient(
  options: CoverArtArchiveOptions = {},
): CoverArtArchiveClient {
  const runtime = options.runtime ?? systemRuntime;
  const base = resolveBaseUrl(options.baseUrl, `${COVER_ART_ARCHIVE_ORIGIN}/`);
  const limiter = createLimiter(options.minIntervalMs ?? 250, runtime);
  const cache = new TtlCache<ArtworkImage[]>(200, runtime.now);

  // HTTPS to the archive and the Internet Archive's hosts; for a loopback
  // mock (tests only), its own origin.
  function allowRedirect(target: URL): boolean {
    if (base && target.origin === base.origin) {
      return true;
    }
    return (
      target.protocol === "https:" &&
      (target.hostname === "coverartarchive.org" ||
        target.hostname === "archive.org" ||
        target.hostname.endsWith(".archive.org"))
    );
  }

  async function list(kind: "release" | "release-group", id: string) {
    if (!base) {
      throw new ProviderError("cover_art_archive", "not_configured");
    }
    const normalized = id.trim().toLowerCase();
    if (!MBID_PATTERN.test(normalized)) {
      throw new ProviderError("cover_art_archive", "not_found");
    }
    const url = new URL(`${kind}/${normalized}`, base);
    const key = url.toString();
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }
    let body: unknown;
    try {
      body = await requestJson({
        provider: "cover_art_archive",
        url,
        userAgent: USER_AGENT,
        runtime,
        limiter,
        timeoutMs: TIMEOUT_MS,
        deadlineMs: DEADLINE_MS,
        retries: RETRIES,
        maxBytes: MAX_BYTES,
        allowRedirect,
        maxRedirects: MAX_REDIRECTS,
      });
    } catch (error) {
      // No artwork is an answer, not a failure.
      if (error instanceof ProviderError && error.failure === "not_found") {
        cache.set(key, [], EMPTY_TTL_MS);
        return [];
      }
      throw error;
    }
    const parsed = listing.safeParse(body);
    if (!parsed.success) {
      throw new ProviderError("cover_art_archive", "invalid_response");
    }
    const releaseId = releaseIdOf(parsed.data.release);
    if (!releaseId || (kind === "release" && releaseId !== normalized)) {
      throw new ProviderError("cover_art_archive", "invalid_response");
    }
    const images = parsed.data.images.map((image) => ({
      releaseId,
      imageId: image.id,
      front: image.front ?? false,
      back: image.back ?? false,
      approved: image.approved ?? false,
      types: image.types ?? [],
      comment: image.comment ?? "",
    }));
    cache.set(key, images, LISTING_TTL_MS);
    return images;
  }

  return {
    listReleaseImages: (releaseId) => list("release", releaseId),
    listReleaseGroupImages: (releaseGroupId) =>
      list("release-group", releaseGroupId),
  };
}

let shared: CoverArtArchiveClient | undefined;

/**
 * The process-wide client. `REFRAIN_COVER_ART_ARCHIVE_BASE_URL` may only point
 * at a loopback mock (the tests); pages always load images from the real
 * archive's address, built by `coverArtworkOf`.
 */
export function coverArtArchive(): CoverArtArchiveClient {
  shared ??= createCoverArtArchiveClient({
    baseUrl: process.env.REFRAIN_COVER_ART_ARCHIVE_BASE_URL,
  });
  return shared;
}
