import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getStudioSession } from "@/server/auth/studio";

import "../studio.css";
import { LoginForm } from "./login-form";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "entrar",
  robots: { index: false, follow: false },
};

// Reference: StudioLogin.dc.html (1440) and StudioLoginMobile.dc.html (390).
// The sign-in page is the only Studio page without a session check; a
// signed-in owner is sent to the dashboard. It sits outside the Studio
// layout, so it has its own header, as in the reference.
export default async function SignInPage() {
  if (await getStudioSession()) redirect("/studio");
  return (
    <>
      <header className={styles.header}>
        <Link
          href="/"
          className={`hm ${styles.home}`}
          aria-label="Voltar ao site"
        >
          <span aria-hidden="true" className={styles.star}>
            ✦
          </span>
        </Link>
        <Link href="/" className={`nl ${styles.back}`}>
          voltar ao site
        </Link>
      </header>
      <main id="conteudo" className={styles.main}>
        <p className={styles.label}>Nº 000 · acesso restrito</p>
        <p className={styles.number} aria-hidden="true">
          000
        </p>
        <h1 className={`t-in ${styles.title}`}>studio</h1>
        <p className={styles.lede}>
          onde as fitas são montadas antes de ir para a estante.
        </p>
        <div className={styles.side}>
          <div className={styles.form}>
            <LoginForm />
          </div>
          <p className={styles.note}>
            acesso só do administrador. se você chegou aqui por acaso, o arquivo
            público continua aberto.
          </p>
        </div>
      </main>
    </>
  );
}
