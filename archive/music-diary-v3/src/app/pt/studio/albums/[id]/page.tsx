import { AlbumScreen, albumMetadata } from "@/app/studio/albums/[id]/screen";

type Props = Readonly<{ params: Promise<{ id: string }> }>;

export default function Page({ params }: Props) {
  return <AlbumScreen params={params} locale="pt-BR" />;
}

export const metadata = albumMetadata("pt-BR");
