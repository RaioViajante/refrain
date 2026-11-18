import { hash } from "node:crypto";

import { MAX_SLUG_LENGTH, normalizeSlug } from "./slug";

// The public address of an artist (M3.5): `/artists/<address>`. Pure
// functions, no database access.
//
// Artists have no stored slug (adding one is a migration, which the owner has
// not authorized; docs/evidence/m3-5.md § Addresses). The address is derived
// from the artist's name with the entry slugs' own normalization (ADR 0002,
// D7.2), **only over the artists that are publicly visible**, never over the
// whole catalog: so an address can never reveal that a catalog-only or private
// artist exists, not even through a collision suffix.
//
// - An artist whose normalized name no other visible artist shares is at
//   `/artists/<name>` (`/artists/jeff-buckley`).
// - Visible artists that share a normalized name are each at
//   `<name>-<suffix>`, where the suffix is ten hexadecimal digits of a SHA-256
//   of a fixed purpose string and the artist's id: stable for that artist,
//   opaque (it carries no identifier and cannot be reversed into one), and
//   independent of any other row. While two visible artists share a name,
//   neither has the bare name, so a link can never lead to the wrong one.
// - A name with nothing usable in it (written entirely in a non-Latin
//   script, say) uses `artist` as its name.
// - Any two artists that would still end up at one address (a suffix
//   collision, about one chance in 10^12 per pair) are both left without one:
//   neither page is served, rather than either being ambiguous.
//
// What this costs, recorded for the owner: an address changes when the
// artist's name changes in the catalog, or when a second visible artist with
// the same name appears or disappears, and the old address then answers the
// unknown-address `404` (no redirect, because nothing records the old one).
// A stored, retained artist slug would remove that; it is a proposed
// migration, not built.

/** Length of the disambiguating suffix, in hexadecimal digits. */
export const ARTIST_ADDRESS_SUFFIX_LENGTH = 10;

/** The name used when an artist's name normalizes to nothing. */
export const ARTIST_ADDRESS_FALLBACK = "artist";

// A fixed purpose string, so this hash is never the same value as any other
// hash of an id that the application might compute.
const SUFFIX_PURPOSE = "refrain/artist-address/v1";

function trimHyphens(value: string): string {
  return value.replace(/^-+|-+$/g, "");
}

/** The normalized name an artist's address starts from. */
export function artistAddressBase(name: string): string {
  return normalizeSlug(name) || ARTIST_ADDRESS_FALLBACK;
}

/** The artist's stable, opaque suffix. */
export function artistAddressSuffix(artistId: string): string {
  return hash("sha256", `${SUFFIX_PURPOSE}\u0000${artistId}`, "hex").slice(
    0,
    ARTIST_ADDRESS_SUFFIX_LENGTH,
  );
}

/** `<base>-<suffix>`, with the base shortened so the whole stays within 80. */
export function suffixedArtistAddress(base: string, artistId: string): string {
  const suffix = artistAddressSuffix(artistId);
  const room = MAX_SLUG_LENGTH - suffix.length - 1;
  const shortened = trimHyphens(base.slice(0, room)) || ARTIST_ADDRESS_FALLBACK;
  return `${shortened}-${suffix}`;
}

export interface AddressedArtist {
  artistId: string;
  name: string;
}

/**
 * The address of each artist in `visible`, which must be exactly the set of
 * publicly visible artists (`publicArtists` in public-artist.ts). An artist
 * absent from the result has no address and no page.
 */
export function artistAddresses(
  visible: readonly AddressedArtist[],
): Map<string, string> {
  const byBase = new Map<string, string[]>();
  for (const artist of visible) {
    const base = artistAddressBase(artist.name);
    byBase.set(base, [...(byBase.get(base) ?? []), artist.artistId]);
  }

  const proposed = new Map<string, string>();
  for (const [base, ids] of byBase) {
    const unique = new Set(ids);
    for (const id of unique) {
      proposed.set(
        id,
        unique.size === 1 ? base : suffixedArtistAddress(base, id),
      );
    }
  }

  const holders = new Map<string, number>();
  for (const address of proposed.values()) {
    holders.set(address, (holders.get(address) ?? 0) + 1);
  }
  const addresses = new Map<string, string>();
  for (const [id, address] of proposed) {
    if (holders.get(address) === 1) {
      addresses.set(id, address);
    }
  }
  return addresses;
}
