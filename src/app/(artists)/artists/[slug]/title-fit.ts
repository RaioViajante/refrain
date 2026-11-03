// How long the longest word of an artist's name is, in characters, so the
// title can be sized to keep every ordinary word whole on a narrow screen
// (M3.5, owner's visual review). A line may break at a space or after a
// hyphen, so those separate words; anything else is part of one. Characters
// are counted as code points, so an accented or non-Latin letter counts once.

/** The length of the longest unbreakable run of the name, at least 1. */
export function longestWordLength(name: string): number {
  let longest = 1;
  for (const word of name.split(/[\s‐‑-]+/u)) {
    longest = Math.max(longest, Array.from(word).length);
  }
  return longest;
}
