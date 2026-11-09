import Link from "next/link";

// The settings margin's catalog blocks, from the approved AlbumEditor screen:
// the album's facts with the way to its catalog record, and its artwork with
// the way to change it. The same on a new journal and on an existing one.

export function JournalCatalogMargin({
  albumId,
  albumTitle,
  artistNames,
  hasCover,
}: {
  albumId: string;
  albumTitle: string;
  artistNames: string;
  hasCover: boolean;
}) {
  return (
    <>
      <section aria-labelledby="editor-catalog" className="space-y-1">
        <h2 id="editor-catalog" className="studio-margin-title">
          From your catalog
        </h2>
        <p className="studio-meta">
          {[artistNames, albumTitle].filter(Boolean).join(" · ")}
        </p>
        <p>
          <Link
            href={`/studio/albums/${albumId}`}
            className="studio-link studio-meta"
          >
            Edit in catalog
          </Link>
        </p>
      </section>
      <section aria-labelledby="editor-artwork" className="space-y-1">
        <h2 id="editor-artwork" className="studio-margin-title">
          Artwork
        </h2>
        <p className="studio-meta">
          {hasCover ? "Cover Art Archive" : "No artwork yet"}
        </p>
        <p>
          <Link
            href={`/studio/albums/${albumId}/artwork`}
            className="studio-link studio-meta"
          >
            Change…
            <span className="studio-sr-only"> the album’s artwork</span>
          </Link>
        </p>
      </section>
    </>
  );
}
