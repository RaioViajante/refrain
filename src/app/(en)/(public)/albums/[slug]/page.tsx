import {
  AlbumJournalScreen,
  albumJournalMetadata,
} from "@/app/(public)/albums/[slug]/screen";

type Props = Readonly<{ params: Promise<{ slug: string }> }>;

export default function Page({ params }: Props) {
  return <AlbumJournalScreen params={params} locale="en" />;
}

export function generateMetadata({ params }: Props) {
  return albumJournalMetadata(params, "en");
}
