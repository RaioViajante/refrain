"use client";

import { useActionState, useState } from "react";

import { PlayIcon } from "@/components/links";

import { signInAction } from "../_actions/auth";
import styles from "./page.module.css";

// The server validates and throttles every attempt; nothing here locks out.
export function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, null);
  // Controlled, so a failed attempt keeps the address (the form resets).
  const [email, setEmail] = useState("");
  const [show, setShow] = useState(false);
  // Hidden while a new attempt runs, so a repeated error is announced again.
  const error = state && !state.ok && !pending ? state.error : null;
  const failed = error !== null;

  return (
    <form action={action} noValidate aria-label="Entrar no studio">
      <label htmlFor="email" className={styles.fieldLabel}>
        e-mail
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="username"
        placeholder="voce@exemplo.com"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-invalid={failed || undefined}
        aria-describedby={failed ? "entrar-erro" : undefined}
        className={`fld ${styles.input}`}
      />
      <div className={styles.passwordField}>
        <label htmlFor="password" className={styles.fieldLabel}>
          senha
        </label>
        <input
          id="password"
          name="password"
          type={show ? "text" : "password"}
          autoComplete="current-password"
          required
          aria-invalid={failed || undefined}
          aria-describedby={failed ? "entrar-erro" : undefined}
          className={`fld ${styles.input} ${styles.password}`}
        />
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "ocultar a senha" : "mostrar a senha"}
          aria-controls="password"
        >
          {show ? "ocultar" : "mostrar"}
        </button>
      </div>
      {failed ? (
        <p
          id="entrar-erro"
          role="alert"
          className={`msg-error ${styles.error}`}
        >
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <button type="submit" className="btn" disabled={pending}>
          entrar <PlayIcon className={styles.play} />
        </button>
      </div>
    </form>
  );
}
