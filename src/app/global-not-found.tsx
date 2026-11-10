import "@/app/globals.css";

import { NotFoundView, notFoundMetadata } from "@/app/not-found-view";

// An address that no route serves, or that the proxy decides is not served
// (ADR 0008 § 8). With more than one possible root layout, no root's
// not-found view can answer it, so this file is its own document. It is the
// same view as `(en)/not-found.tsx`, which answers a page's own `notFound()`.
export const metadata = notFoundMetadata;

export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body>
        <NotFoundView />
      </body>
    </html>
  );
}
