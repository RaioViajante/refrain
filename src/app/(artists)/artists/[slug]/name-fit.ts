// The artist page's name, on a wide screen, sits in a column between the two
// halves of the torn photograph, with the labels ("albums written", "the
// album") at fixed heights below it. A name of the reference's length (two
// short lines: "Jeff" and "Buckley") fits at the design's sizes; a longer one
// wrapped onto the labels. This scales the name down just enough to fit,
// estimated from the faces' measured widths, so the page needs no script and
// does not shift. On a phone the labels follow the name, so its sizes stay.

/** The column's width and the room above the first label, in px. */
const COLUMN = 240;
const ROOM = 245;
/** The design's sizes: the bold first words, the italic last word. */
const BOLD_PX = 64;
const SERIF_PX = 84;
const LINE_HEIGHT = 0.9;
/** Measured average advance per character, a little generous (em). */
const BOLD_EM = 0.53;
const SERIF_EM = 0.4;
const SPACE_EM = 0.25;
const SCALES = [1, 0.9, 0.8, 0.7, 0.62, 0.55, 0.48, 0.42, 0.36, 0.3];

function lines(text: string, charPx: number, spacePx: number): number | null {
  if (!text) {
    return 0;
  }
  let count = 1;
  let width = 0;
  for (const word of text.split(/\s+/)) {
    const wordPx = word.length * charPx;
    if (wordPx > COLUMN) {
      return null;
    }
    if (width === 0) {
      width = wordPx;
    } else if (width + spacePx + wordPx <= COLUMN) {
      width += spacePx + wordPx;
    } else {
      count += 1;
      width = wordPx;
    }
  }
  return count;
}

/** The scale (1 = the design's sizes) at which the name fits its column. */
export function artistNameScale(first: string, rest: string): number {
  for (const scale of SCALES) {
    const bold = BOLD_PX * scale;
    const serif = SERIF_PX * scale;
    const firstLines = lines(first, bold * BOLD_EM, bold * SPACE_EM);
    const restLines = lines(rest, serif * SERIF_EM, serif * SPACE_EM);
    if (firstLines === null || restLines === null) {
      continue;
    }
    const height =
      firstLines * bold * LINE_HEIGHT + restLines * serif * LINE_HEIGHT;
    if (height <= ROOM) {
      return scale;
    }
  }
  return SCALES[SCALES.length - 1]!;
}
