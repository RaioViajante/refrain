"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type HTMLInputAutoCompleteAttribute,
  type ReactNode,
} from "react";

import { failureMessage } from "./messages";
import type { ActionResult } from "./results";

type Failure = Extract<ActionResult<unknown>, { ok: false }>;

// Building blocks of the studio's forms: labelled fields with a quiet frame
// that turns ink on focus, problems said in words, a confirmation dialog, and
// protection against losing what was typed.

/**
 * While `dirty`, warns before the page is left: closing the tab, reloading,
 * or following a link. The text itself stays on the page when a save fails,
 * so a failed save never loses it.
 */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    // Links inside the app are client-side navigations, which `beforeunload`
    // never sees. A capturing listener runs before the router's own.
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!link || link.getAttribute("target") === "_blank") {
        return;
      }
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        return;
      }
      if (!window.confirm("You have unsaved changes. Leave without saving?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}

interface FieldFrameProps {
  className?: string;
  label: string;
  hint?: string;
  problem?: string;
  htmlFor: string;
  describedBy: string;
  children: ReactNode;
}

function FieldFrame({
  className,
  label,
  hint,
  problem,
  htmlFor,
  describedBy,
  children,
}: FieldFrameProps) {
  return (
    <div className={`studio-field-group ${className ?? ""}`}>
      <label htmlFor={htmlFor} className="studio-label">
        {label}
      </label>
      {children}
      <div id={describedBy}>
        {problem ? (
          <p className="studio-problem" role="alert">
            {problem}
          </p>
        ) : null}
        {hint ? <p className="studio-hint">{hint}</p> : null}
      </div>
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  problem?: string;
  type?: "text" | "number" | "date";
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  inputMode?: "text" | "numeric";
  autoComplete?: HTMLInputAutoCompleteAttribute;
  lang?: string;
  width?: string;
  /** "opening" draws the sentence in Kalam light, with one line under it. */
  variant?: "opening";
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  problem,
  type = "text",
  required,
  maxLength,
  min,
  max,
  inputMode,
  autoComplete = "off",
  lang,
  width,
  variant,
}: TextFieldProps) {
  const id = useId();
  const describedBy = `${id}-note`;
  return (
    <FieldFrame
      label={label}
      hint={hint}
      problem={problem}
      htmlFor={id}
      describedBy={describedBy}
    >
      <input
        id={id}
        type={type}
        className={
          variant === "opening" ? "studio-opening-field" : "studio-field"
        }
        style={width ? { maxWidth: width } : undefined}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onChange(event.target.value)
        }
        required={required}
        maxLength={maxLength}
        min={min}
        max={max}
        inputMode={inputMode}
        autoComplete={autoComplete}
        lang={lang}
        aria-invalid={problem ? true : undefined}
        aria-describedby={describedBy}
      />
    </FieldFrame>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  problem?: string;
  required?: boolean;
  /** "inline" puts the label beside the select, for a bar. */
  variant?: "inline";
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  hint,
  problem,
  required,
  variant,
}: SelectFieldProps) {
  const id = useId();
  const describedBy = `${id}-note`;
  return (
    <FieldFrame
      className={variant === "inline" ? "studio-field-inline" : undefined}
      label={label}
      hint={hint}
      problem={problem}
      htmlFor={id}
      describedBy={describedBy}
    >
      <select
        id={id}
        className="studio-field"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        aria-invalid={problem ? true : undefined}
        aria-describedby={describedBy}
      >
        {placeholder !== undefined ? (
          <option value="">{placeholder}</option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}

interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  problem?: string;
  rows?: number;
  maxLength?: number;
  lang?: string;
}

export function TextAreaField({
  label,
  value,
  onChange,
  hint,
  problem,
  rows = 16,
  maxLength,
  lang,
}: TextAreaFieldProps) {
  const id = useId();
  const describedBy = `${id}-note`;
  return (
    <FieldFrame
      label={label}
      hint={hint}
      problem={problem}
      htmlFor={id}
      describedBy={describedBy}
    >
      <textarea
        id={id}
        className="studio-textarea"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        maxLength={maxLength}
        lang={lang}
        spellCheck
        aria-invalid={problem ? true : undefined}
        aria-describedby={describedBy}
      />
    </FieldFrame>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}

/**
 * A modal confirmation, on the browser's own `<dialog>`: it traps focus,
 * closes on Escape, and returns focus to the control that opened it.
 */
export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  pending,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) {
      return;
    }
    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="studio-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) {
          onCancel();
        }
      }}
    >
      <h2 id={titleId} className="studio-section-title">
        {title}
      </h2>
      <div>{children}</div>
      <div className="studio-actions">
        <button
          type="button"
          className="studio-button studio-button-primary"
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? "Working…" : confirmLabel}
        </button>
        <button
          type="button"
          className="studio-button"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </button>
      </div>
    </dialog>
  );
}

/**
 * Runs a server action for a form, and keeps its outcome: whether it is
 * running, and the failure it returned, if any. A network error or a thrown
 * error becomes the generic failure, so the form never loses what was typed.
 */
export function useSubmission() {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | undefined>();

  const run = useCallback(
    async <Data,>(
      work: () => Promise<ActionResult<Data>>,
    ): Promise<ActionResult<Data>> => {
      setPending(true);
      setFailure(undefined);
      let result: ActionResult<Data>;
      try {
        result = await work();
      } catch {
        result = { ok: false, code: "failed" };
      }
      if (!result.ok) {
        setFailure(result);
      }
      setPending(false);
      return result;
    },
    [],
  );

  return { pending, failure, run, clearFailure: () => setFailure(undefined) };
}

/** The outcome of the last save, in words, announced politely. */
export function FormStatus({
  pending,
  failure,
  saved,
  dirty,
}: {
  pending: boolean;
  failure?: Failure;
  saved?: boolean;
  dirty?: boolean;
}) {
  let text = "";
  if (pending) {
    text = "Saving…";
  } else if (failure) {
    text = failureMessage(failure);
  } else if (dirty) {
    text = "Unsaved changes";
  } else if (saved) {
    text = "Saved just now";
  }
  return (
    <p
      role={failure && !pending ? "alert" : "status"}
      className={failure && !pending ? "studio-problem" : "studio-hint"}
      style={failure && !pending ? { maxWidth: "62ch" } : undefined}
    >
      {text}
    </p>
  );
}
