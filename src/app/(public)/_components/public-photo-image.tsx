"use client";

import { useEffect, useRef, useState } from "react";

// The image inside a public artist photograph's frame (M3.5). If it fails to
// load (Wikimedia unreachable, the file deleted, the image blocked), it is
// removed, so the frame's fallback is all that remains and no broken-image
// icon is drawn over it. A failure can happen before hydration, when no error
// handler is attached yet, so the image's state is also read once after
// hydration. Without JavaScript the image stays in place with an empty `alt`,
// which browsers draw as nothing when it fails, so the fallback still shows.
//
// It is requested without a referrer, and only from Wikimedia's thumbnail
// host: the artist page's Content-Security-Policy allows nothing else.

export function PublicPhotoImage({
  src,
  srcSet,
  sizes,
}: Readonly<{ src: string; srcSet: string; sizes: string }>) {
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
    // eslint-disable-next-line @next/next/no-img-element -- a remote, credited photograph, deliberately not routed through an image optimizer (docs/evidence/m3-5.md)
    <img
      ref={image}
      className="pa-photo-image"
      src={src}
      srcSet={srcSet}
      sizes={sizes}
      width={330}
      height={412}
      alt=""
      decoding="async"
      fetchPriority="high"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
