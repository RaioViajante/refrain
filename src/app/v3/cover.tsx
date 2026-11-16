import type { PublicArtwork } from "@/modules/publication/public";

// An album cover, or the reference's empty state for a missing one: a white
// record label with the title (docs/design-system.md, Part I, Empty states).
// The same label stands in when the cover display switch is off, so a page
// never shows a grey box. Covers come only from their one stored form.

export function Cover({
  artwork,
  title,
  line,
  className = "",
  loading = "lazy",
  sizes,
}: Readonly<{
  artwork: PublicArtwork | null;
  title: string;
  /** The label's pixel line: "ARTIST · YEAR". */
  line: string;
  className?: string;
  loading?: "lazy" | "eager";
  sizes?: string;
}>) {
  if (artwork) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- archive images, sized by srcSet
      <img
        className={className}
        src={artwork.src}
        srcSet={artwork.srcSet}
        sizes={sizes ?? "(max-width: 720px) 90vw, 460px"}
        alt=""
        width={500}
        height={500}
        // The archive never learns which page a reader was on.
        referrerPolicy="no-referrer"
        loading={loading}
        decoding="async"
      />
    );
  }
  return (
    <span className={`covx ${className}`.trim()} aria-hidden="true">
      <span className="hole" />
      <b>{title}</b>
      <span className="yr pix">{line}</span>
    </span>
  );
}

/** "NICK DRAKE · 1972", the label's line. */
export function labelLine(
  artists: readonly string[],
  year: number | null,
): string {
  const names = artists.join(", ");
  return [names, year ? String(year) : ""].filter(Boolean).join(" · ");
}
