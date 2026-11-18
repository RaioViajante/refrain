import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { STUDIO_CONTENT_ID } from "@/app/studio/frame";
import { SignInForm } from "@/app/studio/sign-in/sign-in-form";
import { v3FontClasses } from "@/app/v3/fonts";
import type { InterfaceLocale } from "@/i18n/locales";
import { addressPair, localizedHref } from "@/i18n/paths";
import { studioWords } from "@/i18n/studio";
import { v3StringsFor } from "@/i18n/v3";
import { authorizeAuthor } from "@/modules/identity";

export function signInMetadata(locale: InterfaceLocale): Metadata {
  return { title: studioWords(locale).meta.signIn };
}

// Sign-in for the single author. There is no sign-up page: the account is
// created by a local command (docs/development.md § Authentication).
//
// The v3 login (ADR 0011, proposed): the reference's centred box, wordmark,
// way back, and languages. Its form is the existing email and password one;
// the reference's emailed link is R10, blocked on ADR 0012 § 3, so nothing
// here mentions an email.
export function SignInScreen({ locale }: { locale: InterfaceLocale }) {
  const words = studioWords(locale);
  const v3 = v3StringsFor(locale).login;
  const pair = addressPair("/studio/sign-in");
  return (
    <div className={`stu ${v3FontClasses}`} style={{ display: "block" }}>
      <main id={STUDIO_CONTENT_ID} tabIndex={-1} className="login">
        <div className="box">
          <p className="wm">
            refrain<small>studio</small>
          </p>
          <h1 className="t1 login-title">{v3.s1}</h1>
          <p className="sub">{words.signIn.lead}</p>
          <Suspense fallback={null}>
            <AlreadySignedIn locale={locale} />
          </Suspense>
          <SignInForm />
          <div className="login-foot">
            <a href={localizedHref(locale, "/")}>← {v3.s6}</a>
            <div className="seg" role="group" aria-label={v3.langA}>
              <a
                href={pair.en}
                hrefLang="en"
                lang="en"
                aria-current={locale === "en" ? "true" : undefined}
              >
                EN
              </a>
              <a
                href={pair["pt-BR"]}
                hrefLang="pt-BR"
                lang="pt-BR"
                aria-current={locale === "pt-BR" ? "true" : undefined}
              >
                PT
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
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
