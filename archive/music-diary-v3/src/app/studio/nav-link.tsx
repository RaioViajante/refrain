"use client";

import Link, { useLinkStatus } from "next/link";
import type { ReactNode } from "react";

// While the next section loads, the link's underline draws in: a quiet sign
// that the click was received. Nothing is announced and nothing moves.
function Pending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" data-pending={pending ? "" : undefined} />;
}

export function StudioNavLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <Link href={href} aria-current={current ? "page" : undefined}>
      {children}
      <Pending />
    </Link>
  );
}
