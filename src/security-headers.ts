// The Content-Security-Policy sent with the studio, the authentication
// endpoints, and the public pages. No page may be framed, and an image may
// come only from this application, an inline `data:` or `blob:` URL (the
// hand-drawn strokes are inline SVG), or the Cover Art Archive and the
// Internet Archive hosts it redirects to (checked live, docs/evidence/m3-2.md).
// A cover address that somehow named any other host would not load at all:
// this is the browser's half of the rule that `coverArtworkOf` applies on the
// server (src/integrations/cover-art-archive/artwork.ts).
//
// next.config.ts cannot import application modules, so it repeats this value;
// src/security-headers.test.ts keeps the copies equal.
export const CONTENT_SECURITY_POLICY =
  "frame-ancestors 'none'; img-src 'self' data: blob: https://coverartarchive.org https://archive.org https://*.archive.org";
