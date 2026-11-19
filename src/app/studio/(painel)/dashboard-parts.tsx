"use client";

import Image from "next/image";
import Link from "next/link";
import { useId, useState } from "react";

import { PlayLink } from "@/components/links";
import type { Pending } from "@/server/studio/dashboard";
import type { StudioMixtapeRow } from "@/server/studio/mixtapes";

import styles from "./dashboard.module.css";

type Filter = "todas" | "publicadas" | "rascunhos";

const pad = (n: number) => String(n).padStart(2, "0");

function Count({ value, label }: { value: number | null; label: string }) {
  return (
    <>
      <span className="visually-hidden">{label}: </span>
      {value === null ? (
        <>
          <span aria-hidden="true">—</span>
          <span className="visually-hidden">nenhuma</span>
        </>
      ) : (
        value
      )}
    </>
  );
}

function Status({ published }: { published: boolean }) {
  return (
    <span
      className={published ? styles.status : `${styles.status} ${styles.draft}`}
    >
      <span aria-hidden="true" className={styles.dot} />
      {published ? "publicada" : "rascunho"}
    </span>
  );
}

/** The tapes table and its filter (reference: section "fitas"). */
export function TapesTable({ tapes }: { tapes: StudioMixtapeRow[] }) {
  const [filter, setFilter] = useState<Filter>("todas");
  const published = tapes.filter((t) => t.status === "published").length;
  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: "todas", label: "todas", count: tapes.length },
    { key: "publicadas", label: "publicadas", count: published },
    { key: "rascunhos", label: "rascunhos", count: tapes.length - published },
  ];
  const shown = tapes.filter(
    (t) =>
      filter === "todas" ||
      (filter === "publicadas"
        ? t.status === "published"
        : t.status === "draft"),
  );

  const tabGroup = (className: string | undefined) =>
    tapes.length === 0 ? null : (
      <div role="group" aria-label="Filtrar fitas" className={className}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className="tab"
            aria-pressed={filter === t.key}
            onClick={() => setFilter(t.key)}
          >
            {t.label} · {t.count}
          </button>
        ))}
      </div>
    );

  return (
    <section aria-labelledby="h-fitas" className={styles.tapes}>
      <div className={styles.tapesHead}>
        <h2 id="h-fitas" className={`rv ${styles.tapesTitle}`}>
          fitas
        </h2>
        {tabGroup(styles.tabsWide)}
        <Link href="/studio/mixtapes" className={`nl ${styles.seeAll}`}>
          ver todas
        </Link>
      </div>
      {tabGroup(styles.tabsNarrow)}

      {tapes.length === 0 ? (
        <p className={styles.empty}>
          nenhuma fita ainda. comece por “+ nova mixtape”.
        </p>
      ) : (
        <>
          <div aria-hidden="true" className={styles.columns}>
            <span />
            <span>fita</span>
            <span>tema</span>
            <span className={styles.right}>faixas</span>
            <span className={styles.right}>notas</span>
            <span>estado</span>
            <span />
          </div>
          {shown.length === 0 ? (
            <p className={styles.empty}>
              {filter === "publicadas"
                ? "nenhuma fita publicada ainda."
                : "nenhum rascunho."}
            </p>
          ) : (
            <ul className={styles.rows}>
              {shown.map((t) => {
                const isPublished = t.status === "published";
                const empty = t.trackCount === 0;
                return (
                  <li key={t.id} className={`row ${styles.tapeRow}`}>
                    <span className={styles.cover}>
                      {t.coverUrl ? (
                        <Image
                          src={t.coverUrl}
                          alt=""
                          width={64}
                          height={64}
                          unoptimized
                          className="mood"
                        />
                      ) : null}
                    </span>
                    <span className={styles.name}>
                      <span className={styles.no}>Nº {pad(t.number)}</span>
                      <span className={styles.tapeTitle}>{t.title}</span>
                      <span className={styles.meta}>
                        Nº {pad(t.number)} ·{" "}
                        {empty
                          ? "faixas pendentes"
                          : `${t.trackCount} ${t.trackCount === 1 ? "faixa" : "faixas"}`}
                      </span>
                      <span className={styles.statusNarrow}>
                        <Status published={isPublished} />
                      </span>
                    </span>
                    <span className={styles.theme}>{t.theme}</span>
                    <span className={styles.figure}>
                      <Count
                        value={empty ? null : t.trackCount}
                        label="faixas"
                      />
                    </span>
                    <span className={styles.figure}>
                      <Count value={empty ? null : t.noteCount} label="notas" />
                    </span>
                    <span className={styles.statusWide}>
                      <Status published={isPublished} />
                    </span>
                    <Link
                      href={`/studio/mixtapes/${t.id}`}
                      className={`nl ${styles.edit}`}
                      aria-label={`Editar ${t.title}`}
                    >
                      editar
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <PlayLink href="/studio/mixtapes" className={styles.manage}>
        gerenciar mixtapes
      </PlayLink>
    </section>
  );
}

const FIRST = 6;

/** What is still missing, computed by the server; each item links to where
    it is fixed. Long lists open on request. */
export function PendingList({ items }: { items: Pending[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const shown = open ? items : items.slice(0, FIRST);
  return (
    <>
      <ul id={listId} className={styles.pending}>
        {shown.map((p) => (
          <li key={`${p.href}:${p.label}`}>
            <Link href={p.href} className={`row ${styles.pendingLink}`}>
              <span className={styles.pendingLabel}>{p.label}</span>
              <span className={styles.pendingWhere}>{p.where}</span>
            </Link>
          </li>
        ))}
      </ul>
      {items.length > FIRST ? (
        <button
          type="button"
          className={`nl ${styles.more}`}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "mostrar menos" : `ver todas as ${items.length} pendências`}
        </button>
      ) : null}
    </>
  );
}
