"use client";

import { useState } from "react";

import { authClient } from "./auth-client";

export function SignOutButton() {
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
    // the previous authentication state can be shown again.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/studio/sign-in");
  }

  return (
    <div className="flex items-center gap-4">
      <p role="status" className="text-[15.5px] text-ink-3">
        {failed ? "Couldn’t sign out. Try again." : ""}
      </p>
      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        className="studio-button"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
