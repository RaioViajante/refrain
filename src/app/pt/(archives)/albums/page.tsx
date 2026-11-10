import {
  AlbumsArchiveScreen,
  albumsArchiveMetadata,
} from "@/app/(archives)/albums/screen";

export default function Page() {
  return <AlbumsArchiveScreen locale="pt-BR" />;
}

export function generateMetadata() {
  return albumsArchiveMetadata("pt-BR");
}

/**
 * This route renders on the server per request and waits for its data before
 * it sends the page, instead of sending a prerendered shell first: the page
 * must be complete without client JavaScript.
 */
export const instant = false;
