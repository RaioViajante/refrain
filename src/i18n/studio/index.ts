import type { InterfaceLocale } from "@/i18n/locales";

import { studioEn, type StudioDictionary } from "./en";
import { studioPtBR } from "./pt-BR";

export type { StudioDictionary } from "./en";

// The Writing Studio's words (ADR 0008 § 4). They are the Studio's own: no
// public page imports them (src/app/public-surface.test.ts), and the Studio
// imports no public dictionary. Interface copy only, never writing.

const DICTIONARIES: Readonly<Record<InterfaceLocale, StudioDictionary>> = {
  en: studioEn,
  "pt-BR": studioPtBR,
};

/** The Studio's words in one interface language. */
export function studioWords(locale: InterfaceLocale): StudioDictionary {
  return DICTIONARIES[locale];
}
