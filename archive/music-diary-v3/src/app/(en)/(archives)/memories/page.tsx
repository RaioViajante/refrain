import {
  MemoriesArchiveScreen,
  memoriesArchiveMetadata,
} from "@/app/(archives)/memories/screen";

export default function Page() {
  return <MemoriesArchiveScreen locale="en" />;
}

export function generateMetadata() {
  return memoriesArchiveMetadata("en");
}

/**
 * This route renders on the server per request and waits for its data before
 * it sends the page, instead of sending a prerendered shell first: the page
 * must be complete without client JavaScript.
 */
export const instant = false;
