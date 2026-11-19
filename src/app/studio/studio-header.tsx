"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { signOutAction } from "./_actions/auth";
import styles from "./studio-header.module.css";

const SECTIONS = [
  { href: "/studio", label: "painel" },
  { href: "/studio/mixtapes", label: "mixtapes" },
  { href: "/studio/musicas", label: "músicas" },
  { href: "/studio/textos", label: "textos" },
  { href: "/studio/fotos", label: "fotos" },
] as const;

function isCurrent(pathname: string, href: string) {
  return href === "/studio"
    ? pathname === "/studio"
    : pathname === href || pathname.startsWith(`${href}/`);
}

/** Reference: the header of every Studio board (desktop and mobile). */
export function StudioHeader() {
  const pathname = usePathname();
  return (
    <header className={styles.header}>
      <Link
        href="/studio"
        className={`hm ${styles.home}`}
        aria-label="Painel do studio"
      >
        <span aria-hidden="true" className={styles.star}>
          ✦
        </span>
        <span className={styles.word}>studio</span>
      </Link>
      <nav aria-label="Studio" className={styles.nav}>
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className={`nl ${styles.link}`}
            aria-current={isCurrent(pathname, s.href) ? "page" : undefined}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      <div className={styles.side}>
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className={`nl ${styles.link} ${styles.site}`}
          aria-label="ver o site (abre em nova aba)"
        >
          ver o site ↗
        </a>
        <form action={signOutAction}>
          <button type="submit" className={styles.out}>
            sair
          </button>
        </form>
      </div>
    </header>
  );
}
