/**
 * The album artwork frame: "no artwork yet", and the chosen Cover Art Archive
 * cover over it once loaded (M3.2). The frame keeps its size whether or not
 * the image arrives, and if it never does, the fallback is what remains. The
 * image comes only from the sources the Catalog built from the stored cover
 * (src/integrations/cover-art-archive), without a referrer.
 */
export function ArtworkPlaceholder({
  artwork,
  title,
  size = 160,
}: {
  artwork?: { src: string; srcSet: string } | null;
  title?: string;
  /** The frame's largest width, in CSS pixels. */
  size?: number;
}) {
  if (!artwork) {
    return (
      <div
        className="studio-artwork"
        role="img"
        aria-label="No album artwork yet"
      >
        <span aria-hidden>no artwork yet</span>
      </div>
    );
  }
  return (
    <div
      className="studio-artwork studio-cover"
      role="img"
      aria-label={title ? `Album artwork for ${title}` : "Album artwork"}
      style={{ width: `min(100%, ${size}px)` }}
    >
      <span aria-hidden>no artwork yet</span>
      {/* eslint-disable-next-line @next/next/no-img-element -- a remote cover, not routed through an image optimizer (docs/evidence/m3-2.md) */}
      <img
        src={artwork.src}
        srcSet={artwork.srcSet}
        sizes={`${size}px`}
        width={250}
        height={250}
        alt=""
        decoding="async"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
