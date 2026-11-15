"use client";

import { useState, type ReactNode } from "react";

import { HEADER_RINGS } from "@/app/v3/rings";

// The Artists archive's switch between the cloud of names and the A to Z
// dividers. Both lists are rendered; the switch shows one. Without JavaScript
// the cloud shows, and every name in it is a link.

type View = "often" | "az";

export function ArtistViews({
  labels,
  often,
  az,
}: Readonly<{
  labels: { show: string; often: string; az: string };
  often: ReactNode;
  az: ReactNode;
}>) {
  const [view, setView] = useState<View>("often");
  const button = (value: View, label: string, d: string) => (
    <button
      type="button"
      aria-pressed={view === value ? "true" : "false"}
      onClick={() => setView(value)}
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
    </button>
  );
  return (
    <>
      <div className="sorts vsw" role="group" aria-label={labels.show}>
        <span className="sb hand" aria-hidden="true">
          {labels.show}
        </span>
        {button("often", labels.often, HEADER_RINGS.artists.d)}
        {button("az", labels.az, HEADER_RINGS.albums.d)}
      </div>
      <div className="views" data-view={view}>
        <div className="v-often">{often}</div>
        <div className="v-az">{az}</div>
      </div>
    </>
  );
}
