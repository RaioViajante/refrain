// Cover Art Archive integration: public entry point. Server-only.
//
// A cover's image addresses are built only behind the cover display switch
// (`display.ts`): this entry point exports no other function that builds one
// (src/integrations/cover-art-archive/display.test.ts).
export {
  canonicalCoverUrl,
  COVER_ART_ARCHIVE_ORIGIN,
  COVER_ART_SOURCE,
  COVER_IMAGE_HOSTS,
  parseCoverUrl,
  storedCoverOf,
  type CoverReference,
} from "./artwork";
export {
  COVER_DISPLAY_VARIABLE,
  coverDisplayEnabled,
  displayedCoverFor,
  displayedCoverOf,
  displayedFrontThumbnailFor,
  type DisplayedCover,
} from "./display";
export {
  coverArtArchive,
  createCoverArtArchiveClient,
  type ArtworkImage,
  type CoverArtArchiveClient,
  type CoverArtArchiveOptions,
} from "./client";
