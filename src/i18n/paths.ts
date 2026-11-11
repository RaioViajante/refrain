import { LOCALE_PREFIX, type InterfaceLocale } from "./locales";

// Every internal link keeps the current interface language (ADR 0008 § 6).
// A path is always the English one, built by the caller from its route and a
// validated slug; this adds the prefix, and nothing else. A path that is not
// an absolute path on this site is refused, so no caller can turn a link into
// another origin.

/** `/albums/x` in English, `/pt/albums/x` in Portuguese; `/` and `/pt`. */
export function localizedHref(locale: InterfaceLocale, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("A localized link must be a path on this site.");
  }
  const prefix = LOCALE_PREFIX[locale];
  if (prefix === "") {
    return path;
  }
  // The Home: `/pt`, not `/pt/`, which would be redirected. A fragment or a
  // query on the Home keeps its place.
  if (path === "/" || path.startsWith("/#") || path.startsWith("/?")) {
    return `${prefix}${path.slice(1)}`;
  }
  return `${prefix}${path}`;
}

/**
 * The same page in each interface language, for the language selector, the
 * canonical address, and the alternates. Every public page has both forms,
 * because slugs are the same in both languages (ADR 0002, D7.1).
 */
export function addressPair(
  path: string,
): Readonly<Record<InterfaceLocale, string>> {
  return {
    en: localizedHref("en", path),
    "pt-BR": localizedHref("pt-BR", path),
  };
}
