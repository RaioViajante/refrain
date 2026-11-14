// The initial indexing policy: no page of this application is indexed, and
// no link on it is followed (docs/security.md#indexing). It is the owner's
// decision for the first opening of the hosted site, approved on 2026-11-13.
//
// - One constant, the same on every response the application controls: a
//   public page, a not-found answer for any reason, a redirect, a refusal, the
//   Studio, the authentication endpoints, and the static files. A value that
//   varied would itself say something about an address, so it depends on
//   nothing: not the database, a session, the language, a request, or an
//   environment variable.
// - Not a switch. Removing it is a reviewed code change that the owner
//   authorizes explicitly, with the conditions listed in Security.
// - Never an access control: what is private stays private because of the
//   publication predicate and the Studio's authorization, never because of
//   this header.
//
// next.config.ts cannot import application modules, and the root layouts and
// the not-found metadata may import none (src/app/public-surface.test.ts), so
// they repeat this value; src/indexing-policy.test.ts keeps the copies equal.
export const ROBOTS_DIRECTIVE = "noindex, nofollow";

export const ROBOTS_HEADER = "X-Robots-Tag";
