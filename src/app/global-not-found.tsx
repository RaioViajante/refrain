import "@/app/globals.css";

import { notFoundMetadata } from "@/app/(public)/_components/page-metadata";
import { NotFoundView } from "@/app/not-found-view";

// An address that no route serves, or that the proxy decides is not served
// (ADR 0008 § 8). With more than one root layout, no root's not-found view can
// answer it, so this file is its own document: the same for every address, in
// both languages, `/pt/...` included. It is English as a document (the
// recorded interim limitation), and its Portuguese part carries its own
// `lang`. A page's own `notFound()` renders the same view inside its root.
export const metadata = notFoundMetadata("en");

export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body>
        <NotFoundView locale="en" />
      </body>
    </html>
  );
}
