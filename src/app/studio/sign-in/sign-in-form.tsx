"use client";

import { useState, type FormEvent } from "react";

import { authClient } from "@/app/studio/auth-client";

// Messages never say whether the email exists, and never repeat what was
// typed or what the server returned.
function messageFor(status: number | undefined): string {
  switch (status) {
    case 401:
      return "That email and password don’t match.";
    case 429:
      return "Too many attempts. Wait a minute, then try again.";
    case 403:
      return "This sign-in was refused. Reload the page and try again.";
    default:
      return "Couldn’t sign in. Try again.";
  }
}

export function SignInForm() {
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
        setMessage(messageFor(error.status));
        setPending(false);
        return;
      }
    } catch {
      setMessage(messageFor(undefined));
      setPending(false);
      return;
    }
    // A full navigation, so the studio is rendered on the server with the
    // new session cookie.
    // It also discards the client router cache, so no page rendered under
    // the previous authentication state can be shown again.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/studio");
  }

  return (
    <form
      onSubmit={signIn}
      className="space-y-6"
      aria-describedby="sign-in-message"
    >
      <div className="space-y-2">
        <label htmlFor="email" className="studio-label block">
          Email
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
          Password
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
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
