import type { Metadata } from "next";

import { SITE_TEXTS, type SiteTextKey } from "@/content/site-texts";
import { getDatabase } from "@/db/client";
import { requireStudio } from "@/server/auth/studio";
import { listSiteTextsForStudio } from "@/server/studio/site-content";

import styles from "./page.module.css";
import { type TextField, TextItem } from "./text-item";

export const metadata: Metadata = { title: "textos" };

type Group = { title: string | null; keys: SiteTextKey[] };
type Page = {
  id: string;
  title: string;
  aside: string;
  preview: { href: string; label: string } | null;
  groups: Group[];
};

const word = (n: 1 | 2 | 3): Group => ({
  title: `palavra ${n}`,
  keys: (["term", "syllables", "class", "definition", "caption"] as const).map(
    (part) => `about.word_${n}.${part}` as const,
  ),
});
const place = (n: 1 | 2): Group => ({
  title: `lugar ${n}`,
  keys: (["name", "url", "description"] as const).map(
    (part) => `about.place_${n}.${part}` as const,
  ),
});

/** Every page text, grouped by the page it appears on. */
const PAGES: Page[] = [
  {
    id: "home",
    title: "home",
    aside: "a abertura do site",
    preview: { href: "/studio/previa/home", label: "pré-visualizar a home" },
    groups: [
      {
        title: null,
        keys: [
          "home.intro",
          "home.lede",
          "home.featured_intro",
          "home.zine",
          "home.archive_note",
          "home.quote",
          "home.letter",
        ],
      },
    ],
  },
  {
    id: "mixtapes",
    title: "mixtapes",
    aside: "o catálogo",
    preview: null,
    groups: [{ title: null, keys: ["catalog.lede", "catalog.closing"] }],
  },
  {
    id: "sobre",
    title: "sobre",
    aside: "a carta e o que vem com ela",
    preview: { href: "/studio/previa/sobre", label: "pré-visualizar o sobre" },
    groups: [
      {
        title: null,
        keys: [
          "about.lede",
          "about.aside",
          "about.letter",
          "about.signature",
          "about.fig_1",
          "about.fig_2",
          "about.quote",
        ],
      },
      { title: "três palavras", keys: ["about.words_intro"] },
      word(1),
      word(2),
      word(3),
      { title: "outros lugares", keys: ["about.places_intro"] },
      place(1),
      place(2),
    ],
  },
];

// A key added to SITE_TEXTS but not placed above still gets a field.
const placed = new Set(PAGES.flatMap((p) => p.groups.flatMap((g) => g.keys)));
const unplaced = (Object.keys(SITE_TEXTS) as SiteTextKey[]).filter(
  (k) => !placed.has(k),
);
if (unplaced.length > 0) {
  PAGES.push({
    id: "outros",
    title: "outros",
    aside: "textos sem página definida",
    preview: null,
    groups: [{ title: null, keys: unplaced }],
  });
}

/** Short texts get a one-line field; the rest a text box. */
const SHORT = /\.(term|syllables|class|name|url|caption)$|\.fig_\d$/;
const ROWS: Partial<Record<SiteTextKey, number>> = {
  "about.letter": 14,
  "home.letter": 8,
  "home.zine": 6,
  "home.intro": 5,
  "about.signature": 3,
};
const HINTS: Partial<Record<SiteTextKey, string>> = {
  "home.intro": "uma linha por verso; a primeira fica em negrito.",
  "home.letter": "parágrafos separados por uma linha em branco.",
  "about.letter":
    "parágrafos separados por uma linha em branco. o último fica em itálico.",
  "about.signature": "a última linha é o nome, em negrito.",
  "home.quote": "sem aspas: o site as coloca.",
  "about.quote": "sem aspas: o site as coloca.",
  "about.place_1.url":
    "começa com https://. sem endereço, o lugar não aparece.",
  "about.place_2.url":
    "começa com https://. sem endereço, o lugar não aparece.",
  "about.word_1.term": "sem a palavra, o resto dela não aparece.",
  "about.word_2.term": "sem a palavra, o resto dela não aparece.",
  "about.word_3.term": "sem a palavra, o resto dela não aparece.",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "about.word_1.term" → "texto-about-word_1-term". */
const textAnchor = (key: string) => `texto-${key.replace(/\./g, "-")}`;

export default async function TextsPage() {
  await requireStudio();
  const saved = await listSiteTextsForStudio(getDatabase());

  const field = (key: SiteTextKey): TextField => {
    const row = saved.get(key);
    return {
      k: key,
      anchor: textAnchor(key),
      label: SITE_TEXTS[key],
      body: row?.body ?? "",
      state: !row ? "vazio" : row.published ? "publicado" : "rascunho",
      short: SHORT.test(key),
      rows: ROWS[key] ?? 3,
      hint: HINTS[key] ?? null,
    };
  };
  const pages = PAGES.map((p) => ({
    ...p,
    groups: p.groups.map((g) => ({ ...g, fields: g.keys.map(field) })),
  }));
  const all = pages.flatMap((p) => p.groups.flatMap((g) => g.fields));
  const drafts = all.filter((f) => f.state === "rascunho");
  const published = all.filter((f) => f.state === "publicado").length;
  const empty = all.filter((f) => f.state === "vazio").length;

  return (
    <main id="conteudo" className={styles.main}>
      <div className={styles.head}>
        <p className={styles.kicker}>Nº 005 · textos</p>
        <p className={styles.number} aria-hidden="true">
          005
        </p>
        <h1 className={`t-in ${styles.title}`}>textos</h1>
        <p className={styles.lede}>
          as palavras das páginas fixas — home, catálogo e sobre.
        </p>
      </div>

      <div className={styles.layout}>
        <aside className={styles.side} aria-labelledby="resumo">
          <div className={styles.sideInner}>
            <h2 id="resumo" className={styles.label}>
              resumo
            </h2>
            <p className={styles.counts}>
              {drafts.length} {drafts.length === 1 ? "rascunho" : "rascunhos"}
            </p>
            <p className={styles.countsMore}>
              {published} {published === 1 ? "publicado" : "publicados"} ·{" "}
              {empty} {empty === 1 ? "vazio" : "vazios"}
            </p>
            <p className={styles.help}>
              um rascunho não aparece no site até você publicá-lo. num texto já
              publicado, cada alteração salva vai para o site na hora.
            </p>
            {drafts.length > 0 ? (
              <nav aria-label="Rascunhos" className={styles.drafts}>
                <p className={styles.label}>ainda em rascunho</p>
                <ul>
                  {drafts.map((f) => (
                    <li key={f.k}>
                      <a href={`#${textAnchor(f.k)}`} className="nl">
                        {f.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : (
              <p className={styles.help}>nenhum texto em rascunho.</p>
            )}
            <p className={styles.label}>prévias</p>
            <ul className={styles.previews}>
              {PAGES.flatMap((p) =>
                p.preview ? (
                  <li key={p.id}>
                    <a
                      href={p.preview.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="nl"
                    >
                      {p.preview.label} ↗
                      <span className="visually-hidden">
                        {" "}
                        (abre em nova aba)
                      </span>
                    </a>
                  </li>
                ) : (
                  []
                ),
              )}
            </ul>
          </div>
        </aside>

        <div className={styles.pages}>
          {pages.map((p, i) => (
            <section
              key={p.id}
              aria-labelledby={`pg-${p.id}`}
              className={styles.page}
            >
              <div className={styles.sectionHead}>
                <span className={styles.sectionNumber}>{pad(i + 1)}</span>
                <h2 className={`rv ${styles.h2}`} id={`pg-${p.id}`}>
                  {p.title}
                </h2>
                <span className={styles.sectionAside}>{p.aside}</span>
              </div>
              {p.preview ? (
                <p className={styles.previewLine}>
                  <a
                    href={p.preview.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="nl"
                  >
                    {p.preview.label} ↗
                    <span className="visually-hidden"> (abre em nova aba)</span>
                  </a>
                  <span className={styles.previewNote}>
                    com os rascunhos, como ficará no site
                  </span>
                </p>
              ) : null}
              {p.groups.map((g, j) => (
                <div key={j} className={styles.group}>
                  {g.title ? (
                    <h3 className={styles.groupTitle}>{g.title}</h3>
                  ) : null}
                  {g.fields.map((f) => (
                    <TextItem key={f.k} field={f} />
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
