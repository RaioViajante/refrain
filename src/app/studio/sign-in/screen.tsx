import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  STUDIO_CONTENT_ID,
  StudioFooter,
  StudioHeader,
} from "@/app/studio/frame";
import { SignInForm } from "@/app/studio/sign-in/sign-in-form";
import type { InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";
import { studioWords } from "@/i18n/studio";
import { authorizeAuthor } from "@/modules/identity";

export function signInMetadata(locale: InterfaceLocale): Metadata {
  return { title: studioWords(locale).meta.signIn };
}

// Sign-in for the single author. There is no sign-up page: the account is
// created by a local command (docs/development.md § Authentication).
export function SignInScreen({ locale }: { locale: InterfaceLocale }) {
  return (
    <>
      <StudioHeader locale={locale} />
      <main
        id={STUDIO_CONTENT_ID}
        tabIndex={-1}
        className="studio-main"
        data-layout="narrow"
      >
        <h1 className="studio-title">{studioWords(locale).signIn.title}</h1>
        <Suspense fallback={null}>
          <AlreadySignedIn locale={locale} />
        </Suspense>
        <SignInForm />
      </main>
      <StudioFooter locale={locale} path="/studio/sign-in" />
    </>
  );
}

// The author, already signed in, goes straight to the studio, in the language
// of this page's route (ADR 0008 § 9). Anyone else, including a session that
// is not the author's, sees the form.
async function AlreadySignedIn({ locale }: { locale: InterfaceLocale }) {
  const result = await authorizeAuthor(await headers());
  if (result.ok) {
    redirect(localizedHref(locale, "/studio"));
  }
  return null;
}
