// The values of the album form. Kept apart from the form itself, which is a
// Client Component: a server page cannot read a value (as opposed to a
// component) exported from a "use client" module; it receives an empty
// reference instead, and the form would then fail on its first submit.
import type { CreditRow } from "@/app/studio/artist-rows";

export interface AlbumValues {
  title: string;
  year: string;
  mbReleaseGroupId: string;
  credits: CreditRow[];
  label: string;
  releaseDate: string;
  country: string;
}

export const emptyAlbum: AlbumValues = {
  title: "",
  year: "",
  mbReleaseGroupId: "",
  credits: [{ artistId: "", creditedAs: "" }],
  label: "",
  releaseDate: "",
  country: "",
};
