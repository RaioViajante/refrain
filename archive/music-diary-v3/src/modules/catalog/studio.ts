import "server-only";

import { withDatabase } from "@/db";

import * as commands from "./commands";
import * as music from "./music";
import * as photos from "./photos";
import * as queries from "./queries";

// The Writing Studio's interface to the catalog: every command and query,
// bound to the application's database. Each still takes the AuthorizedAuthor
// as its first argument, which only the Identity module can create.

export const createArtist = withDatabase(commands.createArtist);
export const updateArtist = withDatabase(commands.updateArtist);
export const archiveArtist = withDatabase(commands.archiveArtist);
export const restoreArtist = withDatabase(commands.restoreArtist);
export const deleteArtist = withDatabase(commands.deleteArtist);

export const createAlbum = withDatabase(commands.createAlbum);
export const updateAlbum = withDatabase(commands.updateAlbum);
export const archiveAlbum = withDatabase(commands.archiveAlbum);
export const restoreAlbum = withDatabase(commands.restoreAlbum);
export const deleteAlbum = withDatabase(commands.deleteAlbum);

export const createTrack = withDatabase(commands.createTrack);
export const updateTrack = withDatabase(commands.updateTrack);
export const archiveTrack = withDatabase(commands.archiveTrack);
export const restoreTrack = withDatabase(commands.restoreTrack);
export const deleteTrack = withDatabase(commands.deleteTrack);

export const setAlbumTracklist = withDatabase(commands.setAlbumTracklist);
export const addTrackToAlbum = withDatabase(commands.addTrackToAlbum);
export const removeTrackFromAlbum = withDatabase(commands.removeTrackFromAlbum);
export const moveTrackInAlbum = withDatabase(commands.moveTrackInAlbum);

export const listArtists = withDatabase(queries.listArtists);
export const getArtist = withDatabase(queries.getArtist);
export const listAlbumsWithArtists = withDatabase(
  queries.listAlbumsWithArtists,
);
export const listAlbumUsage = withDatabase(queries.listAlbumUsage);
export const listAlbumTrackCounts = withDatabase(queries.listAlbumTrackCounts);
export const listAlbumCovers = withDatabase(queries.listAlbumCovers);
export const listArtistPhotos = withDatabase(queries.listArtistPhotos);
export const getAlbumCover = withDatabase(queries.getAlbumCover);
export const getAlbum = withDatabase(queries.getAlbum);
export const listTracks = withDatabase(queries.listTracks);
export const listRecordingChoices = withDatabase(queries.listRecordingChoices);
export const getTrack = withDatabase(queries.getTrack);
export const getCatalogStatistics = withDatabase(queries.getCatalogStatistics);

// Adding music from MusicBrainz and artwork from the Cover Art Archive (M3.2).
// Each fetches from the provider first, then writes, if at all, in its own
// transaction.
export const searchMusic = withDatabase(music.searchMusic);
export const listMusicEditions = withDatabase(music.listMusicEditions);
export const reviewMusicRelease = withDatabase(music.reviewMusicRelease);
export const importMusicRelease = withDatabase(music.importMusicRelease);
export const linkAlbumToMusic = withDatabase(music.linkAlbumToMusic);
export const reviewMusicArtist = withDatabase(music.reviewMusicArtist);
export const importMusicArtist = withDatabase(music.importMusicArtist);
export const linkArtistToMusic = withDatabase(music.linkArtistToMusic);
export const listAlbumArtworkChoices = withDatabase(
  music.listAlbumArtworkChoices,
);
export const setAlbumArtwork = withDatabase(music.setAlbumArtwork);
export const removeAlbumArtwork = withDatabase(music.removeAlbumArtwork);

// Artist photographs from Wikimedia Commons (M3.3). The same shape: the
// provider first, then, if at all, one short transaction.
export const listArtistPhotoChoices = withDatabase(
  photos.listArtistPhotoChoices,
);
export const reviewArtistPhoto = withDatabase(photos.reviewArtistPhoto);
export const setArtistPhoto = withDatabase(photos.setArtistPhoto);
export const removeArtistPhoto = withDatabase(photos.removeArtistPhoto);
