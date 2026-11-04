import type { Metadata } from "next";

import { publicSiteOrigin } from "@/modules/publication/public";

// The metadata of a public archive (M3.8a): the site's own words for the
// page, its canonical address, and Open Graph tags, the same in every state of
// the journal: nothing in it names, counts, or depends on any entry. While
// public reads are off the proxy answers the unknown-address `404` before the
// page renders; if a request reached it anyway, the not-found view's metadata
// is used, so nothing tells the two apart.

export const NOT_FOUND_METADATA: Metadata = {
  title: "Not found · refrain",
  description: "A personal music journal.",
};

export function archiveMetadata(
  path: "/albums" | "/artists" | "/memories",
  name: string,
  description: string,
): Metadata {
  const origin = publicSiteOrigin();
  const title = `${name} · refrain`;
  return {
    title,
    description,
    ...(origin
      ? { metadataBase: new URL(origin), alternates: { canonical: path } }
      : {}),
    openGraph: {
      type: "website",
      siteName: "refrain",
      title,
      description,
      locale: "en_US",
      ...(origin ? { url: path } : {}),
    },
  };
}
