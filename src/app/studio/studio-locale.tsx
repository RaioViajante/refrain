"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { InterfaceLocale } from "@/i18n/locales";

import { studio, type StudioSpeech } from "./studio-words";

// The one provider of the Studio's language to its client components (ADR
// 0008 § 4), rendered by the Studio's layout. It carries the interface
// language, a literal of the route's tree, and nothing else: the words are
// chosen here from the Studio's own dictionaries, which hold static interface
// copy only.

const StudioLocale = createContext<InterfaceLocale | null>(null);

export function StudioLocaleProvider({
  locale,
  children,
}: Readonly<{ locale: InterfaceLocale; children: ReactNode }>) {
  return <StudioLocale value={locale}>{children}</StudioLocale>;
}

/** The page's language, its words, and links that keep it. */
export function useStudio(): StudioSpeech {
  const locale = useContext(StudioLocale);
  if (locale === null) {
    throw new Error("A Studio component is rendered outside the Studio.");
  }
  return useMemo(() => studio(locale), [locale]);
}
