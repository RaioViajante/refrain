import type { Metadata } from "next";

import { SITE_IMAGES, type SiteImageSlot } from "@/content/site-images";
import { getDatabase } from "@/db/client";
import { requireStudio } from "@/server/auth/studio";
import { listImagesForStudio } from "@/server/studio/images";
import { listSlotsForStudio } from "@/server/studio/site-content";

import { Library } from "./library";
import type { StudioPhoto } from "./photo-types";
import { SlotRow } from "./slot-row";
import styles from "./page.module.css";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "fotos" };

const SLOT_GROUPS: { title: string; prefix: string }[] = [
  { title: "home", prefix: "home." },
  { title: "sobre", prefix: "about." },
  { title: "rodapé", prefix: "footer." },
];

const slotLabel = (slot: string) =>
  slot in SITE_IMAGES ? SITE_IMAGES[slot as SiteImageSlot] : slot;

export default async function PhotosPage() {
  await requireStudio();
  const db = getDatabase();
  const [rows, slots] = await Promise.all([
    listImagesForStudio(db),
    listSlotsForStudio(db),
  ]);

  const photos: StudioPhoto[] = rows.map((r) => ({
    id: r.id,
    url: r.url,
    alt: r.alt,
    width: r.width,
    height: r.height,
    focus: r.focus,
    treatment: r.treatment,
    rightsConfirmed: r.rightsConfirmed,
    rightsNote: r.rightsNote,
    usage: r.usage.map((u) =>
      u.kind === "cover"
        ? `capa de ${u.label}`
        : u.kind === "detail"
          ? `foto de apoio de ${u.label}`
          : slotLabel(u.label),
    ),
  }));
  const byId = new Map(photos.map((p) => [p.id, p]));
  const hidden = photos.filter((p) => !p.rightsConfirmed).length;
  const allSlots = Object.keys(SITE_IMAGES) as SiteImageSlot[];
  const filled = allSlots.filter((s) => slots.has(s)).length;

  return (
    <main id="conteudo" className={styles.main}>
      <div className={styles.head}>
        <p className={styles.kicker}>Nº 006 · fotos</p>
        <p className={styles.number} aria-hidden="true">
          006
        </p>
        <h1 className={`t-in ${styles.title}`}>fotos</h1>
        <p className={styles.lede}>
          a biblioteca, e os lugares fixos das páginas.
        </p>
        <a href="#enviar" className={`btn ${styles.headButton}`}>
          + enviar foto
        </a>
      </div>

      <section aria-labelledby="ft-01" className={styles.section} id="enviar">
        <div className={styles.sectionHead}>
          <span className={styles.sectionNumber}>01</span>
          <h2 className={`rv ${styles.h2}`} id="ft-01">
            enviar uma foto
          </h2>
          <span className={styles.sectionAside}>JPEG ou PNG, até 4 MB</span>
        </div>
        <UploadForm idPrefix="nova" />
      </section>

      <section aria-labelledby="ft-02" className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionNumber}>02</span>
          <h2 className={`rv ${styles.h2}`} id="ft-02">
            biblioteca
          </h2>
          <span className={styles.sectionAside}>
            {photos.length} {photos.length === 1 ? "foto" : "fotos"}
            {hidden > 0 ? ` · ${hidden} fora do site` : ""}
          </span>
        </div>
        <p className={styles.help}>
          só aparece no site a foto com os direitos de publicação confirmados. o
          filtro do site entra sozinho, a não ser que a foto fique “original”.
        </p>
        <Library photos={photos} />
      </section>

      <section aria-labelledby="ft-03" className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionNumber}>03</span>
          <h2 className={`rv ${styles.h2}`} id="ft-03">
            lugares do site
          </h2>
          <span className={styles.sectionAside}>
            {filled} de {allSlots.length} preenchidos
          </span>
        </div>
        <p className={styles.help}>
          cada lugar mostra uma foto da biblioteca. vazio, o lugar fica em
          branco no site e a página continua igual.
        </p>
        {SLOT_GROUPS.map((g) => (
          <div key={g.prefix} className={styles.slotGroup}>
            <h3 className={styles.groupTitle}>{g.title}</h3>
            <ul className={styles.slots}>
              {allSlots
                .filter((s) => s.startsWith(g.prefix))
                .map((s) => {
                  const id = slots.get(s);
                  return (
                    <SlotRow
                      key={s}
                      slot={s}
                      label={SITE_IMAGES[s]}
                      current={id ? (byId.get(id) ?? null) : null}
                      library={photos}
                      fallback={
                        s === "footer.road_mobile" && !id
                          ? "vazio, usa a foto da estrada do desktop."
                          : null
                      }
                    />
                  );
                })}
            </ul>
          </div>
        ))}
      </section>
    </main>
  );
}
