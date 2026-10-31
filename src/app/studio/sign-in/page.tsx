import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SignInForm } from "@/app/studio/sign-in/sign-in-form";
import { authorizeAuthor } from "@/modules/identity";

export const metadata: Metadata = { title: "Sign in · refrain" };

// Sign-in for the single author. There is no sign-up page: the account is
// created by a local command (docs/development.md § Authentication).
export default function SignInPage() {
  return (
    <>
      <header className="studio-header">
        <p className="text-[16px] text-ink-2">Writing studio</p>
      </header>
      <main className="studio-main max-w-[440px]">
        <h1 className="studio-title">Sign in</h1>
        <Suspense fallback={null}>
          <AlreadySignedIn />
        </Suspense>
        <SignInForm />
      </main>
    </>
  );
}

// The author, already signed in, goes straight to the studio. Anyone else,
// including a session that is not the author's, sees the form.
async function AlreadySignedIn() {
  const result = await authorizeAuthor(await headers());
  if (result.ok) {
    redirect("/studio");
  }
  return null;
}
