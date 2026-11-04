// The excerpt of a public memory on the Memories archive (M3.8a): the first
// readable paragraph of the version a reader is shown, as plain text, cut to
// about EXCERPT_TARGET characters at a word boundary. Pure and server-side:
// the archive's read model carries this string and never the document, so a
// list page is never sent a memory's whole writing.
//
// It reads a stored Tiptap document with the same restricted reading as the
// public renderer (src/app/(public)/_components/rich-text.tsx): only `text`
// strings and hard breaks contribute, marks are ignored, no markup or address
// is ever produced, and nesting deeper than MAX_DEPTH is not read. Anything
// that is not an object of the expected shape contributes nothing, so a
// malformed document gives no excerpt rather than an error.

/** About how long an excerpt is, in characters (the owner's decision). */
export const EXCERPT_TARGET = 240;

const MAX_DEPTH = 8;

// A cut never goes back further than this share of the target to find a
// space, so one very long word still gives a useful excerpt.
const MIN_SHARE = 0.6;

// Collecting stops well after the target: a paragraph of a megabyte is not
// walked to the end to show 240 characters of it.
const COLLECT_LIMIT = EXCERPT_TARGET * 8;

const ELLIPSIS = "…";

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function childrenOf(node: Node): Node[] {
  return Array.isArray(node.content) ? node.content.filter(isNode) : [];
}

/** The plain text of a node, with hard breaks as spaces, bounded in size. */
function plainText(
  node: Node,
  depth: number,
  out: string[],
  size: { n: number },
) {
  if (depth > MAX_DEPTH || size.n > COLLECT_LIMIT) {
    return;
  }
  if (node.type === "text" && typeof node.text === "string") {
    out.push(node.text);
    size.n += node.text.length;
    return;
  }
  if (node.type === "hardBreak") {
    out.push(" ");
    size.n += 1;
    return;
  }
  for (const child of childrenOf(node)) {
    plainText(child, depth + 1, out, size);
  }
}

// Whitespace of every kind, and the control and format characters that would
// otherwise reach the page invisibly (C0, C1, and the bidirectional
// overrides), become one space.
const SPACE_LIKE = new RegExp(
  "[\\s\\u0000-\\u001f\\u007f-\\u009f\\u200b\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069\\ufeff]+",
  "g",
);

function readable(node: Node, depth: number): string {
  const out: string[] = [];
  plainText(node, depth, out, { n: 0 });
  return out.join("").replace(SPACE_LIKE, " ").trim();
}

/**
 * The blocks of a document in reading order: its top-level children, and the
 * children of a top-level blockquote (a quoted paragraph is still a paragraph
 * a reader reads first).
 */
function blocksOf(document: Node): { node: Node; depth: number }[] {
  const blocks: { node: Node; depth: number }[] = [];
  for (const block of childrenOf(document)) {
    if (block.type === "blockquote") {
      for (const inner of childrenOf(block)) {
        blocks.push({ node: inner, depth: 2 });
      }
    } else {
      blocks.push({ node: block, depth: 1 });
    }
  }
  return blocks;
}

/** The text split into user-perceived characters, so a cut never splits one. */
function graphemes(text: string): string[] {
  return Array.from(
    new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text),
    (part) => part.segment,
  );
}

/** `text` cut to about `target` characters at a word boundary, with "…". */
export function cutAtWord(
  text: string,
  target: number = EXCERPT_TARGET,
): string {
  const characters = graphemes(text);
  if (characters.length <= target) {
    return text;
  }
  const head = characters.slice(0, target);
  let end = target;
  for (
    let index = target;
    index >= Math.floor(target * MIN_SHARE);
    index -= 1
  ) {
    if (characters[index] === " ") {
      end = index;
      break;
    }
  }
  const cut = head
    .slice(0, end)
    .join("")
    // A cut that ends on a comma, a dash, or an opening mark reads as broken.
    .replace(/[\s,;:\-–—(\[{“‘"']+$/u, "");
  return `${cut}${ELLIPSIS}`;
}

/**
 * The excerpt of a public memory: its first paragraph that has readable
 * text, or, when it has none, its first block of any kind that has; null for
 * an empty or malformed document. The ellipsis is added only when that text
 * itself was cut.
 */
export function memoryExcerpt(
  body: unknown,
  target: number = EXCERPT_TARGET,
): string | null {
  if (!isNode(body)) {
    return null;
  }
  const blocks = blocksOf(body);
  const paragraph = blocks
    .filter(({ node }) => node.type === "paragraph")
    .map(({ node, depth }) => readable(node, depth))
    .find((text) => text.length > 0);
  const text =
    paragraph ??
    blocks
      .map(({ node, depth }) => readable(node, depth))
      .find((candidate) => candidate.length > 0);
  return text ? cutAtWord(text, target) : null;
}
