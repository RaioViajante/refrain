// The licenses Refrain accepts for an artist photograph (M3.3), and how a
// Commons file's license metadata is matched against them. Pure functions.
//
// Policy (docs/security.md § External providers; docs/evidence/m3-3.md):
//
// - Accepted: CC0 1.0, works Commons marks as public domain, and the generic,
//   unported, or international versions of CC BY and CC BY-SA (2.0, 2.5, 3.0,
//   4.0). Each has a fixed name, CommonsMetadata's machine code, and, except
//   for the public domain, its canonical deed address.
// - Everything else is refused: non-commercial and no-derivatives variants,
//   jurisdiction ports ("CC BY-SA 3.0 de"), GFDL-only and other licenses,
//   files marked non-free, and any file whose short name, code, and deed
//   address do not all name the same accepted license. CommonsMetadata says
//   its license values are unreliable for multi-licensed files; requiring the
//   three to agree is how an ambiguous value is caught. Where they agree, the
//   file is offered under that license, which a reuser of a multi-licensed
//   file may choose.
// - A free license covers the copyright in the photograph. It does not cover
//   the rights of the people shown in it (personality and privacy rights),
//   which the studio states separately on every review.

export interface PhotoLicense {
  /** The name stored in `artists.photo_license` and shown to readers. */
  name: string;
  /** CommonsMetadata's `License` code. */
  code: string;
  /** The license deed, or null for the public domain (no license). */
  url: string | null;
  /** Whether the license requires attribution. */
  attributionRequired: boolean;
  /** Whether adaptations must carry the same license. */
  shareAlike: boolean;
  publicDomain: boolean;
}

const creativeCommons = (
  kind: "by" | "by-sa",
  version: "2.0" | "2.5" | "3.0" | "4.0",
): PhotoLicense => ({
  name: `CC ${kind.toUpperCase()} ${version}`,
  code: `cc-${kind}-${version}`,
  url: `https://creativecommons.org/licenses/${kind}/${version}/`,
  attributionRequired: true,
  shareAlike: kind === "by-sa",
  publicDomain: false,
});

export const PHOTO_LICENSES: readonly PhotoLicense[] = [
  {
    name: "CC0",
    code: "cc0",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    attributionRequired: false,
    shareAlike: false,
    publicDomain: true,
  },
  {
    name: "Public domain",
    code: "pd",
    url: null,
    attributionRequired: false,
    shareAlike: false,
    publicDomain: true,
  },
  ...(["4.0", "3.0", "2.5", "2.0"] as const).flatMap((version) => [
    creativeCommons("by", version),
    creativeCommons("by-sa", version),
  ]),
];

/** The accepted license with this stored name, or null. Exact match only. */
export function photoLicenseNamed(name: unknown): PhotoLicense | null {
  return PHOTO_LICENSES.find((license) => license.name === name) ?? null;
}

/**
 * A Creative Commons deed address in its canonical form, or null: HTTP or
 * HTTPS on creativecommons.org, a trailing `deed.<language>` and the trailing
 * slash optional, no query, fragment, credentials, or port.
 */
export function canonicalDeedUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.hostname !== "creativecommons.org" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  const path = url.pathname
    .replace(/\/deed\.[a-z]{2,3}(?:[-_][A-Za-z]{2,4})?$/, "/")
    .replace(/\/?$/, "/");
  if (!/^\/(?:licenses|publicdomain)\/[a-z0-9.\-/]+\/$/.test(path)) {
    return null;
  }
  return `https://creativecommons.org${path}`;
}

/** The license fields of a file's extended metadata, as plain text. */
export interface LicenseMetadata {
  licenseShortName: string;
  license: string;
  licenseUrl: string;
  attributionRequired: string;
  copyrighted: string;
  nonFree: string;
}

export type LicenseRefusal =
  "unsupported_license" | "license_mismatch" | "non_free";

/**
 * The accepted license a file's metadata names, or why it is refused. The
 * short name, the machine code, and the deed address must agree, and so must
 * the attribution and copyright flags.
 */
export function matchPhotoLicense(
  metadata: LicenseMetadata,
):
  { ok: true; license: PhotoLicense } | { ok: false; refusal: LicenseRefusal } {
  if (metadata.nonFree.trim().toLowerCase() === "true") {
    return { ok: false, refusal: "non_free" };
  }
  const code = metadata.license.trim().toLowerCase();
  const license = PHOTO_LICENSES.find((candidate) => candidate.code === code);
  if (!license) {
    return { ok: false, refusal: "unsupported_license" };
  }
  const shortName = metadata.licenseShortName.replace(/\s+/g, " ").trim();
  if (shortName.toLowerCase() !== license.name.toLowerCase()) {
    return { ok: false, refusal: "license_mismatch" };
  }
  if (license.url === null) {
    if (metadata.licenseUrl.trim() !== "") {
      return { ok: false, refusal: "license_mismatch" };
    }
  } else if (canonicalDeedUrl(metadata.licenseUrl) !== license.url) {
    return { ok: false, refusal: "license_mismatch" };
  }
  const attribution = metadata.attributionRequired.trim().toLowerCase();
  if (license.attributionRequired && attribution !== "true") {
    return { ok: false, refusal: "license_mismatch" };
  }
  if (license.code === "pd" && metadata.copyrighted.trim() !== "False") {
    return { ok: false, refusal: "license_mismatch" };
  }
  return { ok: true, license };
}
