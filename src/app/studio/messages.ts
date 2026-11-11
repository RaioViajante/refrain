import type { StudioDictionary, WritingKind } from "@/i18n/studio/en";

import type { ActionResult, FieldProblem } from "./results";

// The words for what a studio action returned. Plain sentences: the interface
// has no color for errors (docs/design-system.md), so a problem is always said
// in words. The action returns a fixed code and nothing else; the sentence is
// chosen here, in the page's language (ADR 0008 § 9), from the Studio's
// dictionary.

type Failure = Extract<ActionResult<unknown>, { ok: false }>;

/** The kind of writing a message is about. Journals are the default. */
export type WritingSubject = WritingKind;

export function failureMessage(
  words: StudioDictionary,
  failure: Failure,
  subject: WritingSubject = "journal",
): string {
  const f = words.failures;
  switch (failure.code) {
    case "unauthorized":
      return f.unauthorized;
    case "unavailable":
      return f.unavailable;
    case "invalid_input":
      return f.invalidInput;
    case "not_found":
      return f.notFound;
    case "in_use":
      return failure.blockedBy ? f.blockedBy[failure.blockedBy] : f.inUse;
    case "duplicate":
      return f.duplicate;
    case "archived":
      return f.archived;
    case "conflict":
      return f.conflict[subject];
    case "deleted":
      return f.deleted[subject];
    case "not_deleted":
      return f.notDeleted[subject];
    case "unsupported":
      return f.unsupported;
    case "confirmation_required":
    case "confirmation_invalid":
    case "confirmation_expired":
    case "confirmation_stale":
      return f.reviewChanged;
    case "nothing_to_publish":
      return f.nothingToPublish[subject];
    case "status_changed":
      return f.statusChanged;
    case "unreachable":
      return f.unreachable;
    case "no_address":
      return f.noAddress[subject];
    case "provider_unavailable":
      return f.providerUnavailable;
    case "provider_not_found":
      return f.providerNotFound;
    case "stale":
      return f.stale;
    case "unsupported_release":
      return f.unsupportedRelease;
    case "already_linked":
      return f.alreadyLinked;
    case "not_linked":
      return f.notLinked;
    case "public_page":
      return f.publicPage;
    case "photo_not_usable":
      return f.photoNotUsable;
    case "failed":
      return f.failed;
  }
}

export function fieldMessage(
  words: StudioDictionary,
  problem: FieldProblem,
): string {
  switch (problem) {
    case "required":
      return words.fields.required;
    case "too_long":
      return words.fields.tooLong;
    case "invalid":
      return words.fields.invalid;
  }
}

/** The problem with one field, or `undefined`. */
export function problemWith(
  words: StudioDictionary,
  failure: Failure | undefined,
  field: string,
): string | undefined {
  const problem = failure?.fields?.[field];
  return problem ? fieldMessage(words, problem) : undefined;
}
