import "server-only";

import { withDatabase } from "@/db";

import * as commands from "./commands";
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
export const listAlbumsWithArtists = withDatabase(queries.listAlbumsWithArtists);
export const listAlbumUsage = withDatabase(queries.listAlbumUsage);
export const listAlbumTrackCounts = withDatabase(queries.listAlbumTrackCounts);
export const getAlbum = withDatabase(queries.getAlbum);
export const listTracks = withDatabase(queries.listTracks);
export const getTrack = withDatabase(queries.getTrack);
export const getCatalogStatistics = withDatabase(queries.getCatalogStatistics);
