import { Archivo, Instrument_Serif, La_Belle_Aurore, Silkscreen } from "next/font/google";

// The four approved v3 faces (docs/design-system.md, Part I, Type), self-hosted
// by next/font so the browser never contacts Google Fonts. Each defines one
// CSS variable that src/app/v3/v3.css uses in place of the family name.
const archivo = Archivo({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "700", "800"],
  style: ["normal", "italic"],
  variable: "--f-archivo",
});
const instrumentSerif = Instrument_Serif({
  subsets: ["latin", "latin-ext"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--f-serif",
});
const silkscreen = Silkscreen({
  subsets: ["latin", "latin-ext"],
  weight: "400",
  variable: "--f-pixel",
});
const laBelleAurore = La_Belle_Aurore({
  subsets: ["latin", "latin-ext"],
  weight: "400",
  variable: "--f-hand",
});

/** The class names that define the four font variables. */
export const v3FontClasses = [
  archivo.variable,
  instrumentSerif.variable,
  silkscreen.variable,
  laBelleAurore.variable,
].join(" ");
