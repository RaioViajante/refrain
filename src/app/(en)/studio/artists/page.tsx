import { ArtistsScreen, artistsMetadata } from "@/app/studio/artists/screen";

export default function Page() {
  return <ArtistsScreen locale="en" />;
}

export const metadata = artistsMetadata("en");
