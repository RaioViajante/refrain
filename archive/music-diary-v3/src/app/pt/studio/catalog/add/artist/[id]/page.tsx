import {
  AddArtistScreen,
  addArtistMetadata,
} from "@/app/studio/catalog/add/artist/[id]/screen";

type Props = Readonly<{ params: Promise<{ id: string }> }>;

export default function Page({ params }: Props) {
  return <AddArtistScreen params={params} locale="pt-BR" />;
}

export const metadata = addArtistMetadata("pt-BR");
