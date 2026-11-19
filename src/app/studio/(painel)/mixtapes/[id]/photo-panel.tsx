"use client";

import Image from "next/image";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useState,
  useTransition,
} from "react";

import { setMixtapeImageAction } from "../../../_actions/mixtapes";
import { call } from "../_ui/call";
import styles from "./editor.module.css";
import {
  type EditorImage,
  FOCUS_NAMES,
  FOCUS_POSITIONS,
  type ImageEdit,
  type LibraryImage,
} from "./types";

const MAX_BYTES = 4 * 1024 * 1024;

type Props = {
  slot: "cover" | "detail";
  tapeId: string;
  tapeTitle: string;
  image: EditorImage | null;
  edit: ImageEdit | null;
  onEdit: (imageId: string, patch: Partial<ImageEdit>) => void;
  /** An error from saving this photograph's fields. */
  error?: string;
  library: LibraryImage[];
  onMessage: (message: string) => void;
  /** Under the photograph (the support photo's caption). */
  caption?: string;
  /** Fields of the tape shown with the photograph (its caption). */
  children?: ReactNode;
  /** "onde a capa aparece". */
  previews?: ReactNode;
};

const COPY = {
  cover: {
    name: "capa",
    hint: "quadrada, de preferência 1600 × 1600px. é ela que representa a fita em todo lugar.",
    change: "trocar capa",
    add: "enviar capa",
    none: "nenhuma capa ainda.",
    current: "capa atual de",
  },
  detail: {
    name: "foto de apoio",
    hint: "vertical, 4 × 5. acompanha a reflexão, ao lado do texto.",
    change: "trocar foto",
    add: "enviar foto",
    none: "nenhuma foto de apoio ainda.",
    current: "foto de apoio atual de",
  },
} as const;

export function PhotoPanel({
  slot,
  tapeId,
  tapeTitle,
  image,
  edit,
  onEdit,
  error,
  library,
  onMessage,
  caption,
  children,
  previews,
}: Props) {
  const copy = COPY[slot];
  const uid = useId();
  const [mode, setMode] = useState<"upload" | "pick" | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [alt, setAlt] = useState("");
  const [rights, setRights] = useState(false);
  const [rightsNote, setRightsNote] = useState("");
  const [panelError, setPanelError] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the object URL lives as long as the chosen file
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function reset() {
    setMode(null);
    setFile(null);
    setFileUrl(null);
    setAlt("");
    setRights(false);
    setRightsNote("");
    setPanelError("");
  }

  function choose(chosen: File | undefined) {
    if (!chosen) return;
    setPanelError(
      chosen.size > MAX_BYTES ? "a foto passa de 4 MB. escolha uma menor." : "",
    );
    setFile(chosen);
    setMode("upload");
  }

  function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setPanelError("a foto passa de 4 MB. escolha uma menor.");
      return;
    }
    if (!alt.trim()) {
      setPanelError("descreva a foto para quem não pode vê-la.");
      document.getElementById(`${uid}-nalt`)?.focus();
      return;
    }
    start(async () => {
      const result = await call(setMixtapeImageAction, {
        id: tapeId,
        slot,
        file,
        alt,
        rightsConfirmed: rights ? "on" : "",
        rightsNote,
      });
      if (result.ok) {
        reset();
        onMessage(result.message);
      } else setPanelError(result.error);
    });
  }

  function link(imageId: string, message?: string) {
    setPanelError("");
    start(async () => {
      const result = await call(setMixtapeImageAction, {
        id: tapeId,
        slot,
        imageId,
      });
      if (result.ok) {
        setMode(null);
        onMessage(message ?? result.message);
      } else setPanelError(result.error);
    });
  }

  const choices = library.filter((i) => i.id !== image?.id);
  const ratio = slot === "cover" ? "1 / 1" : "4 / 5";
  const altCount = edit?.alt.length ?? 0;

  return (
    <div className={slot === "cover" ? styles.photoCover : styles.photoDetail}>
      <figure className={styles.figure}>
        {image && edit ? (
          <Image
            src={image.url}
            alt={`${copy.current} ${tapeTitle}`}
            width={image.width}
            height={image.height}
            unoptimized
            className={`${edit.treatment === "mood" ? "mood" : ""} ${styles.photo}`}
            style={{
              aspectRatio: ratio,
              objectPosition: FOCUS_POSITIONS[edit.focus],
            }}
          />
        ) : (
          <div className={styles.blank} style={{ aspectRatio: ratio }}>
            <span>{copy.none}</span>
          </div>
        )}
        {caption && image ? (
          <figcaption className={styles.figcaption}>{caption}</figcaption>
        ) : null}
        <div className={styles.photoActions}>
          <label className={`nl ${styles.fileLabel}`}>
            {image ? copy.change : copy.add}
            <input
              type="file"
              accept="image/jpeg,image/png"
              className={styles.fileInput}
              disabled={pending}
              onChange={(e) => {
                choose(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            className={`ghost ${styles.small}`}
            aria-expanded={mode === "pick"}
            onClick={() => {
              setPanelError("");
              setMode(mode === "pick" ? null : "pick");
            }}
          >
            escolher das fotos
          </button>
          {image ? (
            <button
              type="button"
              className={`ghost ${styles.small}`}
              disabled={pending}
              onClick={() =>
                link(
                  "",
                  slot === "cover"
                    ? "capa removida da fita."
                    : "foto de apoio removida da fita.",
                )
              }
            >
              remover
            </button>
          ) : null}
        </div>

        {mode === "upload" && file ? (
          <form className={styles.upload} onSubmit={upload} noValidate>
            <p className={styles.fieldLabel}>nova foto</p>
            {fileUrl ? (
              <div className={styles.uploadPreview}>
                <Image src={fileUrl} alt="" fill unoptimized sizes="96px" />
              </div>
            ) : null}
            <p className={styles.hintText}>{file.name}</p>
            <div className={styles.field}>
              <label htmlFor={`${uid}-nalt`} className={styles.fieldLabel}>
                descrição da imagem
              </label>
              <input
                id={`${uid}-nalt`}
                className={`fld ${styles.f15}`}
                value={alt}
                maxLength={300}
                onChange={(e) => setAlt(e.target.value)}
                aria-describedby={`${uid}-nalt-h`}
              />
              <p id={`${uid}-nalt-h`} className={styles.hintText}>
                para quem não vê a imagem. obrigatória.
              </p>
            </div>
            <label className={styles.check}>
              <input
                type="checkbox"
                className="chk"
                checked={rights}
                onChange={(e) => setRights(e.target.checked)}
              />
              tenho o direito de publicar esta foto
            </label>
            <div className={styles.field}>
              <label htmlFor={`${uid}-nnote`} className={styles.fieldLabel}>
                sobre os direitos
              </label>
              <input
                id={`${uid}-nnote`}
                className={`fld ${styles.f15}`}
                value={rightsNote}
                maxLength={500}
                onChange={(e) => setRightsNote(e.target.value)}
              />
              <p className={styles.hintText}>
                quem fez a foto, de onde ela vem. sem a confirmação acima, a
                foto fica guardada no studio mas não aparece no site.
              </p>
            </div>
            {panelError ? (
              <p role="alert" className={`msg-error ${styles.panelError}`}>
                {panelError}
              </p>
            ) : null}
            <div className={styles.uploadActions}>
              <button type="submit" className="btn" disabled={pending}>
                {pending ? "enviando…" : "enviar foto"}
              </button>
              <button
                type="button"
                className={`ghost ${styles.small}`}
                onClick={reset}
                disabled={pending}
              >
                cancelar
              </button>
            </div>
          </form>
        ) : null}

        {mode === "pick" ? (
          <div className={styles.picker}>
            <p className={styles.fieldLabel}>fotos já enviadas</p>
            {choices.length === 0 ? (
              <p className={styles.hintText}>
                nenhuma outra foto no studio ainda. envie uma nova.
              </p>
            ) : (
              <ul className={styles.pickList}>
                {choices.map((choice) => (
                  <li key={choice.id}>
                    <button
                      type="button"
                      className={styles.pick}
                      disabled={pending}
                      onClick={() => link(choice.id)}
                      aria-label={`usar ${choice.alt}${choice.rightsConfirmed ? "" : " (direitos não confirmados)"}`}
                    >
                      <Image
                        src={choice.url}
                        alt=""
                        width={64}
                        height={64}
                        unoptimized
                        className={choice.treatment === "mood" ? "mood" : ""}
                        style={{
                          objectFit: "cover",
                          objectPosition: FOCUS_POSITIONS[choice.focus],
                        }}
                      />
                      {choice.rightsConfirmed ? null : (
                        <span aria-hidden="true" className={styles.pickFlag}>
                          sem direitos
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        {mode !== "upload" && panelError ? (
          <p role="alert" className={`msg-error ${styles.panelError}`}>
            {panelError}
          </p>
        ) : null}
      </figure>

      <div className={styles.photoFields}>
        <p className={styles.photoName}>{copy.name}</p>
        <p className={styles.hintText}>{copy.hint}</p>
        {image ? (
          <p
            className={
              image.rightsConfirmed ? styles.rightsOk : styles.rightsMissing
            }
          >
            {image.rightsConfirmed
              ? "direitos confirmados: a foto pode aparecer no site."
              : "direitos não confirmados: esta foto não aparece no site enquanto você não confirmar que pode publicá-la."}
          </p>
        ) : (
          <p className={styles.rightsMissing}>{copy.none}</p>
        )}

        {children}

        {image && edit ? (
          <>
            <div className={styles.field}>
              <label htmlFor={`${uid}-alt`} className={styles.fieldLabel}>
                descrição da imagem
              </label>
              <input
                id={`${uid}-alt`}
                form="mx-form"
                className={`fld ${styles.f15}`}
                value={edit.alt}
                maxLength={300}
                onChange={(e) => onEdit(image.id, { alt: e.target.value })}
                aria-invalid={error ? true : undefined}
                aria-describedby={`${uid}-alt-h${error ? ` ${uid}-err` : ""}`}
              />
              <p id={`${uid}-alt-h`} className={styles.hintText}>
                {slot === "cover" ? "para quem não vê a imagem. " : ""}
                {altCount} caracteres.
              </p>
              {error ? (
                <p
                  id={`${uid}-err`}
                  role="alert"
                  className={`msg-error ${styles.fieldError}`}
                >
                  {error}
                </p>
              ) : null}
            </div>

            <div className={styles.focusRow}>
              <div
                role="group"
                aria-labelledby={`${uid}-focus`}
                className={styles.focusGrid}
              >
                {FOCUS_NAMES.map((name, k) => (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={edit.focus === k}
                    aria-label={`Foco: ${name}`}
                    onClick={() => onEdit(image.id, { focus: k })}
                  >
                    <span aria-hidden="true" />
                  </button>
                ))}
              </div>
              <div>
                <p id={`${uid}-focus`} className={styles.fieldLabel}>
                  ponto de foco
                </p>
                <p className={styles.focusName}>{FOCUS_NAMES[edit.focus]}</p>
                {slot === "cover" ? (
                  <p className={styles.hintText}>
                    o que nunca pode ser cortado
                  </p>
                ) : null}
              </div>
            </div>

            <div className={styles.segRow}>
              <span id={`${uid}-tone`} className={styles.hintText}>
                no site
              </span>
              <div
                role="group"
                aria-labelledby={`${uid}-tone`}
                className={styles.segGroup}
              >
                <button
                  type="button"
                  className="seg"
                  aria-pressed={edit.treatment === "original"}
                  onClick={() => onEdit(image.id, { treatment: "original" })}
                >
                  original
                </button>
                <button
                  type="button"
                  className="seg"
                  aria-pressed={edit.treatment === "mood"}
                  onClick={() => onEdit(image.id, { treatment: "mood" })}
                >
                  com o filtro do site
                </button>
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  form="mx-form"
                  className="chk"
                  checked={edit.rightsConfirmed}
                  onChange={(e) =>
                    onEdit(image.id, { rightsConfirmed: e.target.checked })
                  }
                />
                tenho o direito de publicar esta foto
              </label>
              <label htmlFor={`${uid}-note`} className={styles.fieldLabel}>
                sobre os direitos
              </label>
              <input
                id={`${uid}-note`}
                form="mx-form"
                className={`fld ${styles.f15}`}
                value={edit.rightsNote}
                maxLength={500}
                onChange={(e) =>
                  onEdit(image.id, { rightsNote: e.target.value })
                }
              />
              <p className={styles.hintText}>
                quem fez a foto, de onde ela vem.
                {image.usage.length > 1
                  ? ` esta foto também está em: ${image.usage
                      .filter(
                        (u) => !(u.kind === slot && u.label === tapeTitle),
                      )
                      .map((u) => u.label)
                      .join(", ")}. o que você muda aqui vale para todas.`
                  : ""}
              </p>
            </div>

            {previews}
          </>
        ) : null}
      </div>
    </div>
  );
}
