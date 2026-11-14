import type { Metadata } from "next";

import { publicSiteOrigin } from "@/modules/publication/public";

import { dictionaryFor } from "@/i18n/dictionaries";
import { OPEN_GRAPH_LOCALE, type InterfaceLocale } from "@/i18n/locales";
import { addressPair } from "@/i18n/paths";

// The metadata of a public page that is served (ADR 0008 § 7). The canonical
// address is the page's own, in its interface language; the alternates name
// the two interface languages and `x-default` (the English address), the
// same pair for every served page, so they say nothing about whether the
// author has translated anything. Addresses are built from the configured
// origin and the page's path, never from a request header. A page that is
// not served uses `notFoundMetadata`, which has no address and no alternates.

export function publicPageMetadata({
  locale,
  path,
  title,
  description,
  type,
  openGraphLocale = OPEN_GRAPH_LOCALE[locale],
  openGraphUrl = true,
}: Readonly<{
  locale: InterfaceLocale;
  /** The page's English path, built from its route and a validated slug. */
  path: string;
  title: string;
  description: string;
  type: "website" | "article";
  /** The writing's language on a journal or a memory; the frame's otherwise. */
  openGraphLocale?: string;
  /** Whether Open Graph names the page's address (every page but the album journal's, as before). */
  openGraphUrl?: boolean;
}>): Metadata {
  const origin = publicSiteOrigin();
  const pair = addressPair(path);
  const own = pair[locale];
  return {
    title,
    description,
    ...(origin
      ? {
          metadataBase: new URL(origin),
          alternates: {
            canonical: own,
            languages: {
              en: pair.en,
              "pt-BR": pair["pt-BR"],
              "x-default": pair.en,
            },
          },
        }
      : {}),
    openGraph: {
      type,
      siteName: "refrain",
      title,
      description,
      locale: openGraphLocale,
      ...(origin && openGraphUrl ? { url: own } : {}),
    },
  };
}

/**
 * What a public page that is not served describes: nothing about it. It also
 * carries the indexing policy, because the global not-found view is its own
 * document, outside both roots: src/indexing-policy.ts's value, written out
 * because a public file imports only the reading entry point
 * (src/app/public-surface.test.ts); src/indexing-policy.test.ts keeps the
 * copies equal.
 */
export function notFoundMetadata(locale: InterfaceLocale): Metadata {
  const t = dictionaryFor(locale);
  return {
    title: `${t.notFound.pageTitle} · refrain`,
    description: t.site.description,
    robots: "noindex, nofollow",
  };
}
