import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ARTIST_ADDRESS_FALLBACK,
  artistAddressBase,
  artistAddresses,
  artistAddressSuffix,
  suffixedArtistAddress,
} from "./artist-address";
import { isNormalizedSlug } from "./slug";

// The public address of an artist (M3.5), as a pure function of the visible
// artists. The suffix is checked against an independent computation.

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function independentSuffix(artistId: string): string {
  return createHash("sha256")
    .update(`refrain/artist-address/v1\u0000${artistId}`)
    .digest("hex")
    .slice(0, 10);
}

describe("an artist's address", () => {
  it("is the name, normalized like an entry slug", () => {
    expect(artistAddressBase("Jeff Buckley")).toBe("jeff-buckley");
    expect(artistAddressBase("Björk")).toBe("bjork");
    expect(artistAddressBase("Sigur Rós")).toBe("sigur-ros");
    expect(artistAddressBase("AC/DC")).toBe("ac-dc");
    expect(artistAddressBase("  !!! ")).toBe(ARTIST_ADDRESS_FALLBACK);
    expect(artistAddressBase("坂本龍一")).toBe(ARTIST_ADDRESS_FALLBACK);
  });

  it("has a stable, opaque suffix of ten hexadecimal digits", () => {
    expect(artistAddressSuffix(id(1))).toBe(independentSuffix(id(1)));
    expect(artistAddressSuffix(id(1))).toMatch(/^[0-9a-f]{10}$/);
    expect(artistAddressSuffix(id(1))).not.toBe(artistAddressSuffix(id(2)));
    expect(artistAddressSuffix(id(1))).not.toContain("0000");
  });

  it("stays a valid slug of at most 80 characters with its suffix", () => {
    const long = "a".repeat(80);
    const address = suffixedArtistAddress(long, id(3));
    expect(address.length).toBe(80);
    expect(isNormalizedSlug(address)).toBe(true);
    // A cut that would end in a hyphen is trimmed.
    const hyphenated = `${"ab-".repeat(30)}`.slice(0, 80);
    expect(isNormalizedSlug(suffixedArtistAddress(hyphenated, id(4)))).toBe(
      true,
    );
  });
});

describe("the addresses of the visible artists", () => {
  it("gives a unique name the bare name", () => {
    const addresses = artistAddresses([
      { artistId: id(1), name: "Jeff Buckley" },
      { artistId: id(2), name: "Nick Drake" },
    ]);
    expect(addresses).toEqual(
      new Map([
        [id(1), "jeff-buckley"],
        [id(2), "nick-drake"],
      ]),
    );
  });

  it("suffixes every artist that shares a name, so no link can reach the wrong one", () => {
    const addresses = artistAddresses([
      { artistId: id(1), name: "Low" },
      { artistId: id(2), name: "LOW" },
      { artistId: id(3), name: "Nick Drake" },
    ]);
    expect(addresses.get(id(1))).toBe(`low-${independentSuffix(id(1))}`);
    expect(addresses.get(id(2))).toBe(`low-${independentSuffix(id(2))}`);
    expect(addresses.get(id(3))).toBe("nick-drake");
    expect([...addresses.values()]).not.toContain("low");
  });

  it("depends only on the set, not its order, and repeats change nothing", () => {
    const artists = [
      { artistId: id(1), name: "Low" },
      { artistId: id(2), name: "Low" },
      { artistId: id(3), name: "Nick Drake" },
    ];
    const forward = artistAddresses(artists);
    const backward = artistAddresses([...artists].reverse());
    const repeated = artistAddresses([...artists, artists[0]!]);
    expect(backward).toEqual(forward);
    expect(repeated).toEqual(forward);
  });

  it("leaves out artists that would still share an address, rather than either", () => {
    // A name that is literally another artist's suffixed address.
    const suffixed = `low-${independentSuffix(id(1))}`;
    const addresses = artistAddresses([
      { artistId: id(1), name: "Low" },
      { artistId: id(2), name: "Low" },
      { artistId: id(9), name: suffixed },
    ]);
    expect(addresses.has(id(1))).toBe(false);
    expect(addresses.has(id(9))).toBe(false);
    expect(addresses.get(id(2))).toBe(`low-${independentSuffix(id(2))}`);
  });

  it("names only the artists it was given", () => {
    expect(artistAddresses([])).toEqual(new Map());
  });
});
