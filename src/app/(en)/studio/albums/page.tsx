import { AlbumsScreen, albumsMetadata } from "@/app/studio/albums/screen";

export default function Page() {
  return <AlbumsScreen locale="en" />;
}

export const metadata = albumsMetadata("en");
