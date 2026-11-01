import "server-only";

import { withDatabase } from "@/db";

import * as commands from "./commands";
import * as queries from "./queries";

// The Writing Studio's interface to the journals: commands and queries bound
// to the application's database. Each takes the AuthorizedAuthor first, which
// only the Identity module can create.

export const createAlbumJournal = withDatabase(commands.createAlbumJournal);
export const saveAlbumJournal = withDatabase(commands.saveAlbumJournal);
export const setAlbumJournalPrivacy = withDatabase(
  commands.setAlbumJournalPrivacy,
);
export const deleteAlbumJournal = withDatabase(commands.deleteAlbumJournal);

export const listAlbumJournals = withDatabase(queries.listAlbumJournals);
export const listDeletedAlbumJournals = withDatabase(
  queries.listDeletedAlbumJournals,
);
export const getAlbumJournal = withDatabase(queries.getAlbumJournal);
export const getJournalStatistics = withDatabase(queries.getJournalStatistics);
export const listAlbumJournalProgress = withDatabase(
  queries.listAlbumJournalProgress,
);
