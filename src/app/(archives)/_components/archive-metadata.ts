import type { Metadata } from "next";

import { publicPageMetadata } from "@/app/(public)/_components/page-metadata";
import type { InterfaceLocale } from "@/i18n/locales";

// The metadata of an archive (M3.8a): its title and its lead as the
// description, at its own address in its interface language, with the
// alternates of every served public page (ADR 0008 § 7). A lead that keeps
// its English in Portuguese is the description as it is (metadata has no
// language attribute).

export function archiveMetadata(
  locale: InterfaceLocale,
  path: "/albums" | "/artists" | "/memories",
  name: string,
  description: string,
): Metadata {
  return publicPageMetadata({
    locale,
    path,
    title: `${name} · refrain`,
    description,
    type: "website",
  });
}
