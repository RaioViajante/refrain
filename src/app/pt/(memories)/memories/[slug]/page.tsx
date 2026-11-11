import {
  MemoryScreen,
  memoryMetadata,
} from "@/app/(memories)/memories/[slug]/screen";

type Props = Readonly<{ params: Promise<{ slug: string }> }>;

export default function Page({ params }: Props) {
  return <MemoryScreen params={params} locale="pt-BR" />;
}

export function generateMetadata({ params }: Props) {
  return memoryMetadata(params, "pt-BR");
}

/**
 * This route renders on the server per request and waits for its data before
 * it sends the page, instead of sending a prerendered shell first: the page
 * must be complete without client JavaScript.
 */
export const instant = false;
