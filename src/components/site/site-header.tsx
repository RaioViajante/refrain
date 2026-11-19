import Image from "next/image";
import Link from "next/link";

import { cx } from "@/lib/cx";

import styles from "./site-header.module.css";

export type Section = "mixtapes" | "sobre";

/**
 * The header on every public page: the star returns home (absent on the home
 * page itself), and the centred menu underlines the current section. The site
 * name is never written here.
 */
export function SiteHeader({
  current,
  home = false,
}: {
  current?: Section;
  home?: boolean;
}) {
  return (
    <header className={styles.header}>
      {home ? null : (
        <Link href="/" className={cx("hm", styles.home)} aria-label="Início">
          <Image src="/icones/mark_600.png" width={15} height={15} alt="" />
        </Link>
      )}
      <nav aria-label="Principal" className={styles.nav}>
        <Link
          href="/mixtapes"
          className={cx("nl", styles.link)}
          aria-current={current === "mixtapes" ? "page" : undefined}
        >
          mixtapes
        </Link>
        <Link
          href="/sobre"
          className={cx("nl", styles.link)}
          aria-current={current === "sobre" ? "page" : undefined}
        >
          sobre
        </Link>
      </nav>
    </header>
  );
}
