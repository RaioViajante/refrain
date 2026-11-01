import type { VisibilityStatus } from "@/modules/journals";

const WORDS: Record<VisibilityStatus, string> = {
  draft: "Draft",
  private: "Private",
  published: "Published",
};

/**
 * Published is a filled dot, private a drawn circle, draft a dotted circle
 * (docs/design-system.md § Components). The word is always shown with it.
 */
export function StatusMark({ status }: { status: VisibilityStatus }) {
  return (
    <span className="studio-status">
      <span className="studio-status-mark" data-status={status} aria-hidden />
      {WORDS[status]}
    </span>
  );
}
