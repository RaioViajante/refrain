"use client";

import Image from "next/image";
import Link from "next/link";
import {
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
  useTransition,
} from "react";

import { updateImageAction } from "../../../_actions/site";
import {
  deleteMixtapeAction,
  saveMixtapeAction,
  saveTrackNoteAction,
  setMixtapePublishedAction,
} from "../../../_actions/mixtapes";
import { call, pad, setFlash as keepForList } from "../_ui/call";
import { ConfirmDialog, PublishSwitch } from "../_ui/confirm-dialog";
import styles from "./editor.module.css";
import { PhotoPanel } from "./photo-panel";
import { Tracklist } from "./tracklist";
import {
  editOf,
  type EditorImage,
  type EditorTape,
  FOCUS_POSITIONS,
  type ImageEdit,
  type LibraryImage,
  type NoteDraft,
  type TapeFields,
} from "./types";

type ControlProps = {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
};

type Props = {
  tape: EditorTape;
  themes: string[];
  /** The tape holding each featured place ("1"–"3"), other than this one. */
  holders: Record<string, string>;
  library: LibraryImage[];
  songs: { title: string; artist: string }[];
};

const KEYS = Object.keys({
  title: 0,
  slug: 0,
  theme: 0,
  feeling: 0,
  description: 0,
  reflection: 0,
  pullQuote: 0,
  pullQuoteCredit: 0,
  detailCaption: 0,
  playlistUrl: 0,
  year: 0,
  featuredRank: 0,
} satisfies Record<keyof TapeFields, 0>) as (keyof TapeFields)[];

function sameFields(a: TapeFields, b: TapeFields) {
  return KEYS.every((k) => a[k] === b[k]);
}

/** What the server stores for what was typed (trimmed; slug in lower case). */
function normalized(f: TapeFields): TapeFields {
  const out = { ...f };
  for (const k of KEYS) out[k] = out[k].replace(/\r\n?/g, "\n").trim();
  out.slug = out.slug.toLowerCase();
  out.feeling = out.feeling.toLowerCase();
  return out;
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function sameEdit(a: ImageEdit, b: ImageEdit) {
  return (
    a.alt === b.alt &&
    a.focus === b.focus &&
    a.treatment === b.treatment &&
    a.rightsConfirmed === b.rightsConfirmed &&
    a.rightsNote === b.rightsNote
  );
}

export function Editor({ tape, themes, holders, library, songs }: Props) {
  const saved = tape.fields;
  const [fields, setFields] = useState<TapeFields>(saved);
  const [imageEdits, setImageEdits] = useState<Record<string, ImageEdit>>({});
  const [drafts, setDrafts] = useState<Record<string, NoteDraft>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [deleting, setDeleting] = useState(false);

  const editFor = (image: EditorImage | null) =>
    image ? (imageEdits[image.id] ?? editOf(image)) : null;
  const cover = editFor(tape.cover);
  const detail = editFor(tape.detail);

  const fieldsDirty = !sameFields(fields, saved);
  const dirtyImages = [tape.cover, tape.detail].filter(
    (image, i, all): image is EditorImage =>
      image !== null &&
      all.findIndex((other) => other?.id === image.id) === i &&
      imageEdits[image.id] !== undefined &&
      !sameEdit(imageEdits[image.id]!, editOf(image)),
  );
  const dirtyNotes = tape.tracks.filter((t) => {
    const d = drafts[t.id];
    return d && (d.note !== t.note || d.noteSide !== t.noteSide);
  });
  const dirty = fieldsDirty || dirtyImages.length > 0 || dirtyNotes.length > 0;

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (name: keyof TapeFields, value: string) => {
    setFlash("");
    setFields((f) => ({ ...f, [name]: value }));
  };

  const onImageEdit = (imageId: string, patch: Partial<ImageEdit>) => {
    const image = [tape.cover, tape.detail].find((i) => i?.id === imageId);
    if (!image) return;
    setFlash("");
    setImageEdits((all) => ({
      ...all,
      [imageId]: { ...(all[imageId] ?? editOf(image)), ...patch },
    }));
  };

  const onDraft = useCallback((trackId: string, draft: NoteDraft) => {
    setFlash("");
    setDrafts((all) => ({ ...all, [trackId]: draft }));
  }, []);

  const onMessage = useCallback((message: string) => {
    setError("");
    setFlash(message);
  }, []);
  const onError = useCallback((message: string) => {
    setFlash("");
    setError(message);
  }, []);

  async function saveAll(): Promise<boolean> {
    setError("");
    setFlash("");
    const problems: string[] = [];

    if (fieldsDirty) {
      const sent = fields;
      const result = await call(saveMixtapeAction, { id: tape.id, ...sent });
      if (result.ok) {
        setFieldErrors({});
        setFields((now) => (sameFields(now, sent) ? normalized(sent) : now));
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        problems.push(result.error);
      }
    }

    const nextImageErrors: Record<string, string> = {};
    for (const image of dirtyImages) {
      const edit = imageEdits[image.id]!;
      const result = await call(updateImageAction, {
        id: image.id,
        alt: edit.alt,
        focus: String(edit.focus),
        treatment: edit.treatment,
        rightsConfirmed: edit.rightsConfirmed ? "on" : "",
        rightsNote: edit.rightsNote,
      });
      if (result.ok) {
        setImageEdits((all) => ({
          ...all,
          [image.id]: {
            ...edit,
            alt: edit.alt.trim(),
            rightsNote: edit.rightsNote.trim(),
          },
        }));
      } else {
        nextImageErrors[image.id] = result.error;
        problems.push(result.error);
      }
    }
    setImageErrors(nextImageErrors);

    for (const track of dirtyNotes) {
      const draft = drafts[track.id]!;
      const result = await call(saveTrackNoteAction, {
        trackId: track.id,
        note: draft.note,
        noteSide: draft.noteSide,
      });
      if (result.ok) {
        setDrafts((all) => ({
          ...all,
          [track.id]: { ...draft, note: draft.note.trim() },
        }));
      } else problems.push(`${track.title}: ${result.error}`);
    }

    if (problems.length > 0) {
      setError(problems[0]!);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>('main [aria-invalid="true"]')
          ?.focus(),
      );
      return false;
    }
    setFlash(dirty ? "salvo agora" : "tudo salvo");
    return true;
  }

  function save(event?: FormEvent) {
    event?.preventDefault();
    start(async () => {
      await saveAll();
    });
  }

  function togglePublished() {
    start(async () => {
      if (dirty && !(await saveAll())) return;
      const next = !tape.published;
      const result = await call(setMixtapePublishedAction, {
        id: tape.id,
        published: String(next),
      });
      if (result.ok) {
        setFlash(next ? "a fita está no site" : "a fita voltou a ser rascunho");
      } else setError(result.error);
    });
  }

  const status = pending
    ? "salvando…"
    : flash || (dirty ? "alterações não salvas" : "tudo salvo");

  // Live values for the previews.
  const title = fields.title.trim();
  const description = fields.description.trim();
  const noteCount = tape.tracks.filter(
    (t) => (drafts[t.id]?.note ?? t.note).trim() !== "",
  ).length;
  const coverImage = tape.cover;
  const coverStyle = cover
    ? { objectPosition: FOCUS_POSITIONS[cover.focus] }
    : undefined;
  const coverClass = cover?.treatment === "mood" ? "mood" : "";
  const coverThumb = (size: number, className: string | undefined) =>
    coverImage ? (
      <Image
        src={coverImage.url}
        alt=""
        width={size}
        height={size}
        unoptimized
        className={`${coverClass} ${className}`}
        style={coverStyle}
      />
    ) : (
      <span className={`${styles.thumbBlank} ${className}`} />
    );

  const field = (
    name: keyof TapeFields,
    label: string,
    control: (props: ControlProps) => ReactNode,
    hint?: ReactNode,
  ) => {
    const id = `mx-${name}`;
    const err = fieldErrors[name];
    const describedBy =
      [hint ? `${id}-h` : "", err ? `${id}-e` : ""].filter(Boolean).join(" ") ||
      undefined;
    return (
      <div className={styles.field}>
        <label htmlFor={id} className={styles.fieldLabel}>
          {label}
        </label>
        {control({
          id,
          "aria-invalid": err ? true : undefined,
          "aria-describedby": describedBy,
        })}
        {hint ? (
          <p id={`${id}-h`} className={styles.hintText}>
            {hint}
          </p>
        ) : null}
        {err ? (
          <p
            id={`${id}-e`}
            role="alert"
            className={`msg-error ${styles.fieldError}`}
          >
            {err}
          </p>
        ) : null}
      </div>
    );
  };

  const input =
    (
      name: keyof TapeFields,
      size: string | undefined,
      extra?: InputHTMLAttributes<HTMLInputElement>,
    ) =>
    // eslint-disable-next-line react/display-name -- called as a function, never rendered as a component
    (props: ControlProps) => (
      <input
        {...props}
        {...extra}
        form="mx-form"
        className={`fld ${size}`}
        value={fields[name]}
        onChange={(e) => set(name, e.target.value)}
      />
    );

  const rank = fields.featuredRank;
  const taken = rank ? holders[rank] : undefined;

  return (
    <>
      <div className={styles.bar}>
        <form
          id="mx-form"
          className={styles.barInner}
          onSubmit={save}
          noValidate
        >
          <Link
            href="/studio/mixtapes"
            className={`nl ${styles.back} ${styles.backBar}`}
            onClick={(e) => {
              if (dirty && !window.confirm("sair sem salvar as alterações?")) {
                e.preventDefault();
              }
            }}
          >
            ← mixtapes
          </Link>
          <span className={styles.barRight}>
            <p role="status" aria-live="polite" className={styles.status}>
              {dirty ? (
                <span aria-hidden="true" className={styles.dot} />
              ) : null}
              <i>{status}</i>
            </p>
            {error ? (
              <p role="alert" className={`msg-error ${styles.barError}`}>
                {error}
              </p>
            ) : null}
            {tape.published ? (
              <a
                href={`/mixtapes/${tape.savedSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`nl ${styles.barLink}`}
              >
                ver no site ↗
              </a>
            ) : (
              <a
                href={`/studio/previa/mixtapes/${tape.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`nl ${styles.barLink}`}
              >
                pré-visualizar ↗
              </a>
            )}
            <button type="submit" className="btn" disabled={pending}>
              {pending ? "salvando…" : "salvar"}
            </button>
          </span>
        </form>
      </div>

      <main id="conteudo" className={styles.main}>
        <Link
          href="/studio/mixtapes"
          className={`nl ${styles.back} ${styles.backMain}`}
        >
          ← mixtapes
        </Link>
        <div className={styles.hero}>
          <p className={styles.label}>Nº {pad(tape.number)} · editando</p>
          <p className={styles.page} aria-hidden="true">
            003
          </p>
          <h1 className={`t-in ${styles.title}`}>
            {title || <span className={styles.untitled}>sem título</span>}
          </h1>
          {description ? <p className={styles.lede}>{description}</p> : null}
        </div>

        <div className={styles.columns}>
          <div>
            {/* 01 — photographs */}
            <Section
              n="01"
              id="ed-01"
              title="capa e fotos"
              aside="a fita entra pelos olhos"
              first
            >
              <PhotoPanel
                slot="cover"
                tapeId={tape.id}
                tapeTitle={saved.title}
                image={tape.cover}
                edit={cover}
                onEdit={onImageEdit}
                error={tape.cover ? imageErrors[tape.cover.id] : undefined}
                library={library}
                onMessage={onMessage}
                previews={
                  <div className={styles.where}>
                    <p className={styles.fieldLabel}>onde a capa aparece</p>
                    <div className={styles.whereRow}>
                      <figure className={styles.whereFig}>
                        {coverThumb(56, styles.whereShelf)}
                        <figcaption>estante</figcaption>
                      </figure>
                      <figure className={styles.whereFig}>
                        <div className={styles.wherePage}>
                          {coverThumb(84, styles.wherePageImg)}
                          <span>{title}</span>
                        </div>
                        <figcaption>página</figcaption>
                      </figure>
                      <figure className={styles.whereFig}>
                        <div className={styles.whereShare}>
                          {coverThumb(48, styles.whereShareImg)}
                          <span>{title}</span>
                        </div>
                        <figcaption>compartilhamento</figcaption>
                      </figure>
                    </div>
                  </div>
                }
              />
              <PhotoPanel
                slot="detail"
                tapeId={tape.id}
                tapeTitle={saved.title}
                image={tape.detail}
                edit={detail}
                onEdit={onImageEdit}
                error={tape.detail ? imageErrors[tape.detail.id] : undefined}
                library={library}
                onMessage={onMessage}
                caption={fields.detailCaption.trim()}
              >
                {field(
                  "detailCaption",
                  "legenda",
                  input("detailCaption", styles.f15, { maxLength: 200 }),
                  "começa com “fig. 2 —” e descreve o lugar, não o sentimento.",
                )}
              </PhotoPanel>
              <p className={styles.photoNote}>
                fotos dos seus próprios lugares — sem placas, cidades ou
                cartões-postais. o filtro do site entra sozinho, a menos que
                você escolha o original.
              </p>
            </Section>

            {/* 02 — texts */}
            <Section
              n="02"
              id="ed-02"
              title="textos"
              aside="o que a fita diz de si"
            >
              {field(
                "title",
                "título",
                input("title", styles.f20, { maxLength: 120 }),
                "caixa baixa, sem ponto final — como todos os títulos do site.",
              )}
              <div className={styles.pair}>
                {field(
                  "theme",
                  "tema",
                  input("theme", styles.f20, {
                    maxLength: 120,
                    list: "mx-temas",
                    autoComplete: "off",
                  }),
                  "escolha um tema da estante ou escreva outro.",
                )}
                {field(
                  "feeling",
                  "sentimento",
                  input("feeling", styles.f20, {
                    maxLength: 30,
                    autoComplete: "off",
                  }),
                  "uma ou duas palavras. é o filtro do catálogo.",
                )}
              </div>
              <datalist id="mx-temas">
                {themes.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              {field(
                "description",
                "frase da fita",
                input("description", styles.f20, { maxLength: 600 }),
                "uma linha. aparece em itálico logo abaixo do título.",
              )}
              {field(
                "reflection",
                "reflexão",
                (props) => (
                  <textarea
                    {...props}
                    form="mx-form"
                    className={`fld ${styles.reflection}`}
                    rows={7}
                    maxLength={20000}
                    value={fields.reflection}
                    onChange={(e) => set("reflection", e.target.value)}
                  />
                ),
                "parágrafos separados por uma linha em branco. o último parágrafo fica em itálico.",
              )}
              <div className={styles.pair}>
                {field(
                  "pullQuote",
                  "citação da pausa",
                  input("pullQuote", styles.f17, { maxLength: 600 }),
                )}
                {field(
                  "pullQuoteCredit",
                  "sobre a citação",
                  input("pullQuoteCredit", styles.f17, { maxLength: 200 }),
                )}
              </div>
            </Section>

            {/* 03 — tracks */}
            <Section
              n="03"
              id="ed-03"
              title="faixas e notas"
              aside={`${count(tape.tracks.length, "faixa", "faixas")} · ${count(noteCount, "nota", "notas")}`}
            >
              <Tracklist
                tapeId={tape.id}
                tracks={tape.tracks}
                drafts={drafts}
                onDraft={onDraft}
                songs={songs}
                onMessage={onMessage}
                onError={onError}
              />
            </Section>

            {/* 04 — publishing */}
            <Section
              n="04"
              id="ed-04"
              title="publicação"
              aside="quando a fita vai para a estante"
            >
              <div className={styles.pairWide}>
                {field(
                  "playlistUrl",
                  "link da playlist",
                  input("playlistUrl", styles.f15, {
                    maxLength: 500,
                    inputMode: "url",
                    autoComplete: "off",
                  }),
                  "abre no Spotify. o refrain não toca música.",
                )}
                {field(
                  "year",
                  "guardada desde",
                  input("year", styles.f15, {
                    maxLength: 4,
                    inputMode: "numeric",
                    autoComplete: "off",
                  }),
                  "o ano, com quatro dígitos.",
                )}
              </div>
              {field(
                "slug",
                "endereço",
                (props) => (
                  <div className={styles.slug}>
                    <span aria-hidden="true">/mixtapes/</span>
                    <input
                      {...props}
                      form="mx-form"
                      className={`fld ${styles.f15}`}
                      maxLength={80}
                      autoComplete="off"
                      spellCheck={false}
                      value={fields.slug}
                      onChange={(e) => set("slug", e.target.value)}
                    />
                  </div>
                ),
                tape.published
                  ? "só letras minúsculas, números e hífens. a fita já está no site: mudar o endereço quebra os links antigos."
                  : "só letras minúsculas, números e hífens. é o fim do link da fita.",
              )}

              <div className={styles.field}>
                <p id="mx-rank-l" className={styles.fieldLabel}>
                  destaque na home
                </p>
                <div
                  role="group"
                  aria-labelledby="mx-rank-l"
                  className={styles.segGroup}
                >
                  {(["", "1", "2", "3"] as const).map((r) => (
                    <button
                      key={r || "0"}
                      type="button"
                      className="seg"
                      aria-pressed={rank === r}
                      onClick={() => set("featuredRank", r)}
                    >
                      {r ? `${r}º lugar` : "nenhum"}
                    </button>
                  ))}
                </div>
                <p className={styles.hintText}>
                  {(["1", "2", "3"] as const)
                    .map(
                      (r) =>
                        `${r}º: ${rank === r ? "esta fita" : (holders[r] ?? "livre")}`,
                    )
                    .join(" · ")}
                </p>
                {taken && rank !== saved.featuredRank ? (
                  <p className={styles.rankMove}>
                    ao salvar, {taken} sai do {rank}º lugar e esta fita entra.
                  </p>
                ) : null}
                {fieldErrors.featuredRank ? (
                  <p role="alert" className={`msg-error ${styles.fieldError}`}>
                    {fieldErrors.featuredRank}
                  </p>
                ) : null}
              </div>

              <div className={styles.stateRow}>
                <span className={styles.stateLeft}>
                  <span className={styles.hintText}>estado</span>
                  <PublishSwitch
                    published={tape.published}
                    disabled={pending}
                    onToggle={togglePublished}
                  />
                </span>
                <span className={styles.stateRight}>
                  <a
                    href={`/studio/previa/mixtapes/${tape.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`nl ${styles.small}`}
                  >
                    pré-visualizar ↗
                  </a>
                  <button
                    type="button"
                    className={`ghost ${styles.small}`}
                    onClick={() => setDeleting(true)}
                  >
                    excluir esta fita…
                  </button>
                </span>
              </div>
              <p className={styles.hintText}>
                {tape.published
                  ? "publicada: a fita está na estante do site."
                  : "rascunho: só você vê, aqui e na pré-visualização."}
                {dirty ? " ao publicar, as alterações são salvas antes." : ""}
              </p>
            </Section>
          </div>

          <div className={styles.asideCol}>
            <aside aria-label="Prévia" className={styles.preview}>
              <p className={styles.fieldLabel}>prévia da abertura</p>
              <div className={styles.previewBox}>
                <p className={styles.previewLabel}>
                  Nº {pad(tape.number)}
                  {fields.theme.trim() ? ` · ${fields.theme.trim()}` : ""}
                </p>
                <div className={styles.previewArt}>
                  {coverThumb(230, styles.previewImg)}
                  <p className={styles.previewTitle}>{title}</p>
                  {description ? (
                    <p className={styles.previewDesc}>{description}</p>
                  ) : null}
                </div>
                <p className={styles.previewMeta}>
                  {count(tape.tracks.length, "faixa", "faixas")}
                  {/^\d{4}$/.test(fields.year.trim())
                    ? ` · desde ${fields.year.trim()}`
                    : ""}
                  {` · ${count(noteCount, "nota", "notas")}`}
                </p>
              </div>
              <p className={styles.hintText}>
                muda enquanto você escreve. as fotos já aparecem como no site.
              </p>
            </aside>
          </div>
        </div>
      </main>

      {deleting ? (
        <ConfirmDialog
          label="excluir fita"
          heading={`excluir ${saved.title}?`}
          confirmLabel="excluir fita"
          action={deleteMixtapeAction}
          fields={{ id: tape.id }}
          onCancel={() => setDeleting(false)}
          onSubmit={() => keepForList(`${saved.title} foi excluída`)}
        >
          a fita sai da estante e do site, com a lista de faixas e as notas
          dela. as músicas continuam guardadas no catálogo.
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function Section({
  n,
  id,
  title,
  aside,
  first,
  children,
}: {
  n: string;
  id: string;
  title: string;
  aside: string;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={first ? styles.sectionFirst : styles.section}
    >
      <div className={styles.sectionHead}>
        <h2 className={`rv ${styles.sectionTitle}`}>
          <span id={id}>{title}</span>
        </h2>
        <span className={styles.sectionAside}>
          <span className={styles.sectionNote}>{aside}</span>
          <span className={styles.sectionNo}>{n}</span>
        </span>
      </div>
      {children}
    </section>
  );
}
