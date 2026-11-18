import type { Metadata } from "next";
import { Alegreya_Sans, Kalam } from "next/font/google";

import { StudioLocaleProvider } from "@/app/studio/studio-locale";
import type { InterfaceLocale } from "@/i18n/locales";
import { studioWords } from "@/i18n/studio";

// The two approved typefaces (docs/design-system.md § Typography), self-hosted
// by next/font: the browser never contacts Google Fonts.
const kalam = Kalam({
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "700"],
  variable: "--font-kalam",
});
const alegreyaSans = Alegreya_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "700"],
  variable: "--font-alegreya-sans",
});

export function studioLayoutMetadata(locale: InterfaceLocale): Metadata {
  return {
    title: studioWords(locale).meta.studio,
    // The studio is private: never indexed, never followed.
    robots: { index: false, follow: false },
  };
}

// Presentation only. A layout is not an authorization boundary: every studio
// page checks the session itself (src/modules/identity). The interface
// language is the literal its route file passes (ADR 0008 §§ 3 and 9), given
// to the Studio's client components by the one provider.
export function StudioLayout({
  locale,
  children,
}: Readonly<{ locale: InterfaceLocale; children: React.ReactNode }>) {
  return (
    <div className={`${kalam.variable} ${alegreyaSans.variable} studio`}>
      <StudioLocaleProvider locale={locale}>{children}</StudioLocaleProvider>
    </div>
  );
}
