import type { Metadata } from "next";

import { Sparkle, Trees } from "@/components/marks";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { loadPublishedMixtapes, loadSiteTexts } from "@/server/site";

import { CatalogView, type CatalogTape } from "./catalog-view";
import styles from "./catalog.module.css";

export const metadata: Metadata = { title: "mixtapes" };

// Reference: Catalog.dc.html (1440) and CatalogMobile.dc.html (390).
export default async function CatalogPage() {
  const [mixtapes, texts] = await Promise.all([
    loadPublishedMixtapes(),
    loadSiteTexts(["catalog.lede", "catalog.closing"] as const),
  ]);
  const lede = texts["catalog.lede"];
  const closing = texts["catalog.closing"];

  const tapes: CatalogTape[] = mixtapes.map((m) => ({
    slug: m.slug,
    number: String(m.number).padStart(2, "0"),
    title: m.title,
    theme: m.theme,
    feeling: m.feeling.trim(),
    description: m.description,
    year: m.year,
    trackCount: m.trackCount,
    cover: m.cover,
  }));

  return (
    <>
      <SiteHeader current="mixtapes" />
      <main id="conteudo" className={styles.main}>
        <div className={styles.inner}>
          <Sparkle
            kind={4}
            rotate={14}
            delay="-1.37s"
            className={styles.star}
            sizes="(max-width: 47.99rem) 64px, 120px"
          />
          <Trees className={`rv ${styles.trees}`} sizes="170px" />
          <h1 className={`t-in ${styles.title}`}>mixtapes</h1>
          {tapes.length > 0 ? (
            <CatalogView tapes={tapes} lede={lede} />
          ) : (
            <div className={styles.row}>
              {lede ? <p className={styles.lede}>{lede}</p> : null}
              <p className={styles.count}>nenhuma fita publicada ainda.</p>
            </div>
          )}
        </div>
        <div className={styles.closing}>
          {closing ? <p className={styles.closingText}>{closing}</p> : null}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
