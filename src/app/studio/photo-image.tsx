"use client";

import { useEffect, useRef, useState } from "react";

// The image inside an artist photograph's frame (M3.3). If it fails to load,
// it is removed, so the frame's fallback is all that remains: no broken-image
// icon or border is drawn over it. A failure can happen before the page is
// hydrated, when no error handler is attached yet, so the image's state is
// also read once after hydration.

export function PhotoImage({
  src,
  srcSet,
  sizes,
}: {
  src: string;
  srcSet: string;
  sizes: string;
}) {
  const image = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = image.current;
    if (element && element.complete && element.naturalWidth === 0) {
      setFailed(true);
    }
  }, []);

  if (failed) {
    return null;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a remote, credited photograph, not routed through an image optimizer (docs/evidence/m3-3.md)
    <img
      ref={image}
      src={src}
      srcSet={srcSet}
      sizes={sizes}
      width={330}
      height={412}
      alt=""
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
