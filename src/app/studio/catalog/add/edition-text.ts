// How an edition's provider facts are worded for someone who does not know
// MusicBrainz's codes. Presentation only: what is reviewed and stored is the
// provider's own value.

const MONTHS = new Intl.DateTimeFormat("en", {
  month: "long",
  timeZone: "UTC",
});

/** MusicBrainz's own area codes that are not countries. */
const AREAS: Record<string, string> = {
  XW: "Worldwide",
  XE: "Europe",
  XG: "East Germany",
  XC: "Czechoslovakia",
  XU: "Soviet Union",
  YU: "Yugoslavia",
};

const COUNTRIES = new Intl.DisplayNames(["en"], {
  type: "region",
  fallback: "code",
});

/** "August 23, 1994", "August 1994", or "1994"; null when there is no date. */
export function editionDate(date: string | null): string | null {
  if (date === null) {
    return null;
  }
  const [year, month, day] = date.split("-");
  if (!month) {
    return year ?? null;
  }
  const name = MONTHS.format(
    new Date(Date.UTC(Number(year), Number(month) - 1)),
  );
  return day ? `${name} ${Number(day)}, ${year}` : `${name} ${year}`;
}

/** "United Kingdom" for "GB"; a code it cannot name is returned as it is. */
export function editionPlace(country: string | null): string | null {
  if (country === null) {
    return null;
  }
  const area = AREAS[country];
  if (area) {
    return area;
  }
  if (!/^[A-Z]{2}$/.test(country)) {
    return country;
  }
  return COUNTRIES.of(country) ?? country;
}
