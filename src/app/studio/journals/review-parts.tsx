import type { ReactNode } from "react";

import type { ReviewedValue, ReviewText } from "@/modules/journals";

// Pieces shared by the two dialogs that show the author what readers would
// see (publishing, and a change to a page that is public). Display only: no
// state, no actions, and nothing here sends a token.

export const LANGUAGE_NAMES = {
  en: "English",
  "pt-BR": "Português (Brasil)",
} as const;

export function starsInWords(halfSteps: number | null): string {
  if (halfSteps === null) {
    return "no rating";
  }
  const stars = halfSteps / 2;
  return `${stars} ${stars === 1 ? "star" : "stars"}`;
}

/** A text as the reader would read it, in its own language. */
export function ReviewedText({
  text,
  lang,
  empty = "Nothing.",
}: {
  text: ReviewText;
  lang: string;
  empty?: string;
}) {
  if (text === null) {
    return (
      <p lang="en">
        This text has formatting the plain view can’t show. It is public exactly
        as it is stored.
      </p>
    );
  }
  if (text.length === 0) {
    return <p lang="en">{empty}</p>;
  }
  return (
    <div lang={lang} className="studio-review-text">
      {text.map((lines, index) => (
        <p key={index}>
          {lines.map((line, lineIndex) => (
            <span key={lineIndex}>
              {lineIndex > 0 ? <br /> : null}
              {line}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

export function ReviewedValueView({
  value,
  lang,
  side = "after",
}: {
  value: ReviewedValue;
  lang: string;
  /** "before" is what is published now: an empty text there was never written. */
  side?: "before" | "after";
}) {
  switch (value.type) {
    case "text":
      return (
        <ReviewedText
          text={value.text}
          lang={lang}
          empty={
            side === "before" ? "Nothing yet." : "Nothing: this is cleared."
          }
        />
      );
    case "rating":
      return <p lang="en">{starsInWords(value.halfSteps)}</p>;
    case "flag":
      return <p lang="en">{value.value ? "Yes" : "No"}</p>;
    case "list":
      return value.items.length === 0 ? (
        <p lang="en">{side === "before" ? "No songs yet." : "No songs."}</p>
      ) : (
        <ol className="studio-review-songs">
          {value.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ol>
      );
  }
}

/**
 * What just happened in a review dialog: a refusal, a removal. It takes focus
 * (see `ConfirmDialog`), so it is read at once, and it is plain text with no
 * token and none of the author's writing.
 */
export function Notice({
  children,
  problem,
}: {
  children: ReactNode;
  problem?: boolean;
}) {
  return (
    <p
      data-notice
      tabIndex={-1}
      className={problem ? "studio-problem" : undefined}
    >
      {children}
    </p>
  );
}

/** A titled part of a review. */
export function ReviewSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="studio-review-section">
      <h3 className="studio-label">{title}</h3>
      {children}
    </section>
  );
}
