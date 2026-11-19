"use client";

import { useRef, useState } from "react";

import { cx } from "@/lib/cx";

import styles from "./page.module.css";
import { PhotoRow } from "./photo-row";
import type { StudioPhoto } from "./photo-types";

/** The library's list, with a message that outlives a deleted row. */
export function Library({ photos }: { photos: StudioPhoto[] }) {
  const [notice, setNotice] = useState("");
  const noticeRef = useRef<HTMLParagraphElement>(null);
  return (
    <>
      <p
        ref={noticeRef}
        role="status"
        tabIndex={-1}
        className={cx("msg-ok", styles.msg, styles.notice)}
      >
        {notice}
      </p>
      {photos.length === 0 ? (
        <p className={styles.empty}>
          nenhuma foto ainda. envie a primeira acima.
        </p>
      ) : (
        <ul className={styles.library}>
          {photos.map((p) => (
            <PhotoRow
              key={p.id}
              photo={p}
              onDeleted={(message) => {
                setNotice(message);
                requestAnimationFrame(() => noticeRef.current?.focus());
              }}
            />
          ))}
        </ul>
      )}
    </>
  );
}
