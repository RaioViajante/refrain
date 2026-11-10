import { HomeScreen, homeMetadata } from "@/app/home-screen";

export default function Page() {
  return <HomeScreen locale="pt-BR" />;
}

export function generateMetadata() {
  return homeMetadata("pt-BR");
}

/**
 * This route renders on the server per request and waits for its data before
 * it sends the page, instead of sending a prerendered shell first: the Home
 * must be complete without client JavaScript.
 */
export const instant = false;
