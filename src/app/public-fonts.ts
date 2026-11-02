import { Alegreya_Sans, Kalam } from "next/font/google";

// The two approved typefaces (docs/design-system.md § Typography), self-hosted
// by next/font: the browser never contacts Google Fonts. The public pages use
// the same weights as the Writing Studio.
const kalam = Kalam({
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "700"],
  variable: "--font-kalam",
});
const alegreyaSans = Alegreya_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "700"],
  style: ["normal", "italic"],
  variable: "--font-alegreya-sans",
});

/** The class names that define --font-kalam and --font-alegreya-sans. */
export const publicFontClasses = `${kalam.variable} ${alegreyaSans.variable}`;
