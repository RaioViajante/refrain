import Image from "next/image";
import type { CSSProperties } from "react";

import { cx } from "@/lib/cx";

// The owner's drawn marks (public/marcas/, provenance in docs/assets.md).
// Rules (refrain-design): at most one star per section; the engraving only
// opens inner pages; nothing right before the footer. Always decorative.
const SPARKLES = {
  1: { src: "/marcas/sparkle1.png", width: 360, height: 377 },
  2: { src: "/marcas/sparkle2.png", width: 392, height: 464 },
  3: { src: "/marcas/sparkle3.png", width: 386, height: 343 },
  4: { src: "/marcas/sparkle4.png", width: 516, height: 372 },
} as const;

export type SparkleKind = keyof typeof SPARKLES;

/** A drawn star that breathes (7 s), each one out of step by `delay`. */
export function Sparkle({
  kind,
  className,
  style,
  delay,
  rotate,
  sizes = "120px",
}: {
  kind: SparkleKind;
  className?: string;
  style?: CSSProperties;
  delay?: string;
  rotate?: number;
  sizes?: string;
}) {
  const { src, width, height } = SPARKLES[kind];
  return (
    <Image
      src={src}
      width={width}
      height={height}
      alt=""
      aria-hidden="true"
      sizes={sizes}
      className={cx("tw", className)}
      style={
        {
          height: "auto",
          ...(rotate ? { transform: `rotate(${rotate}deg)` } : null),
          ...(delay ? { "--d": delay } : null),
          ...style,
        } as CSSProperties
      }
    />
  );
}

/** The engraving of trees that opens inner pages. */
export function Trees({
  className,
  style,
  sizes = "300px",
}: {
  className?: string;
  style?: CSSProperties;
  sizes?: string;
}) {
  return (
    <Image
      src="/marcas/eng_trees_r.png"
      width={700}
      height={897}
      alt=""
      aria-hidden="true"
      sizes={sizes}
      className={className}
      style={{ height: "auto", ...style }}
    />
  );
}
