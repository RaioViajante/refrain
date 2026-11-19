// Fixed photograph slots on public pages (table site_images), filled in the
// Studio with rights-confirmed photographs. A page leaves an empty slot blank;
// a `_mobile` slot falls back to its desktop slot.
export const SITE_IMAGES = {
  "home.birds": "home, abertura: pássaros (pequena, à esquerda)",
  "home.house": "home, abertura: casa (à direita)",
  "home.horses": "home, abertura: foto larga sob o título",
  "home.featured": "home, fita em destaque: foto larga",
  "home.window": "home, foto da citação",
  "about.band": "sobre, abertura: foto larga",
  "about.fence": "sobre, figura 1",
  "about.house": "sobre, figura 2",
  "about.word_1": "sobre, palavra 1",
  "about.word_2": "sobre, palavra 2",
  "about.word_3": "sobre, palavra 3",
  "footer.road": "rodapé: a estrada (desktop)",
  "footer.road_mobile": "rodapé: a estrada (celular)",
} as const;

export type SiteImageSlot = keyof typeof SITE_IMAGES;
