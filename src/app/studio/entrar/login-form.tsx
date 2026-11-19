"use client";

import { useActionState } from "react";

import { signInAction } from "../_actions/auth";

export function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, null);
  return (
    <form action={action} noValidate>
      <label htmlFor="email">e-mail</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="username"
        required
        className="fld"
      />
      <label htmlFor="password">senha</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        className="fld"
      />
      {state && !state.ok ? (
        <p role="alert" className="msg-error">
          {state.error}
        </p>
      ) : null}
      <button type="submit" className="btn" disabled={pending}>
        entrar
      </button>
    </form>
  );
}
