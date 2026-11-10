# ADR 0008: Interface Localization (English and Brazilian Portuguese)

- **Status:** **Accepted** by the owner on 2026-11-10. **Approved, not implemented:** on `main` the interface is English only, and none of the routes, dictionaries, selector, or metadata below exist yet. The work is sequenced in [Roadmap § Interface localization](../roadmap.md#interface-localization-approved-not-implemented).
- **Date:** 2026-11-10.
- **Scope:** How the public pages and the Writing Studio are offered in English and Brazilian Portuguese: routes, dictionaries, formats, the language switch, alternates, the not-found view, and the trust limits of all of these. It replaces `next-intl` as the planned localization technology ([`AGENTS.md` § 3](../../AGENTS.md#3-architecture-constraints) lets a planned technology be replaced only through an ADR). [ADR 0006 amendment A7](0006-publication-decision-and-acknowledgement.md#a7-the-pt-surfaces) binds the `/pt` surfaces to the publication rules.

## Context

ADR 0002 already separates the interface language from the language of the writing (D3.3), and carries the language in the URL's locale segment with one slug for all languages (D7.1). Three facts of the application decide how that can be built:

- **`<html lang>` is fixed in one root layout.** Under Cache Components (`cacheComponents: true`) a root layout cannot read `headers()` or cookies outside a Suspense boundary, and `<html>` cannot sit inside one.
- **The status of a public address is decided in `src/proxy.ts`** before a page renders (ADR 0006 § 11). The proxy, the header rules of `next.config.ts`, and the HTTP tests know only unprefixed paths, including the transport forms (`.rsc`, `.segments`, `/_next/data`).
- **The size of the interface.** At the time of this decision: 34 pages (7 public, 27 Studio), 30 Client Component files (1 public), about 800 interface strings by an approximate syntax-tree count (about 74 public, 720 Studio), and about 122 absolute links and redirects. The approved V4.4 screens include 233 Brazilian Portuguese strings, which are the glossary.

### Alternatives considered

| Option | For | Against | Outcome |
| --- | --- | --- | --- |
| **Two root layouts with literal folders**: `(en)` and `pt` | Every English URL keeps its route with no new layer; `lang` is a literal in each root; no alias of any route can exist | About 34 thin Portuguese route files; every route must be mirrored | **Chosen** |
| A top-level `[locale]` segment, with the proxy rewriting English paths | One route tree | Every English request gains a rewrite, in every transport form; `/en/studio` becomes an alias that the `/studio/:path*` header rules do not match and that must be blocked separately | Rejected. Not prototyped: judged on the documentation and on the existing proxy |
| One root layout reading a header or a cookie | No route changes | Forces every route to block, removes the Studio's prerendered shell and static not-found view, and makes language a request input | Rejected; a `headers()` call in `global-not-found` failed the build in the prototype |
| `next-intl` 4.14.9 (its peer range includes Next.js 16) | Mature API, plurals, formats | Its routing is built on a top-level `[locale]` segment; of the pages read, only a blog post mentions `cacheComponents`; `next/root-params` is unavailable in Server Actions and Route Handlers; its provider sends every message to the client by default; a new dependency six days before the presentation | Rejected for now. Only its documentation was read; it was not prototyped |
| Studio at `/studio` with a language cookie | No new private routes | The page's `<html lang>` would stay wrong in Portuguese, the static shell could not be localized, and language would be a second, invisible state | Rejected |

### What was measured

A throwaway prototype outside this repository, on 2026-11-10, with Next.js 16.4.3, React 19.3.1, `cacheComponents`, `partialPrefetching`, `skipTrailingSlashRedirect`, and `experimental.globalNotFound`. It is evidence for the shape of the decision, not for the application: it did not use Refrain's proxy, pages, or tests.

| Question | Result |
| --- | --- |
| Do two root layouts build under Cache Components, with one-pass pages and a Studio page with a prerendered shell in each? | Yes |
| Is `<html lang>` correct in each root? | Yes: `en` and `pt-BR`, including the streamed Studio page |
| Do `/pt/studio` header rules work? | Yes: `private, no-store` on `/pt/studio` and `/pt/studio/sign-in` |
| Do `/en`, `/en/albums/x`, and `/pt-BR` exist? | No: each answers the `404` |
| Does a shared `global-not-found` give a real status? | Yes: `404`, with a body identical for `/nope`, `/albums/missing`, `/pt/nope`, and `/pt/albums/missing`, and `no-store` |
| Can Portuguese have its own not-found view with a real status? | **Not found.** A proxy rewrite with `status: 404` answered `500`; `notFound()` in a catch-all answered `404` with a script-only body and no `lang`; `notFound()` on a literal prerendered route answered `404` with a script-only body and `s-maxage=31536000` |

## Decision

### 1. Terms

These are four different things, and no code or document may use one for another.

| Term | Values | Decided by | Effect |
| --- | --- | --- | --- |
| **Interface language** | `en`, `pt-BR` | The URL alone | Labels, navigation, dates, numbers, the page frame's metadata. Never decides what is visible |
| **Original language of an entry** | `en`, `pt-BR` (`entry_texts.is_original`) | The author, when writing | Which version is the original. Nothing is converted |
| **Authored version** | A row of `entry_texts`, with its own status | The author | Each is published independently (ADR 0002, D3.2). Only the author writes one; nothing is machine-translated (D3.1) |
| **Language of the writing shown** | The `locale` of the version shown | `versionPreference(interface language)` (ADR 0002, D1.2) | The version in the interface language if it is publicly visible, otherwise the original, otherwise the remaining one. Marked with `lang` on the writing itself |

So `/pt/albums/<slug>` of a journal published only in English is a Portuguese page frame around English writing marked `lang="en"`. That is correct and is not a fallback or a defect.

### 2. Routes

- **English keeps every address it has.** `src/app/(en)/layout.tsx` is a root layout with `<html lang="en">`. A route group changes no URL.
- **Portuguese is the literal prefix `/pt`.** `src/app/pt/layout.tsx` is a root layout with `<html lang="pt-BR">`. The prefix is `pt`; the locale value is `pt-BR` everywhere else (the `html` attribute, hreflang, dictionaries, and the database, whose values do not change). One module, `src/i18n/locales.ts`, holds that mapping.
- **The Studio follows the same rule:** `/studio/**` and `/pt/studio/**`. `/api/auth/**`, `/sitemap.xml`, and `/robots.txt` have one address each, and no prefix.
- **Slugs are the same in both languages** (ADR 0002, D7.1). There is no translated path segment.
- **There is no alias.** `/en`, `/en/**`, `/pt-BR`, and `/pt/pt/**` are not routes. Every slug lives under a section, so `pt` collides with none.
- Moving from one root layout to the other is a full page load, which the language switch is.

### 3. Route files

The routes in `(en)` and `pt` are thin files. Each passes its interface language to one shared implementation and carries the route-level configuration as a literal, because Next.js reads it statically (for example, `export const instant = false`). The implementations stay in their current directories, as non-route modules. **A static test keeps the two trees equal:** every route in one exists in the other, with the same literal configuration, and does nothing but delegate.

### 4. Dictionaries

- Own typed dictionaries, `src/i18n/dictionaries/en.ts` and `pt-BR.ts`, with no runtime dependency. The English object defines the type; the Portuguese one satisfies it, so a missing or extra key fails the type check.
- A string that takes values is a function in the dictionary, taking plain values. Plurals use `Intl.PluralRules` through a shared helper.
- **Public pages** read a dictionary on the server, and no dictionary reaches a public client bundle beyond the strings a small island is given as props.
- **Studio** client components receive only the Studio's dictionary through one provider, rendered inside the Studio's own layout.
- The V4.4 strings are the glossary. Words the author wrote about themselves or the journal (the Home's introduction, the archives' first-person leads, and any other authored sentence) are not translated by an agent: a proposal goes to the owner, and is not shipped until approved.
- The dictionaries hold interface copy only, never the author's writing or anything derived from a request.

### 5. Formats

Every format goes through `src/i18n/format.ts`, which takes the interface language. Dates stay in UTC, as today. A rating is `4.5` in English and `4,5` in Portuguese, as the V4.4 screens have it. Country names use `Intl.DisplayNames` in the interface language. The server's own ordering (`nameOrder`) and excerpt segmentation stay as they are, so an order or an excerpt does not depend on the interface.

### 6. Language state and the switch

- **The URL is the only state.** No cookie, no `Accept-Language` negotiation, no `localStorage`, no query parameter. `/` is always English. Every internal link keeps the current prefix, through one helper (`localizedHref`), so a bookmark or a reload keeps the language.
- **The selector** is discreet and centered in the footer, with no flag, offering "English" and "Português (Brasil)" with the V4.4 note. It is real links, so it works without JavaScript, and a small island adds the arrow keys and Escape the V4.4 handoff asks for.
- **Each page supplies its own pair of addresses**, built from its route and its validated slug. There is no `next=` or similar parameter, and a page without a counterpart links to the start of the other language.
- In the Studio the selector is an ordinary link, so the unsaved-changes guard applies to it.

### 7. Metadata and alternates

- `<html lang>` as in § 2. `og:locale` follows the page frame on list pages and the version shown on a journal or a memory, as it does today.
- `canonical` is the page's own address in its language. Alternates are `en`, `pt-BR`, and `x-default` (the English address), only on public pages that are served.
- **The alternates name interface languages, not translations.** Every served address has the same pair, so they say nothing about whether an author's translation exists (INV-3). A link that names a translation appears only under ADR 0002's rules.
- The sitemap lists each served address in both forms. `robots.txt` also disallows `/pt/studio`. Studio pages stay `noindex`, with no alternates.
- Addresses are built from `publicSiteOrigin()` and the route, never from `Host` or a forwarded header.

### 8. The not-found view: interim

**Interim, by the owner's decision of 2026-11-10.** One shared view answers for every address that is not served, in both languages: the real status `404`, `no-store`, and one body whatever the address or the reason, so that no case can be told from another (INV-5). It carries both languages, with the Portuguese part marked `lang="pt-BR"`, in `global-not-found`, which is an experimental Next.js convention (`experimental.globalNotFound`).

**Its limitation, stated plainly:** `<html lang>` on this view is `en` for every address, including `/pt/...`. This is not a complete localization of the 404, and must not be described as one. A page-level localized view is revisited as below.

Other failures: a sentence that a page shows when the database cannot answer is localized like any other string; the proxy's `503` and `405` have no localized body, as today.

### 9. Trust limits

- **The interface language comes only from the literal route.** Never from a header, cookie, query, form field, or action argument. It is not an input to any authorization, publication, or visibility decision. The one exception to "no input" is content, below.
- **The language of new writing is content, not interface:** the `locale` an editor sends is validated with Zod against the existing enum, as today.
- **Server Actions do not change.** They authorize first, return fixed codes, and take no interface language; the client chooses the sentence for a code. No confirmation token, fingerprint, or disclosure may depend on the interface language; a label in a review is presentation, resolved outside the fingerprint.
- **A Portuguese Studio page is an authorized page like any other:** the shared implementation authorizes first, an unauthorized request goes to the sign-in page of the same language, and the private response headers cover `/pt/studio` and its transport forms.
- **Dictionary strings are static and rendered as text.** No dictionary value is treated as HTML.
- The selector and the alternates cannot be made to name an arbitrary address: they are built from the route table and a validated slug.
- The public rules are in [ADR 0006 amendment A7](0006-publication-decision-and-acknowledgement.md#a7-the-pt-surfaces).

### 10. Writing language of memories

By the owner's decision of 2026-11-10, a memory may be written originally in English or Brazilian Portuguese, with its existing publication, privacy, and `lang` rules. This supersedes the English-only decision of M3.6, **and is not built:** the editor still offers English only. Any change of existing behaviour is assessed when the Studio is localized, before it is implemented. No migration and no conversion of existing writing is authorized.

## Consequences

**Positive.** The English surface, every one of whose addresses is tested, keeps its routes. Language is visible in the URL and cannot differ between two requests for one address. No dependency is added. Nothing about an entry's visibility depends on the language of the interface.

**Negative.**

- About 34 more route files, kept honest by a test rather than by the framework.
- Every public and private address has a second form that the proxy, the header rules, and the tests must cover. A missed one is a real defect, which is why A7 makes the tests a condition.
- `global-not-found` is experimental, and the not-found view is only partly localized (§ 8).
- The browser and HTTP suites grow. CI's 20-minute limit may become a constraint: the timeout may be raised to 30 minutes only on demonstrated need, and coverage is never reduced to fit it.
- First-person copy waits on the owner.

**Not decided here.** Interfaces for writing an author's translation, artist journals, any language other than the two, and any hosted release. Gates G1 to G8 stay open.

## Revisit when

- Next.js offers a stable, tested way to give a not-found view a real status and its own `<html lang>` per root layout, or `global-not-found` changes.
- A third interface language is proposed.
- The mirrored routes become a measured maintenance cost.
