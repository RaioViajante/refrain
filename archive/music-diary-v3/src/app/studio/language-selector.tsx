import { INTERFACE_LOCALES, type InterfaceLocale } from "@/i18n/locales";
import { addressPair } from "@/i18n/paths";
import { studioWords } from "@/i18n/studio";

import { GlobeIcon, OpensUpIcon, TickIcon } from "./language-icons";
import { LanguageKeys } from "./language-keys";

// The Studio's language selector (ADR 0008 § 6; docs/design-system.md § Page
// furniture), the public selector's twin: in the footer only, centered and
// discreet, with no flag; a native disclosure that opens upward over two real
// links, so it works without JavaScript. Each link is the same Studio page in
// the other language, built from the page's own path, which the page builds
// from its route and its validated id: the selector cannot be made to name any
// other address. It is an ordinary link, so the unsaved-changes guard
// (form-kit.tsx) asks before it leaves an editor with unsaved changes.

/** The current language on the button, in its short form. */
const CURRENT_NAMES: Readonly<Record<InterfaceLocale, string>> = {
  en: "English",
  "pt-BR": "Português",
};

export function StudioLanguageSelector({
  locale,
  path,
}: Readonly<{
  locale: InterfaceLocale;
  /** The page's English path; the other language's is built from it. */
  path: string;
}>) {
  const words = studioWords(locale);
  const pair = addressPair(path);
  return (
    <LanguageKeys>
      <details className="studio-language">
        <summary className="studio-language-button">
          <GlobeIcon />
          <span className="studio-sr-only">{`${words.languageSelector.label}: `}</span>
          <span lang={locale}>{CURRENT_NAMES[locale]}</span>
          <OpensUpIcon />
        </summary>
        <div className="studio-language-menu">
          <ul
            className="studio-language-options"
            role="list"
            aria-label={words.languageSelector.label}
          >
            {INTERFACE_LOCALES.map((option) => (
              <li key={option}>
                <a
                  className="studio-language-option"
                  href={pair[option]}
                  hrefLang={option}
                  lang={option}
                  aria-current={option === locale ? "page" : undefined}
                >
                  <span>{words.languageNames[option]}</span>
                  <span
                    className="studio-language-tick"
                    data-current={option === locale ? "true" : "false"}
                  >
                    <TickIcon />
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <p className="studio-language-note">{words.languageSelector.note}</p>
        </div>
      </details>
    </LanguageKeys>
  );
}
