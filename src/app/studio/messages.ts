import type { ActionResult, FieldProblem } from "./results";

// The words for what a studio action returned. Plain sentences: the interface
// has no color for errors (docs/design-system.md), so a problem is always said
// in words. English only for now; Brazilian Portuguese arrives with next-intl
// (issue #11).

/**
 * What the studio says about the web. It is true whichever way the
 * installation is configured: the public page of a published version is served
 * only where the server-side public-reads switch is on (ADR 0006, D4), and the
 * switch is off by default. The studio does not claim that no page exists, and
 * it does not claim that one opens.
 */
export const PUBLIC_PAGE_NOTE =
  "On the web it opens at its address only where public reads are switched on. They are off by default, so on a default installation nothing opens on the web.";

type Failure = Extract<ActionResult<unknown>, { ok: false }>;

const BLOCKED_BY = {
  album_credits:
    "It is credited on an album. Remove those credits first, or archive it instead.",
  track_credits:
    "It is credited on a track. Remove those credits first, or archive it instead.",
  journals:
    "Journals are written about it, so it stays in your catalog. Archive it instead.",
  memories:
    "A memory links to it, so it stays in your catalog. Archive it instead.",
  albums:
    "It is on an album. Remove it from the album first, or archive it instead.",
  reflections:
    "A track reflection is written about it, so it stays on the album.",
} as const;

export function failureMessage(failure: Failure): string {
  switch (failure.code) {
    case "unauthorized":
      return "Your session has ended. Sign in again in another tab, then try again. What you typed is still here.";
    case "unavailable":
      return "The studio can’t check your session right now. Try again in a moment. What you typed is still here.";
    case "invalid_input":
      return "Some fields need attention.";
    case "not_found":
      return "That record no longer exists. Reload the page.";
    case "in_use":
      return failure.blockedBy
        ? BLOCKED_BY[failure.blockedBy]
        : "Something still depends on it. Archive it instead.";
    case "duplicate":
      return "That MusicBrainz identifier is already in your catalog.";
    case "archived":
      return "An archived record can’t be added. Restore it first.";
    case "conflict":
      return "This journal changed somewhere else since you opened it, so nothing was saved. Your text is still here: copy it, reload the page, and save again.";
    case "deleted":
      return "This journal is in Recently deleted, so it can’t be changed.";
    case "not_deleted":
      return "This journal is not in Recently deleted, so there is nothing to restore. It may already have been restored. Reload the page.";
    case "unsupported":
      return "This text has formatting that the plain editor can’t show without losing it, so it was left untouched.";
    case "confirmation_required":
    case "confirmation_invalid":
    case "confirmation_expired":
    case "confirmation_stale":
      return "What would be published has changed since you looked, or your confirmation ran out, so nothing was published or saved. Your text is still here. Review it again to continue.";
    case "nothing_to_publish":
      return "A version needs an opening sentence or some text before it can be published, and a published version has to keep one. Nothing was changed. Write something first, or unpublish it before you empty it.";
    case "status_changed":
      return "This version was changed somewhere else (another tab may have published or unpublished it), so nothing was changed here. The page now shows how it stands. Check it, then choose again.";
    case "unreachable":
      return "The studio didn’t answer, so it isn’t known whether this went through. Reload the page to see what was saved before you try again. What you typed is still here.";
    case "no_address":
      return "This journal has no address, so it can’t be published. Nothing was changed.";
    case "provider_unavailable":
      return "Couldn’t reach MusicBrainz or the Cover Art Archive, so nothing was changed. Your catalog and your writing still work. Try again in a moment.";
    case "provider_not_found":
      return "MusicBrainz no longer has that record. Search again.";
    case "stale":
      return "Something changed since you looked: MusicBrainz, the Cover Art Archive, or this record in your catalog. Nothing was changed. Review it again.";
    case "unsupported_release":
      return "This release can’t be added as one album. Add it by hand, or link an album you already have.";
    case "already_linked":
      return "This record is already linked to a different MusicBrainz entry, and a link is never replaced. Nothing was changed.";
    case "not_linked":
      return "This album isn’t linked to MusicBrainz yet, so there is no artwork to choose from.";
    case "public_page":
      return "A published journal shows this album, so its artwork can’t change without a confirmation, and that confirmation isn’t built yet. Nothing was changed.";
    case "failed":
      return "Something went wrong, and nothing was changed. Try again.";
  }
}

export function fieldMessage(problem: FieldProblem): string {
  switch (problem) {
    case "required":
      return "This is required.";
    case "too_long":
      return "This is too long.";
    case "invalid":
      return "This isn’t valid.";
  }
}

/** The problem with one field, or `undefined`. */
export function problemWith(
  failure: Failure | undefined,
  field: string,
): string | undefined {
  const problem = failure?.fields?.[field];
  return problem ? fieldMessage(problem) : undefined;
}
