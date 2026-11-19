"use client";

import { useActionState, useState } from "react";

import { createMixtapeAction } from "../../../_actions/mixtapes";
import styles from "./nova.module.css";

export function NewMixtapeForm() {
  const [state, action, pending] = useActionState(createMixtapeAction, null);
  const [title, setTitle] = useState("");
  const error = state && !state.ok ? state.error : null;
  return (
    <form action={action} noValidate className={styles.form}>
      <label htmlFor="nova-titulo" className={styles.fieldLabel}>
        título
      </label>
      <input
        id="nova-titulo"
        name="title"
        className="fld"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoComplete="off"
        maxLength={120}
        required
        autoFocus
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "nova-dica nova-erro" : "nova-dica"}
      />
      <p id="nova-dica" className={styles.hint}>
        caixa baixa, sem ponto final — como todos os títulos do site. a fita
        começa como rascunho, no fim da estante.
      </p>
      {error ? (
        <p id="nova-erro" role="alert" className={`msg-error ${styles.error}`}>
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className={`btn ${styles.submit}`}
        disabled={pending}
      >
        {pending ? "criando…" : "criar fita"}
      </button>
    </form>
  );
}
