import "server-only";

import { withDatabase } from "@/db";

import * as commands from "./commands";
import * as memories from "./memories";
import * as memoryQueries from "./memory-queries";
import * as publishing from "./publishing";
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
export const restoreAlbumJournal = withDatabase(commands.restoreAlbumJournal);

// Publication (ADR 0006): previews mint a confirmation token for the dialog,
// and the checked commands consume one that a dialog sent. A studio action
// calls one of them, never a preview and its consumer together.
export const previewAlbumJournalPublication = withDatabase(
  publishing.previewAlbumJournalPublication,
);
export const publishAlbumJournalVersion = withDatabase(
  publishing.publishAlbumJournalVersion,
);
export const previewAlbumJournalPublicChange = withDatabase(
  publishing.previewAlbumJournalPublicChange,
);

export const listAlbumJournals = withDatabase(queries.listAlbumJournals);
export const listDeletedAlbumJournals = withDatabase(
  queries.listDeletedAlbumJournals,
);
export const getAlbumJournal = withDatabase(queries.getAlbumJournal);
export const getJournalStatistics = withDatabase(queries.getJournalStatistics);
export const listAlbumJournalProgress = withDatabase(
  queries.listAlbumJournalProgress,
);
export const getTrackByTrack = withDatabase(queries.getTrackByTrack);

// Memories (M3.6): private writing only. There is deliberately no memory
// preview or publish wrapper: publishing a memory is M3.7.
export const createMemory = withDatabase(memories.createMemory);
export const saveMemory = withDatabase(memories.saveMemory);
export const setMemoryPrivacy = withDatabase(memories.setMemoryPrivacy);
export const deleteMemory = withDatabase(memories.deleteMemory);
export const restoreMemory = withDatabase(memories.restoreMemory);

export const listMemories = withDatabase(memoryQueries.listMemories);
export const listDeletedMemories = withDatabase(
  memoryQueries.listDeletedMemories,
);
export const getMemory = withDatabase(memoryQueries.getMemory);
export const listMemoriesOfRecording = withDatabase(
  memoryQueries.listMemoriesOfRecording,
);
export const getMemoryStatistics = withDatabase(
  memoryQueries.getMemoryStatistics,
);
