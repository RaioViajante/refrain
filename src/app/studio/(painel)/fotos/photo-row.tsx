"use client";

import {
  type FormEvent,
  useActionState,
  useRef,
  useState,
  useTransition,
} from "react";

import { cx } from "@/lib/cx";
import type { ActionResult } from "@/server/studio/errors";

import { deleteImageAction, updateImageAction } from "../../_actions/site";
import { FocusGrid } from "./focus-grid";
import styles from "./page.module.css";
import type { StudioPhoto } from "./photo-types";
import { Thumb } from "./thumb";

function useSubmit(dispatch: (formData: FormData) => void) {
  const [, start] = useTransition();
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    start(() => dispatch(formData));
  };
}

/** A photo in the library: what it is, where it is used, and its controls. */
export function PhotoRow({
  photo,
  onDeleted,
}: {
  photo: StudioPhoto;
  /** Called once the photo is gone (its row disappears with it). */
  onDeleted: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [removed, remove, removing] = useActionState(
    async (prev: ActionResult | null, formData: FormData) => {
      const done = await deleteImageAction(prev, formData);
      if (done.ok) onDeleted(done.message);
      return done;
    },
    null,
  );
  const submitDelete = useSubmit(remove);
  const panelId = `foto-${photo.id}-editar`;
  const name = photo.alt || "foto sem descrição";

  return (
    <li className={cx("row", styles.photo)}>
      <div className={styles.photoMain}>
        <div className={styles.thumbBox}>
          <Thumb
            url={photo.url}
            alt={photo.alt}
            focus={photo.focus}
            treatment={photo.treatment}
            className={styles.thumb}
          />
        </div>
        <div className={styles.photoInfo}>
          <p className={styles.alt}>{name}</p>
          <p className={styles.meta}>
            {photo.width} × {photo.height} px ·{" "}
            {photo.treatment === "mood" ? "com o filtro do site" : "original"}
          </p>
          <p className={styles.meta}>
            {photo.usage.length > 0
              ? `em uso: ${photo.usage.join(" · ")}`
              : "em nenhum lugar"}
          </p>
          <Rights confirmed={photo.rightsConfirmed} note={photo.rightsNote} />
        </div>
        <div className={styles.photoActions}>
          <button
            ref={editRef}
            type="button"
            className={cx("nl", styles.textButton)}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`editar: ${name}`}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "fechar" : "editar"}
          </button>
          {asking ? null : (
            <button
              ref={deleteRef}
              type="button"
              className={cx("del", styles.textButton)}
              aria-label={`excluir: ${name}`}
              onClick={() => {
                setAsking(true);
                requestAnimationFrame(() => confirmRef.current?.focus());
              }}
            >
              excluir
            </button>
          )}
        </div>
      </div>

      {asking ? (
        <form onSubmit={submitDelete} className={styles.confirm}>
          <input type="hidden" name="id" value={photo.id} />
          <input type="hidden" name="confirmar" value="sim" />
          <p className={styles.confirmText}>
            excluir esta foto da biblioteca? o arquivo é apagado e não volta.
          </p>
          <button
            ref={confirmRef}
            type="submit"
            className="btn"
            disabled={removing}
          >
            {removing ? "excluindo…" : "sim, excluir"}
          </button>
          <button
            type="button"
            className={cx("ghost", styles.textButton)}
            onClick={() => {
              setAsking(false);
              requestAnimationFrame(() => deleteRef.current?.focus());
            }}
          >
            cancelar
          </button>
        </form>
      ) : null}
      <p role="alert" className={cx("msg-error", styles.msg, styles.rowMsg)}>
        {removed && !removed.ok ? removed.error : ""}
      </p>

      {open ? (
        <EditPanel
          id={panelId}
          photo={photo}
          onClose={() => {
            setOpen(false);
            requestAnimationFrame(() => editRef.current?.focus());
          }}
        />
      ) : null}
    </li>
  );
}

function Rights({ confirmed, note }: { confirmed: boolean; note: string }) {
  return confirmed ? (
    <p className={styles.meta}>
      direitos confirmados{note ? ` — ${note}` : ""}
    </p>
  ) : (
    <p className={styles.off}>
      <span className={styles.offTag}>fora do site</span>
      <span>direitos não confirmados: esta foto nunca aparece no site.</span>
    </p>
  );
}

function EditPanel({
  id,
  photo,
  onClose,
}: {
  id: string;
  photo: StudioPhoto;
  onClose: () => void;
}) {
  const [focus, setFocus] = useState(photo.focus);
  const [treatment, setTreatment] = useState(photo.treatment);
  const [result, dispatch, pending] = useActionState(updateImageAction, null);
  const submit = useSubmit(dispatch);
  const fid = (n: string) => `${id}-${n}`;
  const failed = result !== null && !result.ok;
  const altBad = failed && /^descreva|^a descrição/.test(result.error);

  return (
    <form id={id} onSubmit={submit} className={styles.edit}>
      <input type="hidden" name="id" value={photo.id} />
      <input type="hidden" name="treatment" value={treatment} />
      <div className={styles.editPreview}>
        <div className={styles.editFrame}>
          <Thumb
            url={photo.url}
            alt=""
            focus={focus}
            treatment={treatment}
            className={styles.thumb}
          />
        </div>
        <p className={styles.help}>recorte quadrado, como na estante.</p>
      </div>
      <div className={styles.editFields}>
        <div>
          <label htmlFor={fid("alt")} className={styles.label}>
            descrição da imagem
          </label>
          <input
            id={fid("alt")}
            name="alt"
            defaultValue={photo.alt}
            maxLength={300}
            className={cx("fld", styles.small)}
            aria-invalid={altBad || undefined}
            aria-describedby={altBad ? fid("erro") : undefined}
          />
        </div>
        <FocusGrid id={fid("foco")} value={focus} onChange={setFocus} />
        <div className={styles.segRow}>
          <span className={styles.help} id={fid("trat")}>
            como a foto aparece
          </span>
          <div
            role="group"
            aria-labelledby={fid("trat")}
            className={styles.segs}
          >
            <button
              type="button"
              className="seg"
              aria-pressed={treatment === "mood"}
              onClick={() => setTreatment("mood")}
            >
              com o filtro do site
            </button>
            <button
              type="button"
              className={cx("seg", styles.segNext)}
              aria-pressed={treatment === "original"}
              onClick={() => setTreatment("original")}
            >
              original
            </button>
          </div>
        </div>
        <label className={styles.check}>
          <input
            type="checkbox"
            name="rightsConfirmed"
            defaultChecked={photo.rightsConfirmed}
            className="chk"
          />
          <span>tenho o direito de publicar esta foto</span>
        </label>
        <div>
          <label htmlFor={fid("nota")} className={styles.label}>
            de onde ela vem
          </label>
          <textarea
            id={fid("nota")}
            name="rightsNote"
            rows={2}
            maxLength={500}
            defaultValue={photo.rightsNote}
            className={cx("fld", styles.small)}
          />
        </div>
        <div className={styles.actions}>
          <button type="submit" className="btn" disabled={pending}>
            {pending ? "salvando…" : "salvar"}
          </button>
          <button
            type="button"
            className={cx("ghost", styles.textButton)}
            onClick={onClose}
          >
            fechar
          </button>
          <p role="status" className={cx("msg-ok", styles.msg)}>
            {!pending && result?.ok ? result.message : ""}
          </p>
        </div>
        <p
          id={fid("erro")}
          role="alert"
          className={cx("msg-error", styles.msg)}
        >
          {failed ? result.error : ""}
        </p>
      </div>
    </form>
  );
}
