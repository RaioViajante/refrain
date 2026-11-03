// The Content-Security-Policies. No page may be framed, and an image may come
// only from this application, an inline `data:` or `blob:` URL (the
// hand-drawn strokes are inline SVG), or an allow-listed provider host.
//
// - Public pages, the sitemap, and robots.txt: the Cover Art Archive and the
//   Internet Archive hosts it redirects to (checked live,
//   docs/evidence/m3-2.md). A cover address that somehow named any other
//   host would not load at all: this is the browser's half of the rule that
//   `coverArtworkOf` applies on the server
//   (src/integrations/cover-art-archive/artwork.ts).
// - The studio and the authentication endpoints: the same, plus Wikimedia
//   Commons' thumbnail host, for artist photographs (M3.3)
//   (src/integrations/wikimedia-commons/photo.ts).
// - The public artist pages, `/artists/*` (M3.5): the public policy plus
//   exactly that thumbnail host, because they show the artist's photograph.
//   Every other public page keeps the public policy, without it.
//
// next.config.ts cannot import application modules, so it repeats these
// values; src/security-headers.test.ts keeps the copies equal.
export const CONTENT_SECURITY_POLICY =
  "frame-ancestors 'none'; img-src 'self' data: blob: https://coverartarchive.org https://archive.org https://*.archive.org";

export const STUDIO_CONTENT_SECURITY_POLICY =
  "frame-ancestors 'none'; img-src 'self' data: blob: https://coverartarchive.org https://archive.org https://*.archive.org https://thumb.wikimedia.org";

export const ARTIST_CONTENT_SECURITY_POLICY =
  "frame-ancestors 'none'; img-src 'self' data: blob: https://coverartarchive.org https://archive.org https://*.archive.org https://thumb.wikimedia.org";
