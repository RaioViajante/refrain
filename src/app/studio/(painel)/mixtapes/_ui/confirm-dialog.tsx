"use client";

import {
  type ReactNode,
  useActionState,
  useEffect,
  useId,
  useRef,
} from "react";

import type { ActionResult } from "@/server/studio/errors";

import type { StudioAction } from "./call";
import styles from "./ui.module.css";

type Props = {
  /** Small label above the question ("excluir fita"). */
  label: string;
  heading: string;
  children: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  action: StudioAction;
  /** Hidden fields; `confirmar=sim` is always sent. */
  fields: Record<string, string>;
  onCancel: () => void;
  /** Runs before the form is sent (e.g. to keep a message across a redirect). */
  onSubmit?: () => void;
  onDone?: (result: Extract<ActionResult, { ok: true }>) => void;
};

/**
 * Reference: the "excluir fita" dialog of StudioMixtapes.dc.html. A native
 * modal <dialog> (focus stays inside, Esc cancels); mount it to open it.
 */
export function ConfirmDialog({
  label,
  heading,
  children,
  confirmLabel,
  pendingLabel = "excluindo…",
  action,
  fields,
  onCancel,
  onSubmit,
  onDone,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [state, formAction, pending] = useActionState(action, null);

  useEffect(() => {
    const dialog = ref.current;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      // Back to the control that opened it, when it is still there.
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    if (state?.ok) onDone?.(state);
  }, [state, onDone]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <form action={formAction} onSubmit={onSubmit}>
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <input type="hidden" name="confirmar" value="sim" />
        <p className={styles.dlgLabel}>{label}</p>
        <h2 id={headingId} className={styles.dlgTitle}>
          {heading}
        </h2>
        <p className={styles.dlgBody}>{children}</p>
        {state && !state.ok ? (
          <p role="alert" className={`msg-error ${styles.dlgError}`}>
            {state.error}
          </p>
        ) : null}
        <div className={styles.dlgActions}>
          <button
            type="button"
            className={`nl ${styles.cancel}`}
            onClick={onCancel}
            disabled={pending}
          >
            cancelar
          </button>
          <button type="submit" className="btn" disabled={pending}>
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** The reference's "no site" switch: a pill with a sliding knob. */
export function PublishSwitch({
  published,
  name,
  disabled,
  onToggle,
  className,
}: {
  published: boolean;
  /** Read before the state, e.g. the tape's title. */
  name?: string;
  disabled?: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={published}
      onClick={onToggle}
      disabled={disabled}
      className={`${styles.switch} ${className ?? ""}`}
    >
      <span aria-hidden="true" className={styles.track}>
        <span className={styles.knob} />
      </span>
      {name ? <span className="visually-hidden">{name}, no site: </span> : null}
      {published ? "publicada" : "rascunho"}
    </button>
  );
}
