import { STUDIO_CONTENT_ID } from "@/app/studio/frame";
import { v3FontClasses } from "@/app/v3/fonts";
import type { InterfaceLocale } from "@/i18n/locales";
import { studioWords } from "@/i18n/studio";

/**
 * Shown while a studio page checks the session and reads its data. It has no
 * studio furniture: the page's own frame brings that once the request is
 * authorized. Quiet blocks stand where the writing will be, on the v3
 * Studio's paper and in its face.
 */
export function StudioLoading({ locale }: { locale: InterfaceLocale }) {
  return (
    <div className={`stu ${v3FontClasses}`} style={{ display: "block" }}>
      <main
        id={STUDIO_CONTENT_ID}
        tabIndex={-1}
        className="studio-main content studio-loading"
        data-layout="wide"
      >
        <div>
          <p role="status" className="studio-hint">
            {studioWords(locale).frame.loading}
          </p>
          <div className="studio-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      </main>
    </div>
  );
}
