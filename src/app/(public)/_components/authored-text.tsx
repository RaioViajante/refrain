import type { AuthoredCopy } from "@/i18n/authored";
import type { InterfaceLocale } from "@/i18n/locales";

// An authored sentence of the interface (ADR 0008 § 4), marked with its own
// language when it is not the page's: the English sentence that stands in a
// Portuguese page until the owner approves its Portuguese is `lang="en"`.

export function AuthoredText({
  copy,
  locale,
  as: Element = "span",
  className,
}: Readonly<{
  copy: AuthoredCopy;
  /** The page's interface language. */
  locale: InterfaceLocale;
  as?: "p" | "span";
  className?: string;
}>) {
  return (
    <Element
      className={className}
      lang={copy.lang === locale ? undefined : copy.lang}
    >
      {copy.text}
    </Element>
  );
}
