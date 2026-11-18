import {
  NewAlbumScreen,
  newAlbumMetadata,
} from "@/app/studio/albums/new/screen";

type Props = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default function Page({ searchParams }: Props) {
  return <NewAlbumScreen searchParams={searchParams} locale="en" />;
}

export const metadata = newAlbumMetadata("en");
