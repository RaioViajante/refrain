import { counted, ratingText } from "@/i18n/format";

// The Writing Studio in English (ADR 0008 § 4). This object defines the
// Studio dictionary's type: the Portuguese one must have exactly these keys.
// A string that takes values is a function of plain values. Interface copy
// only: never writing, and never anything from a request. Every value is
// rendered as text.

/** A catalog record's kind, as the Studio's sentences about one name it. */
export type RecordKind = "artist" | "album" | "track";

/** The kind of writing a sentence is about. */
export type WritingKind = "journal" | "memory";

export const studioEn = {
  meta: {
    studio: "Writing studio · refrain",
    signIn: "Sign in · refrain",
    catalog: "Catalog · refrain",
    addMusic: "Add music · refrain",
    reviewBeforeAdding: "Review before adding · refrain",
    chooseEdition: "Choose an edition · refrain",
    artists: "Artists · refrain",
    newArtist: "Add an artist · refrain",
    artist: "Artist · refrain",
    photo: "Photograph · refrain",
    photoReview: "Review photograph · refrain",
    albums: "Albums · refrain",
    newAlbum: "Add an album · refrain",
    album: "Album · refrain",
    artwork: "Artwork · refrain",
    tracks: "Tracks · refrain",
    newTrack: "Add a track · refrain",
    track: "Track · refrain",
    journals: "Journals · refrain",
    newJournal: "Write a journal · refrain",
    journal: "Journal · refrain",
    editJournal: "Edit a journal · refrain",
    deleted: "Recently deleted · refrain",
    memories: "Memories · refrain",
    newMemory: "Write a memory · refrain",
    memory: "Memory · refrain",
  },
  frame: {
    studio: "Writing studio",
    skipLink: "Skip to the content",
    navigationLabel: "Writing studio",
    desk: "Desk",
    catalog: "Catalog",
    catalogNavigationLabel: "Catalog sections",
    overview: "Overview",
    artists: "Artists",
    albums: "Albums",
    tracks: "Tracks",
    closingLine: "some songs take you back.",
    loading: "Loading…",
    unavailable: "The studio isn’t available right now. Try again later.",
  },
  languageSelector: {
    label: "Language",
    note: "Changes the interface only. Writing stays in the language it was written in.",
  },
  /** Each language in its own words, as the V4.4 screens name them. */
  languageNames: {
    en: "English",
    "pt-BR": "Português (Brasil)",
  },
  /** A language of the writing, as the Studio's sentences name it. */
  languageInSentence: {
    en: "English",
    "pt-BR": "Português (Brasil)",
  },
  signIn: {
    title: "Sign in",
    email: "Email",
    password: "Password",
    submit: "Sign in",
    pending: "Signing in…",
    mismatch: "That email and password don’t match.",
    tooMany: "Too many attempts. Wait a minute, then try again.",
    refused: "This sign-in was refused. Reload the page and try again.",
    failed: "Couldn’t sign in. Try again.",
  },
  signOut: {
    action: "Sign out",
    pending: "Signing out…",
    failed: "Couldn’t sign out. Try again.",
  },
  common: {
    cancel: "Cancel",
    working: "Working…",
    saving: "Saving…",
    savedNow: "Saved just now",
    unsaved: "Unsaved changes",
    leaveUnsaved: "You have unsaved changes. Leave without saving?",
    edit: "Edit",
    optional: "optional",
  },
  /** A version's status after "it is", inside a sentence. */
  statusInSentence: {
    draft: "a draft",
    private: "private",
    published: "published",
  },
  /** A version's status inside a sentence. */
  statusLower: {
    draft: "draft",
    private: "private",
    published: "published",
  },
  status: {
    draft: "Draft",
    private: "Private",
    published: "Published",
  },
  /** A memory's status, where the language agrees with the noun. */
  memoryStatus: {
    draft: "Draft",
    private: "Private",
    published: "Published",
  },
  fields: {
    required: "This is required.",
    tooLong: "This is too long.",
    invalid: "This isn’t valid.",
  },
  failures: {
    unauthorized:
      "Your session has ended. Sign in again in another tab, then try again. What you typed is still here.",
    unavailable:
      "The studio can’t check your session right now. Try again in a moment. What you typed is still here.",
    invalidInput: "Some fields need attention.",
    notFound: "That record no longer exists. Reload the page.",
    inUse: "Something still depends on it. Archive it instead.",
    blockedBy: {
      album_credits:
        "It is credited on an album. Remove those credits first, or archive it instead.",
      track_credits:
        "It is credited on a track. Remove those credits first, or archive it instead.",
      journals:
        "Journals are written about it, so it stays in your catalog. Archive it instead.",
      memories:
        "A memory links to it, so it stays in your catalog. Archive it instead.",
      albums:
        "It is on an album. Remove it from the album first, or archive it instead.",
      reflections:
        "A track reflection is written about it, so it stays on the album.",
    },
    duplicate: "That MusicBrainz identifier is already in your catalog.",
    archived: "An archived record can’t be added. Restore it first.",
    conflict: {
      journal:
        "This journal changed somewhere else since you opened it, so nothing was saved. Your text is still here: copy it, reload the page, and save again.",
      memory:
        "This memory changed somewhere else since you opened it, so nothing was saved. Your text is still here: copy it, reload the page, and save again.",
    },
    deleted: {
      journal: "This journal is in Recently deleted, so it can’t be changed.",
      memory: "This memory is in Recently deleted, so it can’t be changed.",
    },
    notDeleted: {
      journal:
        "This journal is not in Recently deleted, so there is nothing to restore. It may already have been restored. Reload the page.",
      memory:
        "This memory is not in Recently deleted, so there is nothing to restore. It may already have been restored. Reload the page.",
    },
    unsupported:
      "This text has formatting that the plain editor can’t show without losing it, so it was left untouched.",
    reviewChanged:
      "What would be published has changed since you looked, or your confirmation ran out, so nothing was published or saved. Your text is still here. Review it again to continue.",
    nothingToPublish: {
      journal:
        "A version needs an opening sentence or some text before it can be published, and a published version has to keep one. Nothing was changed. Write something first, or unpublish it before you empty it.",
      memory:
        "A memory needs a title and some writing before it can be published, and a published memory has to keep them. Nothing was changed. Write something first, or unpublish it before you empty it.",
    },
    statusChanged:
      "This version was changed somewhere else (another tab may have published or unpublished it), so nothing was changed here. The page now shows how it stands. Check it, then choose again.",
    unreachable:
      "The studio didn’t answer, so it isn’t known whether this went through. Reload the page to see what was saved before you try again. What you typed is still here.",
    noAddress: {
      journal:
        "This journal has no address, so it can’t be published. Nothing was changed.",
      memory:
        "This memory has no address, so it can’t be published. Nothing was changed.",
    },
    providerUnavailable:
      "Couldn’t reach MusicBrainz, the Cover Art Archive, or Wikimedia Commons, so nothing was changed. Your catalog and your writing still work. Try again in a moment.",
    providerNotFound:
      "MusicBrainz or Wikimedia Commons no longer has that record or file. Search again.",
    stale:
      "Something changed since you looked: MusicBrainz, the Cover Art Archive, Wikimedia Commons, or this record in your catalog. Nothing was changed. Review it again.",
    unsupportedRelease:
      "This release can’t be added as one album. Add it by hand, or link an album you already have.",
    alreadyLinked:
      "This record is already linked to a different MusicBrainz entry, and a link is never replaced. Nothing was changed.",
    notLinked:
      "This album isn’t linked to MusicBrainz yet, so there is no artwork to choose from.",
    publicPage:
      "A published journal shows this on a public page, and this change would reach readers without a confirmation, which isn’t built yet. Nothing was changed. A photograph can always be removed; to change one, or to restore an artist that has one, remove it first or unpublish the journals that show it.",
    photoNotUsable:
      "This photograph can no longer be used: its license, credit, or file changed on Wikimedia Commons. Nothing was changed. Choose another, or review it again.",
    failed: "Something went wrong, and nothing was changed. Try again.",
  },
  /**
   * What the Studio says about the web. It is true whichever way the
   * installation is configured: a public page is served only where the
   * server-side public-reads switch is on, and it is off by default.
   */
  publicPageNote:
    "On the web it opens at its address only where public reads are switched on. They are off by default, so on a default installation nothing opens on the web.",
  records: {
    restore: {
      artist: "Restore artist",
      album: "Restore album",
      track: "Restore track",
    },
    archive: {
      artist: "Archive artist…",
      album: "Archive album…",
      track: "Archive track…",
    },
    remove: {
      artist: "Delete artist…",
      album: "Delete album…",
      track: "Delete track…",
    },
    archiveQuestion: {
      artist: "Archive this artist?",
      album: "Archive this album?",
      track: "Archive this track?",
    },
    archiveConfirm: "Archive",
    removeQuestion: {
      artist: "Delete this artist?",
      album: "Delete this album?",
      track: "Delete this track?",
    },
    removeConfirm: "Delete",
    removeBody: {
      artist:
        "This removes the artist from your catalog for good. It only works when nothing refers to it: if anything does, nothing is deleted, and you can archive it instead. Your writing is never deleted by this.",
      album:
        "This removes the album from your catalog for good. It only works when nothing refers to it: if anything does, nothing is deleted, and you can archive it instead. Your writing is never deleted by this.",
      track:
        "This removes the track from your catalog for good. It only works when nothing refers to it: if anything does, nothing is deleted, and you can archive it instead. Your writing is never deleted by this.",
    },
  },
  artistRows: {
    artist: (legend: string, n: number) => `${legend}: artist ${n}`,
    choose: "Choose an artist",
    creditedAs: (legend: string, n: number) =>
      `${legend}: credited as, artist ${n}`,
    creditedAsPlaceholder: "Credited as (optional)",
    moveUp: (n: number) => `Move artist ${n} up`,
    moveDown: (n: number) => `Move artist ${n} down`,
    remove: (n: number) => `Remove artist ${n}`,
    removeShort: "Remove",
    addFirst: "Add an artist",
    addAnother: "Add another artist",
  },
  artwork: {
    noneLabel: "No album artwork yet",
    none: "no artwork yet",
    label: "Album artwork",
    labelFor: (title: string) => `Album artwork for ${title}`,
    notShown: "artwork not shown",
  },
  counts: {
    journals: (n: number) => counted("en", n, "journal", "journals"),
    memories: (n: number) => counted("en", n, "memory", "memories"),
    artists: (n: number) => counted("en", n, "artist", "artists"),
    albums: (n: number) => counted("en", n, "album", "albums"),
    tracks: (n: number) => counted("en", n, "track", "tracks"),
    words: (n: number) => counted("en", n, "word", "words"),
  },
  catalog: {
    title: "Catalog",
    lead: "The artists, albums and tracks your writing points to. Nothing here deletes writing.",
    addMusic: "Add music",
    emptyTitle: "Nothing in the catalog yet",
    emptyStart: "Everything starts with an artist or a band. ",
    emptyFind: "Find one on MusicBrainz",
    emptyOr: " or ",
    emptyByHand: "add one by hand",
    emptyEnd:
      ", then an album that credits them, and the music you love will have somewhere to live.",
    areasLabel: "Catalog areas",
    addArtist: "Add an artist",
    addAlbum: "Add an album",
    addTrack: "Add a track",
    albumsSummary: (albums: number, withoutTracks: number) =>
      `${counted("en", albums, "album", "albums")} · ${counted("en", withoutTracks, "album", "albums")} without tracks`,
    tracksSummary: (tracks: number, onNoAlbum: number) =>
      `${counted("en", tracks, "track", "tracks")} · ${counted("en", onNoAlbum, "track", "tracks")} on no album`,
    archivedNote: (n: number) =>
      `${counted("en", n, "archived record", "archived records")}. Archived records are hidden from pickers and stay attached to the writing that uses them.`,
  },
  artists: {
    title: "Artists",
    lead: "The people and bands behind the music you write about.",
    add: "Add an artist",
    emptyTitle: "No artists yet",
    emptyBody:
      "Everything starts with an artist or a band. Add one, then an album that credits them, and the music you love will have somewhere to live.",
    listLabel: "Artists",
    archived: "Archived",
    archivedHint:
      "Hidden from pickers. Their albums, tracks, and journals are untouched.",
    archivedLabel: "Archived artists",
    band: "Band",
    person: "Person",
  },
  photograph: {
    of: (name: string) => `Photograph of ${name}`,
    noneOf: (name: string) => `No photograph of ${name} yet`,
    notShown: "photograph not shown",
    noneYet: "no photograph yet",
    captionPrefix: "Photo: ",
    licenseAsMarked: (name: string) =>
      `${name} (as marked on Wikimedia Commons)`,
    viaCommons: " · via Wikimedia Commons",
    details: "Photo details",
    work: "Photograph",
    credit: "Credit",
    source: "Source",
    sourceCommons: "Wikimedia Commons, ",
    filePage: "the file’s page",
    license: "License",
    shareAlike: ". Adaptations must use the same license.",
    changes: "Changes",
    /** The changes Refrain makes to every photograph, as they are stored. */
    standardChanges: "Resized, and cropped to fit the frame. No other changes.",
  },
  catalogRecord: {
    archiveOrDelete: "Archive or delete",
  },
  artist: {
    back: "← Artists",
    archived:
      "This artist is archived: hidden from pickers, with everything written about them kept.",
    photograph: "Photograph",
    photoUnreadable:
      "The photograph on file isn’t in the form Refrain writes, so it isn’t shown. Open the photograph page to remove it.",
    noPhoto: "No photo. The page works without one.",
    restoreToChangePhoto: "Restore the artist to change the photograph.",
    choosePhoto: "Choose from Wikimedia Commons…",
    changePhoto: "Change or remove the photograph…",
    albums: "Albums",
    noAlbums: "No album credits this artist yet. ",
    addAlbum: "Add an album",
    credited: (albums: number, tracks: number) =>
      `Credited on ${counted("en", albums, "album", "albums")} and ${counted("en", tracks, "track", "tracks")}.`,
    archiveNote: (albums: number, tracks: number, journals: number) =>
      `Archiving hides the artist from pickers and deletes nothing. ${counted("en", albums, "album", "albums")} and ${counted("en", tracks, "track", "tracks")} keep the credit, and ${counted("en", journals, "journal", "journals")} written about the artist stay as they are, showing the name as plain text.`,
  },
  artistForm: {
    name: "Name",
    kind: "Person or band",
    person: "A person",
    group: "A band or group",
    sortName: "Sort name (optional)",
    sortNameHint: "How to file the name in lists, for example “Buckley, Jeff”.",
    mbArtistId: "MusicBrainz artist ID (optional)",
    mbArtistIdHint:
      "Filled in when you add or link this artist from Add music. Saving this form looks nothing up.",
    save: "Save artist",
    add: "Add artist",
  },
  photoPage: {
    title: "Photograph",
    lead: "Choose a freely licensed photograph from Wikimedia Commons, or none. Only photographs with a license Refrain accepts and a named creator are offered, and nothing changes until you choose one.",
    onFile: "On file",
    notShownTitle: "Not shown",
    notShownBody:
      "The photograph on file isn’t in the form Refrain writes (it may have been changed outside the studio), so it isn’t shown. Remove it, then choose again.",
    archived:
      "This artist is archived. Restore it to choose a photograph; the photograph on file can still be removed.",
    search: "Search Wikimedia Commons",
    looking: "Looking on Wikimedia Commons…",
    source:
      "Photographs from Wikimedia Commons, each under its own license and credited as it asks. A free license covers the photograph, not the people in it.",
    check: {
      new_version:
        "A new version of this file was uploaded to Wikimedia Commons after you chose it, and the frame now shows that version. Review it again, or remove it.",
      details_changed:
        "Its credit or license on Wikimedia Commons changed after you chose it. Review it again to keep the attribution right, or remove it.",
      missing:
        "Wikimedia Commons no longer has this file; it may have been deleted. Remove it, or choose another.",
      not_usable:
        "On Wikimedia Commons, this file no longer meets Refrain’s license and credit rules. Remove it, or choose another.",
      unavailable:
        "Couldn’t check this file on Wikimedia Commons just now. The photograph on file is unchanged.",
    },
    onPublicPageTitle: "Shown on a public page",
    onPublicPageBody:
      "A published journal puts this artist on a public page, so its photograph can’t be replaced: a new one would reach readers without a confirmation, and that confirmation isn’t built yet. You can still remove it above. To choose another, unpublish the journals that show this artist first.",
    checkTitle: "The photograph on file",
    reviewAgain: "Review it again",
    searchFor: (name: string) =>
      `Search Wikimedia Commons for a photograph of ${name}.`,
    unreachableTitle: "Couldn’t reach Wikimedia Commons.",
    unreachableBody:
      "Your catalog and your writing still work, and the photograph on file is unchanged. Try again in a moment.",
    tryAgain: "Try again",
    nothingFound: (query: string) => `Nothing found for “${query}”.`,
    nothingFoundHint: "Check the spelling, or try fewer words.",
    fromCommons: "From Wikimedia Commons",
    canBeChosen: (n: number) =>
      `${counted("en", n, "photograph", "photographs")} can be chosen.`,
    lookClosely:
      "A search finds words, not people. Look closely before you choose.",
    nothingOffered: "Nothing found here can be offered.",
    suggestedTitle: "Suggested through Wikidata",
    suggestionsUnavailable:
      "Couldn’t reach Wikidata or Wikimedia Commons for suggestions. Search below instead.",
    suggestionsNoItem:
      "Wikidata has no single entry for this artist’s MusicBrainz link, so there are no suggestions. Search below instead.",
    suggestionsNone:
      "Wikidata’s entry for this artist has no photograph Refrain can offer.",
    suggestionsRefused: (n: number) =>
      ` ${counted("en", n, "file", "files")} didn’t meet the license and credit rules.`,
    suggestionsLead: (name: string) =>
      `Wikidata links ${name}’s MusicBrainz entry to these files. That is a lead, not proof: check that each photograph really shows them before you choose it.`,
    candidate: (title: string) => `Candidate: ${title}`,
    review: "Review",
    refused: (n: number) =>
      n === 1
        ? "1 more file can’t be offered: its license, credit, format, or size doesn’t meet Refrain’s rules."
        : `${n} more files can’t be offered: their license, credit, format, or size doesn’t meet Refrain’s rules.`,
  },
  removePhoto: {
    action: "Remove the photograph…",
    pending: "Removing…",
    done: "Photograph removed, with its credit and record.",
    question: (name: string) => `Remove the photograph of ${name}?`,
    confirmLabel: "Remove",
    body: "The artist shows the “no photograph yet” frame again, and the photograph’s credit and record are removed with it. You can choose a photograph again at any time.",
  },
  photoReview: {
    back: "← Photograph",
    title: "Review photograph",
    unreachableBody:
      "Nothing was changed. Your catalog and your writing still work. Try again in a moment.",
    forArtist: (name: string) => `For ${name}.`,
    noSuchFile: "Wikimedia Commons has no such file.",
    noSuchFileBody: "It may have been deleted or renamed. Nothing was changed.",
    backToPhoto: "Back to the photograph",
    notShown: (title: string) => `${title} isn’t shown`,
    creditShown: "Credit shown",
    noCredit: "None that can be shown",
    creator: "Creator",
    notNamed: "Not named",
    sourceNote: ". Its source note: ",
    licenseNotAccepted: "Not one Refrain accepts",
    size: "Size",
    anotherFormat: "another format",
    version: "Version",
    uploaded: (date: string) => `Uploaded ${date}`,
    cantBeUsed: "This photograph can’t be used.",
    chooseAnother: "Choose another",
    personalityTitle: "Personality rights",
    personalityBody:
      "Wikimedia Commons warns that the people shown may have rights that restrict some uses of their image, whatever the license.",
    otherRestrictions: "Other restrictions noted on Wikimedia Commons: ",
    freeLicenseNote:
      "A free license covers the photograph itself, not the people in it. If the file’s page lists more than one license, check that they are alternatives, not conditions that all apply. Before a photograph appears on a public page, it needs the rights review in Refrain’s hosted-release checklist.",
    archived: "This artist is archived. Restore it to change its photograph.",
    isCurrent: "This is the photograph on file, in this version.",
    onPublicPageBody:
      "A published journal puts this artist on a public page, so its photograph can’t be replaced here: a new one would reach readers without a confirmation, and that confirmation isn’t built yet. You can still remove the photograph, and the page then shows its empty frame. To choose another, unpublish the journals that show this artist first.",
    refusals: {
      unsupported_license:
        "Its license isn’t one Refrain accepts (CC0, public domain, or CC BY or CC BY-SA 2.0 to 4.0, unported or international).",
      license_mismatch:
        "Its license details on Wikimedia Commons disagree with each other, so which license applies isn’t clear.",
      non_free: "Wikimedia Commons marks it as not freely licensed.",
      no_creator: "It doesn’t name the photographer or creator to credit.",
      credit_not_plain:
        "Its credit is formatted in a way Refrain can’t show as plain text.",
      credit_too_long: "Its credit is too long to show under a photograph.",
      deletion_requested:
        "It has been nominated for deletion on Wikimedia Commons.",
      unsupported_format: "It isn’t a JPEG or PNG photograph.",
      too_small: "It’s smaller than 600 × 400 pixels.",
      unexpected_address:
        "Its addresses on Wikimedia Commons aren’t in the form Refrain can show reliably.",
    },
  },
  approvePhoto: {
    label: "Your choice",
    replaces: "It replaces the photograph on file, with its credit.",
    use: "Use this photograph",
    useInstead: "Use this photograph instead",
  },
  albums: {
    title: "Albums",
    lead: "Each album is the work itself, with the release that sets its track order. Journals are written about albums.",
    add: "Add an album",
    emptyTitle: "No albums yet",
    emptyBody:
      "Add an album, credit it to an artist, and build its tracklist. Then you can write a journal about it.",
    listLabel: "Albums",
    archived: "Archived",
    archivedHint: "Hidden from pickers. Their journals are untouched.",
    archivedLabel: "Archived albums",
    noArtist: "no credited artist",
    usedIn: (n: number) => `used in ${counted("en", n, "entry", "entries")}`,
  },
  album: {
    back: "← Albums",
    archivedOption: (name: string) => `${name} (archived)`,
    archived:
      "This album is archived: hidden from pickers, with its journals and tracklist kept.",
    details: "Details",
    artworkTitle: "Artwork and MusicBrainz",
    coverSource: "Cover: Cover Art Archive. ",
    noArtwork: "No artwork yet. ",
    linked:
      "Linked to MusicBrainz, so a cover can be chosen from the Cover Art Archive.",
    notLinked:
      "Not linked to MusicBrainz. Find it in Add music and link it to choose a cover.",
    changeArtwork: "Change artwork",
    chooseArtwork: "Choose artwork",
    findOnMusicBrainz: "Find on MusicBrainz",
    tracklist: "Tracklist",
    journalsTitle: "Journals about this album",
    noJournals: "Nothing written about this album yet.",
    journalStarted: (date: string) => `Journal started ${date}`,
    edited: (date: string) => `edited ${date}`,
    nothingWritten: "Nothing written yet",
    writeJournal: "Write a journal about this album",
    archiveNote: (entries: number) =>
      `Archiving hides the album from pickers and deletes nothing. ${counted("en", entries, "entry", "entries")} written about it stay as they are, showing its title as plain text. Its tracklist and credits are kept.`,
  },
  albumForm: {
    yearProblem: "Write the year with four digits, like 1994.",
    artistFirst: "Add an artist first",
    artistFirstBody: "An album is credited to at least one artist or band.",
    title: "Title",
    titleHint: "Titles don’t have to be unique: two albums can share a name.",
    credits: "Credited artists",
    creditsProblem: "Choose an artist for each row, and no artist twice.",
    year: "First released (optional)",
    edition: "Reference edition",
    editionHint:
      "The release that sets the order of the tracks. Everything here is optional.",
    label: "Label",
    releaseDate: "Release date",
    country: "Country (two letters)",
    mbReleaseGroupId: "MusicBrainz release group ID (optional)",
    mbReleaseGroupIdHint:
      "Filled in when you add or link this album from Add music. Saving this form looks nothing up.",
    save: "Save album",
    add: "Add album",
  },
  tracklist: {
    added: "Added to the end of the tracklist.",
    lengthProblem: "Write the length as minutes and seconds, like 3:42.",
    created: "Track created and added to the end of the tracklist.",
    empty:
      "No tracks yet. Add ones you already have, or create the first one below.",
    label: "Tracklist",
    archived: "archived",
    moveUp: (title: string) => `Move “${title}” up`,
    movedUp: (title: string) => `Moved “${title}” up.`,
    moveDown: (title: string) => `Move “${title}” down`,
    movedDown: (title: string) => `Moved “${title}” down.`,
    removeLabel: (title: string) => `Remove “${title}” from this album`,
    remove: "Remove",
    hasReflection:
      "A reflection is written about this track, so it stays on the album.",
    addExisting: "Add a track you already have",
    chooseTrack: "Choose a track",
    addToAlbum: "Add to album",
    createTitle: "Create a new track on this album",
    title: "Title",
    length: "Length (3:42)",
    creditAlbumArtists: "Credit the album’s artists on this track",
    createAndAdd: "Create and add",
    removeQuestion: "Remove this track from the album?",
    removeConfirm: "Remove from album",
    removed: (title: string) => `Removed “${title}” from this album.`,
    removeBody: (title: string) =>
      `“${title}” stays in your catalog and on any other album. Only its place on this tracklist goes.`,
  },
  artworkPage: {
    title: "Artwork",
    coverSource: "Cover: Cover Art Archive",
    noArtwork: "No artwork yet. The album shows the “no artwork yet” frame.",
    onPublicPageBody:
      "A published journal shows this album, so its artwork can’t change here: a change would reach readers without a confirmation, and that confirmation isn’t built yet. Unpublish the journal first if the artwork must change.",
    archived: "This album is archived. Restore it to change its artwork.",
    notLinkedTitle: "Not linked to MusicBrainz",
    notLinkedStart:
      "Artwork comes from the Cover Art Archive, which needs to know which MusicBrainz album this is. Find it in ",
    notLinkedEnd: " and choose “Link to this album”.",
    unreachableTitle: "Couldn’t reach the Cover Art Archive.",
    unreachableBody:
      "Your catalog and your writing still work. Try again in a moment.",
    source:
      "Artwork from Cover Art Archive, added only if you choose it. Images are copyrighted by their owners.",
    frontCovers: "Front covers",
    noFrontCover:
      "The Cover Art Archive has no front cover for this album’s edition.",
    fromReleaseGroup:
      "The album has no MusicBrainz edition yet, so these are the covers the archive shows for the album as a whole.",
    frontCoverOf: (title: string, n: number) => `${title}, front cover ${n}`,
    current: "Current cover",
    use: "Use this cover",
    useInstead: "Use this cover instead",
    frontCoverNumber: (n: number) => ` (front cover ${n})`,
    remove: "Remove artwork…",
    removeQuestion: "Remove this album’s artwork?",
    removeConfirm: "Remove",
    removeBody:
      "The album shows the “no artwork yet” frame again. You can choose a cover again at any time.",
  },
  tracks: {
    title: "Tracks",
    lead: "Every recording in your catalog. One recording can be on several albums without being copied.",
    add: "Add a track",
    emptyTitle: "No tracks yet",
    emptyBody:
      "Add tracks here, or build an album’s tracklist and create them as you go.",
    listLabel: "Tracks",
    archived: "Archived",
    archivedLabel: "Archived tracks",
    onNoAlbum: "not on an album",
    onAlbums: (n: number) => `on ${counted("en", n, "album", "albums")}`,
  },
  track: {
    back: "← Tracks",
    archived:
      "This track is archived: hidden from pickers, and kept on the albums it is already on.",
    onAlbums: "On these albums",
    noAlbum: "Not on an album. Add it from an album’s page.",
    memories: "Memories",
    noMemory: "No memory belongs to this song yet.",
    memoriesLabel: "Memories with this song",
    archivedNoMemory:
      "An archived track can’t be added to a new memory. Restore it first.",
    writeMemory: "Write a memory about this song",
    archiveNote:
      "Archiving hides the track from pickers and deletes nothing. It stays on the albums it is already on, and any writing about it is untouched.",
  },
  trackForm: {
    title: "Title",
    length: "Length (optional)",
    lengthHint: "Minutes and seconds, like 3:42.",
    credits: "Credited artists (optional)",
    noCredits: "No artist is credited. A track can stand on its own.",
    creditNote: "Credit note (optional)",
    creditNoteHint:
      "Anything the credits say that an artist link doesn’t, like “feat. someone”.",
    mbRecordingId: "MusicBrainz recording ID (optional)",
    album: "Add to an album (optional)",
    albumPlaceholder: "Not on an album yet",
    albumHint:
      "It goes at the end of the album’s tracklist. A track can be on several albums; add the others from the album page.",
    save: "Save track",
    add: "Add track",
  },
  addMusic: {
    back: "← Back to the catalog",
    title: "Add music",
    lead: "Search MusicBrainz for albums and artists, and add them to your catalog. Nothing is published by adding it.",
    search: "Search MusicBrainz",
    searchFor: "Search for",
    kinds: { albums: "Albums", artists: "Artists" },
    searching: "Searching MusicBrainz…",
    length: "Use 1 to 200 characters.",
    unreachableTitle: "Couldn’t reach MusicBrainz.",
    unreachableBody:
      "Your catalog and your writing still work. Try again in a moment.",
    source:
      "Data from MusicBrainz. Artwork from Cover Art Archive, added only if you choose it.",
    resultCount: (n: number) =>
      `${n} ${n === 1 ? "result" : "results"} from MusicBrainz.`,
    inCatalog: "In catalog",
    alreadyInCatalog: "Already in your catalog",
    fromMusicBrainz: "From MusicBrainz",
    nothingNew: "Nothing new found on MusicBrainz.",
    release: "Release",
    artist: "Artist",
    add: "Add",
    addAlbumLabel: (title: string, credit: string | null) =>
      ` ${title}${credit ? ` by ${credit}` : ""}`,
  },
  editions: {
    back: "← Add music",
    firstReleased: (year: string) => `first released ${year}`,
    alreadyStart: "This album is ",
    alreadyEnd:
      " in your catalog, so it can’t be added again. Its artwork can be chosen on its page.",
    choose: "Choose an edition",
    explain:
      "The album is the work. An edition is one release of it, with its own tracks, label, and date. The edition you choose sets the album’s tracklist; you review everything before it is added.",
    none: "MusicBrainz lists no editions.",
    original: "original release",
    noDate: "no date",
    review: "Review",
    reviewLabel: (date: string | null, place: string | null) =>
      ` the ${date ?? "undated"} ${place ?? ""} edition`,
    showing: (shown: number, total: number) =>
      `Showing the first ${shown} of ${total} editions.`,
    source: "Data from MusicBrainz.",
  },
  release: {
    back: "← Other editions",
    lead: "Review what will be added to your catalog. Nothing is published by adding it, and nothing already in your catalog is changed.",
    alreadyAlbumEnd: " in your catalog, so it isn’t added again.",
    editionBelongs: "This edition belongs to ",
    unsupportedTitle: "This edition can’t be added as one album",
    unsupported: {
      no_tracks: "MusicBrainz lists no tracks for this edition.",
      too_many_tracks:
        "This edition has more tracks or discs than an album in the catalog can hold.",
      repeated_recording:
        "This edition lists the same recording twice, and an album holds each recording once.",
      no_credits: "MusicBrainz credits no artist on this edition.",
      too_many_credits:
        "This edition credits more artists than the catalog holds.",
      text_too_long:
        "A title or name on this edition is longer than the catalog holds.",
    },
    unsupportedHint:
      "Choose another edition, add the album by hand, or link an album you already have.",
    album: "The album",
    title: "Title",
    creditedTo: "Credited to",
    noArtist: "no artist credited",
    firstReleased: "First released",
    notKnown: "not known",
    kind: "Kind",
    notGiven: "not given",
    edition: "This edition",
    released: "Released",
    partialDate: " (only the year is kept: the catalog stores full dates)",
    country: "Country",
    label: "Label",
    note: "Note",
    status: "Status",
    tracks: "Tracks",
    tracksHint: (n: number) =>
      `${n} ${n === 1 ? "track" : "tracks"}, in this edition’s order. A track already in your catalog keeps its own title and details.`,
    archivedInCatalog: " · in your catalog, archived: restore it first",
    inCatalog: " · already in your catalog",
    artists: "Artists",
    keptAsItIs: " · already in your catalog, kept as it is",
    newBand: " · new, as a band",
    newPerson: " · new, as a person",
    kindUnknown: " (MusicBrainz doesn’t say; you can change it in the catalog)",
    linkTitle: "Or link an album you already have",
    linkHint:
      "Linking records only that your album is this MusicBrainz album and edition. Its title, credits, tracks, and artwork stay exactly as they are.",
  },
  releaseApproval: {
    artwork: "Artwork",
    artworkUnavailable:
      "The Cover Art Archive couldn’t be reached, so no artwork is offered now. You can choose it later on the album’s page.",
    noFrontCover:
      "The Cover Art Archive has no front cover for this edition. The album will show “no artwork yet”.",
    chooseCover: "Choose a front cover from the Cover Art Archive, or none.",
    noArtwork: "No artwork",
    frontCover: (n: number) => `Front cover ${n}`,
    adding: "Adding…",
    add: "Add to catalog",
    addHint:
      "Adds this album, its edition, its tracks, and any new artists. Nothing is published.",
    link: "Link to this album",
    linkQuestion: (title: string) => `Link “${title}” to MusicBrainz?`,
    linkConfirm: "Link",
    linkBody:
      "This records which MusicBrainz album and edition it is, so artwork can be chosen for it. Its title, credits, tracks, and artwork stay exactly as they are, and a link that is already there is never replaced.",
  },
  artistReview: {
    lead: "Review what will be added to your catalog. Nothing is published by adding it.",
    name: "Name",
    sortedAs: "Sorted as",
    addedAs: "Added as",
    band: "a band",
    person: "a person",
    alreadyStart: "This artist is ",
    tooLong: "This name is longer than the catalog holds. Add it by hand.",
    linkTitle: "Or link an artist you already have",
    linkHint:
      "Linking records only which MusicBrainz artist it is. The name and the rest stay exactly as they are.",
    nothingPublished: "Nothing is published.",
    link: "Link to this artist",
    linkBody:
      "This records which MusicBrainz artist it is. The name, sort name, and kind stay exactly as they are, and a link that is already there is never replaced.",
  },
  journals: {
    title: "Journals",
    lead: "What you write about the albums you love. An album can have as many journals as you want, written over the years.",
    emptyTitle: "Nothing written yet",
    emptyBody:
      "Choose an album and start a journal. It begins as a draft that only you can see, and it is saved only when you save it.",
    totalsLabel: "Journal totals",
    listLabel: "Journals",
    deletedHint:
      "Moved there, not erased: the writing stays in the database, and nothing removes it automatically. You can restore a journal from there; permanent deletion is not offered yet.",
    openDeleted: "Open Recently deleted",
    rowDates: (started: string, edited: string, wordCount: number) =>
      `started ${started} · edited ${edited} · ${counted("en", wordCount, "word", "words")}`,
  },
  newJournal: {
    journals: "Journals",
    writeAbout: (title: string) => `Write about ${title}`,
    back: "← Journals",
    albumFirst: "Add an album first",
    albumFirstBody: "A journal is written about an album in your catalog.",
    which: "Which album is it about?",
  },
  journalMargin: {
    fromCatalog: "From your catalog",
    editInCatalog: "Edit in catalog",
    artwork: "Artwork",
    coverSource: "Cover Art Archive",
    noArtwork: "No artwork yet",
    change: "Change…",
    changeLabel: " the album’s artwork",
  },
  journal: {
    restoredPrivate:
      "Restored from Recently deleted. A language version that was published when it was deleted is now private. Restoring publishes nothing: to publish it again you will first be shown everything it would publish, including any track reflections you had set to be included when published.",
    restored:
      "Restored from Recently deleted, with its writing exactly as you left it.",
    theAlbum: "The album",
    facts: (
      language: string,
      wordCount: number,
      started: string,
      edited: string,
    ) =>
      ` · written in ${language} · ${counted("en", wordCount, "word", "words")} · started ${started} · edited ${edited} (UTC dates)`,
    inDeleted: (date: string) =>
      `This journal has been in Recently deleted since ${date}. Its writing is kept in the database, and it cannot be changed there until you restore it.`,
    unsupported:
      "This text has formatting that the plain editor can’t show without losing it. It is untouched.",
    edit: "Edit this journal",
    state: "Its state",
    versions: "Language versions: ",
    version: (language: string, isOriginal: boolean, status: string) =>
      `${language}${isOriginal ? " (original)" : " (your translation)"}, ${status}`,
    noTranslation:
      ". You haven’t written a translation, and nothing is translated for you.",
    deletedLabel: "Deleted: ",
    deletedYes: "yes, in Recently deleted",
    deletedNo: "no",
    manage: "Manage",
  },
  restoreJournal: {
    label: (album: string) => `Restore the journal about ${album}`,
    action: "Restore…",
    question: "Restore this journal?",
    confirmLabel: "Restore journal",
    body: "The journal returns to your journals with its writing exactly as you left it.",
    wasPublished:
      "A language version that was published when it was deleted comes back as private. Restoring publishes nothing. To publish it again you will first be shown everything it would publish, including any track reflections you had set to be included when published.",
    stays: "Drafts stay drafts and private stays private.",
  },
  editJournal: {
    back: "← The journal",
    title: "Edit a journal",
    deleted:
      "This journal is in Recently deleted, so it can’t be edited. Its writing is kept.",
    unsupported:
      "This text has formatting that the plain editor can’t show without losing it, so it can’t be edited here. It is untouched.",
    theJournal: "The journal",
    editing: "Editing your album journal",
    editingLabel: "Editing: ",
  },
  editor: {
    reflectionProblem:
      "A reflection is too long or isn’t valid, so nothing was saved. Your text is still here.",
    writtenIn: "Written in",
    saveDraft: "Save as draft",
    save: "Save",
    published:
      "This version is published. Saving changes the published writing. Before a change to the published writing is saved, you will see exactly what changes and confirm it. Nothing is saved without that.",
    otherPublished:
      "Another language version of this journal is published. A change to the published writing will show you what changes and ask you first.",
    opening: "Opening sentence (optional)",
    openingHint: "One line that opens the journal, in your words.",
    reflection: "Your reflection",
    reflectionHint:
      "A blank line starts a new paragraph. Your writing is kept as plain text.",
    albumRating: "Your rating for the album",
    albumRatingHint:
      "Set on its own. It is never calculated from the track ratings.",
    writtenInLanguage: (language: "en" | "pt-BR") =>
      `Written in ${language === "en" ? "English" : "Português (Brasil)"}`,
    languageNote:
      "The language you write this journal in. It is recorded with the journal, and nothing is translated for you.",
    createNote:
      "A new journal starts as a private draft. Nothing here is published.",
    editNote: "Saving never changes who can see this journal.",
  },
  rating: {
    none: "No rating",
    clear: "Clear",
    /** A rating from its half steps, in words: "2.5 stars". */
    stars: (halfSteps: number) =>
      `${ratingText("en", halfSteps)} ${halfSteps === 2 ? "star" : "stars"}`,
  },
  trackByTrack: {
    title: "Track by track",
    hint: "Write about the tracks you want to. Empty tracks show as “not written yet”.",
    empty:
      "This album has no tracks yet. Add them in the catalog, and they appear here.",
    trackLabel: (n: number) => `Track ${n}: `,
    archived: " · archived in the catalog",
    notInEdition: " · not on the reference edition",
    states: {
      empty: "empty",
      "still writing": "still writing",
      written: "written",
    },
    visibility: {
      public: "public",
      included: "included when published",
      private: "private",
    },
    edited: " · edited",
    unreadable:
      "This reflection has formatting that the plain editor can’t show without losing it, so it can’t be edited here. It is untouched.",
    textLabel: (title: string, language: string) =>
      `Your reflection on ${title}, in ${language}`,
    placeholder: "What you noticed in this track…",
    alsoWritten: (languages: string) =>
      `Also written in ${languages}. It is kept as it is, and stays private unless it is included when published and that version is published.`,
    rating: "Rating for this track",
    favourite: "Mark as favourite",
    favouriteHint: "Shown as a small circle once published.",
    stillWriting: "Still writing",
    stillWritingHint: "Shown as “still writing” until you clear it.",
    include: "Include when published",
    includeHint:
      "Publishes nothing by itself: it counts once this language version is published.",
    sentence: {
      nothingSaved: {
        lead: "Nothing saved yet",
        rest: ". Once you save it, it stays private: only you can see it.",
      },
      privateOnSave: {
        lead: "Private",
        rest: ". Saving stops it being included when published. Only you can see it.",
      },
      private: {
        lead: "Private",
        rest: ". It is not included when published. Only you can see it.",
      },
      includedOnSave: (language: string) => ({
        lead: "Included when published, once you save",
        rest: `. That publishes nothing by itself: the ${language} version of the journal has to be published too.`,
      }),
      public: (language: string, note: string) => ({
        lead: "Public",
        rest: `. It is part of the ${language} version that is marked as published in your records. ${note}`,
      }),
      noText: (language: string) => ({
        lead: "Included when published",
        rest: `, but there is no text in ${language} yet, so there is nothing to publish.`,
      }),
      notPublished: (language: string, status: string) => ({
        lead: "Included when published, not published yet",
        rest: `: the ${language} version of this journal is not published (it is ${status}). It is published only with that version.`,
      }),
    },
  },
  review: {
    noRating: "no rating",
    unsupported:
      "This text has formatting the plain view can’t show. It is public exactly as it is stored.",
    nothing: "Nothing.",
    nothingYet: "Nothing yet.",
    cleared: "Nothing: this is cleared.",
    yes: "Yes",
    no: "No",
    noSongsYet: "No songs yet.",
    noSongs: "No songs.",
    /** Where a change to a public page is, by the Journals module's names. */
    places: {
      title: "Title",
      opening: "Opening sentence",
      marginNote: "Margin note",
      body: "Your reflection",
      memory: "The memory",
      albumRating: "Your rating for the album",
      trackText: "Reflection on the track",
      trackRating: "Rating of the track",
      favourite: "Marked as a favourite",
      stillWriting: "Labelled “still writing”",
      when: "When",
      music: "The music",
    },
  },
  publish: {
    statusDraft: "a draft",
    statusPrivate: "private",
    statusPublished: "already published",
    title: (language: string) => `Publish the ${language} version?`,
    confirmLabel: (language: string) => `Publish the ${language} version`,
    region: "What will be published",
    close: "Close",
    reviewAgain: "Review it again",
    reading: "Reading what would be published…",
    changed:
      "What would be published has changed since you looked, or this review ran out. Nothing was published. Review it again to see how it stands now.",
    unreadable:
      "Some of this text has formatting the plain view can’t show, so you can’t read all of it here. It can’t be published from the studio until it can be.",
    everything: (language: string) =>
      `This is everything that will be marked as published for the ${language} version. Nothing is published until you press the button below. Nothing you do in this review changes or deletes anything: closing it leaves everything as it was.`,
    statusNow: (status: string, note: string) =>
      `This version is ${status} now. Publishing marks the version as published in your records. ${note}`,
    opening: "Opening sentence",
    none: "None.",
    reflection: "Your reflection",
    address: "Its address",
    wasPublic: " (this address has been public before)",
    artistPages: (n: number) => `Artist pages that will open (${n})`,
    noArtistAddress:
      "No address: another artist has the same one, so neither page is shown.",
    withPhoto: (title: string, credit: string, license: string) =>
      `With the photograph ${title} (${credit}, ${license})`,
    withoutPhoto: "Without a photograph",
    artistPagesHint:
      "Each artist credited on this album gets a public page when this is published, if they have none yet. To leave one out, change the album’s credits first, then review again.",
    addressChanges: "Artist pages whose address changes",
    addressChange: (name: string, from: string, to: string | null) =>
      `${name}: ${from} becomes ${to ?? "no address"}, because an artist with the same name gets a page. The old address will stop working.`,
    alreadyPublic: " (already public through another language version)",
    reflections: (language: string, n: number) =>
      `Track reflections that will be published in ${language} (${n})`,
    noReflections:
      "No track reflection is included. Publishing never changes which tracks are included; you do that on each track.",
    favourite: "Marked as a favourite",
    rated: (stars: string) => `Rated ${stars}`,
    stillWriting: "Labelled “still writing”",
    selectionHint:
      "Nothing here changes which reflections are included. To change that, close this review, change it on the track, and review again.",
    changeSelection: "Change which reflections are included, on the tracks",
    staysPrivate: "What stays private",
    allIncluded:
      "Every track reflection you wrote in this language is included when published, or you haven’t written any.",
    notIncluded: (language: string, n: number, titles: string) =>
      `Track reflections you wrote in ${language} that are not included when published (${n}): ${titles}. They stay private.`,
    flaggedWithoutText: (n: number, language: string) =>
      n === 1
        ? `1 track is included when published but has no text in ${language}, so nothing of it is public in this language.`
        : `${n} tracks are included when published but have no text in ${language}, so nothing of them is public in this language.`,
    othersStay:
      "Other language versions, your drafts, and everything in Recently deleted stay as they are.",
  },
  visibility: {
    statusSet: (language: string, status: "draft" | "private") =>
      `${language}: ${status === "private" ? "now private." : "back to a draft."}`,
    unpublished: (language: string, status: "draft" | "private") =>
      `The ${language} version is no longer published. It is ${status === "private" ? "private" : "a draft"} now. Nothing was deleted.`,
    published: (language: string, note: string) =>
      `The ${language} version is now published in your journal. ${note}`,
    heading: (language: string, isOriginal: boolean) =>
      `Visibility · ${language}${isOriginal ? " (original)" : ""}`,
    unpublish: "Unpublish…",
    publishedHint: (note: string) =>
      `Published means this version is marked as published in your records. ${note}`,
    privateState: (language: string) =>
      `Private state of the ${language} version`,
    publish: "Publish…",
    privateHint:
      "A draft is still being written; private is finished for now. Both are only yours. Publish… shows you exactly what will be published before anything changes.",
    remove: "Move to Recently deleted…",
    unpublishQuestion: (language: string) =>
      `Unpublish the ${language} version?`,
    unpublishConfirm: "Unpublish",
    unpublishBody:
      "This version will no longer be marked as published. Nothing is deleted: your writing, the track reflections, and the address stay as they are, and other language versions are not touched. You can publish it again later; that will show you what would be published first.",
    after: "After unpublishing, it is",
    afterPrivate: "Private (finished for now)",
    afterDraft: "A draft (still being written)",
    removeQuestion: "Move this journal to Recently deleted?",
    removeConfirm: "Move to Recently deleted",
    removeBody:
      "This does not erase the writing. It stays in your database, and nothing removes it automatically. The journal leaves your lists, and it cannot be edited while it is in Recently deleted. You can restore it from there; permanent deletion is not offered yet. Albums, artists and tracks stay in your catalog.",
  },
  change: {
    title: "Update published writing?",
    confirmLabel: "Save and update published writing",
    region: "What will change in the published writing",
    reading: "Reading what would change…",
    textKept: "Your text is still in the editor.",
    unreadable:
      "Some of this text has formatting the plain view can’t show, so you can’t read all of it here. It can’t be saved from the studio until it can be.",
    lead: (note: string) =>
      `This version is published, so saving changes the published writing. Here is exactly what changes. Nothing is saved until you press the button below, and cancelling leaves your text in the editor. This updates what is marked as published in your records. ${note}`,
    added: "Added",
    changed: "Changed",
    publishedNow: "Published now",
    publishedAfter: "Published after saving",
    publishedAfterNew: "Published after saving (new)",
    removals:
      "Things you take away from the published writing do not need this review.",
  },
  deleted: {
    title: "Recently deleted",
    lead: "Journals and memories you moved here are not erased: the writing stays in the database, and nothing removes it automatically. Restoring brings it back as it was. Permanent deletion is not offered yet.",
    hint: "A journal that was published when it was deleted comes back as private. Restoring never publishes anything; publishing it again shows you everything it would publish first, including any track reflections you had set to be included when published.",
    journals: "Journals",
    nothingHere: "Nothing here",
    noJournal: "No journal is in Recently deleted.",
    journalsLabel: "Recently deleted journals",
    deletedOn: (date: string) => `deleted ${date}`,
    version: (language: string, status: string, wasPublished: boolean) =>
      `${language}: ${status}${wasPublished ? ", returns as private" : ""}`,
    memories: "Memories",
    noMemory: "No memory is in Recently deleted.",
    memoriesLabel: "Recently deleted memories",
  },
  restoreMemory: {
    label: (title: string) => `Restore the memory “${title}”`,
    question: "Restore this memory?",
    confirmLabel: "Restore memory",
    body: "The memory returns to your memories with its writing and its songs exactly as you left them.",
    wasPublished:
      "It was published when it was deleted, and it comes back as private. Restoring publishes nothing.",
    stays: "A draft stays a draft and private stays private.",
  },
  memories: {
    title: "Memories",
    lead: "The moments songs take you back to. A memory belongs to as many songs as you want, in the order you choose.",
    movedToDeleted:
      "The memory is in Recently deleted. Its writing is kept, and you can restore it from there.",
    emptyTitle: "No memories yet",
    emptyBody:
      "Write down a moment a song takes you back to. It begins as a draft that only you can see, and it is saved only when you save it.",
    totalsLabel: "Memory totals",
    publishingNote: "Publishing memories isn’t available yet.",
    kind: "Memory",
    noSongs: "No songs yet",
    andMore: (shown: string, more: number) => `${shown}, and ${more} more`,
    editLabel: (title: string) => `Edit the memory ${title}`,
  },
  recording: {
    song: "Song",
    on: (albums: string) => `on ${albums}`,
    archived: "archived in your catalog",
  },
  memory: {
    restoredPrivate:
      "Restored from Recently deleted. It was published when it was deleted, and it is private now. Restoring publishes nothing.",
    restored:
      "Restored from Recently deleted, with its writing and its songs exactly as you left them.",
    back: "← Memories",
    unsupportedTitle: "This memory can’t be edited here",
    unsupportedBody:
      "Its writing has formatting that the plain editor can’t show without losing it, so it is left untouched.",
    backToDeleted: "← Recently deleted",
    inDeletedKind: "Memory, in Recently deleted",
    deletedFacts: (wordCount: number, date: string) =>
      ` · ${counted("en", wordCount, "word", "words")} · deleted ${date} (UTC)`,
    inDeleted: (date: string) =>
      `This memory has been in Recently deleted since ${date}. Its writing and its songs are kept, and it can’t be changed there until you restore it.`,
    wasPublished: " It was published, and it returns as private.",
    music: "The music",
  },
  memoryEditor: {
    whenRemoved: "The “when”",
    musicProblem:
      "A song appears twice, or there are too many songs, so nothing was saved.",
    newMemory: "New memory",
    writeTitle: "Write a memory",
    editTitle: "Edit a memory",
    published:
      "This memory is published. Saving changes what readers see: before a change is saved, you will see exactly what changes and be asked first.",
    title: "Title",
    titlePlaceholder: "A title for this memory",
    when: "When",
    whenPlaceholder: "a date, a season, a year",
    whenHint: "However you remember it. It doesn’t need to be exact.",
    body: "The memory",
    bodyPlaceholder: "Write what you remember…",
    artists: "Artists, from the music",
    noArtists: "None yet. They come from the songs you add.",
    languageHint:
      "The language you write this memory in. It is recorded with the memory, and nothing is translated for you.",
    languageFixed:
      "The language it was written in. Nothing is translated for you.",
    createNote:
      "A new memory starts as a private draft. Nothing here is published.",
    removalQuestion: "Take this away from the published memory?",
    removalConfirm: "Save and take it away",
    removalBody:
      "This memory is published. Saving takes this away from what readers see; nothing else changes, and nothing is deleted from your catalog. Cancelling leaves your text in the editor.",
  },
  memoryMusic: {
    moved: (
      title: string,
      direction: "up" | "down",
      place: number,
      total: number,
    ) => `${title} moved ${direction}, to ${place} of ${total}.`,
    removed: (title: string) =>
      `${title} removed from this memory. It is still in your catalog.`,
    added: (title: string) => `${title} added to this memory.`,
    empty:
      "No songs yet. Add the songs this memory belongs to; they come from your catalog.",
    listLabel: "Songs in this memory",
    moveUp: (title: string, n: number, total: number) =>
      `Move ${title} up (song ${n} of ${total})`,
    moveDown: (title: string, n: number, total: number) =>
      `Move ${title} down (song ${n} of ${total})`,
    remove: (title: string, n: number, total: number) =>
      `Remove ${title} from this memory (song ${n} of ${total})`,
    album: "Album",
    readOnly:
      "This memory also belongs to an album, which this editor can’t change yet, so its music stays as it is. Its title and writing can still be saved.",
    addLabel: "Add a song from your catalog",
    addPlaceholder: "Add a song",
    resultsLabel: "Songs in your catalog",
    inCatalog: "In your catalog",
    noMatch: (query: string) => `No song in your catalog matches “${query}”.`,
    addTrack: "Add a track to your catalog",
    add: (title: string, facts: string) =>
      `Add ${title}, ${facts}, to this memory`,
    removeHint:
      "Removing a song from this memory never deletes it from your catalog.",
    firstFound: (n: number) =>
      `The first ${n} songs found. Type more to narrow them.`,
    found: (n: number) => `${n} ${n === 1 ? "song" : "songs"} found.`,
  },
  memoryControls: {
    unpublished: (status: "draft" | "private") =>
      `This memory is no longer published. It is ${status === "private" ? "private" : "a draft"} now. Nothing was deleted.`,
    nowPrivate: "Now private.",
    backToDraft: "Back to a draft.",
    published: (note: string) => `This memory is now published. ${note}`,
    visibility: "Visibility",
    states: {
      draft: "Draft. Unfinished and private.",
      private: "Private. Only you can see it.",
      published:
        "Published. Saving a change readers would see shows you what changes, and asks first.",
    },
    privateState: "Private state of this memory",
    saveFirst: "Save your changes first: Publish… shows you what is saved.",
    publishedHint: (note: string) =>
      `Saving never changes who can see it. ${note}`,
    remove: "Delete…",
    saveBeforeDelete: "Save your changes first, or they would be lost.",
    songsStay: "Its songs stay in your catalog.",
    removeQuestion: "Delete this memory?",
    removeConfirm: "Delete memory",
    removeBody: (title: string) =>
      `“${title}” moves to Recently deleted. Its writing is kept there, and nothing removes it automatically: you can restore it whenever you want. Its songs stay in your catalog.`,
    unpublishQuestion: "Unpublish this memory?",
    unpublishBody:
      "It will no longer be published, so no reader can see it. Nothing is deleted: the writing, its songs, and its address stay as they are. You can publish it again later; that will show you what would be published first.",
  },
  memoryPublish: {
    linksToArtist: (name: string) => `${name} (links to their page)`,
    onAlbum: (title: string, linksToJournal: boolean) =>
      `on ${title}${linksToJournal ? " (links to its album journal)" : ""}`,
    linksToJournal: "links to its album journal",
    title: "Publish this memory?",
    confirmLabel: "Publish this memory",
    everything: (language: string) =>
      `This is everything that will be published for this memory, in ${language}. Nothing is published until you press the button below. Nothing you do in this review changes or deletes anything: closing it leaves everything as it was.`,
    statusNow: (status: string, note: string) =>
      `This memory is ${status} now. Publishing marks it as published in your records. ${note}`,
    noWhen: "None. The page shows no date for it.",
    music: (n: number) => `The music (${n})`,
    noSongs: "No songs. The page shows none.",
    albumPrefix: "Album: ",
    musicHint:
      "Song titles, artists, and albums are shown as your catalog names them. Publishing a memory opens no artist page: an artist or an album journal is linked only when its page is already public.",
    othersStay:
      "Your other memories, your drafts, your album journals and their track reflections, and everything in Recently deleted stay as they are.",
  },
  memoryChange: {
    title: "Update the published memory?",
    confirmLabel: "Save and update the published memory",
    region: "What will change in the published memory",
    lead: (note: string) =>
      `This memory is published, so saving changes what readers see. Here is exactly what changes. Nothing is saved until you press the button below, and cancelling leaves your text in the editor. This updates what is marked as published in your records. ${note}`,
    takenAway: "Taken away from the published memory",
  },
  desk: {
    title: "Desk",
    lead: "Everything you are writing. Everything here is private.",
    nothingWritten: "Nothing written yet.",
    firstSteps: {
      addArtist: "Add an artist",
      addArtistRest: ", or a band.",
      addAlbum: "Add an album",
      addAlbumRest: " that credits them.",
      tracklist: "Build its tracklist from the album’s page.",
      writeJournal: "Write a journal",
      writeJournalRest:
        " about it. It begins as a draft that only you can see.",
      orBefore: "Or ",
      writeMemory: "write a memory",
      orAfter: " now, and add its songs once they are in your catalog.",
    },
    startWith:
      "Start with an album you love, or a moment a song takes you back to. Everything begins as a draft that only you can see.",
    writeJournal: "Write a journal",
    writeMemory: "Write a memory",
    yourJournals: "Your journals",
    journalsSummary: (
      total: number,
      draft: number,
      priv: number,
      published: number,
    ) =>
      `${counted("en", total, "journal", "journals")}: ${counted("en", draft, "draft", "drafts")}, ${priv} private, ${published} published.`,
    journalsLabel: "Journals",
    albumJournal: "Album journal",
    tracksWritten: (written: number, total: number) =>
      `${written} of ${counted("en", total, "track", "tracks")} written`,
    editJournalAbout: (album: string) => `Edit the journal about ${album}`,
    allJournals: "All journals",
    allJournalsCount: (n: number) => `All ${n} journals`,
    yourMemories: "Your memories",
    memoriesSummary: (
      total: number,
      draft: number,
      priv: number,
      published: number,
    ) =>
      `${counted("en", total, "memory", "memories")}: ${counted("en", draft, "draft", "drafts")}, ${priv} private${published > 0 ? `, ${published} published` : ""}.`,
    memoriesLabel: "Memories",
    allMemories: "All memories",
    allMemoriesCount: (n: number) => `All ${n} memories`,
    memories: "Memories",
    recentlyDeleted: (n: number) => `Recently deleted (${n})`,
    yourCatalog: "Your catalog: ",
    catalogComma: ", ",
    catalogAnd: ", and ",
    catalogEnd: ". ",
    openCatalog: "Open the catalog",
    catalogClose: ".",
  },
};

export type StudioDictionary = typeof studioEn;
