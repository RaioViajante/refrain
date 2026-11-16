/** An artist's sort key: "The Lumineers" sorts as "Lumineers, The" (A to Z ignores the article). */
export function artistSortKey(name: string): string {
  const match = /^(the|os|as|o|a)\s+(.+)$/i.exec(name.trim());
  return match ? `${match[2]}, ${match[1]}` : name.trim();
}
