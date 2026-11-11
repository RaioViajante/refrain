import { HomeScreen, homeMetadata } from "@/app/home-screen";

export default function Page() {
  return <HomeScreen locale="en" />;
}

export function generateMetadata() {
  return homeMetadata("en");
}

/**
 * This route renders on the server per request and waits for its data before
 * it sends the page, instead of sending a prerendered shell first: the Home
 * must be complete without client JavaScript.
 */
export const instant = false;
