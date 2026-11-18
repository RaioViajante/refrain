"use client";

import { useState } from "react";

import { authClient } from "./auth-client";
import { useStudio } from "./studio-locale";

export function SignOutButton() {
  const { words, href } = useStudio();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setPending(true);
    setFailed(false);
    const { error } = await authClient.signOut();
    if (error) {
      setPending(false);
      setFailed(true);
      return;
    }
    // A full navigation, so the next page is rendered without the session.
    // It also discards the client router cache, so no page rendered under
    // the previous authentication state can be shown again. The sign-in
    // page is the one of this page's language (ADR 0008 § 9).
    window.location.assign(href("/studio/sign-in"));
  }

  return (
    <div className="flex flex-wrap items-center justify-end">
      <p
        role="status"
        className={`text-[15.5px] text-ink-3 ${failed ? "mr-4" : ""}`}
      >
        {failed ? words.signOut.failed : ""}
      </p>
      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        className="studio-button-quiet studio-header-action"
      >
        {pending ? words.signOut.pending : words.signOut.action}
      </button>
    </div>
  );
}
