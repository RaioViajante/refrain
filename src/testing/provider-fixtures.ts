// Deterministic MusicBrainz and Cover Art Archive responses for the tests.
// Every name is synthetic and labelled `[Test]`; the shapes follow the
// documented contract and the live responses recorded in
// docs/evidence/m3-2.md (a numeric `score`, an absent `joinphrase`, absent
// `secondary-types`, a numeric image `id`, `http://` image URLs in listings).
// No real artwork is used anywhere: tests that need pixels generate them.

export const FIXTURE = {
  inkQuartet: "1d6a2d6c-0000-4000-8000-000000000001",
  paperSinger: "1d6a2d6c-0000-4000-8000-000000000002",
  paperMoon: "2e7b3e7d-0000-4000-8000-000000000001",
  paperMoonDeluxe: "2e7b3e7d-0000-4000-8000-000000000002",
  paperMoonCover: "2e7b3e7d-0000-4000-8000-000000000003",
  firstPressing: "3f8c4f8e-0000-4000-8000-000000000001",
  legacyEdition: "3f8c4f8e-0000-4000-8000-000000000002",
  digitalEdition: "3f8c4f8e-0000-4000-8000-000000000003",
  repeatedRecording: "3f8c4f8e-0000-4000-8000-000000000004",
  recording1: "4a9d5a9f-0000-4000-8000-000000000001",
  recording2: "4a9d5a9f-0000-4000-8000-000000000002",
  recording3: "4a9d5a9f-0000-4000-8000-000000000003",
  recording4: "4a9d5a9f-0000-4000-8000-000000000004",
  recording5: "4a9d5a9f-0000-4000-8000-000000000005",
  frontImage: "1000000001",
  backImage: "1000000002",
  legacyFrontImage: "24008507233",
} as const;

/** Search words that make the mock answer in a particular way. */
export const SCENARIO = {
  /** MusicBrainz answers 503 (its throttling answer) every time. */
  unavailable: "[test] unreachable",
  /** No results. */
  nothing: "[test] gracce",
  /** A body that does not match the contract. */
  malformed: "[test] malformed",
} as const;

const artist = (id: string, name: string, type: string, sortName = name) => ({
  id,
  name,
  "sort-name": sortName,
  disambiguation: "",
  type,
  "type-id": "b6e035f4-3ce9-331c-97df-83397230b0df",
  country: "GB",
});

const inkQuartet = artist(
  FIXTURE.inkQuartet,
  "[Test] Ink Quartet",
  "Group",
  "Ink Quartet, [Test]",
);
const paperSinger = artist(
  FIXTURE.paperSinger,
  "[Test] Paper Singer",
  "Person",
  "Singer, [Test] Paper",
);

// A search result's credit, as observed live: no `joinphrase`, no `type`.
const searchCredit = (who: typeof inkQuartet) => [
  {
    name: who.name,
    artist: {
      id: who.id,
      name: who.name,
      "sort-name": who["sort-name"],
      disambiguation: "",
    },
  },
];

export function releaseGroupSearch(query: string) {
  const groups = [
    {
      id: FIXTURE.paperMoon,
      "type-id": "f529b476-6e62-324f-b0aa-1f3e33d313fc",
      score: 100,
      count: 3,
      title: "[Test] Paper Moon",
      "first-release-date": "1994-08-15",
      "primary-type": "Album",
      "artist-credit": searchCredit(inkQuartet),
      releases: [],
    },
    {
      id: FIXTURE.paperMoonDeluxe,
      score: 94,
      count: 1,
      title: "[Test] Paper Moon (Legacy Edition)",
      "first-release-date": "2004",
      "primary-type": "Album",
      "secondary-types": ["Compilation"],
      "artist-credit": searchCredit(inkQuartet),
      releases: [],
    },
    {
      id: FIXTURE.paperMoonCover,
      score: 88,
      count: 1,
      title: "[Test] Paper Moon",
      disambiguation: "a different record with the same title",
      "first-release-date": "2013",
      "primary-type": "Album",
      "artist-credit": searchCredit(paperSinger),
      releases: [],
    },
  ];
  const matches = query.includes("paper") ? groups : [];
  return {
    created: "2026-11-02T00:00:00.000Z",
    count: matches.length,
    offset: 0,
    "release-groups": matches,
  };
}

export function artistSearch(query: string) {
  const artists = [
    { ...inkQuartet, score: 100, "life-span": { begin: "1990", end: null } },
    { ...paperSinger, score: 71, "life-span": { begin: "1966" } },
  ];
  const matches =
    query.includes("ink") || query.includes("paper") ? artists : [];
  return {
    created: "2026-11-02T00:00:00.000Z",
    count: matches.length,
    offset: 0,
    artists: matches,
  };
}

const label = (name: string) => ({
  "catalog-number": null,
  label: { id: "5b5b5b5b-0000-4000-8000-000000000001", name },
});

const releaseSummary = (
  id: string,
  title: string,
  date: string | null,
  country: string | null,
  formats: string[],
  tracks: number,
  front: boolean,
  disambiguation = "",
) => ({
  id,
  title,
  status: "Official",
  date: date ?? "",
  country,
  disambiguation,
  "label-info": [label("[Test] Label")],
  media: formats.map((format, index) => ({
    format,
    position: index + 1,
    "track-count": index === 0 ? tracks - (formats.length - 1) : 1,
  })),
  "cover-art-archive": { front, back: false, artwork: front, count: 1 },
});

export function releaseBrowse(releaseGroupId: string) {
  const releases =
    releaseGroupId === FIXTURE.paperMoon
      ? [
          // Returned in identifier order, as MusicBrainz does.
          releaseSummary(
            FIXTURE.firstPressing,
            "[Test] Paper Moon",
            "1994-08-15",
            "GB",
            ["CD"],
            3,
            true,
          ),
          releaseSummary(
            FIXTURE.legacyEdition,
            "[Test] Paper Moon",
            "2004-08-23",
            "US",
            ["CD", "CD"],
            4,
            true,
            "Legacy Edition",
          ),
          releaseSummary(
            FIXTURE.digitalEdition,
            "[Test] Paper Moon",
            null,
            "XW",
            ["Digital Media"],
            3,
            false,
          ),
        ]
      : [];
  return {
    "release-count": releases.length,
    "release-offset": 0,
    releases,
  };
}

const lookupCredit = (who: typeof inkQuartet, joinphrase = "") => ({
  name: who.name,
  joinphrase,
  artist: who,
});

const track = (
  position: number,
  title: string,
  recordingId: string,
  length: number | null,
  credit = [lookupCredit(inkQuartet)],
) => ({
  id: `6c6c6c6c-0000-4000-8000-00000000${String(position).padStart(4, "0")}`,
  position,
  number: String(position),
  title,
  length,
  "artist-credit": credit,
  recording: { id: recordingId, title, length, video: false },
});

const releaseGroup = {
  id: FIXTURE.paperMoon,
  title: "[Test] Paper Moon",
  disambiguation: "",
  "primary-type": "Album",
  "secondary-types": [],
  "first-release-date": "1994-08-15",
};

export function releaseLookup(releaseId: string) {
  const base = {
    title: "[Test] Paper Moon",
    status: "Official",
    disambiguation: "",
    "artist-credit": [lookupCredit(inkQuartet)],
    "label-info": [label("[Test] Label")],
    "release-group": releaseGroup,
  };
  if (releaseId === FIXTURE.firstPressing) {
    return {
      ...base,
      id: releaseId,
      date: "1994-08-15",
      country: "GB",
      "cover-art-archive": { front: true, back: true, count: 2 },
      media: [
        {
          position: 1,
          format: "CD",
          title: "",
          tracks: [
            track(1, "[Test] Opening Line", FIXTURE.recording1, 342266),
            track(2, "[Test] Second Verse", FIXTURE.recording2, 322066, [
              lookupCredit(inkQuartet, " feat. "),
              lookupCredit(paperSinger),
            ]),
            track(3, "[Test] Last Light", FIXTURE.recording3, null),
          ],
        },
      ],
    };
  }
  if (releaseId === FIXTURE.legacyEdition) {
    return {
      ...base,
      id: releaseId,
      date: "2004-08-23",
      country: "US",
      disambiguation: "Legacy Edition",
      "cover-art-archive": { front: true, back: false, count: 1 },
      media: [
        {
          position: 1,
          format: "CD",
          title: "",
          tracks: [
            track(1, "[Test] Opening Line", FIXTURE.recording1, 342266),
            track(2, "[Test] Second Verse", FIXTURE.recording2, 322066),
            track(3, "[Test] Last Light", FIXTURE.recording3, 275400),
          ],
        },
        {
          position: 2,
          format: "CD",
          title: "Bonus",
          tracks: [track(1, "[Test] Demo", FIXTURE.recording4, 200000)],
        },
      ],
    };
  }
  if (releaseId === FIXTURE.digitalEdition) {
    return {
      ...base,
      id: releaseId,
      date: "",
      country: "XW",
      "cover-art-archive": { front: false, back: false, count: 0 },
      media: [
        {
          position: 1,
          format: "Digital Media",
          title: "",
          tracks: [
            track(1, "[Test] Opening Line", FIXTURE.recording1, 342266),
            track(2, "[Test] Second Verse", FIXTURE.recording2, 322066),
            track(3, "[Test] Hidden Reprise", FIXTURE.recording5, 90000),
          ],
        },
      ],
    };
  }
  if (releaseId === FIXTURE.repeatedRecording) {
    return {
      ...base,
      id: releaseId,
      date: "1995",
      country: "AU",
      "cover-art-archive": { front: false, back: false, count: 0 },
      media: [
        {
          position: 1,
          format: "CD",
          title: "",
          tracks: [
            track(1, "[Test] Opening Line", FIXTURE.recording1, 342266),
            track(2, "[Test] Opening Line (reprise)", FIXTURE.recording1, 1),
          ],
        },
      ],
    };
  }
  return null;
}

export function releaseGroupLookup(releaseGroupId: string) {
  const found = releaseGroupSearch("paper")["release-groups"].find(
    (group) => group.id === releaseGroupId,
  );
  if (!found) {
    return null;
  }
  // A lookup has no search fields (score, count, releases).
  return {
    id: found.id,
    title: found.title,
    disambiguation: found.disambiguation ?? "",
    "primary-type": found["primary-type"],
    "secondary-types": found["secondary-types"] ?? [],
    "first-release-date": found["first-release-date"],
    "artist-credit": found["artist-credit"].map((credit) => ({
      ...credit,
      joinphrase: "",
      artist:
        credit.artist.id === FIXTURE.inkQuartet ? inkQuartet : paperSinger,
    })),
  };
}

export function artistLookup(artistId: string) {
  if (artistId === FIXTURE.inkQuartet) {
    return inkQuartet;
  }
  if (artistId === FIXTURE.paperSinger) {
    return paperSinger;
  }
  return null;
}

const image = (
  releaseId: string,
  id: string,
  front: boolean,
  types: string[],
) => ({
  approved: true,
  back: types.includes("Back"),
  comment: "",
  edit: 63649475,
  front,
  // A number, as the archive sends it.
  id: Number(id),
  image: `http://coverartarchive.org/release/${releaseId}/${id}.jpg`,
  thumbnails: {
    "250": `http://coverartarchive.org/release/${releaseId}/${id}-250.jpg`,
    "500": `http://coverartarchive.org/release/${releaseId}/${id}-500.jpg`,
    "1200": `http://coverartarchive.org/release/${releaseId}/${id}-1200.jpg`,
    small: `http://coverartarchive.org/release/${releaseId}/${id}-250.jpg`,
    large: `http://coverartarchive.org/release/${releaseId}/${id}-500.jpg`,
  },
  types,
});

/** The archive's listing for a release, or null for "no artwork" (404). */
export function coverListing(releaseId: string) {
  if (releaseId === FIXTURE.firstPressing) {
    return {
      images: [
        image(releaseId, FIXTURE.frontImage, true, ["Front"]),
        image(releaseId, FIXTURE.backImage, false, ["Back"]),
      ],
      release: `https://musicbrainz.org/release/${releaseId}`,
    };
  }
  if (releaseId === FIXTURE.legacyEdition) {
    return {
      images: [image(releaseId, FIXTURE.legacyFrontImage, true, ["Front"])],
      release: `https://musicbrainz.org/release/${releaseId}`,
    };
  }
  return null;
}

/** The archive's listing for a release group: the chosen release's images. */
export function coverGroupListing(releaseGroupId: string) {
  return releaseGroupId === FIXTURE.paperMoon
    ? coverListing(FIXTURE.firstPressing)
    : null;
}
