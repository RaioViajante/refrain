import type { InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";
import { studioWords, type StudioDictionary } from "@/i18n/studio";

// What a Studio screen needs to speak its page's language (ADR 0008 §§ 4 and
// 6): the interface language, which comes only from the route (the tree a
// route file sits in), its words, and links that keep the language. Server
// components call `studio(locale)` with the language their route passed;
// client components read the same thing with `useStudio()`. Nothing here is
// an input to authorization, to what is read, or to a Server Action.

export interface StudioSpeech {
  locale: InterfaceLocale;
  words: StudioDictionary;
  /** A Studio path, such as `/studio/journals`, in the page's language. */
  href: (path: string) => string;
}

export function studio(locale: InterfaceLocale): StudioSpeech {
  return {
    locale,
    words: studioWords(locale),
    href: (path) => localizedHref(locale, path),
  };
}
