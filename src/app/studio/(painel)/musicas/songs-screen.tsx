"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { MARKS_CLEARED, Sparkle } from "@/components/marks";
import { cx } from "@/lib/cx";
import type { ActionResult } from "@/server/studio/errors";
import type { StudioSongRow } from "@/server/studio/songs";

import { deleteSongAction, saveSongAction } from "../../_actions/songs";
import {
  MAX_LIMIT,
  PAGE,
  type SongParams,
  type SongSort,
  songsHref,
} from "./params";
import styles from "./page.module.css";

type Tape = { id: string; number: number; title: string };
type Totals = {
  songs: number;
  artists: number;
  withNotes: number;
  emptyTapes: number;
};

const SORT_LABELS: Record<SongSort, string> = {
  recentes: "mais recentes",
  musica: "música · a–z",
  artista: "artista · a–z",
};

const pad = (n: number) => String(n).padStart(2, "0");
const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

function whereText(song: StudioSongRow): string {
  return song.appearances.length
    ? song.appearances.map((a) => `${a.title} · ${pad(a.position)}`).join("   ")
    : "em nenhuma fita";
}

function leavesText(song: StudioSongRow): string {
  if (song.appearances.length === 0) return "ela não está em nenhuma fita.";
  const list = new Intl.ListFormat("pt-BR", { type: "conjunction" });
  return `ela sai de ${list.format(
    song.appearances.map((a) => `${a.title} (faixa ${pad(a.position)})`),
  )}.`;
}

const hasNote = (song: StudioSongRow) => song.appearances.some((a) => a.note);

/** The note mark: the drawn star once cleared, a typographic one until then. */
function NoteMark() {
  return (
    <span className={styles.mark}>
      <Sparkle kind={3} delay="-1.37s" sizes="11px" className={styles.star} />
      {!MARKS_CLEARED && <span aria-hidden="true">✦</span>}
      <span className="visually-hidden">tem anotação</span>
    </span>
  );
}

/** Opens and closes a native modal <dialog> with the state that drives it. */
function useModal(open: boolean, initialFocus?: string) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      if (initialFocus) {
        dialog.querySelector<HTMLElement>(initialFocus)?.focus();
      }
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialFocus]);
  return ref;
}

/** Submits a form to a dispatch from useActionState, inside a transition. */
function submitWith(
  dispatch: (formData: FormData) => void,
  start: (callback: () => void) => void,
) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    start(() => dispatch(formData));
  };
}

export function SongsScreen({
  params,
  rows,
  found,
  totals,
  top,
  tapes,
}: {
  params: SongParams;
  rows: StudioSongRow[];
  found: number;
  totals: Totals;
  top: { artist: string; count: number }[];
  tapes: Tape[];
}) {
  const [editing, setEditing] = useState<{
    song: StudioSongRow | null;
    key: number;
  } | null>(null);
  const [deleting, setDeleting] = useState<StudioSongRow | null>(null);
  const [message, setMessage] = useState("");
  const [loading, startLoading] = useTransition();
  const router = useRouter();

  const opener = useRef<HTMLElement | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  // Where focus goes when a dialog closes: back to what opened it, to the
  // "adicionar" button (after a delete), or nowhere (another dialog opens).
  const afterClose = useRef<"opener" | "add" | "none">("opener");
  const opened = useRef(0);

  const drawerRef = useModal(editing !== null, 'input[name="title"]');
  const confirmRef = useModal(deleting !== null);

  function restoreFocus() {
    const target = afterClose.current;
    afterClose.current = "opener";
    if (target === "none") return;
    const el = target === "opener" ? opener.current : null;
    if (el?.isConnected) el.focus();
    else addRef.current?.focus();
  }

  function openEditor(song: StudioSongRow | null, from: HTMLElement) {
    opener.current = from;
    opened.current += 1;
    setMessage("");
    setEditing({ song, key: opened.current });
  }

  function askDelete(song: StudioSongRow, from?: HTMLElement) {
    if (from) opener.current = from;
    setMessage("");
    setDeleting(song);
  }

  const noteLabel = (song: StudioSongRow) =>
    hasNote(song)
      ? `Editar ${song.title} (tem anotação)`
      : `Editar ${song.title}`;
  const more = found > rows.length && params.limite < MAX_LIMIT;

  return (
    <main id="conteudo" className={styles.main}>
      <div className={styles.head}>
        <p className={styles.kicker}>Nº 004 · músicas</p>
        <p className={styles.number} aria-hidden="true">
          004
        </p>
        <h1 className={cx("t-in", styles.title)}>músicas</h1>
        <p className={styles.lede}>
          o catálogo inteiro — cada faixa, em cada fita.
        </p>
        <button
          ref={addRef}
          type="button"
          className={cx("btn", styles.add)}
          onClick={(e) => openEditor(null, e.currentTarget)}
        >
          + adicionar música
        </button>
      </div>
      <p className={styles.mTotals}>
        {plural(totals.songs, "faixa", "faixas")} ·{" "}
        {plural(totals.artists, "artista", "artistas")} · {totals.withNotes} com
        anotação
      </p>

      <div className={styles.grid}>
        <section aria-label="Catálogo" className={styles.catalogue}>
          <Filters
            params={params}
            tapes={tapes}
            navigate={(href) =>
              startLoading(() => router.replace(href, { scroll: false }))
            }
          />
          <div className={styles.statusRow}>
            <p role="status" aria-live="polite" className={styles.msg}>
              {message}
            </p>
            <p className={styles.found}>
              {found} de {plural(totals.songs, "faixa", "faixas")}
            </p>
          </div>
          <div aria-hidden="true" className={styles.cols}>
            <span>música</span>
            <span>artista</span>
            <span>nas fitas</span>
            <span />
            <span />
          </div>
          <ul className={styles.list} aria-busy={loading}>
            {rows.map((song) => (
              <li key={song.id} className={cx("row", styles.row)}>
                <button
                  type="button"
                  className={cx("lnk", styles.rowTitle)}
                  onClick={(e) => openEditor(song, e.currentTarget)}
                  aria-label={noteLabel(song)}
                >
                  {song.title}
                </button>
                <span className={styles.rowArtist}>{song.artist}</span>
                <span className={styles.rowWhere}>{whereText(song)}</span>
                <span className={styles.rowMark}>
                  {hasNote(song) && <NoteMark />}
                </span>
                <span className={styles.rowActions}>
                  <button
                    type="button"
                    className={cx("nl", styles.rowAction)}
                    onClick={(e) => openEditor(song, e.currentTarget)}
                    aria-label={`Editar ${song.title}`}
                  >
                    editar
                  </button>
                  <button
                    type="button"
                    className={cx("del", styles.rowAction)}
                    onClick={(e) => askDelete(song, e.currentTarget)}
                    aria-label={`Excluir ${song.title}`}
                  >
                    excluir
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <ul className={styles.mList} aria-busy={loading}>
            {rows.map((song) => (
              <li key={song.id} className={cx("row", styles.mRow)}>
                <button
                  type="button"
                  className={cx("lnk", styles.mOpen)}
                  onClick={(e) => openEditor(song, e.currentTarget)}
                  aria-label={noteLabel(song)}
                >
                  <span className={styles.mTitle}>
                    {song.title}
                    {hasNote(song) && <NoteMark />}
                  </span>
                  <span className={styles.mArtist}>{song.artist}</span>
                  <span className={styles.mWhere}>{whereText(song)}</span>
                </button>
                <button
                  type="button"
                  className={cx("del", styles.mDel)}
                  onClick={(e) => askDelete(song, e.currentTarget)}
                  aria-label={`Excluir ${song.title}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {rows.length === 0 && (
            <p className={styles.empty}>
              {totals.songs === 0
                ? "o catálogo ainda está vazio."
                : "nenhuma música por aqui com esse nome."}
            </p>
          )}
          {more && (
            <Link
              href={songsHref({
                ...params,
                limite: Math.min(params.limite + PAGE, MAX_LIMIT),
              })}
              scroll={false}
              className={cx("nl", styles.more)}
            >
              mostrar mais · {rows.length} de {found}
            </Link>
          )}
        </section>

        <aside className={styles.aside}>
          <div className={styles.stats}>
            <Stat label="faixas" value={totals.songs} />
            <Stat label="artistas" value={totals.artists} />
            <Stat label="com anotação" value={totals.withNotes} />
            <Stat label="fitas sem faixas" value={totals.emptyTapes} />
          </div>
          {top.length > 0 && (
            <section aria-labelledby="h-art">
              <div className={styles.artHead}>
                <h2 id="h-art" className={cx("rv", styles.h2)}>
                  artistas
                </h2>
              </div>
              <ul className={styles.artists}>
                {top.map((t) => (
                  <li key={t.artist}>
                    <span>{t.artist}</span>
                    <span className={styles.artCount}>
                      {plural(t.count, "faixa", "faixas")}
                    </span>
                  </li>
                ))}
              </ul>
              <p className={styles.hint}>
                os que mais aparecem no catálogo. confira a grafia — “Mötley
                Crüe” e “Motley Crue” viram dois artistas.
              </p>
            </section>
          )}
        </aside>
      </div>

      <dialog
        ref={drawerRef}
        className={styles.drawer}
        aria-labelledby="dr-t"
        onClose={() => {
          setEditing(null);
          restoreFocus();
        }}
      >
        {editing && (
          <SongForm
            key={editing.key}
            song={editing.song}
            tapes={tapes}
            onCancel={() => setEditing(null)}
            onSaved={(msg) => {
              setMessage(msg);
              setEditing(null);
            }}
            onAskDelete={(song) => {
              afterClose.current = "none";
              setEditing(null);
              askDelete(song);
            }}
          />
        )}
      </dialog>

      <dialog
        ref={confirmRef}
        className={styles.confirm}
        aria-labelledby="cf-t"
        onClose={() => {
          setDeleting(null);
          restoreFocus();
        }}
      >
        {deleting && (
          <DeleteForm
            key={deleting.id}
            song={deleting}
            onCancel={() => setDeleting(null)}
            onDeleted={(msg) => {
              afterClose.current = "add";
              setMessage(msg);
              setDeleting(null);
            }}
          />
        )}
      </dialog>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.stat}>
      <p className={styles.label}>{label}</p>
      <p className={styles.statValue}>{value}</p>
    </div>
  );
}

/** Search (debounced, or on Enter), tape, order, and "only with a note". */
function Filters({
  params,
  tapes,
  navigate,
}: {
  params: SongParams;
  tapes: Tape[];
  navigate: (href: string) => void;
}) {
  const [q, setQ] = useState(params.q);
  const [fita, setFita] = useState(params.fita);
  const [ordem, setOrdem] = useState(params.ordem);
  const [notas, setNotas] = useState(params.notas);
  // Follow the server's values after each navigation (back and forward too),
  // except the search box, which may hold letters typed since.
  const [synced, setSynced] = useState(params);
  if (synced !== params) {
    setSynced(params);
    setFita(params.fita);
    setOrdem(params.ordem);
    setNotas(params.notas);
  }

  const go = (next: Partial<SongParams>) =>
    navigate(
      songsHref({
        q: q.trim(),
        fita,
        ordem,
        notas,
        ...next,
        limite: PAGE,
      }),
    );
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });

  useEffect(() => {
    if (q.trim() === params.q) return;
    const timer = setTimeout(() => goRef.current({ q: q.trim() }), 350);
    return () => clearTimeout(timer);
  }, [q, params.q]);

  return (
    <form
      role="search"
      className={styles.filters}
      onSubmit={(e) => {
        e.preventDefault();
        go({ q: q.trim() });
      }}
    >
      <label className={styles.fSearch}>
        <span className={styles.label}>buscar</span>
        <input
          type="search"
          name="q"
          className={cx("fld", styles.fFld)}
          placeholder="música ou artista"
          maxLength={200}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <label className={styles.fTape}>
        <span className={styles.label}>fita</span>
        <select
          name="fita"
          className={cx("fld", styles.fFld)}
          value={fita}
          onChange={(e) => {
            setFita(e.target.value);
            go({ fita: e.target.value });
          }}
        >
          <option value="">todas</option>
          {tapes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
          <option value="nenhuma">em nenhuma fita</option>
        </select>
      </label>
      <label className={styles.fSort}>
        <span className={styles.label}>ordem</span>
        <select
          name="ordem"
          className={cx("fld", styles.fFld)}
          value={ordem}
          onChange={(e) => {
            const value = e.target.value as SongSort;
            setOrdem(value);
            go({ ordem: value });
          }}
        >
          {(Object.keys(SORT_LABELS) as SongSort[]).map((s) => (
            <option key={s} value={s}>
              {SORT_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.fNotes}>
        <input
          type="checkbox"
          name="notas"
          value="1"
          className="chk"
          checked={notas}
          onChange={(e) => {
            setNotas(e.target.checked);
            go({ notas: e.target.checked });
          }}
        />
        só com anotação
      </label>
    </form>
  );
}

function SongForm({
  song,
  tapes,
  onCancel,
  onSaved,
  onAskDelete,
}: {
  song: StudioSongRow | null;
  tapes: Tape[];
  onCancel: () => void;
  onSaved: (message: string) => void;
  onAskDelete: (song: StudioSongRow) => void;
}) {
  const [state, dispatch, pending] = useActionState(
    async (prev: ActionResult | null, formData: FormData) => {
      const result = await saveSongAction(prev, formData);
      if (result.ok) onSaved(result.message);
      return result;
    },
    null,
  );
  const [, start] = useTransition();
  const [title, setTitle] = useState(song?.title ?? "");
  const [artist, setArtist] = useState(song?.artist ?? "");
  const on = new Set(song?.appearances.map((a) => a.mixtapeId));
  const notes = song?.appearances.filter((a) => a.note) ?? [];
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const search = `${title} ${artist}`.trim();
  const ready = title.trim() !== "" && artist.trim() !== "";

  return (
    <form onSubmit={submitWith(dispatch, start)} noValidate>
      <div className={styles.drHead}>
        <p className={styles.label}>catálogo</p>
        <button
          type="button"
          className={cx("ghost", styles.close)}
          onClick={onCancel}
          aria-label="Fechar"
        >
          ×
        </button>
      </div>
      <h2 id="dr-t" className={cx("rv", styles.drTitle)}>
        {song ? "editar música" : "nova música"}
      </h2>
      <input type="hidden" name="id" value={song?.id ?? ""} />

      <div className={cx(styles.drField, styles.drFirst)}>
        <label htmlFor="song-title" className={styles.label}>
          música
        </label>
        <input
          id="song-title"
          name="title"
          className="fld"
          value={title}
          maxLength={200}
          required
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? "song-title-error" : undefined}
        />
        {errors.title && (
          <p id="song-title-error" className={cx("msg-error", styles.small)}>
            {errors.title}
          </p>
        )}
      </div>

      <div className={styles.drField}>
        <label htmlFor="song-artist" className={styles.label}>
          artista
        </label>
        <input
          id="song-artist"
          name="artist"
          className="fld"
          value={artist}
          maxLength={200}
          required
          onChange={(e) => setArtist(e.target.value)}
          aria-invalid={errors.artist ? true : undefined}
          aria-describedby={cx(
            "song-artist-hint",
            errors.artist && "song-artist-error",
          )}
        />
        {errors.artist && (
          <p id="song-artist-error" className={cx("msg-error", styles.small)}>
            {errors.artist}
          </p>
        )}
        <p id="song-artist-hint" className={styles.hint}>
          mais de um artista? separe com vírgula.
        </p>
      </div>

      <div className={styles.drField}>
        <p className={styles.label}>link</p>
        {ready && (
          <a
            href={`https://open.spotify.com/search/${encodeURIComponent(search)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={cx("nl", styles.spotify)}
          >
            ouvir no Spotify ↗
          </a>
        )}
        <p className={styles.hint}>
          gerado sozinho pela busca do Spotify. o refrain não toca música.
        </p>
      </div>

      <fieldset className={styles.drTapes}>
        <legend className={styles.label}>nas fitas</legend>
        {tapes.map((t) => (
          <label key={t.id} className={styles.tapeOption}>
            <input
              type="checkbox"
              name="tapes"
              value={t.id}
              className="chk"
              defaultChecked={on.has(t.id)}
            />
            {t.title}
          </label>
        ))}
        <p className={styles.hint}>
          {tapes.length === 0
            ? "ainda não há fitas. crie uma em mixtapes."
            : "a ordem e as notas de cada fita se ajustam no editor da mixtape."}
        </p>
      </fieldset>

      {notes.length > 0 && (
        <div className={styles.drNotes}>
          <p className={styles.label}>anotações</p>
          {notes.map((n) => (
            <div key={n.mixtapeId} className={styles.drNote}>
              <p className={styles.drNoteWhere}>
                <NoteMarkDecor />
                <Link
                  href={`/studio/mixtapes/${n.mixtapeId}`}
                  className={cx("nl", styles.drNoteLink)}
                >
                  {n.title} · faixa {pad(n.position)}
                </Link>
              </p>
              <p className={styles.drNoteText}>{n.note}</p>
            </div>
          ))}
        </div>
      )}

      {state && !state.ok && (
        <p role="alert" className={cx("msg-error", styles.drError)}>
          {state.error}
        </p>
      )}

      <div className={styles.drFoot}>
        {song ? (
          <button
            type="button"
            className={cx("del", styles.drDel)}
            onClick={() => onAskDelete(song)}
          >
            excluir música
          </button>
        ) : (
          <span />
        )}
        <span className={styles.drButtons}>
          <button
            type="button"
            className={cx("nl", styles.cancel)}
            onClick={onCancel}
          >
            cancelar
          </button>
          <button type="submit" className="btn" disabled={pending || !ready}>
            {pending ? "salvando…" : "salvar"}
          </button>
        </span>
      </div>
    </form>
  );
}

/** The star beside a note's place: decorative (the text says what it is). */
function NoteMarkDecor() {
  return (
    <span className={styles.mark} aria-hidden="true">
      <Sparkle kind={3} delay="-2.74s" sizes="11px" className={styles.star} />
      {!MARKS_CLEARED && "✦"}
    </span>
  );
}

function DeleteForm({
  song,
  onCancel,
  onDeleted,
}: {
  song: StudioSongRow;
  onCancel: () => void;
  onDeleted: (message: string) => void;
}) {
  const [state, dispatch, pending] = useActionState(
    async (prev: ActionResult | null, formData: FormData) => {
      const result = await deleteSongAction(prev, formData);
      if (result.ok) onDeleted(result.message);
      return result;
    },
    null,
  );
  const [, start] = useTransition();
  return (
    <form onSubmit={submitWith(dispatch, start)}>
      <input type="hidden" name="id" value={song.id} />
      <input type="hidden" name="confirmar" value="sim" />
      <p className={styles.label}>excluir música</p>
      <h2 id="cf-t" className={cx("rv", styles.cfTitle)}>
        excluir {song.title}?
      </h2>
      <p className={styles.cfText}>
        {leavesText(song)} as anotações dela também vão embora.
      </p>
      {state && !state.ok && (
        <p role="alert" className={cx("msg-error", styles.drError)}>
          {state.error}
        </p>
      )}
      <div className={styles.cfButtons}>
        <button
          type="button"
          className={cx("nl", styles.cancel)}
          onClick={onCancel}
        >
          cancelar
        </button>
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "excluindo…" : "excluir"}
        </button>
      </div>
    </form>
  );
}
