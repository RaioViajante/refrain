"use client";

import {
  type FormEvent,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { Sparkle } from "@/components/marks";

import {
  addTrackAction,
  moveTrackAction,
  removeTrackAction,
} from "../../../_actions/mixtapes";
import { call, pad } from "../_ui/call";
import { ConfirmDialog } from "../_ui/confirm-dialog";
import styles from "./editor.module.css";
import type { EditorTrack, NoteDraft } from "./types";

/** The tracks the public page shows as sides A and B. */
const SIDES = 20;
/** Tracks of the rest of the tape shown before "mostrar as N faixas". */
const PEEK = 6;

type Props = {
  tapeId: string;
  tracks: EditorTrack[];
  drafts: Record<string, NoteDraft>;
  onDraft: (trackId: string, draft: NoteDraft) => void;
  songs: { title: string; artist: string }[];
  onMessage: (message: string) => void;
  onError: (message: string) => void;
};

export function Tracklist({
  tapeId,
  tracks,
  drafts,
  onDraft,
  songs,
  onMessage,
  onError,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<EditorTrack | null>(null);
  const [, start] = useTransition();
  const refocus = useRef<string | null>(null);

  // After a reorder or removal, keep keyboard focus where it was.
  useEffect(() => {
    const key = refocus.current;
    if (!key) return;
    refocus.current = null;
    const [id] = key.split(":");
    const target =
      document.querySelector<HTMLButtonElement>(
        `[data-focus="${key}"]:not(:disabled)`,
      ) ??
      document.querySelector<HTMLButtonElement>(
        `[data-focus^="${id}:"]:not(:disabled)`,
      );
    target?.focus();
  }, [tracks]);

  const tracksRef = useRef(tracks);
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  const move = useCallback(
    (track: EditorTrack, direction: "up" | "down") => {
      refocus.current = `${track.id}:${direction}`;
      const i = tracksRef.current.findIndex((t) => t.id === track.id);
      setBusy(true);
      start(async () => {
        const result = await call(moveTrackAction, {
          trackId: track.id,
          direction,
        });
        setBusy(false);
        if (result.ok) {
          onMessage(
            `${track.title} agora é a faixa ${pad(direction === "up" ? i : i + 2)}`,
          );
        } else onError(result.error);
      });
    },
    [onMessage, onError],
  );

  const toggle = useCallback((id: string) => {
    setOpenId((current) => (current === id ? null : id));
  }, []);

  const head = tracks.slice(0, SIDES);
  const rest = tracks.slice(SIDES);

  const row = (track: EditorTrack, i: number) => (
    <TrackRow
      key={track.id}
      track={track}
      index={i}
      last={i === tracks.length - 1}
      open={openId === track.id}
      draft={drafts[track.id]}
      busy={busy}
      onMove={move}
      onToggle={toggle}
      onRemove={setRemoving}
      onDraft={onDraft}
    />
  );

  return (
    <>
      <p className={styles.sectionHint}>
        as 20 primeiras são os lados A e B da página. use ↑ ↓ para mudar a ordem
        e “nota” para escrever na margem.
      </p>
      {tracks.length === 0 ? (
        <p className={styles.emptyTracks}>
          nenhuma faixa ainda. adicione a primeira música abaixo.
        </p>
      ) : (
        <ol className={styles.tracks}>
          {head.map((track, i) => (
            <SideMarker key={track.id} index={i}>
              {row(track, i)}
            </SideMarker>
          ))}
        </ol>
      )}

      <AddTrack
        tapeId={tapeId}
        songs={songs}
        count={tracks.length}
        onMessage={onMessage}
      />

      {rest.length > 0 ? (
        <div className={styles.whole}>
          <p className={styles.fieldLabel} id="mx-inteira">
            a fita inteira · faixas {SIDES + 1} — {tracks.length}
          </p>
          {showAll ? (
            <ol
              className={styles.tracks}
              start={SIDES + 1}
              aria-labelledby="mx-inteira"
            >
              {rest.map((track, k) => row(track, SIDES + k))}
            </ol>
          ) : (
            <ol className={styles.peek} aria-labelledby="mx-inteira">
              {rest.slice(0, PEEK).map((track, k) => (
                <li key={track.id} className={styles.peekRow}>
                  <span className={styles.trackNo}>{pad(SIDES + k + 1)}</span>
                  <span className={styles.peekTitle}>
                    <b>{track.title}</b>
                    <span className={styles.peekArtist}>
                      <span className={styles.peekDot}> · </span>
                      {track.artist}
                    </span>
                  </span>
                  <span className={styles.peekArtistDesk}>{track.artist}</span>
                  <NoteMark has={Boolean(track.note)} />
                </li>
              ))}
            </ol>
          )}
          <button
            type="button"
            className={`nl ${styles.more}`}
            aria-expanded={showAll}
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? "recolher" : `mostrar as ${rest.length} faixas`}
          </button>
        </div>
      ) : null}

      {removing ? (
        <ConfirmDialog
          key={removing.id}
          label="tirar faixa"
          heading={`tirar ${removing.title} da fita?`}
          confirmLabel="tirar da fita"
          pendingLabel="tirando…"
          action={removeTrackAction}
          fields={{ trackId: removing.id }}
          onCancel={() => setRemoving(null)}
          onDone={() => {
            const i = tracksRef.current.findIndex((t) => t.id === removing.id);
            const next =
              tracksRef.current[i + 1] ?? tracksRef.current[i - 1] ?? null;
            setRemoving(null);
            onMessage(`${removing.title} saiu da fita`);
            // After the dialog closes, keep focus in the list.
            requestAnimationFrame(() =>
              (next
                ? document.querySelector<HTMLButtonElement>(
                    `[data-focus="${next.id}:rm"]`,
                  )
                : document.getElementById("mx-nt")
              )?.focus(),
            );
          }}
        >
          {removing.note ? "a anotação dessa faixa vai junto. " : ""}a música
          continua guardada no catálogo, e as faixas seguintes sobem uma
          posição.
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function SideMarker({
  index,
  children,
}: {
  index: number;
  children: ReactNode;
}) {
  const label =
    index === 0
      ? "lado A · em destaque"
      : index === 10
        ? "lado B · em destaque"
        : null;
  return (
    <>
      {label ? (
        <li aria-hidden="true" className={styles.side}>
          {label}
        </li>
      ) : null}
      {children}
    </>
  );
}

function NoteMark({ has }: { has: boolean }) {
  if (!has) return <span />;
  return (
    <span className={styles.noteMark}>
      <Sparkle kind={3} style={{ width: 11 }} sizes="11px" />
      <span aria-hidden="true">✦</span>
      <span className="visually-hidden">tem anotação</span>
    </span>
  );
}

type RowProps = {
  track: EditorTrack;
  index: number;
  last: boolean;
  open: boolean;
  draft: NoteDraft | undefined;
  busy: boolean;
  onMove: (track: EditorTrack, direction: "up" | "down") => void;
  onToggle: (id: string) => void;
  onRemove: (track: EditorTrack) => void;
  onDraft: (trackId: string, draft: NoteDraft) => void;
};

const TrackRow = memo(function TrackRow({
  track,
  index,
  last,
  open,
  draft,
  busy,
  onMove,
  onToggle,
  onRemove,
  onDraft,
}: RowProps) {
  const note = draft?.note ?? track.note;
  const side = draft?.noteSide ?? track.noteSide;
  const unsaved =
    draft !== undefined &&
    (draft.note !== track.note || draft.noteSide !== track.noteSide);
  const panel = `nota-${track.id}`;
  return (
    <li className={`row ${styles.track}`}>
      <div className={styles.trackLine}>
        <span className={styles.arrows}>
          <button
            type="button"
            className="arw2"
            data-focus={`${track.id}:up`}
            disabled={index === 0 || busy}
            aria-label={`Subir ${track.title}`}
            onClick={() => onMove(track, "up")}
          >
            ↑
          </button>
          <button
            type="button"
            className="arw2"
            data-focus={`${track.id}:down`}
            disabled={last || busy}
            aria-label={`Descer ${track.title}`}
            onClick={() => onMove(track, "down")}
          >
            ↓
          </button>
        </span>
        <span className={styles.trackNo}>{pad(index + 1)}</span>
        <span className={styles.trackTitle}>
          {track.title}
          <span className={styles.trackArtistMobile}>{track.artist}</span>
        </span>
        <span className={styles.trackArtist}>{track.artist}</span>
        <button
          type="button"
          className={styles.noteBtn}
          data-focus={`${track.id}:note`}
          aria-expanded={open}
          aria-controls={open ? panel : undefined}
          onClick={() => onToggle(track.id)}
        >
          {note ? (
            <>
              <Sparkle kind={3} style={{ width: 11 }} sizes="11px" />
              <span aria-hidden="true" className={styles.noteStar}>
                ✦
              </span>
            </>
          ) : null}
          {note ? "nota" : "+ nota"}
          {unsaved ? <span aria-hidden="true">*</span> : null}
          <span className="visually-hidden">
            {" "}
            de {track.title}
            {unsaved ? " (não salva)" : ""}
          </span>
        </button>
        <button
          type="button"
          className={`ghost ${styles.remove}`}
          data-focus={`${track.id}:rm`}
          aria-label={`Tirar ${track.title} da fita`}
          onClick={() => onRemove(track)}
        >
          ×
        </button>
      </div>
      {open ? (
        <div id={panel} className={styles.notePanel}>
          <label htmlFor={`${panel}-t`} className={styles.fieldLabel}>
            anotação de margem
          </label>
          <textarea
            id={`${panel}-t`}
            className={`fld ${styles.noteText}`}
            rows={2}
            maxLength={1000}
            value={note}
            placeholder="o que essa música guarda?"
            onChange={(e) =>
              onDraft(track.id, { note: e.target.value, noteSide: side })
            }
          />
          <div className={styles.noteSide}>
            <span id={`${panel}-s`} className={styles.hintText}>
              aparece na margem
            </span>
            <div
              role="group"
              aria-labelledby={`${panel}-s`}
              className={styles.segGroup}
            >
              <button
                type="button"
                className="seg"
                aria-pressed={side === "left"}
                onClick={() => onDraft(track.id, { note, noteSide: "left" })}
              >
                esquerda
              </button>
              <button
                type="button"
                className="seg"
                aria-pressed={side === "right"}
                onClick={() => onDraft(track.id, { note, noteSide: "right" })}
              >
                direita
              </button>
            </div>
          </div>
          {unsaved ? (
            <p className={styles.hintText}>
              ainda não salva. use “salvar”, no alto da página.
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
});

function AddTrack({
  tapeId,
  songs,
  count,
  onMessage,
}: {
  tapeId: string;
  songs: { title: string; artist: string }[];
  count: number;
  onMessage: (message: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);

  function pickTitle(value: string) {
    setTitle(value);
    const matches = songs.filter(
      (s) => s.title.toLowerCase() === value.trim().toLowerCase(),
    );
    if (matches.length === 1 && !artist.trim()) setArtist(matches[0]!.artist);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    start(async () => {
      const result = await call(addTrackAction, {
        mixtapeId: tapeId,
        title,
        artist,
      });
      if (result.ok) {
        setErrors({});
        setTitle("");
        setArtist("");
        onMessage(
          `${title.trim()} entrou na fita, como faixa ${pad(count + 1)}`,
        );
        titleRef.current?.focus();
      } else {
        setErrors(result.fieldErrors ?? {});
        setError(result.fieldErrors ? "" : result.error);
      }
    });
  }

  return (
    <form className={styles.add} onSubmit={submit} noValidate>
      <div>
        <label htmlFor="mx-nt" className={styles.fieldLabel}>
          música
        </label>
        <input
          ref={titleRef}
          id="mx-nt"
          className={`fld ${styles.f17}`}
          list="mx-catalogo"
          autoComplete="off"
          placeholder="buscar no catálogo ou escrever"
          value={title}
          maxLength={200}
          onChange={(e) => pickTitle(e.target.value)}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? "mx-nt-e" : undefined}
        />
        {errors.title ? (
          <p
            id="mx-nt-e"
            role="alert"
            className={`msg-error ${styles.fieldError}`}
          >
            {errors.title}
          </p>
        ) : null}
        <datalist id="mx-catalogo">
          {songs.map((s) => (
            <option key={`${s.title}\u0000${s.artist}`} value={s.title}>
              {s.artist}
            </option>
          ))}
        </datalist>
      </div>
      <div>
        <label htmlFor="mx-na" className={styles.fieldLabel}>
          artista
        </label>
        <input
          id="mx-na"
          className={`fld ${styles.f17}`}
          autoComplete="off"
          value={artist}
          maxLength={200}
          onChange={(e) => setArtist(e.target.value)}
          aria-invalid={errors.artist ? true : undefined}
          aria-describedby={errors.artist ? "mx-na-e" : undefined}
        />
        {errors.artist ? (
          <p
            id="mx-na-e"
            role="alert"
            className={`msg-error ${styles.fieldError}`}
          >
            {errors.artist}
          </p>
        ) : null}
      </div>
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "adicionando…" : "+ adicionar"}
      </button>
      {error ? (
        <p role="alert" className={`msg-error ${styles.addError}`}>
          {error}
        </p>
      ) : null}
    </form>
  );
}
