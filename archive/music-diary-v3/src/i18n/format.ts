import type { InterfaceLocale } from "./locales";

// Every format of the interface goes through here (ADR 0008 § 5). Dates stay
// in UTC, as they always were. Nothing here depends on the writing shown.

const dateFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(
  locale: InterfaceLocale,
  style: "medium" | "long",
): Intl.DateTimeFormat {
  const key = `${locale}:${style}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, {
      dateStyle: style,
      timeZone: "UTC",
    });
    dateFormats.set(key, format);
  }
  return format;
}

/** "Nov 10, 2026" or "10 de nov. de 2026"; "long" spells out the month. */
export function formatDate(
  locale: InterfaceLocale,
  at: Date,
  style: "medium" | "long" = "medium",
): string {
  return dateFormat(locale, style).format(at);
}

/**
 * A rating from its half steps: "4.5" in English and "4,5" in Portuguese, as
 * the V4.4 screens write it; a whole number has no decimal.
 */
export function ratingText(locale: InterfaceLocale, halfSteps: number): string {
  const value = halfSteps / 2;
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return locale === "pt-BR" ? text.replace(".", ",") : text;
}

/**
 * A count and its noun. `Intl.PluralRules` decides the form, except that zero
 * takes the plural in Portuguese as it does in English ("0 faixas"), which is
 * how Brazilian Portuguese writes it although the rules put zero with one.
 */
export function counted(
  locale: InterfaceLocale,
  count: number,
  one: string,
  other: string,
): string {
  const form =
    count === 0 ? "other" : new Intl.PluralRules(locale).select(count);
  return `${count} ${form === "one" ? one : other}`;
}
