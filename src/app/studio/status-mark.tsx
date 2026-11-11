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
  subject = "journal",
}: {
  locale: InterfaceLocale;
  status: VisibilityStatus;
  /** What it is the status of: the word agrees with it. */
  subject?: "journal" | "memory";
}) {
  const words = studioWords(locale);
  return (
    <span className="studio-status">
      <span className="studio-status-mark" data-status={status} aria-hidden />
      {subject === "memory" ? words.memoryStatus[status] : words.status[status]}
    </span>
  );
}
