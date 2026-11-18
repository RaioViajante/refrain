import { dictionaryFor } from "@/i18n/dictionaries";
import { INTERFACE_LOCALES, type InterfaceLocale } from "@/i18n/locales";
import { addressPair } from "@/i18n/paths";

import { GlobeIcon, OpensUpIcon, TickIcon } from "./language-icons";
import { LanguageKeys } from "./language-keys";

// The language selector (ADR 0008 § 6; docs/design-system.md § Page
// furniture): in the footer only, centered and discreet, with no flag. It is
// a native disclosure that opens upward over two real links, so it works
// without JavaScript; the island adds the arrow keys and Escape. Each link is
// the same page in the other language, built from the page's own path, which
// the page builds from its route and its validated slug: the selector cannot
// be made to name any other address.

/** Each language in its own words, as the V4.4 screens name them. */
const LANGUAGE_NAMES: Readonly<Record<InterfaceLocale, string>> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
};

/** The current language on the button, in its short form. */
const CURRENT_NAMES: Readonly<Record<InterfaceLocale, string>> = {
  en: "English",
  "pt-BR": "Português",
};

export function LanguageSelector({
  locale,
  path,
}: Readonly<{
  locale: InterfaceLocale;
  /** The page's English path; the other language's is built from it. */
  path: string;
}>) {
  const t = dictionaryFor(locale);
  const pair = addressPair(path);
  return (
    <LanguageKeys>
      <details className="public-language">
        <summary className="public-language-button">
          <GlobeIcon />
          <span className="pj-visually-hidden">{`${t.languageSelector.label}: `}</span>
          <span lang={locale}>{CURRENT_NAMES[locale]}</span>
          <OpensUpIcon />
        </summary>
        <div className="public-language-menu">
          <ul
            className="public-language-options"
            role="list"
            aria-label={t.languageSelector.label}
          >
            {INTERFACE_LOCALES.map((option) => (
              <li key={option}>
                <a
                  className="public-language-option"
                  href={pair[option]}
                  hrefLang={option}
                  lang={option}
                  aria-current={option === locale ? "page" : undefined}
                >
                  <span>{LANGUAGE_NAMES[option]}</span>
                  <span
                    className="public-language-tick"
                    data-current={option === locale ? "true" : "false"}
                  >
                    <TickIcon />
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <p className="public-language-note">{t.languageSelector.note}</p>
        </div>
      </details>
    </LanguageKeys>
  );
}
