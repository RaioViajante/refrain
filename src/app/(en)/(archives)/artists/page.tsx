import {
  ArtistsArchiveScreen,
  artistsArchiveMetadata,
} from "@/app/(archives)/artists/screen";

export default function Page() {
  return <ArtistsArchiveScreen locale="en" />;
}

export function generateMetadata() {
  return artistsArchiveMetadata("en");
}

/**
 * This route renders on the server per request and waits for its data before
 * it sends the page, instead of sending a prerendered shell first: the page
 * must be complete without client JavaScript.
 */
export const instant = false;
