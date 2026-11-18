import {
  NewArtistScreen,
  newArtistMetadata,
} from "@/app/studio/artists/new/screen";

export default function Page() {
  return <NewArtistScreen locale="pt-BR" />;
}

export const metadata = newArtistMetadata("pt-BR");
