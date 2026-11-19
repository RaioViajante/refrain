import type { Metadata } from "next";
import type { ReactNode } from "react";

import { requireStudio } from "@/server/auth/studio";

import "../studio.css";
import { StudioHeader } from "../studio-header";

export const metadata: Metadata = {
  title: { default: "studio", template: "%s · studio · refrain" },
  robots: { index: false, follow: false },
};

/** Every page below also calls requireStudio() itself. */
export default async function StudioLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireStudio();
  return (
    <>
      <StudioHeader />
      {children}
    </>
  );
}
