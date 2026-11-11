import type { ReactNode } from "react";

import type { JournalRemoval } from "@/app/studio/journals/removals";
import { useStudio } from "@/app/studio/studio-locale";
import type { StudioDictionary } from "@/i18n/studio";
import type { ReviewedValue, ReviewText } from "@/modules/journals";

// Pieces shared by the two dialogs that show the author what readers would
// see (publishing, and a change to a page that is public). Display only: no
// state, no actions, and nothing here sends a token. The words around the
// writing are the interface's, in the page's language; they are presentation
// and never part of what the server fingerprints (ADR 0008 § 9). The writing
// itself keeps its own `lang`.

/**
 * The fixed English names the Journals module gives each place a change can
 * be in (src/modules/journals: `toChangeReview`, `toMemoryChangeReview`). They
 * are presentation, never part of what is confirmed; the dialog says them in
 * the page's language. A name this table does not know is shown as sent, in
 * English (`review-parts.test.ts` keeps the table complete).
 */
export const CHANGE_PLACES = {
  Title: "title",
  "Opening sentence": "opening",
  "Margin note": "marginNote",
  "Your reflection": "body",
  "The memory": "memory",
  "Your rating for the album": "albumRating",
  "Reflection on the track": "trackText",
  "Rating of the track": "trackRating",
  "Marked as a favourite": "favourite",
  "Labelled “still writing”": "stillWriting",
  When: "when",
  "The music": "music",
} as const satisfies Record<string, keyof StudioDictionary["review"]["places"]>;

/** A change's place in the page's language, and the language it is said in. */
export function changePlace(
  t: StudioDictionary,
  ui: string,
  label: string,
): { text: string; lang: string } {
  const key = Object.hasOwn(CHANGE_PLACES, label)
    ? CHANGE_PLACES[label as keyof typeof CHANGE_PLACES]
    : undefined;
  return key
    ? { text: t.review.places[key], lang: ui }
    : { text: label, lang: "en" };
}

/**
 * One thing a save takes away from readers (issue #54), in the words the
 * change review uses for the same place: the album rating, or a track's
 * reflection with its track and language. The language's name is marked in
 * the language it is written in: its own name in the English Studio
 * ("Português (Brasil)"), Portuguese words in the Portuguese one. A track
 * title's language is not known, so it is not marked.
 */
export function RemovalView({ removal }: { removal: JournalRemoval }) {
  const { locale: ui, words: t } = useStudio();
  if (removal.kind === "albumRating") {
    return <>{t.review.places.albumRating}</>;
  }
  return (
    <>
      {t.review.places.trackText} · {removal.title} ·{" "}
      <span lang={ui === "en" ? removal.locale : ui}>
        {t.languageInSentence[removal.locale]}
      </span>
    </>
  );
}

export function starsInWords(
  t: StudioDictionary,
  halfSteps: number | null,
): string {
  return halfSteps === null ? t.review.noRating : t.rating.stars(halfSteps);
}

/** A text as the reader would read it, in its own language. */
export function ReviewedText({
  text,
  lang,
  empty,
}: {
  text: ReviewText;
  lang: string;
  empty?: string;
}) {
  const { locale: ui, words: t } = useStudio();
  if (text === null) {
    return <p lang={ui}>{t.review.unsupported}</p>;
  }
  if (text.length === 0) {
    return <p lang={ui}>{empty ?? t.review.nothing}</p>;
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
  const { locale: ui, words: t } = useStudio();
  switch (value.type) {
    case "text":
      return (
        <ReviewedText
          text={value.text}
          lang={lang}
          empty={side === "before" ? t.review.nothingYet : t.review.cleared}
        />
      );
    case "rating":
      return <p lang={ui}>{starsInWords(t, value.halfSteps)}</p>;
    case "flag":
      return <p lang={ui}>{value.value ? t.review.yes : t.review.no}</p>;
    case "list":
      return value.items.length === 0 ? (
        <p lang={ui}>
          {side === "before" ? t.review.noSongsYet : t.review.noSongs}
        </p>
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
