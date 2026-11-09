import { Icon } from "./icons";
import { PhotoImage } from "./photo-image";

/**
 * The album artwork frame: "no artwork yet", and the chosen Cover Art Archive
 * cover over it once loaded (M3.2). The frame keeps its size whether or not
 * the image arrives. Under a chosen cover the fallback says only that it is
 * not shown, as under a photograph, because a cover does exist: it is what
 * remains while the image loads and if it never does. The image comes only
 * from the sources the Catalog built from the stored cover
 * (src/integrations/cover-art-archive), without a referrer.
 */
export function ArtworkPlaceholder({
  artwork,
  title,
  size,
}: {
  artwork?: { src: string; srcSet: string } | null;
  title?: string;
  /**
   * The frame's largest width, in CSS pixels. Without it, an empty frame takes
   * the width its surroundings give it (a choice in a grid, for example).
   */
  size?: number;
}) {
  if (!artwork) {
    return (
      <div
        className="studio-artwork"
        role="img"
        aria-label="No album artwork yet"
        style={size ? { width: `min(100%, ${size}px)` } : undefined}
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
      style={{ width: `min(100%, ${size ?? 160}px)` }}
    >
      <span aria-hidden>artwork not shown</span>
      <PhotoImage
        key={artwork.src}
        src={artwork.src}
        srcSet={artwork.srcSet}
        sizes={`${size ?? 160}px`}
        width={250}
        height={250}
      />
    </div>
  );
}

/**
 * A row's 56px thumbnail (44px on a phone): the record mark, and the chosen
 * cover over it once loaded. Decorative, because the row's title names the
 * album; if the image fails, the mark remains.
 */
export function AlbumThumb({
  artwork,
}: {
  artwork?: { src: string; srcSet: string } | null;
}) {
  return (
    <span className="studio-thumb" aria-hidden="true">
      <Icon name="album" size={26} />
      {artwork ? (
        <PhotoImage
          key={artwork.src}
          src={artwork.src}
          srcSet={artwork.srcSet}
          sizes="56px"
          width={250}
          height={250}
        />
      ) : null}
    </span>
  );
}
