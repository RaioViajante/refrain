import Image from "next/image";
import type { CSSProperties } from "react";

import { cx } from "@/lib/cx";
import type { PublicImage } from "@/server/public-queries";

// images.focus: a 3 × 3 grid, 0 = top left … 4 = centre … 8 = bottom right.
const FOCUS = [
  "0% 0%",
  "50% 0%",
  "100% 0%",
  "0% 50%",
  "50% 50%",
  "100% 50%",
  "0% 100%",
  "50% 100%",
  "100% 100%",
] as const;

export function objectPosition(focus: number): string {
  return FOCUS[focus] ?? "50% 50%";
}

/**
 * An owner's photograph, with the site's treatment (`mood`) unless the owner
 * chose its original colours. `decorative` hides it from assistive
 * technology when the same picture is described nearby.
 */
export function Photo({
  image,
  sizes,
  className,
  style,
  priority,
  decorative,
}: {
  image: PublicImage;
  sizes: string;
  className?: string;
  style?: CSSProperties;
  priority?: boolean;
  decorative?: boolean;
}) {
  return (
    <Image
      src={image.url}
      width={image.width}
      height={image.height}
      alt={decorative ? "" : image.alt}
      aria-hidden={decorative || undefined}
      sizes={sizes}
      priority={priority}
      // Served as is by /fotos/<id>, never through the image optimizer: its
      // cache would outlive a revocation (src/server/media/photos.ts).
      unoptimized
      className={cx(image.treatment === "mood" && "mood", className)}
      style={{
        objectFit: "cover",
        objectPosition: objectPosition(image.focus),
        ...style,
      }}
    />
  );
}
