import type { Metadata } from "next";
import Link from "next/link";

import { PublicFrame } from "@/app/(public)/_components/public-frame";

// One view for every address that is not served: an unknown one, a draft, a
// private or deleted journal, an unpublished translation, a retired address,
// and any public address while public reads are off. It carries nothing about
// why, so no case can be told from another (ADR 0002, INV-5).
export const metadata: Metadata = {
  title: "Not found · refrain",
  description: "A personal music journal.",
};

export default function NotFound() {
  return (
    <PublicFrame>
      <main className="public-shell public-notfound" id="main">
        <h1 className="public-notfound-title">Nothing here</h1>
        <p>This page is not available.</p>
        <p>
          <Link className="public-link-inline" href="/">
            Back to the start
          </Link>
        </p>
      </main>
    </PublicFrame>
  );
}
