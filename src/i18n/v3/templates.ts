import type { InterfaceLocale } from "@/i18n/locales";

// The v3 copy that the reference writes with sample values in it ("ALBUM
// JOURNAL · 10 TRACKS", "More about Jeff Buckley", "WRITTEN [DATE]"), turned
// into templates with the same words. Each English and Portuguese line is the
// reference's own, with the sample replaced by a parameter.

interface Templates {
  albumKind: (tracks: number) => string;
  written: (date: string) => string;
  translatedFrom: (original: InterfaceLocale) => string;
  inLanguage: (language: InterfaceLocale) => string;
  readOriginal: string;
  alsoIn: (other: InterfaceLocale) => string;
  moreAbout: (name: string) => string;
  memoriesOn: (album: string) => string;
  ratingAria: (rating: string) => string;
  albumsCount: (count: number) => string;
  artistCounts: (albums: number, memories: number) => string;
  entries: (count: number) => string;
  memoryOn: (album: string, year: number | null) => string;
  noAlbumJournal: string;
  artistInArtists: (name: string) => string;
}

const LANGUAGE_UPPER_EN: Readonly<Record<InterfaceLocale, string>> = {
  en: "ENGLISH",
  "pt-BR": "PORTUGUESE",
};
const LANGUAGE_UPPER_PT: Readonly<Record<InterfaceLocale, string>> = {
  en: "INGLÊS",
  "pt-BR": "PORTUGUÊS",
};

const en: Templates = {
  albumKind: (n) => `ALBUM JOURNAL · ${n} ${n === 1 ? "TRACK" : "TRACKS"}`,
  written: (date) => `WRITTEN ${date}`,
  translatedFrom: (original) => `TRANSLATED FROM ${LANGUAGE_UPPER_EN[original]}`,
  inLanguage: (language) => `IN ${LANGUAGE_UPPER_EN[language]}`,
  readOriginal: "READ THE ORIGINAL",
  alsoIn: (other) => `ALSO IN ${LANGUAGE_UPPER_EN[other]}`,
  moreAbout: (name) => `More about ${name}`,
  memoriesOn: (album) => `Memories whose song is on ${album}.`,
  ratingAria: (rating) => `My rating: ${rating} out of 5`,
  albumsCount: (n) => `${n} ${n === 1 ? "record" : "records"}, track by track`,
  artistCounts: (albums, memories) =>
    `${albums} ${albums === 1 ? "ALBUM" : "ALBUMS"} · ${memories} ${memories === 1 ? "MEMORY" : "MEMORIES"}`,
  entries: (n) => `, ${n} ${n === 1 ? "entry" : "entries"}`,
  memoryOn: (album, year) => `ON ${album.toUpperCase()}${year ? `, ${year}` : ""}`,
  noAlbumJournal: "NO ALBUM JOURNAL YET",
  artistInArtists: (name) => `${name} in the artists`,
};

const ptBR: Templates = {
  albumKind: (n) => `DIÁRIO DE ÁLBUM · ${n} ${n === 1 ? "FAIXA" : "FAIXAS"}`,
  written: (date) => `ESCRITO EM ${date}`,
  translatedFrom: (original) =>
    `TRADUZIDO DO ${LANGUAGE_UPPER_PT[original]}`,
  inLanguage: (language) => `EM ${LANGUAGE_UPPER_PT[language]}`,
  readOriginal: "LER O ORIGINAL",
  alsoIn: (other) => `TAMBÉM EM ${LANGUAGE_UPPER_PT[other]}`,
  moreAbout: (name) => `Mais sobre ${name}`,
  memoriesOn: (album) => `Memórias cuja música está em ${album}.`,
  ratingAria: (rating) => `Minha nota: ${rating} de 5`,
  albumsCount: (n) => `${n} ${n === 1 ? "disco" : "discos"}, faixa a faixa`,
  artistCounts: (albums, memories) =>
    `${albums} ${albums === 1 ? "ÁLBUM" : "ÁLBUNS"} · ${memories} ${memories === 1 ? "MEMÓRIA" : "MEMÓRIAS"}`,
  entries: (n) => `, ${n} ${n === 1 ? "entrada" : "entradas"}`,
  memoryOn: (album, year) => `EM ${album.toUpperCase()}${year ? `, ${year}` : ""}`,
  noAlbumJournal: "AINDA SEM DIÁRIO DE ÁLBUM",
  artistInArtists: (name) => `${name} nos artistas`,
};

/** The v3 templates for a locale. */
export function v3TemplatesFor(locale: InterfaceLocale): Templates {
  return locale === "pt-BR" ? ptBR : en;
}

/** A date as the v3 pixel lines write it: "10 NOV 2026". */
export function pixelDate(locale: InterfaceLocale, date: Date): string {
  return new Intl.DateTimeFormat(locale === "pt-BR" ? "pt-BR" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(date)
    .replace(/\./g, "")
    .replace(/ de /g, " ")
    .toUpperCase();
}
