import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cx } from "@/lib/cx";

/** The ▶ that follows primary links and cover titles. */
export function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 11" aria-hidden="true" className={className}>
      <path d="M0 0l10 5.5L0 11z" fill="currentColor" />
    </svg>
  );
}

type LinkProps = Omit<ComponentProps<typeof Link>, "children"> & {
  children: ReactNode;
};

/** Primary link: bold, with a ▶ that steps forward on hover. */
export function PlayLink({ className, children, ...props }: LinkProps) {
  return (
    <Link {...props} className={cx("pl", className)}>
      {children} <PlayIcon />
    </Link>
  );
}

/** Secondary link: a fine line is drawn underneath on hover and focus. */
export function LineLink({ className, children, ...props }: LinkProps) {
  return (
    <Link {...props} className={cx("nl", className)}>
      {children}
    </Link>
  );
}
