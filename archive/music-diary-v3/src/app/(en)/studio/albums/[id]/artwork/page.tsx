import {
  ArtworkScreen,
  artworkMetadata,
} from "@/app/studio/albums/[id]/artwork/screen";

type Props = Readonly<{ params: Promise<{ id: string }> }>;

export default function Page({ params }: Props) {
  return <ArtworkScreen params={params} locale="en" />;
}

export const metadata = artworkMetadata("en");
