"use client";

import { type FormEvent, useActionState, useState, useTransition } from "react";

import { cx } from "@/lib/cx";
import { normalizeText } from "@/lib/text";
import type { ActionResult } from "@/server/studio/errors";

import {
  saveSiteTextAction,
  setSiteTextPublishedAction,
} from "../../_actions/site";
import styles from "./page.module.css";

export type TextField = {
  k: string;
  anchor: string;
  label: string;
  body: string;
  state: "rascunho" | "publicado" | "vazio";
  short: boolean;
  rows: number;
  hint: string | null;
};

/**
 * One page text: its field, its state, and its two actions. "salvar" sends
 * the body (empty deletes it); "publicar" / "voltar a rascunho" flips its
 * state. Both submit the same form; the pressed button decides which.
 * Submitted by hand (not `<form action>`), so React never resets the field
 * after a failed save.
 */
export function TextItem({ field }: { field: TextField }) {
  const [value, setValue] = useState(field.body);
  // When a save comes back, the field shows the text as stored (trimmed,
  // "\n" line breaks), unless it was edited again meanwhile.
  const [storedBody, setStoredBody] = useState(field.body);
  if (field.body !== storedBody) {
    setStoredBody(field.body);
    if (normalizeText(value) === normalizeText(field.body))
      setValue(field.body);
  }
  const [result, dispatch, pending] = useActionState(
    (prev: ActionResult | null, formData: FormData) =>
      formData.has("published")
        ? setSiteTextPublishedAction(prev, formData)
        : saveSiteTextAction(prev, formData),
    null,
  );
  const [, start] = useTransition();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    start(() => dispatch(formData));
  };
  // Compared as the server stores it: surrounding spaces are not a change.
  const dirty = normalizeText(value) !== normalizeText(field.body);
  const id = `campo-${field.anchor}`;
  const hintId = `${id}-dica`;
  const errorId = `${id}-erro`;
  const failed = result !== null && !result.ok;
  const published = field.state === "publicado";

  const note = dirty
    ? value.trim() === "" && field.state !== "vazio"
      ? "vazio: ao salvar, este texto é apagado" +
        (published ? " e sai do site." : ".")
      : published
        ? "alterado — ao salvar, a mudança vai para o site na hora."
        : "alterado — salve para não perder."
    : null;

  return (
    <form
      onSubmit={submit}
      id={field.anchor}
      tabIndex={-1}
      className={styles.item}
    >
      <input type="hidden" name="key" value={field.k} />
      <div className={styles.itemHead}>
        <label htmlFor={id} className={styles.itemLabel}>
          {field.label}
        </label>
        <span className={cx(styles.state, styles[`state-${field.state}`])}>
          <span aria-hidden="true" className={styles.dot} />
          {field.state}
        </span>
      </div>
      <div className={styles.itemBody}>
        {field.short ? (
          <input
            id={id}
            name="body"
            className={cx("fld", styles.input)}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={failed || undefined}
            aria-describedby={
              cx(field.hint && hintId, failed && errorId) || undefined
            }
          />
        ) : (
          <textarea
            id={id}
            name="body"
            className={cx("fld", styles.textarea)}
            rows={field.rows}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={failed || undefined}
            aria-describedby={
              cx(field.hint && hintId, failed && errorId) || undefined
            }
          />
        )}
        {field.hint ? (
          <p id={hintId} className={styles.hint}>
            {field.hint}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button
            type="submit"
            className="btn"
            disabled={pending || !dirty}
            aria-label={`salvar: ${field.label}`}
          >
            salvar
          </button>
          {field.state !== "vazio" ? (
            <button
              type="submit"
              name="published"
              value={published ? "false" : "true"}
              className="seg"
              disabled={pending || dirty}
              aria-label={`${published ? "voltar a rascunho" : "publicar"}: ${field.label}`}
              title={dirty ? "salve antes de publicar" : undefined}
            >
              {published ? "voltar a rascunho" : "publicar"}
            </button>
          ) : null}
          <p role="status" className={cx("msg-ok", styles.msg)}>
            {pending
              ? "salvando…"
              : note
                ? note
                : result?.ok
                  ? result.message
                  : ""}
          </p>
        </div>
        <p id={errorId} role="alert" className={cx("msg-error", styles.msg)}>
          {failed ? result.error : ""}
        </p>
      </div>
    </form>
  );
}
