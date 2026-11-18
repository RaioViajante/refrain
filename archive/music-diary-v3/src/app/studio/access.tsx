import { redirect } from "next/navigation";
import type { ReactElement } from "react";

import type { InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";
import { studioWords } from "@/i18n/studio";
import type { AuthorizationFailure } from "@/modules/identity";

/**
 * What a studio page shows when `authorizeAuthor` did not authorize the
 * request: a redirect to sign-in, or, when the session cannot be checked at
 * all, a plain notice. Called only after the page itself has asked Identity.
 * The sign-in page is the one of the page's own language (ADR 0008 § 9),
 * taken from its route; nothing from the request names it.
 */
export function accessDenied(
  reason: AuthorizationFailure,
  locale: InterfaceLocale,
): ReactElement {
  if (reason === "unavailable") {
    const words = studioWords(locale);
    return (
      <main id="studio-content" tabIndex={-1} className="studio-main">
        <h1 className="studio-title">{words.frame.studio}</h1>
        <p className="text-[19px]">{words.frame.unavailable}</p>
      </main>
    );
  }
  return redirect(localizedHref(locale, "/studio/sign-in"));
}
