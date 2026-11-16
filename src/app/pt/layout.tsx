import type { Metadata } from "next";

import "@/app/globals.css";

// The Portuguese root layout (ADR 0008 § 2): the literal prefix `/pt`, and the
// document's language fixed here, as English's is in `(en)/layout.tsx`. It
// reads nothing: no request, no header, no cookie decides the language.
// `robots`: the initial indexing policy, as in the English root.
export const metadata: Metadata = {
  title: "refrain",
  description: "Um diário pessoal de música.",
  robots: "noindex, nofollow",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
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
