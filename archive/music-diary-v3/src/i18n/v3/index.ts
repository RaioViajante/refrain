import type { InterfaceLocale } from "@/i18n/locales";

import { v3En, type V3Strings } from "./en";
import { v3PtBR } from "./pt-BR";

export type { V3Strings };

/** The v3 interface copy for a locale. */
export function v3StringsFor(locale: InterfaceLocale): V3Strings {
  return locale === "pt-BR" ? v3PtBR : v3En;
}

/** Writes a decimal with the locale's separator ("4.5" or "4,5"). */
export function v3Decimal(locale: InterfaceLocale, value: number): string {
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return locale === "pt-BR" ? text.replace(".", ",") : text;
}
