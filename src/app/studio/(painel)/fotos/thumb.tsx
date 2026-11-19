import Image from "next/image";

import { objectPosition } from "@/components/photo";
import { cx } from "@/lib/cx";

/**
 * A photo in the Studio, rights confirmed or not, cropped to its box with its
 * focal point, and with the site's filter when its treatment is "mood".
 */
export function Thumb({
  url,
  alt,
  focus,
  treatment,
  className,
}: {
  url: string;
  alt: string;
  focus: number;
  treatment: "mood" | "original";
  className?: string;
}) {
  return (
    <Image
      src={url}
      alt={alt}
      width={480}
      height={480}
      unoptimized
      className={cx(treatment === "mood" && "mood", className)}
      style={{ objectFit: "cover", objectPosition: objectPosition(focus) }}
    />
  );
}
