import type { Metadata } from "next";

import { LineLink, PlayLink } from "@/components/links";
import { Sparkle } from "@/components/marks";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

import styles from "./not-found.module.css";

export const metadata: Metadata = { title: "página não encontrada" };

// Reference: NotFound.dc.html (1440) and NotFoundMobile.dc.html (390).
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="conteudo" className={styles.main}>
        <p className={styles.label}>Nº 404 · página não encontrada</p>
        <p className={styles.number} aria-hidden="true">
          404
        </p>
        <h1 className={`t-in ${styles.title}`}>
          essa música <span className={styles.second}>se perdeu</span>
        </h1>
        <Sparkle kind={4} rotate={-12} delay="-1.37s" className={styles.star} />
        <div className={styles.body}>
          <p className={styles.lede}>
            às vezes a gente procura uma música e só encontra o silêncio onde
            ela estava.
          </p>
          <div className={styles.links}>
            <PlayLink href="/" className={styles.primary}>
              voltar ao início
            </PlayLink>
            <LineLink href="/mixtapes" className={styles.secondary}>
              ver todas as fitas
            </LineLink>
          </div>
        </div>
      </main>
      <div className={styles.footerGap}>
        <SiteFooter />
      </div>
    </>
  );
}
