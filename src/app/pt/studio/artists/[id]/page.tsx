import { ArtistScreen, artistMetadata } from "@/app/studio/artists/[id]/screen";

type Props = Readonly<{ params: Promise<{ id: string }> }>;

export default function Page({ params }: Props) {
  return <ArtistScreen params={params} locale="pt-BR" />;
}

export const metadata = artistMetadata("pt-BR");
