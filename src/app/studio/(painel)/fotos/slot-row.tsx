"use client";

import { type FormEvent, useActionState, useState, useTransition } from "react";

import { cx } from "@/lib/cx";

import { setSiteImageAction } from "../../_actions/site";
import styles from "./page.module.css";
import type { StudioPhoto } from "./photo-types";
import { Thumb } from "./thumb";
import { UploadForm } from "./upload-form";

/** One fixed place on the site: its photo, and how to change it. */
export function SlotRow({
  slot,
  label,
  current,
  library,
  fallback,
}: {
  slot: string;
  label: string;
  current: StudioPhoto | null;
  library: StudioPhoto[];
  fallback: string | null;
}) {
  const [uploading, setUploading] = useState(false);
  const [result, dispatch, pending] = useActionState(setSiteImageAction, null);
  const [, start] = useTransition();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    start(() => dispatch(formData));
  };
  const base = `lugar-${slot.replace(/\./g, "-")}`;
  const failed = result !== null && !result.ok;

  return (
    <li className={styles.slot}>
      <div className={styles.slotBox}>
        {current ? (
          <Thumb
            url={current.url}
            alt={current.alt}
            focus={current.focus}
            treatment={current.treatment}
            className={styles.thumb}
          />
        ) : (
          <span className={styles.slotEmpty}>vazio</span>
        )}
      </div>
      <div className={styles.slotInfo}>
        <p className={styles.slotLabel} id={`${base}-nome`}>
          {label}
        </p>
        <p className={styles.meta}>
          {current
            ? current.alt
            : (fallback ?? "vazio: o lugar fica em branco no site.")}
        </p>
        {current && !current.rightsConfirmed ? (
          <p className={styles.off}>
            <span className={styles.offTag}>fora do site</span>
            <span>
              a foto deste lugar não tem os direitos confirmados: no site, o
              lugar fica em branco.
            </span>
          </p>
        ) : null}

        <div className={styles.slotControls}>
          {library.length > 0 ? (
            <form onSubmit={submit} className={styles.choose}>
              <input type="hidden" name="slot" value={slot} />
              <div className={styles.chooseField}>
                <label htmlFor={`${base}-foto`} className={styles.label}>
                  escolher da biblioteca
                </label>
                <select
                  id={`${base}-foto`}
                  name="imageId"
                  defaultValue={current?.id ?? ""}
                  required
                  className={cx("fld", styles.small)}
                  aria-describedby={failed ? `${base}-erro` : undefined}
                >
                  <option value="" disabled>
                    escolha uma foto
                  </option>
                  {library.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.alt}
                      {p.rightsConfirmed ? "" : " (fora do site)"}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="btn"
                disabled={pending}
                aria-describedby={`${base}-nome`}
              >
                colocar
              </button>
            </form>
          ) : null}
          <div className={styles.slotLinks}>
            <button
              type="button"
              className={cx("nl", styles.textButton)}
              aria-expanded={uploading}
              aria-controls={`${base}-enviar`}
              onClick={() => setUploading((u) => !u)}
            >
              {uploading ? "fechar o envio" : "enviar uma foto nova para cá"}
            </button>
            {current ? (
              <form onSubmit={submit}>
                <input type="hidden" name="slot" value={slot} />
                <button
                  type="submit"
                  className={cx("del", styles.textButton)}
                  disabled={pending}
                  aria-label={`esvaziar: ${label}`}
                >
                  esvaziar
                </button>
              </form>
            ) : null}
          </div>
          <p role="status" className={cx("msg-ok", styles.msg)}>
            {!pending && result?.ok ? result.message : ""}
          </p>
          <p
            id={`${base}-erro`}
            role="alert"
            className={cx("msg-error", styles.msg)}
          >
            {failed ? result.error : ""}
          </p>
        </div>
        {uploading ? (
          <div id={`${base}-enviar`} className={styles.slotUpload}>
            <UploadForm idPrefix={`${base}-nova`} slot={slot} />
          </div>
        ) : null}
      </div>
    </li>
  );
}
