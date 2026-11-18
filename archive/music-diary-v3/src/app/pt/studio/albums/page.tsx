import { AlbumsScreen, albumsMetadata } from "@/app/studio/albums/screen";

export default function Page() {
  return <AlbumsScreen locale="pt-BR" />;
}

export const metadata = albumsMetadata("pt-BR");
