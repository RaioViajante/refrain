"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  deleteMixtapeAction,
  moveMixtapeAction,
  setMixtapePublishedAction,
} from "../../_actions/mixtapes";
import { call, pad, setFlash, takeFlash } from "./_ui/call";
import { ConfirmDialog, PublishSwitch } from "./_ui/confirm-dialog";
import styles from "./mixtapes.module.css";

export type ListRow = {
  id: string;
  number: number;
  slug: string;
  title: string;
  theme: string;
  published: boolean;
  coverUrl: string | null;
  trackCount: number;
  noteCount: number;
};

type Filter = "todas" | "publicadas" | "rascunhos";

const EMPTY: Record<Filter, string> = {
  todas: "nenhuma fita com esse nome por aqui.",
  publicadas: "nenhuma fita publicada por aqui.",
  rascunhos: "nenhum rascunho por aqui.",
};

export function MixtapesList({ rows }: { rows: ListRow[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("todas");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ListRow | null>(null);
  const [, startTransition] = useTransition();
  const refocus = useRef<string | null>(null);

  useEffect(() => {
    // A message left before a redirect here (a deleted tape).
    const flash = takeFlash();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is read after the server's rows arrive
    if (flash) setMessage(flash);
    // After a reorder, keep keyboard focus on the arrow that was pressed.
    const key = refocus.current;
    if (!key) return;
    refocus.current = null;
    const button = document.querySelector<HTMLButtonElement>(
      `[data-focus="${key}"]`,
    );
    if (button && !button.disabled) button.focus();
    else
      document
        .querySelector<HTMLButtonElement>(
          `[data-focus^="${key.split(":")[0]}:"]:not(:disabled)`,
        )
        ?.focus();
  }, [rows]);

  const q = query.trim().toLowerCase();
  const published = rows.filter((r) => r.published).length;
  const shown = rows.filter(
    (r) =>
      (!q || `${r.title} ${r.theme}`.toLowerCase().includes(q)) &&
      (filter === "todas" ||
        (filter === "publicadas" ? r.published : !r.published)),
  );

  function run(
    row: ListRow,
    work: () => Promise<{ ok: boolean; error?: string }>,
    done: string,
  ) {
    setBusy(row.id);
    setError("");
    startTransition(async () => {
      const result = await work();
      setBusy(null);
      if (result.ok) setMessage(done);
      else {
        setMessage("");
        setError(result.error ?? "algo deu errado.");
      }
    });
  }

  function move(row: ListRow, direction: "up" | "down") {
    refocus.current = `${row.id}:${direction}`;
    run(
      row,
      () => call(moveMixtapeAction, { id: row.id, direction }),
      "ordem da estante atualizada",
    );
  }

  function toggle(row: ListRow) {
    const next = !row.published;
    run(
      row,
      () =>
        call(setMixtapePublishedAction, {
          id: row.id,
          published: String(next),
        }),
      next
        ? `${row.title} publicada no site`
        : `${row.title} voltou para rascunho`,
    );
  }

  return (
    <main id="conteudo" className={styles.main}>
      <div className={styles.hero}>
        <p className={styles.label}>Nº 002 · mixtapes</p>
        <p className={styles.page} aria-hidden="true">
          002
        </p>
        <h1 className={`t-in ${styles.title}`}>mixtapes</h1>
        <p className={styles.lede}>
          a estante inteira. a ordem aqui é a ordem do site.
        </p>
        <Link href="/studio/mixtapes/nova" className={`btn ${styles.new}`}>
          + nova mixtape
        </Link>
      </div>

      <div className={styles.tools}>
        <label className={styles.search}>
          <span className={styles.searchLabel}>buscar</span>
          <input
            type="search"
            className={`fld ${styles.searchInput}`}
            placeholder="título ou tema"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className={styles.tabsScroll}>
          <div role="group" aria-label="Filtrar fitas" className={styles.tabs}>
            {(
              [
                ["todas", rows.length],
                ["publicadas", published],
                ["rascunhos", rows.length - published],
              ] as const
            ).map(([key, n]) => (
              <button
                key={key}
                type="button"
                className="tab"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {key} · {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.statusRow}>
        <p role="status" aria-live="polite" className={styles.msg}>
          {message}
        </p>
        {error ? (
          <p role="alert" className={`msg-error ${styles.error}`}>
            {error}
          </p>
        ) : null}
        <p className={styles.hint}>use ↑ ↓ para mudar a ordem da estante</p>
      </div>

      {rows.length > 0 ? (
        <div aria-hidden="true" className={`${styles.grid} ${styles.head}`}>
          <span>ordem</span>
          <span>nº</span>
          <span />
          <span>fita</span>
          <span>tema</span>
          <span className={styles.num}>faixas</span>
          <span className={styles.num}>notas</span>
          <span>no site</span>
          <span />
        </div>
      ) : null}

      <ul className={styles.list}>
        {shown.map((row) => {
          const i = rows.indexOf(row);
          const disabled = busy !== null;
          return (
            <li key={row.id} className={`row ${styles.item}`}>
              <span className={styles.order}>
                <button
                  type="button"
                  className="arw2"
                  data-focus={`${row.id}:up`}
                  disabled={i === 0 || disabled}
                  aria-label={`Subir ${row.title} na estante`}
                  onClick={() => move(row, "up")}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="arw2"
                  data-focus={`${row.id}:down`}
                  disabled={i === rows.length - 1 || disabled}
                  aria-label={`Descer ${row.title} na estante`}
                  onClick={() => move(row, "down")}
                >
                  ↓
                </button>
              </span>
              <span className={styles.no}>{pad(row.number)}</span>
              {row.coverUrl ? (
                <Image
                  src={row.coverUrl}
                  alt=""
                  width={72}
                  height={72}
                  unoptimized
                  className={`mood ${styles.cover}`}
                />
              ) : (
                <span className={styles.cover} aria-hidden="true" />
              )}
              <span className={styles.name}>
                <span className={styles.noMobile}>Nº {pad(row.number)}</span>
                <span className={styles.tTitle}>{row.title}</span>
                {row.theme ? (
                  <span className={styles.themeMobile}>{row.theme}</span>
                ) : null}
              </span>
              <span className={styles.theme}>{row.theme}</span>
              <span className={`${styles.num} ${styles.count}`}>
                {row.trackCount}
              </span>
              <span className={`${styles.num} ${styles.count}`}>
                {row.noteCount}
              </span>
              <PublishSwitch
                published={row.published}
                name={row.title}
                disabled={disabled}
                onToggle={() => toggle(row)}
                className={styles.switch}
              />
              <span className={styles.actions}>
                {row.published ? (
                  <a
                    href={`/mixtapes/${row.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`nl ${styles.action} ${styles.view}`}
                    aria-label={`ver ${row.title} no site (abre em nova aba)`}
                  >
                    ver ↗
                  </a>
                ) : null}
                <Link
                  href={`/studio/mixtapes/${row.id}`}
                  className={`nl ${styles.action}`}
                  aria-label={`Editar ${row.title}`}
                >
                  editar
                </Link>
                <button
                  type="button"
                  className={`del ${styles.action} ${styles.delete}`}
                  aria-label={`Excluir ${row.title}`}
                  onClick={() => {
                    setError("");
                    setConfirm(row);
                  }}
                >
                  excluir
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      {rows.length === 0 ? (
        <p className={styles.empty}>
          a estante está vazia. comece pela primeira fita em “+ nova mixtape”.
        </p>
      ) : shown.length === 0 ? (
        <p className={styles.empty}>{q ? EMPTY.todas : EMPTY[filter]}</p>
      ) : null}

      {confirm && rows.some((r) => r.id === confirm.id) ? (
        <ConfirmDialog
          key={confirm.id}
          label="excluir fita"
          heading={`excluir ${confirm.title}?`}
          confirmLabel="excluir fita"
          action={deleteMixtapeAction}
          fields={{ id: confirm.id }}
          onCancel={() => {
            takeFlash();
            setConfirm(null);
          }}
          onSubmit={() => setFlash(`${confirm.title} foi excluída`)}
        >
          a fita sai da estante e do site, com a lista de faixas e as notas
          dela. as músicas continuam guardadas no catálogo.
        </ConfirmDialog>
      ) : null}
    </main>
  );
}
