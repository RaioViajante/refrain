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

import { failureMessage, type WritingSubject } from "./messages";
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
  /** The label is read by assistive technology but not drawn. */
  hideLabel?: boolean;
  hint?: string;
  problem?: string;
  htmlFor: string;
  describedBy: string;
  children: ReactNode;
}

function FieldFrame({
  className,
  label,
  hideLabel,
  hint,
  problem,
  htmlFor,
  describedBy,
  children,
}: FieldFrameProps) {
  return (
    <div className={`studio-field-group ${className ?? ""}`}>
      <label
        htmlFor={htmlFor}
        className={hideLabel ? "studio-sr-only" : "studio-label"}
      >
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
  placeholder?: string;
  hideLabel?: boolean;
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
  placeholder,
  hideLabel,
  variant,
}: TextFieldProps) {
  const id = useId();
  const describedBy = `${id}-note`;
  return (
    <FieldFrame
      label={label}
      hideLabel={hideLabel}
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
        placeholder={placeholder}
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

/**
 * A title written as one line in Kalam, as large as an editor's heading, with
 * one drawn line under it. It wraps instead of scrolling out of sight, and it
 * grows with what is written: a textarea that holds one line, where Enter
 * adds nothing and a pasted line break becomes a space. Its label is read by
 * assistive technology, and the placeholder is what is drawn.
 */
export function TitleField({
  label,
  value,
  onChange,
  placeholder,
  problem,
  maxLength,
  lang,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  problem?: string;
  maxLength?: number;
  lang?: string;
}) {
  const id = useId();
  const describedBy = `${id}-note`;
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = area.current;
    if (!element) {
      return;
    }
    const fit = () => {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    };
    fit();
    // The width changes the number of lines too.
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [value]);
  return (
    <FieldFrame
      label={label}
      hideLabel
      problem={problem}
      htmlFor={id}
      describedBy={describedBy}
    >
      <textarea
        id={id}
        ref={area}
        rows={1}
        className="studio-opening-field studio-title-field"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        lang={lang}
        spellCheck
        onChange={(event) =>
          onChange(event.target.value.replace(/\r?\n/g, " "))
        }
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
          }
        }}
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
  /** The id of text elsewhere on the page that also describes the select. */
  describedById?: string;
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
  describedById,
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
        aria-describedby={
          describedById ? `${describedBy} ${describedById}` : describedBy
        }
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
  placeholder?: string;
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
  placeholder,
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
        placeholder={placeholder}
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
  /** The confirm control cannot be used yet, for example while text loads. */
  confirmDisabled?: boolean;
  /** Removes the confirm control, when the dialog has nothing to confirm. */
  hideConfirm?: boolean;
  /** Controls that sit beside the confirm control, such as "Review again". */
  extraActions?: ReactNode;
  cancelLabel?: string;
  /**
   * When this changes, focus returns to the title. A review dialog replaces
   * its own controls as it moves from reading to ready to refused, and the
   * control that had focus would otherwise vanish with it.
   */
  focusKey?: string;
  /** The name of the reading area of a review dialog. */
  regionLabel?: string;
  /**
   * A dialog that shows the author what will become public. It is wider, its
   * text scrolls, and focus starts on its title, not on the confirm control,
   * so a keypress cannot confirm before anything has been read.
   */
  review?: boolean;
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
  confirmDisabled,
  hideConfirm,
  extraActions,
  cancelLabel = "Cancel",
  focusKey,
  regionLabel,
  review,
}: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) {
      return;
    }
    // The control that opened the dialog, to hand focus back to. A dialog
    // that is removed from the page cannot do it itself.
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!element.open) {
      element.showModal();
    }
    if (review) {
      heading.current?.focus();
    }
    return () => {
      if (element.open) {
        element.close();
      }
      if (opener?.isConnected) {
        opener.focus();
      }
    };
  }, [open, review]);

  useEffect(() => {
    if (review && focusKey !== undefined) {
      // A notice that says what just happened (a refusal, a removal) takes
      // focus, so it is read before anything else; otherwise the title does.
      const notice =
        dialog.current?.querySelector<HTMLElement>("[data-notice]");
      (notice ?? heading.current)?.focus();
    }
  }, [review, focusKey]);

  return (
    <dialog
      ref={dialog}
      className={`studio-dialog ${review ? "studio-dialog-review" : ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) {
          onCancel();
        }
      }}
    >
      <h2
        id={titleId}
        ref={heading}
        className="studio-section-title"
        tabIndex={review ? -1 : undefined}
      >
        {title}
      </h2>
      {review ? (
        <div
          className="studio-dialog-body"
          role="region"
          aria-label={regionLabel ?? title}
          tabIndex={0}
        >
          {children}
        </div>
      ) : (
        <div>{children}</div>
      )}
      <div className="studio-actions">
        {hideConfirm ? null : (
          <button
            type="button"
            className="studio-button studio-button-primary"
            onClick={onConfirm}
            disabled={pending || confirmDisabled}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        )}
        {extraActions}
        <button
          type="button"
          className="studio-button"
          onClick={onCancel}
          disabled={pending}
        >
          {cancelLabel}
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
        result = { ok: false, code: "unreachable" };
      }
      if (!result.ok) {
        setFailure(result);
      }
      setPending(false);
      return result;
    },
    [],
  );

  return {
    pending,
    failure,
    run,
    clearFailure: () => setFailure(undefined),
    /** Shows a failure that a dialog met, in the form's own words. */
    report: (reported: Failure) => setFailure(reported),
  };
}

/** The outcome of the last save, in words, announced politely. */
export function FormStatus({
  pending,
  failure,
  saved,
  dirty,
  subject,
}: {
  pending: boolean;
  failure?: Failure;
  saved?: boolean;
  dirty?: boolean;
  /** What the form edits, for the words of a refusal. */
  subject?: WritingSubject;
}) {
  let text = "";
  if (pending) {
    text = "Saving…";
  } else if (failure) {
    text = failureMessage(failure, subject);
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
