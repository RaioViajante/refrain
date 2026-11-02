import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import {
  PUBLIC_CONTENT_ID,
  PublicFrame,
} from "@/app/(public)/_components/public-frame";

// One view for every address that is not served: an unknown one, a draft, a
// private or deleted journal, an unpublished translation, a retired address,
// and any public address while public reads are off. It carries nothing about
// why, so no case can be told from another (ADR 0002, INV-5). The illustration
// is the author's approved 404 drawing, served as the original file
// (`unoptimized`: no resized or re-encoded copy), and is the same for every
// address, so it tells nothing about one.
export const metadata: Metadata = {
  title: "Not found · refrain",
  description: "A personal music journal.",
};

export default function NotFound() {
  return (
    <PublicFrame>
      <main
        className="public-shell public-notfound"
        id={PUBLIC_CONTENT_ID}
        tabIndex={-1}
      >
        <Image
          className="public-notfound-art"
          src="/artwork/refrain-404.png"
          width={1536}
          height={1024}
          unoptimized
          priority
          alt="Ink drawing of a person with curly hair and headphones, sitting cross-legged and scratching their head over a map marked 404, next to a stack of records, a mug, a cassette and a signpost."
        />
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
