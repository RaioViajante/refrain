import { NextResponse, type NextRequest } from "next/server";

import {
  routeAlbumJournalRequest,
  routePublicDocumentRequest,
} from "@/modules/publication/public";

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
  // One segment: `/albums/<slug>`. Anything deeper has no page and gets the
  // framework's own `404`, which does not depend on any journal's state.
  matcher: ["/albums/:slug", "/sitemap.xml", "/robots.txt"],
};

// A path that no route serves, so that rewriting to it renders the application's
// not-found view with a real `404` status. It is the same response for every
// address that is not served, and it is what the switch being off answers.
const UNKNOWN_ADDRESS = "/__refrain-unknown-address";

const NO_STORE = "no-store";

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
  const pathname = request.nextUrl.pathname;
  // The sitemap and robots.txt: the switch and the method only. Their routes
  // read the publication queries themselves.
  const decision =
    pathname === "/sitemap.xml" || pathname === "/robots.txt"
      ? routePublicDocumentRequest({ method: request.method })
      : await routeAlbumJournalRequest({
          method: request.method,
          slug: slugOf(pathname),
        });

  switch (decision.action) {
    case "serve":
      return NextResponse.next();
    case "redirect":
      // The framework's adapter needs an absolute URL to build this response,
      // and sends it back as a path when it is the same origin. The `Location`
      // that a client receives is `/albums/<slug>`; a test sends a spoofed
      // `Host` and `X-Forwarded-Host` to prove that no host is reflected.
      return NextResponse.redirect(
        new URL(`/albums/${decision.currentSlug}`, request.url),
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
      return NextResponse.rewrite(new URL(UNKNOWN_ADDRESS, request.url));
  }
}
