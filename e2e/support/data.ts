// The synthetic records the global setup seeds, named so the specs can find
// them. Every text is labelled [Test]; none is the owner's writing
// (AGENTS.md § 4).

/** A published tape with every section: sides A and B and "a fita inteira". */
export const LONG_TAPE = {
  slug: "e2e-fita-longa",
  title: "[Test] fita longa",
  feeling: "estrada",
  trackCount: 52,
  // Positions with a note: two on side A, one on side B, two after 20.
  notes: {
    3: "[Test] nota na faixa 3",
    7: "[Test] nota na faixa 7",
    14: "[Test] nota na faixa 14",
    24: "[Test] nota na faixa 24",
    45: "[Test] nota na faixa 45",
  } as Record<number, string>,
} as const;

/** A published tape with a few tracks and no cover. */
export const SHORT_TAPE = {
  slug: "e2e-fita-curta",
  title: "[Test] fita curta",
  feeling: "saudade",
  trackCount: 4,
} as const;

/** A draft tape. Its title, slug, and photo must never reach a public page. */
export const DRAFT_TAPE = {
  slug: "e2e-rascunho-oculto",
  title: "[Test] rascunho oculto q7x",
  description: "[Test] frase do rascunho oculto",
} as const;

/** The published tape's cover: rights confirmed, in public use. */
export const PUBLIC_PHOTO_ID = "6f1d3a52-0c55-4b8e-9d0a-1f7c2e9b4a01";
/** The draft tape's cover: rights not confirmed, never public. */
export const PRIVATE_PHOTO_ID = "6f1d3a52-0c55-4b8e-9d0a-1f7c2e9b4a02";

/** Published site texts the public pages render. */
export const PUBLISHED_TEXTS = {
  "home.intro": "[Test] primeira linha da abertura\n[Test] segunda linha",
  "home.lede": "[Test] frase sob o nome do site",
  "home.letter": "[Test] carta da home, primeiro parágrafo.",
  "catalog.lede": "[Test] frase sob o título do catálogo",
  "about.lede": "[Test] frase sob o título do sobre",
  "about.letter":
    "[Test] carta do sobre, primeiro parágrafo.\n\n[Test] carta do sobre, último parágrafo.",
  "about.signature": "[Test] com carinho\n[Test] assinatura",
} as const;

/**
 * A draft text with a unique marker. No test ever publishes it, so the marker
 * must never appear in a public page.
 */
export const DRAFT_TEXT = {
  key: "about.aside",
  body: "[Test] marcador-de-rascunho-k4v9",
  marker: "marcador-de-rascunho-k4v9",
} as const;

/** A draft text the Studio flow publishes and returns to draft. */
export const FLOW_TEXT = {
  key: "about.quote",
  label: "citação da página sobre",
  body: "[Test] citação ainda em rascunho",
} as const;
