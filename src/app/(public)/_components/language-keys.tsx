"use client";

import { useRef } from "react";

// The language selector's keyboard, the only script the selector has (ADR
// 0008 § 6, the V4.4 handoff): the arrow keys move through the options and
// open the menu, Escape closes it and returns focus to its button, and
// leaving it closes it. Without JavaScript the selector is still a native
// disclosure of real links. This island receives no data, only the
// server-rendered selector as its children.

export function LanguageKeys({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const root = useRef<HTMLDivElement>(null);

  const parts = () => {
    const details = root.current?.querySelector("details") ?? null;
    return {
      details,
      summary: details?.querySelector("summary") ?? null,
      options: details
        ? Array.from(details.querySelectorAll<HTMLAnchorElement>("a[href]"))
        : [],
    };
  };

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const { details, summary, options } = parts();
    if (!details) {
      return;
    }
    if (event.key === "Escape" && details.open) {
      event.preventDefault();
      details.open = false;
      summary?.focus();
      return;
    }
    if (
      (event.key === "ArrowDown" || event.key === "ArrowUp") &&
      options.length > 0
    ) {
      event.preventDefault();
      details.open = true;
      const index = options.indexOf(
        document.activeElement as HTMLAnchorElement,
      );
      const next =
        event.key === "ArrowDown"
          ? (index + 1) % options.length
          : index <= 0
            ? options.length - 1
            : index - 1;
      options[next]?.focus();
    }
  }

  function onBlur(event: React.FocusEvent<HTMLDivElement>) {
    const { details } = parts();
    if (
      details?.open &&
      !root.current?.contains(event.relatedTarget as Node | null)
    ) {
      details.open = false;
    }
  }

  return (
    <div
      ref={root}
      className="public-language-keys"
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      {children}
    </div>
  );
}
