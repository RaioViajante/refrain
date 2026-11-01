/** Shown until an album has artwork. Never an external image. */
export function ArtworkPlaceholder() {
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
