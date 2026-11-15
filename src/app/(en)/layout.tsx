import type { Metadata } from "next";

import "@/app/globals.css";

// `robots`: the initial indexing policy, inherited by every page under this
// root. The value is src/indexing-policy.ts's, written out because this
// layout imports no application module, only its stylesheet
// (src/app/public-surface.test.ts);
// src/indexing-policy.test.ts keeps the copies equal.
export const metadata: Metadata = {
  title: "refrain",
  description: "A personal music journal.",
  robots: "noindex, nofollow",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* The approved record favicon and touch icon (ADR 0011, D11,
            proposed), promoted byte for byte into public/v3/. Written here,
            not as `metadata.icons`, whose streamed marker would make two
            answers of the same page differ in their row order. */}
        <link rel="icon" href="/v3/favicon.svg" type="image/svg+xml" />
        <link
          rel="apple-touch-icon"
          href="/v3/touch-icon.png"
          sizes="180x180"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
