import type { InterfaceLocale } from "./locales";

// A sentence that the author wrote or chose about the journal (ADR 0008 § 4).
// It is never translated by an agent: until the owner approves a Portuguese
// sentence, the Portuguese dictionary carries the English one, and the page
// marks it with its own `lang`. Functional strings never take this form; a
// missing translation of a label, a state, an error, or an accessible name is
// a defect, not a pending sentence.

export interface AuthoredCopy {
  readonly text: string;
  /** The language the sentence is written in. */
  readonly lang: InterfaceLocale;
}

export function authored(text: string, lang: InterfaceLocale): AuthoredCopy {
  return { text, lang };
}

/** The English sentence, kept in the Portuguese dictionary until approved. */
export function awaitingApproval(english: AuthoredCopy): AuthoredCopy {
  return { text: english.text, lang: "en" };
}
