import Link from "next/link";

import { ArrowIcon } from "./arrow-icon";
import { PersonIcon } from "./person-icon";

// The closing row of a reading page (the V4.4 `Grace`, `Artist`, and `Memory`
// screens): the way back to the section's archive and, on an album journal, to
// each credited artist. It decides nothing: an artist link is given only an
// address the Publication module's read model returned, which it returns only
// for an artist that already has a public page.

export interface ClosingArtist {
  name: string;
  address: string;
}

export function ClosingLinks({
  archive,
  label,
  artists = [],
  layout = "journal",
}: Readonly<{
  /** The section's archive, for example `/albums`. */
  archive: string;
  /** The link's words, for example "All albums". */
  label: string;
  artists?: readonly ClosingArtist[];
  /** The page's own columns, so the row lines up with its writing. */
  layout?: "journal" | "notebook";
}>) {
  return (
    <nav
      className={layout === "journal" ? "pj-grid pj-end" : "pj-end pm-end"}
      aria-label="Keep reading"
    >
      <span className="pj-end-margin" aria-hidden="true" />
      <div className="pj-end-links">
        <Link className="pj-button" href={archive}>
          <ArrowIcon back />
          <span>{label}</span>
        </Link>
        {artists.map((artist) => (
          <Link
            className="ph-all-link pj-end-artist"
            href={`/artists/${artist.address}`}
            key={artist.address}
          >
            <PersonIcon size={18} />
            <span>{`More about ${artist.name}`}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
