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
    // The Portuguese forms (ADR 0008; ADR 0006 A7, item 2): the same
    // sections and archives under the literal prefix, and the Portuguese
    // Home, so that an encoded spelling of the prefix (`/%70t`, which the
    // framework also matches decoded) reaches this proxy and is refused.
    "/pt",
    "/pt/albums/:slug",
    "/pt/artists/:slug",
    "/pt/memories/:slug",
    "/pt/albums",
    "/pt/artists",
    "/pt/memories",
    // The Portuguese Studio (PR 3), only so that an encoded spelling of the
    // prefix (`/%70t/studio`, which the framework matches decoded) reaches
    // this proxy and gets the unknown address's answer, as before the
    // Portuguese Studio existed. A literal `/pt/studio…` address is no public
    // address once the prefix is taken away, so it goes back to the framework
    // untouched, and its pages authorize themselves.
    "/pt/studio",
    "/pt/studio/:path*",
    // The English Studio, for the same reason: an encoded spelling of its
    // name (`/%73tudio`, `/st%75dio/journals`, `/studio%2Fjournals`), which the
    // framework matches decoded, reaches this proxy and gets the unknown
    // address's answer. Without it the framework's router found the Studio's
    // output by the decoded path, its renderer matched no route by the raw
    // one, and the fallback `404` was the prerendered not-found page from the
    // build's cache, with `s-maxage=31536000` and no Studio header (the
    // `next.config.ts` rules match the raw path only). A literal `/studio…`
    // address goes back to the framework untouched, and its pages authorize
    // themselves.
    "/studio",
    "/studio/:path*",
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

// The Studio's (next.config.ts, `privateHeaders`), without `Cache-Control`,
// which the not-found view sets itself (`private`, `no-store`). An encoded
// spelling of the Studio's name, or of the Portuguese Studio's prefix, gets
// these, the headers of the section it names (ADR 0006 A7, item 2), with the
// public pages' stricter image policy: the not-found view shows no
// photograph, and Wikimedia's host stays out of every answer this proxy gives
// (src/security-headers.test.ts).
const STUDIO_SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
} as const;

// What the public matchers above can let through, in any of the framework's
// transport forms: an album, artist, or memory address, an archive, the
// sitemap, `robots.txt`.
const PUBLIC_ADDRESS =
  /^(?:\/_next\/data\/[^/]+)?\/(?:(?:albums|artists|memories)(?:[/.]|$)|sitemap\.xml|robots\.txt)/;
const ARTIST_ADDRESS = /^(?:\/_next\/data\/[^/]+)?\/artists(?:[/.]|$)/;
const MEMORY_ADDRESS = /^(?:\/_next\/data\/[^/]+)?\/memories(?:[/.]|$)/;
const STUDIO_ADDRESS = /^(?:\/_next\/data\/[^/]+)?\/studio(?:[/.]|$)/;
// An archive (M3.8a), in any transport form: `/albums`, `/albums.rsc`,
// `/albums.segments/…`, `/_next/data/<build>/albums.json`. Not an address
// inside the section: `/albums/<slug>` has a slash after the section's name.
const ARCHIVE_ADDRESS =
  /^(?:\/_next\/data\/[^/]+)?\/(?:albums|artists|memories)(?:\.[^/]*(?:\/.*)?)?$/;

// The literal Portuguese prefix, in every transport form: `/pt`, `/pt.rsc`,
// `/pt.segments/…`, `/pt/<section>…`, `/_next/data/<build>/pt…`. Only the
// literal spelling is the prefix; a spelling that is only `/pt` once decoded
// is an encoded prefix, which no route serves (ADR 0006 A7, item 2).
const PORTUGUESE_PREFIX = /^((?:\/_next\/data\/[^/]+)?)\/pt(?=[/.]|$)/;

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
  // An encoded spelling of the Portuguese prefix (`/%70t/...`) is no address
  // at all: the unknown address's answer, with the headers of the section it
  // names, and never a redirect, not even the trailing slash's (ADR 0006 A7,
  // item 2). It depends on the characters of the address and nothing else.
  const requested = request.nextUrl.pathname;
  const literalPrefix = PORTUGUESE_PREFIX.test(requested);
  if (!literalPrefix && PORTUGUESE_PREFIX.test(decodedOrEmpty(requested))) {
    const decoded = decodedOrEmpty(requested).replace(PORTUGUESE_PREFIX, "$1");
    return NextResponse.rewrite(new URL(UNKNOWN_ADDRESS, request.url), {
      headers: STUDIO_ADDRESS.test(decoded)
        ? STUDIO_SECURITY_HEADERS
        : ARTIST_ADDRESS.test(decoded)
          ? ARTIST_SECURITY_HEADERS
          : PUBLIC_SECURITY_HEADERS,
    });
  }

  // An encoded spelling of the Studio's own name, in either tree
  // (`/%73tudio…`, `/pt/st%75dio…`, `/studio%2Fjournals`): the address is a
  // Studio address only once decoded, so no Studio page serves it and no
  // Studio header rule matches it. It is the unknown address, with the
  // Studio's headers, and never a redirect, not even the trailing slash's, as
  // for the encoded Portuguese prefix above. A literal `/studio…` address,
  // including one with an encoded character after the name
  // (`/studio/%6aournals`), is not this case: the framework and its header
  // rules handle it as before. Neither the session nor any record is read.
  const unprefixed = literalPrefix
    ? requested.replace(PORTUGUESE_PREFIX, "$1")
    : requested;
  if (
    !STUDIO_ADDRESS.test(unprefixed) &&
    STUDIO_ADDRESS.test(decodedOrEmpty(unprefixed))
  ) {
    return NextResponse.rewrite(new URL(UNKNOWN_ADDRESS, request.url), {
      headers: STUDIO_SECURITY_HEADERS,
    });
  }

  // The address normalizations come next, before any public decision, and
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

  // Under the literal prefix, the same decision as the English address: the
  // language is never an input to it (A7, item 1); only a redirect's target
  // keeps the prefix (item 3). The Portuguese Home and its build files
  // (`/pt`, `/pt.rsc`, `/pt.segments/…`) are no public address once the
  // prefix is taken away, so they go back to the framework below, as the
  // English Home does. The sitemap and robots.txt have no `/pt` form: no
  // matcher above sends one here.
  const pathname = unprefixed;
  const prefix = literalPrefix ? "/pt" : "";
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
          `${prefix}/${isMemory ? "memories" : "albums"}/${decision.currentSlug}`,
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
