import Link from "next/link";
import type { ReactNode } from "react";

import { HEADER_RINGS } from "@/app/v3/rings";

// The Artists archive's switch between the cloud of names and the A to Z
// dividers. The view is the address's `?view=` (validated by the screen), so
// each view is a link that works the same without JavaScript; both lists are
// in the page, and the other one is hidden.

export const ARTIST_VIEWS = ["often", "az"] as const;
export type ArtistView = (typeof ARTIST_VIEWS)[number];

/** Where the views start, so that switching keeps the reader there. */
const VIEWS_ID = "pp-views";

export function ArtistViews({
  view,
  base,
  labels,
  often,
  az,
}: Readonly<{
  /** The view chosen in the address. */
  view: ArtistView;
  /** The archive's own address in the reader's language. */
  base: string;
  labels: { show: string; often: string; az: string };
  often: ReactNode;
  az: ReactNode;
}>) {
  const link = (value: ArtistView, label: string, d: string) => (
    <Link
      href={`${base}${value === "often" ? "" : `?view=${value}`}#${VIEWS_ID}`}
      aria-current={view === value ? "true" : undefined}
      prefetch={false}
    >
      {label}
      <svg
        className="penring"
        viewBox="0 0 120 50"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path pathLength={1} d={d} />
      </svg>
    </Link>
  );
  return (
    <>
      <div
        className="sorts vsw"
        id={VIEWS_ID}
        role="group"
        aria-label={labels.show}
      >
        <span className="sb hand" aria-hidden="true">
          {labels.show}
        </span>
        {link("often", labels.often, HEADER_RINGS.artists.d)}
        {link("az", labels.az, HEADER_RINGS.albums.d)}
      </div>
      <div className="views" data-view={view}>
        <div className="v-often">{often}</div>
        <div className="v-az">{az}</div>
      </div>
    </>
  );
}
