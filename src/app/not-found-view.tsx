import Image from "next/image";
import Link from "next/link";

import {
  PUBLIC_CONTENT_ID,
  PublicFrame,
} from "@/app/(public)/_components/public-frame";
import { dictionaryFor } from "@/i18n/dictionaries";
import { otherLocale, type InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";

// One view for every address that is not served: an unknown one, a draft, a
// private or deleted journal, an unpublished translation, a retired address,
// and any public address while public reads are off. It carries nothing about
// why, so no case can be told from another (ADR 0002, INV-5). The illustration
// is the author's approved 404 drawing, as the production copy the owner
// authorized: a WebP made from the original PNG with its transparency kept
// bit for bit (docs/design-system.md § Assets). It is served as that file
// (`unoptimized`: no further copy), and it is the same for every address, so
// it tells nothing about one.
//
// The interim not-found view of ADR 0008 § 8: it says the same in both
// interface languages, each part marked with its own `lang`, and each part
// leads back to the start of its language. The address-level view
// (`global-not-found`) is the English document, so its frame and its
// `<html lang>` are English for every address, `/pt/...` included: that is
// the recorded limitation, and this is not a complete localization of the
// 404. Inside a root layout (a page's own `notFound()`), the frame and the
// order of the two parts follow that root's language.

export function NotFoundView({
  locale,
}: Readonly<{ locale: InterfaceLocale }>) {
  const first = dictionaryFor(locale).notFound;
  const second = otherLocale(locale);
  const then = dictionaryFor(second).notFound;
  return (
    <PublicFrame locale={locale} path="/">
      <main
        className="public-shell public-notfound"
        id={PUBLIC_CONTENT_ID}
        tabIndex={-1}
      >
        <Image
          className="public-notfound-art"
          src="/artwork/refrain-404.webp"
          width={1536}
          height={1024}
          unoptimized
          alt={first.drawingAlt}
        />
        <div lang={locale}>
          <h1 className="public-notfound-title">{first.title}</h1>
          <p>{first.body}</p>
          <p>
            <Link
              className="public-link-inline"
              href={localizedHref(locale, "/")}
            >
              {first.back}
            </Link>
          </p>
        </div>
        <div className="public-notfound-other" lang={second}>
          <p className="public-notfound-title public-notfound-title-other">
            {then.title}
          </p>
          <p>{then.body}</p>
          <p>
            <Link
              className="public-link-inline"
              href={localizedHref(second, "/")}
            >
              {then.back}
            </Link>
          </p>
        </div>
      </main>
    </PublicFrame>
  );
}
