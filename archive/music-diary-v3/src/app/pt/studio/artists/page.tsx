import { ArtistsScreen, artistsMetadata } from "@/app/studio/artists/screen";

export default function Page() {
  return <ArtistsScreen locale="pt-BR" />;
}

export const metadata = artistsMetadata("pt-BR");
