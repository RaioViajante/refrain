import Link from "next/link";

import { Photo } from "@/components/photo";
import { cx } from "@/lib/cx";
import { getFooterImages } from "@/server/site";

import styles from "./site-footer.module.css";

export const VOLUME = "vol. I · 2026";

/**
 * The footer on every public page: the road. Its photograph comes from the
 * Studio (slots footer.road and footer.road_mobile) and appears only once its
 * rights are confirmed; until then the footer stands on paper.
 */
export async function SiteFooter() {
  const photos = await getFooterImages();
  const desktop = photos["footer.road"];
  const mobile = photos["footer.road_mobile"] ?? desktop;

  return (
    <footer className={styles.footer}>
      {desktop ? (
        <Photo
          image={desktop}
          sizes="100vw"
          className={cx("ph", styles.photo, styles.desktopOnly)}
        />
      ) : null}
      {mobile ? (
        <Photo
          image={mobile}
          sizes="100vw"
          className={cx("ph", styles.photo, styles.mobileOnly)}
        />
      ) : null}
      <div className={styles.text}>
        <p className={styles.name}>~ refrain ~</p>
        <nav aria-label="Rodapé" className={styles.nav}>
          <Link href="/mixtapes" className={cx("nl", styles.link)}>
            mixtapes
          </Link>
          <Link href="/sobre" className={cx("nl", styles.link)}>
            sobre
          </Link>
        </nav>
        <p className={styles.volume}>{VOLUME}</p>
      </div>
    </footer>
  );
}
