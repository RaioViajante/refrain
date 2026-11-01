// Music Catalog module: public entry point. Server-only.
//
// The functions are bound to the application's database and take the
// AuthorizedAuthor first. The commands and queries that take a
// DatabaseExecutor stay inside the module (./commands, ./queries), where
// tests run them in a rolled-back transaction.
export { CatalogError, type CatalogBlocker, type CatalogFailure } from "./errors";
export {
  MAX_ALBUM_TRACKS,
  MAX_CREDITS,
  type AlbumInput,
  type ArtistInput,
  type MoveDirection,
  type NewTrackInput,
  type TrackInput,
  type TracklistInput,
} from "./input";
export type {
  AlbumCredit,
  AlbumDetail,
  AlbumTrackCount,
  AlbumUsage,
  ArtistDetail,
  ArtistSummary,
  CatalogStatistics,
  TrackDetail,
  TrackSummary,
} from "./queries";
export {
  addTrackToAlbum,
  archiveAlbum,
  archiveArtist,
  archiveTrack,
  createAlbum,
  createArtist,
  createTrack,
  deleteAlbum,
  deleteArtist,
  deleteTrack,
  getAlbum,
  getArtist,
  getCatalogStatistics,
  getTrack,
  listAlbumsWithArtists,
  listAlbumTrackCounts,
  listAlbumUsage,
  listArtists,
  listTracks,
  moveTrackInAlbum,
  removeTrackFromAlbum,
  restoreAlbum,
  restoreArtist,
  restoreTrack,
  setAlbumTracklist,
  updateAlbum,
  updateArtist,
  updateTrack,
} from "./studio";
