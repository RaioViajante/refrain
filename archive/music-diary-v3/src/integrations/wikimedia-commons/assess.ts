import type { CommonsFile } from "./contract";
import { matchPhotoLicense, type PhotoLicense } from "./license";
import {
  commonsFileName,
  hasPhotoExtension,
  isPlainCredit,
  MAX_CREDIT_LENGTH,
  MIN_PHOTO_HEIGHT,
  MIN_PHOTO_WIDTH,
  PHOTO_MODIFICATIONS,
  photoImageOf,
  photoSourceUrl,
  photoThumbnailUrl,
  photoTitleOf,
  STANDARD_THUMBNAIL_WIDTHS,
  STORED_THUMBNAIL_WIDTH,
  type PhotoImage,
} from "./photo";
import { metadataText } from "./text";

// Whether a Commons file may be offered as an artist photograph, and with
// which attribution (M3.3). Pure: the same file always gives the same answer.
// It fails closed: a file is usable only when nothing below refuses it.
//
// - The credit is the `Attribution` field when the file has one (Commons:
//   "custom attribution that should replace Artist + Credit"), otherwise the
//   `Artist` field: the creator named on the description page. It is never
//   the uploader; the uploader is not even requested.
// - A credit that is empty, says the author is unknown, is too long, or still
//   reads as markup after the HTML is reduced to text is refused, whatever
//   the license: the author reviews and stores a credit for every photograph.
// - The license must be accepted and its three metadata values must agree
//   (./license.ts). A file nominated for deletion is refused.
// - Only JPEG and PNG bitmaps at least 600 × 400 px, whose thumbnail and
//   description-page addresses are exactly the ones Refrain rebuilds from the
//   file name. Any other address means the stored form could not reproduce
//   what the author saw, so the file is not offered.

export type PhotoRefusal =
  | "unsupported_license"
  | "license_mismatch"
  | "non_free"
  | "no_creator"
  | "credit_not_plain"
  | "credit_too_long"
  | "deletion_requested"
  | "unsupported_format"
  | "too_small"
  | "unexpected_address";

// A credit that says the creator is not known, anywhere in it: "Unknown
// author (Columbia Records)", "Unidentified photographer", or a template's
// visible and hidden copies run together. Refused even if a real name
// contains one of these words; the file can still be chosen by another means
// later, never credited to nobody.
const UNKNOWN_CREDIT =
  /\b(?:unknown|anonymous|anonym|unidentified|unattributed|not provided|not known|see below|see source|see file history|unbekannt|desconhecido|desconocido|inconnu|sconosciuto)\b|^(?:n\/?a|none|\?+|-+)\.?$/i;

/** Long provider text, shortened for display (never stored). */
function shortened(text: string, max = 400): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export interface PhotoAssessment {
  fileName: string;
  title: string;
  sourceUrl: string;
  /** Present only when the file is usable: nothing else is ever loaded. */
  image: PhotoImage | null;
  width: number;
  height: number;
  mime: string;
  sha1: string;
  timestamp: string;
  license: PhotoLicense | null;
  /** The credit line to store and show, or null. */
  credit: string | null;
  /** The creator as the description page names them (plain text). */
  creator: string;
  /** Whether the credit came from the file's own `Attribution` field. */
  creditFromAttribution: boolean;
  /** The page's "Credit" (source) field, as plain text. */
  sourceCredit: string;
  /** The license terms as Commons words them, as plain text. */
  usageTerms: string;
  /** Commons restriction keywords, e.g. "personality", "trademarked". */
  restrictions: string[];
  modifications: string;
  refusals: PhotoRefusal[];
}

function restrictionsOf(value: string): string[] {
  return metadataText(value)
    .split("|")
    .map((word) => word.trim().toLowerCase())
    .filter((word) => /^[a-z0-9-]{1,40}$/.test(word))
    .slice(0, 10);
}

function addressesMatch(file: CommonsFile): boolean {
  if (
    !(STANDARD_THUMBNAIL_WIDTHS as readonly number[]).includes(file.thumbWidth)
  ) {
    return false;
  }
  if (file.thumbUrl !== photoThumbnailUrl(file.fileName, file.thumbWidth)) {
    return false;
  }
  // The API writes the page address with fewer characters encoded; compare
  // the decoded path.
  let page: URL;
  try {
    page = new URL(file.descriptionUrl);
  } catch {
    return false;
  }
  let path: string;
  try {
    path = decodeURIComponent(page.pathname);
  } catch {
    return false;
  }
  return (
    page.origin === "https://commons.wikimedia.org" &&
    !page.search &&
    path === `/wiki/File:${file.fileName}`
  );
}

export function assessCommonsFile(file: CommonsFile): PhotoAssessment {
  const refusals: PhotoRefusal[] = [];
  const meta = file.metadata;

  const matched = matchPhotoLicense({
    licenseShortName: metadataText(meta.LicenseShortName),
    license: metadataText(meta.License),
    licenseUrl: metadataText(meta.LicenseUrl),
    attributionRequired: metadataText(meta.AttributionRequired),
    copyrighted: metadataText(meta.Copyrighted),
    nonFree: metadataText(meta.NonFree),
  });
  if (!matched.ok) {
    refusals.push(matched.refusal);
  }

  const creator = metadataText(meta.Artist);
  const attribution = metadataText(meta.Attribution);
  const creditFromAttribution = attribution !== "";
  const candidate = creditFromAttribution ? attribution : creator;
  let credit: string | null = null;
  if (candidate === "" || UNKNOWN_CREDIT.test(candidate)) {
    refusals.push("no_creator");
  } else if (candidate.length > MAX_CREDIT_LENGTH) {
    refusals.push("credit_too_long");
  } else if (!isPlainCredit(candidate)) {
    refusals.push("credit_not_plain");
  } else {
    credit = candidate;
  }

  if (metadataText(meta.DeletionReason) !== "") {
    refusals.push("deletion_requested");
  }
  if (
    (file.mime !== "image/jpeg" && file.mime !== "image/png") ||
    file.mediaType !== "BITMAP" ||
    !hasPhotoExtension(file.fileName)
  ) {
    refusals.push("unsupported_format");
  }
  if (file.width < MIN_PHOTO_WIDTH || file.height < MIN_PHOTO_HEIGHT) {
    refusals.push("too_small");
  }
  if (commonsFileName(file.fileName) === null || !addressesMatch(file)) {
    refusals.push("unexpected_address");
  }

  return {
    fileName: file.fileName,
    title: photoTitleOf(file.fileName),
    sourceUrl: photoSourceUrl(file.fileName),
    image: refusals.length === 0 ? photoImageOf(file.fileName) : null,
    width: file.width,
    height: file.height,
    mime: file.mime,
    sha1: file.sha1,
    timestamp: file.timestamp,
    license: matched.ok ? matched.license : null,
    credit,
    creator: shortened(creator),
    creditFromAttribution,
    sourceCredit: shortened(metadataText(meta.Credit)),
    usageTerms: shortened(metadataText(meta.UsageTerms)),
    restrictions: restrictionsOf(meta.Restrictions),
    modifications: PHOTO_MODIFICATIONS,
    refusals,
  };
}

/** What is stored for a usable file: the plan the author approves. */
export interface PhotoPlan {
  fileName: string;
  sha1: string;
  timestamp: string;
  photoUrl: string;
  photoSourceUrl: string;
  photoLicense: string;
  photoCredit: string;
  /**
   * Commons' restriction keywords when reviewed (a personality-rights
   * warning, for example). Not stored; part of the fingerprint, so one added
   * between the review and the approval makes the approval stale.
   */
  restrictions: string[];
}

export function photoPlanOf(assessment: PhotoAssessment): PhotoPlan | null {
  if (
    assessment.refusals.length > 0 ||
    !assessment.license ||
    assessment.credit === null
  ) {
    return null;
  }
  return {
    fileName: assessment.fileName,
    sha1: assessment.sha1,
    timestamp: assessment.timestamp,
    photoUrl: photoThumbnailUrl(assessment.fileName, STORED_THUMBNAIL_WIDTH),
    photoSourceUrl: assessment.sourceUrl,
    photoLicense: assessment.license.name,
    photoCredit: assessment.credit,
    restrictions: assessment.restrictions,
  };
}
