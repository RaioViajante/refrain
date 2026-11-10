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
// is the author's approved 404 drawing, as the production copy the owner
// authorized: a WebP made from the original PNG with its transparency kept
// bit for bit (docs/design-system.md § Assets). It is served as that file
// (`unoptimized`: no further copy), and it is the same for every address, so
// it tells nothing about one.
export const notFoundMetadata: Metadata = {
  title: "Not found · refrain",
  description: "A personal music journal.",
};

export function NotFoundView() {
  return (
    <PublicFrame>
      <main
        className="public-shell public-notfound"
        id={PUBLIC_CONTENT_ID}
        tabIndex={-1}
      >
        <Image
          className="public-notfound-art"
          src="/artwork/refrain-404.webp"
          width={1536}
          height={1024}
          unoptimized
          alt="Ink drawing of a person with curly hair and headphones, scratching their head over a map marked 404."
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
