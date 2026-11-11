// A rating shown as five hand-drawn stars in half steps (docs/design-system.md
// § Components, Rating). The value is in half steps (0 to 10). The stars are
// decorative: the accessible name is the sentence, because a screen reader
// should hear "4.5 out of 5" and not five shapes.

import { StarInk, type StarFill } from "@/app/(public)/_components/star-ink";
import { ratingText as formatRating } from "@/i18n/format";
import type { InterfaceLocale } from "@/i18n/locales";

function fills(halfSteps: number): StarFill[] {
  return [1, 2, 3, 4, 5].map((star) => {
    if (halfSteps >= star * 2) return "full";
    if (halfSteps === star * 2 - 1) return "half";
    return "empty";
  });
}

/** "4.5" for 9 half steps ("4,5" in Portuguese); a whole number has no decimal. */
export function ratingText(
  halfSteps: number,
  locale: InterfaceLocale = "en",
): string {
  return formatRating(locale, halfSteps);
}

export function Stars({
  halfSteps,
  label,
  size,
}: Readonly<{ halfSteps: number; label: string; size: number }>) {
  return (
    <span className="pj-stars" role="img" aria-label={label}>
      {fills(halfSteps).map((fill, index) => (
        <svg
          key={index}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <StarInk fill={fill} />
        </svg>
      ))}
    </span>
  );
}
