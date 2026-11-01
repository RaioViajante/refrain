import Link from "next/link";
import type { ReactNode } from "react";

import { SignOutButton } from "@/app/studio/sign-out-button";

export type StudioSection =
  "desk" | "artists" | "albums" | "tracks" | "journals";

const SECTIONS: { id: StudioSection; label: string; href: string }[] = [
  { id: "desk", label: "Desk", href: "/studio" },
  { id: "artists", label: "Artists", href: "/studio/artists" },
  { id: "albums", label: "Albums", href: "/studio/albums" },
  { id: "tracks", label: "Tracks", href: "/studio/tracks" },
  { id: "journals", label: "Journals", href: "/studio/journals" },
];

/**
 * The studio's header and page furniture. Presentation only: it is rendered by
 * pages that have already authorized the request, and shows no private data.
 * The character illustration belongs to the public homepage and never appears
 * here.
 */
export function StudioFrame({
  current,
  children,
}: {
  current: StudioSection;
  children: ReactNode;
}) {
  return (
    <>
      <header className="studio-header">
        <p className="text-[16px] text-ink-2">Writing studio</p>
        <nav className="studio-nav" aria-label="Writing studio">
          {SECTIONS.map((section) => (
            <Link
              key={section.id}
              href={section.href}
              aria-current={section.id === current ? "page" : undefined}
            >
              {section.label}
            </Link>
          ))}
        </nav>
        <SignOutButton />
      </header>
      <main className="studio-main">{children}</main>
    </>
  );
}
