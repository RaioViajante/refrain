"use client";

import {
  type FormEvent,
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { cx } from "@/lib/cx";
import type { ActionResult } from "@/server/studio/errors";

import { setSiteImageAction, uploadImageAction } from "../../_actions/site";
import styles from "./page.module.css";
import { MAX_UPLOAD_MB } from "./photo-types";

const TYPES = ["image/jpeg", "image/png"];

/** Which field an action's message is about, to mark it invalid. */
function fieldOf(error: string): "alt" | "rightsNote" | "file" {
  if (/^descreva|^a descrição/.test(error)) return "alt";
  if (/direitos/.test(error)) return "rightsNote";
  return "file";
}

/**
 * Sends a photograph to the library, or (with `slot`) straight into a fixed
 * place on the site. The server checks everything again.
 */
export function UploadForm({
  idPrefix,
  slot,
  onDone,
}: {
  idPrefix: string;
  slot?: string;
  onDone?: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [local, setLocal] = useState<string | null>(null);
  const [result, dispatch, pending] = useActionState(
    async (prev: ActionResult | null, formData: FormData) => {
      const done = await (slot ? setSiteImageAction : uploadImageAction)(
        prev,
        formData,
      );
      if (done.ok) {
        formRef.current?.reset();
        setPreview(null);
        setFileName("");
        onDone?.();
      }
      return done;
    },
    null,
  );
  const [, start] = useTransition();

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const error = local ?? (result && !result.ok ? result.error : null);
  const bad = error ? (local ? "file" : fieldOf(error)) : null;
  const id = (name: string) => `${idPrefix}-${name}`;
  const errorId = id("erro");

  function choose(file: File | undefined) {
    setLocal(null);
    setFileName(file?.name ?? "");
    setPreview(
      file && TYPES.includes(file.type) ? URL.createObjectURL(file) : null,
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setLocal("escolha uma foto.");
      return;
    }
    if (!TYPES.includes(file.type)) {
      setLocal("envie uma foto JPEG ou PNG.");
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setLocal(`a foto passa de ${MAX_UPLOAD_MB} MB.`);
      return;
    }
    setLocal(null);
    start(() => dispatch(formData));
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className={cx(styles.upload, slot && styles.uploadSlot)}
      noValidate
    >
      {slot ? <input type="hidden" name="slot" value={slot} /> : null}
      <div className={styles.dropWrap}>
        <input
          id={id("arquivo")}
          name="file"
          type="file"
          accept="image/jpeg,image/png"
          className={cx("visually-hidden", styles.fileInput)}
          onChange={(e) => choose(e.target.files?.[0])}
          aria-invalid={bad === "file" || undefined}
          aria-describedby={cx(id("regras"), bad === "file" && errorId)}
        />
        <label
          htmlFor={id("arquivo")}
          className={cx("drop", styles.drop, bad === "file" && styles.dropBad)}
        >
          {preview ? (
            // A local preview of the chosen file (a blob: URL).
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className={styles.dropPreview} />
          ) : (
            <span aria-hidden="true" className={styles.dropPlus}>
              +
            </span>
          )}
          <span className={styles.dropText}>
            {fileName ? "trocar arquivo" : "escolher arquivo"}
          </span>
        </label>
        <p id={id("regras")} className={styles.help}>
          {fileName ? <b className={styles.fileName}>{fileName}</b> : null}
          {fileName ? <br /> : null}
          JPEG ou PNG, até {MAX_UPLOAD_MB} MB. a localização e os outros dados
          escondidos da foto (câmera, data, GPS) são apagados no envio.
        </p>
      </div>
      <div className={styles.uploadFields}>
        <div>
          <label htmlFor={id("alt")} className={styles.label}>
            descrição da imagem
          </label>
          <input
            id={id("alt")}
            name="alt"
            className={cx("fld", styles.small)}
            maxLength={300}
            aria-invalid={bad === "alt" || undefined}
            aria-describedby={cx(id("alt-dica"), bad === "alt" && errorId)}
          />
          <p id={id("alt-dica")} className={styles.help}>
            para quem não vê a imagem: o que ela mostra, em uma frase.
          </p>
        </div>
        <label className={styles.check}>
          <input type="checkbox" name="rightsConfirmed" className="chk" />
          <span>tenho o direito de publicar esta foto</span>
        </label>
        <p className={styles.help}>
          sem essa confirmação a foto fica guardada, mas nunca aparece no site.
        </p>
        <div>
          <label htmlFor={id("nota")} className={styles.label}>
            de onde ela vem
          </label>
          <textarea
            id={id("nota")}
            name="rightsNote"
            rows={2}
            maxLength={500}
            className={cx("fld", styles.small)}
            aria-invalid={bad === "rightsNote" || undefined}
            aria-describedby={cx(
              id("nota-dica"),
              bad === "rightsNote" && errorId,
            )}
          />
          <p id={id("nota-dica")} className={styles.help}>
            quem fez a foto, e por que você pode publicá-la. só você vê.
          </p>
        </div>
        <div className={styles.actions}>
          <button type="submit" className="btn" disabled={pending}>
            {pending
              ? "enviando…"
              : slot
                ? "enviar e colocar aqui"
                : "enviar foto"}
          </button>
          <p role="status" className={cx("msg-ok", styles.msg)}>
            {!pending && result?.ok && !local ? result.message : ""}
          </p>
        </div>
        <p id={errorId} role="alert" className={cx("msg-error", styles.msg)}>
          {error ?? ""}
        </p>
      </div>
    </form>
  );
}
