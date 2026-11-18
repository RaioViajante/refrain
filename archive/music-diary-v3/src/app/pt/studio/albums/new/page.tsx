import {
  NewAlbumScreen,
  newAlbumMetadata,
} from "@/app/studio/albums/new/screen";

type Props = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default function Page({ searchParams }: Props) {
  return <NewAlbumScreen searchParams={searchParams} locale="pt-BR" />;
}

export const metadata = newAlbumMetadata("pt-BR");
