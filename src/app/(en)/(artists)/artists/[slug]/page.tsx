import {
  ArtistScreen,
  artistMetadata,
} from "@/app/(artists)/artists/[slug]/screen";

type Props = Readonly<{ params: Promise<{ slug: string }> }>;

export default function Page({ params }: Props) {
  return <ArtistScreen params={params} locale="en" />;
}

export function generateMetadata({ params }: Props) {
  return artistMetadata(params, "en");
}

/**
 * This route renders on the server per request and waits for its data before
 * it sends the page, instead of sending a prerendered shell first: the page
 * must be complete without client JavaScript.
 */
export const instant = false;
