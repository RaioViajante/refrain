import { STUDIO_CONTENT_ID } from "@/app/studio/frame";

/**
 * Shown while a studio page checks the session and reads its data. It has no
 * studio furniture: the page's own frame brings that once the request is
 * authorized. Quiet gray blocks stand where the writing will be.
 */
export function StudioLoading() {
  return (
    <main id={STUDIO_CONTENT_ID} tabIndex={-1} className="studio-main">
      <div>
        <p role="status" className="studio-hint">
          Loading…
        </p>
        <div className="studio-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </main>
  );
}
