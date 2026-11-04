import {
  PUBLIC_CONTENT_ID,
  PublicFrame,
  type PublicSection,
} from "@/app/(public)/_components/public-frame";

// The frame every public archive shares (M3.8a; the approved V4.4 `Albums`,
// `Artists`, and `Memories` screens): the page's own header in the notebook
// layout (an empty 220px margin beside the title, in Kalam 700 at 58px, and
// its lead), then the archive's list in the same columns. Presentation only:
// what it shows was read through the Publication module by the page.

const date = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeZone: "UTC",
});

/** A publication date, as the Home and the detail pages write it. */
export function Published({ at }: Readonly<{ at: Date }>) {
  return <time dateTime={at.toISOString()}>{date.format(at)}</time>;
}

export function ArchiveFrame({
  section,
  title,
  lead,
  children,
}: Readonly<{
  section: Exclude<PublicSection, "home">;
  title: string;
  lead: string;
  children: React.ReactNode;
}>) {
  return (
    <PublicFrame current={section}>
      <main
        className="public-shell px"
        id={PUBLIC_CONTENT_ID}
        tabIndex={-1}
        aria-labelledby="px-title"
      >
        <header className="px-grid px-head">
          <div className="px-margin" />
          <div>
            <h1 id="px-title" className="px-title">
              {title}
            </h1>
            <p className="px-lead">{lead}</p>
          </div>
        </header>
        <div className={`px-grid px-body px-body-${section}`}>
          <div className="px-margin" />
          <div className="px-column">{children}</div>
        </div>
      </main>
    </PublicFrame>
  );
}

/** The archive of a journal with nothing published in it, in its own place. */
export function ArchiveEmpty() {
  return <p className="px-quiet">Nothing published yet.</p>;
}

/**
 * When public reads are on but the database could not answer: one fixed line
 * in the place of the list, as on the Home. It says nothing about why, and
 * nothing about what exists.
 */
export function ArchiveUnavailable() {
  return <p className="px-quiet">This list could not be loaded just now.</p>;
}
