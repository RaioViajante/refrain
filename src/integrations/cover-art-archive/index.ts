// Cover Art Archive integration: public entry point. Server-only.
export {
  canonicalCoverUrl,
  COVER_ART_ARCHIVE_ORIGIN,
  COVER_ART_SOURCE,
  COVER_IMAGE_HOSTS,
  coverArtworkFor,
  coverArtworkOf,
  parseCoverUrl,
  type CoverArtwork,
  type CoverReference,
} from "./artwork";
export {
  coverArtArchive,
  createCoverArtArchiveClient,
  type ArtworkImage,
  type CoverArtArchiveClient,
  type CoverArtArchiveOptions,
} from "./client";
