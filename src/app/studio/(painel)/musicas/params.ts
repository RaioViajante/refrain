// The catalogue's filters, read from and written to the URL
// (?q=&fita=&notas=1&ordem=&limite=). Parsing runs on the server; the client
// only builds links. Unknown or malformed values fall back to the defaults.

export const SORTS = ["recentes", "musica", "artista"] as const;
export type SongSort = (typeof SORTS)[number];

export const PAGE = 48;
export const MAX_LIMIT = 500;
const MAX_QUERY = 200;

export type SongParams = {
  q: string;
  /** A tape's id, "nenhuma", or "" (every song). */
  fita: string;
  notas: boolean;
  ordem: SongSort;
  limite: number;
};

export const DEFAULT_PARAMS: SongParams = {
  q: "",
  fita: "",
  notas: false,
  ordem: "recentes",
  limite: PAGE,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Raw = Record<string, string | string[] | undefined>;

/** A single text value; repeated or missing parameters count as absent. */
function one(raw: Raw, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Validates every search parameter. `fita` must name an existing tape
 * (`isTape` checks the id against the tapes read from the database) or be
 * "nenhuma".
 */
export function parseSongParams(
  raw: Raw,
  isTape: (id: string) => boolean,
): SongParams {
  const q = (one(raw, "q") ?? "").trim().slice(0, MAX_QUERY);
  const fitaRaw = one(raw, "fita") ?? "";
  const fita =
    fitaRaw === "nenhuma" || (UUID.test(fitaRaw) && isTape(fitaRaw))
      ? fitaRaw
      : "";
  const ordemRaw = one(raw, "ordem");
  const ordem = SORTS.find((s) => s === ordemRaw) ?? DEFAULT_PARAMS.ordem;
  const limiteRaw = one(raw, "limite") ?? "";
  const limiteNum = /^\d{1,4}$/.test(limiteRaw) ? Number(limiteRaw) : NaN;
  const limite =
    limiteNum >= 1 && limiteNum <= MAX_LIMIT
      ? limiteNum
      : DEFAULT_PARAMS.limite;
  return { q, fita, notas: one(raw, "notas") === "1", ordem, limite };
}

/** The catalogue's address for these filters, leaving out the defaults. */
export function songsHref(params: SongParams): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.fita) search.set("fita", params.fita);
  if (params.notas) search.set("notas", "1");
  if (params.ordem !== DEFAULT_PARAMS.ordem) search.set("ordem", params.ordem);
  if (params.limite !== DEFAULT_PARAMS.limite) {
    search.set("limite", String(params.limite));
  }
  const query = search.toString();
  return query ? `/studio/musicas?${query}` : "/studio/musicas";
}
