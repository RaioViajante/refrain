import {
  ArtistPhotoScreen,
  artistPhotoMetadata,
} from "@/app/studio/artists/[id]/photo/screen";

type Props = Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default function Page({ params, searchParams }: Props) {
  return (
    <ArtistPhotoScreen
      params={params}
      searchParams={searchParams}
      locale="pt-BR"
    />
  );
}

export const metadata = artistPhotoMetadata("pt-BR");
