// Slug rules (ADR 0002, D7). Pure functions with no database access.

export const MAX_SLUG_LENGTH = 80;

// The same rule as the entry_slugs_slug_format_check constraint.
const NORMALIZED_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Whether `slug` is already in normalized form, as the database requires. */
export function isNormalizedSlug(slug: string): boolean {
  return slug.length <= MAX_SLUG_LENGTH && NORMALIZED_SLUG.test(slug);
}

function trimHyphens(value: string): string {
  return value.replace(/^-+|-+$/g, "");
}

/**
 * Normalizes text into a slug (ADR 0002, D7.2): NFKD decomposition, removal
 * of combining marks, lowercase, every run of characters outside `a-z0-9`
 * becomes `-`, leading and trailing hyphens are trimmed, and the result is
 * limited to 80 characters. A hyphen left at the end by the length limit is
 * trimmed too, so the result always satisfies `isNormalizedSlug`.
 *
 * Returns an empty string when nothing usable remains (for example, a title
 * written entirely in a non-Latin script). The caller must then ask for a
 * slug; the database rejects an empty one.
 */
export function normalizeSlug(text: string): string {
  const slug = trimHyphens(
    text
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-"),
  );
  return trimHyphens(slug.slice(0, MAX_SLUG_LENGTH));
}

/**
 * The collision candidate for attempt `n` (ADR 0002, D7.3): `grace`, then
 * `grace-2`, `grace-3`, ... The base is shortened when needed, so the result
 * stays within 80 characters.
 */
export function suffixSlug(base: string, attempt: number): string {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError("attempt must be a positive integer");
  }
  if (attempt === 1) {
    return base;
  }
  const suffix = `-${attempt}`;
  return `${trimHyphens(base.slice(0, MAX_SLUG_LENGTH - suffix.length))}${suffix}`;
}
