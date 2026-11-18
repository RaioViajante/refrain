"use client";

import { useEffect, useRef, useState } from "react";

import { PersonIcon } from "./person-icon";

// The frame of a public artist photograph (M3.5): the fixed 4:5 frame with its
// hatched fallback underneath and the photograph over it once loaded, so
// nothing moves while it loads or if it fails.
//
// If the image fails to load (Wikimedia unreachable, the file deleted, the
// image blocked), it is removed, so the fallback is all that remains and no
// broken-image icon is drawn; the frame's name and words then say that the
// photograph is not available, so a screen reader is not told about a picture
// nobody can see. A failure can happen before hydration, when no error handler
// is attached yet, so the image's state is also read once after hydration.
// Without JavaScript the image stays in place with an empty `alt`, which a
// browser draws as nothing when it fails, so the fallback still shows.
//
// The image is requested without a referrer, and only from Wikimedia's
// thumbnail host: the artist page's Content-Security-Policy allows nothing
// else.

/** The frame's words, chosen on the server in the page's interface language. */
export interface PhotoFrameWords {
  shown: string;
  failed: string;
  none: string;
  frame: string;
  notYet: string;
  unavailableNow: string;
  fromCommons: string;
}

export function PublicPhotoFrame({
  image,
  words,
}: Readonly<{
  image: { src: string; srcSet: string } | null;
  words: PhotoFrameWords;
}>) {
  const element = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const loaded = element.current;
    if (loaded && loaded.complete && loaded.naturalWidth === 0) {
      setFailed(true);
    }
  }, []);

  const shown = image !== null && !failed;
  return (
    <div
      className="pa-photo"
      role="img"
      aria-label={shown ? words.shown : image ? words.failed : words.none}
    >
      <span className="pj-cover-hatch" aria-hidden="true" />
      <span className="pj-cover-text" aria-hidden="true">
        <PersonIcon size={26} />
        <b>{words.frame}</b>
        <i>
          {image === null
            ? words.notYet
            : failed
              ? words.unavailableNow
              : words.fromCommons}
        </i>
      </span>
      {shown ? (
        // eslint-disable-next-line @next/next/no-img-element -- a remote, credited photograph, deliberately not routed through an image optimizer (docs/evidence/m3-5.md)
        <img
          ref={element}
          className="pa-photo-image"
          src={image.src}
          srcSet={image.srcSet}
          sizes="(max-width: 720px) calc(100vw - 36px), 400px"
          width={330}
          height={412}
          alt=""
          decoding="async"
          fetchPriority="high"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : null}
    </div>
  );
}
