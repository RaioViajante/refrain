import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { requireStudio } from "@/server/auth/studio";

import styles from "./preview.module.css";

export const metadata: Metadata = {
  title: { default: "prévia", template: "%s · prévia · studio" },
  robots: { index: false, follow: false },
};

/**
 * The Studio's previews: the public pages' own markup with draft content,
 * under a banner that never lets them pass for the site. No Studio header.
 * Every page below also calls requireStudio() itself.
 */
export default async function PreviewLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireStudio();
  return (
    <>
      <aside aria-label="Prévia" className={styles.banner}>
        <p className={styles.text}>
          <span className={styles.label}>prévia</span> — como ficará no site.
          rascunhos incluídos.
        </p>
        <Link href="/studio" className={styles.back}>
          voltar ao studio
        </Link>
      </aside>
      <div aria-hidden="true" className={styles.spacer} />
      {children}
    </>
  );
}
