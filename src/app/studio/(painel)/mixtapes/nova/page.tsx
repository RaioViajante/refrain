import type { Metadata } from "next";
import Link from "next/link";

import { requireStudio } from "@/server/auth/studio";

import styles from "./nova.module.css";
import { NewMixtapeForm } from "./new-form";

export const metadata: Metadata = { title: "nova mixtape" };

/** A new tape starts with its title; the editor does the rest. */
export default async function NewMixtapePage() {
  await requireStudio();
  return (
    <main id="conteudo" className={styles.main}>
      <Link href="/studio/mixtapes" className={`nl ${styles.back}`}>
        ← mixtapes
      </Link>
      <p className={styles.label}>Nº 002 · mixtapes</p>
      <h1 className={`t-in ${styles.title}`}>nova mixtape</h1>
      <p className={styles.lede}>
        comece pelo título. capa, textos e faixas vêm depois, no editor.
      </p>
      <NewMixtapeForm />
    </main>
  );
}
