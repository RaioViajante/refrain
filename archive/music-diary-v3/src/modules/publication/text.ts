// Plain-text rules shared by the disclosure and the public read models.
// Internal to the Publication module; pure, with no database access.

/** Whether a text has anything but Unicode white space in it. */
export function isFilled(text: string | null | undefined): text is string {
  return typeof text === "string" && /\P{White_Space}/u.test(text);
}
