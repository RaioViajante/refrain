import type { InterfaceLocale } from "@/i18n/locales";

import { en, type Dictionary } from "./en";
import { ptBR } from "./pt-BR";

export type { Dictionary } from "./en";

const DICTIONARIES: Readonly<Record<InterfaceLocale, Dictionary>> = {
  en,
  "pt-BR": ptBR,
};

/** The public interface's words in one interface language. */
export function dictionaryFor(locale: InterfaceLocale): Dictionary {
  return DICTIONARIES[locale];
}
