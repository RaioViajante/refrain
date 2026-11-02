import { Fragment, type ReactNode } from "react";

// Renders a stored journal document (a Tiptap document) through an allow-list
// of nodes and marks (docs/security.md § Input and output). Raw HTML is never
// rendered, and nothing here builds markup from a string: every node becomes a
// React element, so React escapes the text.
//
// Allowed blocks: paragraph, heading (always shown as a subheading), and
// blockquote. Allowed inline: text, hard break, and the bold and italic marks.
// Everything else is dropped to its plain text, so writing is never lost to an
// unknown node and an unknown node can never carry markup. Links are not
// rendered as links: no address allow-list exists yet, so a link mark shows
// its text only.

interface Node {
  type?: unknown;
  text?: unknown;
  content?: unknown;
  marks?: unknown;
}

const MAX_DEPTH = 8;

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function children(node: Node): Node[] {
  return Array.isArray(node.content) ? node.content.filter(isNode) : [];
}

/** The text of a node and everything inside it, with hard breaks as spaces. */
function plainText(node: Node, depth = 0): string {
  if (depth > MAX_DEPTH) {
    return "";
  }
  if (node.type === "text" && typeof node.text === "string") {
    return node.text;
  }
  if (node.type === "hardBreak") {
    return " ";
  }
  return children(node)
    .map((child) => plainText(child, depth + 1))
    .join("");
}

function markNames(node: Node): Set<string> {
  const names = new Set<string>();
  if (Array.isArray(node.marks)) {
    for (const mark of node.marks) {
      if (isNode(mark) && typeof mark.type === "string") {
        names.add(mark.type);
      }
    }
  }
  return names;
}

function inline(nodes: Node[], depth: number): ReactNode[] {
  if (depth > MAX_DEPTH) {
    return [];
  }
  return nodes.map((node, index) => {
    if (node.type === "hardBreak") {
      return <br key={index} />;
    }
    if (node.type === "text" && typeof node.text === "string") {
      const marks = markNames(node);
      let element: ReactNode = node.text;
      if (marks.has("italic")) {
        element = <em>{element}</em>;
      }
      if (marks.has("bold")) {
        element = <strong>{element}</strong>;
      }
      return <Fragment key={index}>{element}</Fragment>;
    }
    // An unknown inline node: its text, never its markup.
    return <Fragment key={index}>{plainText(node)}</Fragment>;
  });
}

function hasText(node: Node): boolean {
  return plainText(node).trim() !== "";
}

function block(node: Node, index: number, depth: number): ReactNode {
  if (!hasText(node)) {
    return null;
  }
  switch (node.type) {
    case "paragraph":
      return <p key={index}>{inline(children(node), depth + 1)}</p>;
    case "heading":
      return <h3 key={index}>{inline(children(node), depth + 1)}</h3>;
    case "blockquote":
      return (
        <blockquote key={index}>
          {children(node).map((child, i) => block(child, i, depth + 1))}
        </blockquote>
      );
    default:
      // An unknown block: its text as one paragraph.
      return <p key={index}>{plainText(node)}</p>;
  }
}

/** The document's blocks, or null when it is not a document or has no text. */
export function renderDocument(document: unknown): ReactNode {
  if (!isNode(document) || document.type !== "doc") {
    return null;
  }
  const blocks = children(document)
    .map((node, index) => block(node, index, 0))
    .filter((element) => element !== null);
  return blocks.length > 0 ? blocks : null;
}
