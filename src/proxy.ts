import { NextResponse, type NextRequest } from "next/server";

import {
  routeAlbumJournalRequest,
  routeArtistRequest,
  routeMemoryRequest,
  routePublicArchiveRequest,
  routePublicDocumentRequest,
} from "@/modules/publication/public";

import { normalizedAddress } from "./address-normalization";
import {
  ARTIST_CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY,
} from "./security-headers";

// The status line of a public address (ADR 0006 § 11, gate G1).
//
// Under Cache Components a page answers `200` and streams a redirect or a
// not-found view afterwards, so a page cannot send a real `404` or `308`
// after it has started. The proxy runs before any page is rendered and sends
// the real status. The M3.1 spike verified this on the production build
// (docs/evidence/m3-1.md); it is the approach the framework documents for a
// `404` that must be a status code.
//
// This file only maps a decision to a response. The decision, including the
// public-reads switch, is `routeAlbumJournalRequest` (Publication), which asks
// the publication queries. Every response here is `no-store`, because a
// cached `308` would keep naming the address of a journal that has since been
// unpublished, and a cached `404` would hide a newly published one. The `308`,
// `405`, and `503` set it themselves; the page and the not-found view are the
// framework's responses, so `next.config.ts` sets it for them too, and the
// HTTP tests assert it for every request form.

export const config = {
  matcher: [
    // One segment: `/albums/<slug>`. Anything deeper has no page and gets the
    // framework's own `404`, which does not depend on any journal's state.
    "/albums/:slug",
    // The same for an artist: `/artists/<address>` (M3.5).
    "/artists/:slug",
    // And for a memory: `/memories/<slug>` (M3.7).
    "/memories/:slug",
    // The archives (M3.8a): exactly `/albums`, `/artists`, and `/memories`.
    // The framework extends each to its transport forms, measured on the
    // production build: `.rsc`, `.json`, `/_next/data/…json`, the router's
    // `_rsc` requests, and the segment files of a one-segment route, which sit
    // beside it (`/albums.segments/…`), not under it. The HTTP tests hold
    // every one of those forms to the unknown address's answer while the
    // switch is off (src/testing/public-archives.http.test.ts).
    "/albums",
    "/artists",
    "/memories",
    "/sitemap.xml",
    "/robots.txt",
    // Every address that ends in a slash, anywhere on the site, except `/`:
    // the framework would answer it with a `308` that cannot carry
    // `no-store` (`skipTrailingSlashRedirect` in next.config.ts hands it to
    // this proxy). The answer is the same `308` to the same address, now
    // `no-store`. (A repeated slash cannot be handled here: the framework
    // answers it before any proxy or header rule runs. docs/evidence/m3-1.md.)
    "/:path+/",
  ],
};

// A path that no route serves, so that rewriting to it renders the application's
// not-found view with a real `404` status. It is the same response for every
// address that is not served, and it is what the switch being off answers.
const UNKNOWN_ADDRESS = "/__refrain-unknown-address";

const NO_STORE = "no-store";

// The same values as `publicHeaders` in next.config.ts, without
// `Cache-Control`, which the not-found view sets itself (`no-store`).
const PUBLIC_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
} as const;

// The artist pages' (M3.5): the same, with their image policy, which adds
// Wikimedia's thumbnail host. Every response under `/artists/` carries it,
// a page and the unknown-address `404` alike, so the two cannot be told apart.
const ARTIST_SECURITY_HEADERS = {
  ...PUBLIC_SECURITY_HEADERS,
  "Content-Security-Policy": ARTIST_CONTENT_SECURITY_POLICY,
} as const;

// What the public matchers above can let through, in any of the framework's
// transport forms: an album, artist, or memory address, an archive, the
// sitemap, `robots.txt`.
const PUBLIC_ADDRESS =
  /^(?:\/_next\/data\/[^/]+)?\/(?:(?:albums|artists|memories)(?:[/.]|$)|sitemap\.xml|robots\.txt)/;
const ARTIST_ADDRESS = /^(?:\/_next\/data\/[^/]+)?\/artists(?:[/.]|$)/;
const MEMORY_ADDRESS = /^(?:\/_next\/data\/[^/]+)?\/memories(?:[/.]|$)/;
// An archive (M3.8a), in any transport form: `/albums`, `/albums.rsc`,
// `/albums.segments/…`, `/_next/data/<build>/albums.json`. Not an address
// inside the section: `/albums/<slug>` has a slash after the section's name.
const ARCHIVE_ADDRESS =
  /^(?:\/_next\/data\/[^/]+)?\/(?:albums|artists|memories)(?:\.[^/]*(?:\/.*)?)?$/;

/** The path percent-decoded, or "" when it cannot be decoded. */
function decodedOrEmpty(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return "";
  }
}

function slugOf(pathname: string): string {
  const segment = pathname.slice(pathname.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(segment);
  } catch {
    // A malformed escape is not a slug, and is answered as an unknown one.
    return "";
  }
}

export async function proxy(request: NextRequest) {
  // The address normalizations come first, before any public decision, and
  // for every address alike: they depend on the characters of the address
  // and on nothing else (src/address-normalization.ts).
  const target = new URL(request.url);
  const normal = normalizedAddress(`${target.pathname}${target.search}`);
  if (normal !== null) {
    return NextResponse.redirect(new URL(normal, request.url), {
      status: 308,
      headers: { "Cache-Control": NO_STORE },
    });
  }

  const pathname = request.nextUrl.pathname;
  // The trailing-slash matcher also lets through a few addresses that are not
  // public (a transport suffix after a slash, for example). Those go back to
  // the framework. The framework matches the proxy against the decoded path
  // as well as the raw one, so a percent-encoded public address
  // (`/%73itemap.xml`, `/%61lbums/<slug>`) reaches the proxy too: it is checked
  // in both forms, and it gets a public decision, exactly as it did before the
  // trailing-slash matcher existed.
  if (
    !PUBLIC_ADDRESS.test(pathname) &&
    !PUBLIC_ADDRESS.test(decodedOrEmpty(pathname))
  ) {
    return NextResponse.next();
  }
  // The sitemap and robots.txt: the switch and the method only. Their routes
  // read the publication queries themselves.
  const isArtist =
    ARTIST_ADDRESS.test(pathname) ||
    ARTIST_ADDRESS.test(decodedOrEmpty(pathname));
  const isMemory =
    MEMORY_ADDRESS.test(pathname) ||
    MEMORY_ADDRESS.test(decodedOrEmpty(pathname));
  const isArchive =
    ARCHIVE_ADDRESS.test(pathname) ||
    ARCHIVE_ADDRESS.test(decodedOrEmpty(pathname));
  const decision =
    pathname === "/sitemap.xml" || pathname === "/robots.txt"
      ? routePublicDocumentRequest({ method: request.method })
      : isArchive
        ? // An archive is served only at its own spelling. A percent-encoded
          // one (`/%61lbums`) matches no route, so the framework would answer
          // it with its static, cacheable `404`; it gets the unknown
          // address's `no-store` answer instead, the same with the switch on
          // or off (M3.8a).
          ARCHIVE_ADDRESS.test(pathname)
          ? routePublicArchiveRequest({ method: request.method })
          : ({ action: "not_found" } as const)
        : isArtist
          ? await routeArtistRequest({
              method: request.method,
              slug: slugOf(pathname),
            })
          : isMemory
            ? await routeMemoryRequest({
                method: request.method,
                slug: slugOf(pathname),
              })
            : await routeAlbumJournalRequest({
                method: request.method,
                slug: slugOf(pathname),
              });

  switch (decision.action) {
    case "serve":
      return NextResponse.next();
    case "redirect":
      // Only the previous address of an album journal or a memory redirects,
      // to the current address in the same section; an artist's or an
      // archive's decision is never a redirect.
      // The framework's adapter needs an absolute URL to build this response,
      // and sends it back as a path when it is the same origin. The `Location`
      // that a client receives is `/albums/<slug>` or `/memories/<slug>`; a
      // test sends a spoofed `Host` and `X-Forwarded-Host` to prove that no
      // host is reflected.
      return NextResponse.redirect(
        new URL(
          `/${isMemory ? "memories" : "albums"}/${decision.currentSlug}`,
          request.url,
        ),
        { status: 308, headers: { "Cache-Control": NO_STORE } },
      );
    case "method_not_allowed":
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, HEAD", "Cache-Control": NO_STORE },
      });
    case "unavailable":
      return new Response("Service unavailable", {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": NO_STORE,
        },
      });
    case "not_found":
      // The security headers of the public addresses are set here as well as
      // in next.config.ts, whose rules match the raw path only: a
      // percent-encoded public address (`/%73itemap.xml`) reaches this proxy
      // but not those rules, and must answer exactly as an unknown one does.
      return NextResponse.rewrite(new URL(UNKNOWN_ADDRESS, request.url), {
        headers: isArtist ? ARTIST_SECURITY_HEADERS : PUBLIC_SECURITY_HEADERS,
      });
  }
}
