"use client";

import { useState, type FormEvent } from "react";

import { authClient } from "@/app/studio/auth-client";
import { useStudio } from "@/app/studio/studio-locale";
import type { StudioDictionary } from "@/i18n/studio";

// Messages never say whether the email exists, and never repeat what was
// typed or what the server returned.
function messageFor(
  words: StudioDictionary,
  status: number | undefined,
): string {
  switch (status) {
    case 401:
      return words.signIn.mismatch;
    case 429:
      return words.signIn.tooMany;
    case 403:
      return words.signIn.refused;
    default:
      return words.signIn.failed;
  }
}

export function SignInForm() {
  const { words, href } = useStudio();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    try {
      const { error } = await authClient.signIn.email({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      if (error) {
        setMessage(messageFor(words, error.status));
        setPending(false);
        return;
      }
    } catch {
      setMessage(messageFor(words, undefined));
      setPending(false);
      return;
    }
    // A full navigation, so the studio is rendered on the server with the
    // new session cookie.
    // It also discards the client router cache, so no page rendered under
    // the previous authentication state can be shown again. The Desk is the
    // one of this page's language, from its route; there is no callback
    // parameter (ADR 0008 § 9).
    window.location.assign(href("/studio"));
  }

  return (
    <form
      onSubmit={signIn}
      className="space-y-6"
      aria-describedby="sign-in-message"
    >
      <div className="space-y-2">
        <label htmlFor="email" className="studio-label block">
          {words.signIn.email}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
          className="studio-field"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="studio-label block">
          {words.signIn.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          className="studio-field"
        />
      </div>
      <p
        id="sign-in-message"
        role="alert"
        className="min-h-[1.5em] text-[16px]"
      >
        {message}
      </p>
      <button type="submit" disabled={pending} className="studio-button">
        {pending ? words.signIn.pending : words.signIn.submit}
      </button>
    </form>
  );
}
