import Image from "next/image";
import type { CSSProperties } from "react";

import { cx } from "@/lib/cx";

/**
 * Whether the drawn marks (four stars and the tree engraving) may be
 * published. They are not yet: their authorship and licence are unverified
 * (docs/assets.md, "Pending"). Until the owner documents them, every mark
 * renders nothing and pages keep their layout without it. To ship them, add
 * the files to public/marcas/, record them in docs/assets.md, and set this
 * to true; src/assets.test.ts then checks that each file is recorded.
 */
export const MARKS_CLEARED = false;

const SPARKLES = {
  1: { src: "/marcas/sparkle1.png", width: 360, height: 377 },
  2: { src: "/marcas/sparkle2.png", width: 392, height: 464 },
  3: { src: "/marcas/sparkle3.png", width: 386, height: 343 },
  4: { src: "/marcas/sparkle4.png", width: 516, height: 372 },
} as const;

export const MARK_FILES = [
  ...Object.values(SPARKLES).map((s) => s.src),
  "/marcas/eng_trees_r.png",
];

export type SparkleKind = keyof typeof SPARKLES;

/**
 * A drawn star that breathes (7 s), each one out of step by `delay`. Rules
 * (refrain-design): at most one star per section; nothing right before the
 * footer. Always decorative.
 */
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
  if (!MARKS_CLEARED) return null;
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
  if (!MARKS_CLEARED) return null;
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
