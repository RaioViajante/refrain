import type { InterfaceLocale } from "@/i18n/locales";
import { studioWords } from "@/i18n/studio";
import type { VisibilityStatus } from "@/modules/journals";

/**
 * Published is a filled dot, private a drawn circle, draft a dotted circle
 * (docs/design-system.md § Components). The word is always shown with it.
 */
export function StatusMark({
  locale,
  status,
}: {
  locale: InterfaceLocale;
  status: VisibilityStatus;
}) {
  return (
    <span className="studio-status">
      <span className="studio-status-mark" data-status={status} aria-hidden />
      {studioWords(locale).status[status]}
    </span>
  );
}
