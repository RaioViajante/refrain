import type { Metadata } from "next";
import { Alegreya_Sans, Kalam } from "next/font/google";

// The two approved typefaces (docs/design-system.md § Typography), self-hosted
// by next/font: the browser never contacts Google Fonts.
const kalam = Kalam({
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "700"],
  variable: "--font-kalam",
});
const alegreyaSans = Alegreya_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "700"],
  variable: "--font-alegreya-sans",
});

export const metadata: Metadata = {
  title: "Writing studio · refrain",
  // The studio is private: never indexed, never followed.
  robots: { index: false, follow: false },
};

// Presentation only. A layout is not an authorization boundary: every studio
// page checks the session itself (src/modules/identity).
export default function StudioLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`${kalam.variable} ${alegreyaSans.variable} studio`}>
      {children}
    </div>
  );
}
