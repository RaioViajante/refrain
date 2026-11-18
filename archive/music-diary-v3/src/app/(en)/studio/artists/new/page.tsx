import {
  NewArtistScreen,
  newArtistMetadata,
} from "@/app/studio/artists/new/screen";

export default function Page() {
  return <NewArtistScreen locale="en" />;
}

export const metadata = newArtistMetadata("en");
