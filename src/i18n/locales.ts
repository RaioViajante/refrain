// The interface languages (ADR 0008 § 2). The value is the language tag used
// everywhere (the `lang` attribute, hreflang, the dictionaries, and the
// database's own locale values); the prefix is the address segment, and
// English has none. This is the only place that maps one to the other.

export const INTERFACE_LOCALES = ["en", "pt-BR"] as const;

export type InterfaceLocale = (typeof INTERFACE_LOCALES)[number];

/** The address prefix of each interface language: none for English. */
export const LOCALE_PREFIX: Readonly<Record<InterfaceLocale, string>> = {
  en: "",
  "pt-BR": "/pt",
};

/** Open Graph's spelling of each interface language. */
export const OPEN_GRAPH_LOCALE: Readonly<Record<InterfaceLocale, string>> = {
  en: "en_US",
  "pt-BR": "pt_BR",
};

/** The other interface language, for the language selector. */
export function otherLocale(locale: InterfaceLocale): InterfaceLocale {
  return locale === "en" ? "pt-BR" : "en";
}
