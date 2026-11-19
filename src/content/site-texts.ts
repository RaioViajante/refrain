// The owner's texts on fixed pages, by key (table site_texts). Each appears
// publicly only once published in the Studio; a page omits the element when
// its text is absent. Interface labels are not here: they live in the pages.
// Long texts separate paragraphs with a blank line.
export const SITE_TEXTS = {
  "home.intro": "abertura da home: quatro linhas curtas, uma por linha",
  "home.lede": "frase sob “~ refrain ~” na abertura",
  "home.featured_intro": "frase sob o título das fitas em destaque",
  "home.zine": "parágrafo sobre as fitas em destaque",
  "home.archive_note": "nota sob a constelação do arquivo",
  "home.quote": "citação grande da home",
  "home.letter": "texto final da home",
  "catalog.lede": "frase sob o título do catálogo",
  "catalog.closing": "frase no fim do catálogo",
  "about.lede": "frase sob o título da página sobre",
  "about.aside": "frase ao lado da primeira foto",
  "about.letter": "a carta",
  "about.signature": "assinatura da carta, uma linha por linha",
  "about.fig_1": "legenda da primeira foto",
  "about.fig_2": "legenda da segunda foto",
  "about.words_intro": "frase sob “três palavras”",
  "about.word_1.term": "palavra 1",
  "about.word_1.syllables": "palavra 1, separada em sílabas",
  "about.word_1.class": "palavra 1, classe gramatical",
  "about.word_1.definition": "palavra 1, definição",
  "about.word_1.caption": "palavra 1, legenda da foto",
  "about.word_2.term": "palavra 2",
  "about.word_2.syllables": "palavra 2, separada em sílabas",
  "about.word_2.class": "palavra 2, classe gramatical",
  "about.word_2.definition": "palavra 2, definição",
  "about.word_2.caption": "palavra 2, legenda da foto",
  "about.word_3.term": "palavra 3",
  "about.word_3.syllables": "palavra 3, separada em sílabas",
  "about.word_3.class": "palavra 3, classe gramatical",
  "about.word_3.definition": "palavra 3, definição",
  "about.word_3.caption": "palavra 3, legenda da foto",
  "about.quote": "citação da página sobre",
  "about.places_intro": "frase sob “outros lugares meus”",
  "about.place_1.name": "lugar 1, nome",
  "about.place_1.url": "lugar 1, endereço (https://…)",
  "about.place_1.description": "lugar 1, descrição",
  "about.place_2.name": "lugar 2, nome",
  "about.place_2.url": "lugar 2, endereço (https://…)",
  "about.place_2.description": "lugar 2, descrição",
} as const;

export type SiteTextKey = keyof typeof SITE_TEXTS;

/** Splits a long text into paragraphs (blank-line separated). */
export function paragraphs(text: string | undefined): string[] {
  return (text ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Splits a text into its non-empty lines. */
export function lines(text: string | undefined): string[] {
  return (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
