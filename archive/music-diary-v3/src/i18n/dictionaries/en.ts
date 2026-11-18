import { authored } from "@/i18n/authored";
import { counted } from "@/i18n/format";

// The public interface in English (ADR 0008 § 4). This object defines the
// dictionary's type: the Portuguese one must have exactly these keys. A
// string that takes values is a function of plain values. Dictionaries hold
// interface copy only, never the writing of an entry.

export const en = {
  site: {
    name: "refrain",
    description: "A personal music journal.",
  },
  frame: {
    skipLink: "Skip to content",
    navigationLabel: "Main",
    sections: {
      home: "Home",
      albums: "Albums",
      artists: "Artists",
      memories: "Memories",
    },
    closingLine: "some songs take you back.",
    keepReading: "Keep reading",
  },
  languageSelector: {
    label: "Language",
    note: "Changes the interface only. Writing stays in the language it was written in.",
  },
  /** The language a piece of writing is in, as "Written in …" names it. */
  writingLanguages: {
    en: "English",
    "pt-BR": "Brazilian Portuguese",
  },
  writtenIn: (language: string) => `Written in ${language}`,
  rating: {
    label: "My rating",
    accessible: (value: string) => `My rating: ${value} out of 5`,
  },
  loading: "Loading…",
  home: {
    /**
     * The introduction under the drawing: a neutral interim line chosen by
     * the owner (M3.4), not in the first person. It doubles as the Home's
     * description.
     */
    introduction: authored(
      "A personal music journal about albums, songs, and the memories attached to them.",
      "en",
    ),
    characterAlt:
      "Ink drawing of a person with curly hair and headphones, sitting cross-legged on the floor and writing in a notebook while looking up, next to a stack of records, a mug, a cassette and a few crumpled pages.",
    nothingPublished: "Nothing published yet.",
    mostRecent: "Most recent:",
    memory: "Memory",
    albumJournal: "Album journal",
    memoryWith: (song: string) => `Memory · ${song}`,
    albumJournalBy: (credit: string) => `Album journal · ${credit}`,
    recentlyWritten: "Recently written",
    albums: "Albums",
    allAlbumJournals: "All album journals",
    artists: "Artists",
    allArtists: "All artists",
    memories: "Memories",
    allMemories: "All memories",
    noArtwork: "no artwork yet",
    unavailable: "The latest writing could not be loaded just now.",
  },
  lists: {
    music: "Music: ",
    andMore: (count: number) => `and ${count} more`,
    albums: (count: number) => counted("en", count, "album", "albums"),
    journals: (count: number) => counted("en", count, "journal", "journals"),
  },
  archives: {
    albums: {
      title: "Albums",
      /** The V4.4 screen's lead. Also the page's description. */
      lead: authored(
        "Whole records, written about slowly. Some have every track, some only a few.",
        "en",
      ),
    },
    artists: {
      title: "Artists",
      /** The owner's lead (M3.8a). Also the page's description. */
      lead: authored("The artists behind the albums I've written about.", "en"),
    },
    memories: {
      title: "Memories",
      /** The owner's words (M3.8a review). Also the page's description. */
      lead: authored("Memories and the music woven through them.", "en"),
    },
    nothingPublished: "Nothing published yet.",
    unavailable: "This list could not be loaded just now.",
    tracksWritten: (written: number, total: number) =>
      `${written} of ${total} tracks written`,
    anotherJournal: "Another journal, published",
    aboutAlbum: (title: string) => ` (about ${title})`,
    memoryPublished: "Published",
  },
  albumJournal: {
    kind: "Album journal",
    description: "An album journal.",
    published: "Published",
    goToTracks: "Go to the tracks",
    artworkFor: (title: string) => `Album artwork for ${title}`,
    artworkMissingFor: (title: string) =>
      `Album artwork for ${title}: not available yet`,
    artwork: "Album artwork",
    artworkFromArchive: "loads from Cover Art Archive",
    artworkNotYet: "not available yet",
    artworkCaption: "Cover: Cover Art Archive",
    tracks: (count: number) => counted("en", count, "track", "tracks"),
    trackByTrack: "Track by track",
    trackByTrackHint:
      "Open a track to read what I wrote. Not every track has a reflection.",
    favourite: "Favourite: ",
    stillWriting: " (still writing)",
    by: (credit: string) => `by ${credit}`,
    track: (number: number) => `Track ${number}: `,
    notWrittenYet: "not written yet",
    allAlbums: "All albums",
    moreAbout: (name: string) => `More about ${name}`,
  },
  artist: {
    kind: "Artist",
    description: (name: string) => `Album journals about music by ${name}.`,
    inThisJournal: "In this journal",
    albumJournals: "Album journals",
    tracksWrittenAbout: "Tracks I wrote about",
    trackShare: (written: number, total: number) =>
      `${written} / ${total} tracks`,
    trackShareSpoken: (written: number, total: number) =>
      `${written} of ${total} tracks written about`,
    inAlbum: (title: string) => `in ${title}`,
    allArtists: "All artists",
  },
  photo: {
    of: (name: string) => `Photograph of ${name}`,
    unavailableNowOf: (name: string) =>
      `Photograph of ${name}: not available just now`,
    noneOf: (name: string) => `No photograph of ${name} yet`,
    frame: "Artist photograph",
    notYet: "not available yet",
    unavailableNow: "not available just now",
    fromCommons: "from Wikimedia Commons",
    captionPrefix: "Photo: ",
    licenseAsMarked: (name: string) =>
      `${name} (as marked on Wikimedia Commons)`,
    viaCommons: " · via Wikimedia Commons",
    details: "Photo details",
    work: "Photograph",
    credit: "Credit",
    source: "Source",
    commons: "Wikimedia Commons",
    license: "License",
    shareAlike: "Adaptations must use the same license.",
    changes: "Changes",
    /** The changes Refrain makes to every photograph, as they are stored. */
    standardChanges: "Resized, and cropped to fit the frame. No other changes.",
  },
  memory: {
    kind: "Memory",
    description: "A memory in a personal music journal.",
    about: "About this memory",
    published: "Published",
    music: "The music",
    album: "Album",
    allMemories: "All memories",
  },
  notFound: {
    title: "Nothing here",
    body: "This page is not available.",
    back: "Back to the start",
    pageTitle: "Not found",
    drawingAlt:
      "Ink drawing of a person with curly hair and headphones, scratching their head over a map marked 404.",
  },
};

export type Dictionary = typeof en;
