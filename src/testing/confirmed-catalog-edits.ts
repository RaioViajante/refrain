// Catalog edits through the author's confirmed path (ADR 0013 step 3), for
// tests: the review first, then the edit with the token that review minted.
// An edit that changes no published page has no token and is sent as is, so
// these behave exactly as the Studio's dialog does. Imported only by tests.
import type { DatabaseExecutor } from "@/db";
// eslint-disable-next-line no-restricted-imports
import * as catalog from "@/modules/catalog/commands";
import type { AuthorizedAuthor } from "@/modules/identity";

export async function updateArtist(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  artistId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const review = await catalog.previewArtistChange(db, author, artistId, patch);
  await catalog.updateArtist(db, author, artistId, patch, {
    confirmation: review.confirmation ?? undefined,
  });
}

export async function updateAlbum(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  albumId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const review = await catalog.previewAlbumChange(db, author, albumId, patch);
  await catalog.updateAlbum(db, author, albumId, patch, {
    confirmation: review.confirmation ?? undefined,
  });
}

export async function updateTrack(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  trackId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const review = await catalog.previewTrackChange(db, author, trackId, patch);
  await catalog.updateTrack(db, author, trackId, patch, {
    confirmation: review.confirmation ?? undefined,
  });
}

export async function setAlbumTracklist(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  albumId: string,
  input: { tracks: { trackId: string; discNumber?: number }[] },
): Promise<void> {
  const review = await catalog.previewTracklistChange(db, author, albumId, {
    operation: "set",
    tracks: input.tracks,
  });
  await catalog.setAlbumTracklist(db, author, albumId, input, {
    confirmation: review.confirmation ?? undefined,
  });
}

export async function addTrackToAlbum(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  albumId: string,
  trackId: string,
): Promise<void> {
  const review = await catalog.previewTracklistChange(db, author, albumId, {
    operation: "add",
    trackId,
  });
  await catalog.addTrackToAlbum(db, author, albumId, trackId, {
    confirmation: review.confirmation ?? undefined,
  });
}

export async function createTrack(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  input: {
    title: string;
    albumId: string;
    artistIds?: string[];
    credit?: string | null;
  },
): Promise<{ id: string }> {
  const review = await catalog.previewTracklistChange(
    db,
    author,
    input.albumId,
    {
      operation: "create",
      track: {
        title: input.title,
        artistIds: input.artistIds ?? [],
        ...(input.credit !== undefined ? { credit: input.credit } : {}),
      },
    },
  );
  return catalog.createTrack(db, author, input, {
    confirmation: review.confirmation ?? undefined,
  });
}
