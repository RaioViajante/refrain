import Link from "next/link";

import { getDatabase } from "@/db/client";
import { requireStudio } from "@/server/auth/studio";
import { getDashboard } from "@/server/studio/dashboard";

import { PendingList, TapesTable } from "./dashboard-parts";
import styles from "./dashboard.module.css";

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

// Reference: StudioDashboard.dc.html (1440) and StudioDashboardMobile.dc.html
// (390). Every number and list comes from the database.
export default async function DashboardPage() {
  await requireStudio();
  const { tapes, counts, pending, topArtists } =
    await getDashboard(getDatabase());

  const stats = [
    {
      label: "fitas",
      value: counts.tapes,
      sub:
        counts.tapes === 0
          ? "nenhuma fita ainda"
          : `${plural(counts.published, "publicada", "publicadas")} · ${plural(counts.drafts, "rascunho", "rascunhos")}`,
    },
    {
      label: "faixas",
      value: counts.tracks,
      sub:
        counts.tapes === 0
          ? "nenhuma faixa ainda"
          : [
              `em ${plural(counts.tapesWithTracks, "fita", "fitas")}`,
              counts.tapesWithoutTracks > 0
                ? `${counts.tapesWithoutTracks} sem faixas ainda`
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
    },
    {
      label: "anotações",
      value: counts.notes,
      sub:
        counts.noteLeaders.length === 0
          ? "nenhuma anotação ainda"
          : counts.noteLeaders
              .map((l) => `${l.notes} em ${l.title}`)
              .join(" · "),
    },
    {
      label: "pendências",
      value: pending.length,
      sub:
        pending.length === 0
          ? "o arquivo está inteiro, por enquanto"
          : "o que falta para o arquivo ficar inteiro",
    },
  ];

  return (
    <main id="conteudo" className={styles.main}>
      <div className={styles.hero}>
        <p className={styles.label}>Nº 001 · painel</p>
        <p className={styles.number} aria-hidden="true">
          001
        </p>
        <h1 className={`t-in ${styles.title}`}>painel</h1>
        <p className={styles.lede}>
          tudo o que está guardado no refrain, num só lugar.
        </p>
        <div className={styles.actions}>
          <Link href="/studio/musicas" className={`nl ${styles.addSong}`}>
            + adicionar música
          </Link>
          <Link
            href="/studio/mixtapes/nova"
            className={`btn ${styles.newTape}`}
          >
            + nova mixtape
          </Link>
        </div>
      </div>

      <dl className={styles.stats}>
        {stats.map((s) => (
          <div key={s.label} className={styles.stat}>
            <dt className={styles.statLabel}>{s.label}</dt>
            <dd className={styles.statValue}>{s.value}</dd>
            <dd className={styles.statSub}>{s.sub}</dd>
          </div>
        ))}
      </dl>

      <div className={styles.grid}>
        <TapesTable tapes={tapes} />
        <aside className={styles.aside}>
          <section aria-labelledby="h-pend">
            <div className={styles.asideHead}>
              <h2 id="h-pend" className={`rv ${styles.asideTitle}`}>
                pendências
              </h2>
            </div>
            {pending.length === 0 ? (
              <p className={styles.empty}>nada pendente por enquanto.</p>
            ) : (
              <PendingList items={pending} />
            )}
          </section>
          <section aria-labelledby="h-arts">
            <div className={styles.asideHead}>
              <h2 id="h-arts" className={`rv ${styles.asideTitle}`}>
                os que mais voltam
              </h2>
            </div>
            {topArtists.length === 0 ? (
              <p className={styles.empty}>
                nenhum artista ainda: as fitas não têm faixas.
              </p>
            ) : (
              <>
                <ul className={styles.artists}>
                  {topArtists.map((a) => (
                    <li key={a.artist} className={styles.artist}>
                      <span>{a.artist}</span>
                      <span className={styles.artistCount}>
                        {plural(a.count, "faixa", "faixas")}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className={styles.caption}>
                  contando as faixas de todas as fitas, rascunhos incluídos
                </p>
              </>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
