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
      <body>{children}</body>
    </html>
  );
}
