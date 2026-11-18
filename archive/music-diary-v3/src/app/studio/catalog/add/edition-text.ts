import type { InterfaceLocale } from "@/i18n/locales";

// How an edition's provider facts are worded for someone who does not know
// MusicBrainz's codes, in the page's language. Presentation only: what is
// reviewed and stored is the provider's own value.

/** MusicBrainz's own area codes that are not countries. */
const AREAS: Readonly<Record<InterfaceLocale, ReadonlyMap<string, string>>> = {
  en: new Map([
    ["XW", "Worldwide"],
    ["XE", "Europe"],
    ["XG", "East Germany"],
    ["XC", "Czechoslovakia"],
    ["XU", "Soviet Union"],
    ["YU", "Yugoslavia"],
  ]),
  "pt-BR": new Map([
    ["XW", "Mundial"],
    ["XE", "Europa"],
    ["XG", "Alemanha Oriental"],
    ["XC", "Tchecoslováquia"],
    ["XU", "União Soviética"],
    ["YU", "Iugoslávia"],
  ]),
};

/**
 * MusicBrainz's fixed type names (release-group primary and secondary types,
 * artist types, and release statuses), in Portuguese. A name it does not list is shown as the
 * provider sent it.
 */
const PORTUGUESE_TERMS: ReadonlyMap<string, string> = new Map([
  ["Album", "Álbum"],
  ["Single", "Single"],
  ["EP", "EP"],
  ["Broadcast", "Transmissão"],
  ["Other", "Outro"],
  ["Compilation", "Coletânea"],
  ["Soundtrack", "Trilha sonora"],
  ["Spokenword", "Palavra falada"],
  ["Interview", "Entrevista"],
  ["Audiobook", "Audiolivro"],
  ["Audio drama", "Radionovela"],
  ["Live", "Ao vivo"],
  ["Remix", "Remix"],
  ["DJ-mix", "DJ-mix"],
  ["Mixtape/Street", "Mixtape"],
  ["Demo", "Demo"],
  ["Field recording", "Gravação de campo"],
  ["Person", "Pessoa"],
  ["Group", "Grupo"],
  ["Orchestra", "Orquestra"],
  ["Choir", "Coro"],
  ["Character", "Personagem"],
  ["Official", "Oficial"],
  ["Promotion", "Promocional"],
  ["Bootleg", "Pirata"],
  ["Pseudo-Release", "Pseudolançamento"],
]);

/** A MusicBrainz type name in the page's language, or as it was sent. */
export function providerTerm(locale: InterfaceLocale, term: string): string {
  return locale === "pt-BR" ? (PORTUGUESE_TERMS.get(term) ?? term) : term;
}

const formats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(
  locale: InterfaceLocale,
  withDay: boolean,
): Intl.DateTimeFormat {
  const key = `${locale}:${withDay}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, {
      ...(withDay ? { day: "numeric" } : {}),
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    formats.set(key, format);
  }
  return format;
}

/**
 * "August 23, 1994", "August 1994", or "1994" ("23 de agosto de 1994",
 * "agosto de 1994"); null when there is no date.
 */
export function editionDate(
  locale: InterfaceLocale,
  date: string | null,
): string | null {
  if (date === null) {
    return null;
  }
  const [year, month, day] = date.split("-");
  if (!month) {
    return year ?? null;
  }
  // The contract checks the shape, not the calendar: a date that is not one
  // is shown as the provider sent it, not as a nearby real date.
  if (Number(month) < 1 || Number(month) > 12) {
    return date;
  }
  if (day && (Number(day) < 1 || Number(day) > 31)) {
    return date;
  }
  return dateFormat(locale, Boolean(day)).format(
    new Date(Date.UTC(Number(year), Number(month) - 1, day ? Number(day) : 1)),
  );
}

const countries = new Map<InterfaceLocale, Intl.DisplayNames>();

/** "United Kingdom" for "GB"; a code it cannot name is returned as it is. */
export function editionPlace(
  locale: InterfaceLocale,
  country: string | null,
): string | null {
  if (country === null) {
    return null;
  }
  const area = AREAS[locale].get(country);
  if (area) {
    return area;
  }
  if (!/^[A-Z]{2}$/.test(country)) {
    return country;
  }
  let names = countries.get(locale);
  if (!names) {
    names = new Intl.DisplayNames([locale], {
      type: "region",
      fallback: "code",
    });
    countries.set(locale, names);
  }
  return names.of(country) ?? country;
}
