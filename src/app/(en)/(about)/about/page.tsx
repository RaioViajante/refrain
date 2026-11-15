import { AboutScreen, aboutMetadata } from "@/app/(about)/about/screen";

export default function Page() {
  return <AboutScreen locale="en" />;
}

export function generateMetadata() {
  return aboutMetadata("en");
}

/**
 * This route renders on the server per request and waits for its data before
 * it sends the page, instead of sending a prerendered shell first: the page
 * must be complete without client JavaScript.
 */
export const instant = false;
