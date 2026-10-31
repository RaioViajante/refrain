import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SignOutButton } from "@/app/studio/sign-out-button";
import { authorizeAuthor } from "@/modules/identity";

// The Writing Studio entry point (M1.3A). The editor, Desk, and Catalog are
// later milestones; this page proves that only the author reaches the studio.
export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <StudioEntry />
    </Suspense>
  );
}

async function StudioEntry() {
  // The authorization boundary: a valid database session of the configured
  // author, checked on every request. Nothing below renders otherwise.
  const result = await authorizeAuthor(await headers());
  if (!result.ok) {
    if (result.reason === "unavailable") {
      return <StudioUnavailable />;
    }
    redirect("/studio/sign-in");
  }

  return (
    <>
      <header className="studio-header">
        <p className="text-[16px] text-ink-2">Writing studio</p>
        <SignOutButton />
      </header>
      <main className="studio-main">
        <h1 className="studio-title">Writing studio</h1>
        <p className="text-[19px]">
          You are signed in. The editor is not built yet.
        </p>
      </main>
    </>
  );
}

function StudioUnavailable() {
  return (
    <main className="studio-main">
      <h1 className="studio-title">Writing studio</h1>
      <p className="text-[19px]">
        The studio isn’t available right now. Try again later.
      </p>
    </main>
  );
}
