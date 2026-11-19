import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import { isIndexable } from "@/lib/indexing";

import "./globals.css";

// Self-hosted at build time by next/font: no request to a font service at
// runtime. Inter is the only family (refrain-design).
const inter = Inter({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: { default: "refrain", template: "%s · refrain" },
  description:
    "um arquivo pessoal de mixtapes — músicas presas a sentimentos, lembranças e aos momentos a que pertencem.",
  // Indexable only on an authorized production deployment; Studio layouts
  // override this with noindex.
  robots: isIndexable()
    ? { index: true, follow: true }
    : { index: false, follow: false },
  // Favicons are pending: their files are not cleared for publication
  // (docs/assets.md).
};

export const viewport: Viewport = {
  themeColor: "#fbfbf8",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="rf pg">
        <a href="#conteudo" className="skip">
          pular para o conteúdo
        </a>
        {children}
      </body>
    </html>
  );
}
