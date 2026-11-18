// Wikimedia Commons integration (M3.3): public entry point. The client is
// server-only; the stored-form functions are pure.
export {
  assessCommonsFile,
  photoPlanOf,
  type PhotoAssessment,
  type PhotoPlan,
  type PhotoRefusal,
} from "./assess";
export {
  createWikimediaClient,
  MAX_PHOTO_RESULTS,
  photoSearchTerms,
  wikimedia,
  type Freshness,
  type WikimediaClient,
  type WikimediaOptions,
} from "./client";
export type { CommonsFile } from "./contract";
export {
  canonicalDeedUrl,
  matchPhotoLicense,
  PHOTO_LICENSES,
  photoLicenseNamed,
  type PhotoLicense,
} from "./license";
export {
  artistPhotoOf,
  COMMONS_ORIGIN,
  photoFileName,
  PHOTO_IMAGE_HOSTS,
  PHOTO_MODIFICATIONS,
  PHOTO_SOURCE,
  photoCreditCaption,
  photoImageOf,
  photoSourceUrl,
  photoThumbnailUrl,
  photoTitleOf,
  THUMBNAIL_ORIGIN,
  type ArtistPhoto,
  type PhotoImage,
  type StoredArtistPhoto,
} from "./photo";
export { metadataText } from "./text";
