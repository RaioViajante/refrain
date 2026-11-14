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
      <body>{children}</body>
    </html>
  );
}
