"use client";

import { useEffect } from "react";

import { soundEngine } from "@/app/v3/sfx";

// The album journal's track rows are native disclosures (<details>), so they
// open and close with the keyboard and without JavaScript. With it, opening or
// closing one plays the page sound (if the reader turned sound on), and the
// record on the sleeve shows the number of the track last opened, as the
// reference's sleeve does.

export function TrackRuntime() {
  useEffect(() => {
    const rows = Array.from(document.querySelectorAll<HTMLDetailsElement>(".pp .tk details.trw"));
    const label = document.querySelector<HTMLElement>(".pp .gtop .vinyl .t2");
    const onToggle = (event: Event) => {
      const row = event.currentTarget as HTMLDetailsElement;
      soundEngine().play(row.open ? "open" : "close", 0, true);
      if (row.open && label && row.dataset.n) label.textContent = row.dataset.n;
    };
    rows.forEach((row) => row.addEventListener("toggle", onToggle));
    return () => rows.forEach((row) => row.removeEventListener("toggle", onToggle));
  }, []);
  return null;
}
